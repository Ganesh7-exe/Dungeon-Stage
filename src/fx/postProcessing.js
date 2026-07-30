import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { GTAOPass } from "three/examples/jsm/postprocessing/GTAOPass.js";

/**
 * Post-processing chain shared by every projected face.
 *
 * OutputPass is intentionally omitted: the warp blit uses MeshBasicMaterial,
 * which already goes through the renderer's colour-management path. Running
 * OutputPass first would double-encode and either wash out or crush the image.
 *
 * The vignette at the end of the grade doubles as edge feathering — it softens
 * the boundary of each face's image, which hides the seam where two projected
 * faces meet at a real box edge.
 */

const colourGradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    exposure: { value: 1 },
    contrast: { value: 1 },
    saturation: { value: 1 },
    vignetteStrength: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    precision highp float;

    uniform sampler2D tDiffuse;
    uniform float exposure;
    uniform float contrast;
    uniform float saturation;
    uniform float vignetteStrength;

    varying vec2 vUv;

    void main() {
      vec4 texel = texture2D(tDiffuse, vUv);
      vec3 color = texel.rgb * exposure;
      color = (color - 0.5) * contrast + 0.5;

      float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
      color = mix(vec3(luma), color, saturation);

      float edgeDistance = length(vUv - 0.5);
      color *= 1.0 - smoothstep(0.30, 0.78, edgeDistance) * vignetteStrength;

      gl_FragColor = vec4(clamp(color, 0.0, 1.0), texel.a);
    }
  `,
};

export function createStagePostProcessing(renderer, scene, camera, width, height) {
  // Unsigned byte + sRGB: HalfFloat composer targets blit to black on some
  // software GL stacks (and are unnecessary for this projector pipeline).
  const buffer = new THREE.WebGLRenderTarget(width, height, {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    type: THREE.UnsignedByteType,
    format: THREE.RGBAFormat,
    colorSpace: THREE.SRGBColorSpace,
    depthBuffer: true,
  });
  const composer = new EffectComposer(renderer, buffer);
  composer.renderToScreen = false;
  composer.setSize(width, height);

  const renderPass = new RenderPass(scene, camera);

  const ambientOcclusionPass = new GTAOPass(scene, camera, width, height);
  ambientOcclusionPass.enabled = false;

  const bloomPass = new UnrealBloomPass(
    new THREE.Vector2(width, height),
    0.55,
    0.5,
    0.62
  );

  const gradePass = new ShaderPass(colourGradeShader);

  composer.addPass(renderPass);
  composer.addPass(ambientOcclusionPass);
  composer.addPass(bloomPass);
  composer.addPass(gradePass);

  return {
    composer,
    renderPass,
    ambientOcclusionPass,
    bloomPass,
    gradePass,

    setCamera(nextCamera) {
      renderPass.camera = nextCamera;
      ambientOcclusionPass.camera = nextCamera;
    },

    setSize(nextWidth, nextHeight) {
      composer.setSize(nextWidth, nextHeight);
      bloomPass.setSize(nextWidth, nextHeight);
      ambientOcclusionPass.setSize(nextWidth, nextHeight);
    },

    updateFromState(fxState) {
      bloomPass.enabled = fxState.enabled && fxState.bloomEnabled;
      bloomPass.strength = fxState.bloomStrength;
      bloomPass.radius = fxState.bloomRadius;
      bloomPass.threshold = fxState.bloomThreshold;

      ambientOcclusionPass.enabled =
        fxState.enabled && fxState.ambientOcclusionEnabled;
      ambientOcclusionPass.blendIntensity = fxState.ambientOcclusionStrength;

      const grade = gradePass.uniforms;
      grade.exposure.value = fxState.enabled ? fxState.exposure : 1;
      grade.contrast.value = fxState.enabled ? fxState.contrast : 1;
      grade.saturation.value = fxState.enabled ? fxState.saturation : 1;
      grade.vignetteStrength.value = fxState.enabled ? fxState.vignetteStrength : 0;
    },

    /**
     * Render the FX chain. When `toScreen` is true the last pass writes to the
     * canvas (preview path). Otherwise the graded buffer texture is returned
     * for the projector warp blit.
     */
    render(deltaSeconds, { toScreen = false } = {}) {
      composer.renderToScreen = toScreen;
      composer.render(deltaSeconds);
      composer.renderToScreen = false;
      return composer.readBuffer.texture;
    },

    dispose() {
      composer.dispose();
      bloomPass.dispose?.();
      ambientOcclusionPass.dispose?.();
      gradePass.dispose?.();
    },
  };
}
