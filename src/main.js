import { StageRenderer } from "./stage.js";
import {
  loadSceneState,
  saveSceneState,
  patchSceneState,
  cloneSceneState,
  createDefaultSceneState,
  buildActiveActor,
  buildActorsForSync,
  characterCatalog,
  getCharacterByIndex,
  getFocusedCharacter,
  getActorInstance,
  addActorToMap,
  removeActorFromMap,
  removeOneActorOfType,
  clampPlacementAxis,
  clampElevation,
  clampRotation,
  clampProjectorCorners,
} from "./sceneState.js";
import {
  battleMapCategories,
  normalizeBattleMapState,
} from "./battleMaps.js";
import { voicemodClient } from "./voicemodClient.js";
import { initVoiceLab } from "./voiceLabUi.js";
import { getProjectorById, normalizeVenueState, resetFaceCornersToFullFrame } from "./venueGeometry.js";
import { normalizeStageFxState } from "./fx/stageFxState.js";
import { createVenuePanel } from "./ui/venuePanel.js";
import { createStageFxPanel } from "./ui/stageFxPanel.js";
import { createCharacterStagePanel } from "./ui/characterStagePanel.js";
import { initRailResize } from "./ui/railResize.js";
import { openProjectorOutputWindow } from "./displayOutput.js";
import { normalizeCharacterStageState } from "./characterStage.js";

const channel = new BroadcastChannel("dungeon-stage");

const characterNameElement = document.getElementById("character-name");
const characterListElement = document.getElementById("character-list");
const onMapRosterElement = document.getElementById("on-map-roster");
const onMapEmptyElement = document.getElementById("on-map-empty");
const onMapCountElement = document.getElementById("on-map-count");
const selectionSummaryElement = document.getElementById("selection-summary");
const selectionMarqueeElement = document.getElementById("selection-marquee");
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
const posElevation = document.getElementById("pos-elevation");
const posRotation = document.getElementById("pos-rotation");
const posHover = document.getElementById("pos-hover");
const posXOut = document.getElementById("pos-x-out");
const posZOut = document.getElementById("pos-z-out");
const posScaleOut = document.getElementById("pos-scale-out");
const posElevationOut = document.getElementById("pos-elevation-out");
const posRotationOut = document.getElementById("pos-rotation-out");
const venuePanelMount = document.getElementById("venue-panel-mount");
const stageFxPanelMount = document.getElementById("stage-fx-panel-mount");
const characterStagePanelMount = document.getElementById(
  "character-stage-panel-mount"
);

let state = loadSceneState();
if (!state.voiceLab) {
  state.voiceLab = createDefaultSceneState().voiceLab;
}
if (!Array.isArray(state.actorsOnMap)) {
  state.actorsOnMap = createDefaultSceneState().actorsOnMap;
}
if (!Array.isArray(state.selectedInstanceIds)) {
  state.selectedInstanceIds = state.actorsOnMap[0]
    ? [state.actorsOnMap[0].instanceId]
    : [];
}
state.battleMap = normalizeBattleMapState(
  state.battleMap || createDefaultSceneState().battleMap
);
state.venue = normalizeVenueState(state.venue || createDefaultSceneState().venue);
state.stageFx = normalizeStageFxState(
  state.stageFx || createDefaultSceneState().stageFx
);
state.characterStage = normalizeCharacterStageState(
  state.characterStage || createDefaultSceneState().characterStage
);
let stageWindow = null;
const projectorWindows = new Map();
let broadcastTimer = 0;
let autosaveTimer = 0;
let syncToken = 0;
let stageLastSeenAt = 0;
let isDraggingModel = false;
let isRotatingModel = false;
let isDraggingProjector = false;
let isMarqueeSelecting = false;
let modelDragPointerId = null;
let groupDragSnapshot = null;
let rotateDragSnapshot = null;
let projectorDragSnapshot = null;
let marqueeOrigin = null;

const voiceLab = initVoiceLab({
  getState: () => state,
  saveState: () => saveSceneState(state),
  getCharacter: () => getFocusedCharacter(state),
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

function selectedActors() {
  const selected = new Set(state.selectedInstanceIds || []);
  return (state.actorsOnMap || []).filter((instance) =>
    selected.has(instance.instanceId)
  );
}

function primarySelectedActor() {
  const selected = selectedActors();
  return selected[0] || null;
}

function setSelection(instanceIds, options = {}) {
  const available = new Set(
    (state.actorsOnMap || []).map((instance) => instance.instanceId)
  );
  const next = [...new Set(instanceIds)].filter((id) => available.has(id));
  state.selectedInstanceIds = next;
  previewRenderer.setSelectedActorIds(next);
  if (options.syncFocus !== false && next[0]) {
    const instance = getActorInstance(state, next[0]);
    if (instance) {
      const catalogIndex = characterCatalog.findIndex(
        (character) => character.id === instance.characterId
      );
      if (catalogIndex >= 0) state.characterIndex = catalogIndex;
    }
  }
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
    // Re-read the selected map from the Home UI so Align/Stage never get an
    // in-memory battleMap that lagged behind the thumb selection.
    readBattleMapUiIntoState();
    saveSceneState(state);
    broadcastFullState(true);
    return;
  }
  if (command.type === "corners-updated" && command.corners) {
    stageLastSeenAt = Date.now();
    applyIncomingCorners(command.corners);
    return;
  }
  if (command.type === "character-stage-updated" && command.characterStage) {
    stageLastSeenAt = Date.now();
    state.characterStage = normalizeCharacterStageState(command.characterStage);
    characterStagePanel?.syncFromState();
    updatePlacementModeUi();
    syncScene({ immediate: true });
    previewStatus.textContent = `3D stage size ${state.characterStage.size.toFixed(2)}`;
    return;
  }
  if (command.type === "backdrop-updated") {
    stageLastSeenAt = Date.now();
    if (typeof command.testBackdrop === "boolean") {
      state.testBackdrop = command.testBackdrop;
      document.getElementById("test-backdrop").checked = state.testBackdrop;
      previewRenderer.setTestBackdrop(state.testBackdrop);
      patchSceneState({ testBackdrop: state.testBackdrop });
      previewStatus.textContent = state.testBackdrop
        ? "Backdrop on (from Stage)"
        : "Backdrop off (from Stage)";
    }
    return;
  }
  if (command.type === "stage-content-updated") {
    stageLastSeenAt = Date.now();
    if (command.battleMap) {
      state.battleMap = normalizeBattleMapState(command.battleMap);
      const mapSelect = document.getElementById("battle-map-select");
      const enabledInput = document.getElementById("battle-map-enabled");
      if (mapSelect) mapSelect.value = state.battleMap.mapId;
      if (enabledInput) enabledInput.checked = state.battleMap.enabled;
      document
        .getElementById("battle-map-thumbs")
        ?.querySelectorAll(".map-thumb")
        .forEach((button) => {
          const selected = button.dataset.mapId === state.battleMap.mapId;
          button.classList.toggle("is-selected", selected);
          button.setAttribute("aria-selected", selected ? "true" : "false");
        });
    }
    if (Array.isArray(command.actorsOnMap)) {
      state.actorsOnMap = command.actorsOnMap;
    }
    if (Array.isArray(command.selectedInstanceIds)) {
      state.selectedInstanceIds = command.selectedInstanceIds;
    }
    if (Number.isFinite(Number(command.characterIndex))) {
      state.characterIndex = Math.floor(Number(command.characterIndex));
    }
    // Prefer Stage's live alignment so Control never rewrites a pre-swap
    // keystone over the throw the projector just kept.
    if (command.characterStage) {
      state.characterStage = normalizeCharacterStageState(command.characterStage);
      characterStagePanel?.syncFromState();
      updatePlacementModeUi();
    }
    if (command.venue) {
      state.venue = normalizeVenueState(command.venue);
      venuePanel?.refresh();
    }
    // Stage already applied the throw — update Control preview only.
    // Do not broadcastFullState / saveSceneState(full); patch keeps Stage's
    // venue/keystone authoritative in localStorage.
    applyLocalVisuals();
    previewRenderer.syncActors(buildActorsForSync(state)).then(() => {
      previewRenderer.setSelectedActorIds(state.selectedInstanceIds || []);
      renderCharacterList();
      renderPlacementControls();
    });
    patchSceneState({
      battleMap: state.battleMap,
      actorsOnMap: state.actorsOnMap,
      selectedInstanceIds: state.selectedInstanceIds,
      characterIndex: state.characterIndex,
      characterStage: state.characterStage,
      venue: state.venue,
    });
    const castName =
      getFocusedCharacter(state)?.name ||
      (state.actorsOnMap?.length ? "character" : "empty stage");
    previewStatus.textContent = `Stage cast · ${state.battleMap.mapId} · ${castName}`;
    return;
  }
  // Face calibration / projector posing from Stage or Mapping Studio.
  if (command.type === "venue-updated" && command.venue) {
    stageLastSeenAt = Date.now();
    const incoming = normalizeVenueState(command.venue);
    const incomingProjector = getProjectorById(
      incoming,
      command.projectorId || incoming.activeProjectorId
    );
    if (incomingProjector) {
      state.venue = normalizeVenueState({
        ...state.venue,
        enabled: incoming.enabled || state.venue.enabled,
        showFrustumHelpers:
          incoming.showFrustumHelpers ?? state.venue.showFrustumHelpers,
        showFaceOutlines:
          incoming.showFaceOutlines ?? state.venue.showFaceOutlines,
        activeProjectorId:
          incoming.activeProjectorId || state.venue.activeProjectorId,
        projectors: state.venue.projectors.map((projector) =>
          projector.id === incomingProjector.id
            ? {
                ...projector,
                ...incomingProjector,
                faceCorners: incomingProjector.faceCorners,
                contentCorners: incomingProjector.contentCorners,
                viewer: incomingProjector.viewer,
                projectionMode: incomingProjector.projectionMode,
              }
            : projector
        ),
      });
      venuePanel?.refresh();
      applyLocalVisuals();
      scheduleAutosave();
      previewStatus.textContent = "Venue updated from Mapping Studio / projector";
    }
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

function countActorsByCharacterId(characterId) {
  return (state.actorsOnMap || []).filter(
    (instance) => instance.characterId === characterId
  ).length;
}

function renderOnMapRoster() {
  if (!onMapRosterElement) return;
  const actors = state.actorsOnMap || [];
  const selected = new Set(state.selectedInstanceIds || []);
  onMapRosterElement.innerHTML = "";
  onMapRosterElement.classList.toggle("is-empty", actors.length === 0);
  if (onMapEmptyElement) {
    onMapEmptyElement.classList.toggle("hidden", actors.length > 0);
  }
  if (onMapCountElement) {
    const stageOn = isCharacterStageEnabled();
    const placeLabel = stageOn ? "stage" : "map";
    onMapCountElement.textContent =
      actors.length === 1
        ? `1 on ${placeLabel}`
        : `${actors.length} on ${placeLabel}`;
  }
  const rosterLabel = document.getElementById("roster-stage-label");
  if (rosterLabel) {
    rosterLabel.textContent = isCharacterStageEnabled()
      ? "On the 3D stage"
      : "On the map";
  }
  if (selectionSummaryElement) {
    const count = selected.size;
    selectionSummaryElement.textContent =
      count === 0
        ? "None selected"
        : count === 1
          ? "1 selected"
          : `${count} selected`;
  }

  actors.forEach((instance, index) => {
    const character =
      characterCatalog.find((entry) => entry.id === instance.characterId) ||
      null;
    const row = document.createElement("li");
    row.className = "roster-row";
    if (selected.has(instance.instanceId)) row.classList.add("is-selected");

    const main = document.createElement("div");
    main.className = "roster-row-main";
    const name = document.createElement("span");
    name.className = "roster-row-name";
    name.textContent = character?.name || instance.characterId;
    const meta = document.createElement("span");
    meta.className = "roster-row-meta";
    meta.textContent = `#${index + 1}`;
    main.append(name, meta);

    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "qty-btn qty-remove";
    removeButton.title = `Remove ${character?.name || "character"}`;
    removeButton.setAttribute(
      "aria-label",
      `Remove ${character?.name || "character"}`
    );
    removeButton.textContent = "−";
    removeButton.addEventListener("click", async (event) => {
      event.stopPropagation();
      removeActorFromMap(state, instance.instanceId);
      if (!state.selectedInstanceIds.length && state.actorsOnMap[0]) {
        setSelection([state.actorsOnMap[0].instanceId]);
      } else {
        setSelection(state.selectedInstanceIds);
      }
      await syncScene({ immediate: true });
    });

    row.append(main, removeButton);
    row.addEventListener("click", async () => {
      setSelection([instance.instanceId]);
      renderPlacementControls();
      previewRenderer.setSelectedActorIds(state.selectedInstanceIds);
      await voiceLab.applyForCharacter(getFocusedCharacter(state), "select");
      if (state.voicemod.autoApplyOnSelect) {
        await applyCurrentVoice("select");
      }
      broadcastFullState();
      scheduleAutosave();
    });
    onMapRosterElement.appendChild(row);
  });
}

function renderCharacterList() {
  characterListElement.innerHTML = "";
  characterCatalog.forEach((character, index) => {
    const item = document.createElement("li");
    if (index === state.characterIndex) item.classList.add("active");

    const nameButton = document.createElement("button");
    nameButton.type = "button";
    nameButton.className = "kit-name";
    nameButton.textContent = `${index + 1}. ${character.name}`;
    nameButton.addEventListener("click", async () => {
      state.characterIndex = index;
      renderPlacementControls();
      await voiceLab.applyForCharacter(
        getCharacterByIndex(state.characterIndex),
        "select"
      );
      if (state.voicemod.autoApplyOnSelect) {
        await applyCurrentVoice("select");
      }
      scheduleAutosave();
    });

    const count = document.createElement("span");
    count.className = "kit-count";
    const onMapCount = countActorsByCharacterId(character.id);
    count.textContent = onMapCount > 0 ? String(onMapCount) : "";

    const addButton = document.createElement("button");
    addButton.type = "button";
    addButton.className = "qty-btn";
    addButton.title = `Add ${character.name} to map`;
    addButton.setAttribute("aria-label", `Add ${character.name}`);
    addButton.textContent = "+";
    addButton.addEventListener("click", async (event) => {
      event.stopPropagation();
      state.characterIndex = index;
      addActorToMap(state, character.id);
      setSelection(state.selectedInstanceIds);
      await syncScene({ immediate: true });
      await voiceLab.applyForCharacter(getFocusedCharacter(state), "select");
      if (state.voicemod.autoApplyOnSelect) {
        await applyCurrentVoice("select");
      }
      previewStatus.textContent = `${character.name} added to map`;
    });

    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "qty-btn qty-remove";
    removeButton.title = `Remove one ${character.name}`;
    removeButton.setAttribute("aria-label", `Remove one ${character.name}`);
    removeButton.textContent = "−";
    removeButton.disabled = onMapCount === 0;
    removeButton.addEventListener("click", async (event) => {
      event.stopPropagation();
      if (!removeOneActorOfType(state, character.id)) return;
      setSelection(state.selectedInstanceIds);
      await syncScene({ immediate: true });
      previewStatus.textContent = `${character.name} removed`;
    });

    item.append(nameButton, count, addButton, removeButton);
    characterListElement.appendChild(item);
  });
}

function isCharacterStageEnabled() {
  return state.characterStage?.enabled !== false;
}

function updatePlacementModeUi() {
  const stageOn = isCharacterStageEnabled();
  const isMove = state.placementMode === "move" && !stageOn;
  const moveControls = document.getElementById("move-controls");
  const hint = document.getElementById("placement-hint");
  const previewWrap = document.querySelector(".preview-stage-wrap");
  const warpOn = Boolean(document.getElementById("preview-warp")?.checked);
  moveControls?.classList.toggle("hidden", !isMove || stageOn);
  previewWrap?.classList.toggle("move-mode", isMove && !warpOn && !stageOn);
  previewWrap?.classList.toggle(
    "dragging-model",
    isDraggingModel || isDraggingProjector || isRotatingModel
  );
  previewWrap?.classList.toggle("rotating-model", isRotatingModel);
  previewWrap?.classList.toggle("selecting-marquee", isMarqueeSelecting);
  if (hint) {
    if (stageOn) {
      hint.textContent =
        "3D stage is on — creatures stay centered in the booth. Resize the square (or Size / Facing) to tweak them.";
    } else if (isMove) {
      hint.textContent = warpOn
        ? "Turn off Preview projector warp to drag and box-select on the live preview. Sliders still work."
        : "Drag characters or projector cameras. Middle-drag a character to rotate. Scroll to zoom, right-drag to orbit, middle-drag empty space to pan. Shift-drag a projector to raise/lower it.";
    } else {
      hint.textContent =
        "Dragging is off. Adjust size or facing for the selected character(s).";
    }
  }
  document
    .querySelectorAll('input[name="placement-mode"]')
    .forEach((input) => {
      input.checked = input.value === state.placementMode;
    });
}

function updatePlacementReadouts() {
  const primary = primarySelectedActor();
  const selected = selectedActors();
  if (!primary) {
    posX.value = "0";
    posZ.value = "0";
    posXOut.textContent = "0.00";
    posZOut.textContent = "0.00";
    if (posElevation) posElevation.value = "0";
    if (posElevationOut) posElevationOut.textContent = "0.00";
    if (posRotation) posRotation.value = "0";
    if (posRotationOut) posRotationOut.textContent = "0°";
    return;
  }
  if (selected.length === 1) {
    posX.value = String(primary.x);
    posZ.value = String(primary.z);
    posXOut.textContent = Number(primary.x).toFixed(2);
    posZOut.textContent = Number(primary.z).toFixed(2);
  } else {
    posXOut.textContent = "group";
    posZOut.textContent = "group";
  }

  const elevation = clampElevation(primary.elevation);
  if (posElevation) posElevation.value = String(elevation);
  if (posElevationOut) posElevationOut.textContent = elevation.toFixed(2);
  const rotation = clampRotation(primary.rotation);
  if (posRotation) posRotation.value = String(Math.round(rotation));
  if (posRotationOut) posRotationOut.textContent = `${Math.round(rotation)}°`;
  if (posHover) posHover.checked = primary.hover === true;
}

function hideMarquee() {
  if (!selectionMarqueeElement) return;
  selectionMarqueeElement.classList.add("hidden");
  selectionMarqueeElement.style.width = "0px";
  selectionMarqueeElement.style.height = "0px";
}

function updateMarqueeElement(originX, originY, clientX, clientY) {
  if (!selectionMarqueeElement) return;
  const previewWrap = document.querySelector(".preview-stage-wrap");
  if (!previewWrap) return;
  const bounds = previewWrap.getBoundingClientRect();
  const left = Math.min(originX, clientX) - bounds.left;
  const top = Math.min(originY, clientY) - bounds.top;
  const width = Math.abs(clientX - originX);
  const height = Math.abs(clientY - originY);
  selectionMarqueeElement.classList.remove("hidden");
  selectionMarqueeElement.style.left = `${left}px`;
  selectionMarqueeElement.style.top = `${top}px`;
  selectionMarqueeElement.style.width = `${width}px`;
  selectionMarqueeElement.style.height = `${height}px`;
}

async function applyGroupDrag(floorHit) {
  if (!floorHit || !groupDragSnapshot) return;
  const deltaX = floorHit.x - groupDragSnapshot.originX;
  const deltaZ = floorHit.z - groupDragSnapshot.originZ;
  const syncActors = buildActorsForSync(state).map((actor) => {
    const snapshot = groupDragSnapshot.actors.find(
      (entry) => entry.instanceId === actor.id
    );
    if (!snapshot) return actor;
    const instance = getActorInstance(state, snapshot.instanceId);
    if (!instance) return actor;
    instance.x = clampPlacementAxis(snapshot.startX + deltaX);
    instance.z = clampPlacementAxis(snapshot.startZ + deltaZ);
    return {
      ...actor,
      x: instance.x,
      z: instance.z,
    };
  });

  let needsFullSync = false;
  for (const actor of syncActors) {
    if (!groupDragSnapshot.actors.some((entry) => entry.instanceId === actor.id)) {
      continue;
    }
    if (!previewRenderer.setActorTransform(actor)) {
      needsFullSync = true;
      break;
    }
  }
  if (needsFullSync) {
    await previewRenderer.syncActors(syncActors);
  }

  updatePlacementReadouts();
  broadcastFullState();
  scheduleAutosave();
}

async function applyGroupRotate(clientX) {
  if (!rotateDragSnapshot) return;
  const degreesPerPixel = 0.45;
  const deltaRotation =
    (clientX - rotateDragSnapshot.originClientX) * degreesPerPixel;
  const syncActors = buildActorsForSync(state).map((actor) => {
    const snapshot = rotateDragSnapshot.actors.find(
      (entry) => entry.instanceId === actor.id
    );
    if (!snapshot) return actor;
    const instance = getActorInstance(state, snapshot.instanceId);
    if (!instance) return actor;
    instance.rotation = clampRotation(snapshot.startRotation + deltaRotation);
    state.placement.rotation = instance.rotation;
    return {
      ...actor,
      rotation: instance.rotation,
    };
  });

  let needsFullSync = false;
  for (const actor of syncActors) {
    if (
      !rotateDragSnapshot.actors.some(
        (entry) => entry.instanceId === actor.id
      )
    ) {
      continue;
    }
    if (!previewRenderer.setActorTransform(actor)) {
      needsFullSync = true;
      break;
    }
  }
  if (needsFullSync) {
    await previewRenderer.syncActors(syncActors);
  }

  updatePlacementReadouts();
  broadcastFullState();
  scheduleAutosave();
}

function bindModelDrag() {
  const previewWrap = document.querySelector(".preview-stage-wrap");
  if (!previewWrap) return;

  const canInteract = () =>
    state.placementMode === "move" &&
    !document.getElementById("preview-warp")?.checked;

  const canDragActors = () => canInteract() && !isCharacterStageEnabled();

  const canDragProjectors = () =>
    Boolean(state.venue?.showFrustumHelpers) &&
    !document.getElementById("preview-warp")?.checked;

  const applyProjectorDrag = (event) => {
    if (!projectorDragSnapshot) return;
    const { projectorId, originClientY } = projectorDragSnapshot;
    let nextY = projectorDragSnapshot.currentY;

    if (event.shiftKey || projectorDragSnapshot.heightMode) {
      const deltaPixels = originClientY - event.clientY;
      nextY = projectorDragSnapshot.startY + deltaPixels * 0.012;
      projectorDragSnapshot.heightMode = true;
      projectorDragSnapshot.currentY = nextY;
    }

    const plane = previewRenderer.hitHorizontalPlane(
      event.clientX,
      event.clientY,
      nextY
    );
    if (!plane) return;
    projectorDragSnapshot.currentY = nextY;
    const nextVenue = previewRenderer.setProjectorWorldPosition(projectorId, {
      x: plane.x,
      y: nextY,
      z: plane.z,
    });
    state.venue = nextVenue;
  };

  // Capture phase so middle-click on a character rotates instead of orbit pan.
  previewWrap.addEventListener(
    "pointerdown",
    (event) => {
      if (event.button !== 1) return;
      if (
        isDraggingModel ||
        isRotatingModel ||
        isDraggingProjector ||
        isMarqueeSelecting
      ) {
        return;
      }
      if (event.target.closest?.(".corner-handle")) return;
      if (!canInteract()) return;

      const picked = previewRenderer.pickActor(event.clientX, event.clientY);
      if (!picked) return;

      event.preventDefault();
      event.stopPropagation();

      const alreadySelected = (state.selectedInstanceIds || []).includes(
        picked.id
      );
      if (!alreadySelected) {
        setSelection([picked.id]);
      }

      const selected = selectedActors();
      if (!selected.length) return;

      isRotatingModel = true;
      modelDragPointerId = event.pointerId;
      rotateDragSnapshot = {
        originClientX: event.clientX,
        actors: selected.map((instance) => ({
          instanceId: instance.instanceId,
          startRotation: clampRotation(instance.rotation),
        })),
      };
      previewWrap.setPointerCapture(event.pointerId);
      previewRenderer.setOrbitEnabled(false);
      updatePlacementModeUi();
      renderOnMapRoster();
      previewStatus.textContent =
        selected.length > 1
          ? `Rotating ${selected.length} characters…`
          : `Rotating ${getFocusedCharacter(state)?.name || "character"}…`;
    },
    true
  );

  previewWrap.addEventListener("pointerdown", async (event) => {
    if (
      event.button !== 0 ||
      isDraggingModel ||
      isRotatingModel ||
      isDraggingProjector ||
      isMarqueeSelecting
    ) {
      return;
    }
    if (event.target.closest?.(".corner-handle")) return;

    // Projector cameras first — same grab-and-aim workflow as TD mapping.
    if (canDragProjectors()) {
      const pickedProjector = previewRenderer.pickProjector(
        event.clientX,
        event.clientY
      );
      if (pickedProjector) {
        event.preventDefault();
        isDraggingProjector = true;
        modelDragPointerId = event.pointerId;
        projectorDragSnapshot = {
          projectorId: pickedProjector.projectorId,
          startX: pickedProjector.x,
          startY: pickedProjector.y,
          startZ: pickedProjector.z,
          currentY: pickedProjector.y,
          originClientY: event.clientY,
          heightMode: Boolean(event.shiftKey),
        };
        state.venue = {
          ...state.venue,
          activeProjectorId: pickedProjector.projectorId,
        };
        previewRenderer.setVenueState(state.venue);
        venuePanel?.refresh();
        previewWrap.setPointerCapture(event.pointerId);
        previewRenderer.setOrbitEnabled(false);
        updatePlacementModeUi();
        previewStatus.textContent = event.shiftKey
          ? "Raising / lowering projector…"
          : "Aiming projector — scroll to dolly closer/further · Shift for height";
        return;
      }
    }

    if (!canInteract()) return;

    const picked = previewRenderer.pickActor(event.clientX, event.clientY);
    if (picked) {
      const alreadySelected = (state.selectedInstanceIds || []).includes(
        picked.id
      );
      if (event.shiftKey || event.ctrlKey || event.metaKey) {
        const next = new Set(state.selectedInstanceIds || []);
        if (next.has(picked.id)) next.delete(picked.id);
        else next.add(picked.id);
        setSelection([...next]);
      } else if (!alreadySelected) {
        setSelection([picked.id]);
      }

      const selected = selectedActors();
      if (!selected.length) return;

      // Stage mode: select only — characters are fixed in the booth.
      if (!canDragActors()) {
        renderOnMapRoster();
        renderPlacementControls();
        broadcastFullState();
        scheduleAutosave();
        previewStatus.textContent = isCharacterStageEnabled()
          ? "On 3D stage — resize the square to scale creatures"
          : `Selected ${getFocusedCharacter(state)?.name || "character"}`;
        return;
      }

      const floor = previewRenderer.hitBoxFloor(event.clientX, event.clientY);
      if (!floor) return;

      event.preventDefault();
      isDraggingModel = true;
      modelDragPointerId = event.pointerId;
      groupDragSnapshot = {
        originX: floor.x,
        originZ: floor.z,
        actors: selected.map((instance) => ({
          instanceId: instance.instanceId,
          startX: instance.x,
          startZ: instance.z,
        })),
      };
      previewWrap.setPointerCapture(event.pointerId);
      previewRenderer.setOrbitEnabled(false);
      updatePlacementModeUi();
      renderOnMapRoster();
      previewStatus.textContent =
        selected.length > 1
          ? `Moving ${selected.length} characters…`
          : `Dragging ${getFocusedCharacter(state)?.name || "character"}…`;
      return;
    }

    // Empty floor → marquee select
    const floor = previewRenderer.hitBoxFloor(event.clientX, event.clientY);
    if (!floor) return;
    event.preventDefault();
    isMarqueeSelecting = true;
    modelDragPointerId = event.pointerId;
    marqueeOrigin = { x: event.clientX, y: event.clientY };
    if (!(event.shiftKey || event.ctrlKey || event.metaKey)) {
      setSelection([]);
      renderOnMapRoster();
    }
    previewWrap.setPointerCapture(event.pointerId);
    updateMarqueeElement(
      marqueeOrigin.x,
      marqueeOrigin.y,
      event.clientX,
      event.clientY
    );
    updatePlacementModeUi();
  });

  previewWrap.addEventListener("pointermove", async (event) => {
    if (isDraggingProjector && event.pointerId === modelDragPointerId) {
      applyProjectorDrag(event);
      return;
    }

    if (isRotatingModel && event.pointerId === modelDragPointerId) {
      await applyGroupRotate(event.clientX);
      return;
    }

    if (isMarqueeSelecting && event.pointerId === modelDragPointerId) {
      updateMarqueeElement(
        marqueeOrigin.x,
        marqueeOrigin.y,
        event.clientX,
        event.clientY
      );
      return;
    }

    if (!isDraggingModel || event.pointerId !== modelDragPointerId) {
      if (
        isDraggingModel ||
        isRotatingModel ||
        isDraggingProjector ||
        isMarqueeSelecting ||
        (!canInteract() && !canDragProjectors())
      ) {
        previewWrap.classList.remove("over-model");
        return;
      }
      const overProjector =
        canDragProjectors() &&
        Boolean(previewRenderer.pickProjector(event.clientX, event.clientY));
      const overModel =
        canInteract() &&
        Boolean(previewRenderer.pickActor(event.clientX, event.clientY));
      previewWrap.classList.toggle("over-model", overModel || overProjector);
      return;
    }

    const floor = previewRenderer.hitBoxFloor(event.clientX, event.clientY);
    if (!floor) return;
    await applyGroupDrag(floor);
  });

  const endPointer = async (event) => {
    if (event.pointerId !== modelDragPointerId) return;

    if (isDraggingProjector) {
      isDraggingProjector = false;
      modelDragPointerId = null;
      projectorDragSnapshot = null;
      previewRenderer.setOrbitEnabled(true);
      try {
        previewWrap.releasePointerCapture(event.pointerId);
      } catch {
        // already released
      }
      state.venue = normalizeVenueState(previewRenderer.venueState);
      venuePanel?.refresh();
      saveSceneState(state);
      updatePlacementModeUi();
      await syncScene({ immediate: true });
      previewStatus.textContent = "Projector aimed";
      return;
    }

    if (isRotatingModel) {
      isRotatingModel = false;
      modelDragPointerId = null;
      rotateDragSnapshot = null;
      previewRenderer.setOrbitEnabled(true);
      try {
        previewWrap.releasePointerCapture(event.pointerId);
      } catch {
        // already released
      }
      updatePlacementModeUi();
      await syncScene({ immediate: true });
      const count = selectedActors().length;
      previewStatus.textContent =
        count > 1
          ? `${count} characters rotated`
          : `${getFocusedCharacter(state)?.name || "Character"} rotated`;
      return;
    }

    if (isMarqueeSelecting) {
      isMarqueeSelecting = false;
      const ids = previewRenderer.pickActorsInClientRect(
        marqueeOrigin.x,
        marqueeOrigin.y,
        event.clientX,
        event.clientY
      );
      const additive = event.shiftKey || event.ctrlKey || event.metaKey;
      if (additive) {
        setSelection([
          ...new Set([...(state.selectedInstanceIds || []), ...ids]),
        ]);
      } else {
        setSelection(ids);
      }
      hideMarquee();
      marqueeOrigin = null;
      modelDragPointerId = null;
      try {
        previewWrap.releasePointerCapture(event.pointerId);
      } catch {
        // already released
      }
      updatePlacementModeUi();
      renderPlacementControls();
      const count = state.selectedInstanceIds.length;
      previewStatus.textContent =
        count === 0
          ? "Selection cleared"
          : count === 1
            ? `${getFocusedCharacter(state)?.name || "Character"} selected`
            : `${count} characters selected`;
      broadcastFullState();
      scheduleAutosave();
      return;
    }

    if (!isDraggingModel) return;
    isDraggingModel = false;
    modelDragPointerId = null;
    groupDragSnapshot = null;
    previewRenderer.setOrbitEnabled(true);
    try {
      previewWrap.releasePointerCapture(event.pointerId);
    } catch {
      // already released
    }
    updatePlacementModeUi();
    await syncScene({ immediate: true });
    const count = selectedActors().length;
    previewStatus.textContent =
      count > 1 ? `${count} characters placed` : `${activeActor()?.name || "Model"} placed`;
  };

  previewWrap.addEventListener("pointerup", endPointer);
  previewWrap.addEventListener("pointercancel", endPointer);

  // Block browser autoscroll when middle-clicking the preview.
  previewWrap.addEventListener("auxclick", (event) => {
    if (event.button === 1) event.preventDefault();
  });

  previewWrap.addEventListener(
    "wheel",
    (event) => {
      if (!isDraggingProjector || !projectorDragSnapshot) return;
      event.preventDefault();
      const nextVenue = previewRenderer.dollyProjector(
        projectorDragSnapshot.projectorId,
        event.deltaY
      );
      state.venue = nextVenue;
      const projector = getProjectorById(
        state.venue,
        projectorDragSnapshot.projectorId
      );
      if (projector?.viewer?.positionM) {
        // Keep the drag plane locked to the new height after a dolly.
        const unitsPerMetre =
          (2.4 / Math.max(1, state.venue.box.widthCm)) * 100;
        projectorDragSnapshot.currentY =
          projector.viewer.positionM.y * unitsPerMetre;
        projectorDragSnapshot.startY = projectorDragSnapshot.currentY;
      }
      previewStatus.textContent = "Dollied projector · release to save";
    },
    { passive: false }
  );
}

function renderPlacementControls() {
  const character = getFocusedCharacter(state);
  characterNameElement.textContent = character
    ? `${character.index + 1}. ${character.name}`
    : "—";
  const primary = primarySelectedActor();
  const selected = selectedActors();
  if (primary && selected.length === 1) {
    posX.value = String(primary.x);
    posZ.value = String(primary.z);
    posScale.value = String(primary.scale);
    posXOut.textContent = Number(primary.x).toFixed(2);
    posZOut.textContent = Number(primary.z).toFixed(2);
    posScaleOut.textContent = Number(primary.scale).toFixed(2);
    const rotation = clampRotation(primary.rotation);
    if (posRotation) posRotation.value = String(Math.round(rotation));
    if (posRotationOut) posRotationOut.textContent = `${Math.round(rotation)}°`;
    if (posHover) posHover.checked = primary.hover === true;
  } else if (selected.length > 1) {
    const scales = selected.map((instance) => Number(instance.scale) || 1);
    const averageScale =
      scales.reduce((sum, value) => sum + value, 0) / scales.length;
    posScale.value = String(averageScale);
    posXOut.textContent = "group";
    posZOut.textContent = "group";
    posScaleOut.textContent = averageScale.toFixed(2);
    const rotations = selected.map((instance) => clampRotation(instance.rotation));
    const averageRotation =
      rotations.reduce((sum, value) => sum + value, 0) / rotations.length;
    if (posRotation) posRotation.value = String(Math.round(averageRotation));
    if (posRotationOut) posRotationOut.textContent = `${Math.round(averageRotation)}°`;
    if (posHover) {
      posHover.checked = selected.every((instance) => instance.hover === true);
    }
  } else {
    posX.value = "0";
    posZ.value = "0";
    posScale.value = String(state.placement?.scale ?? 1);
    posXOut.textContent = "0.00";
    posZOut.textContent = "0.00";
    posScaleOut.textContent = Number(state.placement?.scale ?? 1).toFixed(2);
    const placementRotation = clampRotation(state.placement?.rotation ?? 0);
    if (posRotation) posRotation.value = String(Math.round(placementRotation));
    if (posRotationOut) {
      posRotationOut.textContent = `${Math.round(placementRotation)}°`;
    }
    if (posHover) posHover.checked = state.placement?.hover === true;
  }
  updatePlacementModeUi();
  renderVoiceOptions();
  renderOnMapRoster();
  renderCharacterList();
  previewRenderer.setSelectedActorIds(state.selectedInstanceIds || []);
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

async function applyLocalVisuals() {
  await previewRenderer.applySceneState({
    ...state,
    mode: "single",
  });
  const warpChecked = document.getElementById("preview-warp")?.checked;
  previewRenderer.setUseProjectorWarp(Boolean(warpChecked));
  previewHandles.classList.toggle("hidden", !warpChecked);
  if (warpChecked) renderHandles(previewHandles, true);
  updatePlacementModeUi();
}

/** Keep Home UI → state.battleMap in lockstep before opening remote windows. */
function readBattleMapUiIntoState() {
  const enabledInput = document.getElementById("battle-map-enabled");
  const mapSelect = document.getElementById("battle-map-select");
  const waterInput = document.getElementById("battle-map-water");
  const snowInput = document.getElementById("battle-map-snow");
  const windInput = document.getElementById("battle-map-wind");
  const fireInput = document.getElementById("battle-map-fire");
  const fogInput = document.getElementById("battle-map-fog");
  const intensityInput = document.getElementById("battle-map-intensity");
  if (!enabledInput || !mapSelect) return;
  state.battleMap = normalizeBattleMapState({
    enabled: enabledInput.checked,
    mapId: mapSelect.value,
    water: waterInput?.checked !== false,
    snow: snowInput?.checked !== false,
    wind: windInput?.checked !== false,
    fire: fireInput?.checked !== false,
    fog: fogInput?.checked !== false,
    intensity: Number(intensityInput?.value ?? state.battleMap?.intensity ?? 1),
  });
}

/**
 * Flush the live Home scene to disk + BroadcastChannel before Stage/Align boot
 * so they never open on a stale battle-map localStorage snapshot.
 */
async function flushSceneForRemoteWindows() {
  readBattleMapUiIntoState();
  saveSceneState(state);
  await applyLocalVisuals();
  broadcastFullState(true);
}

async function syncScene(options = {}) {
  const token = ++syncToken;
  const immediate = Boolean(options.immediate);
  previewStatus.textContent = "Updating…";
  await applyLocalVisuals();
  const actors = buildActorsForSync(state);
  const results = await previewRenderer.syncActors(actors);
  if (token !== syncToken) return;
  previewRenderer.setSelectedActorIds(state.selectedInstanceIds || []);
  const failed = results.find((result) => result && !result.ok);
  if (failed) {
    previewStatus.textContent = failed.error || "Failed";
  } else if (!actors.length) {
    previewStatus.textContent = isCharacterStageEnabled()
      ? "3D stage ready · add characters with +"
      : "Map ready · add characters with +";
  } else {
    const selectedCount = (state.selectedInstanceIds || []).length;
    const placeLabel = isCharacterStageEnabled() ? "stage" : "map";
    previewStatus.textContent =
      selectedCount > 1
        ? `${actors.length} on ${placeLabel} · ${selectedCount} selected`
        : `${actors.length} on ${placeLabel} · ${activeActor()?.name || "ready"}`;
  }
  renderPlacementControls();
  broadcastFullState(immediate);
  // Immediate syncs (map change, open stage handshake) must hit disk now —
  // debounced autosave left a race where Stage/Align rewrote stale LS.
  if (immediate) {
    saveSceneState(state);
  } else {
    scheduleAutosave();
  }
}

async function setCharacterIndex(index) {
  state.characterIndex = index;
  renderPlacementControls();
  await voiceLab.applyForCharacter(
    getCharacterByIndex(state.characterIndex),
    "select"
  );
  if (state.voicemod.autoApplyOnSelect) {
    await applyCurrentVoice("select");
  }
  scheduleAutosave();
}

function bindPlacementControls() {
  const updateSelected = async (field, value) => {
    const selected = selectedActors();
    if (!selected.length) {
      if (field === "scale" || field === "rotation") {
        state.placement[field] = value;
      }
      renderPlacementControls();
      scheduleAutosave();
      return;
    }

    for (const instance of selected) {
      if (field === "x" || field === "z") {
        if (selected.length > 1) continue;
        instance[field] = clampPlacementAxis(value);
      } else if (field === "scale") {
        instance.scale = value;
        state.placement.scale = value;
      } else if (field === "elevation") {
        instance.elevation = clampElevation(value);
        state.placement.elevation = instance.elevation;
      } else if (field === "rotation") {
        instance.rotation = clampRotation(value);
        state.placement.rotation = instance.rotation;
      } else if (field === "hover") {
        instance.hover = value;
        state.placement.hover = value;
      }
    }

    if (field === "x") posXOut.textContent = Number(value).toFixed(2);
    if (field === "z") posZOut.textContent = Number(value).toFixed(2);
    if (field === "scale") posScaleOut.textContent = Number(value).toFixed(2);
    if (field === "elevation" && posElevationOut) {
      posElevationOut.textContent = clampElevation(value).toFixed(2);
    }
    if (field === "rotation" && posRotationOut) {
      posRotationOut.textContent = `${Math.round(clampRotation(value))}°`;
    }
    await syncScene();
  };
  posX.addEventListener("input", () => updateSelected("x", Number(posX.value)));
  posZ.addEventListener("input", () => updateSelected("z", Number(posZ.value)));
  posScale.addEventListener("input", () =>
    updateSelected("scale", Number(posScale.value))
  );
  posElevation?.addEventListener("input", () =>
    updateSelected("elevation", Number(posElevation.value))
  );
  posRotation?.addEventListener("input", () =>
    updateSelected("rotation", Number(posRotation.value))
  );
  posHover?.addEventListener("change", () =>
    updateSelected("hover", posHover.checked)
  );
}

async function openStageWindow() {
  // Flush map + roster before open so Stage's boot loadSceneState() matches Home
  // (and reused Stage windows get an immediate sync-scene, not a 200ms wait).
  await flushSceneForRemoteWindows();
  const venue = normalizeVenueState(state.venue || {});
  const result = await openProjectorOutputWindow({
    pathWithQuery: "/stage.html",
    windowName: "dungeon-stage",
    displayId: venue.outputDisplayId,
    fullscreen: venue.openFullscreenOnOutput !== false,
  });

  if (!result.ok) {
    setStageLinkStatus(result.error || "Could not open stage window");
    previewStatus.textContent = "Allow popups, then Open Stage again";
    return;
  }

  if (result.window) {
    stageWindow = result.window;
  }

  setStageLinkStatus(
    result.reused
      ? "Stage focused on projector display · resync sent"
      : "Stage opening on projector display…"
  );
  broadcastFullState(true);
  const retries = [200, 500, 1000, 2000, 3500];
  for (const delay of retries) {
    window.setTimeout(() => broadcastFullState(true), delay);
  }
}

/**
 * One window per projector, routed onto the chosen projector display.
 * Electron places/fullscreens by OS bounds; browser uses Window Management
 * when available, otherwise popup features.
 */
async function openProjectorWindow(projectorId) {
  // Fresh full-frame keystone so a stale crossed/inset quad can't black-hole the feed.
  const projector = getProjectorById(state.venue, projectorId);
  if (projector) {
    if (projector.projectionMode !== "anamorphic") {
      projector.faceIds = ["top"];
    } else if (!projector.faceIds?.length) {
      projector.faceIds = ["top"];
    }
    for (const faceId of projector.faceIds) {
      projector.faceCorners[faceId] = resetFaceCornersToFullFrame(faceId);
    }
    state.venue.calibrationFaceId = "top";
  }

  await flushSceneForRemoteWindows();
  const venue = normalizeVenueState(state.venue || {});
  const result = await openProjectorOutputWindow({
    pathWithQuery: `/stage.html?projector=${encodeURIComponent(projectorId)}&resetCorners=1`,
    windowName: `dungeon-stage-${projectorId}`,
    displayId: venue.outputDisplayId,
    fullscreen: venue.openFullscreenOnOutput !== false,
  });

  if (!result.ok) {
    setStageLinkStatus(result.error || "Could not open projector feed");
    return;
  }

  if (result.window) {
    projectorWindows.set(projectorId, result.window);
  }

  setStageLinkStatus(
    result.reused
      ? `${projectorId} on projector display · resync sent`
      : `${projectorId} opening on projector display…`
  );
  broadcastFullState(true);
  for (const delay of [200, 500, 1000, 2000, 3500]) {
    window.setTimeout(() => broadcastFullState(true), delay);
  }
}

let mappingStudioWindow = null;

/**
 * Align-to-real-box studio: projector feed + corner handles on the left,
 * box surface reference on the right.
 *
 * Uses the same Electron IPC BrowserWindow path as Open Stage — raw
 * window.open + WindowProxy reuse was flaky after Stage had been opened.
 */
async function openMappingStudio(projectorId) {
  const id =
    projectorId || state.venue?.activeProjectorId || "projector-1";
  state.venue = normalizeVenueState(state.venue || {});
  state.venue.enabled = true;
  state.venue.activeProjectorId = id;
  for (const projector of state.venue.projectors) {
    if (projector.projectionMode === "camera") {
      projector.projectionMode = "projector";
    }
  }
  venuePanel?.refresh();
  await flushSceneForRemoteWindows();

  const result = await openProjectorOutputWindow({
    pathWithQuery: `/mapping.html?projector=${encodeURIComponent(id)}`,
    windowName: "dungeon-mapping-studio",
    // Keep Align on the primary/control display — not the projector output.
    displayId: "",
    fullscreen: false,
    width: 1600,
    height: 900,
  });

  if (!result.ok) {
    setStageLinkStatus(result.error || "Could not open Align to real box");
    return;
  }

  if (result.window) {
    mappingStudioWindow = result.window;
  }

  setStageLinkStatus(
    result.reused
      ? "Align to real box focused · resync sent"
      : "Align to real box opening…"
  );
  broadcastFullState(true);
  for (const delay of [200, 500, 1000, 2000, 3500]) {
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
    await syncScene({ immediate: true });
    previewStatus.textContent =
      state.placementMode === "fit"
        ? "Size only · drag disabled"
        : "Move models · drag & box-select";
  });
});

document
  .getElementById("reset-placement")
  .addEventListener("click", async () => {
    const defaults = createDefaultSceneState().placement;
    const selected = selectedActors();
    state.placement = {
      ...defaults,
      scale: defaults.scale,
      rotation: defaults.rotation,
    };
    if (selected.length) {
      selected.forEach((instance, index) => {
        instance.scale = defaults.scale;
        instance.rotation = defaults.rotation;
        if (selected.length === 1) {
          instance.x = 0;
          instance.z = 0;
        } else {
          const angle = index * 0.9;
          const radius = Math.min(0.85, 0.28 + index * 0.12);
          instance.x = clampPlacementAxis(Math.cos(angle) * radius);
          instance.z = clampPlacementAxis(Math.sin(angle) * radius);
        }
      });
    }
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

function ensureBattleMapControls() {
  const enabledInput = document.getElementById("battle-map-enabled");
  const mapSelect = document.getElementById("battle-map-select");
  const thumbGrid = document.getElementById("battle-map-thumbs");
  const waterInput = document.getElementById("battle-map-water");
  const snowInput = document.getElementById("battle-map-snow");
  const windInput = document.getElementById("battle-map-wind");
  const fireInput = document.getElementById("battle-map-fire");
  const fogInput = document.getElementById("battle-map-fog");
  const intensityInput = document.getElementById("battle-map-intensity");
  const intensityOut = document.getElementById("battle-map-intensity-out");
  if (!enabledInput || !mapSelect || !thumbGrid) return;

  function createMapThumbButton(mapEntry, selectedMapId) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "map-thumb";
    button.setAttribute("role", "option");
    button.dataset.mapId = mapEntry.id;
    button.setAttribute(
      "aria-selected",
      mapEntry.id === selectedMapId ? "true" : "false"
    );
    button.title = mapEntry.name;

    if (mapEntry.thumb || mapEntry.file) {
      const image = document.createElement("img");
      image.src = mapEntry.thumb || mapEntry.file;
      image.alt = mapEntry.name;
      image.loading = "lazy";
      button.appendChild(image);
    } else {
      const empty = document.createElement("span");
      empty.className = "map-thumb-empty";
      empty.textContent = "None";
      button.appendChild(empty);
    }

    const label = document.createElement("span");
    label.className = "map-thumb-label";
    label.textContent = mapEntry.name;
    button.appendChild(label);

    if (mapEntry.id === selectedMapId) {
      button.classList.add("is-selected");
    }

    button.addEventListener("click", async () => {
      mapSelect.value = mapEntry.id;
      if (mapEntry.id === "none") {
        enabledInput.checked = false;
      } else if (!enabledInput.checked) {
        enabledInput.checked = true;
      }
      renderBattleMapThumbs(mapEntry.id);
      await commitBattleMap();
    });

    return button;
  }

  function renderBattleMapThumbs(selectedMapId) {
    thumbGrid.innerHTML = "";

    for (const category of battleMapCategories) {
      const section = document.createElement("section");
      section.className = "map-category";
      section.dataset.categoryId = category.id;

      const heading = document.createElement("h4");
      heading.className = "map-category-title";
      heading.textContent = category.name;
      section.appendChild(heading);

      const grid = document.createElement("div");
      grid.className = "map-thumb-grid";
      grid.setAttribute("role", "group");
      grid.setAttribute("aria-label", category.name);

      for (const mapEntry of category.maps) {
        grid.appendChild(createMapThumbButton(mapEntry, selectedMapId));
      }

      section.appendChild(grid);
      thumbGrid.appendChild(section);
    }
  }

  function writeBattleMapStateToUi() {
    const battleMap = normalizeBattleMapState(state.battleMap);
    state.battleMap = battleMap;
    enabledInput.checked = battleMap.enabled;
    mapSelect.value = battleMap.mapId;
    renderBattleMapThumbs(battleMap.mapId);
    if (waterInput) waterInput.checked = battleMap.water;
    if (snowInput) snowInput.checked = battleMap.snow;
    if (windInput) windInput.checked = battleMap.wind;
    if (fireInput) fireInput.checked = battleMap.fire;
    if (fogInput) fogInput.checked = battleMap.fog;
    if (intensityInput) intensityInput.value = String(battleMap.intensity);
    if (intensityOut) {
      intensityOut.textContent = battleMap.intensity.toFixed(2);
    }
  }

  async function commitBattleMap() {
    readBattleMapUiIntoState();
    await syncScene({ immediate: true });
  }

  writeBattleMapStateToUi();
  enabledInput.addEventListener("change", async () => {
    renderBattleMapThumbs(mapSelect.value);
    await commitBattleMap();
  });
  waterInput?.addEventListener("change", commitBattleMap);
  snowInput?.addEventListener("change", commitBattleMap);
  windInput?.addEventListener("change", commitBattleMap);
  fireInput?.addEventListener("change", commitBattleMap);
  fogInput?.addEventListener("change", commitBattleMap);
  intensityInput?.addEventListener("input", async () => {
    if (intensityOut) {
      intensityOut.textContent = Number(intensityInput.value).toFixed(2);
    }
    await commitBattleMap();
  });
}

ensureBattleMapControls();

const venuePanel = venuePanelMount
  ? createVenuePanel({
      container: venuePanelMount,
      getVenue: () => state.venue,
      onChange: async (nextVenue) => {
        state.venue = nextVenue;
        venuePanel.refresh();
        saveSceneState(state);
        await syncScene({ immediate: true });
      },
      onOpenProjectorWindow: openProjectorWindow,
      onOpenMappingStudio: openMappingStudio,
      onFrameActiveEye: () => previewRenderer.frameActiveProjectorEye(),
      onResetPreviewCamera: () => previewRenderer.resetPreviewCamera(),
    })
  : null;

const stageFxPanel = stageFxPanelMount
  ? createStageFxPanel({
      container: stageFxPanelMount,
      getStageFx: () => state.stageFx,
      onChange: async (nextStageFx) => {
        state.stageFx = nextStageFx;
        stageFxPanel.refresh();
        await syncScene({ immediate: true });
      },
    })
  : null;

const characterStagePanel = characterStagePanelMount
  ? createCharacterStagePanel({
      container: characterStagePanelMount,
      getCharacterStage: () => state.characterStage,
      onChange: async (nextCharacterStage) => {
        state.characterStage = nextCharacterStage;
        characterStagePanel.syncFromState();
        updatePlacementModeUi();
        await syncScene({ immediate: true });
      },
    })
  : null;

venuePanel?.refresh();
stageFxPanel?.refresh();
characterStagePanel?.syncFromState();

initRailResize(document.querySelector(".workspace"));

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
  const character = getFocusedCharacter(state);
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
setSelection(state.selectedInstanceIds || [], { syncFocus: false });
syncScene({ immediate: true }).then(() => {
  voiceLab.applyForCharacter(getFocusedCharacter(state), "init");
});
