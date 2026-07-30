import * as THREE from "three";

/**
 * Fresnel rim light injected into existing PBR materials.
 *
 * On a projector the surround is pure black, so an unlit silhouette edge simply
 * vanishes and the creature reads as a flat cut-out. A view-dependent rim
 * restores the edge and is the cheapest way to make a model look like it has a
 * back side. Injecting via onBeforeCompile keeps every GLTF material — its
 * textures, normal maps and vertex skinning — completely intact.
 */

const RIM_DECLARATIONS = /* glsl */ `
  uniform vec3 rimLightColor;
  uniform float rimLightStrength;
  uniform float rimLightPower;
`;

const RIM_CONTRIBUTION = /* glsl */ `
  float rimFacing = 1.0 - saturate( dot( normalize( vViewPosition ), normal ) );
  outgoingLight += rimLightColor * pow( rimFacing, rimLightPower ) * rimLightStrength;
`;

function attachRimLight(material, sharedUniforms) {
  if (material.userData.rimLightAttached) {
    material.userData.rimLightUniforms = sharedUniforms;
    return;
  }

  const previousOnBeforeCompile = material.onBeforeCompile;

  material.onBeforeCompile = (shader, renderer) => {
    previousOnBeforeCompile?.call(material, shader, renderer);

    shader.uniforms.rimLightColor = sharedUniforms.rimLightColor;
    shader.uniforms.rimLightStrength = sharedUniforms.rimLightStrength;
    shader.uniforms.rimLightPower = sharedUniforms.rimLightPower;

    shader.fragmentShader = shader.fragmentShader
      .replace("void main() {", `${RIM_DECLARATIONS}\nvoid main() {`)
      .replace(
        "#include <opaque_fragment>",
        `${RIM_CONTRIBUTION}\n#include <opaque_fragment>`
      );
  };

  material.customProgramCacheKey = () => "rim-light-v1";
  material.userData.rimLightAttached = true;
  material.userData.rimLightUniforms = sharedUniforms;
  material.needsUpdate = true;
}

/**
 * Shared uniform block so a single slider retunes every actor at once without
 * recompiling shaders.
 */
export function createRimLightUniforms() {
  return {
    rimLightColor: { value: new THREE.Color("#8fc4ff") },
    rimLightStrength: { value: 0 },
    rimLightPower: { value: 2.6 },
  };
}

export function applyRimLightToObject(root, sharedUniforms) {
  root.traverse((object) => {
    if (!object.isMesh) return;
    const materials = Array.isArray(object.material)
      ? object.material
      : [object.material];
    for (const material of materials) {
      if (!material || !material.isMeshStandardMaterial) continue;
      attachRimLight(material, sharedUniforms);
    }
  });
}

export function updateRimLightUniforms(sharedUniforms, fxState) {
  const strength = fxState.rimEnabled ? fxState.rimStrength : 0;
  sharedUniforms.rimLightStrength.value = strength;
  sharedUniforms.rimLightPower.value = fxState.rimPower;
  sharedUniforms.rimLightColor.value.set(fxState.rimColor);
}
