/**
 * Shared region boundary logic for Death House basement layer generation.
 */
import sharp from "sharp";
import path from "path";
import {
  DEFAULT_DEATH_HOUSE_ALIGNMENT,
  calibrateDeathHouseAlignment,
  remapInt16GridToMap,
  remapUint8GridToMap,
} from "./death-house-map-alignment.mjs";

export { calibrateDeathHouseAlignment, DEFAULT_DEATH_HOUSE_ALIGNMENT };

export const DEATH_HOUSE_BASEMENT_REGIONS = [
  { id: 25, label: "Room 25 (west hall A–E)", seed: { x: 0.17, y: 0.46 } },
  { id: 23, label: "Room 23 (upper-right crypts)", seed: { x: 0.71, y: 0.19 } },
  { id: 27, label: "Room 27 (central platform)", seed: { x: 0.62, y: 0.48 } },
  {
    id: 26,
    label: "Room 26 (vertical corridor)",
    seed: { x: 0.475, y: 0.5 },
    hueTolerance: 16,
  },
  { id: 30, label: "Room 30 (lower-left room)", seed: { x: 0.36, y: 0.70 } },
  { id: 29, label: "Room 29 (L-shaped corridor)", seed: { x: 0.56, y: 0.73 } },
  { id: 31, label: "Room 31 (ritual chapel)", seed: { x: 0.72, y: 0.78 } },
  {
    id: 33,
    label: "Room 33 (workshop)",
    seed: { x: 0.52, y: 0.88 },
    hueTolerance: 20,
  },
];

const YELLOW_BARRIER_RADIUS = 8;

const MANUAL_COMPONENT_MAP = {
  14: { family: "yellow", componentIds: [2257] },
  21: { family: "orange", componentIds: [1] },
  23: {
    family: "yellow",
    componentIds: [358, 363, 369, 382, 388, 391, 392, 630, 830, 872, 894, 925],
  },
  25: {
    family: "cyan",
    // West hall + alcoves A–E (split across cyan/green islands in the reference art).
    componentIds: [32, 36, 37, 46],
    additionalComponents: [{ family: "green", componentIds: [106, 134] }],
  },
  26: { family: "green", componentIds: [188] },
  27: { family: "magenta", componentIds: [156] },
  29: { family: "orange", componentIds: [1168] },
  30: { family: "yellow", componentIds: [1536] },
  31: { family: "cyan", componentIds: [67] },
  33: { family: "green", componentIds: [302] },
};

const FAMILY_CODES = {
  cyan: 1,
  orange: 2,
  yellow: 3,
  magenta: 4,
  green: 5,
  brown: 6,
};

const REGION_COLOUR_FAMILY = {
  25: "cyan",
  31: "cyan",
  21: "orange",
  29: "orange",
  23: "yellow",
  30: "yellow",
  14: "yellow",
  27: "magenta",
  26: "green",
  33: "green",
};

function isYellowPartition(red, green, blue) {
  return red > 170 && green > 170 && blue < 130 && red + green > blue * 2.2;
}

function isParchment(red, green, blue) {
  const maxChannel = Math.max(red, green, blue);
  const minChannel = Math.min(red, green, blue);
  const saturation = maxChannel > 0 ? (maxChannel - minChannel) / maxChannel : 0;
  const warmBrown = red >= green && green >= blue * 0.85;
  return saturation < 0.22 && warmBrown && maxChannel > 60 && maxChannel < 230;
}

function pixelSaturation(red, green, blue) {
  const maxChannel = Math.max(red, green, blue);
  const minChannel = Math.min(red, green, blue);
  return maxChannel > 0 ? (maxChannel - minChannel) / maxChannel : 0;
}

function rgbToHue(red, green, blue) {
  const redNorm = red / 255;
  const greenNorm = green / 255;
  const blueNorm = blue / 255;
  const maxChannel = Math.max(redNorm, greenNorm, blueNorm);
  const minChannel = Math.min(redNorm, greenNorm, blueNorm);
  const delta = maxChannel - minChannel;
  if (delta < 0.0001) return -1;
  let hue = 0;
  if (maxChannel === redNorm) {
    hue = ((greenNorm - blueNorm) / delta) % 6;
  } else if (maxChannel === greenNorm) {
    hue = (blueNorm - redNorm) / delta + 2;
  } else {
    hue = (redNorm - greenNorm) / delta + 4;
  }
  hue *= 60;
  if (hue < 0) hue += 360;
  return hue;
}

function classifyColourFamily(red, green, blue) {
  const saturation = pixelSaturation(red, green, blue);
  if (saturation < 0.07) return "none";
  const hue = rgbToHue(red, green, blue);
  if (hue < 0) return "brown";
  if (hue >= 155 && hue <= 205) return "cyan";
  if (hue >= 5 && hue <= 48) return "orange";
  if (hue >= 49 && hue <= 78) return "yellow";
  if (hue >= 275 && hue <= 345) return "magenta";
  if (hue >= 79 && hue <= 154) return "green";
  return "brown";
}

function buildBarrierGrid(data, width, height, channels) {
  const barrierGrid = new Uint8Array(width * height);
  for (let pixelY = 0; pixelY < height; pixelY += 1) {
    for (let pixelX = 0; pixelX < width; pixelX += 1) {
      const gridIndex = pixelY * width + pixelX;
      const bufferIndex = gridIndex * channels;
      const red = data[bufferIndex];
      const green = data[bufferIndex + 1];
      const blue = data[bufferIndex + 2];
      if (isYellowPartition(red, green, blue)) {
        barrierGrid[gridIndex] = 1;
      }
    }
  }
  return dilateMask(barrierGrid, width, height, YELLOW_BARRIER_RADIUS);
}

function buildFamilyGrid(data, width, height, channels, barrierGrid) {
  const familyGrid = new Uint8Array(width * height);
  for (let pixelY = 0; pixelY < height; pixelY += 1) {
    for (let pixelX = 0; pixelX < width; pixelX += 1) {
      const gridIndex = pixelY * width + pixelX;
      if (barrierGrid[gridIndex]) continue;
      const bufferIndex = gridIndex * channels;
      const red = data[bufferIndex];
      const green = data[bufferIndex + 1];
      const blue = data[bufferIndex + 2];
      if (isParchment(red, green, blue)) continue;
      const family = classifyColourFamily(red, green, blue);
      familyGrid[gridIndex] = FAMILY_CODES[family] || 0;
    }
  }
  return familyGrid;
}

function labelFamilyComponents(familyGrid, width, height, familyCode) {
  const componentGrid = new Int32Array(width * height);
  const componentSizes = new Map();
  let nextComponentId = 1;

  for (let seedY = 0; seedY < height; seedY += 1) {
    for (let seedX = 0; seedX < width; seedX += 1) {
      const seedIndex = seedY * width + seedX;
      if (familyGrid[seedIndex] !== familyCode || componentGrid[seedIndex] !== 0) continue;

      const queue = [[seedX, seedY]];
      componentGrid[seedIndex] = nextComponentId;
      let size = 0;

      while (queue.length) {
        const [pixelX, pixelY] = queue.pop();
        const gridIndex = pixelY * width + pixelX;
        if (componentGrid[gridIndex] !== nextComponentId) continue;
        size += 1;

        const neighbours = [
          [pixelX - 1, pixelY],
          [pixelX + 1, pixelY],
          [pixelX, pixelY - 1],
          [pixelX, pixelY + 1],
        ];
        for (const [neighbourX, neighbourY] of neighbours) {
          if (neighbourX < 0 || neighbourY < 0 || neighbourX >= width || neighbourY >= height) {
            continue;
          }
          const neighbourIndex = neighbourY * width + neighbourX;
          if (
            familyGrid[neighbourIndex] === familyCode &&
            componentGrid[neighbourIndex] === 0
          ) {
            componentGrid[neighbourIndex] = nextComponentId;
            queue.push([neighbourX, neighbourY]);
          }
        }
      }

      componentSizes.set(nextComponentId, size);
      nextComponentId += 1;
    }
  }

  return { componentGrid, componentSizes };
}

function findComponentAtSeed(componentGrid, width, height, seedX, seedY) {
  if (seedX < 0 || seedY < 0 || seedX >= width || seedY >= height) return 0;
  let componentId = componentGrid[seedY * width + seedX];
  if (componentId) return componentId;

  const searchRadius = 16;
  for (let radius = 1; radius <= searchRadius; radius += 1) {
    for (let offsetY = -radius; offsetY <= radius; offsetY += 1) {
      for (let offsetX = -radius; offsetX <= radius; offsetX += 1) {
        const sampleX = seedX + offsetX;
        const sampleY = seedY + offsetY;
        if (sampleX < 0 || sampleY < 0 || sampleX >= width || sampleY >= height) continue;
        componentId = componentGrid[sampleY * width + sampleX];
        if (componentId) return componentId;
      }
    }
  }
  return 0;
}

function buildRegionGrid({ data, width, height, channels, regions }) {
  const regionGrid = new Int16Array(width * height);
  const barrierGrid = buildBarrierGrid(data, width, height, channels);
  const familyGrid = buildFamilyGrid(data, width, height, channels, barrierGrid);

  for (let index = 0; index < barrierGrid.length; index += 1) {
    if (barrierGrid[index]) regionGrid[index] = -1;
  }

  const familyComponentCache = new Map();
  const claimedComponents = new Set();
  const fillStats = [];

  function claimFamilyComponents(regionId, familyName, componentIds) {
    const familyCode = FAMILY_CODES[familyName];
    if (!familyCode || !componentIds?.length) return 0;

    const cacheKey = String(familyCode);
    if (!familyComponentCache.has(cacheKey)) {
      familyComponentCache.set(
        cacheKey,
        labelFamilyComponents(familyGrid, width, height, familyCode)
      );
    }

    const { componentGrid, componentSizes } = familyComponentCache.get(cacheKey);
    let filledCount = 0;

    for (const componentId of componentIds) {
      const claimKey = `${cacheKey}:${componentId}`;
      if (!componentId || claimedComponents.has(claimKey)) continue;
      claimedComponents.add(claimKey);
      for (let index = 0; index < componentGrid.length; index += 1) {
        if (componentGrid[index] === componentId) {
          regionGrid[index] = regionId;
          filledCount += 1;
        }
      }
    }

    return filledCount;
  }

  for (const region of regions) {
    const seedX = Math.round(region.seed.x * (width - 1));
    const seedY = Math.round(region.seed.y * (height - 1));
    const bufferIndex = (seedY * width + seedX) * channels;
    const seedColour = {
      red: data[bufferIndex],
      green: data[bufferIndex + 1],
      blue: data[bufferIndex + 2],
    };

    const manualEntry = MANUAL_COMPONENT_MAP[region.id];
    const familyName = manualEntry?.family || REGION_COLOUR_FAMILY[region.id] || "brown";
    const familyCode = FAMILY_CODES[familyName];

    if (!familyComponentCache.has(String(familyCode))) {
      familyComponentCache.set(
        String(familyCode),
        labelFamilyComponents(familyGrid, width, height, familyCode)
      );
    }

    const { componentSizes } = familyComponentCache.get(String(familyCode));
    const componentIds = manualEntry?.componentIds?.length
      ? manualEntry.componentIds
      : manualEntry?.componentId
        ? [manualEntry.componentId]
        : [
            findComponentAtSeed(
              familyComponentCache.get(String(familyCode)).componentGrid,
              width,
              height,
              seedX,
              seedY
            ),
          ].filter(Boolean);

    let filledCount = claimFamilyComponents(region.id, familyName, componentIds);

    for (const extra of manualEntry?.additionalComponents || []) {
      filledCount += claimFamilyComponents(region.id, extra.family, extra.componentIds);
    }

    fillStats.push({
      id: region.id,
      filledCount,
      seedColour,
      seedX,
      seedY,
      family: familyName,
      componentIds,
      additionalComponents: manualEntry?.additionalComponents || [],
      componentSize: componentIds.reduce(
        (sum, componentId) => sum + (componentSizes.get(componentId) || 0),
        0
      ),
    });
  }

  fillStats.sort((left, right) => left.id - right.id);
  return { regionGrid, fillStats, barrierGrid };
}

function buildOverlayGrid(data, width, height, channels, barrierGrid) {
  const overlayGrid = new Uint8Array(width * height);
  for (let pixelY = 0; pixelY < height; pixelY += 1) {
    for (let pixelX = 0; pixelX < width; pixelX += 1) {
      const gridIndex = pixelY * width + pixelX;
      if (barrierGrid[gridIndex]) continue;
      const bufferIndex = gridIndex * channels;
      const red = data[bufferIndex];
      const green = data[bufferIndex + 1];
      const blue = data[bufferIndex + 2];
      if (isParchment(red, green, blue)) continue;
      overlayGrid[gridIndex] = 1;
    }
  }
  return overlayGrid;
}

function buildInteriorGridFromRegions(regionGrid) {
  const interiorGrid = new Uint8Array(regionGrid.length);
  for (let index = 0; index < regionGrid.length; index += 1) {
    if (regionGrid[index] > 0) interiorGrid[index] = 1;
  }
  return interiorGrid;
}

function isWalkableFloorPixel(red, green, blue) {
  const luma = (red + green + blue) / (255 * 3);
  const maxChannel = Math.max(red, green, blue);
  const minChannel = Math.min(red, green, blue);
  const saturation = maxChannel > 0 ? (maxChannel - minChannel) / maxChannel : 0;

  const warmParchment =
    saturation < 0.18 &&
    red >= green * 0.9 &&
    green >= blue * 0.82 &&
    luma >= 0.24 &&
    luma <= 0.56;
  const creamFloor =
    luma >= 0.34 && saturation < 0.34 && !warmParchment && luma >= 0.16;
  const stoneFloor =
    !warmParchment &&
    luma >= 0.07 &&
    luma <= 0.32 &&
    saturation < 0.62;
  const tiledFloor =
    !warmParchment &&
    luma >= 0.18 &&
    luma <= 0.52 &&
    saturation >= 0.32 &&
    saturation < 0.72;

  return creamFloor || stoneFloor || tiledFloor;
}

/** Aged map border / title block paper — not playable floor even when hue overlaps tiledFloor. */
function isDecorParchmentPixel(red, green, blue) {
  const luma = (red + green + blue) / (255 * 3);
  const maxChannel = Math.max(red, green, blue);
  const minChannel = Math.min(red, green, blue);
  const saturation = maxChannel > 0 ? (maxChannel - minChannel) / maxChannel : 0;

  return (
    luma >= 0.32 &&
    luma <= 0.88 &&
    red >= green * 0.72 &&
    green >= blue * 0.68 &&
    red >= blue * 0.85 &&
    saturation < 0.58
  );
}

async function readTargetMapPixels(targetMapPath, targetWidth, targetHeight) {
  const { data, info } = await sharp(targetMapPath)
    .resize(targetWidth, targetHeight, { kernel: sharp.kernel.lanczos3 })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, channels: info.channels };
}

async function buildInteriorFromRevealedMap(revealedPath, targetWidth, targetHeight) {
  const resized = await sharp(revealedPath)
    .resize(targetWidth, targetHeight, { kernel: sharp.kernel.lanczos3 })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { data, info } = resized;
  const { width, height, channels } = info;
  let interiorGrid = new Uint8Array(width * height);

  for (let pixelY = 0; pixelY < height; pixelY += 1) {
    for (let pixelX = 0; pixelX < width; pixelX += 1) {
      const gridIndex = pixelY * width + pixelX;
      const bufferIndex = gridIndex * channels;
      const red = data[bufferIndex];
      const green = data[bufferIndex + 1];
      const blue = data[bufferIndex + 2];

      if (isWalkableFloorPixel(red, green, blue)) {
        interiorGrid[gridIndex] = 1;
      }
    }
  }

  return dilateMask(interiorGrid, width, height, 3);
}

/** Mark manual crop regions as interior so edges/walls dim until revealed. */
export async function expandInteriorFromManualCropStencils(
  interiorGrid,
  mapWidth,
  mapHeight,
  layersDirectory,
  manualOverrides = {},
  options = {}
) {
  const stencilDilateRadius =
    typeof options.stencilDilateRadius === "number" ? options.stencilDilateRadius : 4;
  const fillBoundingBoxes = options.fillBoundingBoxes === true;

  for (const override of Object.values(manualOverrides)) {
    if (
      override?.offsetX == null ||
      override?.offsetY == null ||
      !override?.sourceFile
    ) {
      continue;
    }

    const sourcePath = path.join(layersDirectory, override.sourceFile);
    const { data, info } = await sharp(sourcePath)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const cropWidth = info.width;
    const cropHeight = info.height;
    const channels = info.channels;
    const offsetX = override.offsetX;
    const offsetY = override.offsetY;

    if (fillBoundingBoxes) {
      for (let mapY = offsetY; mapY < offsetY + cropHeight; mapY += 1) {
        if (mapY < 0 || mapY >= mapHeight) continue;
        for (let mapX = offsetX; mapX < offsetX + cropWidth; mapX += 1) {
          if (mapX < 0 || mapX >= mapWidth) continue;
          interiorGrid[mapY * mapWidth + mapX] = 1;
        }
      }
      continue;
    }

    const cropStencil = new Uint8Array(mapWidth * mapHeight);

    for (let cropY = 0; cropY < cropHeight; cropY += 1) {
      for (let cropX = 0; cropX < cropWidth; cropX += 1) {
        const cropIndex = cropY * cropWidth + cropX;
        const cropOffset = cropIndex * channels;
        const alpha = channels > 3 ? data[cropOffset + 3] : 255;
        if (alpha <= 20) continue;

        const mapX = offsetX + cropX;
        const mapY = offsetY + cropY;
        if (mapX < 0 || mapY < 0 || mapX >= mapWidth || mapY >= mapHeight) {
          continue;
        }
        cropStencil[mapY * mapWidth + mapX] = 1;
      }
    }

    const expandedStencil = dilateMask(
      cropStencil,
      mapWidth,
      mapHeight,
      stencilDilateRadius
    );

    for (let index = 0; index < interiorGrid.length; index += 1) {
      if (expandedStencil[index]) {
        interiorGrid[index] = 1;
      }
    }
  }

  return interiorGrid;
}

function computeMaskBounds(mask, width, height, padding = 0) {
  let minX = width;
  let maxX = 0;
  let minY = height;
  let maxY = 0;

  for (let pixelY = 0; pixelY < height; pixelY += 1) {
    for (let pixelX = 0; pixelX < width; pixelX += 1) {
      if (!mask[pixelY * width + pixelX]) continue;
      minX = Math.min(minX, pixelX);
      maxX = Math.max(maxX, pixelX);
      minY = Math.min(minY, pixelY);
      maxY = Math.max(maxY, pixelY);
    }
  }

  if (minX > maxX || minY > maxY) {
    return null;
  }

  return {
    minX: Math.max(0, minX - padding),
    maxX: Math.min(width - 1, maxX + padding),
    minY: Math.max(0, minY - padding),
    maxY: Math.min(height - 1, maxY + padding),
  };
}

function clipInteriorToDungeonBounds(interiorGrid, width, height, bounds) {
  if (!bounds) return interiorGrid;
  for (let pixelY = 0; pixelY < height; pixelY += 1) {
    for (let pixelX = 0; pixelX < width; pixelX += 1) {
      if (
        pixelX < bounds.minX ||
        pixelX > bounds.maxX ||
        pixelY < bounds.minY ||
        pixelY > bounds.maxY
      ) {
        interiorGrid[pixelY * width + pixelX] = 0;
      }
    }
  }
  return interiorGrid;
}

function excludeDecorZones(
  interiorGrid,
  width,
  height,
  decorZones = DEFAULT_DECOR_ZONES,
  pixelData = null,
  channels = 3
) {
  for (let pixelY = 0; pixelY < height; pixelY += 1) {
    for (let pixelX = 0; pixelX < width; pixelX += 1) {
      const normalizedX = pixelX / (width - 1);
      const normalizedY = pixelY / (height - 1);
      const gridIndex = pixelY * width + pixelX;

      for (const zone of decorZones) {
        if (
          normalizedX < zone.minX ||
          normalizedX > zone.maxX ||
          normalizedY < zone.minY ||
          normalizedY > zone.maxY
        ) {
          continue;
        }

        if (zone.brightDecorParchmentOnly) {
          if (pixelData) {
            const bufferIndex = gridIndex * channels;
            const red = pixelData[bufferIndex];
            const green = pixelData[bufferIndex + 1];
            const blue = pixelData[bufferIndex + 2];
            if (isDecorParchmentPixel(red, green, blue)) {
              interiorGrid[gridIndex] = 0;
            }
          }
          break;
        }

        if (zone.preserveWalkableFloor) {
          if (pixelData) {
            const bufferIndex = gridIndex * channels;
            const red = pixelData[bufferIndex];
            const green = pixelData[bufferIndex + 1];
            const blue = pixelData[bufferIndex + 2];
            if (
              isWalkableFloorPixel(red, green, blue) &&
              !isDecorParchmentPixel(red, green, blue)
            ) {
              break;
            }
          } else if (interiorGrid[gridIndex]) {
            break;
          }
        }

        interiorGrid[gridIndex] = 0;
        break;
      }
    }
  }
  return interiorGrid;
}

/** Decor bands: compass/title always bright; lower margin keeps unrevealed room floor black. */
export const BASEMENT_DECOR_ZONES = [
  { minX: 0, maxX: 0.4, minY: 0, maxY: 0.22 },
  { minX: 0, maxX: 0.4, minY: 0.22, maxY: 0.3, preserveWalkableFloor: true },
  { minX: 0.32, maxX: 1, minY: 0, maxY: 0.13 },
];

/** Dungeon Level — full title block (Dungeon + Level) and scale legend. */
export const DUNGEON_LEVEL_DECOR_ZONES = [
  { minX: 0, maxX: 0.56, minY: 0.76, maxY: 1, brightDecorParchmentOnly: true },
  { minX: 0.42, maxX: 1, minY: 0.955, maxY: 1, brightDecorParchmentOnly: true },
];

const DEFAULT_DECOR_ZONES = BASEMENT_DECOR_ZONES;

function mergeInteriorGrids(...grids) {
  if (!grids.length) return new Uint8Array(0);
  const length = grids[0].length;
  const merged = new Uint8Array(length);
  for (const grid of grids) {
    for (let index = 0; index < length; index += 1) {
      if (grid[index]) merged[index] = 1;
    }
  }
  return merged;
}

function dilateMask(mask, width, height, radius) {
  if (radius <= 0) return mask;
  const output = new Uint8Array(mask.length);
  for (let pixelY = 0; pixelY < height; pixelY += 1) {
    for (let pixelX = 0; pixelX < width; pixelX += 1) {
      const gridIndex = pixelY * width + pixelX;
      if (!mask[gridIndex]) continue;
      for (let offsetY = -radius; offsetY <= radius; offsetY += 1) {
        for (let offsetX = -radius; offsetX <= radius; offsetX += 1) {
          const neighbourX = pixelX + offsetX;
          const neighbourY = pixelY + offsetY;
          if (neighbourX < 0 || neighbourY < 0 || neighbourX >= width || neighbourY >= height) {
            continue;
          }
          output[neighbourY * width + neighbourX] = 1;
        }
      }
    }
  }
  return output;
}

async function readReferencePixels(colouredReferencePath) {
  return sharp(colouredReferencePath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
}

function resizeInt16Grid(grid, sourceWidth, sourceHeight, targetWidth, targetHeight) {
  const output = new Int16Array(targetWidth * targetHeight);
  for (let targetY = 0; targetY < targetHeight; targetY += 1) {
    for (let targetX = 0; targetX < targetWidth; targetX += 1) {
      const sourceX = Math.min(
        sourceWidth - 1,
        Math.round((targetX / Math.max(1, targetWidth - 1)) * (sourceWidth - 1))
      );
      const sourceY = Math.min(
        sourceHeight - 1,
        Math.round((targetY / Math.max(1, targetHeight - 1)) * (sourceHeight - 1))
      );
      output[targetY * targetWidth + targetX] = grid[sourceY * sourceWidth + sourceX];
    }
  }
  return output;
}

function resizeUint8Grid(grid, sourceWidth, sourceHeight, targetWidth, targetHeight) {
  const output = new Uint8Array(targetWidth * targetHeight);
  for (let targetY = 0; targetY < targetHeight; targetY += 1) {
    for (let targetX = 0; targetX < targetWidth; targetX += 1) {
      const sourceX = Math.min(
        sourceWidth - 1,
        Math.round((targetX / Math.max(1, targetWidth - 1)) * (sourceWidth - 1))
      );
      const sourceY = Math.min(
        sourceHeight - 1,
        Math.round((targetY / Math.max(1, targetHeight - 1)) * (sourceHeight - 1))
      );
      output[targetY * targetWidth + targetX] = grid[sourceY * sourceWidth + sourceX];
    }
  }
  return output;
}

export async function buildRegionGridFromReference({
  colouredReferencePath,
  targetWidth,
  targetHeight,
  regions = DEATH_HOUSE_BASEMENT_REGIONS,
  alignment = DEFAULT_DEATH_HOUSE_ALIGNMENT,
}) {
  const { data, info } = await readReferencePixels(colouredReferencePath);
  const { width: sourceWidth, height: sourceHeight, channels } = info;
  const result = buildRegionGrid({
    data,
    width: sourceWidth,
    height: sourceHeight,
    channels,
    regions,
  });

  console.log(`Reference grid: ${sourceWidth}x${sourceHeight} -> map ${targetWidth}x${targetHeight}`);
  console.log(
    `Alignment: scale (${alignment.scaleX.toFixed(4)}, ${alignment.scaleY.toFixed(4)}), offset (${alignment.offsetX.toFixed(1)}, ${alignment.offsetY.toFixed(1)})`
  );

  console.log("\nRegion assignment:");
  for (const stat of result.fillStats) {
    const componentLabel = stat.componentIds?.length ? stat.componentIds.join("+") : "none";
    console.log(
      `  Region ${stat.id} (${stat.family} ${componentLabel}): ${stat.filledCount} px`
    );
    if (stat.filledCount < 100) {
      console.warn(`    WARNING: Very small region — check seed for region ${stat.id}`);
    }
  }

  const regionGrid =
    sourceWidth === targetWidth && sourceHeight === targetHeight
      ? result.regionGrid
      : remapInt16GridToMap(
          result.regionGrid,
          sourceWidth,
          sourceHeight,
          targetWidth,
          targetHeight,
          alignment
        );

  return {
    regionGrid,
    sourceRegionGrid: result.regionGrid,
    fillStats: result.fillStats,
    sourceWidth,
    sourceHeight,
    alignment,
  };
}

export async function buildInteriorMaskFromReference({
  colouredReferencePath,
  targetMapPath,
  targetWidth,
  targetHeight,
  sourceRegionGrid,
  sourceWidth,
  sourceHeight,
  alignment = DEFAULT_DEATH_HOUSE_ALIGNMENT,
}) {
  const { data, info } = await readReferencePixels(colouredReferencePath);
  const { width, height, channels } = info;
  const barrierGrid = buildBarrierGrid(data, width, height, channels);
  const overlayInterior = buildOverlayGrid(data, width, height, channels, barrierGrid);

  const revealedInterior = await buildInteriorFromRevealedMap(
    targetMapPath,
    width,
    height
  );
  const regionInterior = buildInteriorGridFromRegions(sourceRegionGrid);

  let interiorGrid = mergeInteriorGrids(
    overlayInterior,
    revealedInterior,
    regionInterior
  );
  interiorGrid = dilateMask(interiorGrid, width, height, 4);

  const dungeonBounds = computeMaskBounds(
    mergeInteriorGrids(overlayInterior, regionInterior),
    width,
    height,
    10
  );
  interiorGrid = clipInteriorToDungeonBounds(interiorGrid, width, height, dungeonBounds);
  interiorGrid = dilateMask(interiorGrid, width, height, 2);
  const { data: mapPixels, channels: mapChannels } = await readTargetMapPixels(
    targetMapPath,
    width,
    height
  );
  interiorGrid = excludeDecorZones(
    interiorGrid,
    width,
    height,
    DEFAULT_DECOR_ZONES,
    mapPixels,
    mapChannels
  );

  if (width !== targetWidth || height !== targetHeight) {
    interiorGrid = remapUint8GridToMap(
      interiorGrid,
      width,
      height,
      targetWidth,
      targetHeight,
      alignment
    );
    interiorGrid = dilateMask(interiorGrid, targetWidth, targetHeight, 1);
    const { data: targetMapPixels, channels: targetMapChannels } =
      await readTargetMapPixels(targetMapPath, targetWidth, targetHeight);
    interiorGrid = excludeDecorZones(
      interiorGrid,
      targetWidth,
      targetHeight,
      DEFAULT_DECOR_ZONES,
      targetMapPixels,
      targetMapChannels
    );
  }

  let interiorPixelCount = 0;
  for (let index = 0; index < interiorGrid.length; index += 1) {
    if (interiorGrid[index]) interiorPixelCount += 1;
  }
  console.log(`Interior mask: ${interiorPixelCount} px`);

  return interiorGrid;
}

/** Interior mask derived only from the playable map art (no coloured reference). */
export async function buildInteriorMaskFromMapOnly(
  targetMapPath,
  targetWidth,
  targetHeight,
  options = {}
) {
  let interiorGrid = await buildInteriorFromRevealedMap(
    targetMapPath,
    targetWidth,
    targetHeight
  );

  interiorGrid = dilateMask(interiorGrid, targetWidth, targetHeight, 2);

  if (options.expandInteriorFromCropStencils && options.manualCropOverrides) {
    interiorGrid = await expandInteriorFromManualCropStencils(
      interiorGrid,
      targetWidth,
      targetHeight,
      options.layersDirectory,
      options.manualCropOverrides,
      options.expandInteriorFromCropStencils
    );
  }

  const decorZones = options.decorZones || DEFAULT_DECOR_ZONES;
  const { data: mapPixels, channels: mapChannels } = await readTargetMapPixels(
    targetMapPath,
    targetWidth,
    targetHeight
  );
  interiorGrid = excludeDecorZones(
    interiorGrid,
    targetWidth,
    targetHeight,
    decorZones,
    mapPixels,
    mapChannels
  );

  const dungeonBounds = computeMaskBounds(interiorGrid, targetWidth, targetHeight, 8);
  interiorGrid = clipInteriorToDungeonBounds(
    interiorGrid,
    targetWidth,
    targetHeight,
    dungeonBounds
  );

  let interiorPixelCount = 0;
  for (let index = 0; index < interiorGrid.length; index += 1) {
    if (interiorGrid[index]) interiorPixelCount += 1;
  }
  console.log(`Interior mask (map-only): ${interiorPixelCount} px`);

  return interiorGrid;
}
