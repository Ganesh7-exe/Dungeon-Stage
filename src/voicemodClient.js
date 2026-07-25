const VOICEMOD_PORTS = [
  59129, 20000, 39273, 42152, 43782, 46667, 35679, 37170, 38501, 33952, 30546,
];

function createMessageId() {
  if (crypto?.randomUUID) return crypto.randomUUID();
  return `msg-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/**
 * Browser client for Voicemod Control API (WebSocket on localhost).
 * Needs Voicemod running + a free API key from Voicemod's developer form.
 */
export class VoicemodClient {
  constructor() {
    this.socket = null;
    this.apiKey = "";
    this.connected = false;
    this.authorized = false;
    this.voices = [];
    this.currentVoiceId = "nofx";
    this.statusText = "Disconnected";
    this.onStatusChange = null;
    this._pending = new Map();
  }

  setStatus(text) {
    this.statusText = text;
    this.onStatusChange?.(text, {
      connected: this.connected,
      authorized: this.authorized,
      voiceCount: this.voices.length,
      currentVoiceId: this.currentVoiceId,
    });
  }

  async connect(apiKey) {
    this.disconnect();
    this.apiKey = String(apiKey || "").trim();
    if (!this.apiKey) {
      this.setStatus("Add your Voicemod API key first");
      throw new Error("Missing Voicemod API key");
    }

    let lastError = null;
    for (const port of VOICEMOD_PORTS) {
      try {
        this.setStatus(`Connecting on port ${port}…`);
        await this._connectPort(port);
        await this._register();
        await this.refreshVoices();
        await this.ensureVoiceChangerOn();
        this.setStatus(`Connected · ${this.voices.length} voices`);
        return true;
      } catch (error) {
        lastError = error;
        this.disconnect();
      }
    }

    this.setStatus("Voicemod not found — is the app open?");
    throw lastError || new Error("Could not connect to Voicemod");
  }

  disconnect() {
    if (this.socket) {
      try {
        this.socket.onopen = null;
        this.socket.onmessage = null;
        this.socket.onerror = null;
        this.socket.onclose = null;
        this.socket.close();
      } catch {
        // ignore
      }
    }
    this.socket = null;
    this.connected = false;
    this.authorized = false;
    for (const pending of this._pending.values()) {
      pending.reject(new Error("Disconnected"));
    }
    this._pending.clear();
  }

  _connectPort(port) {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(`ws://localhost:${port}/v1`);
      const timeout = window.setTimeout(() => {
        try {
          socket.close();
        } catch {
          // ignore
        }
        reject(new Error(`Timeout on ${port}`));
      }, 1200);

      socket.onopen = () => {
        window.clearTimeout(timeout);
        this.socket = socket;
        this.connected = true;
        socket.onmessage = (event) => this._onSocketMessage(event.data);
        socket.onclose = () => {
          this.connected = false;
          this.authorized = false;
          this.setStatus("Disconnected from Voicemod");
        };
        resolve();
      };

      socket.onerror = () => {
        window.clearTimeout(timeout);
        reject(new Error(`Failed port ${port}`));
      };
    });
  }

  _request(raw, options = {}) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error("Socket not open"));
    }
    const id = createMessageId();
    const message = { ...raw, id };
    const timeoutMs = options.timeoutMs ?? 5000;
    const alsoAcceptActions = options.alsoAcceptActions || [];
    return new Promise((resolve, reject) => {
      this._pending.set(id, {
        resolve,
        reject,
        action: raw.action,
        alsoAcceptActions,
      });
      this.socket.send(JSON.stringify(message));
      window.setTimeout(() => {
        if (this._pending.has(id)) {
          this._pending.delete(id);
          reject(new Error(`Timeout waiting for ${raw.action}`));
        }
      }, timeoutMs);
    });
  }

  _finishPending(message) {
    if (message.id && this._pending.has(message.id)) {
      const pending = this._pending.get(message.id);
      this._pending.delete(message.id);
      pending.resolve(message);
      return;
    }

    const action = message.actionType || message.action;
    if (!action) return;
    for (const [id, pending] of this._pending.entries()) {
      if (
        pending.action === action ||
        pending.alsoAcceptActions?.includes(action)
      ) {
        this._pending.delete(id);
        pending.resolve(message);
        return;
      }
    }
  }

  _failPending(action, error) {
    for (const [id, pending] of [...this._pending.entries()]) {
      if (pending.action === action) {
        this._pending.delete(id);
        pending.reject(error);
      }
    }
  }

  _ingestVoices(message) {
    const voices =
      message?.actionObject?.voices ||
      message?.payload?.voices ||
      message?.voices ||
      [];
    this.voices = Array.isArray(voices) ? voices : [];
    if (message.currentVoice) this.currentVoiceId = message.currentVoice;
    if (message?.actionObject?.currentVoice) {
      this.currentVoiceId = message.actionObject.currentVoice;
    }
  }

  _onSocketMessage(raw) {
    let message;
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }

    const type = message.actionType || message.action;

    if (type === "registerClient") {
      const code = message?.payload?.status?.code;
      if (code === 200) {
        this.authorized = true;
        this._finishPending(message);
      } else {
        this.authorized = false;
        const error = new Error(
          message?.payload?.status?.description || "Unauthorized API key"
        );
        if (message.id && this._pending.has(message.id)) {
          const pending = this._pending.get(message.id);
          this._pending.delete(message.id);
          pending.reject(error);
        } else {
          this._failPending("registerClient", error);
        }
      }
      return;
    }

    if (type === "getVoices") {
      this._ingestVoices(message);
      this._finishPending(message);
      return;
    }

    if (type === "voiceChangedEvent" || type === "loadVoice") {
      const voiceId =
        message?.actionObject?.voiceID ||
        message?.payload?.voiceID ||
        message?.voiceID;
      if (voiceId) this.currentVoiceId = voiceId;
      this._finishPending(message);
      return;
    }

    if (type === "getCurrentVoice") {
      const voiceId = message?.actionObject?.voiceID;
      if (voiceId) this.currentVoiceId = voiceId;
    }

    this._finishPending(message);
  }

  async _register() {
    const response = await this._request({
      action: "registerClient",
      payload: { clientKey: this.apiKey },
    });
    const code = response?.payload?.status?.code;
    if (code && code !== 200) {
      throw new Error(response?.payload?.status?.description || "Unauthorized");
    }
    this.authorized = true;
  }

  async refreshVoices() {
    const response = await this._request({
      action: "getVoices",
      payload: {},
    });
    this._ingestVoices(response);
    return this.voices;
  }

  async getVoiceChangerEnabled() {
    try {
      const response = await this._request({
        action: "getVoiceChangerStatus",
        payload: {},
      });
      const value =
        response?.actionObject?.value ??
        response?.payload?.value ??
        response?.value;
      return Boolean(value);
    } catch {
      return false;
    }
  }

  async ensureVoiceChangerOn() {
    const enabled = await this.getVoiceChangerEnabled();
    if (!enabled) {
      await this._request({
        action: "toggleVoiceChanger",
        payload: {},
      });
    }
  }

  async loadVoice(voiceId) {
    if (!voiceId) return;
    if (!this.authorized) {
      throw new Error("Voicemod is not connected");
    }
    await this.ensureVoiceChangerOn();
    try {
      await this._request(
        {
          action: "loadVoice",
          payload: { voiceID: voiceId },
        },
        { alsoAcceptActions: ["voiceChangedEvent"], timeoutMs: 2500 }
      );
    } catch (error) {
      if (!this.connected) throw error;
    }
    this.currentVoiceId = voiceId;
    const voice = this.voices.find((item) => item.id === voiceId);
    this.setStatus(`Voice: ${voice?.friendlyName || voiceId}`);
  }

  async clearVoice() {
    await this.loadVoice("nofx");
    this.setStatus("Voice cleared (nofx)");
  }
}

export const voicemodClient = new VoicemodClient();
