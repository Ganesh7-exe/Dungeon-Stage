import { resetMapReveal } from "../mapLayers/mapRevealLayers.js";
import { createMapRevealControls } from "./mapRevealControls.js";

export function createDeathHouseFogPanel(options = {}) {
  const container = options.container;
  const getBattleMap = options.getBattleMap;
  const onRevealRegion = options.onRevealRegion;
  const onResetFog = options.onResetFog;

  if (!container) return null;

  const section = document.createElement("section");
  section.className = "card death-house-fog-panel hidden";
  section.id = "death-house-fog-panel";
  section.hidden = true;

  const head = document.createElement("div");
  head.className = "card-head";

  const title = document.createElement("h3");
  title.textContent = "Map reveal";

  const badge = document.createElement("span");
  badge.className = "badge badge-gold";
  badge.id = "map-reveal-panel-badge";
  badge.textContent = "Map";

  head.appendChild(title);
  head.appendChild(badge);
  section.appendChild(head);

  const hint = document.createElement("p");
  hint.className = "field-hint";
  hint.textContent =
    "Toggle room numbers to light up areas. Parchment, compass, and title stay visible.";
  section.appendChild(hint);

  const buttonGrid = document.createElement("div");
  buttonGrid.className = "death-house-fog-buttons map-reveal-grid";
  section.appendChild(buttonGrid);

  const actions = document.createElement("div");
  actions.className = "button-row";

  const resetButton = document.createElement("button");
  resetButton.type = "button";
  resetButton.className = "btn btn-ghost";
  resetButton.textContent = "Hide all";
  actions.appendChild(resetButton);
  section.appendChild(actions);

  container.insertAdjacentElement("afterend", section);

  const controls = createMapRevealControls({
    panelElement: section,
    labelElement: badge,
    buttonGrid,
    clearButton: resetButton,
    buttonClassName: "btn btn-ghost death-house-fog-button map-reveal-btn",
    getBattleMap,
    onToggleRegion: onRevealRegion,
    onResetAll: onResetFog,
  });

  return {
    refresh: controls.refresh,
    resetFogState(battleMap) {
      return {
        ...battleMap,
        fogOfWar: resetMapReveal(battleMap),
      };
    },
  };
}
