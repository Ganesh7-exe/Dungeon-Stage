/**
 * Death House basement — backward-compatible exports.
 * Prefer mapRevealConfig.js for new maps.
 */
import {
  DEATH_HOUSE_BASEMENT_MAP_ID,
  MAP_REVEAL_CONFIGS,
  createDefaultMapRevealState,
  getMapRevealConfig,
  isMapRevealMap,
  normalizeMapRevealRegions,
  normalizeMapRevealState,
} from "./mapRevealConfig.js";

export { DEATH_HOUSE_BASEMENT_MAP_ID };

export const DEATH_HOUSE_BASEMENT_REGION_IDS =
  MAP_REVEAL_CONFIGS[DEATH_HOUSE_BASEMENT_MAP_ID].regionIds;

export const deathHouseBasementLayerConfig = {
  mapId: DEATH_HOUSE_BASEMENT_MAP_ID,
  darkBase: MAP_REVEAL_CONFIGS[DEATH_HOUSE_BASEMENT_MAP_ID].darkBase,
  manifest: MAP_REVEAL_CONFIGS[DEATH_HOUSE_BASEMENT_MAP_ID].manifest,
  sourceMap: MAP_REVEAL_CONFIGS[DEATH_HOUSE_BASEMENT_MAP_ID].sourceMap,
  regions: DEATH_HOUSE_BASEMENT_REGION_IDS.map((regionId) => ({
    id: regionId,
    label: `Room ${regionId}`,
    crop: `/maps/death-house-basement/layers/crop-${regionId}.png`,
  })),
};

/** @deprecated Use deathHouseBasementLayerConfig */
export const deathHouseBasementFogConfig = deathHouseBasementLayerConfig;

export function isDeathHouseBasementMap(mapId) {
  return mapId === DEATH_HOUSE_BASEMENT_MAP_ID;
}

export function normalizeDeathHouseRevealedRegions(rawRegions) {
  return normalizeMapRevealRegions(rawRegions, DEATH_HOUSE_BASEMENT_MAP_ID);
}

export function createDefaultDeathHouseFogState() {
  return createDefaultMapRevealState();
}

export function normalizeDeathHouseFogState(raw = {}, mapId = "") {
  if (!isDeathHouseBasementMap(mapId)) {
    return null;
  }
  return normalizeMapRevealState(raw, mapId);
}

export { getMapRevealConfig, isMapRevealMap };
