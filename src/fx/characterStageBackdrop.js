import * as THREE from "three";

/**
 * Immersive diorama booth for the character stage: floor plate, curved back
 * wall, and soft side wings with a procedural backdrop shader so GLB creatures
 * read as truly 3D against depth, not cutouts on the PNG map.
 */

const BACKDROP_PALETTES = {
  void: {
    deep: new THREE.Color("#07060f"),
    mid: new THREE.Color("#1a1433"),
    glow: new THREE.Color("#6b4dff"),
    rim: new THREE.Color("#c4b5ff"),
    floor: new THREE.Color("#12101c"),
  },
  dungeon: {
    deep: new THREE.Color("#0c0a08"),
    mid: new THREE.Color("#2a2218"),
    glow: new THREE.Color("#c48a3a"),
    rim: new THREE.Color("#e8c070"),
    floor: new THREE.Color("#1a1510"),
  },
  ember: {
    deep: new THREE.Color("#100505"),
    mid: new THREE.Color("#3a1208"),
    glow: new THREE.Color("#ff6a2a"),
    rim: new THREE.Color("#ffb070"),
    floor: new THREE.Color("#1a0c08"),
  },
  mist: {
    deep: new THREE.Color("#060a0c"),
    mid: new THREE.Color("#143028"),
    glow: new THREE.Color("#4ec9a8"),
    rim: new THREE.Color("#a8ffe0"),
    floor: new THREE.Color("#0c1412"),
  },
};

const backdropVertexShader = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vWorldPosition;
  void main() {
    vUv = uv;
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorldPosition = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const backdropFragmentShader = /* glsl */ `
  precision highp float;

  uniform float time;
  uniform vec3 deepColor;
  uniform vec3 midColor;
  uniform vec3 glowColor;
  uniform vec3 rimColor;
  uniform float intensity;

  varying vec2 vUv;
  varying vec3 vWorldPosition;

  float hash(vec2 point) {
    return fract(sin(dot(point, vec2(127.1, 311.7))) * 43758.5453123);
  }

  float noise(vec2 point) {
    vec2 cell = floor(point);
    vec2 fraction = fract(point);
    float cornerA = hash(cell);
    float cornerB = hash(cell + vec2(1.0, 0.0));
    float cornerC = hash(cell + vec2(0.0, 1.0));
    float cornerD = hash(cell + vec2(1.0, 1.0));
    vec2 blend = fraction * fraction * (3.0 - 2.0 * fraction);
    return mix(mix(cornerA, cornerB, blend.x), mix(cornerC, cornerD, blend.x), blend.y);
  }

  float fbm(vec2 point) {
    float total = 0.0;
    float amplitude = 0.5;
    for (int octave = 0; octave < 5; octave++) {
      total += noise(point) * amplitude;
      point *= 2.05;
      amplitude *= 0.5;
    }
    return total;
  }

  void main() {
    vec2 uv = vUv;
    float vertical = uv.y;
    float horizontal = abs(uv.x - 0.5) * 2.0;

    vec2 drift = vec2(time * 0.035, time * 0.02);
    float clouds = fbm(uv * vec2(2.4, 1.6) + drift);
    float veins = fbm(uv * vec2(5.5, 3.2) - drift * 1.4);

    vec3 color = mix(deepColor, midColor, smoothstep(0.15, 0.85, vertical + clouds * 0.25));
    float glowBand = smoothstep(0.2, 0.55, clouds) * smoothstep(1.0, 0.35, vertical);
    color = mix(color, glowColor, glowBand * 0.55 * intensity);
    color += rimColor * (1.0 - smoothstep(0.0, 0.35, horizontal)) * 0.18 * intensity;
    color += glowColor * veins * 0.12 * intensity * (1.0 - vertical * 0.5);

    // Soft vignette so the character silhouette pops in the center.
    float vignette = smoothstep(1.15, 0.35, length(vec2(horizontal, (1.0 - vertical) * 0.85)));
    color *= mix(0.55, 1.0, vignette);

    float alpha = 1.0;
    gl_FragColor = vec4(color, alpha);
  }
`;

function getPalette(backdropId) {
  return BACKDROP_PALETTES[backdropId] || BACKDROP_PALETTES.void;
}

function createBackdropMaterial(backdropId) {
  const palette = getPalette(backdropId);
  return new THREE.ShaderMaterial({
    uniforms: {
      time: { value: 0 },
      deepColor: { value: palette.deep.clone() },
      midColor: { value: palette.mid.clone() },
      glowColor: { value: palette.glow.clone() },
      rimColor: { value: palette.rim.clone() },
      intensity: { value: 1 },
    },
    vertexShader: backdropVertexShader,
    fragmentShader: backdropFragmentShader,
    side: THREE.DoubleSide,
    depthWrite: true,
  });
}

function createFloorMaterial(backdropId) {
  const palette = getPalette(backdropId);
  return new THREE.MeshStandardMaterial({
    color: palette.floor.clone(),
    roughness: 0.82,
    metalness: 0.12,
    emissive: palette.glow.clone(),
    emissiveIntensity: 0.08,
  });
}

function disposeMesh(mesh) {
  if (!mesh) return;
  mesh.geometry?.dispose?.();
  if (Array.isArray(mesh.material)) {
    mesh.material.forEach((material) => material?.dispose?.());
  } else {
    mesh.material?.dispose?.();
  }
}

/**
 * Build the character-stage diorama group.
 * Local space: floor on XZ, back wall at −Z, facing +Z (toward the battle map / camera).
 */
export function createCharacterStageVisual() {
  const group = new THREE.Group();
  group.name = "character-stage";

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    createFloorMaterial("void")
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  floor.castShadow = false;
  floor.name = "character-stage-floor";
  group.add(floor);

  const back = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    createBackdropMaterial("void")
  );
  back.position.set(0, 0.5, -0.5);
  back.receiveShadow = false;
  back.castShadow = false;
  back.name = "character-stage-back";
  group.add(back);

  const leftWing = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    createBackdropMaterial("void")
  );
  leftWing.position.set(-0.5, 0.5, 0);
  leftWing.rotation.y = Math.PI / 2;
  leftWing.name = "character-stage-left";
  group.add(leftWing);

  const rightWing = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    createBackdropMaterial("void")
  );
  rightWing.position.set(0.5, 0.5, 0);
  rightWing.rotation.y = -Math.PI / 2;
  rightWing.name = "character-stage-right";
  group.add(rightWing);

  // Soft edge frame — barely there so the booth doesn’t read as a wireframe cage.
  const frame = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)),
    new THREE.LineBasicMaterial({
      color: 0x9aa3b5,
      transparent: true,
      opacity: 0.07,
      depthWrite: false,
    })
  );
  frame.position.y = 0.5;
  frame.name = "character-stage-frame";
  frame.raycast = () => {};
  group.add(frame);

  // Thin floor plate outline only — grounds the square without a loud cage.
  const floorEdge = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.PlaneGeometry(1, 1)),
    new THREE.LineBasicMaterial({
      color: 0xc9a227,
      transparent: true,
      opacity: 0.18,
      depthWrite: false,
    })
  );
  floorEdge.rotation.x = -Math.PI / 2;
  floorEdge.position.y = 0.004;
  floorEdge.name = "character-stage-floor-edge";
  floorEdge.raycast = () => {};
  group.add(floorEdge);

  // Fill light inside the booth so characters aren't flat against the map lights.
  const boothKey = new THREE.PointLight(0xffe6c8, 1.35, 3.5, 1.6);
  boothKey.position.set(0.15, 0.95, 0.25);
  boothKey.name = "character-stage-key";
  group.add(boothKey);

  const boothFill = new THREE.PointLight(0x8eb6ff, 0.55, 3.2, 1.8);
  boothFill.position.set(-0.35, 0.7, 0.1);
  boothFill.name = "character-stage-fill";
  group.add(boothFill);

  const rimLight = new THREE.PointLight(0xa88cff, 0.7, 2.8, 1.5);
  rimLight.position.set(0, 0.85, -0.35);
  rimLight.name = "character-stage-rim";
  group.add(rimLight);

  group.userData = {
    floor,
    back,
    leftWing,
    rightWing,
    frame,
    floorEdge,
    boothKey,
    boothFill,
    rimLight,
    backdropId: "void",
    materials: [],
  };

  return group;
}

function collectShaderMaterials(group) {
  const materials = [];
  group.traverse((object) => {
    if (object.isMesh && object.material?.isShaderMaterial) {
      materials.push(object.material);
    }
  });
  return materials;
}

export function updateCharacterStageVisual(group, pose) {
  if (!group || !pose) return;

  group.visible = Boolean(pose.enabled);
  if (!pose.enabled) return;

  const size = Math.max(0.1, pose.size);
  const height = Math.max(0.3, pose.height);
  group.position.set(pose.centerX, pose.centerY, pose.centerZ);

  const {
    floor,
    back,
    leftWing,
    rightWing,
    frame,
    floorEdge,
    boothKey,
    boothFill,
    rimLight,
  } = group.userData;

  if (floor) {
    floor.scale.set(size, size, 1);
  }
  if (floorEdge) {
    floorEdge.scale.set(size, size, 1);
  }

  if (back) {
    back.scale.set(size, height, 1);
    back.position.set(0, height * 0.5, -size * 0.5);
  }
  if (leftWing) {
    leftWing.scale.set(size, height, 1);
    leftWing.position.set(-size * 0.5, height * 0.5, 0);
  }
  if (rightWing) {
    rightWing.scale.set(size, height, 1);
    rightWing.position.set(size * 0.5, height * 0.5, 0);
  }
  if (frame) {
    frame.scale.set(size, height, size);
    frame.position.y = height * 0.5;
  }

  if (boothKey) {
    boothKey.position.set(size * 0.18, height * 0.82, size * 0.22);
    boothKey.distance = size * 3.2;
    boothKey.intensity = 1.15 + size * 0.25;
  }
  if (boothFill) {
    boothFill.position.set(-size * 0.32, height * 0.62, size * 0.12);
    boothFill.distance = size * 3;
  }
  if (rimLight) {
    rimLight.position.set(0, height * 0.75, -size * 0.32);
    rimLight.distance = size * 2.6;
  }

  if (pose.backdrop !== group.userData.backdropId) {
    applyCharacterStageBackdrop(group, pose.backdrop);
  }
}

export function applyCharacterStageBackdrop(group, backdropId) {
  if (!group) return;
  const palette = getPalette(backdropId);
  group.userData.backdropId = backdropId;

  const { floor, back, leftWing, rightWing, boothKey, boothFill, rimLight } =
    group.userData;

  if (floor?.material) {
    floor.material.color.copy(palette.floor);
    floor.material.emissive.copy(palette.glow);
    floor.material.needsUpdate = true;
  }

  for (const wall of [back, leftWing, rightWing]) {
    const material = wall?.material;
    if (!material?.uniforms) continue;
    material.uniforms.deepColor.value.copy(palette.deep);
    material.uniforms.midColor.value.copy(palette.mid);
    material.uniforms.glowColor.value.copy(palette.glow);
    material.uniforms.rimColor.value.copy(palette.rim);
  }

  if (boothKey) boothKey.color.copy(palette.rim);
  if (boothFill) boothFill.color.copy(palette.glow);
  if (rimLight) rimLight.color.copy(palette.glow);

  group.userData.materials = collectShaderMaterials(group);
}

export function tickCharacterStageVisual(group, elapsedSeconds) {
  if (!group?.visible) return;
  const materials = group.userData.materials?.length
    ? group.userData.materials
    : collectShaderMaterials(group);
  group.userData.materials = materials;
  for (const material of materials) {
    if (material.uniforms?.time) {
      material.uniforms.time.value = elapsedSeconds;
    }
  }
}

export function disposeCharacterStageVisual(group) {
  if (!group) return;
  const meshes = [];
  group.traverse((object) => {
    if (object.isMesh || object.isLineSegments) meshes.push(object);
  });
  for (const mesh of meshes) disposeMesh(mesh);
}
