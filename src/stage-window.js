import { StageRenderer } from "./stage.js";
import {
  loadSceneState,
  saveSceneState,
  createDefaultSceneState,
  buildActiveActor,
  clampProjectorCorners,
} from "./sceneState.js";

const canvas = document.getElementById("stage-canvas");
const statusElement = document.getElementById("status");
const handlesElement = document.getElementById("stage-handles");
const channel = new BroadcastChannel("dungeon-stage");

let state = loadSceneState();
// Projector output starts black outside the mapped quad.
state.testBackdrop = false;

const renderer = new StageRenderer(canvas, {
  mode: "single",
  testBackdrop: false,
  showBoxGuide: Boolean(state.showBoxGuide),
  calibrationGrid: Boolean(state.calibrationGrid),
  useProjectorWarp: true,
});

let applyToken = 0;
let handlesVisible = true;
let statusHideTimer = 0;
let cornerSaveTimer = 0;

function setStatus(text, autoHideMs = 0) {
  statusElement.textContent = text;
  statusElement.style.opacity = "0.9";
  window.clearTimeout(statusHideTimer);
  if (autoHideMs > 0) {
    statusHideTimer = window.setTimeout(() => {
      statusElement.style.opacity = "0";
    }, autoHideMs);
  }
}

function announceReady() {
  const payload = {
    type: "stage-ready",
    at: Date.now(),
  };
  channel.postMessage(payload);
  if (window.opener && !window.opener.closed) {
    try {
      window.opener.postMessage(payload, window.location.origin);
    } catch {
      // ignore
    }
  }
}

function persistCornersLocally() {
  try {
    const stored = loadSceneState();
    stored.projector.corners = clampProjectorCorners(state.projector.corners);
    stored.testBackdrop = false;
    saveSceneState(stored);
  } catch (error) {
    console.warn("Could not save corners locally", error);
  }
}

function broadcastCornerUpdate() {
  const payload = {
    type: "corners-updated",
    corners: clampProjectorCorners(state.projector.corners),
    at: Date.now(),
  };
  channel.postMessage(payload);
  if (window.opener && !window.opener.closed) {
    try {
      window.opener.postMessage(payload, window.location.origin);
    } catch {
      // ignore
    }
  }
  localStorage.setItem("dungeon-stage-command", JSON.stringify(payload));
}

function scheduleCornerPersist() {
  window.clearTimeout(cornerSaveTimer);
  cornerSaveTimer = window.setTimeout(() => {
    persistCornersLocally();
    broadcastCornerUpdate();
  }, 200);
}

function renderHandles() {
  handlesElement.innerHTML = "";
  handlesElement.classList.toggle("hidden", !handlesVisible);
  document.body.classList.toggle("calibrating", handlesVisible);

  const entries = [
    ["topLeft", "TL"],
    ["topRight", "TR"],
    ["bottomRight", "BR"],
    ["bottomLeft", "BL"],
  ];

  for (const [key, label] of entries) {
    const handle = document.createElement("div");
    handle.className = "corner-handle";
    handle.textContent = label;
    handle.title = `${label} — drag onto box corner`;
    const corner = state.projector.corners[key];
    handle.style.left = `${corner.x * 100}%`;
    handle.style.top = `${corner.y * 100}%`;
    handlesElement.appendChild(handle);

    handle.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      handle.setPointerCapture(event.pointerId);
      const bounds = handlesElement.getBoundingClientRect();
      if (bounds.width < 1 || bounds.height < 1) return;

      const move = (moveEvent) => {
        const x = (moveEvent.clientX - bounds.left) / bounds.width;
        const y = (moveEvent.clientY - bounds.top) / bounds.height;
        state.projector.corners[key] = {
          x: Math.min(1, Math.max(0, x)),
          y: Math.min(1, Math.max(0, y)),
        };
        state.projector.corners = clampProjectorCorners(state.projector.corners);
        handle.style.left = `${state.projector.corners[key].x * 100}%`;
        handle.style.top = `${state.projector.corners[key].y * 100}%`;
        renderer.setProjectorCorners(state.projector.corners);
        scheduleCornerPersist();
      };

      const up = () => {
        try {
          handle.releasePointerCapture(event.pointerId);
        } catch {
          // already released
        }
        handle.removeEventListener("pointermove", move);
        handle.removeEventListener("pointerup", up);
        handle.removeEventListener("pointercancel", up);
        persistCornersLocally();
        broadcastCornerUpdate();
        setStatus("Corners saved · H hide · F11 fullscreen", 2500);
      };

      handle.addEventListener("pointermove", move);
      handle.addEventListener("pointerup", up);
      handle.addEventListener("pointercancel", up);
    });
  }
}

async function applyScene(nextState) {
  const token = ++applyToken;
  const merged = {
    ...createDefaultSceneState(),
    ...nextState,
    placement: {
      ...createDefaultSceneState().placement,
      ...(nextState?.placement || {}),
    },
    projector: {
      ...createDefaultSceneState().projector,
      ...(nextState?.projector || {}),
      corners: clampProjectorCorners(
        nextState?.projector?.corners || state.projector.corners
      ),
    },
  };

  // Stage stays black outside the warp unless Control explicitly wants backdrop.
  if (typeof nextState?.testBackdrop !== "boolean") {
    merged.testBackdrop = false;
  }

  state = merged;
  renderer.applySceneState({ ...state, mode: "single" });
  renderer.setUseProjectorWarp(true);

  const actor = buildActiveActor(state);
  const results = await renderer.syncActors(actor ? [actor] : []);
  if (token !== applyToken) return;

  const result = results[0];
  if (result && !result.ok) {
    setStatus(`Load failed: ${result.error || "unknown"}`);
  } else {
    setStatus(
      `${actor?.name || "Empty"} · drag corners onto box · H hide · F11 fullscreen`,
      4000
    );
  }
  renderHandles();
}

async function applyCommand(command) {
  if (!command || !command.type) return;
  try {
    if (command.type === "sync-scene" && command.state) {
      await applyScene(command.state);
      return;
    }
    if (command.type === "request-status") {
      announceReady();
      return;
    }
    if (command.type === "set-handles") {
      handlesVisible = command.visible !== false;
      renderHandles();
      return;
    }
  } catch (error) {
    console.warn("Stage command failed", error);
    setStatus(`Stage error: ${error.message || "unknown"}`);
  }
}

window.addEventListener("message", (event) => {
  if (event.origin !== window.location.origin) return;
  applyCommand(event.data);
});

channel.addEventListener("message", (event) => {
  applyCommand(event.data);
});

window.addEventListener("storage", (event) => {
  if (event.key !== "dungeon-stage-command" || !event.newValue) return;
  try {
    applyCommand(JSON.parse(event.newValue));
  } catch {
    // ignore
  }
});

window.addEventListener("keydown", async (event) => {
  const key = event.key.toLowerCase();
  if (key === "h") {
    handlesVisible = !handlesVisible;
    renderHandles();
    setStatus(handlesVisible ? "Handles visible" : "Handles hidden", 1800);
  }
  if (key === "g") {
    state.calibrationGrid = !state.calibrationGrid;
    renderer.setCalibrationGrid(state.calibrationGrid);
    setStatus(
      state.calibrationGrid ? "Calibration grid on" : "Calibration grid off",
      1800
    );
  }
  if (key === "b") {
    state.showBoxGuide = !state.showBoxGuide;
    renderer.setShowBoxGuide(state.showBoxGuide);
    setStatus(state.showBoxGuide ? "Box guide on" : "Box guide off", 1800);
  }
  if (key === "f" && !event.repeat) {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
        setStatus("Fullscreen", 1500);
      } else {
        await document.exitFullscreen();
        setStatus("Exited fullscreen", 1500);
      }
    } catch (error) {
      setStatus("Fullscreen blocked — use F11", 2500);
    }
  }
  if (key === "r") {
    announceReady();
    setStatus("Asked Control to resync…", 2000);
  }
});

window.addEventListener("resize", () => {
  renderer.resize();
});

window.addEventListener("beforeunload", () => {
  persistCornersLocally();
});

const startup = loadSceneState();
startup.testBackdrop = false;
applyScene(startup)
  .catch(() => applyScene(createDefaultSceneState()))
  .finally(() => {
    announceReady();
    window.setTimeout(announceReady, 300);
    window.setTimeout(announceReady, 1000);
  });
