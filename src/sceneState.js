import { characters as characterCatalog } from "./characters.js";
import {
  createDefaultBattleMapState,
  normalizeBattleMapState,
} from "./battleMaps.js";
import { VOICE_PRESET_VERSION } from "./voicePresets.js";
import {
  createDefaultVenueState,
  normalizeVenueState,
  getBoxExtents,
} from "./venueGeometry.js";
import {
  createDefaultStageFxState,
  normalizeStageFxState,
} from "./fx/stageFxState.js";
import {
  createDefaultCharacterStageState,
  getCharacterStageWorldPose,
  normalizeCharacterStageState,
  resolveStageActorWorldPosition,
} from "./characterStage.js";

const STORAGE_KEY = "dungeon-stage-scene-v3-single";
const BOX_HALF_EXTENT = 1.2;
const MAX_ELEVATION = 2.5;

let instanceCounter = 0;

function clamp01(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.min(1, Math.max(0, number));
}

export function clampCorner(corner = {}) {
  return {
    x: clamp01(corner.x),
    y: clamp01(corner.y),
  };
}

export function clampProjectorCorners(corners = {}) {
  return {
    topLeft: clampCorner(corners.topLeft ?? { x: 0.15, y: 0.12 }),
    topRight: clampCorner(corners.topRight ?? { x: 0.85, y: 0.12 }),
    bottomRight: clampCorner(corners.bottomRight ?? { x: 0.88, y: 0.88 }),
    bottomLeft: clampCorner(corners.bottomLeft ?? { x: 0.12, y: 0.88 }),
  };
}

export function clampPlacementAxis(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.min(BOX_HALF_EXTENT, Math.max(-BOX_HALF_EXTENT, number));
}

/**
 * Height above the box top. Only meaningful under anamorphic projection —
 * a raised actor is exactly what produces visible parallax against the surface.
 */
export function clampElevation(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.min(MAX_ELEVATION, Math.max(0, number));
}

/** Yaw around the vertical axis, in degrees (0–360). */
export function clampRotation(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  const wrapped = number % 360;
  return wrapped < 0 ? wrapped + 360 : wrapped;
}

export function createInstanceId() {
  instanceCounter += 1;
  return `actor-${Date.now().toString(36)}-${instanceCounter.toString(36)}`;
}

export function getCharacterById(characterId) {
  return characterCatalog.find((character) => character.id === characterId) || null;
}

export function getCharacterByIndex(index) {
  if (!characterCatalog.length) return null;
  const safeIndex =
    ((index % characterCatalog.length) + characterCatalog.length) %
    characterCatalog.length;
  return { ...characterCatalog[safeIndex], index: safeIndex };
}

export function createActorInstance(characterId, overrides = {}) {
  const character = getCharacterById(characterId) || characterCatalog[0];
  if (!character) return null;
  const scale = Number(overrides.scale);
  return {
    instanceId: overrides.instanceId || createInstanceId(),
    characterId: character.id,
    enabled: overrides.enabled !== false,
    x: clampPlacementAxis(overrides.x ?? 0),
    z: clampPlacementAxis(overrides.z ?? 0),
    elevation: clampElevation(overrides.elevation ?? 0),
    scale: Number.isFinite(scale) && scale > 0 ? scale : 1,
    rotation: clampRotation(overrides.rotation ?? 0),
    hover: overrides.hover === true,
  };
}

function normalizeActorInstance(raw) {
  if (!raw || typeof raw !== "object") return null;
  const characterId =
    typeof raw.characterId === "string" && raw.characterId ? raw.characterId : "";
  const character = getCharacterById(characterId);
  if (!character) return null;
  const scale = Number(raw.scale);
  return {
    instanceId:
      typeof raw.instanceId === "string" && raw.instanceId
        ? raw.instanceId
        : createInstanceId(),
    characterId: character.id,
    enabled: raw.enabled !== false,
    x: clampPlacementAxis(raw.x),
    z: clampPlacementAxis(raw.z),
    elevation: clampElevation(raw.elevation),
    scale: Number.isFinite(scale) && scale > 0 ? scale : 1,
    rotation: clampRotation(raw.rotation),
    hover: raw.hover === true,
  };
}

function normalizeActorsOnMap(rawList, legacyState = null) {
  if (Array.isArray(rawList) && rawList.length) {
    const seen = new Set();
    const normalized = [];
    for (const raw of rawList) {
      const instance = normalizeActorInstance(raw);
      if (!instance) continue;
      if (seen.has(instance.instanceId)) {
        instance.instanceId = createInstanceId();
      }
      seen.add(instance.instanceId);
      normalized.push(instance);
    }
    if (normalized.length) return normalized;
  }

  // Migrate older single-character saves.
  if (legacyState) {
    const character = getCharacterByIndex(legacyState.characterIndex ?? 0);
    if (character) {
      const placement = legacyState.placement || {};
      return [
        createActorInstance(character.id, {
          x: placement.x,
          z: placement.z,
          scale: placement.scale,
          rotation: placement.rotation,
        }),
      ];
    }
  }

  return [];
}

function nextOpenPlacement(existingActors) {
  const count = existingActors.length;
  if (count === 0) return { x: 0, z: 0 };
  const angle = count * 0.9;
  const radius = Math.min(0.85, 0.28 + count * 0.12);
  return {
    x: clampPlacementAxis(Math.cos(angle) * radius),
    z: clampPlacementAxis(Math.sin(angle) * radius),
  };
}

export function createDefaultSceneState() {
  return {
    mode: "single",
    testBackdrop: true,
    showBoxGuide: true,
    calibrationGrid: false,
    characterIndex: 0,
    placementMode: "move",
    placement: {
      x: 0,
      z: 0,
      elevation: 0,
      scale: 1,
      rotation: 0,
      hover: false,
    },
    actorsOnMap: [],
    selectedInstanceIds: [],
    voicesByCharacterId: {},
    voiceLab: {
      autoApplyOnSelect: true,
      selectedPresetId: "chromatic-dragons",
      inputDeviceId: "",
      outputDeviceId: "",
      tweaksByPresetId: {},
      presetVersion: VOICE_PRESET_VERSION,
    },
    voicemod: {
      apiKey: "",
      autoApplyOnSelect: false,
    },
    battleMap: createDefaultBattleMapState(),
    venue: createDefaultVenueState(),
    stageFx: createDefaultStageFxState(),
    characterStage: createDefaultCharacterStageState(),
    projector: {
      corners: clampProjectorCorners({
        topLeft: { x: 0.15, y: 0.12 },
        topRight: { x: 0.85, y: 0.12 },
        bottomRight: { x: 0.88, y: 0.88 },
        bottomLeft: { x: 0.12, y: 0.88 },
      }),
    },
  };
}

export function getFocusedCharacter(state) {
  const selectedId = state.selectedInstanceIds?.[0];
  if (selectedId) {
    const instance = (state.actorsOnMap || []).find(
      (actor) => actor.instanceId === selectedId
    );
    if (instance) {
      const character = getCharacterById(instance.characterId);
      if (character) {
        const index = characterCatalog.findIndex(
          (entry) => entry.id === character.id
        );
        return { ...character, index: Math.max(0, index) };
      }
    }
  }
  return getCharacterByIndex(state.characterIndex);
}

/** @deprecated Prefer buildActorsForSync — kept for single-actor call sites. */
export function buildActiveActor(state) {
  const actors = buildActorsForSync(state);
  if (!actors.length) return null;
  const selectedId = state.selectedInstanceIds?.[0];
  if (selectedId) {
    return actors.find((actor) => actor.id === selectedId) || actors[0];
  }
  return actors[0];
}

function getVenueHalfExtents(state) {
  try {
    const { halfWidth, halfDepth } = getBoxExtents(
      state?.venue?.box || { widthCm: 120, depthCm: 120, heightCm: 60 }
    );
    return { halfWidth, halfDepth };
  } catch {
    return { halfWidth: BOX_HALF_EXTENT, halfDepth: BOX_HALF_EXTENT };
  }
}

/**
 * When the 3D stage is on, pin every actor into the booth and scale them with
 * the square size. Free map XZ is ignored.
 */
export function buildActorsForSync(state) {
  const list = Array.isArray(state.actorsOnMap) ? state.actorsOnMap : [];
  const enabledActors = list.filter(
    (instance) => instance && instance.enabled !== false
  );
  const characterStage = normalizeCharacterStageState(state.characterStage);
  const { halfWidth, halfDepth } = getVenueHalfExtents(state);
  const stagePose = getCharacterStageWorldPose(
    characterStage,
    halfWidth,
    halfDepth
  );

  return enabledActors
    .map((instance, actorIndex) => {
      const character = getCharacterById(instance.characterId);
      if (!character) return null;
      const voice = state.voicesByCharacterId?.[character.id] || {
        voicePresetId: "",
        voicemodVoiceId: "",
        voicemodVoiceName: "",
      };
      const baseScale = Number(instance.scale);
      const safeScale =
        Number.isFinite(baseScale) && baseScale > 0 ? baseScale : 1;

      let x = clampPlacementAxis(instance.x);
      let z = clampPlacementAxis(instance.z);
      let elevation = clampElevation(instance.elevation);
      let scale = safeScale;

      if (stagePose.enabled) {
        const world = resolveStageActorWorldPosition(
          characterStage,
          halfWidth,
          halfDepth,
          actorIndex,
          enabledActors.length
        );
        if (world) {
          x = world.x;
          z = world.z;
          // Stay glued to the stage floor — Lift is for anamorphic map tokens,
          // not the booth (side views were reading as mid-air float).
          elevation = world.y;
          scale = safeScale * world.scaleFactor;
        }
      }

      return {
        id: instance.instanceId,
        characterId: character.id,
        name: character.name,
        file: character.file,
        fallbackFile: character.fallbackFile || "",
        look: character.look || "",
        fx: character.fx || "",
        faceForward: character.faceForward || null,
        enabled: true,
        x,
        z,
        elevation,
        scale,
        rotation: clampRotation(instance.rotation),
        hover: instance.hover === true,
        onCharacterStage: stagePose.enabled,
        voicePresetId: voice.voicePresetId || "",
        voicemodVoiceId: voice.voicemodVoiceId || "",
        voicemodVoiceName: voice.voicemodVoiceName || "",
      };
    })
    .filter(Boolean);
}

/**
 * Put exactly one character on the map/stage (or clear when characterId is empty).
 * Used by the projector HUD and whenever the 3D booth should show a single creature.
 */
export function setSoleActorOnMap(state, characterId) {
  state.actorsOnMap = [];
  state.selectedInstanceIds = [];
  if (!characterId) return null;
  return addActorToMap(state, characterId, { replaceExisting: false });
}

export function addActorToMap(state, characterId, options = {}) {
  const characterStage = normalizeCharacterStageState(state.characterStage);
  const replaceExisting =
    options.replaceExisting !== false && characterStage.enabled;
  // 3D stage shows one creature at a time — replace rather than stack.
  if (replaceExisting) {
    state.actorsOnMap = [];
    state.selectedInstanceIds = [];
  }
  const defaults = state.placement || {};
  // Stage mode: park at origin in state; buildActorsForSync places them in the booth.
  const placement = characterStage.enabled
    ? { x: 0, z: 0 }
    : nextOpenPlacement(state.actorsOnMap || []);
  const instance = createActorInstance(characterId, {
    x: placement.x,
    z: placement.z,
    elevation: defaults.elevation ?? 0,
    scale: defaults.scale ?? 1,
    rotation: defaults.rotation ?? 0,
    hover: defaults.hover === true,
  });
  if (!instance) return null;
  state.actorsOnMap = [...(state.actorsOnMap || []), instance];
  state.selectedInstanceIds = [instance.instanceId];
  const catalogIndex = characterCatalog.findIndex(
    (character) => character.id === instance.characterId
  );
  if (catalogIndex >= 0) state.characterIndex = catalogIndex;
  return instance;
}

export function removeActorFromMap(state, instanceId) {
  state.actorsOnMap = (state.actorsOnMap || []).filter(
    (instance) => instance.instanceId !== instanceId
  );
  state.selectedInstanceIds = (state.selectedInstanceIds || []).filter(
    (id) => id !== instanceId
  );
}

export function removeOneActorOfType(state, characterId) {
  const list = state.actorsOnMap || [];
  const lastIndex = [...list]
    .map((instance, index) => ({ instance, index }))
    .reverse()
    .find((entry) => entry.instance.characterId === characterId)?.index;
  if (lastIndex == null) return false;
  const removed = list[lastIndex];
  state.actorsOnMap = list.filter((_, index) => index !== lastIndex);
  state.selectedInstanceIds = (state.selectedInstanceIds || []).filter(
    (id) => id !== removed.instanceId
  );
  return true;
}

export function getActorInstance(state, instanceId) {
  return (state.actorsOnMap || []).find(
    (instance) => instance.instanceId === instanceId
  );
}

export function loadSceneState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return createDefaultSceneState();
    const parsed = JSON.parse(raw);
    const fallback = createDefaultSceneState();
    const characterIndex = Number(parsed.characterIndex);
    let actorsOnMap = normalizeActorsOnMap(parsed.actorsOnMap, parsed);
    const characterStage = normalizeCharacterStageState({
      ...fallback.characterStage,
      ...(parsed.characterStage || {}),
    });
    // 3D booth is single-cast: keep selected (or first) creature only.
    if (characterStage.enabled && actorsOnMap.length > 1) {
      const preferredId = Array.isArray(parsed.selectedInstanceIds)
        ? parsed.selectedInstanceIds[0]
        : null;
      const preferred =
        actorsOnMap.find((instance) => instance.instanceId === preferredId) ||
        actorsOnMap[0];
      actorsOnMap = preferred ? [preferred] : [];
    }
    const selectedRaw = Array.isArray(parsed.selectedInstanceIds)
      ? parsed.selectedInstanceIds.filter((id) =>
          actorsOnMap.some((instance) => instance.instanceId === id)
        )
      : [];
    return {
      ...fallback,
      ...parsed,
      characterIndex:
        Number.isFinite(characterIndex) && characterIndex >= 0
          ? Math.floor(characterIndex) % Math.max(characterCatalog.length, 1)
          : fallback.characterIndex,
      placementMode:
        parsed.placementMode === "move" || parsed.placementMode === "fit"
          ? parsed.placementMode
          : "move",
      placement: {
        ...fallback.placement,
        ...(parsed.placement || {}),
      },
      actorsOnMap,
      selectedInstanceIds: selectedRaw.length
        ? selectedRaw
        : actorsOnMap[0]
          ? [actorsOnMap[0].instanceId]
          : [],
      voicemod: {
        ...fallback.voicemod,
        ...(parsed.voicemod || {}),
      },
      battleMap: normalizeBattleMapState({
        ...fallback.battleMap,
        ...(parsed.battleMap || {}),
      }),
      venue: normalizeVenueState({
        ...fallback.venue,
        ...(parsed.venue || {}),
      }),
      stageFx: normalizeStageFxState({
        ...fallback.stageFx,
        ...(parsed.stageFx || {}),
      }),
      characterStage,
      voiceLab: {
        ...fallback.voiceLab,
        ...(parsed.voiceLab || {}),
        tweaksByPresetId:
          Number(parsed.voiceLab?.presetVersion) === VOICE_PRESET_VERSION
            ? {
                ...fallback.voiceLab.tweaksByPresetId,
                ...(parsed.voiceLab?.tweaksByPresetId || {}),
              }
            : {},
        presetVersion: VOICE_PRESET_VERSION,
      },
      voicesByCharacterId: {
        ...fallback.voicesByCharacterId,
        ...(parsed.voicesByCharacterId || {}),
      },
      projector: {
        ...fallback.projector,
        ...(parsed.projector || {}),
        corners: clampProjectorCorners({
          ...fallback.projector.corners,
          ...(parsed.projector?.corners || {}),
        }),
      },
    };
  } catch {
    return createDefaultSceneState();
  }
}

export function saveSceneState(state) {
  try {
    const safe = {
      ...state,
      projector: {
        ...state.projector,
        corners: clampProjectorCorners(state.projector?.corners),
      },
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(safe));
  } catch (error) {
    console.warn("Could not save scene state", error);
  }
}

/**
 * Merge a partial update into the persisted scene without wiping fields the
 * caller doesn't own. Stage/Align use this for keystone/venue so a stale
 * in-memory battleMap cannot clobber Home's current map selection.
 */
export function patchSceneState(partial = {}) {
  try {
    const existing = loadSceneState();
    const next = {
      ...existing,
      ...partial,
      placement: partial.placement
        ? { ...existing.placement, ...partial.placement }
        : existing.placement,
      actorsOnMap: Array.isArray(partial.actorsOnMap)
        ? partial.actorsOnMap
        : existing.actorsOnMap,
      selectedInstanceIds: Array.isArray(partial.selectedInstanceIds)
        ? partial.selectedInstanceIds
        : existing.selectedInstanceIds,
      battleMap: partial.battleMap
        ? normalizeBattleMapState({
            ...existing.battleMap,
            ...partial.battleMap,
          })
        : existing.battleMap,
      venue: partial.venue
        ? normalizeVenueState(partial.venue)
        : existing.venue,
      stageFx: partial.stageFx
        ? normalizeStageFxState({
            ...existing.stageFx,
            ...partial.stageFx,
          })
        : existing.stageFx,
      characterStage: partial.characterStage
        ? normalizeCharacterStageState({
            ...existing.characterStage,
            ...partial.characterStage,
          })
        : existing.characterStage,
      projector: {
        ...existing.projector,
        ...(partial.projector || {}),
        corners: clampProjectorCorners(
          partial.projector?.corners || existing.projector?.corners
        ),
      },
      voicesByCharacterId: {
        ...existing.voicesByCharacterId,
        ...(partial.voicesByCharacterId || {}),
      },
      voiceLab: partial.voiceLab
        ? { ...existing.voiceLab, ...partial.voiceLab }
        : existing.voiceLab,
      voicemod: partial.voicemod
        ? { ...existing.voicemod, ...partial.voicemod }
        : existing.voicemod,
    };
    saveSceneState(next);
    return next;
  } catch (error) {
    console.warn("Could not patch scene state", error);
    return null;
  }
}

export function cloneSceneState(state) {
  return JSON.parse(JSON.stringify(state));
}

export {
  characterCatalog,
  STORAGE_KEY,
  BOX_HALF_EXTENT,
  MAX_ELEVATION,
  normalizeCharacterStageState,
  createDefaultCharacterStageState,
};
