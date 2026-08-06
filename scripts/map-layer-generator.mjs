/**
 * Shared layer generator for maps with manual (and optional reference) room reveals.
 */
import sharp from "sharp";
import fs from "fs";
import path from "path";
import {
  DEATH_HOUSE_BASEMENT_REGIONS,
  BASEMENT_DECOR_ZONES,
  DUNGEON_LEVEL_DECOR_ZONES,
  buildRegionGridFromReference,
  buildInteriorMaskFromMapOnly,
  calibrateDeathHouseAlignment,
} from "./death-house-region-utils.mjs";
import {
  applyManualCropOverride,
  loadManualCropOverrides,
} from "./death-house-manual-crops.mjs";

/** Unrevealed dungeon interior is fully black; only room buttons expose layout. */
export const INTERIOR_DARKNESS = 0;
export const INTERIOR_AMBIENT = 0;
const CROP_FEATHER_RADIUS = 0;

export const MAP_LAYER_GENERATOR_CONFIGS = {
  "death-house-basement": {
    colouredReference: "reference/region-mask-coloured.png",
    autoRegions: DEATH_HOUSE_BASEMENT_REGIONS,
    decorZones: BASEMENT_DECOR_ZONES,
    fullRevealRegionId: 34,
    manualCropComposeOptions: {
      composeMode: "crop-mask-walkable",
      useMapColors: true,
    },
  },
  "death-house-dungeon-level": {
    manualRegionIds: [35, 36, 37],
    decorZones: DUNGEON_LEVEL_DECOR_ZONES,
    fullRevealRegionId: 37,
    expandInteriorFromCropStencils: { fillBoundingBoxes: true },
    manualCropComposeOptions: {
      composeMode: "crop-mask-walkable",
      useMapColors: true,
    },
  },
};

function applyFeatherAlpha(alphaGrid, width, height, radius) {
  if (radius <= 0) return alphaGrid;
  const output = new Float32Array(alphaGrid.length);
  const kernelArea = (radius * 2 + 1) ** 2;
  for (let pixelY = 0; pixelY < height; pixelY += 1) {
    for (let pixelX = 0; pixelX < width; pixelX += 1) {
      let sum = 0;
      for (let offsetY = -radius; offsetY <= radius; offsetY += 1) {
        for (let offsetX = -radius; offsetX <= radius; offsetX += 1) {
          const sampleX = Math.min(width - 1, Math.max(0, pixelX + offsetX));
          const sampleY = Math.min(height - 1, Math.max(0, pixelY + offsetY));
          sum += alphaGrid[sampleY * width + sampleX];
        }
      }
      output[pixelY * width + pixelX] = sum / kernelArea;
    }
  }
  return Uint8Array.from(output, (value) => Math.round(value * 255));
}

async function readMapRgba(imagePath, width, height) {
  return sharp(imagePath)
    .resize(width, height, { kernel: sharp.kernel.lanczos3 })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
}

async function writeRgbaPng(rgba, width, height, filePath) {
  await sharp(rgba, { raw: { width, height, channels: 4 } }).png().toFile(filePath);
}

function createEmptyCropRgba(mapWidth, mapHeight) {
  return Buffer.alloc(mapWidth * mapHeight * 4);
}

export async function generateMapLayers({ mapId, rootDirectory }) {
  const generatorConfig = MAP_LAYER_GENERATOR_CONFIGS[mapId];
  if (!generatorConfig) {
    throw new Error(`No layer generator config for map: ${mapId}`);
  }

  const paths = {
    sourceMap: path.join(rootDirectory, `public/maps/${mapId}.png`),
    outputDir: path.join(rootDirectory, `public/maps/${mapId}/layers`),
    colouredReference: generatorConfig.colouredReference
      ? path.join(
          rootDirectory,
          `public/maps/${mapId}/${generatorConfig.colouredReference}`
        )
      : null,
  };

  fs.mkdirSync(paths.outputDir, { recursive: true });
  fs.mkdirSync(path.join(paths.outputDir, "manual"), { recursive: true });

  const mapMeta = await sharp(paths.sourceMap).metadata();
  const mapWidth = mapMeta.width;
  const mapHeight = mapMeta.height;

  console.log(`Source map: ${mapWidth}x${mapHeight}`);

  const { data: mapData, info } = await readMapRgba(
    paths.sourceMap,
    mapWidth,
    mapHeight
  );
  const channels = info.channels;

  const manualOverrides = await loadManualCropOverrides(paths.outputDir);

  const interiorGrid = await buildInteriorMaskFromMapOnly(
    paths.sourceMap,
    mapWidth,
    mapHeight,
    {
      decorZones: generatorConfig.decorZones,
      expandInteriorFromCropStencils: generatorConfig.expandInteriorFromCropStencils,
      manualCropOverrides: manualOverrides,
      layersDirectory: paths.outputDir,
    }
  );

  console.log(
    `Interior mask (map-only): ${interiorGrid.reduce((sum, value) => sum + value, 0)} px`
  );

  let alignment = null;
  let regionGrid = null;
  let fillStats = [];

  if (paths.colouredReference && fs.existsSync(paths.colouredReference)) {
    alignment = await calibrateDeathHouseAlignment({
      mapPath: paths.sourceMap,
      referencePath: paths.colouredReference,
    });

    const regionResult = await buildRegionGridFromReference({
      colouredReferencePath: paths.colouredReference,
      targetWidth: mapWidth,
      targetHeight: mapHeight,
      regions: generatorConfig.autoRegions,
      alignment,
    });
    regionGrid = regionResult.regionGrid;
    fillStats = regionResult.fillStats;
  }

  const darkBaseRgba = Buffer.alloc(mapWidth * mapHeight * 4);
  for (let index = 0; index < mapWidth * mapHeight; index += 1) {
    const offset = index * channels;
    const red = mapData[offset];
    const green = mapData[offset + 1];
    const blue = mapData[offset + 2];
    const alpha = channels > 3 ? mapData[offset + 3] : 255;
    const outputOffset = index * 4;

    if (interiorGrid[index]) {
      darkBaseRgba[outputOffset] = Math.round(
        red * INTERIOR_DARKNESS + INTERIOR_AMBIENT * 255
      );
      darkBaseRgba[outputOffset + 1] = Math.round(
        green * INTERIOR_DARKNESS + INTERIOR_AMBIENT * 255
      );
      darkBaseRgba[outputOffset + 2] = Math.round(
        blue * INTERIOR_DARKNESS + INTERIOR_AMBIENT * 255
      );
    } else {
      darkBaseRgba[outputOffset] = red;
      darkBaseRgba[outputOffset + 1] = green;
      darkBaseRgba[outputOffset + 2] = blue;
    }
    darkBaseRgba[outputOffset + 3] = alpha;
  }

  const darkBasePath = path.join(paths.outputDir, "dark-base.png");
  await writeRgbaPng(darkBaseRgba, mapWidth, mapHeight, darkBasePath);
  console.log(`Wrote ${path.relative(rootDirectory, darkBasePath)}`);

  const regionManifest = [];
  const regionIdsFromManual = Object.keys(manualOverrides).map(Number);
  const autoRegionIds = generatorConfig.autoRegions?.map((region) => region.id) || [];
  const manualOnlyRegionIds = generatorConfig.manualRegionIds || [];
  const allRegionIds = [
    ...new Set([...autoRegionIds, ...manualOnlyRegionIds, ...regionIdsFromManual]),
  ].sort((left, right) => left - right);

  for (const regionId of allRegionIds) {
    const regionMeta =
      generatorConfig.autoRegions?.find((region) => region.id === regionId) ||
      null;
    const region = regionMeta || { id: regionId, label: `Room ${regionId}` };
    const cropFileName = `crop-${region.id}.png`;
    const cropPath = path.join(paths.outputDir, cropFileName);
    const manualOverride = manualOverrides[String(region.id)];

    if (manualOverride) {
      console.log(`Using manual crop for region ${region.id}`);
      const { cropRgba, pixelCount, placement } = await applyManualCropOverride({
        regionId: region.id,
        override: manualOverride,
        layersDirectory: paths.outputDir,
        mapPath: paths.sourceMap,
        mapWidth,
        mapHeight,
        interiorGrid: null,
        composeOptions: generatorConfig.manualCropComposeOptions,
      });
      await writeRgbaPng(cropRgba, mapWidth, mapHeight, cropPath);
      console.log(
        `Wrote ${path.relative(rootDirectory, cropPath)} (${pixelCount} px) [manual @ ${placement.offsetX},${placement.offsetY}]`
      );
      regionManifest.push({
        id: region.id,
        label: region.label,
        cropFile: `/maps/${mapId}/layers/${cropFileName}`,
        pixelCount,
        manual: true,
        placement,
      });
      continue;
    }

    if (!regionGrid) {
      const emptyCrop = createEmptyCropRgba(mapWidth, mapHeight);
      await writeRgbaPng(emptyCrop, mapWidth, mapHeight, cropPath);
      console.log(
        `Wrote ${path.relative(rootDirectory, cropPath)} (empty placeholder — awaiting manual crop)`
      );
      regionManifest.push({
        id: region.id,
        label: region.label,
        cropFile: `/maps/${mapId}/layers/${cropFileName}`,
        pixelCount: 0,
        manual: false,
        placeholder: true,
      });
      continue;
    }

    const alphaGrid = new Float32Array(mapWidth * mapHeight);
    for (let index = 0; index < regionGrid.length; index += 1) {
      alphaGrid[index] = regionGrid[index] === region.id ? 1 : 0;
    }
    const featheredAlpha = applyFeatherAlpha(
      alphaGrid,
      mapWidth,
      mapHeight,
      CROP_FEATHER_RADIUS
    );

    const cropRgba = Buffer.alloc(mapWidth * mapHeight * 4);
    let pixelCount = 0;
    for (let index = 0; index < mapWidth * mapHeight; index += 1) {
      const alpha = featheredAlpha[index];
      if (!alpha) continue;
      pixelCount += 1;
      const mapOffset = index * channels;
      const cropOffset = index * 4;
      cropRgba[cropOffset] = mapData[mapOffset];
      cropRgba[cropOffset + 1] = mapData[mapOffset + 1];
      cropRgba[cropOffset + 2] = mapData[mapOffset + 2];
      cropRgba[cropOffset + 3] = alpha;
    }

    await writeRgbaPng(cropRgba, mapWidth, mapHeight, cropPath);
    console.log(`Wrote ${path.relative(rootDirectory, cropPath)} (${pixelCount} px)`);

    regionManifest.push({
      id: region.id,
      label: region.label,
      cropFile: `/maps/${mapId}/layers/${cropFileName}`,
      pixelCount,
      fillFromReference: fillStats.find((stat) => stat.id === region.id)?.filledCount ?? 0,
    });
  }

  const manifest = {
    mapId,
    mapSize: { width: mapWidth, height: mapHeight },
    cacheKey: `${mapId}-${Date.now()}`,
    alignment,
    interiorMaskSource: "map-only",
    darkBaseFile: `/maps/${mapId}/layers/dark-base.png`,
    sourceMapFile: `/maps/${mapId}.png`,
    regionIds: allRegionIds,
    regions: regionManifest,
  };

  if (Number.isFinite(generatorConfig.fullRevealRegionId)) {
    manifest.fullRevealRegionId = generatorConfig.fullRevealRegionId;
  }

  const manifestPath = path.join(paths.outputDir, "manifest.json");
  await fs.promises.writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(`Wrote ${path.relative(rootDirectory, manifestPath)}`);

  return manifest;
}
