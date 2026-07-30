import * as THREE from "three";
import { stripMaterialMaps } from "./textureBudget.js";

/**
 * Per-character looks / attached FX applied after a GLB (or procedural) loads.
 *
 * Two things make this fiddly and are worth stating once:
 *
 * 1. Materials are mutated in place, never cloned. `Material.clone()` drops the
 *    per-instance `onBeforeCompile` that the rim light installs, so cloning
 *    would silently kill the silhouette edge that makes a creature read on a
 *    projector.
 * 2. All FX geometry is built in the model root's LOCAL space. The FX group is a
 *    child of that root, so anything authored in world units would get the
 *    root's normalize-scale applied a second time and collapse to a speck.
 */

const VOID_LOOK_PROFILES = {
  /**
   * Previous flat silhouette — set ACTIVE_VOID_LOOK_PROFILE to this string to
   * restore the pure-black demon if the gothic pass looks wrong.
   */
  "flat-black": {
    albedo: 0x02030a,
    mapTint: 0.03,
    emissive: 0x000000,
    emissiveIntensity: 0,
    roughness: 1,
    metalness: 0,
    envMapIntensity: 0,
    ridgeShader: false,
  },
  /**
   * Curse-of-Strahd / Death House reference: deep navy body, cool blue edge
   * catch, faint ribbed sheen so the silhouette reads on a dark stage.
   */
  "gothic-blue": {
    albedo: 0x0a1424,
    mapTint: 0.22,
    emissive: 0x152038,
    emissiveIntensity: 0.35,
    roughness: 0.62,
    metalness: 0.12,
    envMapIntensity: 0.15,
    ridgeShader: true,
    rimColor: 0x9eb6d8,
    rimStrength: 0.55,
    rimPower: 2.8,
    ridgeColor: 0x6a849e,
    ridgeStrength: 0.28,
  },
};

/** Flip to "flat-black" to undo the gothic colour pass in one place. */
const ACTIVE_VOID_LOOK_PROFILE = "gothic-blue";

const VOID_LOOK_KIT_VERSION = "void-eyes-v5-gothic";

const NOISE_GLSL = /* glsl */ `
  float fxHash(vec2 point) {
    return fract(sin(dot(point, vec2(127.1, 311.7))) * 43758.5453123);
  }

  float fxNoise(vec2 point) {
    vec2 cell = floor(point);
    vec2 fraction = fract(point);
    float cornerA = fxHash(cell);
    float cornerB = fxHash(cell + vec2(1.0, 0.0));
    float cornerC = fxHash(cell + vec2(0.0, 1.0));
    float cornerD = fxHash(cell + vec2(1.0, 1.0));
    vec2 blend = fraction * fraction * (3.0 - 2.0 * fraction);
    return mix(mix(cornerA, cornerB, blend.x), mix(cornerC, cornerD, blend.x), blend.y);
  }

  float fxFbm(vec2 point) {
    float total = 0.0;
    float amplitude = 0.55;
    for (int octave = 0; octave < 3; octave++) {
      total += fxNoise(point) * amplitude;
      point *= 2.03;
      amplitude *= 0.5;
    }
    return total;
  }
`;

/** Local-unit offsets have to be scaled to world units inside the shaders. */
const BILLBOARD_GLSL = /* glsl */ `
  float fxModelScale() {
    return length(modelMatrix[0].xyz);
  }

  vec3 fxCameraRight() {
    return normalize(vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]));
  }

  vec3 fxCameraUp() {
    return normalize(vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]));
  }
`;

function forEachMeshMaterial(root, callback) {
  root.traverse((object) => {
    if (!object.isMesh || !object.material) return;
    const materials = Array.isArray(object.material)
      ? object.material
      : [object.material];
    for (const material of materials) {
      if (material) callback(material, object);
    }
  });
}

/** Chain onto any existing injection (rim light) instead of replacing it. */
function chainOnBeforeCompile(material, injector, cacheKey) {
  const previousCompile = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    previousCompile?.call(material, shader, renderer);
    injector(shader);
  };
  const previousCacheKey = material.customProgramCacheKey;
  material.customProgramCacheKey = () =>
    `${previousCacheKey ? previousCacheKey.call(material) : ""}|${cacheKey}`;
  material.needsUpdate = true;
}

/** Bounds in the root's own local space (see note 2 at the top of the file). */
function computeLocalBounds(root) {
  root.updateMatrixWorld(true);
  const worldBounds = new THREE.Box3().setFromObject(root);
  const rootInverse = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const bounds = worldBounds.clone().applyMatrix4(rootInverse);
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  const worldSize = new THREE.Vector3();
  bounds.getSize(size);
  bounds.getCenter(center);
  worldBounds.getSize(worldSize);
  return { bounds, size, center, worldSize };
}

function createInstancedQuad(instanceCount, { centered = false } = {}) {
  const geometry = new THREE.InstancedBufferGeometry();
  const bottom = centered ? -0.5 : 0;
  const top = centered ? 0.5 : 1;
  geometry.setAttribute(
    "position",
    new THREE.BufferAttribute(
      // prettier-ignore
      new Float32Array([
        -0.5, bottom, 0,
         0.5, bottom, 0,
         0.5, top,    0,
        -0.5, top,    0,
      ]),
      3
    )
  );
  geometry.setAttribute(
    "uv",
    new THREE.BufferAttribute(
      new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
      2
    )
  );
  geometry.setIndex([0, 1, 2, 2, 3, 0]);
  geometry.instanceCount = instanceCount;
  return geometry;
}

/**
 * Sample the mesh into the root's local space. Shared by head anchoring and
 * forward detection so we only walk the geometry once.
 */
function sampleLocalPoints(root) {
  root.updateMatrixWorld(true);
  const rootInverse = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const sample = new THREE.Vector3();
  const points = [];
  let minY = Infinity;
  let maxY = -Infinity;

  root.traverse((object) => {
    if (!object.isMesh) return;
    const positions = object.geometry?.attributes?.position;
    if (!positions) return;
    const stride = Math.max(1, Math.floor(positions.count / 2500));
    for (let index = 0; index < positions.count; index += stride) {
      sample
        .fromBufferAttribute(positions, index)
        .applyMatrix4(object.matrixWorld)
        .applyMatrix4(rootInverse);
      points.push(sample.clone());
      if (sample.y < minY) minY = sample.y;
      if (sample.y > maxY) maxY = sample.y;
    }
  });

  return { points, minY, maxY };
}

/**
 * Guess which way the model faces in local XZ.
 *
 * Hunched Tripo meshes lean their head toward the *back* of the crouch, so
 * head→feet lean is a trap. Facial detail is denser, so the head-band
 * hemisphere with more samples is treated as the face.
 */
function detectLocalForward(band, headCenter) {
  let sumX = 0;
  let sumZ = 0;
  for (const point of band) {
    sumX += Math.abs(point.x - headCenter.x);
    sumZ += Math.abs(point.z - headCenter.z);
  }
  const useZ = sumZ >= sumX;
  let towardPositive = 0;
  let towardNegative = 0;
  for (const point of band) {
    const along = useZ
      ? point.z - headCenter.z
      : point.x - headCenter.x;
    if (along >= 0) towardPositive += 1;
    else towardNegative += 1;
  }
  const positiveIsFace = towardPositive >= towardNegative;
  if (useZ) return new THREE.Vector3(0, 0, positiveIsFace ? 1 : -1);
  return new THREE.Vector3(positiveIsFace ? 1 : -1, 0, 0);
}

/**
 * Head center + local face direction for eye placement.
 *
 * Face distance must be near the *surface* (high percentile of front-half
 * samples). Using the median buries the eyes inside the opaque skull where
 * depth testing makes them invisible from every angle.
 */
function computeHeadAnchor(root, faceForwardOverride = null) {
  const { points, minY, maxY } = sampleLocalPoints(root);
  if (!points.length) return null;

  const height = Math.max(1e-4, maxY - minY);
  // Skip the very tip so horns / shadow wisps don't drag the anchor upward.
  let band = points.filter(
    (point) => point.y <= maxY - height * 0.07 && point.y >= maxY - height * 0.24
  );
  if (band.length < 12) {
    band = points.filter((point) => point.y >= maxY - height * 0.32);
  }
  if (!band.length) return null;

  const center = new THREE.Vector3();
  for (const point of band) center.add(point);
  center.divideScalar(band.length);

  let radius = 0;
  for (const point of band) {
    radius = Math.max(
      radius,
      Math.hypot(point.x - center.x, point.z - center.z)
    );
  }
  radius = Math.max(height * 0.02, radius * 0.7);

  let forward;
  if (Array.isArray(faceForwardOverride) && faceForwardOverride.length >= 3) {
    forward = new THREE.Vector3(
      faceForwardOverride[0],
      faceForwardOverride[1],
      faceForwardOverride[2]
    );
    forward.y = 0;
    if (forward.lengthSq() < 1e-6) forward.set(0, 0, 1);
    else forward.normalize();
  } else {
    forward = detectLocalForward(band, center);
  }

  const right = new THREE.Vector3()
    .crossVectors(new THREE.Vector3(0, 1, 0), forward)
    .normalize();
  if (right.lengthSq() < 1e-6) right.set(1, 0, 0);

  // Surface distance: high percentile of front-half samples (not the median).
  const faceHits = [];
  for (const point of band) {
    const along =
      (point.x - center.x) * forward.x + (point.z - center.z) * forward.z;
    if (along > 0) faceHits.push(along);
  }
  faceHits.sort((a, b) => a - b);
  const faceDistance =
    faceHits.length > 0
      ? faceHits[Math.floor(faceHits.length * 0.92)]
      : radius * 0.85;

  return {
    center,
    radius,
    height,
    forward,
    right,
    faceDistance: Math.max(faceDistance, radius * 0.55),
  };
}

/**
 * AABB fallback when vertex sampling fails — still puts visible white eyes
 * on a face of the bounds rather than returning null and leaving a blank demon.
 */
function computeBoundsEyeAnchor(root, faceForwardOverride = null) {
  root.updateMatrixWorld(true);
  const worldBounds = new THREE.Box3().setFromObject(root);
  const rootInverse = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const bounds = worldBounds.clone().applyMatrix4(rootInverse);
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  bounds.getSize(size);
  bounds.getCenter(center);

  let forward = new THREE.Vector3(0, 0, 1);
  if (Array.isArray(faceForwardOverride) && faceForwardOverride.length >= 3) {
    forward.set(
      faceForwardOverride[0],
      faceForwardOverride[1],
      faceForwardOverride[2]
    );
    forward.y = 0;
    if (forward.lengthSq() < 1e-6) forward.set(0, 0, 1);
    else forward.normalize();
  }

  const right = new THREE.Vector3()
    .crossVectors(new THREE.Vector3(0, 1, 0), forward)
    .normalize();
  if (right.lengthSq() < 1e-6) right.set(1, 0, 0);

  const faceDistance =
    Math.abs(forward.x) * size.x * 0.48 + Math.abs(forward.z) * size.z * 0.48;

  return {
    center: new THREE.Vector3(center.x, bounds.min.y + size.y * 0.78, center.z),
    radius: Math.max(size.x, size.z) * 0.35,
    height: size.y,
    forward,
    right,
    faceDistance,
  };
}

/**
 * Two clean white eyes on the face. Spheres stay visible regardless of disc
 * winding; depth test hides them when the head turns away.
 */
function createHeadEyeGlows(anchor) {
  const group = new THREE.Group();
  group.name = "void-black-eyes";

  const eyeSpread = THREE.MathUtils.clamp(
    anchor.radius * 0.14,
    anchor.height * 0.012,
    anchor.height * 0.028
  );
  const eyeRadius = THREE.MathUtils.clamp(
    anchor.height * 0.012,
    0.006,
    anchor.height * 0.016
  );
  // Sit on the outer face surface (see computeHeadAnchor percentile note).
  const surfaceOffset = anchor.faceDistance * 1.02;
  const outward = anchor.forward.clone().normalize();

  const eyeMaterial = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    depthTest: true,
    depthWrite: true,
  });
  const eyeGeometry = new THREE.SphereGeometry(eyeRadius, 16, 16);
  const disposables = [eyeGeometry, eyeMaterial];

  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(eyeGeometry, eyeMaterial);
    eye.name = "void-black-eye";
    eye.position
      .copy(anchor.center)
      .addScaledVector(outward, surfaceOffset)
      .addScaledVector(anchor.right, side * eyeSpread);
    eye.castShadow = false;
    eye.receiveShadow = false;
    eye.renderOrder = 2;
    group.add(eye);
  }

  return {
    group,
    update() {},
    dispose() {
      group.parent?.remove(group);
      for (const resource of disposables) resource.dispose();
    },
  };
}

/**
 * Cool fresnel rim + faint horizontal ribbing, matching the Death House
 * reference where the body is dark but edges and ridges catch blue light.
 * Chained after rim-light so both injections survive.
 */
function applyGothicRidgeShader(material, profile) {
  if (!profile.ridgeShader || material.userData.gothicRidge) return;
  material.userData.gothicRidge = true;

  const rimColor = new THREE.Color(profile.rimColor);
  const ridgeColor = new THREE.Color(profile.ridgeColor);

  chainOnBeforeCompile(
    material,
    (shader) => {
      shader.uniforms.uGothicRimColor = { value: rimColor };
      shader.uniforms.uGothicRimStrength = { value: profile.rimStrength };
      shader.uniforms.uGothicRimPower = { value: profile.rimPower };
      shader.uniforms.uGothicRidgeColor = { value: ridgeColor };
      shader.uniforms.uGothicRidgeStrength = { value: profile.ridgeStrength };

      shader.vertexShader = shader.vertexShader
        .replace(
          "void main() {",
          /* glsl */ `
          varying vec3 vGothicWorldNormal;
          varying vec3 vGothicWorldPosition;
          void main() {
          `
        )
        .replace(
          "#include <beginnormal_vertex>",
          /* glsl */ `
          #include <beginnormal_vertex>
          vGothicWorldNormal = normalize(mat3(modelMatrix) * objectNormal);
          `
        )
        .replace(
          "#include <begin_vertex>",
          /* glsl */ `
          #include <begin_vertex>
          vGothicWorldPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;
          `
        );

      shader.fragmentShader = shader.fragmentShader
        .replace(
          "void main() {",
          /* glsl */ `
          uniform vec3 uGothicRimColor;
          uniform float uGothicRimStrength;
          uniform float uGothicRimPower;
          uniform vec3 uGothicRidgeColor;
          uniform float uGothicRidgeStrength;
          varying vec3 vGothicWorldNormal;
          varying vec3 vGothicWorldPosition;
          ${NOISE_GLSL}
          void main() {
          `
        )
        .replace(
          "#include <emissivemap_fragment>",
          /* glsl */ `
          #include <emissivemap_fragment>
          vec3 gothicView = normalize(cameraPosition - vGothicWorldPosition);
          vec3 gothicNormal = normalize(vGothicWorldNormal);
          float gothicFresnel = pow(
            1.0 - saturate(dot(gothicNormal, gothicView)),
            uGothicRimPower
          );
          totalEmissiveRadiance += uGothicRimColor * gothicFresnel * uGothicRimStrength;

          // Soft horizontal ribs — catches light like the striated torso in the ref.
          float ribs = fxNoise(vec2(
            vGothicWorldPosition.x * 6.0 + vGothicWorldPosition.z * 6.0,
            vGothicWorldPosition.y * 18.0
          ));
          float ribMask = smoothstep(0.42, 0.62, ribs) * (0.35 + gothicFresnel);
          totalEmissiveRadiance += uGothicRidgeColor * ribMask * uGothicRidgeStrength;
          `
        );
    },
    "gothic-ridge-v1"
  );
}

/** Matte / gothic shadow silhouette with face-anchored white eyes. */
export function applyVoidBlackLook(root, options = {}) {
  const profileName =
    options.profile || ACTIVE_VOID_LOOK_PROFILE || "flat-black";
  const profile =
    VOID_LOOK_PROFILES[profileName] || VOID_LOOK_PROFILES["flat-black"];
  const albedo = new THREE.Color(profile.albedo);

  forEachMeshMaterial(root, (material) => {
    // Silhouette doesn't need 4K albedo/normal/ORM — drop them to free VRAM.
    stripMaterialMaps(material, { keepColorMap: false });
    if (material.color) material.color.copy(albedo);
    if ("emissive" in material) {
      material.emissive?.set?.(profile.emissive);
      material.emissiveIntensity = profile.emissiveIntensity;
    }
    if ("roughness" in material) material.roughness = profile.roughness;
    if ("metalness" in material) material.metalness = profile.metalness;
    if ("envMapIntensity" in material) {
      material.envMapIntensity = profile.envMapIntensity;
    }
    material.transparent = false;
    material.opacity = 1;
    material.side = THREE.FrontSide;
    material.needsUpdate = true;
    if (profile.ridgeShader) {
      applyGothicRidgeShader(material, profile);
    }
  });

  // Drop any previous eye kit so re-applying the look after a hot reload
  // (or a forced model refresh) doesn't stack duplicates.
  const previousEyes = root.getObjectByName("void-black-eyes");
  if (previousEyes) {
    previousEyes.parent?.remove(previousEyes);
    previousEyes.traverse((object) => {
      object.geometry?.dispose?.();
      object.material?.dispose?.();
    });
  }

  const anchor =
    computeHeadAnchor(root, options.faceForward ?? null) ||
    computeBoundsEyeAnchor(root, options.faceForward ?? null);
  if (!anchor) return null;

  const eyes = createHeadEyeGlows(anchor);
  root.add(eyes.group);
  root.userData.lookKitVersion = VOID_LOOK_KIT_VERSION;
  root.userData.voidLookProfile = profileName;
  return eyes;
}

export function applyCharacterLook(root, lookId, options = {}) {
  if (!lookId || !root) return null;
  if (lookId === "void-black") return applyVoidBlackLook(root, options);
  return null;
}

/**
 * Thin animated lava cracks keyed to each mesh's own object space, so the
 * pattern stays glued to the surface and stays hairline at any actor scale.
 */
function applyMoltenVeins(root, timeUniform) {
  forEachMeshMaterial(root, (material, mesh) => {
    if (material.userData.moltenVeins) return;
    material.userData.moltenVeins = true;

    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    const localSize = new THREE.Vector3();
    mesh.geometry.boundingBox.getSize(localSize);
    const largest = Math.max(localSize.x, localSize.y, localSize.z, 1e-4);
    // ~34 crack cells across the mesh keeps veins hairline instead of blotchy.
    const veinScale = 34 / largest;

    // Keep the creature a dark silhouette; the glow must come from the cracks.
    if (material.color) material.color.multiplyScalar(0.16);
    if ("emissive" in material) {
      material.emissive.set(0x160200);
      material.emissiveIntensity = 1;
    }
    if ("roughness" in material) {
      material.roughness = Math.min(material.roughness ?? 0.7, 0.7);
    }

    chainOnBeforeCompile(
      material,
      (shader) => {
        shader.uniforms.uFireTime = timeUniform;
        shader.uniforms.uVeinScale = { value: veinScale };

        shader.vertexShader = shader.vertexShader
          .replace(
            "void main() {",
            /* glsl */ `
            varying vec3 vFireLocalPosition;
            void main() {
            `
          )
          .replace(
            "#include <begin_vertex>",
            /* glsl */ `
            #include <begin_vertex>
            vFireLocalPosition = position;
            `
          );

        shader.fragmentShader = shader.fragmentShader
          .replace(
            "void main() {",
            /* glsl */ `
            uniform float uFireTime;
            uniform float uVeinScale;
            varying vec3 vFireLocalPosition;
            ${NOISE_GLSL}

            float fireVeins(vec3 localPosition) {
              vec2 plane = localPosition.xz * uVeinScale + localPosition.y * uVeinScale * 0.6;
              float warp = fxNoise(plane * 0.4 + uFireTime * 0.22);
              float ridge = abs(fxNoise(plane + warp * 1.7) - 0.5);
              float cracks = 1.0 - smoothstep(0.0, 0.05, ridge);
              float pulse = 0.5 + 0.5 * sin(uFireTime * 3.2 + localPosition.y * uVeinScale * 0.7);
              return cracks * pulse;
            }

            void main() {
            `
          )
          .replace(
            "#include <emissivemap_fragment>",
            /* glsl */ `
            #include <emissivemap_fragment>
            float veins = fireVeins(vFireLocalPosition);
            totalEmissiveRadiance += vec3(1.0, 0.15, 0.02) * veins * 1.15;
            totalEmissiveRadiance += vec3(1.0, 0.55, 0.12) * pow(veins, 3.0) * 0.7;
            `
          );
      },
      "molten-veins-v5"
    );
  });
}

/**
 * Billboarded flame tongues. Quads stay vertical in world space but rotate to
 * face the camera, which is what makes a particle cloud read as actual fire
 * rather than a glowing blob.
 */
function createFlameTongues({ bounds, size, center, vertical }) {
  const instanceCount = 8;
  const geometry = createInstancedQuad(instanceCount);

  const anchors = new Float32Array(instanceCount * 3);
  const scales = new Float32Array(instanceCount * 2);
  const seeds = new Float32Array(instanceCount);
  const bodyRadius = Math.max(size.x, size.z) * 0.5;

  for (let index = 0; index < instanceCount; index += 1) {
    const isCore = index < 5;
    const angle = (index / instanceCount) * Math.PI * 2 + Math.random() * 0.5;
    const radius = isCore
      ? bodyRadius * (0.04 + Math.random() * 0.22)
      : bodyRadius * (0.28 + Math.random() * 0.45);

    anchors[index * 3] = center.x + Math.cos(angle) * radius;
    anchors[index * 3 + 1] =
      bounds.min.y + size.y * (isCore ? 0.18 : 0.04 + Math.random() * 0.22);
    anchors[index * 3 + 2] = center.z + Math.sin(angle) * radius;

    const flameHeight =
      vertical * (isCore ? 0.7 + Math.random() * 0.35 : 0.35 + Math.random() * 0.35);
    scales[index * 2] = flameHeight * (0.32 + Math.random() * 0.18);
    scales[index * 2 + 1] = flameHeight;
    seeds[index] = Math.random();
  }

  geometry.setAttribute(
    "flameAnchor",
    new THREE.InstancedBufferAttribute(anchors, 3)
  );
  geometry.setAttribute(
    "flameScale",
    new THREE.InstancedBufferAttribute(scales, 2)
  );
  geometry.setAttribute(
    "flameSeed",
    new THREE.InstancedBufferAttribute(seeds, 1)
  );

  const timeUniform = { value: 0 };
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: { time: timeUniform },
    vertexShader: /* glsl */ `
      attribute vec3 flameAnchor;
      attribute vec2 flameScale;
      attribute float flameSeed;
      uniform float time;
      varying vec2 vUv;
      varying float vSeed;
      ${BILLBOARD_GLSL}

      void main() {
        vUv = uv;
        vSeed = flameSeed;

        float modelScale = fxModelScale();
        vec3 anchorWorld = (modelMatrix * vec4(flameAnchor, 1.0)).xyz;
        vec3 cameraRight = fxCameraRight();
        vec3 worldUp = vec3(0.0, 1.0, 0.0);

        float breathe = 0.84 + 0.16 * sin(time * 5.5 + flameSeed * 24.0);
        float sway = sin(time * 2.6 + flameSeed * 18.0);
        float lean = sway * flameScale.x * 0.35 * uv.y * uv.y;

        vec3 worldPosition =
          anchorWorld +
          cameraRight * ((position.x * flameScale.x + lean) * modelScale) +
          worldUp * (position.y * flameScale.y * breathe * modelScale);

        gl_Position = projectionMatrix * viewMatrix * vec4(worldPosition, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform float time;
      varying vec2 vUv;
      varying float vSeed;
      ${NOISE_GLSL}

      void main() {
        vec2 uv = vUv;

        // Narrow toward the tip and cut in from the sides.
        float width = mix(1.0, 0.2, pow(uv.y, 0.7));
        float centerDist = abs(uv.x - 0.5) * 2.0;
        float horizontal = 1.0 - smoothstep(width * 0.3, width, centerDist);

        float flow = fxFbm(
          vec2(uv.x * 2.6 + vSeed * 31.0, uv.y * 2.0 - time * 1.9 + vSeed * 7.0)
        );
        float lick = fxFbm(vec2(uv.x * 6.5 - vSeed * 5.0, uv.y * 4.2 - time * 3.2));

        float flame = horizontal * (0.5 + flow * 0.95 + lick * 0.22);
        flame -= pow(uv.y, 1.1) * 0.92;
        flame = smoothstep(0.05, 0.6, flame);
        if (flame < 0.015) discard;

        vec3 deepRed = vec3(1.0, 0.06, 0.0);
        vec3 orange = vec3(1.0, 0.38, 0.04);
        vec3 core = vec3(1.0, 0.82, 0.45);

        vec3 color = mix(deepRed, orange, flame);
        color = mix(color, core, pow(flame, 3.0) * smoothstep(0.45, 0.0, uv.y) * 0.65);

        gl_FragColor = vec4(color, flame * mix(0.55, 0.12, uv.y));
      }
    `,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "character-flame-tongues";
  mesh.frustumCulled = false;
  mesh.renderOrder = 5;
  mesh.raycast = () => {};
  return { object: mesh, geometry, material, timeUniform };
}

/** Rising sparks that sell the fire as a live, looping effect. */
function createEmbers({ bounds, size, center, vertical }) {
  const instanceCount = 28;
  const geometry = createInstancedQuad(instanceCount, { centered: true });

  const seeds = new Float32Array(instanceCount * 4);
  for (let index = 0; index < instanceCount; index += 1) {
    seeds[index * 4] = Math.random();
    seeds[index * 4 + 1] = Math.random();
    seeds[index * 4 + 2] = Math.random();
    seeds[index * 4 + 3] = Math.random();
  }
  geometry.setAttribute(
    "emberSeed",
    new THREE.InstancedBufferAttribute(seeds, 4)
  );

  const timeUniform = { value: 0 };
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      time: timeUniform,
      baseY: { value: bounds.min.y + size.y * 0.12 },
      riseHeight: { value: vertical * 1.15 },
      spreadRadius: { value: Math.max(size.x, size.z) * 0.4 },
      emberSize: { value: vertical * 0.028 },
      centerX: { value: center.x },
      centerZ: { value: center.z },
    },
    vertexShader: /* glsl */ `
      attribute vec4 emberSeed;
      uniform float time;
      uniform float baseY;
      uniform float riseHeight;
      uniform float spreadRadius;
      uniform float emberSize;
      uniform float centerX;
      uniform float centerZ;
      varying vec2 vCorner;
      varying float vLife;
      ${BILLBOARD_GLSL}

      void main() {
        vCorner = position.xy * 2.0;

        float cycle = 1.1 + emberSeed.w * 1.6;
        float life = fract(time * (0.6 + emberSeed.x * 0.8) / cycle + emberSeed.y);
        vLife = life;

        float angle = emberSeed.z * 6.2831853 + time * (0.45 + emberSeed.x);
        float spread = spreadRadius * mix(0.2, 1.0, life) * (0.4 + emberSeed.y * 0.8);
        float wobble = sin(time * 6.0 + emberSeed.x * 30.0) * spreadRadius * 0.12 * life;

        vec3 localCenter = vec3(
          centerX + cos(angle) * spread + wobble,
          baseY + life * riseHeight,
          centerZ + sin(angle) * spread
        );

        float modelScale = fxModelScale();
        vec3 worldCenter = (modelMatrix * vec4(localCenter, 1.0)).xyz;
        float sizeNow = emberSize * mix(1.0, 0.25, life) * (0.7 + emberSeed.w * 0.7);
        vec3 worldPosition =
          worldCenter +
          fxCameraRight() * position.x * sizeNow * modelScale +
          fxCameraUp() * position.y * sizeNow * modelScale;

        gl_Position = projectionMatrix * viewMatrix * vec4(worldPosition, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      varying vec2 vCorner;
      varying float vLife;

      void main() {
        float dist = length(vCorner);
        if (dist > 1.0) discard;
        float soft = smoothstep(1.0, 0.1, dist);
        float fade = pow(1.0 - vLife, 1.4) * soft;
        if (fade < 0.012) discard;
        vec3 color = mix(vec3(1.0, 0.88, 0.5), vec3(1.0, 0.18, 0.02), vLife);
        gl_FragColor = vec4(color, fade);
      }
    `,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "character-fire-embers";
  mesh.frustumCulled = false;
  mesh.renderOrder = 6;
  mesh.raycast = () => {};
  return { object: mesh, geometry, material, timeUniform };
}

/**
 * Dull red heat haze around the body. Additive because a projector can only add
 * light — dark smoke would just punch a hole in the projected map.
 */
function createHeatHaze({ bounds, size, center, vertical }) {
  const instanceCount = 24;
  const geometry = createInstancedQuad(instanceCount, { centered: true });

  const seeds = new Float32Array(instanceCount * 4);
  for (let index = 0; index < instanceCount; index += 1) {
    seeds[index * 4] = Math.random();
    seeds[index * 4 + 1] = Math.random();
    seeds[index * 4 + 2] = Math.random();
    seeds[index * 4 + 3] = Math.random();
  }
  geometry.setAttribute(
    "hazeSeed",
    new THREE.InstancedBufferAttribute(seeds, 4)
  );

  const timeUniform = { value: 0 };
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      time: timeUniform,
      baseY: { value: bounds.min.y + size.y * 0.2 },
      riseHeight: { value: vertical * 0.95 },
      spreadRadius: { value: Math.max(size.x, size.z) * 0.55 },
      hazeSize: { value: vertical * 0.35 },
      centerX: { value: center.x },
      centerZ: { value: center.z },
    },
    vertexShader: /* glsl */ `
      attribute vec4 hazeSeed;
      uniform float time;
      uniform float baseY;
      uniform float riseHeight;
      uniform float spreadRadius;
      uniform float hazeSize;
      uniform float centerX;
      uniform float centerZ;
      varying vec2 vCorner;
      varying float vLife;
      ${BILLBOARD_GLSL}

      void main() {
        vCorner = position.xy * 2.0;

        float life = fract(time * 0.18 + hazeSeed.y);
        vLife = life;

        float angle = hazeSeed.z * 6.2831853 + time * 0.15;
        float spread = spreadRadius * (0.3 + life * 0.9);
        vec3 localCenter = vec3(
          centerX + cos(angle) * spread,
          baseY + life * riseHeight,
          centerZ + sin(angle) * spread
        );

        float modelScale = fxModelScale();
        vec3 worldCenter = (modelMatrix * vec4(localCenter, 1.0)).xyz;
        float sizeNow = hazeSize * mix(0.8, 1.8, life) * (0.7 + hazeSeed.w * 0.6);
        vec3 worldPosition =
          worldCenter +
          fxCameraRight() * position.x * sizeNow * modelScale +
          fxCameraUp() * position.y * sizeNow * modelScale;

        gl_Position = projectionMatrix * viewMatrix * vec4(worldPosition, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      varying vec2 vCorner;
      varying float vLife;

      void main() {
        float dist = length(vCorner);
        if (dist > 1.0) discard;
        float soft = smoothstep(1.0, 0.05, dist);
        float alpha = soft * 0.04 * (1.0 - vLife);
        if (alpha < 0.005) discard;
        gl_FragColor = vec4(vec3(0.6, 0.08, 0.02), alpha);
      }
    `,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "character-heat-haze";
  mesh.frustumCulled = false;
  mesh.renderOrder = 4;
  mesh.raycast = () => {};
  return { object: mesh, geometry, material, timeUniform };
}

/** Full fire kit: molten veins, flame tongues, embers, heat haze, warm light. */
export function createFireAura(root) {
  const { bounds, size, center, worldSize } = computeLocalBounds(root);

  // Keep flames close to the body — footprint was overpowering a wide spider.
  const vertical = Math.max(size.y, Math.max(size.x, size.z) * 0.28);
  const metrics = { bounds, size, center, vertical };

  const veinTimeUniform = { value: 0 };
  applyMoltenVeins(root, veinTimeUniform);

  const group = new THREE.Group();
  group.name = "character-fire-fx";

  // Skip heat-haze quads — they were mostly fill-rate cost on Stage.
  const layers = [createFlameTongues(metrics), createEmbers(metrics)];
  for (const layer of layers) group.add(layer.object);

  // One warm light (two PointLights were overkill with shadow + projector passes).
  const lightRange = Math.max(worldSize.y * 2.2, 0.55);
  const bodyLight = new THREE.PointLight(0xff5a12, 0.85, lightRange, 1.7);
  bodyLight.position.set(center.x, bounds.min.y + size.y * 0.4, center.z);
  bodyLight.name = "character-fire-light";
  bodyLight.castShadow = false;
  group.add(bodyLight);

  root.add(group);

  return {
    group,
    update(elapsed) {
      veinTimeUniform.value = elapsed;
      for (const layer of layers) layer.timeUniform.value = elapsed;
      bodyLight.intensity = 0.75 + Math.sin(elapsed * 9.0) * 0.2;
    },
    dispose() {
      for (const layer of layers) {
        layer.geometry.dispose();
        layer.material.dispose();
      }
      group.parent?.remove(group);
    },
  };
}

export function attachCharacterFx(root, fxId) {
  if (!root || !fxId) return null;
  if (fxId === "fire") return createFireAura(root);
  return null;
}

/** Fan update/dispose across a look effect plus an attached effect. */
export function combineCharacterFx(effects) {
  const active = effects.filter(Boolean);
  if (!active.length) return null;
  if (active.length === 1) return active[0];
  return {
    update(elapsed) {
      for (const effect of active) effect.update?.(elapsed);
    },
    dispose() {
      for (const effect of active) effect.dispose?.();
    },
  };
}
