import {
  createDefaultMapRevealState,
  isMapRevealMap,
  normalizeMapRevealState,
} from "../fogOfWar/mapRevealConfig.js";
import {
  compositeRevealedLayer,
  createEmptyRevealLayerTexture,
  createRevealLayerTextureFromData,
  getLayerConfigForMap,
  loadMapRevealLayerBundle,
} from "./mapRevealLayerAssets.js";

const layerLoadCache = new Map();

async function loadLayerBundle(mapId) {
  if (!isMapRevealMap(mapId)) return null;

  if (layerLoadCache.has(mapId)) {
    return layerLoadCache.get(mapId);
  }

  const loadPromise = (async () => {
    const bundle = await loadMapRevealLayerBundle(mapId);
    if (!bundle?.width || !bundle?.height || !bundle.cropSources?.length) {
      return null;
    }
    return bundle;
  })();

  layerLoadCache.set(mapId, loadPromise);
  return loadPromise;
}

function disposeRevealTexture(boxSurface) {
  const existing = boxSurface.userData.revealLayerTexture;
  if (existing) {
    existing.dispose?.();
    boxSurface.userData.revealLayerTexture = null;
  }
}

function updateRevealLayerTexture(boxSurface, revealedRegions) {
  const bundle = boxSurface.userData.mapLayerBundle;
  if (!bundle) return;

  const rgbaData = compositeRevealedLayer(
    revealedRegions,
    bundle.cropSources,
    bundle.width,
    bundle.height,
    {
      fullRevealRegionId: bundle.fullRevealRegionId,
      sourceRgba: bundle.sourceRgba,
    }
  );

  disposeRevealTexture(boxSurface);

  const revealTexture = createRevealLayerTextureFromData(
    rgbaData,
    bundle.width,
    bundle.height
  );
  boxSurface.userData.revealLayerTexture = revealTexture;

  const material = boxSurface.userData.battleMapMaterial;
  if (material?.uniforms?.revealLayer) {
    material.uniforms.revealLayer.value = revealTexture;
  }
}

export function normalizeBattleMapFogOfWar(battleMapState) {
  const mapId = battleMapState?.mapId;
  if (!isMapRevealMap(mapId)) {
    return null;
  }
  return normalizeMapRevealState(
    battleMapState?.fogOfWar || createDefaultMapRevealState(),
    mapId
  );
}

export async function applyMapLayersToSurface(boxSurface, battleMapState) {
  const material = boxSurface?.userData?.battleMapMaterial;
  if (!material?.uniforms?.mapRevealEnabled) return;

  const mapId = battleMapState?.mapId;
  const layerConfig = getLayerConfigForMap(mapId);
  const layerState = normalizeBattleMapFogOfWar(battleMapState);

  if (!layerConfig || !layerState?.enabled) {
    material.uniforms.mapRevealEnabled.value = 0;
    material.uniforms.revealLayer.value = null;
    boxSurface.userData.mapLayerBundle = null;
    disposeRevealTexture(boxSurface);
    return;
  }

  const bundle = await loadLayerBundle(mapId);
  if (!bundle) {
    material.uniforms.mapRevealEnabled.value = 0;
    return;
  }

  boxSurface.userData.mapLayerBundle = bundle;
  material.uniforms.mapRevealEnabled.value = 1;

  if (!material.uniforms.revealLayer.value) {
    material.uniforms.revealLayer.value = createEmptyRevealLayerTexture(
      bundle.width,
      bundle.height
    );
  }

  updateRevealLayerTexture(boxSurface, layerState.revealedRegions);
}

/** @deprecated Use applyMapLayersToSurface */
export async function applyFogOfWarToSurface(boxSurface, battleMapState) {
  return applyMapLayersToSurface(boxSurface, battleMapState);
}

export function syncMapRevealLayers(boxSurface, revealedRegions) {
  if (!boxSurface?.userData?.mapLayerBundle) return;
  updateRevealLayerTexture(boxSurface, revealedRegions);
}

/** @deprecated Use syncMapRevealLayers */
export function syncFogOfWarRevealRegions(boxSurface, revealedRegions) {
  syncMapRevealLayers(boxSurface, revealedRegions);
}

export function toggleMapRevealRegion(battleMapState, regionId) {
  const layerState = normalizeBattleMapFogOfWar(battleMapState);
  if (!layerState) return null;

  const numericRegionId = Number(regionId);
  if (!Number.isFinite(numericRegionId)) return layerState;

  const revealedRegions = layerState.revealedRegions.includes(numericRegionId)
    ? layerState.revealedRegions.filter((entry) => entry !== numericRegionId)
    : [...layerState.revealedRegions, numericRegionId].sort((left, right) => left - right);

  return {
    ...layerState,
    revealedRegions,
  };
}

/** @deprecated Use toggleMapRevealRegion */
export function toggleDeathHouseRegion(battleMapState, regionId) {
  return toggleMapRevealRegion(battleMapState, regionId);
}

/** @deprecated Use toggleMapRevealRegion */
export function revealDeathHouseRegion(battleMapState, regionId) {
  return toggleMapRevealRegion(battleMapState, regionId);
}

export function resetMapReveal(battleMapState) {
  const layerState = normalizeBattleMapFogOfWar(battleMapState);
  if (!layerState) return null;
  return {
    ...layerState,
    revealedRegions: [],
  };
}

/** @deprecated Use resetMapReveal */
export function resetDeathHouseFog(battleMapState) {
  return resetMapReveal(battleMapState);
}

export function disposeMapLayersForSurface(boxSurface) {
  disposeRevealTexture(boxSurface);
  boxSurface.userData.mapLayerBundle = null;
}

/** @deprecated Use disposeMapLayersForSurface */
export function disposeFogOfWarForSurface(boxSurface) {
  disposeMapLayersForSurface(boxSurface);
}
