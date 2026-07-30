import * as THREE from "three";

/**
 * Fog and particle layers occupying the volume above the box.
 *
 * These exist purely for motion parallax. Because they sit at different heights,
 * a viewer moving along the balcony sees them slide across each other and across
 * the box surface at different rates, and that differential motion is read as
 * genuine depth. Additive blending is deliberate: a projector can only add
 * light, so anything meant to look luminous in the air must be additive.
 *
 * All motion is computed in the vertex shader from a per-particle seed, so the
 * CPU never touches particle positions.
 */

const FOG_LAYER_COUNT = 3;
const EMBER_COUNT = 100;
const DUST_COUNT = 140;

const fogVertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fogFragmentShader = /* glsl */ `
  precision highp float;

  uniform float time;
  uniform float strength;
  uniform float scrollSpeed;
  uniform float layerSeed;
  uniform vec3 fogColor;

  varying vec2 vUv;

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
    for (int octave = 0; octave < 4; octave++) {
      total += noise(point) * amplitude;
      point *= 2.02;
      amplitude *= 0.5;
    }
    return total;
  }

  void main() {
    vec2 drift = vec2(time * scrollSpeed, time * scrollSpeed * 0.42);
    float density = fbm(vUv * 3.4 + drift + layerSeed);
    density = smoothstep(0.34, 0.86, density);

    float edgeFade = smoothstep(0.0, 0.28, vUv.x) * smoothstep(1.0, 0.72, vUv.x) *
                     smoothstep(0.0, 0.28, vUv.y) * smoothstep(1.0, 0.72, vUv.y);

    float alpha = density * edgeFade * strength;
    if (alpha < 0.002) discard;
    gl_FragColor = vec4(fogColor, alpha);
  }
`;

const particleVertexShader = /* glsl */ `
  attribute vec4 particleSeed;

  uniform float time;
  uniform float riseSpeed;
  uniform float riseHeight;
  uniform float swayAmount;
  uniform float pointScale;
  uniform float baseSize;

  varying float vFade;

  void main() {
    float lifeCycle = fract(particleSeed.w + time * riseSpeed);

    float sway = sin(time * 0.85 + particleSeed.w * 12.0) * swayAmount;
    float swayCross = cos(time * 0.63 + particleSeed.w * 9.0) * swayAmount;

    vec3 animated = vec3(
      particleSeed.x + sway,
      particleSeed.y + lifeCycle * riseHeight,
      particleSeed.z + swayCross
    );

    // Fade in at birth and out at the top of the cycle.
    vFade = smoothstep(0.0, 0.18, lifeCycle) * (1.0 - smoothstep(0.55, 1.0, lifeCycle));

    vec4 viewPosition = modelViewMatrix * vec4(animated, 1.0);
    gl_PointSize = baseSize * pointScale / max(0.001, -viewPosition.z);
    gl_Position = projectionMatrix * viewPosition;
  }
`;

const particleFragmentShader = /* glsl */ `
  precision highp float;

  uniform vec3 particleColor;
  uniform float strength;

  varying float vFade;

  void main() {
    vec2 offsetFromCentre = gl_PointCoord - vec2(0.5);
    float radius = length(offsetFromCentre);
    if (radius > 0.5) discard;

    float core = smoothstep(0.5, 0.0, radius);
    float alpha = core * core * vFade * strength;
    if (alpha < 0.003) discard;
    gl_FragColor = vec4(particleColor, alpha);
  }
`;

function createFogLayer(extent, layerIndex) {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      time: { value: 0 },
      strength: { value: 0 },
      scrollSpeed: { value: 0.012 + layerIndex * 0.009 },
      layerSeed: { value: layerIndex * 7.31 },
      fogColor: { value: new THREE.Color(0x9fb4cc) },
    },
    vertexShader: fogVertexShader,
    fragmentShader: fogFragmentShader,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });

  const layer = new THREE.Mesh(new THREE.PlaneGeometry(extent * 2, extent * 2), material);
  layer.rotation.x = -Math.PI / 2;
  layer.position.y = 0.05 + layerIndex * 0.16;
  layer.renderOrder = 2;
  layer.raycast = () => {};
  return layer;
}

function createParticleField(count, extent, options) {
  const seeds = new Float32Array(count * 4);
  for (let index = 0; index < count; index += 1) {
    seeds[index * 4 + 0] = (Math.random() * 2 - 1) * extent;
    seeds[index * 4 + 1] = options.baseHeight + Math.random() * options.spawnSpread;
    seeds[index * 4 + 2] = (Math.random() * 2 - 1) * extent;
    seeds[index * 4 + 3] = Math.random();
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("particleSeed", new THREE.BufferAttribute(seeds, 4));
  geometry.setAttribute(
    "position",
    new THREE.BufferAttribute(new Float32Array(count * 3), 3)
  );
  geometry.boundingSphere = new THREE.Sphere(
    new THREE.Vector3(0, options.riseHeight * 0.5, 0),
    extent * 2 + options.riseHeight
  );

  const material = new THREE.ShaderMaterial({
    uniforms: {
      time: { value: 0 },
      strength: { value: 0 },
      riseSpeed: { value: options.riseSpeed },
      riseHeight: { value: options.riseHeight },
      swayAmount: { value: options.swayAmount },
      baseSize: { value: options.baseSize },
      pointScale: { value: 300 },
      particleColor: { value: new THREE.Color(options.color) },
    },
    vertexShader: particleVertexShader,
    fragmentShader: particleFragmentShader,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  const field = new THREE.Points(geometry, material);
  field.renderOrder = 3;
  field.frustumCulled = false;
  field.raycast = () => {};
  return field;
}

/**
 * Fog slabs, rising embers and slow drifting dust, grouped so the renderer can
 * add or remove the whole atmosphere in one call.
 */
export function createAtmosphere(boxHalfExtent = 1.2) {
  const group = new THREE.Group();
  group.name = "atmosphere";

  const fogLayers = [];
  for (let layerIndex = 0; layerIndex < FOG_LAYER_COUNT; layerIndex += 1) {
    const layer = createFogLayer(boxHalfExtent, layerIndex);
    fogLayers.push(layer);
    group.add(layer);
  }

  const embers = createParticleField(EMBER_COUNT, boxHalfExtent, {
    baseHeight: 0.02,
    spawnSpread: 0.1,
    riseSpeed: 0.055,
    riseHeight: 2.1,
    swayAmount: 0.11,
    baseSize: 0.011,
    color: 0xffa347,
  });
  group.add(embers);

  const dustMotes = createParticleField(DUST_COUNT, boxHalfExtent * 1.15, {
    baseHeight: 0.06,
    spawnSpread: 1.4,
    riseSpeed: 0.018,
    riseHeight: 1.1,
    swayAmount: 0.2,
    baseSize: 0.007,
    color: 0xcfe4ff,
  });
  group.add(dustMotes);

  return { group, fogLayers, embers, dustMotes };
}

export function updateAtmosphere(atmosphere, fxState, elapsedSeconds, pixelHeight = 900) {
  if (!atmosphere) return;
  const active = fxState.enabled;

  for (const [layerIndex, layer] of atmosphere.fogLayers.entries()) {
    const visible = active && fxState.groundFogEnabled;
    layer.visible = visible;
    if (!visible) continue;
    layer.material.uniforms.time.value = elapsedSeconds;
    // Upper slabs are thinner so the stack reads as depth rather than a wall.
    layer.material.uniforms.strength.value =
      fxState.groundFogStrength * (0.5 - layerIndex * 0.12);
  }

  const pointScale = pixelHeight * 0.5;

  atmosphere.embers.visible = active && fxState.embersEnabled;
  if (atmosphere.embers.visible) {
    atmosphere.embers.material.uniforms.time.value = elapsedSeconds;
    atmosphere.embers.material.uniforms.strength.value = fxState.emberStrength;
    atmosphere.embers.material.uniforms.pointScale.value = pointScale;
  }

  atmosphere.dustMotes.visible = active && fxState.dustMotesEnabled;
  if (atmosphere.dustMotes.visible) {
    atmosphere.dustMotes.material.uniforms.time.value = elapsedSeconds;
    atmosphere.dustMotes.material.uniforms.strength.value = fxState.dustStrength;
    atmosphere.dustMotes.material.uniforms.pointScale.value = pointScale;
  }
}

export function disposeAtmosphere(atmosphere) {
  if (!atmosphere) return;
  atmosphere.group.traverse((object) => {
    if (object.isMesh || object.isPoints) {
      object.geometry?.dispose?.();
      object.material?.dispose?.();
    }
  });
}
