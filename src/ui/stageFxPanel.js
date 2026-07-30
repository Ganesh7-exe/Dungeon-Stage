import {
  createCard,
  createColorRow,
  createSliderRow,
  createToggleRow,
  createButtonRow,
} from "./controlBuilders.js";
import {
  createDefaultStageFxState,
  normalizeStageFxState,
} from "../fx/stageFxState.js";

/**
 * Depth and atmosphere controls.
 *
 * Declarative on purpose: each entry names a key in the FX state and the widget
 * that edits it, so adding an effect means adding one row here rather than
 * writing more DOM plumbing.
 */

const SLIDER_DEFINITIONS = [
  {
    key: "contactShadowStrength",
    label: "Contact shadow",
    min: 0,
    max: 1,
    step: 0.01,
  },
  { key: "shadowOpacity", label: "Cast shadow depth", min: 0, max: 1, step: 0.01 },
  { key: "rimStrength", label: "Rim light", min: 0, max: 3, step: 0.01 },
  { key: "rimPower", label: "Rim tightness", min: 0.5, max: 8, step: 0.1 },
  { key: "bloomStrength", label: "Glow strength", min: 0, max: 3, step: 0.01 },
  { key: "bloomThreshold", label: "Glow threshold", min: 0, max: 1, step: 0.01 },
  { key: "bloomRadius", label: "Glow spread", min: 0, max: 1.5, step: 0.01 },
  { key: "groundFogStrength", label: "Ground fog", min: 0, max: 1.5, step: 0.01 },
  { key: "emberStrength", label: "Embers", min: 0, max: 1.5, step: 0.01 },
  { key: "dustStrength", label: "Dust motes", min: 0, max: 1.5, step: 0.01 },
  { key: "vignetteStrength", label: "Edge feather", min: 0, max: 1.5, step: 0.01 },
  { key: "saturation", label: "Saturation", min: 0, max: 2.5, step: 0.01 },
  { key: "contrast", label: "Contrast", min: 0.4, max: 2.5, step: 0.01 },
  { key: "exposure", label: "Brightness", min: 0.2, max: 3, step: 0.01 },
  {
    key: "ambientOcclusionStrength",
    label: "Crevice shading",
    min: 0,
    max: 2,
    step: 0.01,
  },
];

const TOGGLE_DEFINITIONS = [
  { key: "enabled", label: "All depth effects" },
  { key: "shadowsEnabled", label: "Cast shadows" },
  { key: "rimEnabled", label: "Rim light" },
  { key: "bloomEnabled", label: "Glow / bloom" },
  { key: "groundFogEnabled", label: "Ground fog" },
  { key: "embersEnabled", label: "Embers" },
  { key: "dustMotesEnabled", label: "Dust motes" },
  { key: "ambientOcclusionEnabled", label: "Crevice shading (costly)" },
];

export function createStageFxPanel({ container, getStageFx, onChange }) {
  const { card } = createCard({
    title: "Depth & look",
    badge: "FX",
  });

  const toggleStack = document.createElement("div");
  toggleStack.className = "check-stack";

  const toggles = new Map();
  const sliders = new Map();

  const commit = (key, value) => {
    const next = normalizeStageFxState({ ...getStageFx(), [key]: value });
    onChange(next);
  };

  // Keep the master switch visible; tuck the rest away.
  const masterToggle = createToggleRow({
    label: "All depth effects",
    checked: getStageFx().enabled,
    onChange: (checked) => commit("enabled", checked),
  });
  toggles.set("enabled", masterToggle);
  card.appendChild(masterToggle.row);

  const details = document.createElement("details");
  details.className = "card-fold";
  const summary = document.createElement("summary");
  summary.textContent = "Shadows · glow · fog";
  details.appendChild(summary);
  card.appendChild(details);
  details.appendChild(toggleStack);

  for (const definition of TOGGLE_DEFINITIONS) {
    if (definition.key === "enabled") continue;
    const toggle = createToggleRow({
      label: definition.label,
      checked: getStageFx()[definition.key],
      onChange: (checked) => commit(definition.key, checked),
    });
    toggles.set(definition.key, toggle);
    toggleStack.appendChild(toggle.row);
  }

  const rimColor = createColorRow({
    label: "Rim colour",
    value: getStageFx().rimColor,
    onChange: (value) => commit("rimColor", value),
  });
  details.appendChild(rimColor.row);

  const sliderGrid = document.createElement("div");
  sliderGrid.className = "voice-tweak-grid";
  details.appendChild(sliderGrid);

  for (const definition of SLIDER_DEFINITIONS) {
    const slider = createSliderRow({
      label: definition.label,
      min: definition.min,
      max: definition.max,
      step: definition.step,
      value: getStageFx()[definition.key],
      onInput: (value) => commit(definition.key, value),
    });
    sliders.set(definition.key, slider);
    sliderGrid.appendChild(slider.row);
  }

  details.appendChild(
    createButtonRow([
      {
        label: "Reset effects",
        onClick: () => onChange(createDefaultStageFxState()),
      },
    ])
  );

  container.appendChild(card);

  return {
    refresh() {
      const fxState = normalizeStageFxState(getStageFx());
      for (const [key, toggle] of toggles) toggle.setValue(fxState[key]);
      for (const [key, slider] of sliders) slider.setValue(fxState[key]);
      rimColor.setValue(fxState.rimColor);
    },
  };
}
