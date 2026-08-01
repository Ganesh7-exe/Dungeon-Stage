/**
 * Battle maps for the box floor (PNG + light-alive FX).
 *
 * Grouped by category for the Maps rail. Drop new PNGs in:
 *   public/maps/
 * then add an entry under the matching category (or create a new one).
 *
 * `effects` is the per-map vibe filter pack (0–1). UI toggles gate each channel;
 * intensity scales the whole pack. Match the art: misty maps → fog, lava → fire, etc.
 *
 * `stageFxOverrides` optionally tweaks bloom/atmosphere for maps whose art would
 * otherwise bloom out (bright white tile floors, etc.).
 */

import { normalizeStageFxState } from "./fx/stageFxState.js";
import {
  getCustomBattleMapEntries,
  getCustomMapsCategory,
  initCustomBattleMaps,
  isCustomBattleMapId,
} from "./customBattleMaps.js";

export { initCustomBattleMaps, isCustomBattleMapId } from "./customBattleMaps.js";

export const battleMapCategories = [
  {
    id: "utility",
    name: "Utility",
    maps: [
      {
        id: "none",
        name: "None (box only)",
        file: null,
        thumb: null,
        effects: { water: 0, wind: 0, fire: 0, fog: 0, snow: 0 },
      },
    ],
  },
  {
    id: "curse-of-strahd-introductory-adventure",
    name: "Curse-of-Strahd-Introductory-Adventure",
    maps: [
      {
        id: "village-of-barovia",
        name: "Village of Barovia",
        file: "/maps/village-of-barovia.png",
        thumb: "/maps/village-of-barovia.png",
        cacheKey: "user-v1",
        effects: { water: 0, wind: 0, fire: 0, fog: 0, snow: 0 },
        stageFxOverrides: {
          bloomEnabled: false,
          groundFogEnabled: false,
          dustMotesEnabled: false,
          embersEnabled: false,
          exposure: 1,
          saturation: 1,
          contrast: 1,
        },
      },
      {
        id: "death-house-front-view",
        name: "Front View",
        file: "/maps/death-house-front-view.png",
        thumb: "/maps/death-house-front-view.png",
        cacheKey: "user-v1",
        effects: { water: 0, wind: 0, fire: 0, fog: 0, snow: 0 },
        stageFxOverrides: {
          bloomEnabled: false,
          groundFogEnabled: false,
          dustMotesEnabled: false,
          embersEnabled: false,
          exposure: 1,
          saturation: 1,
          contrast: 1,
        },
      },
      {
        id: "death-house-first-floor",
        name: "First Floor",
        file: "/maps/death-house-first-floor.png",
        thumb: "/maps/death-house-first-floor.png",
        cacheKey: "user-v2",
        effects: { water: 0, wind: 0, fire: 0, fog: 0, snow: 0 },
        stageFxOverrides: {
          bloomEnabled: false,
          groundFogEnabled: false,
          dustMotesEnabled: false,
          embersEnabled: false,
          exposure: 1,
          saturation: 1,
          contrast: 1,
        },
      },
      {
        id: "death-house-second-floor",
        name: "Second Floor",
        file: "/maps/death-house-second-floor.png",
        thumb: "/maps/death-house-second-floor.png",
        cacheKey: "user-v3",
        effects: { water: 0, wind: 0, fire: 0, fog: 0, snow: 0 },
        stageFxOverrides: {
          bloomEnabled: false,
          groundFogEnabled: false,
          dustMotesEnabled: false,
          embersEnabled: false,
          exposure: 1,
          saturation: 1,
          contrast: 1,
        },
      },
      {
        id: "death-house-third-floor",
        name: "Third Floor",
        file: "/maps/death-house-third-floor.png",
        thumb: "/maps/death-house-third-floor.png",
        cacheKey: "user-v2",
        effects: { water: 0, wind: 0, fire: 0, fog: 0, snow: 0 },
        stageFxOverrides: {
          bloomEnabled: false,
          groundFogEnabled: false,
          dustMotesEnabled: false,
          embersEnabled: false,
          exposure: 1,
          saturation: 1,
          contrast: 1,
        },
      },
      {
        id: "death-house-attic",
        name: "Attic",
        file: "/maps/death-house-attic.png",
        thumb: "/maps/death-house-attic.png",
        cacheKey: "user-v2",
        effects: { water: 0, wind: 0, fire: 0, fog: 0, snow: 0 },
        stageFxOverrides: {
          bloomEnabled: false,
          groundFogEnabled: false,
          dustMotesEnabled: false,
          embersEnabled: false,
          exposure: 1,
          saturation: 1,
          contrast: 1,
        },
      },
      {
        id: "death-house-basement",
        name: "Death House",
        file: "/maps/death-house-basement.png",
        thumb: "/maps/death-house-basement.png",
        cacheKey: "user-v2",
        effects: { water: 0, wind: 0, fire: 0, fog: 0, snow: 0 },
        stageFxOverrides: {
          bloomEnabled: false,
          groundFogEnabled: false,
          dustMotesEnabled: false,
          embersEnabled: false,
          exposure: 1,
          saturation: 1,
          contrast: 1,
        },
      },
      {
        id: "death-house-dungeon-level",
        name: "Dungeon Level",
        file: "/maps/death-house-dungeon-level.png",
        thumb: "/maps/death-house-dungeon-level.png",
        cacheKey: "user-v2",
        effects: { water: 0, wind: 0, fire: 0, fog: 0, snow: 0 },
        stageFxOverrides: {
          bloomEnabled: false,
          groundFogEnabled: false,
          dustMotesEnabled: false,
          embersEnabled: false,
          exposure: 1,
          saturation: 1,
          contrast: 1,
        },
      },
    ],
  },
  {
    id: "a-most-potent-brew",
    name: "A-Most-Potent-Brew",
    maps: [
      {
        id: "a-most-potent-brew-map-1",
        name: "Map 1",
        file: "/maps/a-most-potent-brew-map-1.png",
        thumb: "/maps/a-most-potent-brew-map-1.png",
        cacheKey: "user-v1",
        effects: { water: 0, wind: 0, fire: 0, fog: 0, snow: 0 },
        stageFxOverrides: {
          bloomEnabled: false,
          groundFogEnabled: false,
          dustMotesEnabled: false,
          embersEnabled: false,
          exposure: 1,
          saturation: 1,
          contrast: 1,
        },
      },
      {
        id: "a-most-potent-brew-map-2",
        name: "Map 2",
        file: "/maps/a-most-potent-brew-map-2.png",
        thumb: "/maps/a-most-potent-brew-map-2.png",
        cacheKey: "user-v1",
        effects: { water: 0, wind: 0, fire: 0, fog: 0, snow: 0 },
        stageFxOverrides: {
          bloomEnabled: false,
          groundFogEnabled: false,
          dustMotesEnabled: false,
          embersEnabled: false,
          exposure: 1,
          saturation: 1,
          contrast: 1,
        },
      },
      {
        id: "a-most-potent-brew-map-3",
        name: "Map 3",
        file: "/maps/a-most-potent-brew-map-3.png",
        thumb: "/maps/a-most-potent-brew-map-3.png",
        cacheKey: "user-v1",
        effects: { water: 0, wind: 0, fire: 0, fog: 0, snow: 0 },
        stageFxOverrides: {
          bloomEnabled: false,
          groundFogEnabled: false,
          dustMotesEnabled: false,
          embersEnabled: false,
          exposure: 1,
          saturation: 1,
          contrast: 1,
        },
      },
    ],
  },
];

/** Flat list for lookups / legacy callers. */
export const battleMaps = battleMapCategories.flatMap(
  (category) => category.maps
);

/** Built-in categories plus the user Custom Maps section. */
export function getBattleMapCategories() {
  return [...battleMapCategories, getCustomMapsCategory()];
}

export function getAllBattleMaps() {
  return [...battleMaps, ...getCustomBattleMapEntries()];
}

export function getBattleMapById(mapId) {
  const customEntry = getCustomBattleMapEntries().find((entry) => entry.id === mapId);
  if (customEntry) return customEntry;

  return (
    battleMaps.find((entry) => entry.id === mapId) ||
    battleMaps.find((entry) => entry.id === "none")
  );
}

/**
 * Merge global stage FX with optional per-map overrides (e.g. disable bloom on
 * bright indoor tile floors so the grid stays readable).
 */
export function resolveStageFxForBattleMap(baseFxState, mapId) {
  const mapConfig = getBattleMapById(mapId);
  const overrides = mapConfig?.stageFxOverrides;
  if (!overrides || typeof overrides !== "object") {
    return baseFxState;
  }
  return normalizeStageFxState({ ...baseFxState, ...overrides });
}

export function createDefaultBattleMapState() {
  return {
    mapId: "village-of-barovia",
    enabled: true,
    water: true,
    wind: true,
    fire: true,
    fog: true,
    snow: true,
    intensity: 1,
  };
}

export function normalizeBattleMapState(raw = {}) {
  const fallback = createDefaultBattleMapState();
  const knownMap = getAllBattleMaps().find((entry) => entry.id === raw.mapId);
  const mapId = knownMap ? knownMap.id : fallback.mapId;
  const intensity = Number(raw.intensity);
  return {
    mapId,
    enabled: raw.enabled !== false,
    water: raw.water !== false,
    wind: raw.wind !== false,
    fire: raw.fire !== false,
    fog: raw.fog !== false,
    snow: raw.snow !== false,
    intensity:
      Number.isFinite(intensity) && intensity >= 0
        ? Math.min(1.5, Math.max(0, intensity))
        : fallback.intensity,
  };
}
