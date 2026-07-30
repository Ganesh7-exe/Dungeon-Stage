import * as THREE from "three";

/**
 * Soft blob shadow pinned under each actor.
 *
 * This is the single strongest depth cue available: without a dark patch where
 * the model meets the surface, the brain refuses to read it as standing on
 * anything. A blob is used alongside real shadow mapping rather than instead of
 * it, because a projected shadow map can land at a grazing angle and wash out,
 * whereas the blob is guaranteed to be under the feet.
 */

const SHADOW_TEXTURE_SIZE = 128;
let sharedShadowTexture = null;

function createRadialFalloffTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = SHADOW_TEXTURE_SIZE;
  canvas.height = SHADOW_TEXTURE_SIZE;
  const context = canvas.getContext("2d");
  const centre = SHADOW_TEXTURE_SIZE / 2;

  const gradient = context.createRadialGradient(
    centre,
    centre,
    0,
    centre,
    centre,
    centre
  );
  gradient.addColorStop(0, "rgba(0, 0, 0, 1)");
  gradient.addColorStop(0.45, "rgba(0, 0, 0, 0.6)");
  gradient.addColorStop(0.75, "rgba(0, 0, 0, 0.18)");
  gradient.addColorStop(1, "rgba(0, 0, 0, 0)");

  context.fillStyle = gradient;
  context.fillRect(0, 0, SHADOW_TEXTURE_SIZE, SHADOW_TEXTURE_SIZE);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.NoColorSpace;
  return texture;
}

function getSharedShadowTexture() {
  if (!sharedShadowTexture) {
    sharedShadowTexture = createRadialFalloffTexture();
  }
  return sharedShadowTexture;
}

export function createContactShadow() {
  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({
      map: getSharedShadowTexture(),
      transparent: true,
      opacity: 0.7,
      depthWrite: false,
      color: 0x000000,
    })
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.006;
  shadow.scale.setScalar(0.9);
  shadow.name = "contact-shadow";
  shadow.renderOrder = 1;
  shadow.raycast = () => {};
  return shadow;
}

/**
 * Widen and fade the blob as the actor rises, matching how a real shadow
 * loosens when its caster lifts off the surface.
 */
export function updateContactShadow(shadow, { strength, elevation = 0, footprint = 0.9 }) {
  if (!shadow) return;
  const liftFalloff = 1 / (1 + Math.max(0, elevation) * 1.6);
  shadow.visible = strength > 0.001;
  shadow.material.opacity = strength * liftFalloff;
  shadow.scale.setScalar(footprint * (1 + Math.max(0, elevation) * 0.55));
}
