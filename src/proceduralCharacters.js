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

function addCone(parent, radius, height, color, x, y, z, materialOptions) {
  const mesh = new THREE.Mesh(
    new THREE.ConeGeometry(radius, height, 10),
    mat(color, materialOptions)
  );
  mesh.position.set(x, y, z);
  parent.add(mesh);
  return mesh;
}

function addCylinder(parent, radiusTop, radiusBottom, height, color, x, y, z, materialOptions) {
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(radiusTop, radiusBottom, height, 12),
    mat(color, materialOptions)
  );
  mesh.position.set(x, y, z);
  parent.add(mesh);
  return mesh;
}

function humanoid(colors) {
  const root = new THREE.Group();
  addBox(root, 0.55, 0.75, 0.35, colors.body, 0, 1.05, 0);
  addSphere(root, 0.22, colors.head, 0, 1.7, 0);
  addBox(root, 0.18, 0.7, 0.18, colors.limb, -0.18, 0.35, 0);
  addBox(root, 0.18, 0.7, 0.18, colors.limb, 0.18, 0.35, 0);
  addBox(root, 0.16, 0.55, 0.16, colors.limb, -0.4, 1.05, 0);
  addBox(root, 0.16, 0.55, 0.16, colors.limb, 0.4, 1.05, 0);
  return root;
}

function makeDragon() {
  const root = new THREE.Group();
  addBox(root, 1.2, 0.55, 0.55, 0x8b1a1a, 0, 0.9, 0);
  addSphere(root, 0.28, 0xa32020, 0.7, 1.15, 0);
  addCone(root, 0.12, 0.35, 0xffaa33, 0.95, 1.05, 0, {
    emissive: 0xff6600,
    emissiveIntensity: 0.45,
  });
  addBox(root, 0.15, 0.9, 0.55, 0x6b1212, -0.1, 1.2, -0.55);
  addBox(root, 0.15, 0.9, 0.55, 0x6b1212, -0.1, 1.2, 0.55);
  addCone(root, 0.08, 0.25, 0xffcc66, 0.85, 1.35, -0.12);
  addCone(root, 0.08, 0.25, 0xffcc66, 0.85, 1.35, 0.12);
  addBox(root, 0.9, 0.18, 0.18, 0x5a0f0f, -0.85, 0.75, 0);
  addBox(root, 0.22, 0.45, 0.22, 0x5a0f0f, 0.25, 0.28, -0.2);
  addBox(root, 0.22, 0.45, 0.22, 0x5a0f0f, 0.25, 0.28, 0.2);
  addBox(root, 0.22, 0.45, 0.22, 0x5a0f0f, -0.35, 0.28, -0.2);
  addBox(root, 0.22, 0.45, 0.22, 0x5a0f0f, -0.35, 0.28, 0.2);
  return root;
}

function makeOgre() {
  const root = humanoid({
    body: 0x4f7a3e,
    head: 0x6a9a52,
    limb: 0x3f6232,
  });
  addCone(root, 0.06, 0.2, 0xf2f2f2, -0.12, 1.9, 0.12);
  addCone(root, 0.06, 0.2, 0xf2f2f2, 0.12, 1.9, 0.12);
  addBox(root, 0.12, 0.55, 0.12, 0x8b5a2b, 0.55, 1.2, 0.1);
  return root;
}

function makeSkeleton() {
  const root = humanoid({
    body: 0xe8e0d0,
    head: 0xf0ebe3,
    limb: 0xd9d0c0,
  });
  addBox(root, 0.08, 0.45, 0.08, 0xcfc6b8, 0, 1.05, 0.2);
  return root;
}

function makeGoblin() {
  const root = new THREE.Group();
  addBox(root, 0.4, 0.45, 0.28, 0x3d8b3d, 0, 0.75, 0);
  addSphere(root, 0.2, 0x4caf50, 0, 1.15, 0);
  addCone(root, 0.05, 0.18, 0x2e7d32, -0.16, 1.32, 0);
  addCone(root, 0.05, 0.18, 0x2e7d32, 0.16, 1.32, 0);
  addBox(root, 0.12, 0.4, 0.12, 0x2e6b2e, -0.12, 0.3, 0);
  addBox(root, 0.12, 0.4, 0.12, 0x2e6b2e, 0.12, 0.3, 0);
  addBox(root, 0.1, 0.35, 0.1, 0x2e6b2e, -0.28, 0.75, 0);
  addBox(root, 0.1, 0.35, 0.1, 0x2e6b2e, 0.28, 0.75, 0);
  return root;
}

function makeLich() {
  const root = humanoid({
    body: 0x2a1f3d,
    head: 0xb8c4c8,
    limb: 0x3a2d52,
  });
  addCone(root, 0.28, 0.55, 0x5b2c91, 0, 2.05, 0, {
    emissive: 0x6a00ff,
    emissiveIntensity: 0.25,
  });
  addSphere(root, 0.08, 0x66ffcc, 0.35, 1.2, 0.15, {
    emissive: 0x33ffaa,
    emissiveIntensity: 0.8,
  });
  return root;
}

function makeWolf() {
  const root = new THREE.Group();
  addBox(root, 0.9, 0.4, 0.4, 0x6b6b6b, 0, 0.55, 0);
  addBox(root, 0.35, 0.32, 0.32, 0x7a7a7a, 0.55, 0.7, 0);
  addCone(root, 0.08, 0.18, 0x555555, 0.55, 0.95, -0.1);
  addCone(root, 0.08, 0.18, 0x555555, 0.55, 0.95, 0.1);
  addBox(root, 0.45, 0.14, 0.14, 0x555555, -0.6, 0.55, 0);
  addBox(root, 0.12, 0.4, 0.12, 0x555555, 0.25, 0.2, -0.12);
  addBox(root, 0.12, 0.4, 0.12, 0x555555, 0.25, 0.2, 0.12);
  addBox(root, 0.12, 0.4, 0.12, 0x555555, -0.25, 0.2, -0.12);
  addBox(root, 0.12, 0.4, 0.12, 0x555555, -0.25, 0.2, 0.12);
  return root;
}

function makeKnight() {
  const root = humanoid({
    body: 0x708090,
    head: 0xc0c0c0,
    limb: 0x5a6670,
  });
  addBox(root, 0.5, 0.12, 0.5, 0x8b0000, 0, 1.45, 0);
  addBox(root, 0.08, 0.7, 0.08, 0xaaaaaa, 0.55, 1.15, 0);
  addBox(root, 0.25, 0.35, 0.05, 0x4169e1, -0.5, 1.05, 0.1);
  return root;
}

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

function makeElemental() {
  const root = new THREE.Group();
  addSphere(root, 0.45, 0xff4500, 0, 0.9, 0, {
    emissive: 0xff2200,
    emissiveIntensity: 0.55,
  });
  addCone(root, 0.25, 0.55, 0xffaa00, 0, 1.55, 0, {
    emissive: 0xff8800,
    emissiveIntensity: 0.7,
  });
  addCone(root, 0.18, 0.4, 0xff6600, -0.25, 0.45, 0.1, {
    emissive: 0xff4400,
    emissiveIntensity: 0.5,
  });
  addCone(root, 0.18, 0.4, 0xff6600, 0.25, 0.45, -0.1, {
    emissive: 0xff4400,
    emissiveIntensity: 0.5,
  });
  return root;
}

function makeBeholder() {
  const root = new THREE.Group();
  addSphere(root, 0.55, 0x6b4f9a, 0, 1.0, 0);
  addSphere(root, 0.18, 0xf5f5f5, 0.35, 1.1, 0.25);
  addSphere(root, 0.08, 0x111111, 0.48, 1.12, 0.32);
  const stalks = [
    [-0.35, 1.45, -0.2],
    [0.1, 1.55, -0.25],
    [0.35, 1.4, 0.15],
    [-0.15, 1.5, 0.25],
  ];
  for (const [x, y, z] of stalks) {
    addCylinder(root, 0.04, 0.04, 0.35, 0x553388, x, y, z);
    addSphere(root, 0.08, 0xffeeaa, x, y + 0.22, z, {
      emissive: 0xffcc66,
      emissiveIntensity: 0.35,
    });
  }
  return root;
}

function makeBat() {
  const root = new THREE.Group();
  addSphere(root, 0.22, 0x3a3a3a, 0, 1.1, 0);
  addBox(root, 0.7, 0.08, 0.35, 0x2a2a2a, -0.45, 1.15, 0);
  addBox(root, 0.7, 0.08, 0.35, 0x2a2a2a, 0.45, 1.15, 0);
  addCone(root, 0.05, 0.15, 0x222222, -0.1, 1.35, 0);
  addCone(root, 0.05, 0.15, 0x222222, 0.1, 1.35, 0);
  return root;
}

function makeSlime() {
  const root = new THREE.Group();
  addSphere(root, 0.55, 0x33cc66, 0, 0.55, 0, {
    emissive: 0x118833,
    emissiveIntensity: 0.2,
  });
  addSphere(root, 0.08, 0x111111, -0.15, 0.7, 0.4);
  addSphere(root, 0.08, 0x111111, 0.15, 0.7, 0.4);
  return root;
}

const builders = {
  dragon: makeDragon,
  ogre: makeOgre,
  skeleton: makeSkeleton,
  goblin: makeGoblin,
  lich: makeLich,
  wolf: makeWolf,
  knight: makeKnight,
  spider: makeSpider,
  elemental: makeElemental,
  beholder: makeBeholder,
  bat: makeBat,
  slime: makeSlime,
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
