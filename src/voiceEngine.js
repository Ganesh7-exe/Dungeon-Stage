import * as Tone from "tone";
import {
  DEFAULT_VOICE_PARAMS,
  getVoicePresetById,
  resolveVoiceParams,
} from "./voicePresets.js";

const FORMANT_BASE_FREQUENCIES = [550, 1650, 2750];

function clamp(value, minimum, maximum, fallback = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(maximum, Math.max(minimum, number));
}

/**
 * Live mic → layered creature voice.
 *
 * Instead of one pitch shift, the conditioned voice is split into parallel
 * layers (body, sub octave, detuned double, ring-modulated shimmer, breath)
 * that are mixed, then shaped by a formant bank, EQ, saturation and space.
 * That layering is what separates a "cheap pitch shift" from a monster voice.
 */
export class DungeonVoiceEngine {
  constructor() {
    this.ready = false;
    this.live = false;
    this.muted = false;
    this.looping = false;
    this.recording = false;
    this.statusText = "Voice engine idle";
    this.onStatusChange = null;
    this.currentParams = { ...DEFAULT_VOICE_PARAMS };
    this._graphBuilt = false;
    this._nodes = [];
  }

  setStatus(text) {
    this.statusText = text;
    this.onStatusChange?.(text, {
      ready: this.ready,
      live: this.live,
      muted: this.muted,
      looping: this.looping,
      recording: this.recording,
      params: { ...this.currentParams },
    });
  }

  track(node) {
    this._nodes.push(node);
    return node;
  }

  async ensureGraph() {
    if (this._graphBuilt) return;
    await Tone.start();

    const params = DEFAULT_VOICE_PARAMS;

    this.mic = this.track(new Tone.UserMedia());
    this.micGain = this.track(new Tone.Gain(1));
    this.loopPlayer = this.track(new Tone.Player({ loop: true, autostart: false }));
    this.recorder = this.track(new Tone.Recorder());
    this.inputBus = this.track(new Tone.Gain(1));

    // —— input conditioning ——
    this.highpass = this.track(
      new Tone.Filter({ type: "highpass", frequency: params.highpass, rolloff: -12 })
    );
    this.gate = this.track(new Tone.Gate({ threshold: -48, smoothing: 0.08 }));
    this.compressor = this.track(
      new Tone.Compressor({
        threshold: -26,
        ratio: 3.5,
        attack: 0.006,
        release: 0.12,
        knee: 12,
      })
    );
    this.preBus = this.track(new Tone.Gain(1));

    this.mic.connect(this.micGain);
    this.micGain.connect(this.inputBus);
    this.loopPlayer.connect(this.inputBus);
    this.inputBus.chain(this.highpass, this.gate, this.compressor, this.preBus);
    this.micGain.connect(this.recorder);

    // —— parallel voice layers ——
    this.mixBus = this.track(new Tone.Gain(1));

    this.pitchBody = this.track(
      new Tone.PitchShift({ pitch: 0, windowSize: 0.08, delayTime: 0, feedback: 0 })
    );
    this.bodyGain = this.track(new Tone.Gain(1));
    this.preBus.chain(this.pitchBody, this.bodyGain, this.mixBus);

    this.pitchSub = this.track(
      new Tone.PitchShift({ pitch: -12, windowSize: 0.1, delayTime: 0, feedback: 0 })
    );
    this.subLowpass = this.track(
      new Tone.Filter({ type: "lowpass", frequency: 900, rolloff: -24 })
    );
    this.subGain = this.track(new Tone.Gain(0));
    this.preBus.chain(this.pitchSub, this.subLowpass, this.subGain, this.mixBus);

    this.pitchDouble = this.track(
      new Tone.PitchShift({ pitch: 0, windowSize: 0.09, delayTime: 0.012, feedback: 0 })
    );
    this.doubleGain = this.track(new Tone.Gain(0));
    this.preBus.chain(this.pitchDouble, this.doubleGain, this.mixBus);

    this.ringShifter = this.track(new Tone.FrequencyShifter(40));
    this.ringBandpass = this.track(
      new Tone.Filter({ type: "bandpass", frequency: 1600, Q: 0.7 })
    );
    this.ringGain = this.track(new Tone.Gain(0));
    this.preBus.chain(this.ringShifter, this.ringBandpass, this.ringGain, this.mixBus);

    // Breath layer: pink noise opened by the voice envelope
    this.breathNoise = this.track(new Tone.Noise("pink")).start();
    this.breathVca = this.track(new Tone.Gain(0));
    this.breathBandpass = this.track(
      new Tone.Filter({ type: "bandpass", frequency: 3200, Q: 0.55 })
    );
    this.breathGain = this.track(new Tone.Gain(0));
    this.breathFollower = this.track(new Tone.Follower(0.06));
    this.breathNoise.chain(
      this.breathVca,
      this.breathBandpass,
      this.breathGain,
      this.mixBus
    );
    this.preBus.connect(this.breathFollower);
    this.breathFollower.connect(this.breathVca.gain);

    // —— shaping ——
    this.formantFilters = FORMANT_BASE_FREQUENCIES.map((frequency) =>
      this.track(
        new Tone.Filter({ type: "peaking", frequency, Q: 1.4, gain: 0 })
      )
    );
    this.eq = this.track(
      new Tone.EQ3({
        low: 0,
        mid: 0,
        high: 0,
        lowFrequency: 280,
        highFrequency: 2800,
      })
    );
    this.presence = this.track(
      new Tone.Filter({
        type: "peaking",
        frequency: params.presenceFreq,
        Q: 1.1,
        gain: params.presence,
      })
    );
    this.drive = this.track(
      new Tone.Distortion({ distortion: 0, oversample: "4x", wet: 0 })
    );
    this.growl = this.track(
      new Tone.Tremolo({ frequency: 55, depth: 0, spread: 0 })
    ).start();
    this.chorus = this.track(
      new Tone.Chorus({
        frequency: 1.4,
        delayTime: 3.4,
        depth: 0.6,
        spread: 150,
        wet: 0,
      })
    ).start();
    this.vibrato = this.track(
      new Tone.Vibrato({ frequency: 4.8, depth: 0.05, wet: 0 })
    );
    this.lowpass = this.track(
      new Tone.Filter({ type: "lowpass", frequency: params.lowpass, rolloff: -12 })
    );
    this.delay = this.track(
      new Tone.FeedbackDelay({
        delayTime: 0.18,
        feedback: 0.24,
        wet: 0,
        maxDelay: 1,
      })
    );
    this.reverb = this.track(
      new Tone.Reverb({ decay: 2.6, preDelay: 0.015, wet: params.reverb })
    );
    await this.reverb.generate();

    this.outputGain = this.track(new Tone.Gain(params.gain));
    this.limiter = this.track(new Tone.Limiter(-2));
    this.meter = this.track(new Tone.Meter({ channels: 1, normalRange: true }));

    this.mixBus.chain(
      this.formantFilters[0],
      this.formantFilters[1],
      this.formantFilters[2],
      this.eq,
      this.presence,
      this.drive,
      this.growl,
      this.chorus,
      this.vibrato,
      this.lowpass,
      this.delay,
      this.reverb,
      this.outputGain,
      this.limiter,
      this.meter,
      Tone.getDestination()
    );

    this._graphBuilt = true;
    this.ready = true;
  }

  applyParams(params) {
    const resolved = resolveVoiceParams(null, params);
    this.currentParams = resolved;
    if (!this._graphBuilt) return resolved;

    const pitch = clamp(resolved.pitch, -12, 12);
    this.pitchBody.pitch = pitch;
    this.pitchBody.windowSize = Math.abs(pitch) >= 5 ? 0.1 : 0.08;
    this.pitchSub.pitch = pitch - 12;
    this.pitchDouble.pitch = pitch + 0.12;

    const subAmount = clamp(resolved.sub, 0, 1);
    const doubleAmount = clamp(resolved.detune, 0, 1);
    const ringAmount = clamp(resolved.ring, 0, 1);
    const breathAmount = clamp(resolved.air, 0, 1);

    // Keep the body dominant so words stay readable under heavy layering.
    this.bodyGain.gain.value =
      1 - 0.22 * subAmount - 0.18 * doubleAmount - 0.15 * ringAmount;
    this.subGain.gain.value = subAmount * 0.85;
    this.doubleGain.gain.value = doubleAmount * 0.6;
    this.ringGain.gain.value = ringAmount * 0.5;
    this.breathGain.gain.value = breathAmount * 0.6;

    this.ringShifter.frequency.value = clamp(resolved.ringFreq, -200, 200, 40);
    this.breathBandpass.frequency.value = clamp(
      resolved.airFreq,
      600,
      8000,
      3200
    );

    // Formant bank approximates a bigger or smaller vocal tract.
    const formant = clamp(resolved.formant, -12, 12);
    const formantRatio = Math.pow(2, formant / 12);
    const formantGain = Math.min(6, Math.abs(formant) * 0.55);
    this.formantFilters.forEach((filter, index) => {
      filter.frequency.value = FORMANT_BASE_FREQUENCIES[index] * formantRatio;
      filter.gain.value = formantGain;
    });

    this.eq.low.value = clamp(resolved.low, -16, 16);
    this.eq.mid.value = clamp(resolved.mid, -16, 16);
    this.eq.high.value = clamp(resolved.high, -16, 16);

    this.presence.frequency.value = clamp(resolved.presenceFreq, 800, 5000, 2200);
    this.presence.gain.value = clamp(resolved.presence, -8, 12);

    const driveAmount = clamp(resolved.drive, 0, 1);
    this.drive.distortion = Math.min(0.8, driveAmount * 0.85);
    this.drive.wet.value = driveAmount <= 0.01 ? 0 : 0.2 + driveAmount * 0.45;

    // Amplitude modulation in the 25–90 Hz range reads as a throat growl.
    const growlAmount = clamp(resolved.growl, 0, 1);
    this.growl.frequency.value = clamp(resolved.growlRate, 15, 120, 55);
    this.growl.depth.value = growlAmount * 0.7;

    this.chorus.wet.value = clamp(resolved.chorus, 0, 1);
    const vibratoAmount = clamp(resolved.vibrato, 0, 1);
    this.vibrato.wet.value = vibratoAmount;
    this.vibrato.depth.value = 0.04 + vibratoAmount * 0.22;

    this.delay.wet.value = clamp(resolved.delay, 0, 0.8);
    this.reverb.wet.value = clamp(resolved.reverb, 0, 0.7);

    this.highpass.frequency.value = clamp(resolved.highpass, 40, 2000, 80);
    // Floor keeps consonants alive even on the deepest creatures.
    this.lowpass.frequency.value = clamp(resolved.lowpass, 4500, 16000, 12000);

    const gainValue = clamp(resolved.gain, 0, 2.2, 1);
    this.outputGain.gain.value = this.muted ? 0 : gainValue;
    return resolved;
  }

  applyPresetId(presetId, overrides = {}) {
    const preset = getVoicePresetById(presetId);
    if (!preset) {
      this.setStatus(`Unknown voice preset: ${presetId}`);
      return null;
    }
    const params = resolveVoiceParams(preset, overrides);
    this.applyParams(params);
    this.setStatus(`Voice · ${params.name}`);
    return params;
  }

  async startLive(deviceId = "") {
    await this.ensureGraph();
    const openOptions = deviceId ? { deviceId: { exact: deviceId } } : undefined;
    try {
      if (this.mic.state === "started") {
        await this.mic.close();
      }
      await this.mic.open(openOptions);
    } catch (error) {
      await this.mic.open();
      if (deviceId) {
        this.setStatus(
          `Mic opened (default) — selected device failed: ${error.message}`
        );
      }
    }
    this.live = true;
    this.applyParams(this.currentParams);
    this.setStatus(
      this.muted
        ? "Live (muted) — unmute to hear FX"
        : "Live — speak clearly (headphones)"
    );
  }

  async stopLive() {
    if (this.mic && this.mic.state === "started") {
      await this.mic.close();
    }
    this.live = false;
    this.setStatus("Voice engine stopped");
  }

  /** Capture a short dry phrase, then loop it through the FX for hands-free tweaking. */
  async recordLoop(seconds = 3) {
    await this.ensureGraph();
    if (!this.live) {
      await this.startLive(this.currentParams.inputDeviceId || "");
    }
    this.stopLoop();
    this.recording = true;
    this.setStatus(`Recording ${seconds}s — speak your line now…`);
    this.recorder.start();

    await new Promise((resolve) => setTimeout(resolve, seconds * 1000));

    const blob = await this.recorder.stop();
    this.recording = false;
    const url = URL.createObjectURL(blob);
    try {
      const buffer = await new Tone.ToneAudioBuffer().load(url);
      this.loopPlayer.buffer = buffer;
      this.micGain.gain.value = 0;
      this.loopPlayer.start();
      this.looping = true;
      this.setStatus("Looping your phrase — tweak sliders to compare");
    } catch (error) {
      this.setStatus(`Loop failed: ${error.message}`);
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  stopLoop() {
    if (this.loopPlayer && this.loopPlayer.state === "started") {
      this.loopPlayer.stop();
    }
    if (this.micGain) this.micGain.gain.value = 1;
    if (this.looping) {
      this.looping = false;
      this.setStatus("Loop stopped — mic live again");
    }
  }

  setMuted(muted) {
    this.muted = Boolean(muted);
    if (this.outputGain) {
      const gainValue = clamp(this.currentParams.gain, 0, 2.2, 1);
      this.outputGain.gain.value = this.muted ? 0 : gainValue;
    }
    this.setStatus(
      this.muted
        ? "Muted"
        : this.live
          ? "Live — speak clearly (headphones)"
          : this.statusText
    );
  }

  getLevel() {
    if (!this.meter) return 0;
    const value = this.meter.getValue();
    const level = Array.isArray(value) ? value[0] : value;
    return Math.min(1, Math.max(0, Number(level) || 0));
  }

  async listInputDevices() {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter((device) => device.kind === "audioinput");
  }

  async listOutputDevices() {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter((device) => device.kind === "audiooutput");
  }

  async setOutputDevice(deviceId) {
    await this.ensureGraph();
    const context = Tone.getContext().rawContext;
    if (typeof context.setSinkId !== "function") {
      throw new Error("This browser cannot route to a custom output device");
    }
    await context.setSinkId(deviceId || "");
    this.setStatus(
      deviceId
        ? "Output routed (use CABLE Input for Discord via VB-Cable)"
        : "Output · default device"
    );
  }

  dispose() {
    for (const node of this._nodes) {
      node.dispose?.();
    }
    this._nodes = [];
    this._graphBuilt = false;
    this.ready = false;
  }
}

export const dungeonVoiceEngine = new DungeonVoiceEngine();
