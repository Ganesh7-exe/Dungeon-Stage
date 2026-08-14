import { StageRenderer } from "./stage.js";
import {
  loadSceneState,
  saveSceneState,
  patchSceneState,
  createDefaultSceneState,
  buildActorsForSync,
  clampProjectorCorners,
} from "./sceneState.js";
import { normalizeBattleMapState } from "./battleMaps.js";
import { normalizeCharacterStageState } from "./characterStage.js";
import {
  FACE_LABELS,
  areFaceCornersHealthy,
  clampFaceCorner,
  createDefaultFaceCorners,
  getProjectorById,
  normalizeVenueState,
  repairProjectorFaceCorners,
  resetFaceCornersToFullFrame,
} from "./venueGeometry.js";
import {
  listProjectorOutputDisplays,
  openProjectorOutputWindow,
} from "./displayOutput.js";

const channel = new BroadcastChannel("dungeon-stage");

const outputCanvas = document.getElementById("output-canvas");
const sceneCanvas = document.getElementById("scene-canvas");
const handlesElement = document.getElementById("output-handles");
const statusElement = document.getElementById("status");
const boxSizeLabel = document.getElementById("box-size-label");
const boxWidthInput = document.getElementById("box-width-cm");
const boxDepthInput = document.getElementById("box-depth-cm");
const boxHeightInput = document.getElementById("box-height-cm");
const btnFitCorners = document.getElementById("btn-fit-corners");
const btnResync = document.getElementById("btn-resync");
const btnOpenOutput = document.getElementById("btn-open-output");
const btnOpenOutputStep = document.getElementById("btn-open-output-step");
const outputDisplaySelect = document.getElementById("output-display-select");
const outputFullscreenToggle = document.getElementById("output-fullscreen");
const btnRefreshDisplays = document.getElementById("btn-refresh-displays");

const urlProjectorId =
  new URLSearchParams(window.location.search).get("projector") || "";

let state = loadSceneState();
state.testBackdrop = false;
state.venue = repairProjectorCalibration(state.venue || {});
if (urlProjectorId) {
  state.venue.activeProjectorId = urlProjectorId;
}
/** Lamp aim helpers removed — always off. */
state.venue.showFrustumHelpers = false;

/** Left: warped projector feed + corner handles. */
const outputRenderer = new StageRenderer(outputCanvas, {
  mode: "single",
  testBackdrop: false,
  showBoxGuide: Boolean(state.showBoxGuide),
  calibrationGrid: Boolean(state.calibrationGrid),
  useProjectorWarp: true,
  focusCalibrationFace: true,
});

/** Right: box surface reference (orbit only by default). */
const sceneRenderer = new StageRenderer(sceneCanvas, {
  mode: "single",
  testBackdrop: true,
  showBoxGuide: true,
  calibrationGrid: false,
  useProjectorWarp: false,
});

let applyToken = 0;
let handlesVisible = true;
let statusHideTimer = 0;
let cornerSaveTimer = 0;
let outputWindow = null;

function setStatus(text, autoHideMs = 0) {
  statusElement.textContent = text;
  window.clearTimeout(statusHideTimer);
  if (autoHideMs > 0) {
    statusHideTimer = window.setTimeout(() => {
      statusElement.textContent = "Ready — look at the real box and drag corners";
    }, autoHideMs);
  }
}

function refreshBoxSizeLabel() {
  const box = state.venue?.box || {};
  const widthCm = Math.round(box.widthCm ?? 0);
  const depthCm = Math.round(box.depthCm ?? 0);
  const heightCm = Math.round(box.heightCm ?? 0);
  if (boxSizeLabel) {
    boxSizeLabel.textContent = `${widthCm} × ${depthCm} × ${heightCm} cm (W × D × H)`;
  }
  if (boxWidthInput && document.activeElement !== boxWidthInput) {
    boxWidthInput.value = String(widthCm);
  }
  if (boxDepthInput && document.activeElement !== boxDepthInput) {
    boxDepthInput.value = String(depthCm);
  }
  if (boxHeightInput && document.activeElement !== boxHeightInput) {
    boxHeightInput.value = String(heightCm);
  }
}

function commitBoxSizeFromInputs() {
  if (!state.venue?.box) return;
  const widthCm = Number(boxWidthInput?.value);
  const depthCm = Number(boxDepthInput?.value);
  const heightCm = Number(boxHeightInput?.value);
  if (Number.isFinite(widthCm)) {
    state.venue.box.widthCm = Math.min(2000, Math.max(10, widthCm));
  }
  if (Number.isFinite(depthCm)) {
    state.venue.box.depthCm = Math.min(2000, Math.max(10, depthCm));
  }
  if (Number.isFinite(heightCm)) {
    state.venue.box.heightCm = Math.min(2000, Math.max(0, heightCm));
  }
  state.venue = normalizeVenueState(state.venue);
  applyVenueToRenderers();
  persistVenueLocally();
  broadcastVenueUpdate();
  refreshBoxSizeLabel();
  setStatus(
    `Box set to ${Math.round(state.venue.box.widthCm)} × ${Math.round(state.venue.box.depthCm)} × ${Math.round(state.venue.box.heightCm)} cm`,
    2200
  );
}

function announceReady() {
  const payload = { type: "stage-ready", at: Date.now(), mappingStudio: true };
  channel.postMessage(payload);
  if (window.opener && !window.opener.closed) {
    try {
      window.opener.postMessage(payload, window.location.origin);
    } catch {
      // ignore
    }
  }
}

function activeProjectorId() {
  return state.venue.activeProjectorId;
}

function persistVenueLocally() {
  try {
    // Patch venue only — never clobber Home's selected battle map / roster.
    state.venue = normalizeVenueState(state.venue);
    state.testBackdrop = false;
    patchSceneState({
      venue: state.venue,
      testBackdrop: false,
    });
  } catch (error) {
    console.warn("Could not save venue calibration locally", error);
  }
}

function broadcastVenueUpdate() {
  const payload = {
    type: "venue-updated",
    venue: normalizeVenueState(state.venue),
    projectorId: state.venue.activeProjectorId,
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

function persistCornersLocally() {
  try {
    // Patch keystone only — full saves were overwriting Home's map selection.
    state.projector.corners = clampProjectorCorners(state.projector.corners);
    state.testBackdrop = false;
    patchSceneState({
      projector: {
        ...state.projector,
        corners: state.projector.corners,
      },
      testBackdrop: false,
    });
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
    if (state.venue?.enabled) {
      persistVenueLocally();
      broadcastVenueUpdate();
      return;
    }
    persistCornersLocally();
    broadcastCornerUpdate();
  }, 200);
}

const CORNER_ENTRIES = [
  ["topLeft", "TL"],
  ["topRight", "TR"],
  ["bottomRight", "BR"],
  ["bottomLeft", "BL"],
];

const FACE_HANDLE_COLORS = {
  top: "#d4a017",
  front: "#3fb6c8",
  right: "#6fcf5f",
  back: "#d072d0",
  left: "#e08a3c",
};

function appendCornerHandle({ label, title, color, corner, onMove, onCommit }) {
  const handle = document.createElement("div");
  handle.className = "corner-handle";
  handle.textContent = label;
  handle.title = title;
  handle.style.left = `${corner.x * 100}%`;
  handle.style.top = `${corner.y * 100}%`;
  if (corner.x < 0 || corner.x > 1 || corner.y < 0 || corner.y > 1) {
    handle.classList.add("outside-frame");
  }
  if (color) {
    handle.style.borderColor = color;
    handle.style.color = color;
  }
  handlesElement.appendChild(handle);

  handle.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    handle.setPointerCapture(event.pointerId);
    const bounds = handlesElement.getBoundingClientRect();
    if (bounds.width < 1 || bounds.height < 1) return;

    const move = (moveEvent) => {
      const nextCorner = clampFaceCorner({
        x: (moveEvent.clientX - bounds.left) / bounds.width,
        y: (moveEvent.clientY - bounds.top) / bounds.height,
      });
      const applied = onMove(nextCorner);
      handle.style.left = `${applied.x * 100}%`;
      handle.style.top = `${applied.y * 100}%`;
      handle.classList.toggle(
        "outside-frame",
        applied.x < 0 ||
          applied.x > 1 ||
          applied.y < 0 ||
          applied.y > 1
      );
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
      onCommit();
    };

    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", up);
  });
}

function renderVenueHandles() {
  const projector = getProjectorById(state.venue, state.venue.activeProjectorId);
  if (!projector) return false;

  const faceId =
    projector.faceIds.includes(state.venue.calibrationFaceId)
      ? state.venue.calibrationFaceId
      : projector.faceIds[0];
  if (!faceId) return false;

  // Ensure corners exist when the face was just enabled.
  if (!projector.faceCorners[faceId]) {
    projector.faceCorners[faceId] = createDefaultFaceCorners(faceId);
  }

  const corners = projector.faceCorners[faceId];
  const faceLabel = FACE_LABELS[faceId] || faceId;
  for (const [cornerKey, cornerLabel] of CORNER_ENTRIES) {
    appendCornerHandle({
      label: cornerLabel,
      title: `${faceLabel} · ${cornerLabel} — drag in or past the frame edge to stretch onto the real box`,
      color: FACE_HANDLE_COLORS[faceId],
      corner: corners[cornerKey],
      onMove: (nextCorner) => {
        const applied = { x: nextCorner.x, y: nextCorner.y };
        corners[cornerKey] = applied;
        // setVenueState() clones state — mutate both live copies so the
        // warped output moves with the handle (this was why TL/TR felt broken).
        for (const renderer of [outputRenderer, sceneRenderer]) {
          const liveProjector = getProjectorById(
            renderer.venueState,
            state.venue.activeProjectorId
          );
          if (!liveProjector) continue;
          if (!liveProjector.faceCorners[faceId]) {
            liveProjector.faceCorners[faceId] = createDefaultFaceCorners(faceId);
          }
          liveProjector.faceCorners[faceId][cornerKey] = { ...applied };
          renderer.venueState.calibrationFaceId = faceId;
        }
        scheduleCornerPersist();
        return applied;
      },
      onCommit: () => {
        state.venue = normalizeVenueState(state.venue);
        applyVenueToRenderers();
        persistVenueLocally();
        broadcastVenueUpdate();
        renderHandles();
        setStatus(`${faceLabel} face calibration saved`, 2500);
      },
    });
  }
  return true;
}

function renderLegacyHandles() {
  for (const [cornerKey, cornerLabel] of CORNER_ENTRIES) {
    appendCornerHandle({
      label: cornerLabel,
      title: `${cornerLabel} — drag onto box corner`,
      color: FACE_HANDLE_COLORS.top,
      corner: state.projector.corners[cornerKey],
      onMove: (nextCorner) => {
        state.projector.corners[cornerKey] = nextCorner;
        state.projector.corners = clampProjectorCorners(state.projector.corners);
        outputRenderer.setProjectorCorners(state.projector.corners);
        scheduleCornerPersist();
        return state.projector.corners[cornerKey];
      },
      onCommit: () => {
        persistCornersLocally();
        broadcastCornerUpdate();
        setStatus("Corners saved", 2500);
      },
    });
  }
}

function renderHandles() {
  handlesElement.innerHTML = "";
  handlesElement.classList.toggle("hidden", !handlesVisible);
  if (!handlesVisible) return;
  if (state.venue?.enabled && renderVenueHandles()) return;
  renderLegacyHandles();
}

function repairProjectorCalibration(venue) {
  const next = normalizeVenueState(venue);
  next.enabled = true;
  next.showFrustumHelpers = false;
  next.showFaceOutlines = true;
  for (const projector of next.projectors) {
    // Legacy broken grazing "camera" → TD projector throw.
    if (projector.projectionMode === "camera") {
      projector.projectionMode = "projector";
    }
    if (
      projector.projectionMode !== "anamorphic" &&
      projector.projectionMode !== "mapping" &&
      projector.projectionMode !== "projector"
    ) {
      projector.projectionMode = "projector";
    }
    if (!projector.faceIds?.length) projector.faceIds = ["top"];
    for (const faceId of projector.faceIds) {
      if (!areFaceCornersHealthy(projector.faceCorners?.[faceId])) {
        projector.faceCorners[faceId] = resetFaceCornersToFullFrame(faceId);
      }
    }
  }
  return normalizeVenueState(next);
}

function applyVenueToRenderers() {
  state.venue = normalizeVenueState(state.venue);
  state.venue.enabled = true;
  state.venue.showFrustumHelpers = false;
  state.venue.showFaceOutlines = true;
  outputRenderer.setVenueState(state.venue);
  sceneRenderer.setVenueState(state.venue);
  refreshBoxSizeLabel();
}

async function applyScene(nextState, options = {}) {
  const token = ++applyToken;
  const persist = options.persist !== false;
  const defaults = createDefaultSceneState();
  const merged = {
    ...defaults,
    ...nextState,
    placement: {
      ...defaults.placement,
      ...(nextState?.placement || {}),
    },
    actorsOnMap: Array.isArray(nextState?.actorsOnMap)
      ? nextState.actorsOnMap
      : defaults.actorsOnMap,
    selectedInstanceIds: Array.isArray(nextState?.selectedInstanceIds)
      ? nextState.selectedInstanceIds
      : [],
    battleMap: normalizeBattleMapState({
      ...defaults.battleMap,
      ...(nextState?.battleMap || {}),
    }),
    characterStage: normalizeCharacterStageState({
      ...defaults.characterStage,
      ...(nextState?.characterStage || {}),
    }),
    projector: {
      ...defaults.projector,
      ...(nextState?.projector || {}),
      corners: clampProjectorCorners(
        nextState?.projector?.corners || state.projector.corners
      ),
    },
    venue: normalizeVenueState(nextState?.venue || state.venue),
  };

  merged.venue = repairProjectorCalibration(merged.venue);
  if (urlProjectorId) {
    merged.venue.activeProjectorId = urlProjectorId;
  }
  merged.venue.showFrustumHelpers = false;

  if (typeof nextState?.testBackdrop !== "boolean") {
    merged.testBackdrop = false;
  }

  state = merged;
  refreshBoxSizeLabel();

  const visualState = { ...state, mode: "single" };
  await outputRenderer.applySceneState(visualState);
  if (token !== applyToken) return;
  outputRenderer.setUseProjectorWarp(true);
  outputRenderer.setTestBackdrop(false);

  await sceneRenderer.applySceneState({
    ...visualState,
    testBackdrop: true,
    showBoxGuide: true,
  });
  if (token !== applyToken) return;
  sceneRenderer.setUseProjectorWarp(false);
  sceneRenderer.setVenueState(state.venue);

  const actors = buildActorsForSync(state);
  await Promise.all([
    outputRenderer.syncActors(actors),
    sceneRenderer.syncActors(actors),
  ]);
  if (token !== applyToken) return;

  outputRenderer.setSelectedActorIds([]);
  sceneRenderer.setSelectedActorIds(state.selectedInstanceIds || []);
  renderHandles();
  refreshBoxSizeLabel();
  syncOutputDisplayControlsFromVenue();

  const projector = getProjectorById(state.venue, state.venue.activeProjectorId);
  const mapLabel = state.battleMap?.enabled ? state.battleMap.mapId : "no map";
  setStatus(
    projector
      ? `${projector.label} · ${mapLabel} — Open on projector, then drag corners`
      : `Ready · ${mapLabel} — Open on projector, then drag corners`,
    3500
  );
  // Persist only after Control sync — boot from LS must not rewrite Home's map.
  if (persist) {
    try {
      saveSceneState(state);
    } catch {
      // ignore
    }
  }
}

async function applyCommand(command) {
  if (!command || !command.type) return;
  try {
    if (command.type === "sync-scene" && command.state) {
      await applyScene(command.state);
      return;
    }
    if (command.type === "venue-updated" && command.venue) {
      state.venue = normalizeVenueState(command.venue);
      if (urlProjectorId) state.venue.activeProjectorId = urlProjectorId;
      state.venue.enabled = true;
      state.venue.showFrustumHelpers = false;
      applyVenueToRenderers();
      refreshBoxSizeLabel();
      syncOutputDisplayControlsFromVenue();
      renderHandles();
      return;
    }
    if (command.type === "request-status") {
      announceReady();
      return;
    }
    if (command.type === "set-handles") {
      handlesVisible = command.visible !== false;
      renderHandles();
    }
  } catch (error) {
    console.warn("Mapping studio command failed", error);
    setStatus(`Error: ${error.message || "unknown"}`);
  }
}

async function refreshOutputDisplayOptions() {
  if (!outputDisplaySelect) return;
  let displays = [];
  try {
    displays = await listProjectorOutputDisplays();
  } catch {
    displays = [];
  }

  const previous = state.venue.outputDisplayId || outputDisplaySelect.value;
  outputDisplaySelect.innerHTML = "";
  for (const display of displays) {
    const option = document.createElement("option");
    option.value = display.id;
    option.textContent = display.label;
    outputDisplaySelect.appendChild(option);
  }
  if (!displays.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "No displays found";
    outputDisplaySelect.appendChild(option);
  }

  const hasPrevious = [...outputDisplaySelect.options].some(
    (option) => option.value === previous
  );
  const primary = displays.find((display) => display.primary);
  const selected = hasPrevious
    ? previous
    : primary?.id || displays[0]?.id || "";
  outputDisplaySelect.value = selected;
  state.venue.outputDisplayId = selected;
  syncOutputDisplayControlsFromVenue();
}

function syncOutputDisplayControlsFromVenue() {
  if (
    outputDisplaySelect &&
    state.venue.outputDisplayId &&
    [...outputDisplaySelect.options].some(
      (option) => option.value === state.venue.outputDisplayId
    )
  ) {
    outputDisplaySelect.value = state.venue.outputDisplayId;
  }
  if (outputFullscreenToggle) {
    outputFullscreenToggle.checked = state.venue.openFullscreenOnOutput !== false;
  }
}

async function openProjectorFeed() {
  // Always start the lamp feed wall-to-wall. Broken keystones from earlier
  // calibration punches are what caused the black hole in Open on projector.
  state.venue = normalizeVenueState(state.venue);
  state.venue.enabled = true;
  for (const projector of state.venue.projectors || []) {
    if (projector.projectionMode !== "anamorphic") {
      projector.faceIds = ["top"];
    } else if (!projector.faceIds?.length) {
      projector.faceIds = ["top"];
    }
    for (const faceId of projector.faceIds) {
      projector.faceCorners[faceId] = resetFaceCornersToFullFrame(faceId);
    }
  }
  state.venue.calibrationFaceId = "top";
  if (outputDisplaySelect) {
    state.venue.outputDisplayId = outputDisplaySelect.value;
  }
  if (outputFullscreenToggle) {
    state.venue.openFullscreenOnOutput = Boolean(outputFullscreenToggle.checked);
  }
  applyVenueToRenderers();
  persistVenueLocally();
  broadcastVenueUpdate();

  const projectorId = activeProjectorId();
  // resetCorners=1 tells the projector window to ignore stale Control sync.
  const result = await openProjectorOutputWindow({
    pathWithQuery: `/stage.html?projector=${encodeURIComponent(projectorId)}&resetCorners=1`,
    windowName: `dungeon-stage-${projectorId}`,
    displayId: state.venue.outputDisplayId,
    fullscreen: state.venue.openFullscreenOnOutput !== false,
  });

  if (!result.ok) {
    setStatus(result.error || "Could not open projector feed", 4000);
    return;
  }

  if (result.window) {
    if (outputWindow && !outputWindow.closed && outputWindow !== result.window) {
      try {
        outputWindow.close();
      } catch {
        // ignore
      }
    }
    outputWindow = result.window;
  }

  setStatus(
    "Opened projector feed on the chosen display — then nudge corners on the real box",
    4500
  );
}

btnFitCorners.addEventListener("click", () => {
  const projector = getProjectorById(state.venue, state.venue.activeProjectorId);
  if (!projector) return;
  const faceId =
    projector.faceIds.includes(state.venue.calibrationFaceId)
      ? state.venue.calibrationFaceId
      : projector.faceIds[0];
  if (!faceId) return;
  projector.faceCorners[faceId] = resetFaceCornersToFullFrame(faceId);
  applyVenueToRenderers();
  renderHandles();
  persistVenueLocally();
  broadcastVenueUpdate();
  setStatus("Full rectangle — now drag each handle onto a real box corner", 3000);
});

for (const input of [boxWidthInput, boxDepthInput, boxHeightInput]) {
  input?.addEventListener("change", commitBoxSizeFromInputs);
  input?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      commitBoxSizeFromInputs();
      input.blur();
    }
  });
}

btnResync.addEventListener("click", () => {
  announceReady();
  setStatus("Asked Control to resync…", 2000);
});

btnOpenOutput.addEventListener("click", openProjectorFeed);
btnOpenOutputStep?.addEventListener("click", openProjectorFeed);
btnRefreshDisplays?.addEventListener("click", () => {
  refreshOutputDisplayOptions().then(() => {
    persistVenueLocally();
    broadcastVenueUpdate();
    setStatus("Display list refreshed", 1800);
  });
});
outputDisplaySelect?.addEventListener("change", () => {
  state.venue.outputDisplayId = outputDisplaySelect.value;
  persistVenueLocally();
  broadcastVenueUpdate();
});
outputFullscreenToggle?.addEventListener("change", () => {
  state.venue.openFullscreenOnOutput = Boolean(outputFullscreenToggle.checked);
  persistVenueLocally();
  broadcastVenueUpdate();
});
refreshOutputDisplayOptions();

channel.addEventListener("message", (event) => applyCommand(event.data));
window.addEventListener("message", (event) => {
  if (event.origin !== window.location.origin) return;
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

window.addEventListener("keydown", (event) => {
  const key = event.key.toLowerCase();
  if (key === "h") {
    handlesVisible = !handlesVisible;
    renderHandles();
    setStatus(handlesVisible ? "Handles visible" : "Handles hidden", 1600);
  }
  if (key === "r") {
    announceReady();
    setStatus("Asked Control to resync…", 2000);
  }
});

window.addEventListener("resize", () => {
  outputRenderer.resize();
  sceneRenderer.resize();
});

const startup = loadSceneState();
startup.testBackdrop = false;
startup.venue = normalizeVenueState(startup.venue || {});
startup.venue.enabled = true;
startup.venue.showFrustumHelpers = false;
if (urlProjectorId) startup.venue.activeProjectorId = urlProjectorId;

applyScene(startup, { persist: false })
  .catch(() => applyScene(createDefaultSceneState(), { persist: false }))
  .finally(() => {
    state.venue.showFrustumHelpers = false;
    applyVenueToRenderers();
    refreshBoxSizeLabel();
    announceReady();
    window.setTimeout(announceReady, 300);
    window.setTimeout(announceReady, 1000);
    sceneRenderer.resetPreviewCamera();
    setStatus("Step 1 check box size · Step 2 Open on projector · Step 3 drag corners", 5000);
  });
