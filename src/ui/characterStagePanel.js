/**
 * Control-rail panel for the resizable 3D character stage.
 */

import {
  createCard,
  createSelectRow,
  createSliderRow,
  createToggleRow,
} from "./controlBuilders.js";
import {
  CHARACTER_STAGE_BACKDROPS,
  MAX_SIZE,
  MIN_SIZE,
  normalizeCharacterStageState,
} from "../characterStage.js";

export function createCharacterStagePanel({
  container,
  getCharacterStage,
  onChange,
}) {
  const { card } = createCard({
    title: "3D stage",
    badge: "Characters",
    kicker:
      "Creatures spawn in this square just above the map’s far edge — not overlapping the PNG. Resize the booth and they scale with it.",
  });

  const commit = (mutate) => {
    const next = normalizeCharacterStageState(structuredClone(getCharacterStage()));
    mutate(next);
    onChange(normalizeCharacterStageState(next));
  };

  const enabledToggle = createToggleRow({
    label: "Use 3D stage",
    checked: getCharacterStage().enabled !== false,
    onChange: (checked) =>
      commit((stage) => {
        stage.enabled = checked;
      }),
  });
  card.appendChild(enabledToggle.row);

  const sizeSlider = createSliderRow({
    label: "Square size",
    min: MIN_SIZE,
    max: MAX_SIZE,
    step: 0.01,
    value: getCharacterStage().size,
    decimals: 2,
    onInput: (value) =>
      commit((stage) => {
        stage.size = value;
      }),
  });
  card.appendChild(sizeSlider.row);

  const heightSlider = createSliderRow({
    label: "Booth height",
    min: 0.45,
    max: 2.4,
    step: 0.01,
    value: getCharacterStage().height,
    decimals: 2,
    onInput: (value) =>
      commit((stage) => {
        stage.height = value;
      }),
  });
  card.appendChild(heightSlider.row);

  const backdropSelect = createSelectRow({
    label: "Backdrop",
    value: getCharacterStage().backdrop,
    options: CHARACTER_STAGE_BACKDROPS.map((entry) => ({
      value: entry.id,
      label: entry.label,
    })),
    onChange: (value) =>
      commit((stage) => {
        stage.backdrop = value;
      }),
  });
  card.appendChild(backdropSelect.row);

  const syncFromState = () => {
    const stage = normalizeCharacterStageState(getCharacterStage());
    enabledToggle.setValue(stage.enabled);
    sizeSlider.setValue(stage.size);
    heightSlider.setValue(stage.height);
    backdropSelect.setValue(stage.backdrop);
  };

  container.appendChild(card);

  return {
    card,
    syncFromState,
  };
}
