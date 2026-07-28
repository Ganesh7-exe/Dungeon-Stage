import * as THREE from "three";

/**
 * Off-axis ("anamorphic") projection, after Kooima's generalised perspective
 * projection. A physical face is described by three of its world-space corners;
 * the frustum is then skewed so that the face acts as a window onto the scene
 * from one specific eye position.
 *
 * This is the technique behind corner LED billboards, CAVE rooms and
 * head-tracked desktop VR. The illusion is exact only at `eyePosition` and
 * degrades as the real viewer moves away from it — roughly 25 degrees of
 * azimuth is still convincing.
 */

const screenRight = new THREE.Vector3();
const screenUp = new THREE.Vector3();
const screenNormal = new THREE.Vector3();
const eyeToLowerLeft = new THREE.Vector3();
const eyeToLowerRight = new THREE.Vector3();
const eyeToUpperLeft = new THREE.Vector3();
const orientationBasis = new THREE.Matrix4();

/**
 * Orthonormal basis of a projection face plus the eye-to-corner vectors.
 * `distanceToFace` is positive when the eye sits in front of the face.
 */
export function describeFaceFromEye(face, eyePosition) {
  screenRight.subVectors(face.lowerRight, face.lowerLeft).normalize();
  screenUp.subVectors(face.upperLeft, face.lowerLeft).normalize();
  screenNormal.crossVectors(screenRight, screenUp).normalize();

  eyeToLowerLeft.subVectors(face.lowerLeft, eyePosition);
  eyeToLowerRight.subVectors(face.lowerRight, eyePosition);
  eyeToUpperLeft.subVectors(face.upperLeft, eyePosition);

  return {
    screenRight,
    screenUp,
    screenNormal,
    eyeToLowerLeft,
    eyeToLowerRight,
    eyeToUpperLeft,
    distanceToFace: -eyeToLowerLeft.dot(screenNormal),
  };
}

/**
 * True when the eye can actually see the face. A face turned away from the
 * viewer produces a degenerate frustum, so callers should skip it.
 */
export function isFaceVisibleFromEye(face, eyePosition, minimumDistance = 0.01) {
  return describeFaceFromEye(face, eyePosition).distanceToFace > minimumDistance;
}

/**
 * Point the camera at a physical face and skew its frustum to match.
 *
 * The camera is placed at the eye position and oriented into the face's own
 * basis, which keeps `unproject`, raycasting and `Vector3.project` working.
 * `projectionMatrix` is then replaced wholesale, so this must be re-applied
 * after anything that calls `updateProjectionMatrix()`.
 */
export function configureOffAxisCamera(camera, face, eyePosition, options = {}) {
  const near = options.near ?? 0.05;
  const far = options.far ?? 200;
  const basis = describeFaceFromEye(face, eyePosition);

  if (!(basis.distanceToFace > 1e-5)) return false;

  const nearOverDistance = near / basis.distanceToFace;
  const frustumLeft = basis.screenRight.dot(basis.eyeToLowerLeft) * nearOverDistance;
  const frustumRight = basis.screenRight.dot(basis.eyeToLowerRight) * nearOverDistance;
  const frustumBottom = basis.screenUp.dot(basis.eyeToLowerLeft) * nearOverDistance;
  const frustumTop = basis.screenUp.dot(basis.eyeToUpperLeft) * nearOverDistance;

  if (frustumRight - frustumLeft < 1e-9 || frustumTop - frustumBottom < 1e-9) {
    return false;
  }

  orientationBasis.makeBasis(basis.screenRight, basis.screenUp, basis.screenNormal);

  camera.position.copy(eyePosition);
  camera.quaternion.setFromRotationMatrix(orientationBasis);
  camera.near = near;
  camera.far = far;
  camera.updateMatrixWorld(true);

  camera.projectionMatrix.makePerspective(
    frustumLeft,
    frustumRight,
    frustumTop,
    frustumBottom,
    near,
    far,
    camera.coordinateSystem
  );
  camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
  return true;
}

/**
 * Camera that never has its frustum recomputed from an aspect ratio, so a
 * window resize cannot silently discard the off-axis skew.
 */
export function createOffAxisCamera() {
  const camera = new THREE.PerspectiveCamera(50, 1, 0.05, 200);
  camera.updateProjectionMatrix = () => {};
  return camera;
}

const _fitRight = new THREE.Vector3();
const _fitUp = new THREE.Vector3();
const _fitNormal = new THREE.Vector3();
const _fitCorner = new THREE.Vector3();
const _fitToEye = new THREE.Vector3();
const _fitLookTarget = new THREE.Vector3();
const _fitForward = new THREE.Vector3();
const _fitEye = new THREE.Vector3();

function faceUpperRightCorner(face, target) {
  return target
    .copy(face.lowerRight)
    .add(face.upperLeft)
    .sub(face.lowerLeft);
}

function faceCenter(face, target) {
  faceUpperRightCorner(face, _fitCorner);
  return target
    .copy(face.lowerLeft)
    .add(face.lowerRight)
    .add(face.upperLeft)
    .add(_fitCorner)
    .multiplyScalar(0.25);
}

/**
 * Straight-on view of a face (along its outward normal). The face always fills
 * the frame — used for real-life surface / border mapping so keystone stays a
 * clean filled rectangle no matter where the physical lamp sits in 3D.
 */
export function configureFaceAlignedCamera(camera, face, options = {}) {
  const near = options.near ?? 0.08;
  const far = options.far ?? 250;
  const padding = options.padding ?? 1.08;
  const contentHeight = options.contentHeight ?? 1.2;
  const aspect = options.aspect ?? camera.aspect ?? 1;

  _fitRight.subVectors(face.lowerRight, face.lowerLeft);
  const faceWidth = _fitRight.length();
  _fitRight.multiplyScalar(1 / Math.max(faceWidth, 1e-6));
  _fitUp.subVectors(face.upperLeft, face.lowerLeft);
  const faceHeight = _fitUp.length();
  _fitUp.multiplyScalar(1 / Math.max(faceHeight, 1e-6));
  _fitNormal.crossVectors(_fitRight, _fitUp).normalize();

  faceCenter(face, _fitLookTarget);
  // Look slightly above the plane so standing characters stay in frame.
  _fitLookTarget.addScaledVector(_fitNormal, contentHeight * 0.15);

  const distance = Math.max(faceWidth, faceHeight, 0.5) * 1.55;
  _fitEye.copy(_fitLookTarget).addScaledVector(_fitNormal, distance);

  camera.position.copy(_fitEye);
  camera.up.copy(_fitUp);
  camera.lookAt(_fitLookTarget);
  camera.near = near;
  camera.far = far;

  const upperRight = faceUpperRightCorner(face, new THREE.Vector3());
  // Default: fit the face plane only so the map fills the frame for keystone.
  // Pass contentHeight > 0 only when you also need standing props in-frame.
  const fitPoints = [
    face.lowerLeft,
    face.lowerRight,
    face.upperLeft,
    upperRight,
  ];
  if (contentHeight > 1e-4) {
    fitPoints.push(
      face.lowerLeft.clone().addScaledVector(_fitNormal, contentHeight),
      face.lowerRight.clone().addScaledVector(_fitNormal, contentHeight),
      face.upperLeft.clone().addScaledVector(_fitNormal, contentHeight),
      upperRight.clone().addScaledVector(_fitNormal, contentHeight)
    );
  }

  let maxAngle = 0;
  camera.getWorldDirection(_fitForward);
  for (const point of fitPoints) {
    _fitToEye.subVectors(point, _fitEye).normalize();
    const angle = _fitForward.angleTo(_fitToEye);
    if (angle > maxAngle) maxAngle = angle;
  }

  camera.fov = THREE.MathUtils.clamp(
    THREE.MathUtils.radToDeg(maxAngle * 2 * padding),
    20,
    100
  );
  camera.aspect = aspect;
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
  return true;
}

/**
 * Map + keystone fill: pin the physical face exactly to the output edges
 * (Kooima off-axis from a fixed eye on the face normal). Lamp pose is ignored
 * so dragging the projector in 3D never slides the picture — only TL/TR/BR/BL
 * warp this full-bleed map onto the real throw.
 */
export function configureFaceMappedCamera(camera, face, options = {}) {
  _fitRight.subVectors(face.lowerRight, face.lowerLeft);
  const faceWidth = _fitRight.length();
  _fitUp.subVectors(face.upperLeft, face.lowerLeft);
  const faceHeight = _fitUp.length();
  _fitRight.multiplyScalar(1 / Math.max(faceWidth, 1e-6));
  _fitUp.multiplyScalar(1 / Math.max(faceHeight, 1e-6));
  _fitNormal.crossVectors(_fitRight, _fitUp).normalize();

  faceCenter(face, _fitLookTarget);
  const distance =
    options.distance ?? Math.max(faceWidth, faceHeight, 0.5) * 2.2;
  _fitEye.copy(_fitLookTarget).addScaledVector(_fitNormal, distance);

  return configureOffAxisCamera(camera, face, _fitEye, options);
}

/**
 * Orthographic top-down (or face-on) fill — stretches the physical face to the
 * entire render target. More reliable than perspective fit for map+keystone:
 * every pixel of the RT is map, with no letterboxing black bars.
 *
 * `camera` must be a THREE.OrthographicCamera.
 */
export function configureFaceOrthoCamera(camera, face, options = {}) {
  const near = options.near ?? 0.08;
  const far = options.far ?? 250;
  const padding = options.padding ?? 1.001;

  _fitRight.subVectors(face.lowerRight, face.lowerLeft);
  const faceWidth = _fitRight.length();
  _fitRight.multiplyScalar(1 / Math.max(faceWidth, 1e-6));
  _fitUp.subVectors(face.upperLeft, face.lowerLeft);
  const faceHeight = _fitUp.length();
  _fitUp.multiplyScalar(1 / Math.max(faceHeight, 1e-6));
  _fitNormal.crossVectors(_fitRight, _fitUp).normalize();

  faceCenter(face, _fitLookTarget);
  const distance = Math.max(faceWidth, faceHeight, 0.5) * 1.55;
  _fitEye.copy(_fitLookTarget).addScaledVector(_fitNormal, distance);

  camera.position.copy(_fitEye);
  camera.up.copy(_fitUp);
  camera.lookAt(_fitLookTarget);
  camera.near = near;
  camera.far = far;

  const halfWidth = (faceWidth * 0.5) * padding;
  const halfHeight = (faceHeight * 0.5) * padding;
  camera.left = -halfWidth;
  camera.right = halfWidth;
  camera.top = halfHeight;
  camera.bottom = -halfHeight;
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
  return true;
}

/**
 * Dead-simple overhead map camera for map+keystone. Looks straight down -Y at
 * the box top. No off-axis, no lamp pose — Resolume-style keystone source.
 *
 * When `options.aspect` (RT width/height) is set, uses cover-fit: frustum
 * matches the output aspect and crops the longer map axis so the throw has
 * no letterbox/pillarbox bars. Without aspect, stretches the play surface.
 *
 * `camera` must be a THREE.OrthographicCamera.
 * `extents` is `{ halfWidth, halfDepth }` from getBoxExtents().
 */
export function configureTopDownMapCamera(camera, extents, options = {}) {
  const halfWidth = Math.max(0.01, Number(extents?.halfWidth) || 1.2);
  const halfDepth = Math.max(0.01, Number(extents?.halfDepth) || 1.2);
  const padding = options.padding ?? 1.0;
  const height = options.height ?? Math.max(halfWidth, halfDepth) * 3;
  const outputAspect = Number(options.aspect);

  let viewHalfWidth = halfWidth * padding;
  let viewHalfDepth = halfDepth * padding;
  if (Number.isFinite(outputAspect) && outputAspect > 0.05) {
    const boxAspect = viewHalfWidth / Math.max(1e-6, viewHalfDepth);
    if (boxAspect > outputAspect) {
      // Box wider than output — crop left/right.
      viewHalfWidth = viewHalfDepth * outputAspect;
    } else {
      // Box taller than output — crop top/bottom.
      viewHalfDepth = viewHalfWidth / outputAspect;
    }
  }

  camera.position.set(0, height, 0);
  camera.up.set(0, 0, -1);
  camera.lookAt(0, 0, 0);
  camera.near = 0.05;
  camera.far = height + 100;
  camera.left = -viewHalfWidth;
  camera.right = viewHalfWidth;
  // up = -Z → image top is world -Z (the "upper" edge of the top face).
  camera.top = viewHalfDepth;
  camera.bottom = -viewHalfDepth;
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
  return true;
}

/**
 * Overhead ortho framed on an arbitrary square region (used for the 3D stage
 * booth so its RT fills with the character stage, not the whole map).
 */
export function configureTopDownRegionCamera(camera, region, options = {}) {
  const centerX = Number(region?.centerX) || 0;
  const centerZ = Number(region?.centerZ) || 0;
  const halfSize = Math.max(0.05, Number(region?.halfSize) || 0.5);
  const padding = options.padding ?? 1.08;
  const height = options.height ?? halfSize * 4;
  const outputAspect = Number(options.aspect);

  let viewHalfWidth = halfSize * padding;
  let viewHalfDepth = halfSize * padding;
  if (Number.isFinite(outputAspect) && outputAspect > 0.05) {
    const boxAspect = viewHalfWidth / Math.max(1e-6, viewHalfDepth);
    if (boxAspect > outputAspect) {
      viewHalfWidth = viewHalfDepth * outputAspect;
    } else {
      viewHalfDepth = viewHalfWidth / outputAspect;
    }
  }

  camera.position.set(centerX, height, centerZ);
  camera.up.set(0, 0, -1);
  camera.lookAt(centerX, 0, centerZ);
  camera.near = 0.05;
  camera.far = height + 100;
  camera.left = -viewHalfWidth;
  camera.right = viewHalfWidth;
  camera.top = viewHalfDepth;
  camera.bottom = -viewHalfDepth;
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
  return true;
}

/**
 * Overhead ortho that covers the battle map plus the 3D stage booth beyond
 * the far map edge — so auto TL2 UVs land on the booth instead of clamping
 * to a degenerate strip at the frame edge.
 */
export function configureTopDownMapAndStageCamera(
  camera,
  extents,
  stagePose,
  options = {}
) {
  const halfWidth = Math.max(0.01, Number(extents?.halfWidth) || 1.2);
  const halfDepth = Math.max(0.01, Number(extents?.halfDepth) || 1.2);
  const padding = options.padding ?? 1.04;
  const outputAspect = Number(options.aspect);

  let zNear = -halfDepth;
  let zFar = halfDepth;
  let xMin = -halfWidth;
  let xMax = halfWidth;
  if (stagePose && stagePose.enabled !== false && Number.isFinite(stagePose.centerZ)) {
    const stageHalf = Math.max(0.05, Number(stagePose.halfSize) || 0.5);
    zNear = Math.min(zNear, stagePose.centerZ - stageHalf);
    zFar = Math.max(zFar, stagePose.centerZ + stageHalf);
    xMin = Math.min(xMin, (Number(stagePose.centerX) || 0) - stageHalf);
    xMax = Math.max(xMax, (Number(stagePose.centerX) || 0) + stageHalf);
  }

  const centerX = (xMin + xMax) * 0.5;
  const centerZ = (zNear + zFar) * 0.5;
  let viewHalfWidth = ((xMax - xMin) * 0.5) * padding;
  let viewHalfDepth = ((zFar - zNear) * 0.5) * padding;
  const height =
    options.height ?? Math.max(viewHalfWidth, viewHalfDepth) * 3;

  if (Number.isFinite(outputAspect) && outputAspect > 0.05) {
    const boxAspect = viewHalfWidth / Math.max(1e-6, viewHalfDepth);
    if (boxAspect > outputAspect) {
      viewHalfWidth = viewHalfDepth * outputAspect;
    } else {
      viewHalfDepth = viewHalfWidth / outputAspect;
    }
  }

  camera.position.set(centerX, height, centerZ);
  camera.up.set(0, 0, -1);
  camera.lookAt(centerX, 0, centerZ);
  camera.near = 0.05;
  camera.far = height + 100;
  camera.left = -viewHalfWidth;
  camera.right = viewHalfWidth;
  camera.top = viewHalfDepth;
  camera.bottom = -viewHalfDepth;
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
  return true;
}

/**
 * TouchDesigner-style projector camera: fixed lens FOV from the lamp pose,
 * looking at a world target (usually the box centre). Dragging the projector
 * moves the picture — unlike face-aligned mapping, which ignores the eye.
 */
export function configureProjectorCamera(
  camera,
  eyePosition,
  lookTarget,
  options = {}
) {
  const near = options.near ?? 0.08;
  const far = options.far ?? 250;
  const fov = THREE.MathUtils.clamp(options.fov ?? 40, 10, 120);
  const aspect = options.aspect ?? camera.aspect ?? 16 / 9;

  camera.position.copy(eyePosition);
  camera.up.set(0, 1, 0);
  camera.lookAt(lookTarget);
  camera.near = near;
  camera.far = far;
  camera.fov = fov;
  camera.aspect = aspect;
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
  return true;
}

/**
 * Free perspective from an arbitrary eye — kept for tooling / tests.
 * Prefer configureProjectorCamera, configureFaceAlignedCamera, or
 * configureOffAxisCamera for output.
 */
export function configurePerspectiveCameraForFace(
  camera,
  face,
  eyePosition,
  options = {}
) {
  const near = options.near ?? 0.08;
  const far = options.far ?? 250;
  const padding = options.padding ?? 1.2;
  const contentHeight = options.contentHeight ?? 1.25;

  _fitRight.subVectors(face.lowerRight, face.lowerLeft).normalize();
  _fitUp.subVectors(face.upperLeft, face.lowerLeft).normalize();
  _fitNormal.crossVectors(_fitRight, _fitUp).normalize();

  faceCenter(face, _fitLookTarget);
  _fitLookTarget.addScaledVector(_fitNormal, contentHeight * 0.25);

  _fitToEye.subVectors(eyePosition, _fitLookTarget);
  if (_fitToEye.lengthSq() < 1e-6) {
    _fitLookTarget.addScaledVector(_fitNormal, -1);
  }

  camera.position.copy(eyePosition);
  camera.up.copy(_fitUp);
  camera.lookAt(_fitLookTarget);
  camera.near = near;
  camera.far = far;

  const upperRight = faceUpperRightCorner(face, new THREE.Vector3());
  const fitPoints = [
    face.lowerLeft,
    face.lowerRight,
    face.upperLeft,
    upperRight,
    face.lowerLeft.clone().addScaledVector(_fitNormal, contentHeight),
    face.lowerRight.clone().addScaledVector(_fitNormal, contentHeight),
    face.upperLeft.clone().addScaledVector(_fitNormal, contentHeight),
    upperRight.clone().addScaledVector(_fitNormal, contentHeight),
  ];

  let maxAngle = 0;
  camera.getWorldDirection(_fitForward);
  for (const point of fitPoints) {
    _fitToEye.subVectors(point, eyePosition).normalize();
    const angle = _fitForward.angleTo(_fitToEye);
    if (angle > maxAngle) maxAngle = angle;
  }

  camera.fov = THREE.MathUtils.clamp(
    THREE.MathUtils.radToDeg(maxAngle * 2 * padding),
    18,
    130
  );
  camera.aspect = options.aspect ?? camera.aspect ?? 1;
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
  return true;
}
