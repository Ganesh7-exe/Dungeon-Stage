import * as THREE from "three";

function mat(color, options = {}) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: options.roughness ?? 0.55,
    metalness: options.metalness ?? 0.05,
    emissive: options.emissive ?? 0x000000,
    emissiveIntensity: options.emissiveIntensity ?? 0,
  });
}

function addBox(parent, width, height, depth, color, x, y, z, materialOptions) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(width, height, depth),
    mat(color, materialOptions)
  );
  mesh.position.set(x, y, z);
  parent.add(mesh);
  return mesh;
}

function addSphere(parent, radius, color, x, y, z, materialOptions, widthSeg = 16, heightSeg = 12) {
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(radius, widthSeg, heightSeg),
    mat(color, materialOptions)
  );
  mesh.position.set(x, y, z);
  parent.add(mesh);
  return mesh;
}

/** Minimal stand-in if Giant_Spider.glb fails to load. */
function makeSpider() {
  const root = new THREE.Group();
  addSphere(root, 0.35, 0x222222, 0, 0.55, 0);
  addSphere(root, 0.22, 0x333333, 0.4, 0.5, 0);
  const legOffsets = [-0.35, -0.12, 0.12, 0.35];
  for (const z of legOffsets) {
    addBox(root, 0.55, 0.06, 0.06, 0x111111, -0.15, 0.35, z);
    addBox(root, 0.55, 0.06, 0.06, 0x111111, 0.15, 0.35, z);
  }
  addSphere(root, 0.05, 0xff2222, 0.55, 0.58, -0.08, {
    emissive: 0xff0000,
    emissiveIntensity: 0.6,
  });
  addSphere(root, 0.05, 0xff2222, 0.55, 0.58, 0.08, {
    emissive: 0xff0000,
    emissiveIntensity: 0.6,
  });
  return root;
}

const builders = {
  spider: makeSpider,
};

export function createProceduralCharacter(characterId) {
  const builder = builders[characterId];
  if (!builder) return null;
  const root = builder();
  root.name = `procedural-${characterId}`;
  return root;
}

export function hasProceduralCharacter(characterId) {
  return Boolean(builders[characterId]);
}
