import { dungeonVoiceEngine } from "./voiceEngine.js";
import {
  voicePresets,
  getVoicePresetById,
  defaultVoiceByCharacterId,
  resolveVoiceParams,
  VOICE_PRESET_VERSION,
} from "./voicePresets.js";

/** Slider id → param key, with the formatter used for its readout. */
const SLIDER_DEFINITIONS = [
  { key: "pitch", id: "voice-pitch", format: (value) => String(Math.round(value)) },
  { key: "formant", id: "voice-formant", format: (value) => String(Math.round(value)) },
  { key: "sub", id: "voice-sub", format: (value) => Number(value).toFixed(2) },
  { key: "detune", id: "voice-detune", format: (value) => Number(value).toFixed(2) },
  { key: "growl", id: "voice-growl", format: (value) => Number(value).toFixed(2) },
  { key: "ring", id: "voice-ring", format: (value) => Number(value).toFixed(2) },
  { key: "air", id: "voice-air", format: (value) => Number(value).toFixed(2) },
  { key: "drive", id: "voice-drive", format: (value) => Number(value).toFixed(2) },
  { key: "low", id: "voice-low", format: (value) => String(Math.round(value)) },
  { key: "mid", id: "voice-mid", format: (value) => String(Math.round(value)) },
  { key: "high", id: "voice-high", format: (value) => String(Math.round(value)) },
  { key: "presence", id: "voice-presence", format: (value) => String(Math.round(value)) },
  { key: "chorus", id: "voice-chorus", format: (value) => Number(value).toFixed(2) },
  { key: "vibrato", id: "voice-vibrato", format: (value) => Number(value).toFixed(2) },
  { key: "delay", id: "voice-delay", format: (value) => Number(value).toFixed(2) },
  { key: "reverb", id: "voice-reverb", format: (value) => Number(value).toFixed(2) },
  { key: "gain", id: "voice-gain", format: (value) => Number(value).toFixed(2) },
];

/**
 * Wire Voice Lab controls into the Control panel.
 * @param {{
 *   getState: () => any,
 *   saveState: () => void,
 *   getCharacter: () => ({ id: string, name: string } | null),
 * }} options
 */
export function initVoiceLab(options) {
  const voiceStatus = document.getElementById("voice-lab-status");
  const voicePresetSelect = document.getElementById("voice-preset");
  const voiceInputSelect = document.getElementById("voice-input");
  const voiceOutputSelect = document.getElementById("voice-output");
  const voiceAssignedLabel = document.getElementById("voice-assigned-label");
  const voiceLevel = document.getElementById("voice-level");
  const voiceMuteButton = document.getElementById("voice-mute");

  const sliders = SLIDER_DEFINITIONS.map((definition) => ({
    ...definition,
    input: document.getElementById(definition.id),
    output: document.getElementById(`${definition.id}-out`),
  })).filter((slider) => slider.input && slider.output);

  let meterRaf = 0;
  let suppressPresetChange = false;

  function state() {
    return options.getState();
  }

  function ensureVoiceLabState() {
    const scene = state();
    if (!scene.voiceLab) {
      scene.voiceLab = {
        autoApplyOnSelect: true,
        selectedPresetId: "chromatic-dragons",
        inputDeviceId: "",
        outputDeviceId: "",
        tweaksByPresetId: {},
        presetVersion: VOICE_PRESET_VERSION,
      };
    }
    if (!scene.voiceLab.tweaksByPresetId) {
      scene.voiceLab.tweaksByPresetId = {};
    }
    return scene.voiceLab;
  }

  function setStatus(text) {
    if (voiceStatus) voiceStatus.textContent = text;
  }

  function currentTweakParams(presetId) {
    const lab = ensureVoiceLabState();
    const preset = getVoicePresetById(presetId);
    return resolveVoiceParams(preset, lab.tweaksByPresetId[presetId] || {});
  }

  function writeSliders(params) {
    for (const slider of sliders) {
      const value = params[slider.key] ?? 0;
      slider.input.value = String(value);
      slider.output.textContent = slider.format(value);
    }
  }

  function readSliders() {
    const values = {};
    for (const slider of sliders) {
      values[slider.key] = Number(slider.input.value);
    }
    return values;
  }

  function applyCurrentSliders() {
    const lab = ensureVoiceLabState();
    const preset = getVoicePresetById(lab.selectedPresetId);
    dungeonVoiceEngine.applyParams(resolveVoiceParams(preset, readSliders()));
  }

  function fillPresetSelect() {
    voicePresetSelect.innerHTML = "";
    let currentGroup = null;
    let lastCategory = "";
    for (const preset of voicePresets) {
      if (preset.category !== lastCategory) {
        currentGroup = document.createElement("optgroup");
        currentGroup.label = preset.category;
        voicePresetSelect.appendChild(currentGroup);
        lastCategory = preset.category;
      }
      const option = document.createElement("option");
      option.value = preset.id;
      option.textContent = preset.name;
      currentGroup.appendChild(option);
    }
  }

  async function fillDeviceSelects() {
    let permissionStream = null;
    try {
      // Permission unlocks device labels — stop immediately so it can't linger.
      permissionStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: false,
        },
      });
    } catch {
      // continue with unlabeled devices
    } finally {
      if (permissionStream) {
        for (const track of permissionStream.getTracks()) {
          track.stop();
        }
      }
    }

    const inputs = await dungeonVoiceEngine.listInputDevices();
    const outputs = await dungeonVoiceEngine.listOutputDevices();
    const lab = ensureVoiceLabState();

    voiceInputSelect.innerHTML = "";
    const defaultInput = document.createElement("option");
    defaultInput.value = "";
    defaultInput.textContent = "System default mic";
    voiceInputSelect.appendChild(defaultInput);
    for (const device of inputs) {
      const option = document.createElement("option");
      option.value = device.deviceId;
      option.textContent = device.label || `Mic ${device.deviceId.slice(0, 6)}`;
      voiceInputSelect.appendChild(option);
    }
    voiceInputSelect.value = lab.inputDeviceId || "";

    voiceOutputSelect.innerHTML = "";
    const defaultOutput = document.createElement("option");
    defaultOutput.value = "";
    defaultOutput.textContent = "System default output";
    voiceOutputSelect.appendChild(defaultOutput);
    for (const device of outputs) {
      const option = document.createElement("option");
      option.value = device.deviceId;
      option.textContent =
        device.label || `Output ${device.deviceId.slice(0, 6)}`;
      voiceOutputSelect.appendChild(option);
    }
    voiceOutputSelect.value = lab.outputDeviceId || "";
  }

  function updateAssignedLabel() {
    const character = options.getCharacter();
    if (!character) {
      voiceAssignedLabel.textContent = "Current stage character voice: —";
      return;
    }
    const assigned =
      state().voicesByCharacterId?.[character.id]?.voicePresetId ||
      defaultVoiceByCharacterId[character.id] ||
      "";
    const preset = getVoicePresetById(assigned);
    voiceAssignedLabel.textContent = preset
      ? `${character.name} → ${preset.name}`
      : `${character.name} → not assigned`;
  }

  function selectPreset(presetId, { apply = true } = {}) {
    const lab = ensureVoiceLabState();
    lab.selectedPresetId = presetId;
    suppressPresetChange = true;
    voicePresetSelect.value = presetId;
    suppressPresetChange = false;
    const params = currentTweakParams(presetId);
    writeSliders(params);
    if (apply) {
      dungeonVoiceEngine.applyParams(params);
      setStatus(`Loaded · ${params.name}`);
    }
    options.saveState();
    updateAssignedLabel();
  }

  function resolvePresetForCharacter(character) {
    if (!character) return "clean";
    return (
      state().voicesByCharacterId?.[character.id]?.voicePresetId ||
      defaultVoiceByCharacterId[character.id] ||
      "clean"
    );
  }

  async function applyForCharacter(character, reason = "") {
    const lab = ensureVoiceLabState();
    if (!lab.autoApplyOnSelect && reason === "select") return;
    const presetId = resolvePresetForCharacter(character);
    selectPreset(presetId, { apply: true });
    const presetName = getVoicePresetById(presetId)?.name || presetId;
    if (dungeonVoiceEngine.live) {
      setStatus(`Live · ${presetName}`);
    } else if (reason) {
      setStatus(`Ready · ${presetName} (Start mic test to hear)`);
    }
  }

  function startMeter() {
    cancelAnimationFrame(meterRaf);
    const tick = () => {
      if (voiceLevel) {
        voiceLevel.style.width = `${Math.round(dungeonVoiceEngine.getLevel() * 100)}%`;
      }
      meterRaf = requestAnimationFrame(tick);
    };
    tick();
  }

  dungeonVoiceEngine.onStatusChange = (text) => setStatus(text);

  fillPresetSelect();
  const lab = ensureVoiceLabState();
  document.getElementById("voice-on-select").checked =
    lab.autoApplyOnSelect !== false;
  selectPreset(lab.selectedPresetId || "chromatic-dragons", { apply: false });
  fillDeviceSelects().catch(() => {});
  updateAssignedLabel();

  document.getElementById("voice-start").addEventListener("click", async () => {
    try {
      const current = ensureVoiceLabState();
      await dungeonVoiceEngine.startLive(current.inputDeviceId || "");
      // Always apply saved output ("" = system default). Never block mic on route miss.
      await dungeonVoiceEngine.setOutputDevice(current.outputDeviceId || "");
      applyCurrentSliders();
      startMeter();
    } catch (error) {
      setStatus(`Mic failed: ${error.message}`);
    }
  });

  document.getElementById("voice-stop").addEventListener("click", async () => {
    dungeonVoiceEngine.stopLoop();
    await dungeonVoiceEngine.stopLive();
    cancelAnimationFrame(meterRaf);
    if (voiceLevel) voiceLevel.style.width = "0%";
  });

  document
    .getElementById("voice-loop-record")
    ?.addEventListener("click", async () => {
      try {
        const current = ensureVoiceLabState();
        if (!dungeonVoiceEngine.live) {
          await dungeonVoiceEngine.startLive(current.inputDeviceId || "");
          await dungeonVoiceEngine.setOutputDevice(current.outputDeviceId || "");
        }
        startMeter();
        await dungeonVoiceEngine.recordLoop(3);
        applyCurrentSliders();
      } catch (error) {
        setStatus(`Loop failed: ${error.message}`);
      }
    });

  document.getElementById("voice-loop-stop")?.addEventListener("click", () => {
    dungeonVoiceEngine.stopLoop();
  });

  voiceMuteButton.addEventListener("click", () => {
    const nextMuted = !dungeonVoiceEngine.muted;
    dungeonVoiceEngine.setMuted(nextMuted);
    voiceMuteButton.textContent = nextMuted ? "Unmute output" : "Mute output";
  });

  document.getElementById("voice-assign").addEventListener("click", () => {
    const character = options.getCharacter();
    if (!character) return;
    const labState = ensureVoiceLabState();
    const existing = state().voicesByCharacterId[character.id] || {};
    state().voicesByCharacterId[character.id] = {
      ...existing,
      voicePresetId: labState.selectedPresetId,
    };
    options.saveState();
    updateAssignedLabel();
    setStatus(
      `Assigned ${getVoicePresetById(labState.selectedPresetId)?.name} → ${character.name}`
    );
  });

  voicePresetSelect.addEventListener("change", () => {
    if (suppressPresetChange) return;
    selectPreset(voicePresetSelect.value, { apply: true });
  });

  voiceInputSelect.addEventListener("change", async () => {
    const labState = ensureVoiceLabState();
    labState.inputDeviceId = voiceInputSelect.value;
    options.saveState();
    if (dungeonVoiceEngine.live) {
      await dungeonVoiceEngine.startLive(labState.inputDeviceId || "");
      applyCurrentSliders();
    }
  });

  voiceOutputSelect.addEventListener("change", async () => {
    const labState = ensureVoiceLabState();
    labState.outputDeviceId = voiceOutputSelect.value;
    options.saveState();
    try {
      await dungeonVoiceEngine.setOutputDevice(labState.outputDeviceId || "");
    } catch (error) {
      setStatus(
        `Output unchanged — ${error.message}. Voice still uses system default.`
      );
    }
  });

  for (const slider of sliders) {
    slider.input.addEventListener("input", () => {
      slider.output.textContent = slider.format(slider.input.value);
      applyCurrentSliders();
    });
  }

  document.getElementById("voice-save-tweak").addEventListener("click", () => {
    const labState = ensureVoiceLabState();
    labState.tweaksByPresetId[labState.selectedPresetId] = readSliders();
    options.saveState();
    setStatus("Tweaks saved for this preset");
  });

  document.getElementById("voice-reset-tweak").addEventListener("click", () => {
    const labState = ensureVoiceLabState();
    delete labState.tweaksByPresetId[labState.selectedPresetId];
    options.saveState();
    selectPreset(labState.selectedPresetId, { apply: true });
    setStatus("Tweaks reset to preset defaults");
  });

  document
    .getElementById("voice-on-select")
    .addEventListener("change", (event) => {
      ensureVoiceLabState().autoApplyOnSelect = event.target.checked;
      options.saveState();
    });

  return {
    applyForCharacter,
    updateAssignedLabel,
    resolvePresetForCharacter,
  };
}
