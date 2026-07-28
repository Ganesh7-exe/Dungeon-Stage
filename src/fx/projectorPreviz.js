import * as THREE from "three";

/**
 * TouchDesigner-style "projection landing on the set": the active projector's
 * render is projectively textured onto the physical box faces in the 3D previz.
 * Never drawn into the real projector output window.
 */

const BIAS = new THREE.Matrix4().set(
  0.5,
  0,
  0,
  0.5,
  0,
  0.5,
  0,
  0.5,
  0,
  0,
  0.5,
  0.5,
  0,
  0,
  0,
  1
);

const _projectorMatrix = new THREE.Matrix4();
const _upperRight = new THREE.Vector3();
const _faceRight = new THREE.Vector3();
const _faceUp = new THREE.Vector3();
const _faceNormal = new THREE.Vector3();

function faceUpperRight(face, target = _upperRight) {
  return target
    .copy(face.lowerRight)
    .add(face.upperLeft)
    .sub(face.lowerLeft);
}

function faceOutwardNormal(face, target = _faceNormal) {
  _faceRight.subVectors(face.lowerRight, face.lowerLeft).normalize();
  _faceUp.subVectors(face.upperLeft, face.lowerLeft).normalize();
  return target.crossVectors(_faceRight, _faceUp).normalize();
}

function createFaceGeometry(face) {
  const upperRight = faceUpperRight(face, new THREE.Vector3());
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array([
    face.lowerLeft.x,
    face.lowerLeft.y,
    face.lowerLeft.z,
    face.lowerRight.x,
    face.lowerRight.y,
    face.lowerRight.z,
    upperRight.x,
    upperRight.y,
    upperRight.z,
    face.lowerLeft.x,
    face.lowerLeft.y,
    face.lowerLeft.z,
    upperRight.x,
    upperRight.y,
    upperRight.z,
    face.upperLeft.x,
    face.upperLeft.y,
    face.upperLeft.z,
  ]);
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}

function createProjectedFaceMaterial(texture) {
  return new THREE.ShaderMaterial({
    uniforms: {
      projectorMap: { value: texture },
      projectorMatrix: { value: new THREE.Matrix4() },
      tint: { value: new THREE.Color(0xb8e0ff) },
      opacity: { value: 0.72 },
    },
    vertexShader: /* glsl */ `
      uniform mat4 projectorMatrix;
      varying vec4 vProjectorCoord;
      void main() {
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vProjectorCoord = projectorMatrix * worldPosition;
        gl_Position = projectionMatrix * viewMatrix * worldPosition;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D projectorMap;
      uniform vec3 tint;
      uniform float opacity;
      varying vec4 vProjectorCoord;
      void main() {
        if (vProjectorCoord.w <= 0.0001) discard;
        vec2 uv = vProjectorCoord.xy / vProjectorCoord.w;
        uv = uv * 0.5 + 0.5;
        if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) discard;
        vec4 projected = texture2D(projectorMap, uv);
        gl_FragColor = vec4(projected.rgb * tint, projected.a * opacity);
      }
    `,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
}

/**
 * Build empty overlay group; rebuild meshes when box faces change.
 */
export function createProjectorPrevizOverlay() {
  const root = new THREE.Group();
  root.name = "projector-previz-overlay";
  root.renderOrder = 8;
  root.visible = false;
  root.userData.meshes = [];
  return root;
}

export function rebuildProjectorPrevizFaces(root, boxFaces, faceIds, texture) {
  if (!root) return;
  for (const mesh of root.userData.meshes || []) {
    root.remove(mesh);
    mesh.geometry?.dispose?.();
    mesh.material?.dispose?.();
  }
  root.userData.meshes = [];

  for (const faceId of faceIds || []) {
    const face = boxFaces?.[faceId];
    if (!face) continue;
    const material = createProjectedFaceMaterial(texture);
    const mesh = new THREE.Mesh(createFaceGeometry(face), material);
    mesh.name = `previz-${faceId}`;
    mesh.frustumCulled = false;
    mesh.raycast = () => {};
    faceOutwardNormal(face, _faceNormal);
    mesh.position.copy(_faceNormal).multiplyScalar(0.004);
    root.add(mesh);
    root.userData.meshes.push(mesh);
  }
}

/**
 * Sync projective matrix from the same camera that rendered `texture`.
 */
export function updateProjectorPrevizOverlay(root, projectorCamera, texture) {
  if (!root?.userData?.meshes?.length || !projectorCamera) {
    if (root) root.visible = false;
    return;
  }

  _projectorMatrix
    .copy(BIAS)
    .multiply(projectorCamera.projectionMatrix)
    .multiply(projectorCamera.matrixWorldInverse);

  for (const mesh of root.userData.meshes) {
    const material = mesh.material;
    if (!material?.uniforms) continue;
    material.uniforms.projectorMap.value = texture;
    material.uniforms.projectorMatrix.value.copy(_projectorMatrix);
  }
  root.visible = true;
}

export function disposeProjectorPrevizOverlay(root) {
  if (!root) return;
  for (const mesh of root.userData.meshes || []) {
    mesh.geometry?.dispose?.();
    mesh.material?.dispose?.();
  }
  root.userData.meshes = [];
}
