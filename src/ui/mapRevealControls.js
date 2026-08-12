import { battleMapSupportsMapReveal } from "../battleMaps.js";
import {
  getMapRevealConfig,
} from "../fogOfWar/mapRevealConfig.js";
/**
 * Shared room-reveal toggles for Control panel and Stage hotbar.
 */
export function createMapRevealControls({
  panelElement = null,
  labelElement = null,
  buttonGrid,
  clearButton = null,
  buttonClassName = "map-reveal-btn",
  getBattleMap,
  onToggleRegion,
  onResetAll,
}) {
  if (!buttonGrid) {
    throw new Error("createMapRevealControls requires buttonGrid");
  }

  buttonGrid.setAttribute("role", "group");
  let activeMapId = null;
  const regionButtons = new Map();

  if (clearButton) {
    clearButton.addEventListener("click", () => {
      onResetAll?.();
    });
  }

  function renderRegionButtons(mapId) {
    const layerConfig = getMapRevealConfig(mapId);
    const regionIds = layerConfig?.regionIds || [];

    buttonGrid.innerHTML = "";
    regionButtons.clear();

    for (const regionId of regionIds) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = buttonClassName;
      button.dataset.regionId = String(regionId);
      button.textContent = String(regionId);
      button.title =
        regionId === layerConfig?.fullRevealRegionId
          ? `Toggle room ${regionId} (reveal entire map)`
          : `Toggle room ${regionId}`;
      button.setAttribute("aria-label", `Toggle room ${regionId}`);
      button.addEventListener("click", () => {
        onToggleRegion?.(regionId);
      });
      buttonGrid.appendChild(button);
      regionButtons.set(regionId, button);
    }

    buttonGrid.setAttribute(
      "aria-label",
      `Reveal ${layerConfig?.panelLabel || "map"} rooms`
    );
  }

  function refresh() {
    const battleMap = getBattleMap?.();
    const mapId = battleMap?.mapId;
    const visible =
      battleMap?.enabled !== false && battleMapSupportsMapReveal(mapId);

    if (panelElement) {
      panelElement.classList.toggle("is-visible", visible);
      panelElement.classList.toggle("hidden", !visible);
      panelElement.hidden = !visible;
    }

    if (!visible) {
      activeMapId = null;
      buttonGrid.innerHTML = "";
      regionButtons.clear();
      if (labelElement) {
        labelElement.textContent = "Rooms";
      }
      return;
    }

    const layerConfig = getMapRevealConfig(mapId);
    if (labelElement) {
      labelElement.textContent = layerConfig?.panelLabel || "Rooms";
    }

    if (mapId !== activeMapId) {
      renderRegionButtons(mapId);
      activeMapId = mapId;
    }

    const revealedRegions = battleMap?.fogOfWar?.revealedRegions || [];
    for (const [regionId, button] of regionButtons.entries()) {
      const revealed = revealedRegions.includes(regionId);
      button.classList.toggle("is-revealed", revealed);
      button.setAttribute("aria-pressed", revealed ? "true" : "false");
    }
  }

  return { refresh };
}
