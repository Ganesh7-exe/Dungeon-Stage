import * as THREE from "three";
import {
  deathHouseBasementFogConfig,
  isDeathHouseBasementMap,
} from "./deathHouseBasement.js";

const textureLoader = new THREE.TextureLoader();
const maskCache = new Map();

function configureMaskTexture(texture) {
  texture.colorSpace = THREE.NoColorSpace;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  return texture;
}

export async function loadFogMaskTexture(fileUrl) {
  if (!fileUrl) return null;
  if (maskCache.has(fileUrl)) {
    return maskCache.get(fileUrl);
  }

  const texture = await new Promise((resolve, reject) => {
    textureLoader.load(fileUrl, resolve, undefined, reject);
  });
  configureMaskTexture(texture);
  maskCache.set(fileUrl, texture);
  return texture;
}

export function disposeFogMaskTextures() {
  for (const texture of maskCache.values()) {
    texture.dispose?.();
  }
  maskCache.clear();
}

/**
 * Composite revealed region mask alphas into a single R8-style luminance texture.
 * White = revealed, black = still fogged (within interior).
 */
export function buildRevealMaskData(revealedRegions, regionMaskSources, width, height) {
  const revealData = new Uint8Array(width * height);
  if (!revealedRegions?.length || !regionMaskSources?.length) {
    return revealData;
  }

  const revealedSet = new Set(revealedRegions);
  for (const regionMask of regionMaskSources) {
    if (!revealedSet.has(regionMask.regionId)) continue;
    const source = regionMask.imageData;
    if (!source || source.length !== revealData.length) continue;
    for (let index = 0; index < revealData.length; index += 1) {
      if (source[index] > revealData[index]) {
        revealData[index] = source[index];
      }
    }
  }
  return revealData;
}

export function createRevealMaskTextureFromData(revealData, width, height) {
  const rgba = new Uint8Array(width * height * 4);
  for (let index = 0; index < revealData.length; index += 1) {
    const offset = index * 4;
    const value = revealData[index];
    rgba[offset] = value;
    rgba[offset + 1] = value;
    rgba[offset + 2] = value;
    rgba[offset + 3] = 255;
  }

  const texture = new THREE.DataTexture(rgba, width, height, THREE.RGBAFormat);
  configureMaskTexture(texture);
  texture.needsUpdate = true;
  return texture;
}

export async function loadDeathHouseBasementFogMasks() {
  const interiorTexture = await loadFogMaskTexture(
    deathHouseBasementFogConfig.interiorMask
  );

  const regionTextures = await Promise.all(
    deathHouseBasementFogConfig.regions.map(async (region) => ({
      regionId: region.id,
      texture: await loadFogMaskTexture(region.mask),
    }))
  );

  const width = interiorTexture?.image?.width || 0;
  const height = interiorTexture?.image?.height || 0;

  return {
    interiorTexture,
    regionTextures,
    width,
    height,
  };
}

/** Extract alpha channel from a loaded mask PNG into a Uint8Array. */
export function extractMaskAlpha(image, width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(image, 0, 0, width, height);
  const pixels = context.getImageData(0, 0, width, height).data;
  const alpha = new Uint8Array(width * height);
  for (let index = 0; index < alpha.length; index += 1) {
    alpha[index] = pixels[index * 4 + 3];
  }
  return alpha;
}

export function getFogConfigForMap(mapId) {
  if (isDeathHouseBasementMap(mapId)) {
    return deathHouseBasementFogConfig;
  }
  return null;
}
