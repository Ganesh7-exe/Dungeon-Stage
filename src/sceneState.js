import { characters as characterCatalog } from "./characters.js";
import { VOICE_PRESET_VERSION } from "./voicePresets.js";

const STORAGE_KEY = "dungeon-stage-scene-v3-single";

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

export function createDefaultSceneState() {
  return {
    mode: "single",
    testBackdrop: true,
    showBoxGuide: true,
    calibrationGrid: false,
    characterIndex: 0,
    placementMode: "fit",
    placement: {
      x: 0,
      z: 0,
      scale: 1,
      spin: true,
    },
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

export function getCharacterByIndex(index) {
  if (!characterCatalog.length) return null;
  const safeIndex =
    ((index % characterCatalog.length) + characterCatalog.length) %
    characterCatalog.length;
  return { ...characterCatalog[safeIndex], index: safeIndex };
}

export function buildActiveActor(state) {
  const character = getCharacterByIndex(state.characterIndex);
  if (!character) return null;
  const voice = state.voicesByCharacterId?.[character.id] || {
    voicePresetId: "",
    voicemodVoiceId: "",
    voicemodVoiceName: "",
  };
  const fitMode = state.placementMode !== "move";
  const scale = Number(state.placement?.scale);
  return {
    id: character.id,
    name: character.name,
    file: character.file,
    enabled: true,
    x: fitMode ? 0 : Number(state.placement?.x) || 0,
    z: fitMode ? 0 : Number(state.placement?.z) || 0,
    scale: Number.isFinite(scale) && scale > 0 ? scale : 1,
    spin: state.placement?.spin !== false,
    voicePresetId: voice.voicePresetId || "",
    voicemodVoiceId: voice.voicemodVoiceId || "",
    voicemodVoiceName: voice.voicemodVoiceName || "",
  };
}

export function loadSceneState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return createDefaultSceneState();
    const parsed = JSON.parse(raw);
    const fallback = createDefaultSceneState();
    const characterIndex = Number(parsed.characterIndex);
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
          : fallback.placementMode,
      placement: {
        ...fallback.placement,
        ...(parsed.placement || {}),
      },
      voicemod: {
        ...fallback.voicemod,
        ...(parsed.voicemod || {}),
      },
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

export function cloneSceneState(state) {
  return JSON.parse(JSON.stringify(state));
}

export { characterCatalog, STORAGE_KEY };
