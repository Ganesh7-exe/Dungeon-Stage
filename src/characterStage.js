/**
 * Resizable 3D character stage — a square diorama parked on the center-top
 * edge of the battle map. Characters live here (not free on the PNG floor);
 * resizing the square scales both the booth and the creatures inside it.
 */

const DEFAULT_SIZE = 0.95;
const MIN_SIZE = 0.25;
const MAX_SIZE = 1.5;
const BASE_SIZE_FOR_SCALE = 0.95;
/** Matches StageRenderer.normalizeModel — tallest axis after load. */
export const NORMALIZED_MODEL_MAX_DIMENSION = 1.15;
const MIN_ACTOR_INSTANCE_SCALE = 0.3;
const MAX_ACTOR_INSTANCE_SCALE = 2.5;
/** Keep a hair of clearance inside the booth walls for FX and silhouettes. */
export const CHARACTER_STAGE_ACTOR_FIT_MARGIN = 0.94;

export const DEFAULT_CHARACTER_MODEL_BOUNDS = {
  x: NORMALIZED_MODEL_MAX_DIMENSION,
  y: NORMALIZED_MODEL_MAX_DIMENSION,
  z: NORMALIZED_MODEL_MAX_DIMENSION,
};

export const CHARACTER_STAGE_BACKDROPS = [
  { id: "void", label: "Void rift" },
  { id: "dungeon", label: "Dungeon stone" },
  { id: "ember", label: "Ember forge" },
  { id: "mist", label: "Mist woods" },
];

function clampNumber(value, minimum, maximum, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, parsed));
}

export function createDefaultCharacterStageState() {
  return {
    enabled: true,
    size: DEFAULT_SIZE,
    height: 1.15,
    backdrop: "void",
    /** Keep flush with the battle-map plane so side views don’t float. */
    floorLift: 0,
  };
}

export function normalizeCharacterStageState(raw = {}) {
  const fallback = createDefaultCharacterStageState();
  const backdropId =
    typeof raw.backdrop === "string" &&
    CHARACTER_STAGE_BACKDROPS.some((entry) => entry.id === raw.backdrop)
      ? raw.backdrop
      : fallback.backdrop;

  return {
    enabled: raw.enabled !== false,
    size: clampNumber(raw.size, MIN_SIZE, MAX_SIZE, fallback.size),
    height: clampNumber(raw.height, 0.45, 2.4, fallback.height),
    backdrop: backdropId,
    floorLift: clampNumber(raw.floorLift, 0, 0.2, fallback.floorLift),
  };
}

/**
 * World transform for the stage: origin at the map's center-top edge
 * (far edge from the default camera at +Z). The square sits fully beyond
 * the map — its near edge kisses the map's far edge — so it reads as a
 * separate booth above the whole PNG, not a plate on top of it.
 */
export function getCharacterStageWorldPose(stageState, boxHalfWidth, boxHalfDepth) {
  const stage = normalizeCharacterStageState(stageState);
  const size = stage.size;
  const halfDepth = Number.isFinite(boxHalfDepth) ? boxHalfDepth : 1.2;
  const halfWidth = Number.isFinite(boxHalfWidth) ? boxHalfWidth : 1.2;
  // Keep the square within the map width; clamp center if size is huge.
  const maxOffsetX = Math.max(0, halfWidth - size * 0.5);
  const centerX = 0;
  const clampedX = Math.min(maxOffsetX, Math.max(-maxOffsetX, centerX));
  // Near edge of stage aligns with far edge of map (−Z); booth extends further −Z.
  const centerZ = -halfDepth - size * 0.5;

  return {
    enabled: stage.enabled,
    size,
    height: stage.height,
    backdrop: stage.backdrop,
    floorLift: stage.floorLift,
    centerX: clampedX,
    centerY: stage.floorLift,
    centerZ,
    halfSize: size * 0.5,
    /** Scale multiplier applied to characters so resizing the booth tweaks them. */
    characterScaleFactor: size / BASE_SIZE_FOR_SCALE,
  };
}

/** Local XZ offsets inside the stage for N actors, clustered around center. */
export function getStageActorLocalOffsets(actorCount) {
  const count = Math.max(0, Math.floor(Number(actorCount) || 0));
  if (count <= 0) return [];
  if (count === 1) return [{ x: 0, z: 0 }];

  const offsets = [];
  const radius = Math.min(0.28, 0.1 + count * 0.035);
  for (let index = 0; index < count; index += 1) {
    const angle = (index / count) * Math.PI * 2 - Math.PI * 0.5;
    offsets.push({
      x: Math.cos(angle) * radius,
      z: Math.sin(angle) * radius * 0.55,
    });
  }
  return offsets;
}

function sanitizeModelBounds(rawBounds) {
  if (!rawBounds || typeof rawBounds !== "object") {
    return { ...DEFAULT_CHARACTER_MODEL_BOUNDS };
  }
  const readAxis = (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  };
  return {
    x: readAxis(rawBounds.x) ?? DEFAULT_CHARACTER_MODEL_BOUNDS.x,
    y: readAxis(rawBounds.y) ?? DEFAULT_CHARACTER_MODEL_BOUNDS.y,
    z: readAxis(rawBounds.z) ?? DEFAULT_CHARACTER_MODEL_BOUNDS.z,
  };
}

/**
 * Max wrapper scale so a normalized model stays inside the booth volume.
 */
export function getMaxActorWorldScaleForCharacterStage(
  modelBounds,
  stageState,
  boxHalfWidth,
  boxHalfDepth,
  options = {}
) {
  const pose = getCharacterStageWorldPose(stageState, boxHalfWidth, boxHalfDepth);
  if (!pose.enabled) return null;

  const bounds = sanitizeModelBounds(modelBounds);
  const margin = Number(options.margin);
  const fitMargin = Number.isFinite(margin) ? margin : CHARACTER_STAGE_ACTOR_FIT_MARGIN;

  return (
    fitMargin *
    Math.min(
      pose.size / bounds.x,
      pose.size / bounds.z,
      pose.height / bounds.y
    )
  );
}

/**
 * Max persisted Size slider value while the 3D booth is on.
 */
export function getMaxActorInstanceScaleForCharacterStage(
  modelBounds,
  stageState,
  boxHalfWidth,
  boxHalfDepth,
  options = {}
) {
  const maxWorldScale = getMaxActorWorldScaleForCharacterStage(
    modelBounds,
    stageState,
    boxHalfWidth,
    boxHalfDepth,
    options
  );
  if (maxWorldScale == null) return MAX_ACTOR_INSTANCE_SCALE;

  const pose = getCharacterStageWorldPose(stageState, boxHalfWidth, boxHalfDepth);
  const scaleFactor = Math.max(0.001, pose.characterScaleFactor);
  return Math.min(
    MAX_ACTOR_INSTANCE_SCALE,
    Math.max(MIN_ACTOR_INSTANCE_SCALE, maxWorldScale / scaleFactor)
  );
}

export function clampActorInstanceScaleForCharacterStage(
  instanceScale,
  modelBounds,
  stageState,
  boxHalfWidth,
  boxHalfDepth,
  options = {}
) {
  const parsedScale = Number(instanceScale);
  const safeScale = Number.isFinite(parsedScale) ? parsedScale : 1;
  const stage = normalizeCharacterStageState(stageState);
  if (!stage.enabled) {
    return Math.min(
      MAX_ACTOR_INSTANCE_SCALE,
      Math.max(MIN_ACTOR_INSTANCE_SCALE, safeScale)
    );
  }

  const maxScale = getMaxActorInstanceScaleForCharacterStage(
    modelBounds,
    stage,
    boxHalfWidth,
    boxHalfDepth,
    options
  );
  return Math.min(maxScale, Math.max(MIN_ACTOR_INSTANCE_SCALE, safeScale));
}

/**
 * Map an actor index to world XZ on the character stage (fixed layout).
 * Returns null when the stage is disabled.
 */
export function resolveStageActorWorldPosition(
  stageState,
  boxHalfWidth,
  boxHalfDepth,
  actorIndex,
  actorCount
) {
  const pose = getCharacterStageWorldPose(
    stageState,
    boxHalfWidth,
    boxHalfDepth
  );
  if (!pose.enabled) return null;
  const offsets = getStageActorLocalOffsets(actorCount);
  const local = offsets[actorIndex] || { x: 0, z: 0 };
  // Local offsets are in "stage units" (0–0.5 ≈ half booth); scale to size.
  const localScale = pose.size;
  return {
    x: pose.centerX + local.x * localScale,
    z: pose.centerZ + local.z * localScale,
    y: pose.centerY,
    scaleFactor: pose.characterScaleFactor,
  };
}

export {
  DEFAULT_SIZE,
  MIN_SIZE,
  MAX_SIZE,
  BASE_SIZE_FOR_SCALE,
  MIN_ACTOR_INSTANCE_SCALE,
  MAX_ACTOR_INSTANCE_SCALE,
};
