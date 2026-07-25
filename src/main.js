import { StageRenderer } from "./stage.js";
import {
  loadSceneState,
  saveSceneState,
  cloneSceneState,
  createDefaultSceneState,
  buildActiveActor,
  characterCatalog,
  getCharacterByIndex,
  clampProjectorCorners,
} from "./sceneState.js";
import { voicemodClient } from "./voicemodClient.js";
import { initVoiceLab } from "./voiceLabUi.js";

const channel = new BroadcastChannel("dungeon-stage");

const characterNameElement = document.getElementById("character-name");
const characterListElement = document.getElementById("character-list");
const previewStatus = document.getElementById("preview-status");
const previewCanvas = document.getElementById("preview-canvas");
const previewHandles = document.getElementById("preview-handles");
const cornerControls = document.getElementById("corner-controls");
const actorVoiceSelect = document.getElementById("actor-voice");
const voicemodStatus = document.getElementById("voicemod-status");
const voicemodKeyInput = document.getElementById("voicemod-key");
const stageLinkStatus = document.getElementById("stage-link-status");

const posX = document.getElementById("pos-x");
const posZ = document.getElementById("pos-z");
const posScale = document.getElementById("pos-scale");
const posSpin = document.getElementById("pos-spin");
const posXOut = document.getElementById("pos-x-out");
const posZOut = document.getElementById("pos-z-out");
const posScaleOut = document.getElementById("pos-scale-out");

let state = loadSceneState();
if (!state.voiceLab) {
  state.voiceLab = createDefaultSceneState().voiceLab;
}
let stageWindow = null;
let broadcastTimer = 0;
let autosaveTimer = 0;
let syncToken = 0;
let stageLastSeenAt = 0;
let isDraggingModel = false;
let modelDragPointerId = null;

const voiceLab = initVoiceLab({
  getState: () => state,
  saveState: () => saveSceneState(state),
  getCharacter: () => getCharacterByIndex(state.characterIndex),
});

const previewRenderer = new StageRenderer(previewCanvas, {
  mode: "single",
  testBackdrop: state.testBackdrop,
  showBoxGuide: state.showBoxGuide,
  calibrationGrid: state.calibrationGrid,
  useProjectorWarp: false,
});

function activeActor() {
  return buildActiveActor(state);
}

function setStageLinkStatus(text) {
  if (stageLinkStatus) stageLinkStatus.textContent = text;
}

function broadcastFullState(immediate = false) {
  const send = () => {
    const payload = {
      type: "sync-scene",
      state: cloneSceneState(state),
      at: Date.now(),
    };
    try {
      channel.postMessage(payload);
    } catch (error) {
      console.warn("BroadcastChannel failed", error);
    }
    if (stageWindow && !stageWindow.closed) {
      try {
        stageWindow.postMessage(payload, window.location.origin);
      } catch (error) {
        console.warn("postMessage to Stage failed", error);
      }
    }
    try {
      localStorage.setItem("dungeon-stage-command", JSON.stringify(payload));
    } catch (error) {
      console.warn("localStorage sync failed", error);
    }
  };

  window.clearTimeout(broadcastTimer);
  if (immediate) {
    send();
    return;
  }
  broadcastTimer = window.setTimeout(send, 80);
}

function scheduleAutosave() {
  window.clearTimeout(autosaveTimer);
  autosaveTimer = window.setTimeout(() => {
    saveSceneState(state);
  }, 400);
}

function applyIncomingCorners(corners) {
  state.projector.corners = clampProjectorCorners(corners);
  renderCornerControls();
  applyLocalVisuals();
  scheduleAutosave();
  previewStatus.textContent = "Corners updated from Stage";
}

function handleStageMessage(command) {
  if (!command || !command.type) return;
  if (command.type === "stage-ready") {
    stageLastSeenAt = Date.now();
    setStageLinkStatus("Stage linked · synced");
    broadcastFullState(true);
    return;
  }
  if (command.type === "corners-updated" && command.corners) {
    stageLastSeenAt = Date.now();
    applyIncomingCorners(command.corners);
  }
}

async function applyCurrentVoice(reason = "") {
  const actor = activeActor();
  if (!actor?.voicemodVoiceId) {
    if (reason) {
      voicemodStatus.textContent = `${actor?.name || "Character"} has no voice assigned`;
    }
    return;
  }
  if (!voicemodClient.authorized) {
    voicemodStatus.textContent = "Connect Voicemod first";
    return;
  }
  try {
    await voicemodClient.loadVoice(actor.voicemodVoiceId);
    voicemodStatus.textContent = `Mic → ${
      actor.voicemodVoiceName || actor.voicemodVoiceId
    } (${actor.name})`;
  } catch (error) {
    voicemodStatus.textContent = `Voice failed: ${error.message}`;
  }
}

function renderVoiceOptions() {
  const actor = activeActor();
  const voices = [...voicemodClient.voices].sort((left, right) =>
    String(left.friendlyName || left.id).localeCompare(
      String(right.friendlyName || right.id)
    )
  );

  actorVoiceSelect.innerHTML = "";
  const none = document.createElement("option");
  none.value = "";
  none.textContent = "— none —";
  actorVoiceSelect.appendChild(none);

  const clear = document.createElement("option");
  clear.value = "nofx";
  clear.textContent = "Clean / no FX";
  actorVoiceSelect.appendChild(clear);

  for (const voice of voices) {
    if (!voice.enabled && voice.id !== actor?.voicemodVoiceId) continue;
    const option = document.createElement("option");
    option.value = voice.id;
    option.textContent = voice.friendlyName || voice.id;
    actorVoiceSelect.appendChild(option);
  }

  if (actor?.voicemodVoiceId) {
    const exists = [...actorVoiceSelect.options].some(
      (option) => option.value === actor.voicemodVoiceId
    );
    if (!exists) {
      const option = document.createElement("option");
      option.value = actor.voicemodVoiceId;
      option.textContent =
        actor.voicemodVoiceName || actor.voicemodVoiceId;
      actorVoiceSelect.appendChild(option);
    }
    actorVoiceSelect.value = actor.voicemodVoiceId;
  } else {
    actorVoiceSelect.value = "";
  }
}

function renderCornerControls() {
  const labels = [
    ["topLeft", "Top left"],
    ["topRight", "Top right"],
    ["bottomLeft", "Bottom left"],
    ["bottomRight", "Bottom right"],
  ];
  cornerControls.innerHTML = "";
  for (const [key, label] of labels) {
    const corner = state.projector.corners[key];
    const wrap = document.createElement("div");
    wrap.className = "corner-card";
    wrap.innerHTML = `
      <strong>${label}</strong>
      <label>X <input data-corner="${key}" data-axis="x" type="range" min="0" max="1" step="0.001" value="${corner.x}" /></label>
      <label>Y <input data-corner="${key}" data-axis="y" type="range" min="0" max="1" step="0.001" value="${corner.y}" /></label>
      <span data-readout="${key}">${Math.round(corner.x * 100)}%, ${Math.round(corner.y * 100)}%</span>
    `;
    cornerControls.appendChild(wrap);
  }

  cornerControls.querySelectorAll("input[type=range]").forEach((input) => {
    input.addEventListener("input", () => {
      const cornerKey = input.dataset.corner;
      const axis = input.dataset.axis;
      state.projector.corners[cornerKey][axis] = Number(input.value);
      state.projector.corners = clampProjectorCorners(state.projector.corners);
      const readout = cornerControls.querySelector(
        `[data-readout="${cornerKey}"]`
      );
      const corner = state.projector.corners[cornerKey];
      if (readout) {
        readout.textContent = `${Math.round(corner.x * 100)}%, ${Math.round(
          corner.y * 100
        )}%`;
      }
      applyLocalVisuals();
      broadcastFullState();
      scheduleAutosave();
    });
  });
}

function renderCharacterList() {
  characterListElement.innerHTML = "";
  characterCatalog.forEach((character, index) => {
    const item = document.createElement("li");
    item.textContent = `${index + 1}. ${character.name}`;
    if (index === state.characterIndex) item.classList.add("active");
    item.addEventListener("click", async () => {
      state.characterIndex = index;
      await syncScene();
      await voiceLab.applyForCharacter(
        getCharacterByIndex(state.characterIndex),
        "select"
      );
      if (state.voicemod.autoApplyOnSelect) {
        await applyCurrentVoice("select");
      }
    });
    characterListElement.appendChild(item);
  });
}

function updatePlacementModeUi() {
  const isMove = state.placementMode === "move";
  const moveControls = document.getElementById("move-controls");
  const hint = document.getElementById("placement-hint");
  const previewWrap = document.querySelector(".preview-stage-wrap");
  const warpOn = Boolean(document.getElementById("preview-warp")?.checked);
  moveControls?.classList.toggle("hidden", !isMove);
  previewWrap?.classList.toggle("move-mode", isMove && !warpOn);
  previewWrap?.classList.toggle("dragging-model", isDraggingModel);
  if (hint) {
    hint.textContent = isMove
      ? warpOn
        ? "Turn off Preview projector warp to drag the model on the live preview. Sliders still work."
        : "Drag the model on the live preview (left-click hold). Sliders still work."
      : "Model stays centered on the box. Only size can change.";
  }
  document
    .querySelectorAll('input[name="placement-mode"]')
    .forEach((input) => {
      input.checked = input.value === state.placementMode;
    });
}

function updatePlacementReadouts() {
  posX.value = String(state.placement.x);
  posZ.value = String(state.placement.z);
  posXOut.textContent = Number(state.placement.x).toFixed(2);
  posZOut.textContent = Number(state.placement.z).toFixed(2);
}

async function applyDragPlacement(floorHit) {
  if (!floorHit) return;
  state.placement.x = floorHit.x;
  state.placement.z = floorHit.z;
  updatePlacementReadouts();
  const actor = activeActor();
  if (!actor) return;
  const dragActor = {
    ...actor,
    x: floorHit.x,
    z: floorHit.z,
    spin: false,
  };
  if (!previewRenderer.setActorTransform(dragActor)) {
    await previewRenderer.syncActors([dragActor]);
  }
  broadcastFullState();
  scheduleAutosave();
}

function bindModelDrag() {
  const previewWrap = document.querySelector(".preview-stage-wrap");
  if (!previewWrap) return;

  const canDrag = () =>
    state.placementMode === "move" &&
    !document.getElementById("preview-warp")?.checked;

  previewWrap.addEventListener("pointerdown", async (event) => {
    if (event.button !== 0 || !canDrag() || isDraggingModel) return;
    if (event.target.closest?.(".corner-handle")) return;

    const actor = activeActor();
    if (!actor) return;

    const floor = previewRenderer.beginModelDrag(
      event.clientX,
      event.clientY,
      actor.id,
      { x: actor.x, z: actor.z }
    );
    if (!floor) return;

    event.preventDefault();
    isDraggingModel = true;
    modelDragPointerId = event.pointerId;
    previewWrap.setPointerCapture(event.pointerId);
    updatePlacementModeUi();
    previewStatus.textContent = `Dragging ${actor.name}…`;
    await applyDragPlacement(floor);
  });

  previewWrap.addEventListener("pointermove", async (event) => {
    if (!isDraggingModel || event.pointerId !== modelDragPointerId) {
      if (!canDrag() || isDraggingModel) {
        previewWrap.classList.remove("over-model");
        return;
      }
      const actor = activeActor();
      if (!actor) {
        previewWrap.classList.remove("over-model");
        return;
      }
      let overModel = previewRenderer.hitActor(
        event.clientX,
        event.clientY,
        actor.id
      );
      if (!overModel) {
        const floor = previewRenderer.hitBoxFloor(event.clientX, event.clientY);
        if (floor) {
          overModel =
            Math.hypot(floor.x - actor.x, floor.z - actor.z) <= 0.55;
        }
      }
      previewWrap.classList.toggle("over-model", overModel);
      return;
    }

    const floor = previewRenderer.hitBoxFloor(event.clientX, event.clientY);
    if (!floor) return;
    await applyDragPlacement(floor);
  });

  const endDrag = async (event) => {
    if (!isDraggingModel || event.pointerId !== modelDragPointerId) return;
    isDraggingModel = false;
    modelDragPointerId = null;
    try {
      previewWrap.releasePointerCapture(event.pointerId);
    } catch {
      // already released
    }
    updatePlacementModeUi();
    await syncScene({ immediate: true });
    previewStatus.textContent = `${activeActor()?.name || "Model"} placed`;
  };

  previewWrap.addEventListener("pointerup", endDrag);
  previewWrap.addEventListener("pointercancel", endDrag);
}

function renderPlacementControls() {
  const character = getCharacterByIndex(state.characterIndex);
  characterNameElement.textContent = character
    ? `${character.index + 1}. ${character.name}`
    : "—";
  if (state.placementMode !== "move") {
    state.placement.x = 0;
    state.placement.z = 0;
  }
  posX.value = String(state.placement.x);
  posZ.value = String(state.placement.z);
  posScale.value = String(state.placement.scale);
  posSpin.checked = state.placement.spin !== false;
  posXOut.textContent = Number(state.placement.x).toFixed(2);
  posZOut.textContent = Number(state.placement.z).toFixed(2);
  posScaleOut.textContent = Number(state.placement.scale).toFixed(2);
  updatePlacementModeUi();
  renderVoiceOptions();
  renderCharacterList();
  voiceLab.updateAssignedLabel();
}

function renderHandles(container, interactive) {
  container.innerHTML = "";
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
    const corner = state.projector.corners[key];
    handle.style.left = `${corner.x * 100}%`;
    handle.style.top = `${corner.y * 100}%`;
    container.appendChild(handle);
    if (!interactive) continue;

    handle.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      handle.setPointerCapture(event.pointerId);
      const bounds = container.getBoundingClientRect();
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
        applyLocalVisuals();
        broadcastFullState();
        scheduleAutosave();
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
        renderCornerControls();
        broadcastFullState(true);
        scheduleAutosave();
      };
      handle.addEventListener("pointermove", move);
      handle.addEventListener("pointerup", up);
      handle.addEventListener("pointercancel", up);
    });
  }
}

function applyLocalVisuals() {
  previewRenderer.applySceneState({
    ...state,
    mode: "single",
  });
  const warpChecked = document.getElementById("preview-warp")?.checked;
  previewRenderer.setUseProjectorWarp(Boolean(warpChecked));
  previewHandles.classList.toggle("hidden", !warpChecked);
  if (warpChecked) renderHandles(previewHandles, true);
  updatePlacementModeUi();
}

async function syncScene(options = {}) {
  const token = ++syncToken;
  const immediate = Boolean(options.immediate);
  previewStatus.textContent = "Updating…";
  applyLocalVisuals();
  const actor = activeActor();
  const results = await previewRenderer.syncActors(actor ? [actor] : []);
  if (token !== syncToken) return;
  const ok = results[0]?.ok;
  previewStatus.textContent = ok
    ? `${actor.name} on box (${results[0].source})`
    : results[0]?.error || "Failed";
  renderPlacementControls();
  broadcastFullState(immediate);
  scheduleAutosave();
}

async function setCharacterIndex(index) {
  state.characterIndex = index;
  await syncScene({ immediate: true });
  await voiceLab.applyForCharacter(
    getCharacterByIndex(state.characterIndex),
    "select"
  );
  if (state.voicemod.autoApplyOnSelect) {
    await applyCurrentVoice("select");
  }
}

function bindPlacementControls() {
  const update = async (field, value) => {
    state.placement[field] = value;
    if (field === "x") posXOut.textContent = value.toFixed(2);
    if (field === "z") posZOut.textContent = value.toFixed(2);
    if (field === "scale") posScaleOut.textContent = value.toFixed(2);
    await syncScene();
  };
  posX.addEventListener("input", () => update("x", Number(posX.value)));
  posZ.addEventListener("input", () => update("z", Number(posZ.value)));
  posScale.addEventListener("input", () =>
    update("scale", Number(posScale.value))
  );
  posSpin.addEventListener("change", () => update("spin", posSpin.checked));
}

function openStageWindow() {
  if (stageWindow && !stageWindow.closed) {
    stageWindow.focus();
    broadcastFullState(true);
    setStageLinkStatus("Stage focused · resync sent");
    return;
  }

  stageWindow = window.open(
    "/stage.html",
    "dungeon-stage",
    "popup=yes,width=1280,height=720"
  );

  if (!stageWindow) {
    setStageLinkStatus("Popup blocked — allow popups for this site");
    previewStatus.textContent = "Allow popups, then Open Stage again";
    return;
  }

  setStageLinkStatus("Stage opening… waiting for link");
  const retries = [200, 500, 1000, 2000, 3500];
  for (const delay of retries) {
    window.setTimeout(() => broadcastFullState(true), delay);
  }
}

function enableProjectorTrialMode() {
  state.testBackdrop = false;
  state.showBoxGuide = false;
  state.calibrationGrid = false;
  document.getElementById("test-backdrop").checked = false;
  document.getElementById("show-box-guide").checked = false;
  document.getElementById("calibration-grid").checked = false;
  syncScene({ immediate: true });
  previewStatus.textContent = "Projector trial mode · black outside mapped box";
}

channel.addEventListener("message", (event) => {
  handleStageMessage(event.data);
});

window.addEventListener("message", (event) => {
  if (event.origin !== window.location.origin) return;
  handleStageMessage(event.data);
});

window.addEventListener("storage", (event) => {
  if (event.key !== "dungeon-stage-command" || !event.newValue) return;
  try {
    handleStageMessage(JSON.parse(event.newValue));
  } catch {
    // ignore
  }
});

document.getElementById("open-stage").addEventListener("click", () => {
  openStageWindow();
});

document.getElementById("resync-stage")?.addEventListener("click", () => {
  broadcastFullState(true);
  setStageLinkStatus(
    stageLastSeenAt
      ? `Resync sent · last link ${Math.round((Date.now() - stageLastSeenAt) / 1000)}s ago`
      : "Resync sent · Stage not linked yet"
  );
  previewStatus.textContent = "Resync sent to Stage";
});

document.getElementById("projector-ready")?.addEventListener("click", () => {
  enableProjectorTrialMode();
  broadcastFullState(true);
});

document.getElementById("save-scene").addEventListener("click", () => {
  saveSceneState(state);
  previewStatus.textContent = "Saved";
});

document.getElementById("reset-corners").addEventListener("click", async () => {
  state.projector.corners = createDefaultSceneState().projector.corners;
  renderCornerControls();
  await syncScene({ immediate: true });
});

document.querySelectorAll('input[name="placement-mode"]').forEach((input) => {
  input.addEventListener("change", async (event) => {
    state.placementMode = event.target.value === "move" ? "move" : "fit";
    if (state.placementMode === "fit") {
      state.placement.x = 0;
      state.placement.z = 0;
    }
    await syncScene({ immediate: true });
    previewStatus.textContent =
      state.placementMode === "fit"
        ? "Fit to box · centered"
        : "Move model · free place";
  });
});

document
  .getElementById("reset-placement")
  .addEventListener("click", async () => {
    const defaults = createDefaultSceneState().placement;
    state.placement = {
      ...defaults,
      x: state.placementMode === "fit" ? 0 : defaults.x,
      z: state.placementMode === "fit" ? 0 : defaults.z,
      scale: defaults.scale,
      spin: defaults.spin,
    };
    await syncScene({ immediate: true });
  });

document.getElementById("prev").addEventListener("click", async () => {
  const nextIndex =
    (state.characterIndex - 1 + characterCatalog.length) %
    characterCatalog.length;
  await setCharacterIndex(nextIndex);
});

document.getElementById("next").addEventListener("click", async () => {
  const nextIndex = (state.characterIndex + 1) % characterCatalog.length;
  await setCharacterIndex(nextIndex);
});

document
  .getElementById("test-backdrop")
  .addEventListener("change", async (event) => {
    state.testBackdrop = event.target.checked;
    await syncScene({ immediate: true });
  });
document
  .getElementById("show-box-guide")
  .addEventListener("change", async (event) => {
    state.showBoxGuide = event.target.checked;
    await syncScene({ immediate: true });
  });
document
  .getElementById("calibration-grid")
  .addEventListener("change", async (event) => {
    state.calibrationGrid = event.target.checked;
    await syncScene({ immediate: true });
  });
document.getElementById("preview-warp").addEventListener("change", async () => {
  await syncScene();
});

voicemodKeyInput.value = state.voicemod.apiKey || "";
document.getElementById("voicemod-on-select").checked = Boolean(
  state.voicemod.autoApplyOnSelect
);

voicemodKeyInput.addEventListener("change", () => {
  state.voicemod.apiKey = voicemodKeyInput.value.trim();
  saveSceneState(state);
});

document
  .getElementById("voicemod-on-select")
  .addEventListener("change", (event) => {
    state.voicemod.autoApplyOnSelect = event.target.checked;
    saveSceneState(state);
  });

document
  .getElementById("voicemod-connect")
  .addEventListener("click", async () => {
    state.voicemod.apiKey = voicemodKeyInput.value.trim();
    saveSceneState(state);
    try {
      await voicemodClient.connect(state.voicemod.apiKey);
      renderVoiceOptions();
      if (state.voicemod.autoApplyOnSelect) {
        await applyCurrentVoice("connect");
      }
    } catch (error) {
      voicemodStatus.textContent = error.message;
    }
  });

document
  .getElementById("voicemod-refresh")
  .addEventListener("click", async () => {
    try {
      await voicemodClient.refreshVoices();
      renderVoiceOptions();
      voicemodStatus.textContent = `Refreshed · ${voicemodClient.voices.length} voices`;
    } catch (error) {
      voicemodStatus.textContent = error.message;
    }
  });

actorVoiceSelect.addEventListener("change", async () => {
  const character = getCharacterByIndex(state.characterIndex);
  if (!character) return;
  const voiceId = actorVoiceSelect.value;
  const voice = voicemodClient.voices.find((item) => item.id === voiceId);
  const existing = state.voicesByCharacterId[character.id] || {};
  state.voicesByCharacterId[character.id] = {
    ...existing,
    voicemodVoiceId: voiceId,
    voicemodVoiceName:
      voice?.friendlyName || (voiceId === "nofx" ? "Clean / no FX" : voiceId),
  };
  saveSceneState(state);
  renderCharacterList();
  if (voiceId && state.voicemod.autoApplyOnSelect) {
    await applyCurrentVoice("assign");
  }
});

document.getElementById("apply-voice").addEventListener("click", async () => {
  await applyCurrentVoice("manual");
});

document.getElementById("clear-voice").addEventListener("click", async () => {
  try {
    await voicemodClient.clearVoice();
  } catch (error) {
    voicemodStatus.textContent = error.message;
  }
});

voicemodClient.onStatusChange = (text) => {
  voicemodStatus.textContent = text;
};

window.addEventListener("beforeunload", () => {
  saveSceneState(state);
});

document.getElementById("test-backdrop").checked = state.testBackdrop;
document.getElementById("show-box-guide").checked = state.showBoxGuide;
document.getElementById("calibration-grid").checked = state.calibrationGrid;
setStageLinkStatus("Stage not linked yet");

bindPlacementControls();
bindModelDrag();
renderCornerControls();
syncScene({ immediate: true }).then(() => {
  voiceLab.applyForCharacter(
    getCharacterByIndex(state.characterIndex),
    "init"
  );
});
