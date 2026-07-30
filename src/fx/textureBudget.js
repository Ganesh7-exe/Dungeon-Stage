import * as THREE from "three";

/** Longest edge for character/GLB textures. 4K maps crush VRAM on Stage. */
export const MAX_CHARACTER_TEXTURE_SIZE = 1024;

const TEXTURE_SLOTS = [
  "map",
  "normalMap",
  "roughnessMap",
  "metalnessMap",
  "aoMap",
  "emissiveMap",
  "bumpMap",
  "displacementMap",
  "alphaMap",
  "lightMap",
  "specularMap",
];

function readImageSize(image) {
  if (!image) return null;
  const width = image.width || image.videoWidth || image.naturalWidth || 0;
  const height = image.height || image.videoHeight || image.naturalHeight || 0;
  if (!(width > 0) || !(height > 0)) return null;
  return { width, height };
}

/**
 * Downscale a Three.js texture in-place when it exceeds `maxSize` on the long
 * edge. Uses a 2D canvas so we free the huge GPU upload before first draw.
 */
export function clampTextureSize(texture, maxSize = MAX_CHARACTER_TEXTURE_SIZE) {
  if (!texture?.isTexture || !texture.image) return false;
  if (texture.isCompressedTexture) return false;
  if (texture.userData?.textureBudgetClamped) return false;

  const size = readImageSize(texture.image);
  if (!size) return false;
  const longest = Math.max(size.width, size.height);
  if (longest <= maxSize) {
    texture.userData = texture.userData || {};
    texture.userData.textureBudgetClamped = true;
    return false;
  }

  const scale = maxSize / longest;
  const nextWidth = Math.max(1, Math.round(size.width * scale));
  const nextHeight = Math.max(1, Math.round(size.height * scale));

  try {
    const canvas = document.createElement("canvas");
    canvas.width = nextWidth;
    canvas.height = nextHeight;
    const context = canvas.getContext("2d", { alpha: true });
    if (!context) return false;
    context.drawImage(texture.image, 0, 0, nextWidth, nextHeight);
    texture.image = canvas;
    texture.needsUpdate = true;
    texture.generateMipmaps = true;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.userData = texture.userData || {};
    texture.userData.textureBudgetClamped = true;
    texture.userData.textureBudgetFrom = `${size.width}x${size.height}`;
    return true;
  } catch (error) {
    console.warn("Texture budget clamp failed", error);
    return false;
  }
}

/** Walk a material and clamp every image map slot. */
export function clampMaterialTextures(
  material,
  maxSize = MAX_CHARACTER_TEXTURE_SIZE
) {
  if (!material) return 0;
  let clamped = 0;
  for (const slot of TEXTURE_SLOTS) {
    const texture = material[slot];
    if (texture?.isTexture && clampTextureSize(texture, maxSize)) {
      clamped += 1;
    }
  }
  return clamped;
}

/** Clamp every texture on every mesh under `root`. */
export function clampObjectTextures(
  root,
  maxSize = MAX_CHARACTER_TEXTURE_SIZE
) {
  if (!root) return 0;
  let clamped = 0;
  root.traverse((object) => {
    if (!object.isMesh) return;
    const materials = Array.isArray(object.material)
      ? object.material
      : [object.material];
    for (const material of materials) {
      clamped += clampMaterialTextures(material, maxSize);
    }
  });
  return clamped;
}

/**
 * Drop and dispose texture maps that a silhouette look no longer needs.
 * Void-black only tints albedo slightly — sampling 4K maps is pure waste.
 */
export function stripMaterialMaps(material, { keepColorMap = false } = {}) {
  if (!material) return;
  for (const slot of TEXTURE_SLOTS) {
    if (keepColorMap && slot === "map") continue;
    const texture = material[slot];
    if (!texture?.isTexture) continue;
    material[slot] = null;
    texture.dispose?.();
  }
  material.needsUpdate = true;
}

/** Dispose geometry + materials + any attached textures. */
export function disposeObjectResources(root) {
  if (!root) return;
  root.traverse((object) => {
    if (!object.isMesh) return;
    object.geometry?.dispose?.();
    const materials = Array.isArray(object.material)
      ? object.material
      : [object.material];
    for (const material of materials) {
      if (!material) continue;
      for (const slot of TEXTURE_SLOTS) {
        material[slot]?.dispose?.();
      }
      material.dispose?.();
    }
  });
}
