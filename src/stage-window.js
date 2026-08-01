import { StageRenderer } from "./stage.js";
import {
  loadSceneState,
  saveSceneState,
  patchSceneState,
  createDefaultSceneState,
  buildActorsForSync,
  clampProjectorCorners,
  setSoleActorOnMap,
} from "./sceneState.js";
import {
  getBattleMapCategories,
  initCustomBattleMaps,
  normalizeBattleMapState,
} from "./battleMaps.js";
import { getCharacterCategories } from "./characters.js";
import { initCustomCharacters } from "./customCharacters.js";
import { CUSTOM_MAPS_SYNC_KEY } from "./customBattleMaps.js";
import { CUSTOM_CHARACTERS_SYNC_KEY } from "./customCharacters.js";
import { normalizeCharacterStageState, MIN_SIZE, MAX_SIZE } from "./characterStage.js";
import {
  areFaceCornersHealthy,
  areFaceCornersUsable,
  clampFaceCorner,
  createDefaultContentCorners,
  createDefaultFaceCorners,
  faceCornersArea,
  getProjectorById,
  isFullFrameCorners,
  normalizeVenueState,
  resetFaceCornersToFullFrame,
} from "./venueGeometry.js";
import { constrainMapKeystoneWindow, constrainStageKeystoneWindow } from "./fx/projectorWarp.js";

const canvas = document.getElementById("stage-canvas");
const statusElement = document.getElementById("status");
const handlesElement = document.getElementById("stage-handles");
const characterStageHandlesElement = document.getElementById(
  "character-stage-handles"
);
const viewportElement = document.getElementById("viewport");
const stageBoardElement = document.getElementById("stage-board");
const zoomReadout = document.getElementById("zoom-readout");
const btnZoomIn = document.getElementById("btn-zoom-in");
const btnZoomOut = document.getElementById("btn-zoom-out");
const btnZoomFit = document.getElementById("btn-zoom-fit");
const btnZoomReset = document.getElementById("btn-zoom-reset");
const btnViewMode = document.getElementById("btn-view-mode");
const btnResetCorners = document.getElementById("btn-reset-corners");
const btnFullscreen = document.getElementById("btn-fullscreen");
const btnExitFullscreen = document.getElementById("btn-exit-fullscreen");
const btnCloseStage = document.getElementById("btn-close-stage");
const btnChromeToggle = document.getElementById("btn-chrome-toggle");
const btnHandlesToggle = document.getElementById("btn-handles-toggle");
const btnGridToggle = document.getElementById("btn-grid-toggle");
const btnBackdropToggle = document.getElementById("btn-backdrop-toggle");
const btnStageSizeDown = document.getElementById("btn-stage-size-down");
const btnStageSizeUp = document.getElementById("btn-stage-size-up");
const stageSizeReadout = document.getElementById("stage-size-readout");
const btnKeystoneLayer = document.getElementById("btn-keystone-layer");
const castMapSelect = document.getElementById("cast-map-select");
const castCharacterSelect = document.getElementById("cast-character-select");
const channel = new BroadcastChannel("dungeon-stage");
/** Suppress select change handlers while syncing dropdown values from state. */
let suppressCastSelectEvents = false;

/** Which keystone handle sets are shown: all | map | stage */
const KEYSTONE_LAYER_MODES = ["all", "map", "stage"];
let keystoneLayerMode = "all";
function isElectronBridge() {
  return Boolean(window.dungeonStage?.isElectron);
}

/** Each projector gets its own window, identified by ?projector=… */
const urlParams = new URLSearchParams(window.location.search);
const assignedProjectorId = urlParams.get("projector") || "";
/** Set by Align Studio "Open on projector" so stale Control sync can't restore a hole. */
const forceFullFrameCorners = urlParams.get("resetCorners") === "1";

let state = loadSceneState();
// Projector output starts black outside the mapped quad.
state.testBackdrop = false;
state.venue = normalizeVenueState(state.venue);
state.venue.enabled = true;
if (assignedProjectorId) {
  state.venue.activeProjectorId = assignedProjectorId;
}
/**
 * While true, sync-scene from Control must not restore an old keystone that
 * punches the black hole — Mapping already reset + persisted, but Control's
 * in-memory copy can lag and overwrite on stage-ready.
 */
let lockFullFrameCorners = forceFullFrameCorners;
/** One-shot wipe of sticky-handle / homography experiment leftovers. */
const KEYSTONE_REPAIR_KEY = "dungeon-stage-keystone-repair-v3";
let forceKeystoneRepair = false;
try {
  forceKeystoneRepair = localStorage.getItem(KEYSTONE_REPAIR_KEY) !== "done";
} catch {
  forceKeystoneRepair = true;
}
for (const projector of state.venue.projectors || []) {
  if (!projector.faceIds?.length) projector.faceIds = ["top"];
  for (const faceId of projector.faceIds) {
    if (
      forceKeystoneRepair ||
      lockFullFrameCorners ||
      !areFaceCornersHealthy(projector.faceCorners?.[faceId])
    ) {
      projector.faceCorners[faceId] = resetFaceCornersToFullFrame(faceId);
    }
  }
}
if (forceKeystoneRepair) {
  try {
    localStorage.setItem(KEYSTONE_REPAIR_KEY, "done");
  } catch {
    // ignore
  }
}

const renderer = new StageRenderer(canvas, {
  mode: "single",
  testBackdrop: false,
  showBoxGuide: Boolean(state.showBoxGuide),
  calibrationGrid: Boolean(state.calibrationGrid),
  useProjectorWarp: true,
});
if (forceKeystoneRepair) {
  try {
    // Venue/keystone repair only — do not rewrite Home's selected map.
    patchSceneState({
      venue: state.venue,
      projector: state.projector,
    });
  } catch {
    // ignore
  }
}

let applyToken = 0;
let handlesVisible = true;
let statusHideTimer = 0;
let cornerSaveTimer = 0;
/** True while a TL/TR/BR/BL pointer drag is active — sync must not rebuild handles. */
let isDraggingCorner = false;
/** True while dragging a 3D-stage corner handle. */
let isDraggingCharacterStage = false;
let characterStageDragState = null;
let characterStageHandleRaf = 0;
let characterStageDragMoveQueued = false;

/** Calibration view — zoom/pan the board so stretched-out handles stay reachable. */
const viewState = {
  zoom: 1,
  panX: 0,
  panY: 0,
};
const VIEW_ZOOM_MIN = 0.35;
const VIEW_ZOOM_MAX = 4;
let isPanningView = false;
let panPointerId = null;
let panLastX = 0;
let panLastY = 0;
let cursorIdleTimer = 0;
const CURSOR_IDLE_MS = 2500;

function bumpCursorActivity() {
  document.body.classList.remove("cursor-idle");
  window.clearTimeout(cursorIdleTimer);
  cursorIdleTimer = window.setTimeout(() => {
    // Keep the cursor while interacting with the hotbar.
    if (document.getElementById("proj-hotbar")?.matches(":hover, :focus-within")) {
      bumpCursorActivity();
      return;
    }
    document.body.classList.add("cursor-idle");
  }, CURSOR_IDLE_MS);
}

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

function applyViewTransform() {
  if (!stageBoardElement) return;
  stageBoardElement.style.transform = `translate(calc(-50% + ${viewState.panX}px), calc(-50% + ${viewState.panY}px)) scale(${viewState.zoom})`;
  if (zoomReadout) {
    zoomReadout.textContent = `${Math.round(viewState.zoom * 100)}%`;
  }
}

function setPresentingMode(enabled) {
  const presenting = Boolean(enabled);
  document.body.classList.toggle("presenting", presenting);
  if (btnChromeToggle) {
    btnChromeToggle.setAttribute("aria-pressed", presenting ? "true" : "false");
    btnChromeToggle.title = presenting
      ? "Show controls"
      : "Hide controls (eye). Press again to show.";
  }
  if (presenting) {
    setStatus("Controls hidden — press the eye to show them again", 2800);
  } else {
    setStatus("Controls visible", 1600);
  }
}

function syncHotbarToggles() {
  btnHandlesToggle?.classList.toggle("is-active", handlesVisible);
  btnGridToggle?.classList.toggle("is-active", Boolean(state.calibrationGrid));
  btnBackdropToggle?.classList.toggle("is-active", Boolean(state.testBackdrop));
  const viewMode = renderer.getStageViewMode?.() || "top";
  if (btnViewMode) {
    btnViewMode.textContent = viewMode === "top" ? "Top" : "3D";
    btnViewMode.classList.toggle("is-active", viewMode === "top");
    btnViewMode.title =
      viewMode === "top"
        ? "Map fills the throw (no black bars). Click for 3D tilt."
        : "3D tilt view — may show bars. Click for top-down fill.";
  }
  if (btnKeystoneLayer) {
    const labels = {
      all: "Keystone: All",
      map: "Keystone: Map",
      stage: "Keystone: Stage",
    };
    btnKeystoneLayer.textContent = labels[keystoneLayerMode] || labels.all;
    btnKeystoneLayer.classList.toggle(
      "is-active",
      keystoneLayerMode !== "all"
    );
  }
  updateStageSizeReadout();
}

function updateStageSizeReadout() {
  const stage = normalizeCharacterStageState(state.characterStage);
  if (stageSizeReadout) {
    stageSizeReadout.textContent = stage.enabled
      ? stage.size.toFixed(2)
      : "off";
  }
  const sizeControlsDisabled = !stage.enabled;
  if (btnStageSizeDown) btnStageSizeDown.disabled = sizeControlsDisabled;
  if (btnStageSizeUp) btnStageSizeUp.disabled = sizeControlsDisabled;
}

function postStageCommand(payload) {
  channel.postMessage(payload);
  if (window.opener && !window.opener.closed) {
    try {
      window.opener.postMessage(payload, window.location.origin);
    } catch {
      // ignore
    }
  }
  try {
    localStorage.setItem("dungeon-stage-command", JSON.stringify(payload));
  } catch {
    // ignore
  }
}

function broadcastCharacterStageUpdate() {
  postStageCommand({
    type: "character-stage-updated",
    characterStage: normalizeCharacterStageState(state.characterStage),
    at: Date.now(),
  });
}

function broadcastBackdropUpdate() {
  postStageCommand({
    type: "backdrop-updated",
    testBackdrop: Boolean(state.testBackdrop),
    at: Date.now(),
  });
}

function setTestBackdrop(enabled, options = {}) {
  state.testBackdrop = Boolean(enabled);
  renderer.setTestBackdrop(state.testBackdrop);
  syncHotbarToggles();
  if (options.persist !== false) {
    try {
      patchSceneState({ testBackdrop: state.testBackdrop });
    } catch {
      // ignore
    }
  }
  if (options.notifyControl !== false) {
    broadcastBackdropUpdate();
  }
  if (options.status !== false) {
    setStatus(
      state.testBackdrop
        ? "Backdrop on — gray outside warp"
        : "Backdrop off — black outside warp",
      1800
    );
  }
}

function broadcastStageContentUpdate(options = {}) {
  const includeAlignment = options.includeAlignment !== false;
  postStageCommand({
    type: "stage-content-updated",
    battleMap: normalizeBattleMapState(state.battleMap),
    actorsOnMap: Array.isArray(state.actorsOnMap) ? state.actorsOnMap : [],
    selectedInstanceIds: Array.isArray(state.selectedInstanceIds)
      ? state.selectedInstanceIds
      : [],
    characterIndex: state.characterIndex,
    // Keep Control's LS/keystone in lockstep so a later sync can't restore
    // a pre-swap trapezoid after a map texture change.
    ...(includeAlignment
      ? {
          characterStage: normalizeCharacterStageState(state.characterStage),
          venue: normalizeVenueState(state.venue),
        }
      : {}),
    at: Date.now(),
  });
}

function getActiveStageCharacterId() {
  const selectedId = state.selectedInstanceIds?.[0];
  if (selectedId) {
    const selected = (state.actorsOnMap || []).find(
      (instance) => instance.instanceId === selectedId
    );
    if (selected?.characterId) return selected.characterId;
  }
  return state.actorsOnMap?.[0]?.characterId || "";
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

/**
 * Snapshot projector alignment that must survive a map texture swap.
 * Stage (TL2) corners are the priority anchor; map (TL1) + whole-face
 * keystones travel with them so the throw looks unchanged.
 */
function snapshotProjectionAlignment() {
  return {
    characterStage: normalizeCharacterStageState(state.characterStage),
    venue: normalizeVenueState(cloneJson(state.venue)),
    projectorCorners: clampProjectorCorners(
      cloneJson(state.projector?.corners || {})
    ),
  };
}

function restoreProjectionAlignment(snapshot) {
  if (!snapshot) return;
  state.characterStage = normalizeCharacterStageState(snapshot.characterStage);
  state.venue = normalizeVenueState(snapshot.venue);
  state.projector = {
    ...state.projector,
    corners: clampProjectorCorners(snapshot.projectorCorners),
  };
  if (assignedProjectorId) {
    state.venue.activeProjectorId = assignedProjectorId;
  }
  state.venue.enabled = true;
  renderer.setCharacterStage(state.characterStage);
  renderer.setVenueState(state.venue);
  renderer.setProjectorCorners(state.projector.corners);
  updateStageSizeReadout();
  if (!isDraggingCorner && !isDraggingCharacterStage) {
    renderHandles();
    updateCharacterStageHandlePositions();
  }
}

async function rebuildCastMapSelectOptions() {
  if (!castMapSelect) return;
  await initCustomBattleMaps();
  castMapSelect.innerHTML = "";
  for (const category of getBattleMapCategories()) {
    const group = document.createElement("optgroup");
    group.label = category.name;
    if (category.isCustomCategory && category.maps.length === 0) {
      const placeholderOption = document.createElement("option");
      placeholderOption.disabled = true;
      placeholderOption.value = "";
      placeholderOption.textContent = "Add custom maps from Home";
      group.appendChild(placeholderOption);
    } else {
      for (const mapEntry of category.maps) {
        const option = document.createElement("option");
        option.value = mapEntry.id;
        option.textContent = mapEntry.name;
        group.appendChild(option);
      }
    }
    castMapSelect.appendChild(group);
  }
}

async function rebuildCastCharacterSelectOptions() {
  if (!castCharacterSelect) return;
  await initCustomCharacters();
  castCharacterSelect.innerHTML = "";

  const noneOption = document.createElement("option");
  noneOption.value = "";
  noneOption.textContent = "None";
  castCharacterSelect.appendChild(noneOption);

  for (const category of getCharacterCategories()) {
    const group = document.createElement("optgroup");
    group.label = category.name;
    const categoryCharacters = category.characters || [];
    if (category.isCustomCategory && categoryCharacters.length === 0) {
      const placeholderOption = document.createElement("option");
      placeholderOption.disabled = true;
      placeholderOption.value = "";
      placeholderOption.textContent = "Add custom characters from Home";
      group.appendChild(placeholderOption);
    } else {
      for (const character of categoryCharacters) {
        const option = document.createElement("option");
        option.value = character.id;
        option.textContent = character.name;
        group.appendChild(option);
      }
    }
    castCharacterSelect.appendChild(group);
  }
}

async function refreshCastSelectsFromState() {
  await rebuildCastMapSelectOptions();
  await rebuildCastCharacterSelectOptions();
  suppressCastSelectEvents = true;
  try {
    if (castMapSelect) {
      const mapId = normalizeBattleMapState(state.battleMap).mapId;
      if ([...castMapSelect.options].some((option) => option.value === mapId)) {
        castMapSelect.value = mapId;
      }
    }
    if (castCharacterSelect) {
      castCharacterSelect.value = getActiveStageCharacterId();
    }
  } finally {
    suppressCastSelectEvents = false;
  }
}

function syncCastSelectsFromState() {
  void refreshCastSelectsFromState();
}

async function applyCastBattleMap(mapId) {
  if (!mapId || mapId === state.battleMap?.mapId) {
    syncCastSelectsFromState();
    return;
  }

  // Freeze alignment before texture swap — map art changes, throw does not.
  const alignmentSnapshot = snapshotProjectionAlignment();
  const previousBattleMap = normalizeBattleMapState(state.battleMap);
  const nextBattleMap = normalizeBattleMapState({
    ...previousBattleMap,
    mapId,
    enabled: mapId !== "none",
  });

  state.battleMap = nextBattleMap;
  await renderer.setBattleMap(nextBattleMap);
  // Priority: re-assert stage + map keystones after the async texture load
  // so nothing in the render path can drift the booth relative to the throw.
  restoreProjectionAlignment(alignmentSnapshot);

  syncCastSelectsFromState();
  try {
    patchSceneState({
      battleMap: nextBattleMap,
      characterStage: alignmentSnapshot.characterStage,
      venue: alignmentSnapshot.venue,
      projector: {
        ...state.projector,
        corners: alignmentSnapshot.projectorCorners,
      },
    });
  } catch {
    // ignore
  }
  broadcastStageContentUpdate({ includeAlignment: true });

  const mapEntry = getBattleMapCategories()
    .flatMap((category) => category.maps)
    .find((entry) => entry.id === nextBattleMap.mapId);
  setStatus(
    nextBattleMap.enabled
      ? `Map · ${mapEntry?.name || nextBattleMap.mapId} · alignment kept`
      : "Map · none · alignment kept",
    2000
  );
}

async function applyCastCharacter(characterId) {
  const nextId = characterId || "";
  if (nextId === getActiveStageCharacterId()) {
    syncCastSelectsFromState();
    return;
  }

  // Character swap must not nudge keystone / booth pose.
  const alignmentSnapshot = snapshotProjectionAlignment();
  setSoleActorOnMap(state, nextId);
  const actors = buildActorsForSync(state);
  await renderer.syncActors(actors);
  renderer.setSelectedActorIds(state.selectedInstanceIds || []);
  restoreProjectionAlignment(alignmentSnapshot);

  syncCastSelectsFromState();
  try {
    patchSceneState({
      actorsOnMap: state.actorsOnMap,
      selectedInstanceIds: state.selectedInstanceIds,
      characterIndex: state.characterIndex,
      characterStage: alignmentSnapshot.characterStage,
      venue: alignmentSnapshot.venue,
    });
  } catch {
    // ignore
  }
  broadcastStageContentUpdate({ includeAlignment: true });
  const label = actors[0]?.name || "No character";
  setStatus(`3D stage · ${label}`, 1800);
}

async function applyCharacterStageSize(nextSize, options = {}) {
  const stage = normalizeCharacterStageState({
    ...state.characterStage,
    size: nextSize,
  });
  state.characterStage = stage;
  renderer.setCharacterStage(stage);
  updateStageSizeReadout();
  updateCharacterStageHandlePositions();

  if (options.resyncActors !== false) {
    const actors = buildActorsForSync(state);
    await renderer.syncActors(actors);
    renderer.setSelectedActorIds(state.selectedInstanceIds || []);
  }

  try {
    // Patch size only — avoid rewriting Home's battle map from Stage memory.
    patchSceneState({ characterStage: stage });
  } catch {
    // ignore
  }

  if (options.broadcast !== false) {
    broadcastCharacterStageUpdate();
  }
  if (options.status !== false) {
    setStatus(`3D stage size ${stage.size.toFixed(2)}`, 1600);
  }
}

function applyCharacterStageSizeLive(nextStage) {
  state.characterStage = nextStage;
  updateStageSizeReadout();
  updateCharacterStageHandlePositions();
  // Fast path — scale already-loaded actors without a full GLB resync mid-drag.
  const actors = buildActorsForSync(state);
  for (const actor of actors) {
    renderer.setActorTransform?.(actor);
  }
  setStatus(`3D stage size ${nextStage.size.toFixed(2)}`, 700);
}

function ensureCharacterStageHandles() {
  if (!characterStageHandlesElement) return;
  if (characterStageHandlesElement.childElementCount) return;
  for (const corner of ["nw", "ne", "se", "sw"]) {
    const handle = document.createElement("div");
    handle.className = "stage-box-handle";
    handle.dataset.corner = corner;
    handle.textContent = "◇";
    handle.title = "Drag away from the map to grow · toward the map to shrink";
    characterStageHandlesElement.appendChild(handle);

    handle.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      if (!state.characterStage?.enabled) return;
      event.preventDefault();
      event.stopPropagation();

      const dragState = renderer.beginCharacterStageResize?.(
        event.clientX,
        event.clientY,
        corner
      );
      if (!dragState) return;

      isDraggingCharacterStage = true;
      characterStageDragState = dragState;
      handle.classList.add("is-dragging");
      handle.setPointerCapture(event.pointerId);
      renderer.setOrbitEnabled?.(false);

      const move = (moveEvent) => {
        if (!characterStageDragState) return;
        // Coalesce to one resize per frame so drag stays smooth.
        if (characterStageDragMoveQueued) {
          characterStageDragState._latestX = moveEvent.clientX;
          characterStageDragState._latestY = moveEvent.clientY;
          return;
        }
        characterStageDragMoveQueued = true;
        characterStageDragState._latestX = moveEvent.clientX;
        characterStageDragState._latestY = moveEvent.clientY;
        requestAnimationFrame(() => {
          characterStageDragMoveQueued = false;
          if (!characterStageDragState) return;
          const next = renderer.resizeCharacterStageFromDrag?.(
            characterStageDragState._latestX,
            characterStageDragState._latestY,
            characterStageDragState
          );
          if (next) applyCharacterStageSizeLive(next);
        });
      };

      const up = async () => {
        isDraggingCharacterStage = false;
        characterStageDragState = null;
        characterStageDragMoveQueued = false;
        handle.classList.remove("is-dragging");
        try {
          handle.releasePointerCapture(event.pointerId);
        } catch {
          // already released
        }
        handle.removeEventListener("pointermove", move);
        handle.removeEventListener("pointerup", up);
        handle.removeEventListener("pointercancel", up);
        renderer.setOrbitEnabled?.(
          (renderer.getStageViewMode?.() || "top") !== "top"
        );
        await applyCharacterStageSize(state.characterStage.size, {
          resyncActors: true,
          broadcast: true,
        });
      };

      handle.addEventListener("pointermove", move);
      handle.addEventListener("pointerup", up);
      handle.addEventListener("pointercancel", up);
    });
  }
}

function updateCharacterStageHandlePositions() {
  if (!characterStageHandlesElement) return;
  ensureCharacterStageHandles();

  const stage = normalizeCharacterStageState(state.characterStage);
  const presenting = document.body.classList.contains("presenting");
  // Show in Top and 3D — screen-space drag works in both.
  const show = stage.enabled && handlesVisible && !presenting;

  characterStageHandlesElement.classList.toggle("hidden", !show);
  if (!show) return;

  const projected = renderer.projectCharacterStageCorners?.();
  if (!projected) {
    characterStageHandlesElement.classList.add("hidden");
    return;
  }

  const boardRect = characterStageHandlesElement.getBoundingClientRect();
  for (const handle of characterStageHandlesElement.querySelectorAll(
    ".stage-box-handle"
  )) {
    const corner = projected.corners[handle.dataset.corner];
    if (!corner || !corner.visible) {
      handle.classList.add("is-hidden");
      continue;
    }
    handle.classList.remove("is-hidden");
    handle.style.left = `${corner.x - boardRect.left}px`;
    handle.style.top = `${corner.y - boardRect.top}px`;
  }
}

function startCharacterStageHandleLoop() {
  const tick = () => {
    characterStageHandleRaf = requestAnimationFrame(tick);
    // While dragging, the move handler already repositions handles.
    if (!isDraggingCorner && !isDraggingCharacterStage) {
      updateCharacterStageHandlePositions();
    }
  };
  cancelAnimationFrame(characterStageHandleRaf);
  characterStageHandleRaf = requestAnimationFrame(tick);
}

async function queryElectronFullscreen() {
  if (!isElectronBridge() || !window.dungeonStage?.isFullscreen) return null;
  try {
    return Boolean(await window.dungeonStage.isFullscreen());
  } catch {
    return null;
  }
}

async function refreshFullscreenButtons() {
  const electronFullscreen = await queryElectronFullscreen();
  const isFullscreen =
    electronFullscreen === null
      ? Boolean(document.fullscreenElement)
      : electronFullscreen;
  if (btnFullscreen) {
    btnFullscreen.textContent = isFullscreen ? "Windowed" : "Fullscreen";
  }
  if (btnExitFullscreen) {
    btnExitFullscreen.disabled = !isFullscreen;
    btnExitFullscreen.title = isFullscreen
      ? "Leave fullscreen (Esc). Works in the packaged app too."
      : "Already windowed — use Close to dismiss this window";
  }
  return isFullscreen;
}

async function enterFullscreen() {
  if (isElectronBridge() && window.dungeonStage?.setFullscreen) {
    try {
      await window.dungeonStage.setFullscreen(true);
      await refreshFullscreenButtons();
      setStatus("Fullscreen — Eye hides UI · Exit full leaves projection", 3200);
      return;
    } catch {
      // fall through to browser API
    }
  }
  try {
    if (!document.fullscreenElement) {
      await document.documentElement.requestFullscreen();
    }
    await refreshFullscreenButtons();
    setStatus("Fullscreen — Esc or Exit full to leave", 2500);
  } catch {
    setStatus("Fullscreen blocked — use the app Exit full button or F11", 2800);
  }
  applyViewTransform();
}

async function leaveFullscreen() {
  if (isElectronBridge() && window.dungeonStage?.setFullscreen) {
    try {
      const wasFullscreen = await queryElectronFullscreen();
      await window.dungeonStage.setFullscreen(false);
      await refreshFullscreenButtons();
      setStatus(
        wasFullscreen ? "Exited fullscreen" : "Already windowed",
        1600
      );
      applyViewTransform();
      return true;
    } catch {
      // fall through
    }
  }
  if (document.fullscreenElement) {
    try {
      await document.exitFullscreen();
      await refreshFullscreenButtons();
      setStatus("Exited fullscreen", 1500);
      applyViewTransform();
      return true;
    } catch {
      setStatus("Could not exit fullscreen", 2000);
      return false;
    }
  }
  await refreshFullscreenButtons();
  setStatus("Already windowed — use Close to dismiss this window", 2200);
  return false;
}

async function toggleFullscreen() {
  const isFullscreen = await refreshFullscreenButtons();
  if (isFullscreen) {
    await leaveFullscreen();
  } else {
    await enterFullscreen();
  }
  applyViewTransform();
}

async function closeStageWindow() {
  if (isElectronBridge() && window.dungeonStage?.closeWindow) {
    try {
      await window.dungeonStage.closeWindow();
      return;
    } catch {
      // fall through
    }
  }
  window.close();
  setStatus("Close this window from Control if the browser blocked it", 3000);
}

function clampViewZoom(zoom) {
  return Math.min(VIEW_ZOOM_MAX, Math.max(VIEW_ZOOM_MIN, zoom));
}

function setViewZoom(nextZoom, anchorClientX = null, anchorClientY = null) {
  const previousZoom = viewState.zoom;
  const zoom = clampViewZoom(nextZoom);
  if (!(zoom > 0) || Math.abs(zoom - previousZoom) < 1e-6) {
    applyViewTransform();
    return;
  }

  if (
    viewportElement &&
    Number.isFinite(anchorClientX) &&
    Number.isFinite(anchorClientY)
  ) {
    const bounds = viewportElement.getBoundingClientRect();
    const offsetX = anchorClientX - (bounds.left + bounds.width * 0.5);
    const offsetY = anchorClientY - (bounds.top + bounds.height * 0.5);
    const scale = zoom / previousZoom;
    viewState.panX = offsetX - (offsetX - viewState.panX) * scale;
    viewState.panY = offsetY - (offsetY - viewState.panY) * scale;
  }

  viewState.zoom = zoom;
  applyViewTransform();
}

function resetView() {
  viewState.zoom = 1;
  viewState.panX = 0;
  viewState.panY = 0;
  applyViewTransform();
  setStatus("View 1:1", 1400);
}

function fitHandlesInView() {
  const projector = getProjectorById(state.venue, state.venue.activeProjectorId);
  const faceId =
    projector?.faceIds?.includes(state.venue.calibrationFaceId)
      ? state.venue.calibrationFaceId
      : projector?.faceIds?.[0];
  const corners = faceId ? projector?.faceCorners?.[faceId] : null;
  if (!corners || !viewportElement) {
    resetView();
    return;
  }

  const points = [
    corners.topLeft,
    corners.topRight,
    corners.bottomRight,
    corners.bottomLeft,
  ];
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
  }

  const width = Math.max(0.2, maxX - minX);
  const height = Math.max(0.2, maxY - minY);
  const padding = 1.25;
  const zoom = clampViewZoom(Math.min(1 / (width * padding), 1 / (height * padding)));
  const centerX = (minX + maxX) * 0.5;
  const centerY = (minY + maxY) * 0.5;
  const bounds = viewportElement.getBoundingClientRect();
  viewState.zoom = zoom;
  viewState.panX = (0.5 - centerX) * bounds.width * zoom;
  viewState.panY = (0.5 - centerY) * bounds.height * zoom;
  applyViewTransform();
  setStatus(`Fit handles · ${Math.round(zoom * 100)}%`, 1800);
}

function resetOwnedCornersToFullFrame() {
  lockFullFrameCorners = false;
  for (const projector of state.venue.projectors || []) {
    if (assignedProjectorId && projector.id !== assignedProjectorId) continue;
    if (!projector.faceIds?.length) projector.faceIds = ["top"];
    for (const faceId of projector.faceIds) {
      projector.faceCorners[faceId] = resetFaceCornersToFullFrame(faceId);
    }
    projector.contentCorners = createDefaultContentCorners();
  }
  state.venue = normalizeVenueState(state.venue);
  renderer.setVenueState(state.venue);
  persistVenueLocally();
  broadcastVenueUpdate();
  renderHandles();
  resetView();
  setStatus("Corners reset — map (TL1) + stage (TL2)", 2800);
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
    // Patch only keystone fields — a full saveSceneState(state) here used to
    // rewrite Home's selected battle map with Stage's stale in-memory copy.
    state.projector.corners = clampProjectorCorners(state.projector.corners);
    patchSceneState({
      projector: {
        ...state.projector,
        corners: state.projector.corners,
      },
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

function persistVenueLocally() {
  try {
    // Patch venue only — never clobber Home's battleMap / roster / stage.
    state.venue = normalizeVenueState(state.venue);
    patchSceneState({
      venue: state.venue,
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

/** Distinct colour per face so overlapping handle sets stay tellable apart. */
const FACE_HANDLE_COLORS = {
  top: "#d4a017",
  front: "#3fb6c8",
  right: "#6fcf5f",
  back: "#d072d0",
  left: "#e08a3c",
};

const CONTENT_HANDLE_SETS = [
  {
    id: "battleMap",
    title: "Battle map",
    color: "#3fb6c8",
    inset: 0.13,
    labels: {
      topLeft: "TL1",
      topRight: "TR1",
      bottomRight: "BR1",
      bottomLeft: "BL1",
    },
  },
  {
    id: "characterStage",
    title: "3D stage",
    color: "#b07cff",
    inset: 0.2,
    labels: {
      topLeft: "TL2",
      topRight: "TR2",
      bottomRight: "BR2",
      bottomLeft: "BL2",
    },
  },
];

/** Fixed on-screen homes for TL / TR / BR / BL so knobs never leave the frame. */
const HANDLE_HOME = {
  TL: { x: 0.06, y: 0.06 },
  TR: { x: 0.94, y: 0.06 },
  BR: { x: 0.94, y: 0.94 },
  BL: { x: 0.06, y: 0.94 },
};

function handleHomeForLabel(label, inset = null) {
  const base = HANDLE_HOME[label.replace(/[12]$/, "")] || HANDLE_HOME.TL;
  const edge = inset == null ? (label.endsWith("1") ? 0.13 : label.endsWith("2") ? 0.2 : 0.06) : inset;
  const home = {
    x: base.x < 0.5 ? edge : 1 - edge,
    y: base.y < 0.5 ? edge : 1 - edge,
  };

  // Keep BL / BL1 / BL2 clear of the bottom-left hotbar.
  if (label === "BL" || label === "BL1" || label === "BL2") {
    const hotbar = document.getElementById("proj-hotbar");
    const board = handlesElement?.getBoundingClientRect();
    if (
      hotbar &&
      board &&
      board.width > 1 &&
      board.height > 1 &&
      !document.body.classList.contains("presenting")
    ) {
      const hotbarBounds = hotbar.getBoundingClientRect();
      const pad = 20;
      const avoidTop = (hotbarBounds.top - pad - board.top) / board.height;
      if (Number.isFinite(avoidTop) && home.y > avoidTop) {
        home.y = Math.max(edge, Math.min(0.94, avoidTop));
      }
    }
  }

  return home;
}

/**
 * Draggable corner handle (joystick-style).
 *
 * The visible TL/TR/BR/BL knob lives at a fixed on-screen home. Dragging still
 * stretches the map (logical corners can go past the frame). Past the window
 * edge, deltas + edge-push keep stretching; on release the knob snaps home
 * again so you can grab it for another pull.
 */
function appendCornerHandle({
  label,
  title,
  color,
  corner,
  onMove,
  onCommit,
  onDragStart = null,
  getCorner = null,
  homeInset = null,
  layer = "whole",
  /** Edge-push stretch is for map TL1 trapezoids — never for TL2 booth. */
  allowEdgePush = true,
}) {
  const handle = document.createElement("div");
  handle.className = "corner-handle";
  handle.dataset.layer = layer;
  handle.textContent = label;
  handle.title = title;

  const home = handleHomeForLabel(label, homeInset);

  function paintAtHome(parked = false) {
    handle.style.left = `${home.x * 100}%`;
    handle.style.top = `${home.y * 100}%`;
    handle.classList.toggle("is-parked", parked);
  }

  function paintDragging(clientX, clientY) {
    const bounds = handlesElement.getBoundingClientRect();
    if (bounds.width < 1 || bounds.height < 1) {
      paintAtHome(true);
      return;
    }
    const x = Math.min(0.97, Math.max(0.03, (clientX - bounds.left) / bounds.width));
    const y = Math.min(0.97, Math.max(0.03, (clientY - bounds.top) / bounds.height));
    handle.style.left = `${x * 100}%`;
    handle.style.top = `${y * 100}%`;
    handle.classList.remove("is-parked");
  }

  // Always start at the fixed home — stretch is in the warp, not the knob.
  paintAtHome(
    corner.x < 0 ||
      corner.x > 1 ||
      corner.y < 0 ||
      corner.y > 1 ||
      Math.abs(corner.x - home.x) > 0.02 ||
      Math.abs(corner.y - home.y) > 0.02
  );
  if (color) {
    handle.style.borderColor = color;
    handle.style.color = color;
  }
  handlesElement.appendChild(handle);

  handle.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    isDraggingCorner = true;
    renderer.setOrbitEnabled(false);
    handle.setPointerCapture(event.pointerId);

    onDragStart?.();
    const startCorner = getCorner?.() || corner;
    let logical = { x: startCorner.x, y: startCorner.y };
    let lastClientX = event.clientX;
    let lastClientY = event.clientY;
    let lastMoveAt = performance.now();
    let edgePushRaf = 0;
    let pastEdge = false;
    const startPointer = (() => {
      const bounds = handlesElement.getBoundingClientRect();
      if (bounds.width < 1 || bounds.height < 1) return { x: home.x, y: home.y };
      return {
        x: (event.clientX - bounds.left) / bounds.width,
        y: (event.clientY - bounds.top) / bounds.height,
      };
    })();
    // Keep the grab continuous when the knob sits at home but the corner isn't.
    const grabOffsetX = logical.x - startPointer.x;
    const grabOffsetY = logical.y - startPointer.y;

    function commitLogical(next) {
      logical = clampFaceCorner(next);
      corner.x = logical.x;
      corner.y = logical.y;
      const applied = onMove(logical);
      logical = { x: applied.x, y: applied.y };
    }

    function boardPointer(clientX, clientY) {
      const bounds = handlesElement.getBoundingClientRect();
      if (bounds.width < 1 || bounds.height < 1) return null;
      return {
        bounds,
        x: (clientX - bounds.left) / bounds.width,
        y: (clientY - bounds.top) / bounds.height,
      };
    }

    const tickEdgePush = () => {
      edgePushRaf = window.requestAnimationFrame(tickEdgePush);
      if (!allowEdgePush) return;
      // Cursor stuck against a window edge — keep stretching (map TL1 only).
      if (performance.now() - lastMoveAt < 90) return;
      const pointer = boardPointer(lastClientX, lastClientY);
      if (!pointer) return;
      const zone = 0.08;
      const strength = 0.022;
      let pushX = 0;
      let pushY = 0;
      if (pointer.y < zone) pushY = -strength * (1 - pointer.y / zone);
      if (pointer.y > 1 - zone) pushY = strength * (1 - (1 - pointer.y) / zone);
      if (pointer.x < zone) pushX = -strength * (1 - pointer.x / zone);
      if (pointer.x > 1 - zone) pushX = strength * (1 - (1 - pointer.x) / zone);
      if (pushX === 0 && pushY === 0) return;
      pastEdge = true;
      commitLogical({ x: logical.x + pushX, y: logical.y + pushY });
      paintAtHome(true);
      setStatus("Stretching — hold at the edge to keep going", 700);
    };

    const move = (moveEvent) => {
      moveEvent.preventDefault();
      moveEvent.stopPropagation();
      const pointer = boardPointer(moveEvent.clientX, moveEvent.clientY);
      if (!pointer) return;

      const deltaX = (moveEvent.clientX - lastClientX) / pointer.bounds.width;
      const deltaY = (moveEvent.clientY - lastClientY) / pointer.bounds.height;
      lastClientX = moveEvent.clientX;
      lastClientY = moveEvent.clientY;
      lastMoveAt = performance.now();

      const pointerOutside =
        pointer.x < 0 || pointer.x > 1 || pointer.y < 0 || pointer.y > 1;

      if (pointerOutside) {
        if (!allowEdgePush) {
          // TL2: clamp to board edge — never accumulate wild stretch.
          commitLogical({
            x: Math.min(0.97, Math.max(0.03, pointer.x)) + grabOffsetX,
            y: Math.min(0.97, Math.max(0.03, pointer.y)) + grabOffsetY,
          });
          paintDragging(moveEvent.clientX, moveEvent.clientY);
          return;
        }
        pastEdge = true;
        commitLogical({
          x: logical.x + deltaX,
          y: logical.y + deltaY,
        });
        paintAtHome(true);
        return;
      }

      if (pastEdge) {
        if (!allowEdgePush) {
          pastEdge = false;
        } else {
          // Stay in delta mode after leaving the frame so stretch keeps going.
          commitLogical({
            x: logical.x + deltaX,
            y: logical.y + deltaY,
          });
          paintDragging(moveEvent.clientX, moveEvent.clientY);
          return;
        }
      }

      // Inside the frame: corner tracks the pointer (with grab offset).
      commitLogical({
        x: pointer.x + grabOffsetX,
        y: pointer.y + grabOffsetY,
      });
      paintDragging(moveEvent.clientX, moveEvent.clientY);
    };

    const up = () => {
      isDraggingCorner = false;
      renderer.setOrbitEnabled(true);
      window.cancelAnimationFrame(edgePushRaf);
      try {
        handle.releasePointerCapture(event.pointerId);
      } catch {
        // already released
      }
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", up);
      // Knob returns home; map stretch stays.
      paintAtHome(true);
      onCommit();
    };

    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", up);
    edgePushRaf = window.requestAnimationFrame(tickEdgePush);
  });
}

function ensureProjectorContentCorners(projector) {
  if (!projector.contentCorners) {
    projector.contentCorners = createDefaultContentCorners();
  }
  if (!projector.contentCorners.battleMap) {
    projector.contentCorners.battleMap = createDefaultFaceCorners("top");
  }
  if (!projector.contentCorners.characterStage) {
    projector.contentCorners.characterStage = createDefaultFaceCorners("top");
  }
  return projector.contentCorners;
}

/** Clear half-dragged / oversized TL2 quads that smear the booth. */
function repairOversizedStageContentCorners(projector) {
  const content = ensureProjectorContentCorners(projector);
  const stageCorners = content.characterStage;
  if (
    !isFullFrameCorners(stageCorners) &&
    faceCornersArea(stageCorners) >= 0.45
  ) {
    content.characterStage = createDefaultFaceCorners("top");
  }
  return content;
}

function patchLiveContentCorner(regionId, cornerKey, applied) {
  const stateProjector = getProjectorById(
    state.venue,
    state.venue.activeProjectorId
  );
  if (stateProjector) {
    const content = ensureProjectorContentCorners(stateProjector);
    const corner = content[regionId][cornerKey];
    corner.x = applied.x;
    corner.y = applied.y;
  }
  const liveProjector = getProjectorById(
    renderer.venueState,
    state.venue.activeProjectorId
  );
  if (liveProjector) {
    const content = ensureProjectorContentCorners(liveProjector);
    const corner = content[regionId][cornerKey];
    corner.x = applied.x;
    corner.y = applied.y;
  }
}

/**
 * First TL1 grab: snap the cyan quad onto the battle-map plane so each handle
 * is a true corner pin. Dragging BL1 then moves only that corner; the other
 * three stay anchored (trapezoid / real-world box fit).
 */
function seedMapContentCornersFromPlane(projector) {
  const content = ensureProjectorContentCorners(projector);
  if (!isFullFrameCorners(content.battleMap)) return false;
  if (typeof renderer.captureMapPlaneContentCorners !== "function") {
    return false;
  }
  const seeded = renderer.captureMapPlaneContentCorners();
  if (!areFaceCornersUsable(seeded)) return false;
  const area = faceCornersArea(seeded);
  if (area < 0.01) return false;

  const copy = {
    topLeft: { ...seeded.topLeft },
    topRight: { ...seeded.topRight },
    bottomRight: { ...seeded.bottomRight },
    bottomLeft: { ...seeded.bottomLeft },
  };
  content.battleMap = copy;

  const liveProjector = getProjectorById(
    renderer.venueState,
    state.venue.activeProjectorId
  );
  if (liveProjector) {
    ensureProjectorContentCorners(liveProjector).battleMap = {
      topLeft: { ...copy.topLeft },
      topRight: { ...copy.topRight },
      bottomRight: { ...copy.bottomRight },
      bottomLeft: { ...copy.bottomLeft },
    };
  }
  setStatus(
    "TL1 locked onto map corners — drag one corner; the other three stay put",
    2800
  );
  return true;
}

/**
 * First TL2 grab: snap the purple quad onto the booth so warping starts from
 * a tight stage window (not the map / full frame).
 */
function seedStageContentCornersFromBooth(projector) {
  const content = ensureProjectorContentCorners(projector);
  if (!isFullFrameCorners(content.characterStage)) return false;
  if (typeof renderer.captureCharacterStageContentCorners !== "function") {
    return false;
  }
  const seeded = renderer.captureCharacterStageContentCorners();
  if (!areFaceCornersUsable(seeded)) return false;
  const area = faceCornersArea(seeded);
  // Must be a tight booth window — map-sized seeds caused the huge blue smear.
  if (area < 0.004 || area > 0.35) {
    return false;
  }

  const copy = {
    topLeft: { ...seeded.topLeft },
    topRight: { ...seeded.topRight },
    bottomRight: { ...seeded.bottomRight },
    bottomLeft: { ...seeded.bottomLeft },
  };
  content.characterStage = copy;

  const liveProjector = getProjectorById(
    renderer.venueState,
    state.venue.activeProjectorId
  );
  if (liveProjector) {
    ensureProjectorContentCorners(liveProjector).characterStage = {
      topLeft: { ...copy.topLeft },
      topRight: { ...copy.topRight },
      bottomRight: { ...copy.bottomRight },
      bottomLeft: { ...copy.bottomLeft },
    };
  }
  setStatus(
    "TL2 locked onto the booth — drag each corner to keystone (stays 3D)",
    2600
  );
  return true;
}

function renderContentCornerHandles(projector) {
  const content = ensureProjectorContentCorners(projector);
  const showMap =
    keystoneLayerMode === "all" || keystoneLayerMode === "map";
  const showStage =
    keystoneLayerMode === "all" || keystoneLayerMode === "stage";

  for (const set of CONTENT_HANDLE_SETS) {
    if (set.id === "battleMap" && !showMap) continue;
    if (set.id === "characterStage" && !showStage) continue;
    for (const [cornerKey] of CORNER_ENTRIES) {
      const cornerLabel = set.labels[cornerKey];
      appendCornerHandle({
        label: cornerLabel,
        title:
          set.id === "characterStage"
            ? `${set.title} · ${cornerLabel} — drag to keystone this booth corner`
            : `${set.title} · ${cornerLabel} — first grab locks map corners; drag one, others stay anchored`,
        color: set.color,
        homeInset: set.inset,
        layer: set.id === "battleMap" ? "map" : "stage",
        allowEdgePush: set.id !== "characterStage",
        corner: content[set.id][cornerKey],
        getCorner: () =>
          ensureProjectorContentCorners(projector)[set.id][cornerKey],
        onDragStart:
          set.id === "characterStage"
            ? () => {
                seedStageContentCornersFromBooth(projector);
              }
            : set.id === "battleMap"
              ? () => {
                  seedMapContentCornersFromPlane(projector);
                }
              : null,
        onMove: (nextCorner) => {
          lockFullFrameCorners = false;
          const liveContent = ensureProjectorContentCorners(projector);
          const liveCorners = liveContent[set.id];
          const applied = { x: nextCorner.x, y: nextCorner.y };
          liveCorners[cornerKey].x = applied.x;
          liveCorners[cornerKey].y = applied.y;

          // TL2 keystone — leash + convexity so one corner cannot tear the booth.
          if (set.id === "characterStage") {
            const boothUv =
              typeof renderer.captureCharacterStageContentCorners === "function"
                ? renderer.captureCharacterStageContentCorners()
                : null;
            const mapPlaneUv =
              typeof renderer.captureMapPlaneContentCorners === "function"
                ? renderer.captureMapPlaneContentCorners()
                : null;
            const clamped = constrainStageKeystoneWindow(
              liveCorners,
              boothUv,
              mapPlaneUv,
              { draggedCornerKey: cornerKey }
            );
            liveCorners.topLeft.x = clamped.topLeft.x;
            liveCorners.topLeft.y = clamped.topLeft.y;
            liveCorners.topRight.x = clamped.topRight.x;
            liveCorners.topRight.y = clamped.topRight.y;
            liveCorners.bottomLeft.x = clamped.bottomLeft.x;
            liveCorners.bottomLeft.y = clamped.bottomLeft.y;
            liveCorners.bottomRight.x = clamped.bottomRight.x;
            liveCorners.bottomRight.y = clamped.bottomRight.y;
            applied.x = liveCorners[cornerKey].x;
            applied.y = liveCorners[cornerKey].y;
            for (const key of [
              "topLeft",
              "topRight",
              "bottomLeft",
              "bottomRight",
            ]) {
              patchLiveContentCorner("characterStage", key, {
                ...liveCorners[key],
              });
            }
          } else if (set.id === "battleMap") {
            // Soft leash so extreme TL1 yanks don't tear the map texture.
            const mapPlaneUv =
              typeof renderer.captureMapPlaneContentCorners === "function"
                ? renderer.captureMapPlaneContentCorners()
                : null;
            if (mapPlaneUv) {
              const clamped = constrainMapKeystoneWindow(
                liveCorners,
                mapPlaneUv
              );
              liveCorners.topLeft.x = clamped.topLeft.x;
              liveCorners.topLeft.y = clamped.topLeft.y;
              liveCorners.topRight.x = clamped.topRight.x;
              liveCorners.topRight.y = clamped.topRight.y;
              liveCorners.bottomLeft.x = clamped.bottomLeft.x;
              liveCorners.bottomLeft.y = clamped.bottomLeft.y;
              liveCorners.bottomRight.x = clamped.bottomRight.x;
              liveCorners.bottomRight.y = clamped.bottomRight.y;
              applied.x = liveCorners[cornerKey].x;
              applied.y = liveCorners[cornerKey].y;
              for (const key of [
                "topLeft",
                "topRight",
                "bottomLeft",
                "bottomRight",
              ]) {
                patchLiveContentCorner("battleMap", key, {
                  ...liveCorners[key],
                });
              }
            } else {
              patchLiveContentCorner(set.id, cornerKey, applied);
            }
          } else {
            patchLiveContentCorner(set.id, cornerKey, applied);
          }
          scheduleCornerPersist();
          return applied;
        },
        onCommit: () => {
          isDraggingCorner = false;
          renderer.setOrbitEnabled(true);
          state.venue = normalizeVenueState(state.venue);
          renderer.setVenueState(state.venue);
          persistVenueLocally();
          broadcastVenueUpdate();
          renderHandles();
          if (set.id === "characterStage") {
            setStatus("3D stage keystone (TL2) saved", 2200);
          } else if (set.id === "battleMap") {
            setStatus(
              `Map corner ${cornerLabel} saved — other corners stayed anchored`,
              2200
            );
          } else {
            setStatus(`${set.title} keystone (${cornerLabel}) saved`, 2200);
          }
        },
      });
    }
  }
}

function renderVenueHandles() {
  const projector = getProjectorById(state.venue, state.venue.activeProjectorId);
  if (!projector) return false;

  const faceId = projector.faceIds.includes(state.venue.calibrationFaceId)
    ? state.venue.calibrationFaceId
    : projector.faceIds[0];
  if (!faceId) return false;
  if (!projector.faceCorners[faceId]) {
    projector.faceCorners[faceId] = createDefaultFaceCorners(faceId);
  }
  ensureProjectorContentCorners(projector);

  // Whole-projection TL/TR/BR/BL removed — map (TL1) + stage (TL2) only.
  renderContentCornerHandles(projector);
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
        renderer.setProjectorCorners(state.projector.corners);
        scheduleCornerPersist();
        return state.projector.corners[cornerKey];
      },
      onCommit: () => {
        persistCornersLocally();
        broadcastCornerUpdate();
        setStatus("Corners saved · H hide · F11 fullscreen", 2500);
      },
    });
  }
}

function renderHandles() {
  handlesElement.innerHTML = "";
  handlesElement.classList.toggle("hidden", !handlesVisible);
  document.body.classList.toggle("calibrating", handlesVisible);
  if (!handlesVisible) return;

  if (state.venue?.enabled && renderVenueHandles()) return;
  renderLegacyHandles();
}

async function applyScene(nextState, options = {}) {
  const token = ++applyToken;
  const persist = options.persist !== false;
  const defaults = createDefaultSceneState();
  const incomingBattleMap = normalizeBattleMapState({
    ...defaults.battleMap,
    ...(nextState?.battleMap || {}),
  });
  const localBattleMap = normalizeBattleMapState(state.battleMap);
  // Map art can change; booth pose (size/height/backdrop) stays unless Control
  // explicitly sent a character-stage change with the same map.
  const mapOnlySwap =
    incomingBattleMap.mapId !== localBattleMap.mapId &&
    options.preferLocalStageAlignment !== false;
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
    battleMap: incomingBattleMap,
    characterStage: normalizeCharacterStageState(
      mapOnlySwap
        ? state.characterStage
        : {
            ...defaults.characterStage,
            ...(nextState?.characterStage || {}),
          }
    ),
    projector: {
      ...defaults.projector,
      ...(nextState?.projector || {}),
      corners: clampProjectorCorners(
        nextState?.projector?.corners || state.projector.corners
      ),
    },
    venue: normalizeVenueState(nextState?.venue || state.venue),
  };

  // This window owns one projector regardless of what Control has selected.
  if (assignedProjectorId) {
    merged.venue.activeProjectorId = assignedProjectorId;
  }
  merged.venue.enabled = true;

  // Projector output window owns its keystone. Control's repeated sync-scene
  // (stage-ready) must not restore a stale trapezoid or destroy an in-progress
  // TL/TR/BR/BL drag.
  const ownedProjectorId =
    assignedProjectorId || merged.venue.activeProjectorId;
  const localOwned = getProjectorById(state.venue, ownedProjectorId);
  const preservedCorners = {};
  if (localOwned?.faceCorners) {
    for (const faceId of Object.keys(localOwned.faceCorners)) {
      const cornerSet = localOwned.faceCorners[faceId];
      if (!cornerSet) continue;
      preservedCorners[faceId] = {
        topLeft: { ...cornerSet.topLeft },
        topRight: { ...cornerSet.topRight },
        bottomRight: { ...cornerSet.bottomRight },
        bottomLeft: { ...cornerSet.bottomLeft },
      };
    }
  }
  // Stage owns TL1/TL2 content keystones the same way as whole-face corners.
  const preservedContentCorners = localOwned?.contentCorners
    ? {
        battleMap: {
          topLeft: { ...localOwned.contentCorners.battleMap.topLeft },
          topRight: { ...localOwned.contentCorners.battleMap.topRight },
          bottomRight: { ...localOwned.contentCorners.battleMap.bottomRight },
          bottomLeft: { ...localOwned.contentCorners.battleMap.bottomLeft },
        },
        characterStage: {
          topLeft: { ...localOwned.contentCorners.characterStage.topLeft },
          topRight: { ...localOwned.contentCorners.characterStage.topRight },
          bottomRight: {
            ...localOwned.contentCorners.characterStage.bottomRight,
          },
          bottomLeft: { ...localOwned.contentCorners.characterStage.bottomLeft },
        },
      }
    : null;

  for (const projector of merged.venue.projectors || []) {
    // Align workflow: one play-surface face only.
    if (
      projector.projectionMode !== "anamorphic" &&
      (!projector.faceIds?.length || projector.faceIds.length > 1)
    ) {
      projector.faceIds = ["top"];
    }
    if (!projector.faceIds?.length) projector.faceIds = ["top"];

    const isOwned =
      !ownedProjectorId ||
      projector.id === ownedProjectorId ||
      projector.id === localOwned?.id;

    for (const faceId of projector.faceIds) {
      if (lockFullFrameCorners && isOwned) {
        projector.faceCorners[faceId] = resetFaceCornersToFullFrame(faceId);
      } else if (isOwned && preservedCorners[faceId]) {
        projector.faceCorners[faceId] = preservedCorners[faceId];
      } else if (!areFaceCornersHealthy(projector.faceCorners?.[faceId])) {
        projector.faceCorners[faceId] = resetFaceCornersToFullFrame(faceId);
      }
    }

    if (isOwned && preservedContentCorners) {
      projector.contentCorners = preservedContentCorners;
    } else if (!projector.contentCorners) {
      projector.contentCorners = createDefaultContentCorners();
    }
  }

  // After the first sync with a forced reset, keep owning local corners.
  if (lockFullFrameCorners) {
    lockFullFrameCorners = false;
  }

  // Stage stays black outside the warp unless Control explicitly wants backdrop.
  if (typeof nextState?.testBackdrop !== "boolean") {
    merged.testBackdrop = false;
  }

  state = merged;
  await renderer.applySceneState({ ...state, mode: "single" });
  if (token !== applyToken) return;
  renderer.setUseProjectorWarp(true);
  renderer.setVenueState(state.venue);
  // Keep Control-matching camera controls available after every sync.
  if (renderer.getStageViewMode?.() !== "top") {
    renderer.setOrbitEnabled(true);
  }
  syncHotbarToggles();

  const actors = buildActorsForSync(state);
  const results = await renderer.syncActors(actors);
  if (token !== applyToken) return;
  renderer.setSelectedActorIds(state.selectedInstanceIds || []);

  const failed = results.find((result) => result && !result.ok);
  if (failed) {
    setStatus(`Load failed: ${failed.error || "unknown"}`);
  } else {
    const mapLabel = state.battleMap?.enabled
      ? state.battleMap.mapId
      : "no map";
    const label =
      actors.length === 0
        ? `Empty · ${mapLabel}`
        : actors.length === 1
          ? `${actors[0].name} · ${mapLabel}`
          : `${actors.length} characters · ${mapLabel}`;
    setStatus(
      `${label} · D backdrop · Eye hides UI · F fullscreen · Esc / Exit full leaves`,
      4500
    );
  }
  // Persist only after a Control sync (or explicit persist). Boot from LS
  // must not rewrite Home's map before the first sync-scene arrives.
  if (persist) {
    try {
      saveSceneState(state);
    } catch {
      // ignore
    }
  }
  if (!isDraggingCorner && !isDraggingCharacterStage) {
    renderHandles();
    updateCharacterStageHandlePositions();
  }
  syncCastSelectsFromState();
}

async function applyCommand(command) {
  if (!command || !command.type) return;
  try {
    if (command.type === "sync-scene" && command.state) {
      // Keep an in-progress corner / stage resize from being stomped by Control.
      if (isDraggingCorner) return;
      if (isDraggingCharacterStage && command.state.characterStage) {
        command = {
          ...command,
          state: {
            ...command.state,
            characterStage: state.characterStage,
          },
        };
      }
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
      syncHotbarToggles();
      return;
    }
    if (command.type === "custom-maps-changed") {
      await initCustomBattleMaps(true);
      state.battleMap = normalizeBattleMapState(state.battleMap);
      await renderer.setBattleMap(state.battleMap);
      await refreshCastSelectsFromState();
      return;
    }
    if (command.type === "custom-characters-changed") {
      await initCustomCharacters(true);
      await refreshCastSelectsFromState();
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
  if (event.key === CUSTOM_MAPS_SYNC_KEY) {
    void initCustomBattleMaps(true).then(() => refreshCastSelectsFromState());
    return;
  }
  if (event.key === CUSTOM_CHARACTERS_SYNC_KEY) {
    void initCustomCharacters(true).then(() => refreshCastSelectsFromState());
    return;
  }
  if (event.key !== "dungeon-stage-command" || !event.newValue) return;
  try {
    applyCommand(JSON.parse(event.newValue));
  } catch {
    // ignore
  }
});

window.addEventListener("keydown", async (event) => {
  const target = event.target;
  if (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  ) {
    return;
  }

  const key = event.key.toLowerCase();

  if (key === "escape") {
    event.preventDefault();
    if (document.body.classList.contains("presenting")) {
      setPresentingMode(false);
      return;
    }
    const left = await leaveFullscreen();
    if (left) return;
    if (
      Math.abs(viewState.zoom - 1) > 0.01 ||
      Math.abs(viewState.panX) > 1 ||
      Math.abs(viewState.panY) > 1
    ) {
      resetView();
    }
    applyViewTransform();
    return;
  }

  if (key === "p") {
    setPresentingMode(!document.body.classList.contains("presenting"));
    return;
  }

  if (key === "h") {
    handlesVisible = !handlesVisible;
    renderHandles();
    updateCharacterStageHandlePositions();
    syncHotbarToggles();
    setStatus(handlesVisible ? "Handles visible" : "Handles hidden", 1800);
  }
  if (key === "g") {
    state.calibrationGrid = !state.calibrationGrid;
    renderer.setCalibrationGrid(state.calibrationGrid);
    syncHotbarToggles();
    setStatus(
      state.calibrationGrid ? "Calibration grid on" : "Calibration grid off",
      1800
    );
  }
  if (key === "d") {
    setTestBackdrop(!state.testBackdrop);
  }
  if (key === "b") {
    state.showBoxGuide = !state.showBoxGuide;
    renderer.setShowBoxGuide(state.showBoxGuide);
    setStatus(state.showBoxGuide ? "Box guide on" : "Box guide off", 1800);
  }
  if ((key === "f" || key === "f11") && !event.repeat) {
    event.preventDefault();
    await toggleFullscreen();
  }
  if (key === "+" || key === "=" || key === "]") {
    event.preventDefault();
    setViewZoom(viewState.zoom * 1.15);
    setStatus(`Zoom ${Math.round(viewState.zoom * 100)}%`, 1200);
  }
  if (key === "-" || key === "[") {
    event.preventDefault();
    setViewZoom(viewState.zoom / 1.15);
    setStatus(`Zoom ${Math.round(viewState.zoom * 100)}%`, 1200);
  }
  if (key === "0") {
    event.preventDefault();
    fitHandlesInView();
  }
  if (key === "home") {
    event.preventDefault();
    resetView();
  }
  if (key === "r" && event.shiftKey) {
    event.preventDefault();
    resetOwnedCornersToFullFrame();
    return;
  }
  if (key === "r") {
    announceReady();
    setStatus("Asked Control to resync…", 2000);
  }
});

document.addEventListener("fullscreenchange", () => {
  applyViewTransform();
  refreshFullscreenButtons();
  if (!document.fullscreenElement) {
    // Browser fullscreen ended — keep chrome as-is unless Electron is still FS.
    queryElectronFullscreen().then((electronFullscreen) => {
      if (electronFullscreen === false) {
        // stay in presenting if user hid chrome intentionally
      }
    });
  }
});

viewportElement?.addEventListener("contextmenu", (event) => {
  event.preventDefault();
});

viewportElement?.addEventListener(
  "wheel",
  (event) => {
    if (isDraggingCorner) return;
    // 3D view: scroll zooms the camera (OrbitControls). Hold Alt to zoom the
    // calibration board instead (useful when stretching handles past the frame).
    if (
      renderer.getStageViewMode?.() === "perspective" &&
      !event.altKey
    ) {
      return;
    }
    event.preventDefault();
    const direction = event.deltaY > 0 ? 1 / 1.12 : 1.12;
    setViewZoom(viewState.zoom * direction, event.clientX, event.clientY);
  },
  { passive: false }
);

viewportElement?.addEventListener("pointerdown", (event) => {
  if (isDraggingCorner) return;
  if (event.target?.closest?.(".corner-handle")) return;
  // Right-drag = camera orbit. Left-drag = camera pan in 3D (OrbitControls).
  if (event.button === 2) return;
  if (event.button === 0 && renderer.getStageViewMode?.() === "perspective") {
    return;
  }
  // Top mode: left-drag or middle-drag pans the calibration board.
  if (event.button !== 0 && event.button !== 1) return;
  event.preventDefault();
  isPanningView = true;
  panPointerId = event.pointerId;
  panLastX = event.clientX;
  panLastY = event.clientY;
  viewportElement.setPointerCapture(event.pointerId);
});

viewportElement?.addEventListener("pointermove", (event) => {
  if (!isPanningView || event.pointerId !== panPointerId) return;
  viewState.panX += event.clientX - panLastX;
  viewState.panY += event.clientY - panLastY;
  panLastX = event.clientX;
  panLastY = event.clientY;
  applyViewTransform();
});

function endViewPan(event) {
  if (!isPanningView || event.pointerId !== panPointerId) return;
  isPanningView = false;
  panPointerId = null;
  try {
    viewportElement?.releasePointerCapture(event.pointerId);
  } catch {
    // ignore
  }
}

viewportElement?.addEventListener("pointerup", endViewPan);
viewportElement?.addEventListener("pointercancel", endViewPan);
viewportElement?.addEventListener("dblclick", (event) => {
  if (event.target?.closest?.(".corner-handle")) return;
  fitHandlesInView();
});

btnZoomIn?.addEventListener("click", () => {
  setViewZoom(viewState.zoom * 1.2);
  setStatus(`Zoom ${Math.round(viewState.zoom * 100)}%`, 1200);
});
btnZoomOut?.addEventListener("click", () => {
  setViewZoom(viewState.zoom / 1.2);
  setStatus(`Zoom ${Math.round(viewState.zoom * 100)}%`, 1200);
});
btnZoomFit?.addEventListener("click", () => fitHandlesInView());
btnZoomReset?.addEventListener("click", () => resetView());
btnViewMode?.addEventListener("click", () => {
  const current = renderer.getStageViewMode?.() || "top";
  const next = current === "top" ? "perspective" : "top";
  renderer.setStageViewMode(next);
  syncHotbarToggles();
  updateCharacterStageHandlePositions();
  setStatus(
    next === "top"
      ? "Top-down fill — drag ◇ corners or use 3D± to resize stage"
      : "3D view — drag ◇ away from map to grow · toward map to shrink",
    2800
  );
});
btnResetCorners?.addEventListener("click", () => resetOwnedCornersToFullFrame());
btnFullscreen?.addEventListener("click", () => toggleFullscreen());
btnExitFullscreen?.addEventListener("click", () => leaveFullscreen());
btnCloseStage?.addEventListener("click", () => closeStageWindow());
btnChromeToggle?.addEventListener("click", () => {
  setPresentingMode(!document.body.classList.contains("presenting"));
  updateCharacterStageHandlePositions();
});
btnHandlesToggle?.addEventListener("click", () => {
  handlesVisible = !handlesVisible;
  renderHandles();
  updateCharacterStageHandlePositions();
  syncHotbarToggles();
  setStatus(handlesVisible ? "Handles visible" : "Handles hidden", 1800);
});
btnKeystoneLayer?.addEventListener("click", () => {
  const index = KEYSTONE_LAYER_MODES.indexOf(keystoneLayerMode);
  keystoneLayerMode =
    KEYSTONE_LAYER_MODES[(index + 1) % KEYSTONE_LAYER_MODES.length];
  renderHandles();
  syncHotbarToggles();
  const hints = {
    all: "Showing map (TL1) + stage (TL2) handles",
    map: "Battle map TL1 — drag one corner; other three stay anchored",
    stage:
      "3D stage TL2 — drag corners to keystone the booth",
  };
  setStatus(hints[keystoneLayerMode] || hints.all, 2400);
});
btnGridToggle?.addEventListener("click", () => {
  state.calibrationGrid = !state.calibrationGrid;
  renderer.setCalibrationGrid(state.calibrationGrid);
  syncHotbarToggles();
  setStatus(
    state.calibrationGrid ? "Calibration grid on" : "Calibration grid off",
    1800
  );
});
btnBackdropToggle?.addEventListener("click", () => {
  setTestBackdrop(!state.testBackdrop);
});

btnStageSizeDown?.addEventListener("click", async () => {
  const current = normalizeCharacterStageState(state.characterStage);
  if (!current.enabled) return;
  const nextSize = Math.max(MIN_SIZE, Number((current.size - 0.08).toFixed(2)));
  await applyCharacterStageSize(nextSize);
});
btnStageSizeUp?.addEventListener("click", async () => {
  const current = normalizeCharacterStageState(state.characterStage);
  if (!current.enabled) return;
  const nextSize = Math.min(MAX_SIZE, Number((current.size + 0.08).toFixed(2)));
  await applyCharacterStageSize(nextSize);
});

castMapSelect?.addEventListener("change", () => {
  if (suppressCastSelectEvents) return;
  void applyCastBattleMap(castMapSelect.value);
});
castCharacterSelect?.addEventListener("change", () => {
  if (suppressCastSelectEvents) return;
  void applyCastCharacter(castCharacterSelect.value);
});

applyViewTransform();
syncHotbarToggles();
void refreshCastSelectsFromState();
ensureCharacterStageHandles();
startCharacterStageHandleLoop();
refreshFullscreenButtons();
bumpCursorActivity();
window.setTimeout(() => refreshFullscreenButtons(), 500);
window.setTimeout(() => refreshFullscreenButtons(), 1500);

for (const eventName of ["pointermove", "pointerdown", "wheel", "keydown"]) {
  window.addEventListener(eventName, bumpCursorActivity, { passive: true });
}

window.addEventListener("resize", () => {
  renderer.resize();
  refreshFullscreenButtons();
  bumpCursorActivity();
});

window.addEventListener("beforeunload", () => {
  persistCornersLocally();
});

const startup = loadSceneState();
startup.testBackdrop = false;
startup.venue = normalizeVenueState(startup.venue);
startup.venue.enabled = true;
if (assignedProjectorId) {
  startup.venue.activeProjectorId = assignedProjectorId;
}
if (lockFullFrameCorners) {
  for (const projector of startup.venue.projectors || []) {
    if (!projector.faceIds?.length) projector.faceIds = ["top"];
    for (const faceId of projector.faceIds) {
      projector.faceCorners[faceId] = resetFaceCornersToFullFrame(faceId);
    }
  }
}
// One-shot: clear any saved TL2 keystone from the broken booth-smear builds.
// Users re-lock TL2 with a fresh grab after Reset / reload.
for (const projector of startup.venue.projectors || []) {
  ensureProjectorContentCorners(projector).characterStage =
    createDefaultFaceCorners("top");
}
// Boot from LS without persisting — Home may have just flushed a newer map;
// announceReady pulls that sync-scene before we write LS again.
initCustomBattleMaps()
  .catch((error) => {
    console.warn("Custom battle maps failed to load", error);
  })
  .finally(() =>
    initCustomCharacters().catch((error) => {
      console.warn("Custom characters failed to load", error);
    })
  )
  .finally(() => {
    state.battleMap = normalizeBattleMapState(state.battleMap);
    startup.battleMap = normalizeBattleMapState(startup.battleMap);
    applyScene(startup, { persist: false })
      .catch(() => applyScene(createDefaultSceneState(), { persist: false }))
      .finally(() => {
        announceReady();
        window.setTimeout(announceReady, 300);
        window.setTimeout(announceReady, 1000);
      });
  });
