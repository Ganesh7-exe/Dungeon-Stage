import * as THREE from "three";
import { getMapRevealConfig } from "../fogOfWar/mapRevealConfig.js";

const layerManifestCache = new Map();
const layerBundleCache = new Map();

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Failed to load image: ${url}`));
    image.src = url;
  });
}

function extractRgba(image, width, height) {
  if (image.width !== width || image.height !== height) {
    console.warn(
      `Crop image ${image.width}x${image.height} does not match manifest ${width}x${height}`
    );
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(image, 0, 0, width, height);
  return context.getImageData(0, 0, width, height).data;
}

export async function loadMapRevealLayerManifest(mapId) {
  const cacheKey = `manifest:${mapId}`;
  if (layerManifestCache.has(cacheKey)) {
    return layerManifestCache.get(cacheKey);
  }

  const layerConfig = getMapRevealConfig(mapId);
  if (!layerConfig?.manifest) {
    throw new Error(`No layer manifest configured for map: ${mapId}`);
  }

  const loadPromise = (async () => {
    const response = await fetch(layerConfig.manifest);
    if (!response.ok) {
      throw new Error(`Failed to load layer manifest: ${layerConfig.manifest}`);
    }
    return response.json();
  })();

  layerManifestCache.set(cacheKey, loadPromise);
  return loadPromise;
}

export async function loadMapRevealLayerBundle(mapId) {
  if (layerBundleCache.has(mapId)) {
    return layerBundleCache.get(mapId);
  }

  const loadPromise = (async () => {
    const manifest = await loadMapRevealLayerManifest(mapId);
    const layerConfig = getMapRevealConfig(mapId);
    const { width, height } = manifest.mapSize;
    const cacheVersion = manifest.cacheKey
      ? `?v=${encodeURIComponent(manifest.cacheKey)}`
      : "";

    const [cropSources, sourceImage] = await Promise.all([
      Promise.all(
        manifest.regions.map(async (region) => {
          const image = await loadImage(`${region.cropFile}${cacheVersion}`);
          return {
            regionId: region.id,
            rgba: extractRgba(image, width, height),
          };
        })
      ),
      layerConfig?.sourceMap
        ? loadImage(`${layerConfig.sourceMap}${cacheVersion}`)
        : Promise.resolve(null),
    ]);

    return {
      mapId,
      width,
      height,
      cropSources,
      sourceRgba: sourceImage ? extractRgba(sourceImage, width, height) : null,
      fullRevealRegionId:
        manifest.fullRevealRegionId ?? layerConfig?.fullRevealRegionId ?? null,
    };
  })();

  layerBundleCache.set(mapId, loadPromise);
  return loadPromise;
}

/** @deprecated Use loadMapRevealLayerBundle */
export async function loadDeathHouseBasementLayerBundle() {
  return loadMapRevealLayerBundle("death-house-basement");
}

export function getLayerConfigForMap(mapId) {
  return getMapRevealConfig(mapId);
}

export function compositeRevealedLayer(revealedRegions, cropSources, width, height, options = {}) {
  const { fullRevealRegionId = null, sourceRgba = null } = options;
  const revealedSet = new Set(revealedRegions);

  if (
    fullRevealRegionId != null &&
    revealedSet.has(fullRevealRegionId) &&
    sourceRgba?.length === width * height * 4
  ) {
    return new Uint8Array(sourceRgba);
  }

  const output = new Uint8Array(width * height * 4);

  for (const crop of cropSources) {
    if (!revealedSet.has(crop.regionId)) continue;
    const source = crop.rgba;
    for (let index = 0; index < width * height; index += 1) {
      const offset = index * 4;
      const alpha = source[offset + 3];
      if (alpha <= output[offset + 3]) continue;
      output[offset] = source[offset];
      output[offset + 1] = source[offset + 1];
      output[offset + 2] = source[offset + 2];
      output[offset + 3] = alpha;
    }
  }

  return output;
}

export function createRevealLayerTextureFromData(rgbaData, width, height) {
  const texture = new THREE.DataTexture(rgbaData, width, height, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.flipY = true;
  texture.needsUpdate = true;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  return texture;
}

export function createEmptyRevealLayerTexture(width, height) {
  return createRevealLayerTextureFromData(
    new Uint8Array(width * height * 4),
    width,
    height
  );
}
