/**
 * Configuration for the depth-and-atmosphere stack.
 *
 * The anamorphic frustum supplies correct geometry, but the eye only accepts it
 * as solid when the shading agrees: contact shadows anchor a creature to the
 * surface, rim light separates its silhouette from the black surround, and
 * particles at different depths give motion parallax. These are the cues doing
 * the heavy lifting, so each one is independently tunable on the real rig.
 */

function clampNumber(value, minimum, maximum, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, parsed));
}

function normalizeHexColor(value, fallback) {
  if (typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value)) return value;
  return fallback;
}

export function createDefaultStageFxState() {
  return {
    enabled: true,

    shadowsEnabled: true,
    shadowOpacity: 0.62,
    contactShadowStrength: 0.85,

    bloomEnabled: true,
    bloomStrength: 0.42,
    bloomRadius: 0.45,
    bloomThreshold: 0.68,

    ambientOcclusionEnabled: false,
    ambientOcclusionStrength: 0.6,

    rimEnabled: true,
    rimStrength: 1.05,
    rimPower: 2.2,
    rimColor: "#9fd0ff",

    groundFogEnabled: true,
    groundFogStrength: 0.4,

    embersEnabled: true,
    emberStrength: 0.55,

    dustMotesEnabled: true,
    dustStrength: 0.4,

    vignetteStrength: 0.35,
    saturation: 1.16,
    contrast: 1.1,
    exposure: 1.08,
  };
}

export function normalizeStageFxState(raw = {}) {
  const fallback = createDefaultStageFxState();
  return {
    enabled: raw.enabled !== false,

    shadowsEnabled: raw.shadowsEnabled !== false,
    shadowOpacity: clampNumber(raw.shadowOpacity, 0, 1, fallback.shadowOpacity),
    contactShadowStrength: clampNumber(
      raw.contactShadowStrength,
      0,
      1,
      fallback.contactShadowStrength
    ),

    bloomEnabled: raw.bloomEnabled !== false,
    bloomStrength: clampNumber(raw.bloomStrength, 0, 3, fallback.bloomStrength),
    bloomRadius: clampNumber(raw.bloomRadius, 0, 1.5, fallback.bloomRadius),
    bloomThreshold: clampNumber(raw.bloomThreshold, 0, 1, fallback.bloomThreshold),

    ambientOcclusionEnabled: Boolean(raw.ambientOcclusionEnabled),
    ambientOcclusionStrength: clampNumber(
      raw.ambientOcclusionStrength,
      0,
      2,
      fallback.ambientOcclusionStrength
    ),

    rimEnabled: raw.rimEnabled !== false,
    rimStrength: clampNumber(raw.rimStrength, 0, 3, fallback.rimStrength),
    rimPower: clampNumber(raw.rimPower, 0.5, 8, fallback.rimPower),
    rimColor: normalizeHexColor(raw.rimColor, fallback.rimColor),

    groundFogEnabled: raw.groundFogEnabled !== false,
    groundFogStrength: clampNumber(
      raw.groundFogStrength,
      0,
      1.5,
      fallback.groundFogStrength
    ),

    embersEnabled: raw.embersEnabled !== false,
    emberStrength: clampNumber(raw.emberStrength, 0, 1.5, fallback.emberStrength),

    dustMotesEnabled: raw.dustMotesEnabled !== false,
    dustStrength: clampNumber(raw.dustStrength, 0, 1.5, fallback.dustStrength),

    vignetteStrength: clampNumber(raw.vignetteStrength, 0, 1.5, fallback.vignetteStrength),
    saturation: clampNumber(raw.saturation, 0, 2.5, fallback.saturation),
    contrast: clampNumber(raw.contrast, 0.4, 2.5, fallback.contrast),
    exposure: clampNumber(raw.exposure, 0.2, 3, fallback.exposure),
  };
}
