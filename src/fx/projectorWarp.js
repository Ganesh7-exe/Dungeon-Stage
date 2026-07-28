import * as THREE from "three";

/**
 * Composites a rendered face into its calibration quad.
 *
 * Projective (homography) warp — avoids the diagonal crease you get from a
 * 2-triangle bilinear quad when keystoning. Corners are 0–1 image space (y down);
 * content UVs are Three.js style (v up).
 */

/**
 * 4-point DLT homography. Returns THREE.Matrix3 mapping src → dst.
 */
function computeHomography(src, dst) {
  const matrix = Array.from({ length: 8 }, () => Array(9).fill(0));

  for (let index = 0; index < 4; index += 1) {
    const sourceX = src[index].x;
    const sourceY = src[index].y;
    const destX = dst[index].x;
    const destY = dst[index].y;
    const rowA = index * 2;
    const rowB = rowA + 1;
    matrix[rowA][0] = sourceX;
    matrix[rowA][1] = sourceY;
    matrix[rowA][2] = 1;
    matrix[rowA][6] = -destX * sourceX;
    matrix[rowA][7] = -destX * sourceY;
    matrix[rowA][8] = -destX;
    matrix[rowB][3] = sourceX;
    matrix[rowB][4] = sourceY;
    matrix[rowB][5] = 1;
    matrix[rowB][6] = -destY * sourceX;
    matrix[rowB][7] = -destY * sourceY;
    matrix[rowB][8] = -destY;
  }

  const augmented = matrix.map((row) => row.slice());
  for (let column = 0; column < 8; column += 1) {
    let pivotRow = column;
    let pivotValue = Math.abs(augmented[column][column]);
    for (let row = column + 1; row < 8; row += 1) {
      const value = Math.abs(augmented[row][column]);
      if (value > pivotValue) {
        pivotValue = value;
        pivotRow = row;
      }
    }
    if (pivotValue < 1e-10) {
      return new THREE.Matrix3();
    }
    if (pivotRow !== column) {
      const swap = augmented[column];
      augmented[column] = augmented[pivotRow];
      augmented[pivotRow] = swap;
    }
    const pivot = augmented[column][column];
    for (let col = column; col < 9; col += 1) {
      augmented[column][col] /= pivot;
    }
    for (let row = 0; row < 8; row += 1) {
      if (row === column) continue;
      const factor = augmented[row][column];
      for (let col = column; col < 9; col += 1) {
        augmented[row][col] -= factor * augmented[column][col];
      }
    }
  }

  const homography = [
    -augmented[0][8],
    -augmented[1][8],
    -augmented[2][8],
    -augmented[3][8],
    -augmented[4][8],
    -augmented[5][8],
    -augmented[6][8],
    -augmented[7][8],
    1,
  ];

  return new THREE.Matrix3().set(
    homography[0],
    homography[1],
    homography[2],
    homography[3],
    homography[4],
    homography[5],
    homography[6],
    homography[7],
    homography[8]
  );
}

function invertMatrix3(matrix) {
  const inverse = new THREE.Matrix3().copy(matrix).invert();
  if (
    !Number.isFinite(inverse.elements[0]) ||
    !Number.isFinite(inverse.elements[4]) ||
    !Number.isFinite(inverse.elements[8])
  ) {
    return null;
  }
  return inverse;
}

/** Source UVs (v-up) matching TL / TR / BR / BL. */
const SOURCE_UVS = [
  { x: 0, y: 1 },
  { x: 1, y: 1 },
  { x: 1, y: 0 },
  { x: 0, y: 0 },
];

function cornersToDestPoints(corners) {
  return [
    corners.topLeft,
    corners.topRight,
    corners.bottomRight,
    corners.bottomLeft,
  ];
}

function lerp2d(pointA, pointB, amount) {
  return {
    x: pointA.x + (pointB.x - pointA.x) * amount,
    y: pointA.y + (pointB.y - pointA.y) * amount,
  };
}

/**
 * Nest a content-region quad (0–1 inside the face) into the whole-projection
 * keystone. Region full-frame → result equals globalCorners.
 */
export function composeCornerQuad(globalCorners, regionCorners) {
  const global = {
    topLeft: globalCorners?.topLeft || { x: 0, y: 0 },
    topRight: globalCorners?.topRight || { x: 1, y: 0 },
    bottomRight: globalCorners?.bottomRight || { x: 1, y: 1 },
    bottomLeft: globalCorners?.bottomLeft || { x: 0, y: 1 },
  };
  const region = {
    topLeft: regionCorners?.topLeft || { x: 0, y: 0 },
    topRight: regionCorners?.topRight || { x: 1, y: 0 },
    bottomRight: regionCorners?.bottomRight || { x: 1, y: 1 },
    bottomLeft: regionCorners?.bottomLeft || { x: 0, y: 1 },
  };

  const mapPoint = (point) => {
    const top = lerp2d(global.topLeft, global.topRight, point.x);
    const bottom = lerp2d(global.bottomLeft, global.bottomRight, point.x);
    return lerp2d(top, bottom, point.y);
  };

  return {
    topLeft: mapPoint(region.topLeft),
    topRight: mapPoint(region.topRight),
    bottomRight: mapPoint(region.bottomRight),
    bottomLeft: mapPoint(region.bottomLeft),
  };
}

/**
 * Move a content quad through the same homography that takes sourceQuad → destQuad
 * (image space, y down). Used so the 3D booth rides with TL1 map warps.
 */
export function transformCornersThroughQuadHomography(
  sourceQuad,
  destQuad,
  subjectCorners
) {
  if (!sourceQuad || !destQuad || !subjectCorners) return subjectCorners;
  const sourcePoints = [
    sourceQuad.topLeft,
    sourceQuad.topRight,
    sourceQuad.bottomRight,
    sourceQuad.bottomLeft,
  ];
  const destPoints = [
    destQuad.topLeft,
    destQuad.topRight,
    destQuad.bottomRight,
    destQuad.bottomLeft,
  ];
  for (const point of [...sourcePoints, ...destPoints]) {
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      return subjectCorners;
    }
  }
  const homography = computeHomography(sourcePoints, destPoints);
  const elements = homography.elements;
  const mapPoint = (point) => {
    const x = Number(point?.x) || 0;
    const y = Number(point?.y) || 0;
    const w = elements[2] * x + elements[5] * y + elements[8];
    if (Math.abs(w) < 1e-8) return { x, y };
    return {
      x: (elements[0] * x + elements[3] * y + elements[6]) / w,
      y: (elements[1] * x + elements[4] * y + elements[7]) / w,
    };
  };
  return {
    topLeft: mapPoint(subjectCorners.topLeft),
    topRight: mapPoint(subjectCorners.topRight),
    bottomRight: mapPoint(subjectCorners.bottomRight),
    bottomLeft: mapPoint(subjectCorners.bottomLeft),
  };
}

/**
 * Soft-stop TL2 bottom corners (BL2 + BR2 equally) at the map far-edge seam.
 * Image space is y-down — larger y = further onto the battle map.
 * Only clamps bottom Y so TL2/TR2 can still keystone freely.
 */
export function clampStageCornersAboveMap(stageCorners, boothUv, mapPlaneUv) {
  if (!stageCorners) return stageCorners;
  const topY = Math.max(
    Number(stageCorners.topLeft?.y) || 0,
    Number(stageCorners.topRight?.y) || 0
  );
  const boothBottomLeft = Number(boothUv?.bottomLeft?.y);
  const boothBottomRight = Number(boothUv?.bottomRight?.y);
  const boothBottom = Math.max(
    Number.isFinite(boothBottomLeft) ? boothBottomLeft : topY + 0.16,
    Number.isFinite(boothBottomRight) ? boothBottomRight : topY + 0.16
  );
  const mapSeamY = Math.min(
    Number(mapPlaneUv?.topLeft?.y),
    Number(mapPlaneUv?.topRight?.y)
  );

  // Prefer the real map/−Z seam; fall back to a tight booth-bottom stop.
  let limitY = Number.isFinite(mapSeamY)
    ? mapSeamY + 0.01
    : boothBottom + 0.02;
  // Never allow deep travel past the natural booth seat.
  limitY = Math.min(limitY, boothBottom + 0.025);
  // Keep a living quad so TL2 cannot collapse to nothing.
  limitY = Math.max(limitY, topY + 0.05);

  // Per-corner seat so BL2 and BR2 get the same treatment (not one side looser).
  const clampBottom = (corner, boothCornerY) => {
    const seatLimit = Number.isFinite(boothCornerY)
      ? Math.min(limitY, boothCornerY + 0.025)
      : limitY;
    return {
      x: Number(corner?.x) || 0,
      y: Math.min(Number(corner?.y) || 0, seatLimit),
    };
  };

  return {
    topLeft: { ...(stageCorners.topLeft || { x: 0, y: 0 }) },
    topRight: { ...(stageCorners.topRight || { x: 1, y: 0 }) },
    bottomRight: clampBottom(
      stageCorners.bottomRight || { x: 1, y: 1 },
      boothBottomRight
    ),
    bottomLeft: clampBottom(
      stageCorners.bottomLeft || { x: 0, y: 1 },
      boothBottomLeft
    ),
  };
}

function contentCornersArea(corners) {
  if (
    !corners?.topLeft ||
    !corners?.topRight ||
    !corners?.bottomRight ||
    !corners?.bottomLeft
  ) {
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

function copyContentCorners(corners) {
  return {
    topLeft: { ...(corners.topLeft || { x: 0, y: 0 }) },
    topRight: { ...(corners.topRight || { x: 1, y: 0 }) },
    bottomRight: { ...(corners.bottomRight || { x: 1, y: 1 }) },
    bottomLeft: { ...(corners.bottomLeft || { x: 0, y: 1 }) },
  };
}

function cross2d(originX, originY, axisX, axisY) {
  return originX * axisY - originY * axisX;
}

/** Convex + sensible TL/TR/BR/BL roles — blocks bowties / collapsed warps. */
function isStageKeystoneConvex(corners) {
  if (
    !corners?.topLeft ||
    !corners?.topRight ||
    !corners?.bottomRight ||
    !corners?.bottomLeft
  ) {
    return false;
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
  area *= 0.5;
  if (!(Math.abs(area) > 0.008)) return false;

  let turnSign = 0;
  for (let index = 0; index < 4; index += 1) {
    const a = points[index];
    const b = points[(index + 1) % 4];
    const c = points[(index + 2) % 4];
    const cross = cross2d(
      Number(b.x) - Number(a.x),
      Number(b.y) - Number(a.y),
      Number(c.x) - Number(b.x),
      Number(c.y) - Number(b.y)
    );
    if (Math.abs(cross) < 1e-7) continue;
    const sign = Math.sign(cross);
    if (turnSign === 0) turnSign = sign;
    else if (sign !== turnSign) return false;
  }
  if (turnSign === 0) return false;

  if (!(corners.topLeft.y <= corners.bottomLeft.y + 0.015)) return false;
  if (!(corners.topRight.y <= corners.bottomRight.y + 0.015)) return false;
  if (!(corners.topLeft.x <= corners.topRight.x + 0.015)) return false;
  if (!(corners.bottomLeft.x <= corners.bottomRight.x + 0.015)) return false;
  return true;
}

/**
 * TL2 keystone: each corner (TL2/TR2/BL2/BR2) warps independently for a real
 * trapezoid fit, leashed near the booth so one yank cannot tear the image.
 * BL2 and BR2 share the same leash + map-seam stop.
 */
export function constrainStageKeystoneWindow(
  stageCorners,
  boothUv,
  mapPlaneUv,
  options = {}
) {
  if (!boothUv?.topLeft) return stageCorners;
  if (!stageCorners) return copyContentCorners(boothUv);

  const cornerKeys = ["topLeft", "topRight", "bottomRight", "bottomLeft"];
  const draggedKey = options.draggedCornerKey || null;

  // Enough for projector keystone on every corner, including BL2/BR2.
  const maxDelta = 0.09;
  let next = {};
  for (const key of cornerKeys) {
    const boothCorner = boothUv[key];
    const corner = stageCorners[key];
    if (!boothCorner || !corner) {
      next[key] = boothCorner
        ? { x: Number(boothCorner.x), y: Number(boothCorner.y) }
        : { x: 0.5, y: 0.5 };
      continue;
    }
    next[key] = {
      x: Math.min(
        boothCorner.x + maxDelta,
        Math.max(boothCorner.x - maxDelta, Number(corner.x) || 0)
      ),
      y: Math.min(
        boothCorner.y + maxDelta,
        Math.max(boothCorner.y - maxDelta, Number(corner.y) || 0)
      ),
    };
  }

  next = clampStageCornersAboveMap(next, boothUv, mapPlaneUv);

  const boothArea = Math.max(0.02, contentCornersArea(boothUv));
  const minArea = boothArea * 0.55;
  const maxArea = Math.min(0.22, boothArea * 1.85);
  let area = contentCornersArea(next);

  // If the warp went non-convex / oversized, pull the dragged corner (or all)
  // back toward the booth until it is safe again.
  const repairTowardBooth = (blend) => {
    const keys =
      draggedKey && next[draggedKey] ? [draggedKey] : cornerKeys;
    for (const key of keys) {
      const boothCorner = boothUv[key];
      const corner = next[key];
      if (!boothCorner || !corner) continue;
      next[key] = {
        x: corner.x + (boothCorner.x - corner.x) * blend,
        y: corner.y + (boothCorner.y - corner.y) * blend,
      };
    }
    next = clampStageCornersAboveMap(next, boothUv, mapPlaneUv);
    area = contentCornersArea(next);
  };

  if (!isStageKeystoneConvex(next) || area > maxArea || area < minArea) {
    for (const blend of [0.35, 0.55, 0.75, 0.92, 1]) {
      repairTowardBooth(blend);
      if (
        isStageKeystoneConvex(next) &&
        area <= maxArea &&
        area >= minArea
      ) {
        break;
      }
    }
  }

  if (!isStageKeystoneConvex(next) || area > maxArea || area < minArea * 0.85) {
    return copyContentCorners(boothUv);
  }

  return next;
}

/**
 * Keep TL1 map corners from extreme yanks that tear the homography
 * (jagged / blown-out map edges).
 */
export function constrainMapKeystoneWindow(mapCorners, mapPlaneUv) {
  if (!mapCorners || !mapPlaneUv?.topLeft) return mapCorners;
  const cornerKeys = ["topLeft", "topRight", "bottomRight", "bottomLeft"];
  const maxDelta = 0.28;
  const next = {};
  for (const key of cornerKeys) {
    const planeCorner = mapPlaneUv[key];
    const corner = mapCorners[key];
    if (!planeCorner || !corner) {
      next[key] = corner ? { ...corner } : { x: 0.5, y: 0.5 };
      continue;
    }
    next[key] = {
      x: Math.min(
        planeCorner.x + maxDelta,
        Math.max(planeCorner.x - maxDelta, Number(corner.x) || 0)
      ),
      y: Math.min(
        planeCorner.y + maxDelta,
        Math.max(planeCorner.y - maxDelta, Number(corner.y) || 0)
      ),
    };
  }
  return next;
}

function cornerToNdc(corner) {
  return {
    x: corner.x * 2 - 1,
    y: -(corner.y * 2 - 1),
  };
}

export function createProjectorWarp(sourceTexture = null) {
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);

  const geometry = new THREE.PlaneGeometry(2, 2);
  const inverseHomography = { value: new THREE.Matrix3() };
  const clipEnabled = { value: 0 };
  const clipQuad = {
    value: [
      new THREE.Vector2(0, 0),
      new THREE.Vector2(1, 0),
      new THREE.Vector2(1, 1),
      new THREE.Vector2(0, 1),
    ],
  };
  const material = new THREE.ShaderMaterial({
    uniforms: {
      tDiffuse: { value: sourceTexture },
      uInverseHomography: inverseHomography,
      uClipEnabled: clipEnabled,
      uClipQuad: clipQuad,
    },
    vertexShader: /* glsl */ `
      varying vec2 vImageUv;
      void main() {
        vImageUv = vec2(uv.x, 1.0 - uv.y);
        gl_Position = vec4(position.xy, -1.0, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform sampler2D tDiffuse;
      uniform mat3 uInverseHomography;
      uniform float uClipEnabled;
      uniform vec2 uClipQuad[4];
      varying vec2 vImageUv;

      bool pointInsideConvexQuad(vec2 point) {
        float winding = 0.0;
        for (int index = 0; index < 4; index += 1) {
          vec2 cornerA = uClipQuad[index];
          vec2 cornerB = uClipQuad[index == 3 ? 0 : index + 1];
          float cross =
            (cornerB.x - cornerA.x) * (point.y - cornerA.y) -
            (cornerB.y - cornerA.y) * (point.x - cornerA.x);
          if (abs(cross) < 1e-7) continue;
          float signValue = sign(cross);
          if (winding == 0.0) winding = signValue;
          else if (signValue != winding) return false;
        }
        return winding != 0.0;
      }

      void main() {
        // Keep the 3D booth from painting over the battle map when TL2
        // bottom corners are dragged downward into the map quad.
        if (uClipEnabled > 0.5 && pointInsideConvexQuad(vImageUv)) {
          discard;
        }
        vec3 homogeneous = uInverseHomography * vec3(vImageUv, 1.0);
        if (abs(homogeneous.z) < 1e-5) discard;
        vec2 sourceUv = homogeneous.xy / homogeneous.z;
        if (
          sourceUv.x < 0.0 || sourceUv.x > 1.0 ||
          sourceUv.y < 0.0 || sourceUv.y > 1.0
        ) {
          discard;
        }
        vec4 sampleColor = texture2D(tDiffuse, sourceUv);
        // Transparent RT clears (stage-over-map) must not stamp black.
        if (sampleColor.a < 0.02) discard;
        gl_FragColor = sampleColor;
      }
    `,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
    transparent: true,
  });

  const quad = new THREE.Mesh(geometry, material);
  quad.frustumCulled = false;
  const scene = new THREE.Scene();
  scene.add(quad);

  const outlineGeometry = new THREE.BufferGeometry();
  outlineGeometry.setAttribute(
    "position",
    new THREE.BufferAttribute(new Float32Array(15), 3)
  );
  const outline = new THREE.Line(
    outlineGeometry,
    new THREE.LineBasicMaterial({ color: 0xd4a017 })
  );
  outline.frustumCulled = false;
  const outlineScene = new THREE.Scene();
  outlineScene.add(outline);

  function writeOutline(corners) {
    const ordered = [
      corners.topLeft,
      corners.topRight,
      corners.bottomRight,
      corners.bottomLeft,
    ];
    const positions = outlineGeometry.attributes.position.array;
    for (let index = 0; index < 4; index += 1) {
      const ndc = cornerToNdc(ordered[index]);
      positions[index * 3 + 0] = ndc.x;
      positions[index * 3 + 1] = ndc.y;
      positions[index * 3 + 2] = -1;
    }
    positions[12] = positions[0];
    positions[13] = positions[1];
    positions[14] = -1;
    outlineGeometry.attributes.position.needsUpdate = true;
    outlineGeometry.setDrawRange(0, 5);
    outlineGeometry.computeBoundingSphere();
  }

  function applyCorners(destCorners, sourceCorners = null) {
    const destLive = cornersToDestPoints(destCorners).map((point) => ({
      x: Number.isFinite(point.x) ? point.x : 0.5,
      y: Number.isFinite(point.y) ? point.y : 0.5,
    }));
    // Optional source quad in image space (y down) — crop a region of the RT
    // (e.g. the 3D booth) into the destination instead of the full frame.
    const sourceLive = sourceCorners
      ? cornersToDestPoints(sourceCorners).map((point) => ({
          x: Number.isFinite(point.x) ? point.x : 0.5,
          // Homography source uses v-up (Three / GL texture space).
          y: 1 - (Number.isFinite(point.y) ? point.y : 0.5),
        }))
      : SOURCE_UVS;
    const forward = computeHomography(sourceLive, destLive);
    const inverse = invertMatrix3(forward);
    if (inverse) {
      inverseHomography.value.copy(inverse);
    } else {
      inverseHomography.value.identity();
    }
    writeOutline(destCorners);
  }

  function setMapClipQuad(corners) {
    if (!corners) {
      clipEnabled.value = 0;
      return;
    }
    const ordered = cornersToDestPoints(corners);
    for (let index = 0; index < 4; index += 1) {
      clipQuad.value[index].set(
        Number(ordered[index]?.x) || 0,
        Number(ordered[index]?.y) || 0
      );
    }
    clipEnabled.value = 1;
  }

  applyCorners({
    topLeft: { x: 0, y: 0 },
    topRight: { x: 1, y: 0 },
    bottomRight: { x: 1, y: 1 },
    bottomLeft: { x: 0, y: 1 },
  });

  return {
    clearOutput(renderer) {
      clipEnabled.value = 0;
      renderer.setRenderTarget(null);
      renderer.setScissorTest(false);
      renderer.setClearColor(0x000000, 1);
      renderer.clear(true, true, true);
    },

    drawFace(renderer, sourceTexture, corners, sourceCorners = null) {
      if (!sourceTexture) return;
      clipEnabled.value = 0;
      applyCorners(corners, sourceCorners);
      material.uniforms.tDiffuse.value = sourceTexture;
      renderer.setRenderTarget(null);
      renderer.setScissorTest(false);
      renderer.setClearColor(0x000000, 1);
      renderer.clear(true, true, true);
      const previousAutoClear = renderer.autoClear;
      renderer.autoClear = false;
      renderer.render(scene, camera);
      renderer.autoClear = previousAutoClear;
    },

    /**
     * @param {object|null} [options.mapClipCorners] — when set, fragments
     *   inside this image-space quad are discarded (keeps booth off the map).
     */
    drawFaceAdditive(renderer, sourceTexture, corners, sourceCorners = null, options = {}) {
      if (!sourceTexture) return;
      setMapClipQuad(options.mapClipCorners || null);
      applyCorners(corners, sourceCorners);
      material.uniforms.tDiffuse.value = sourceTexture;
      renderer.setRenderTarget(null);
      renderer.setScissorTest(false);
      const previousAutoClear = renderer.autoClear;
      renderer.autoClear = false;
      renderer.render(scene, camera);
      renderer.autoClear = previousAutoClear;
      clipEnabled.value = 0;
    },

    drawFaceOutline(renderer, corners) {
      writeOutline(corners);
      renderer.setRenderTarget(null);
      renderer.setScissorTest(false);
      const previousAutoClear = renderer.autoClear;
      renderer.autoClear = false;
      renderer.render(outlineScene, camera);
      renderer.autoClear = previousAutoClear;
    },

    dispose() {
      geometry.dispose();
      material.dispose();
      outlineGeometry.dispose();
      outline.material.dispose();
    },
  };
}
