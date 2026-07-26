import * as THREE from "three";
import { getBattleMapById } from "./battleMaps.js";

const textureLoader = new THREE.TextureLoader();
const textureCache = new Map();
const BATTLE_MAP_SHADER_VERSION = 3;

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

/**
 * Color-heuristic “alive map” — no separate masks required.
 * Water is limited to saturated blues (not ice). Optional soft snowfall
 * and lava boil are separate channels so icy maps don’t get river shimmer.
 */
const fragmentShader = /* glsl */ `
  precision highp float;

  uniform sampler2D mapTexture;
  uniform float time;
  uniform float waterStrength;
  uniform float windStrength;
  uniform float fireStrength;
  uniform float fogStrength;
  uniform float snowStrength;
  uniform float intensity;

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

  void main() {
    float effectScale = clamp(intensity, 0.0, 1.5);

    vec3 probe = texture2D(mapTexture, vUv).rgb;
    float red = probe.r;
    float green = probe.g;
    float blue = probe.b;
    float luma = (red + green + blue) / 3.0;
    float maxChannel = max(red, max(green, blue));
    float minChannel = min(red, min(green, blue));
    float saturation = maxChannel > 0.001 ? (maxChannel - minChannel) / maxChannel : 0.0;

    // Blue / cyan water only (river, pond, brook) — not dirt roads or ice whites.
    float blueDominance = blue - max(red, green * 0.75);
    float waterMask = smoothstep(0.04, 0.2, blueDominance);
    // Turquoise oasis / forest pools: blue leads red; green+blue beat sand.
    float cyanWater =
      smoothstep(0.06, 0.22, blue - red) *
      smoothstep(0.02, 0.16, (blue + green) * 0.5 - red) *
      smoothstep(0.28, 0.5, blue);
    waterMask = max(waterMask, cyanWater);
    // Need enough blue so tan/grey paths never qualify
    waterMask *= smoothstep(0.22, 0.42, blue);
    // Drop near-white low-sat ice highlights
    float icyWhite = smoothstep(0.78, 0.92, luma) * (1.0 - smoothstep(0.25, 0.5, saturation));
    waterMask *= 1.0 - icyWhite;
    // Bright river foam only where already watery
    float foam =
      waterMask *
      smoothstep(0.62, 0.88, luma) *
      smoothstep(0.08, 0.25, blue - red);
    waterMask = clamp(waterMask + foam * 0.35, 0.0, 1.0);

    float foliageMask = smoothstep(0.06, 0.28, green - max(red, blue));
    foliageMask *= (1.0 - waterMask);

    // Campfire warmth (glow only — must NOT UV-warp sandy roads)
    float warm = smoothstep(0.05, 0.22, red - blue) * smoothstep(0.35, 0.7, red);
    float campRegion = 1.0 - smoothstep(0.32, 0.58, vUv.x);
    float fireMask = clamp(warm * (0.35 + campRegion * 0.9), 0.0, 1.0);

    // Vivid magma only (lava orange/red) — dirt paths fail this test
    float magma =
      smoothstep(0.18, 0.35, red - green) *
      smoothstep(0.22, 0.42, red - blue) *
      smoothstep(0.45, 0.7, saturation) *
      smoothstep(0.5, 0.8, red);

    // Soft wind sway on foliage
    vec2 windOffset = vec2(
      sin(time * 1.15 + vUv.y * 18.0) * 0.0045,
      cos(time * 0.95 + vUv.x * 16.0) * 0.0035
    ) * windStrength * effectScale;

    // River / pool ripple — applied only where waterMask is set
    vec2 waterOffset = vec2(
      sin(time * 1.55 + vUv.y * 42.0) * 0.007,
      cos(time * 1.25 + vUv.x * 38.0) * 0.006
    ) * waterStrength * effectScale;

    // Lava boil UV — only on vivid magma, never on roads
    vec2 lavaOffset = vec2(
      sin(time * 4.2 + vUv.y * 55.0) * 0.0055,
      cos(time * 3.6 + vUv.x * 48.0) * 0.0048
    ) * fireStrength * effectScale * magma;

    vec2 sampleUv = vUv;
    sampleUv += waterOffset * waterMask;
    sampleUv += windOffset * foliageMask;
    sampleUv += lavaOffset;
    sampleUv = clamp(sampleUv, 0.001, 0.999);

    vec3 color = texture2D(mapTexture, sampleUv).rgb;

    // Water sparkle (rivers / oasis only)
    float sparkle = noise(sampleUv * 48.0 + vec2(time * 0.35, -time * 0.22));
    float shimmer = 0.55 + 0.45 * sin(time * 3.2 + sampleUv.x * 30.0 + sampleUv.y * 22.0);
    color += waterMask * waterStrength * effectScale * vec3(0.12, 0.22, 0.34) * shimmer;
    color += waterMask * waterStrength * effectScale * sparkle * 0.12;

    // Foliage breath
    float leafPulse = 0.5 + 0.5 * sin(time * 1.4 + sampleUv.x * 10.0);
    color *= 1.0 + foliageMask * windStrength * effectScale * leafPulse * 0.06;

    // Lava / fire: boil highlights + warm flicker
    float boil =
      0.5 +
      0.5 * sin(time * 9.0 + sampleUv.x * 40.0 + sampleUv.y * 28.0) *
      (0.65 + 0.35 * noise(sampleUv * 28.0 + time * 1.8));
    float flicker =
      0.55 +
      0.45 * sin(time * 7.5 + sampleUv.y * 20.0) *
      (0.7 + 0.3 * noise(sampleUv * 20.0 + time));
    color += magma * fireStrength * effectScale * vec3(0.7, 0.28, 0.05) * boil * 0.28;
    color += magma * fireStrength * effectScale * vec3(1.0, 0.55, 0.12) * sparkle * 0.1;
    color += fireMask * fireStrength * effectScale * vec3(0.55, 0.22, 0.05) * flicker * 0.28;
    color = mix(
      color,
      color * vec3(1.2, 0.92, 0.72),
      fireMask * fireStrength * effectScale * 0.2 * flicker
    );

    // Soft fog / mist
    float edge = max(abs(vUv.x - 0.5) * 1.7, abs(vUv.y - 0.5) * 1.7);
    float mist =
      noise(vUv * 6.0 + vec2(time * 0.08, time * 0.05)) *
      smoothstep(0.35, 0.95, edge);
    color = mix(
      color,
      color * 0.82 + vec3(0.55, 0.62, 0.7) * 0.18,
      mist * fogStrength * effectScale
    );

    // Optional soft snowfall — sparse, slow, no hail streaks.
    // Kept very subtle; ice maps default snowStrength to 0 (static).
    if (snowStrength > 0.001) {
      float snowAmount = snowStrength * effectScale * 0.35;
      vec2 flakeUv = vUv * vec2(28.0, 36.0);
      flakeUv.y -= time * 0.22;
      flakeUv.x += sin(time * 0.25 + vUv.y * 6.0) * 0.2;
      vec2 cell = floor(flakeUv);
      vec2 local = fract(flakeUv) - 0.5;
      float flakeId = hash(cell);
      float keep = step(0.97, flakeId);
      float radius = 0.018 + 0.012 * fract(flakeId * 17.0);
      float flake = keep * smoothstep(radius, 0.0, length(local));
      color += vec3(0.95, 0.97, 1.0) * flake * snowAmount;
    }

    gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
  }
`;

export async function loadBattleMapTexture(fileUrl) {
  if (!fileUrl) return null;
  if (textureCache.has(fileUrl)) {
    return textureCache.get(fileUrl);
  }

  const texture = await new Promise((resolve, reject) => {
    textureLoader.load(
      fileUrl,
      (loaded) => resolve(loaded),
      undefined,
      (error) => reject(error)
    );
  });

  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  textureCache.set(fileUrl, texture);
  return texture;
}

/** Drop a cached texture so regenerated PNGs reload cleanly. */
export function invalidateBattleMapTexture(fileUrl) {
  const texture = textureCache.get(fileUrl);
  if (texture) {
    texture.dispose?.();
    textureCache.delete(fileUrl);
  }
}

export function createBattleMapMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      mapTexture: { value: null },
      time: { value: 0 },
      waterStrength: { value: 0 },
      windStrength: { value: 0 },
      fireStrength: { value: 0 },
      fogStrength: { value: 0 },
      snowStrength: { value: 0 },
      intensity: { value: 1 },
    },
    vertexShader,
    fragmentShader,
    transparent: false,
    depthWrite: true,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  });
}

export function createFallbackBoxMaterial(opacity = 0.55) {
  return new THREE.MeshStandardMaterial({
    color: 0x2a3340,
    roughness: 1,
    metalness: 0,
    transparent: true,
    opacity,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  });
}

/**
 * Apply battle-map settings to the floor mesh.
 * Returns a promise when a texture load is required.
 */
export async function applyBattleMapToSurface(boxSurface, battleMapState, options = {}) {
  const mapConfig = getBattleMapById(battleMapState?.mapId);
  const enabled = Boolean(battleMapState?.enabled) && Boolean(mapConfig?.file);
  const intensity = Number(battleMapState?.intensity) || 0;
  const effectScale = intensity;

  if (!enabled) {
    const opacity =
      typeof options.fallbackOpacity === "number"
        ? options.fallbackOpacity
        : 0.55;
    if (
      !boxSurface.material ||
      boxSurface.material.isShaderMaterial ||
      boxSurface.userData.usingBattleMap
    ) {
      if (!boxSurface.userData.fallbackMaterial) {
        boxSurface.userData.fallbackMaterial = createFallbackBoxMaterial(opacity);
      } else {
        boxSurface.userData.fallbackMaterial.opacity = opacity;
      }
      boxSurface.material = boxSurface.userData.fallbackMaterial;
      boxSurface.userData.usingBattleMap = false;
    } else if (boxSurface.material.opacity !== undefined) {
      boxSurface.material.opacity = opacity;
    }
    return { enabled: false, mapId: mapConfig?.id || "none" };
  }

  if (
    !boxSurface.userData.battleMapMaterial ||
    !boxSurface.userData.battleMapMaterial.uniforms?.snowStrength ||
    boxSurface.userData.battleMapShaderVersion !== BATTLE_MAP_SHADER_VERSION
  ) {
    boxSurface.userData.battleMapMaterial?.dispose?.();
    boxSurface.userData.battleMapMaterial = createBattleMapMaterial();
    boxSurface.userData.battleMapShaderVersion = BATTLE_MAP_SHADER_VERSION;
  }
  const material = boxSurface.userData.battleMapMaterial;

  // Bust cache when map asset version changes (regenerated art).
  const textureUrl = mapConfig.file;
  if (mapConfig.cacheKey && textureCache.has(textureUrl)) {
    const cached = textureCache.get(textureUrl);
    if (cached.userData?.cacheKey !== mapConfig.cacheKey) {
      invalidateBattleMapTexture(textureUrl);
    }
  }

  const texture = await loadBattleMapTexture(textureUrl);
  if (mapConfig.cacheKey) {
    texture.userData = texture.userData || {};
    texture.userData.cacheKey = mapConfig.cacheKey;
  }
  material.uniforms.mapTexture.value = texture;

  const baseEffects = mapConfig.effects || {};
  material.uniforms.waterStrength.value =
    battleMapState.water !== false ? (baseEffects.water || 0) : 0;
  material.uniforms.windStrength.value =
    battleMapState.wind !== false ? (baseEffects.wind || 0) : 0;
  material.uniforms.fireStrength.value =
    battleMapState.fire !== false ? (baseEffects.fire || 0) : 0;
  material.uniforms.fogStrength.value =
    battleMapState.fog !== false ? (baseEffects.fog || 0) : 0;
  material.uniforms.snowStrength.value =
    battleMapState.snow !== false ? (baseEffects.snow || 0) : 0;
  material.uniforms.intensity.value = effectScale;

  boxSurface.material = material;
  boxSurface.userData.usingBattleMap = true;
  return { enabled: true, mapId: mapConfig.id };
}

export function tickBattleMap(boxSurface, elapsedSeconds, options = {}) {
  const material = boxSurface?.material;
  if (!material?.isShaderMaterial || !material.uniforms?.time) return;
  material.uniforms.time.value = elapsedSeconds;
  // Slight liveliness bump while projecting so water/fog read on the real box.
  if (material.uniforms.intensity && options.venueLive) {
    const base = Number(options.baseIntensity);
    const intensity = Number.isFinite(base) ? base : 1;
    material.uniforms.intensity.value = Math.min(1.45, intensity * 1.2);
  }
}
