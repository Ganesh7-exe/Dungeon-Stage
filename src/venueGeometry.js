import * as THREE from "three";

/**
 * Physical description of the venue: the box standing on the stage, where the
 * projectors are rigged on the balcony, and where the spectators they serve
 * are standing.
 *
 * Real-world measurements are entered in centimetres and metres, then scaled so
 * that the box top is always BOX_WIDTH_UNITS across. Keeping that invariant
 * means existing actor placement ranges and battle-map UVs are unaffected by
 * the physical size of the box.
 */

export const BOX_WIDTH_UNITS = 2.4;

/** Azimuth 0 points along +Z ("front"), increasing clockwise seen from above. */
export const FACE_IDS = ["top", "front", "right", "back", "left"];

export const FACE_LABELS = {
  top: "Top",
  front: "Front",
  right: "Right",
  back: "Back",
  left: "Left",
};

const SIDE_FACE_AZIMUTHS = {
  front: 0,
  right: 90,
  back: 180,
  left: 270,
};

function clampNumber(value, minimum, maximum, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, parsed));
}

function normalizeAzimuth(degrees) {
  const parsed = Number(degrees);
  if (!Number.isFinite(parsed)) return 0;
  return ((parsed % 360) + 360) % 360;
}

export function createDefaultBoxDimensions() {
  return {
    widthCm: 120,
    depthCm: 120,
    heightCm: 60,
  };
}

export function normalizeBoxDimensions(raw = {}) {
  const fallback = createDefaultBoxDimensions();
  return {
    widthCm: clampNumber(raw.widthCm, 10, 2000, fallback.widthCm),
    depthCm: clampNumber(raw.depthCm, 10, 2000, fallback.depthCm),
    heightCm: clampNumber(raw.heightCm, 0, 2000, fallback.heightCm),
  };
}

/** World units per real centimetre, pinned so the box top spans BOX_WIDTH_UNITS. */
export function getUnitsPerCm(dimensions) {
  const { widthCm } = normalizeBoxDimensions(dimensions);
  return BOX_WIDTH_UNITS / widthCm;
}

export function getUnitsPerMetre(dimensions) {
  return getUnitsPerCm(dimensions) * 100;
}

/** Box extents in world units. The top surface sits at y = 0. */
export function getBoxExtents(dimensions) {
  const { widthCm, depthCm, heightCm } = normalizeBoxDimensions(dimensions);
  const unitsPerCm = getUnitsPerCm(dimensions);
  return {
    halfWidth: (widthCm * unitsPerCm) / 2,
    halfDepth: (depthCm * unitsPerCm) / 2,
    height: heightCm * unitsPerCm,
  };
}

/**
 * The three corners each face needs for an off-axis frustum, chosen so that
 * `cross(lowerRight - lowerLeft, upperLeft - lowerLeft)` points out of the box
 * towards the viewer.
 *
 * "Up" on the top face runs towards -Z, matching an overhead viewer on the
 * +Z side of the stage.
 */
export function buildBoxFaces(dimensions) {
  const { halfWidth, halfDepth, height } = getBoxExtents(dimensions);
  const floorY = -height;

  return {
    top: {
      id: "top",
      lowerLeft: new THREE.Vector3(-halfWidth, 0, halfDepth),
      lowerRight: new THREE.Vector3(halfWidth, 0, halfDepth),
      upperLeft: new THREE.Vector3(-halfWidth, 0, -halfDepth),
    },
    front: {
      id: "front",
      lowerLeft: new THREE.Vector3(-halfWidth, floorY, halfDepth),
      lowerRight: new THREE.Vector3(halfWidth, floorY, halfDepth),
      upperLeft: new THREE.Vector3(-halfWidth, 0, halfDepth),
    },
    right: {
      id: "right",
      lowerLeft: new THREE.Vector3(halfWidth, floorY, halfDepth),
      lowerRight: new THREE.Vector3(halfWidth, floorY, -halfDepth),
      upperLeft: new THREE.Vector3(halfWidth, 0, halfDepth),
    },
    back: {
      id: "back",
      lowerLeft: new THREE.Vector3(halfWidth, floorY, -halfDepth),
      lowerRight: new THREE.Vector3(-halfWidth, floorY, -halfDepth),
      upperLeft: new THREE.Vector3(halfWidth, 0, -halfDepth),
    },
    left: {
      id: "left",
      lowerLeft: new THREE.Vector3(-halfWidth, floorY, -halfDepth),
      lowerRight: new THREE.Vector3(-halfWidth, floorY, halfDepth),
      upperLeft: new THREE.Vector3(-halfWidth, 0, -halfDepth),
    },
  };
}

/**
 * Each projector is a placeable 3D camera in the control preview. Its world
 * position is the spectator sweet-spot the anamorphic frustum is built from.
 *
 * Prefer free `positionM` (metres from box centre, y = 0 at the box top).
 * Polar fields stay in sync so older saved scenes and the fine-tune sliders
 * keep working.
 */
export function createDefaultViewerZone(azimuthDegrees = 0) {
  const azimuth = normalizeAzimuth(azimuthDegrees);
  const distanceM = 6;
  const heightM = 3.5;
  const azimuthRadians = THREE.MathUtils.degToRad(azimuth);
  return {
    azimuthDegrees: azimuth,
    distanceM,
    heightM,
    positionM: {
      x: Math.sin(azimuthRadians) * distanceM,
      y: heightM,
      z: Math.cos(azimuthRadians) * distanceM,
    },
  };
}

function normalizePositionM(raw, fallback) {
  return {
    x: clampNumber(raw?.x, -80, 80, fallback.x),
    y: clampNumber(raw?.y, -10, 40, fallback.y),
    z: clampNumber(raw?.z, -80, 80, fallback.z),
  };
}

/** Keep polar fields derived from free XYZ (and the reverse). */
export function syncViewerPolarFromPosition(viewer) {
  const position = viewer.positionM || { x: 0, y: 0, z: 0 };
  viewer.heightM = clampNumber(position.y, -10, 40, 0);
  viewer.distanceM = clampNumber(Math.hypot(position.x, position.z), 0.5, 80, 0.5);
  viewer.azimuthDegrees = normalizeAzimuth(
    THREE.MathUtils.radToDeg(Math.atan2(position.x, position.z))
  );
  return viewer;
}

export function syncViewerPositionFromPolar(viewer) {
  const azimuthRadians = THREE.MathUtils.degToRad(viewer.azimuthDegrees || 0);
  const distanceM = clampNumber(viewer.distanceM, 0.5, 80, 6);
  const heightM = clampNumber(viewer.heightM, -10, 40, 3.5);
  viewer.positionM = {
    x: Math.sin(azimuthRadians) * distanceM,
    y: heightM,
    z: Math.cos(azimuthRadians) * distanceM,
  };
  return viewer;
}

export function normalizeViewerZone(raw = {}, fallbackAzimuth = 0) {
  const fallback = createDefaultViewerZone(fallbackAzimuth);
  const hasFreePosition =
    raw.positionM &&
    Number.isFinite(Number(raw.positionM.x)) &&
    Number.isFinite(Number(raw.positionM.y)) &&
    Number.isFinite(Number(raw.positionM.z));

  if (hasFreePosition) {
    const viewer = {
      azimuthDegrees: normalizeAzimuth(raw.azimuthDegrees ?? fallback.azimuthDegrees),
      distanceM: clampNumber(raw.distanceM, 0.5, 80, fallback.distanceM),
      heightM: clampNumber(raw.heightM, -10, 40, fallback.heightM),
      positionM: normalizePositionM(raw.positionM, fallback.positionM),
    };
    return syncViewerPolarFromPosition(viewer);
  }

  const viewer = {
    azimuthDegrees: normalizeAzimuth(raw.azimuthDegrees ?? fallback.azimuthDegrees),
    distanceM: clampNumber(raw.distanceM, 0.5, 80, fallback.distanceM),
    heightM: clampNumber(raw.heightM, -10, 40, fallback.heightM),
  };
  return syncViewerPositionFromPolar(viewer);
}

/** Viewer / projector eye in world units, relative to the box top at y = 0. */
export function computeEyePosition(viewerZone, dimensions, target = new THREE.Vector3()) {
  const zone = normalizeViewerZone(viewerZone);
  const unitsPerMetre = getUnitsPerMetre(dimensions);
  return target.set(
    zone.positionM.x * unitsPerMetre,
    zone.positionM.y * unitsPerMetre,
    zone.positionM.z * unitsPerMetre
  );
}

/**
 * Write a world-space eye position back onto the viewer as metres, then sync
 * the polar readouts used by the panel.
 */
export function setViewerWorldPosition(viewer, dimensions, worldPosition) {
  const unitsPerMetre = getUnitsPerMetre(dimensions);
  if (!(unitsPerMetre > 0)) return normalizeViewerZone(viewer);
  viewer.positionM = {
    x: worldPosition.x / unitsPerMetre,
    y: worldPosition.y / unitsPerMetre,
    z: worldPosition.z / unitsPerMetre,
  };
  return syncViewerPolarFromPosition(viewer);
}

/** Drop the active projector above the box so its frustum covers the top face. */
export function placeViewerAboveBox(viewer, heightM = 3.5) {
  viewer.positionM = {
    x: 0,
    y: clampNumber(heightM, 0.5, 40, 3.5),
    z: 0,
  };
  return syncViewerPolarFromPosition(viewer);
}

/** The side face most squarely presented to a viewer at this azimuth. */
export function nearestSideFaceId(azimuthDegrees) {
  const azimuth = normalizeAzimuth(azimuthDegrees);
  let closestId = "front";
  let smallestDelta = Infinity;
  for (const [faceId, faceAzimuth] of Object.entries(SIDE_FACE_AZIMUTHS)) {
    const rawDelta = Math.abs(azimuth - faceAzimuth);
    const delta = Math.min(rawDelta, 360 - rawDelta);
    if (delta < smallestDelta) {
      smallestDelta = delta;
      closestId = faceId;
    }
  }
  return closestId;
}

export function createDefaultFaceCorners(faceId = "top") {
  // True full-frame — Open on projector must start wall-to-wall with no hole.
  void faceId;
  return {
    topLeft: { x: 0, y: 0 },
    topRight: { x: 1, y: 0 },
    bottomRight: { x: 1, y: 1 },
    bottomLeft: { x: 0, y: 1 },
  };
}

/**
 * Per-content keystone quads nested inside the whole-projection face corners.
 * - battleMap → TL1 / TR1 / BR1 / BL1
 * - characterStage → TL2 / TR2 / BR2 / BL2
 * Defaults are full-frame so behaviour matches a single TL/TR/BR/BL warp
 * until the user starts dragging the numbered handles.
 */
export function createDefaultContentCorners() {
  return {
    battleMap: createDefaultFaceCorners("top"),
    characterStage: createDefaultFaceCorners("top"),
  };
}

export function normalizeContentCorners(raw = {}) {
  const fallback = createDefaultContentCorners();
  return {
    battleMap: normalizeFaceCorners(raw.battleMap, "top"),
    characterStage: normalizeFaceCorners(raw.characterStage, "top"),
  };
}

/** True when a corner set is effectively the full projector frame. */
export function isFullFrameCorners(corners, epsilon = 0.02) {
  if (!corners) return true;
  const full = createDefaultFaceCorners("top");
  for (const key of Object.keys(full)) {
    const point = corners[key];
    if (!point) return false;
    if (Math.abs(Number(point.x) - full[key].x) > epsilon) return false;
    if (Math.abs(Number(point.y) - full[key].y) > epsilon) return false;
  }
  return true;
}

/** Absolute shoelace area of a corner quad in 0–1 image space (full frame ≈ 1). */
export function faceCornersArea(corners) {
  if (!corners?.topLeft || !corners?.topRight || !corners?.bottomRight || !corners?.bottomLeft) {
    return 0;
  }
  const points = [
    corners.topLeft,
    corners.topRight,
    corners.bottomRight,
    corners.bottomLeft,
  ];
  let area = 0;
  for (let index = 0; index < 4; index += 1) {
    const a = points[index];
    const b = points[(index + 1) % 4];
    area += Number(a.x) * Number(b.y) - Number(b.x) * Number(a.y);
  }
  return Math.abs(area) * 0.5;
}

/**
 * Keystone handles may travel past the screen edge so you can stretch a corner
 * outward (onto a real box that sits near / past the throw boundary), not only
 * pull inward. Values are still in image-space where 0–1 is the projector frame.
 */
/** Allow keystone past the projector frame; sticky UI knobs stay on-screen. */
export const FACE_CORNER_MIN = -0.75;
export const FACE_CORNER_MAX = 1.75;

export function clampFaceCornerAxis(value, fallback = 0.5) {
  return clampNumber(value, FACE_CORNER_MIN, FACE_CORNER_MAX, fallback);
}

export function clampFaceCorner(corner = {}, fallback = { x: 0.5, y: 0.5 }) {
  return {
    x: clampFaceCornerAxis(corner?.x, fallback.x),
    y: clampFaceCornerAxis(corner?.y, fallback.y),
  };
}

function cross2d(originX, originY, axisX, axisY) {
  return originX * axisY - originY * axisX;
}

/** Convex + sensible corner roles (not a bowtie / crossed quad). */
export function areFaceCornersHealthy(corners) {
  if (!corners?.topLeft || !corners?.topRight || !corners?.bottomRight || !corners?.bottomLeft) {
    return false;
  }
  const points = [
    corners.topLeft,
    corners.topRight,
    corners.bottomRight,
    corners.bottomLeft,
  ];
  const slack = 0.02;
  for (const point of points) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return false;
    if (
      point.x < FACE_CORNER_MIN - slack ||
      point.x > FACE_CORNER_MAX + slack ||
      point.y < FACE_CORNER_MIN - slack ||
      point.y > FACE_CORNER_MAX + slack
    ) {
      return false;
    }
  }

  let area = 0;
  for (let index = 0; index < 4; index += 1) {
    const a = points[index];
    const b = points[(index + 1) % 4];
    area += a.x * b.y - b.x * a.y;
  }
  area *= 0.5;
  // Wrong winding or collapsed.
  if (!(area > 0.08)) return false;

  // Same-turn convex test — bowties flip the cross-product sign.
  let turnSign = 0;
  for (let index = 0; index < 4; index += 1) {
    const a = points[index];
    const b = points[(index + 1) % 4];
    const c = points[(index + 2) % 4];
    const cross = cross2d(b.x - a.x, b.y - a.y, c.x - b.x, c.y - b.y);
    if (Math.abs(cross) < 1e-6) continue;
    const sign = Math.sign(cross);
    if (turnSign === 0) turnSign = sign;
    else if (sign !== turnSign) return false;
  }
  if (turnSign === 0) return false;

  // Keep labels roughly in their quadrants so TL/TR/BR/BL stay meaningful.
  if (!(corners.topLeft.y <= corners.bottomLeft.y + 0.02)) return false;
  if (!(corners.topRight.y <= corners.bottomRight.y + 0.02)) return false;
  if (!(corners.topLeft.x <= corners.topRight.x + 0.02)) return false;
  if (!(corners.bottomLeft.x <= corners.bottomRight.x + 0.02)) return false;

  const widthTop = Math.hypot(
    corners.topRight.x - corners.topLeft.x,
    corners.topRight.y - corners.topLeft.y
  );
  const widthBottom = Math.hypot(
    corners.bottomRight.x - corners.bottomLeft.x,
    corners.bottomRight.y - corners.bottomLeft.y
  );
  const heightLeft = Math.hypot(
    corners.bottomLeft.x - corners.topLeft.x,
    corners.bottomLeft.y - corners.topLeft.y
  );
  const heightRight = Math.hypot(
    corners.bottomRight.x - corners.topRight.x,
    corners.bottomRight.y - corners.topRight.y
  );
  if (Math.min(widthTop, widthBottom, heightLeft, heightRight) < 0.08) {
    return false;
  }
  return true;
}

/**
 * Looser than "healthy": still rejects bowties / collapsed quads, but allows
 * strongly stretched keystone that sits past the frame edge. Used for the live
 * warp so dragging a corner doesn't snap the picture back to full-frame.
 */
export function areFaceCornersUsable(corners) {
  if (!corners?.topLeft || !corners?.topRight || !corners?.bottomRight || !corners?.bottomLeft) {
    return false;
  }
  const points = [
    corners.topLeft,
    corners.topRight,
    corners.bottomRight,
    corners.bottomLeft,
  ];
  for (const point of points) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return false;
    if (
      point.x < FACE_CORNER_MIN - 0.05 ||
      point.x > FACE_CORNER_MAX + 0.05 ||
      point.y < FACE_CORNER_MIN - 0.05 ||
      point.y > FACE_CORNER_MAX + 0.05
    ) {
      return false;
    }
  }

  let area = 0;
  for (let index = 0; index < 4; index += 1) {
    const a = points[index];
    const b = points[(index + 1) % 4];
    area += a.x * b.y - b.x * a.y;
  }
  area *= 0.5;
  if (!(Math.abs(area) > 0.02)) return false;

  let turnSign = 0;
  for (let index = 0; index < 4; index += 1) {
    const a = points[index];
    const b = points[(index + 1) % 4];
    const c = points[(index + 2) % 4];
    const cross = cross2d(b.x - a.x, b.y - a.y, c.x - b.x, c.y - b.y);
    if (Math.abs(cross) < 1e-6) continue;
    const sign = Math.sign(cross);
    if (turnSign === 0) turnSign = sign;
    else if (sign !== turnSign) return false;
  }
  return turnSign !== 0;
}

export function resetFaceCornersToFullFrame(faceId = "top") {
  return createDefaultFaceCorners(faceId);
}

/** Reset any face whose keystone quad would punch a black hole in the feed. */
export function repairProjectorFaceCorners(projector) {
  if (!projector) return projector;
  if (!projector.faceCorners) projector.faceCorners = {};
  const faceIds = projector.faceIds?.length ? projector.faceIds : ["top"];
  for (const faceId of faceIds) {
    if (!areFaceCornersUsable(projector.faceCorners[faceId])) {
      projector.faceCorners[faceId] = resetFaceCornersToFullFrame(faceId);
    }
  }
  return projector;
}

/**
 * One projector on the balcony. Default to the top face only — extra side
 * faces can be enabled later. Multiple faces at once stack TL/TR/BL/BR
 * handles and make keystone feel broken.
 */
export const PROJECTION_MODES = ["projector", "mapping", "anamorphic"];

export function normalizeProjectionMode(raw) {
  if (raw === "anamorphic") return "anamorphic";
  if (raw === "mapping") return "mapping";
  // Legacy "camera" was the broken grazing path — treat as projector throw.
  if (raw === "camera" || raw === "projector" || raw == null || raw === "") {
    return "projector";
  }
  return "projector";
}

export function createDefaultProjector(index = 0, azimuthDegrees = 0) {
  return {
    id: `projector-${index + 1}`,
    label: `Projector ${index + 1}`,
    enabled: true,
    azimuthDegrees: normalizeAzimuth(azimuthDegrees),
    /**
     * projector / mapping = fixed face picture + keystone (lamp pose is aim-only).
     * anamorphic = sweet-spot off-axis 3D (eye pose drives the picture).
     */
    projectionMode: "projector",
    /** Vertical field of view in degrees — matches the virtual lens / frustum. */
    fovDegrees: 40,
    /** Throw aspect (width/height), typically 16:9 projector. */
    aspect: 16 / 9,
    viewer: createDefaultViewerZone(azimuthDegrees),
    faceIds: ["top"],
    faceCorners: {
      top: createDefaultFaceCorners("top"),
    },
    /** Nested map (TL1…) / 3D stage (TL2…) quads inside faceCorners. */
    contentCorners: createDefaultContentCorners(),
  };
}

function normalizeFaceCorners(raw = {}, faceId = "top") {
  const fallback = createDefaultFaceCorners(faceId);
  const normalized = {};
  for (const key of Object.keys(fallback)) {
    const corner = raw[key] || fallback[key];
    normalized[key] = clampFaceCorner(corner, fallback[key]);
  }
  return normalized;
}

export function normalizeProjector(raw = {}, index = 0) {
  const azimuthDegrees = normalizeAzimuth(raw.azimuthDegrees ?? index * 180);
  const fallback = createDefaultProjector(index, azimuthDegrees);
  const faceIds = Array.isArray(raw.faceIds)
    ? raw.faceIds.filter((faceId) => FACE_IDS.includes(faceId))
    : fallback.faceIds;
  const resolvedFaceIds = faceIds.length ? [...new Set(faceIds)] : fallback.faceIds;

  const faceCorners = {};
  for (const faceId of resolvedFaceIds) {
    faceCorners[faceId] = normalizeFaceCorners(raw.faceCorners?.[faceId], faceId);
  }
  for (const faceId of resolvedFaceIds) {
    // Only wipe a bowtie / collapsed quad. Strongly stretched keystone that
    // still draws must survive normalize — otherwise drag→save snaps handles home.
    if (!areFaceCornersUsable(faceCorners[faceId])) {
      faceCorners[faceId] = resetFaceCornersToFullFrame(faceId);
    }
  }

  const viewer = normalizeViewerZone(raw.viewer, azimuthDegrees);
  const projectionMode = normalizeProjectionMode(raw.projectionMode);
  const contentCorners = normalizeContentCorners(raw.contentCorners);
  for (const regionId of Object.keys(contentCorners)) {
    if (!areFaceCornersUsable(contentCorners[regionId])) {
      contentCorners[regionId] = createDefaultFaceCorners("top");
    }
  }

  return {
    id: typeof raw.id === "string" && raw.id ? raw.id : fallback.id,
    label: typeof raw.label === "string" && raw.label ? raw.label : fallback.label,
    enabled: raw.enabled !== false,
    azimuthDegrees: viewer.azimuthDegrees,
    projectionMode,
    fovDegrees: clampNumber(raw.fovDegrees, 10, 120, fallback.fovDegrees),
    aspect: clampNumber(raw.aspect, 0.5, 3, fallback.aspect),
    viewer,
    faceIds: resolvedFaceIds,
    faceCorners,
    contentCorners,
  };
}

export function createDefaultVenueState() {
  return {
    enabled: false,
    activeProjectorId: "projector-1",
    /** Which face's TL/TR/BR/BL handles are shown / edited (one at a time). */
    calibrationFaceId: "top",
    showFaceOutlines: true,
    /** Deprecated — lamp aim helpers removed from UI; kept for state compat. */
    showFrustumHelpers: false,
    /** OS display id for Open projector feed (Electron / Window Management). */
    outputDisplayId: "",
    /** Fullscreen the feed on the chosen display when opening. */
    openFullscreenOnOutput: true,
    box: createDefaultBoxDimensions(),
    projectors: [createDefaultProjector(0, 0), createDefaultProjector(1, 180)],
  };
}

export function normalizeVenueState(raw = {}) {
  const fallback = createDefaultVenueState();
  const rawProjectors = Array.isArray(raw.projectors) && raw.projectors.length
    ? raw.projectors
    : fallback.projectors;
  const projectors = rawProjectors
    .slice(0, 6)
    .map((projector, index) => normalizeProjector(projector, index));

  const activeProjectorId = projectors.some(
    (projector) => projector.id === raw.activeProjectorId
  )
    ? raw.activeProjectorId
    : projectors[0].id;

  const activeProjector =
    projectors.find((projector) => projector.id === activeProjectorId) ||
    projectors[0];
  const requestedFace = FACE_IDS.includes(raw.calibrationFaceId)
    ? raw.calibrationFaceId
    : "top";
  const calibrationFaceId = activeProjector?.faceIds?.includes(requestedFace)
    ? requestedFace
    : activeProjector?.faceIds?.[0] || "top";

  return {
    enabled: Boolean(raw.enabled),
    activeProjectorId,
    calibrationFaceId,
    showFaceOutlines: raw.showFaceOutlines !== false,
    showFrustumHelpers: false,
    outputDisplayId:
      raw.outputDisplayId == null ? "" : String(raw.outputDisplayId),
    openFullscreenOnOutput: raw.openFullscreenOnOutput !== false,
    box: normalizeBoxDimensions(raw.box),
    projectors,
  };
}

export function getProjectorById(venueState, projectorId) {
  const projectors = venueState?.projectors || [];
  return (
    projectors.find((projector) => projector.id === projectorId) ||
    projectors[0] ||
    null
  );
}
