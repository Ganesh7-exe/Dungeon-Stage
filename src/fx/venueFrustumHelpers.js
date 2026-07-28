import * as THREE from "three";
import {
  buildBoxFaces,
  computeEyePosition,
  getBoxExtents,
} from "../venueGeometry.js";
import { isFaceVisibleFromEye as faceVisible } from "../anamorphic.js";

/**
 * Control-preview helpers: placeable projector cameras with frustum pyramids
 * aimed at the physical box faces (TouchDesigner-style projection mapping).
 *
 * Never drawn into projector output windows.
 */

const PROJECTOR_COLORS = [
  0x4ade80,
  0x38bdf8,
  0xf472b6,
  0xfbbf24,
  0xa78bfa,
  0xfb923c,
];

const FACE_TINTS = {
  top: 0xffffff,
  front: 0x93c5fd,
  right: 0xfca5a5,
  back: 0xfde68a,
  left: 0xc4b5fd,
};

const _upperRight = new THREE.Vector3();
const _eyeScratch = new THREE.Vector3();

function disposeObject3D(root) {
  root.traverse((object) => {
    object.geometry?.dispose?.();
    if (Array.isArray(object.material)) {
      for (const material of object.material) material.dispose?.();
    } else {
      object.material?.dispose?.();
    }
  });
}

/** Fourth corner of a face given the three Kooima corners. */
export function faceUpperRight(face, target = _upperRight) {
  return target
    .copy(face.lowerRight)
    .add(face.upperLeft)
    .sub(face.lowerLeft);
}

function createLineLoop(points, color, opacity = 0.95) {
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  const material = new THREE.LineBasicMaterial({
    color,
    transparent: opacity < 1,
    opacity,
    depthWrite: false,
  });
  const line = new THREE.LineLoop(geometry, material);
  line.frustumCulled = false;
  line.raycast = () => {};
  return line;
}

function createLineSegments(pairs, color, opacity = 0.85) {
  const points = [];
  for (const [start, end] of pairs) {
    points.push(start, end);
  }
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  const material = new THREE.LineBasicMaterial({
    color,
    transparent: opacity < 1,
    opacity,
    depthWrite: false,
  });
  const segments = new THREE.LineSegments(geometry, material);
  segments.frustumCulled = false;
  segments.raycast = () => {};
  return segments;
}

function createBoxWireframe(dimensions) {
  const { halfWidth, halfDepth, height } = getBoxExtents(dimensions);
  const floorY = -height;
  const corners = [
    new THREE.Vector3(-halfWidth, 0, -halfDepth),
    new THREE.Vector3(halfWidth, 0, -halfDepth),
    new THREE.Vector3(halfWidth, 0, halfDepth),
    new THREE.Vector3(-halfWidth, 0, halfDepth),
    new THREE.Vector3(-halfWidth, floorY, -halfDepth),
    new THREE.Vector3(halfWidth, floorY, -halfDepth),
    new THREE.Vector3(halfWidth, floorY, halfDepth),
    new THREE.Vector3(-halfWidth, floorY, halfDepth),
  ];
  const edges = [
    [corners[0], corners[1]],
    [corners[1], corners[2]],
    [corners[2], corners[3]],
    [corners[3], corners[0]],
    [corners[4], corners[5]],
    [corners[5], corners[6]],
    [corners[6], corners[7]],
    [corners[7], corners[4]],
    [corners[0], corners[4]],
    [corners[1], corners[5]],
    [corners[2], corners[6]],
    [corners[3], corners[7]],
  ];
  return createLineSegments(edges, 0xd4a017, 0.9);
}

/**
 * Grabable projector body: box + lens cone, tagged for raycasting.
 * Local -Z aims toward the box centre (lookAt applied by the caller).
 */
function createProjectorCameraMesh(color, projectorId, isActive) {
  const group = new THREE.Group();
  group.name = "projector-camera";
  group.userData.kind = "projector-camera";
  group.userData.projectorId = projectorId;

  const markPickable = (mesh) => {
    mesh.userData.kind = "projector-camera";
    mesh.userData.projectorId = projectorId;
    mesh.frustumCulled = false;
    group.add(mesh);
  };

  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.22, 0.14, 0.28),
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: isActive ? 0.95 : 0.7,
      depthWrite: false,
    })
  );
  markPickable(body);

  const lens = new THREE.Mesh(
    new THREE.CylinderGeometry(0.06, 0.09, 0.12, 16),
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: isActive ? 0.9 : 0.65,
      depthWrite: false,
    })
  );
  lens.rotation.x = Math.PI / 2;
  lens.position.z = -0.2;
  markPickable(lens);

  // Invisible pick sphere so thin lenses are still easy to grab.
  const pickVolume = new THREE.Mesh(
    new THREE.SphereGeometry(0.28, 12, 10),
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.001,
      depthWrite: false,
    })
  );
  markPickable(pickVolume);

  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.18, 0.24, 24),
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.45,
      side: THREE.DoubleSide,
      depthWrite: false,
    })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = -0.09;
  ring.raycast = () => {};
  ring.frustumCulled = false;
  group.add(ring);

  return group;
}

function createFaceFrustum(face, eyePosition, color, opacity = 0.75) {
  const group = new THREE.Group();
  group.name = `frustum-${face.id}`;

  const upperRight = faceUpperRight(face, new THREE.Vector3());
  const corners = [
    face.lowerLeft.clone(),
    face.lowerRight.clone(),
    upperRight,
    face.upperLeft.clone(),
  ];

  // Lit "projection wall / screen" panel — same idea as the cyan surface in
  // mapping softs, so you can see what the camera is aimed at.
  const screenGeometry = new THREE.BufferGeometry().setFromPoints([
    corners[0],
    corners[1],
    corners[2],
    corners[0],
    corners[2],
    corners[3],
  ]);
  screenGeometry.computeVertexNormals();
  const screen = new THREE.Mesh(
    screenGeometry,
    new THREE.MeshBasicMaterial({
      color: 0x5ec8ff,
      transparent: true,
      opacity: 0.28,
      side: THREE.DoubleSide,
      depthWrite: false,
    })
  );
  screen.frustumCulled = false;
  screen.raycast = () => {};
  group.add(screen);

  group.add(createLineLoop(corners, 0x7dd3fc, Math.min(1, opacity + 0.15)));
  group.add(
    createLineSegments(
      corners.map((corner) => [eyePosition.clone(), corner]),
      color,
      opacity * 0.85
    )
  );

  return group;
}

/**
 * Lens frustum for a fixed-FOV projector camera (TouchDesigner throw volume).
 * Near plane is a small rectangle at the lens; far plane sits at `throwDistance`.
 */
function createLensFrustum(
  eyePosition,
  lookTarget,
  fovDegrees,
  aspect,
  color,
  opacity = 0.85,
  throwDistance = 8
) {
  const group = new THREE.Group();
  group.name = "lens-frustum";

  const camera = new THREE.PerspectiveCamera(
    fovDegrees,
    aspect,
    0.05,
    Math.max(throwDistance, 1)
  );
  camera.position.copy(eyePosition);
  camera.up.set(0, 1, 0);
  camera.lookAt(lookTarget);
  camera.updateMatrixWorld(true);

  const nearDistance = 0.35;
  const farDistance = Math.max(throwDistance, nearDistance + 0.5);
  const halfNearV =
    Math.tan(THREE.MathUtils.degToRad(fovDegrees) * 0.5) * nearDistance;
  const halfNearH = halfNearV * aspect;
  const halfFarV =
    Math.tan(THREE.MathUtils.degToRad(fovDegrees) * 0.5) * farDistance;
  const halfFarH = halfFarV * aspect;

  const localNear = [
    new THREE.Vector3(-halfNearH, -halfNearV, -nearDistance),
    new THREE.Vector3(halfNearH, -halfNearV, -nearDistance),
    new THREE.Vector3(halfNearH, halfNearV, -nearDistance),
    new THREE.Vector3(-halfNearH, halfNearV, -nearDistance),
  ];
  const localFar = [
    new THREE.Vector3(-halfFarH, -halfFarV, -farDistance),
    new THREE.Vector3(halfFarH, -halfFarV, -farDistance),
    new THREE.Vector3(halfFarH, halfFarV, -farDistance),
    new THREE.Vector3(-halfFarH, halfFarV, -farDistance),
  ];

  const nearCorners = localNear.map((point) =>
    point.clone().applyMatrix4(camera.matrixWorld)
  );
  const farCorners = localFar.map((point) =>
    point.clone().applyMatrix4(camera.matrixWorld)
  );

  group.add(createLineLoop(nearCorners, color, opacity * 0.7));
  group.add(createLineLoop(farCorners, color, opacity));
  group.add(
    createLineSegments(
      nearCorners.map((corner, index) => [corner, farCorners[index]]),
      color,
      opacity * 0.9
    )
  );
  group.add(
    createLineSegments(
      nearCorners.map((corner) => [eyePosition.clone(), corner]),
      color,
      opacity * 0.45
    )
  );

  // Soft far-plane fill so coverage reads like a light beam.
  const farFill = new THREE.BufferGeometry().setFromPoints([
    farCorners[0],
    farCorners[1],
    farCorners[2],
    farCorners[0],
    farCorners[2],
    farCorners[3],
  ]);
  const farMesh = new THREE.Mesh(
    farFill,
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.12,
      side: THREE.DoubleSide,
      depthWrite: false,
    })
  );
  farMesh.frustumCulled = false;
  farMesh.raycast = () => {};
  group.add(farMesh);

  return group;
}

function tintProjectorColor(baseColor, faceId) {
  const base = new THREE.Color(baseColor);
  const tint = new THREE.Color(FACE_TINTS[faceId] ?? 0xffffff);
  return base.clone().lerp(tint, 0.35).getHex();
}

/**
 * Build (or rebuild) the debug group for the current venue state.
 */
export function createVenueFrustumHelpers(venueState) {
  const root = new THREE.Group();
  root.name = "venue-frustum-helpers";
  root.renderOrder = 10;

  if (!venueState?.showFrustumHelpers) {
    root.visible = false;
    return root;
  }

  const boxFaces = buildBoxFaces(venueState.box);
  root.add(createBoxWireframe(venueState.box));

  const projectors = venueState.projectors || [];
  for (let index = 0; index < projectors.length; index += 1) {
    const projector = projectors[index];
    if (!projector?.enabled) continue;

    const baseColor = PROJECTOR_COLORS[index % PROJECTOR_COLORS.length];
    const isActive = projector.id === venueState.activeProjectorId;
    const eyePosition = computeEyePosition(
      projector.viewer,
      venueState.box,
      _eyeScratch.clone()
    );

    const projectorGroup = new THREE.Group();
    projectorGroup.name = projector.id;
    projectorGroup.userData.kind = "projector";
    projectorGroup.userData.projectorId = projector.id;

    const lookTarget = new THREE.Vector3(0, 0.25, 0);
    const fovDegrees = projector.fovDegrees ?? 40;
    const aspect = projector.aspect ?? 16 / 9;
    const throwDistance = Math.max(
      eyePosition.distanceTo(lookTarget) * 1.35,
      4
    );

    const cameraMesh = createProjectorCameraMesh(
      baseColor,
      projector.id,
      isActive
    );
    cameraMesh.position.copy(eyePosition);
    cameraMesh.lookAt(lookTarget);
    cameraMesh.scale.setScalar(isActive ? 1.2 : 1);
    projectorGroup.add(cameraMesh);

    const floorPoint = eyePosition.clone();
    floorPoint.y = -getBoxExtents(venueState.box).height;
    projectorGroup.add(
      createLineSegments([[eyePosition.clone(), floorPoint]], baseColor, 0.35)
    );

    // Always draw the lens FOV throw (TD projector component).
    projectorGroup.add(
      createLensFrustum(
        eyePosition,
        lookTarget,
        fovDegrees,
        aspect,
        baseColor,
        isActive ? 0.95 : 0.55,
        throwDistance
      )
    );

    // Face hit panels: where the beam meets the physical box.
    for (const faceId of projector.faceIds || []) {
      const face = boxFaces[faceId];
      if (!face) continue;
      if (!faceVisible(face, eyePosition)) continue;
      const frustumColor = tintProjectorColor(baseColor, faceId);
      const frustum = createFaceFrustum(
        face,
        eyePosition,
        frustumColor,
        isActive ? 0.7 : 0.35
      );
      projectorGroup.add(frustum);
    }

    if (!isActive) {
      projectorGroup.traverse((object) => {
        if (object.material?.opacity != null && object.material.opacity > 0.01) {
          object.material.opacity *= 0.55;
        }
      });
    }

    root.add(projectorGroup);
  }

  root.visible = true;
  return root;
}

export function disposeVenueFrustumHelpers(root) {
  if (!root) return;
  disposeObject3D(root);
}
