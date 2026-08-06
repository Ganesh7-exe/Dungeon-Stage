/**
 * Generate Fog-of-War region masks for Death House basement from the coloured
 * reference layout. Run once after editing seeds or reference art:
 *
 *   node scripts/generate-death-house-fow-masks.mjs
 *
 * Outputs PNG masks under public/maps/death-house-basement/fow/
 */
import sharp from "sharp";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const MAP_ID = "death-house-basement";
const paths = {
  colouredReference: path.join(
    root,
    `public/maps/${MAP_ID}/reference/region-mask-coloured.png`
  ),
  targetMap: path.join(root, `public/maps/${MAP_ID}.png`),
  outputDir: path.join(root, `public/maps/${MAP_ID}/fow`),
};

/** Feather radius applied when baking masks (matches runtime shader). */
const FEATHER_RADIUS = 4;

/**
 * Normalized seed points on the coloured reference (0–1).
 * Tuned against region-mask-coloured.png — one seed per reveal button.
 */
export const DEATH_HOUSE_BASEMENT_REGIONS = [
  { id: 25, label: "Room 25 (west hall A–E)", seed: { x: 0.17, y: 0.46 } },
  { id: 21, label: "Room 21 (upper central)", seed: { x: 0.45, y: 0.17 } },
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
  { id: 14, label: "Room 14 (isolated south room)", seed: { x: 0.38, y: 0.94 } },
];

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

function colourDistance(left, right) {
  const deltaRed = left.r - right.r;
  const deltaGreen = left.g - right.g;
  const deltaBlue = left.b - right.b;
  return Math.sqrt(deltaRed * deltaRed + deltaGreen * deltaGreen + deltaBlue * deltaBlue);
}

function pixelSaturation(red, green, blue) {
  const maxChannel = Math.max(red, green, blue);
  const minChannel = Math.min(red, green, blue);
  return maxChannel > 0 ? (maxChannel - minChannel) / maxChannel : 0;
}

function readPixels(imagePath) {
  return sharp(imagePath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
}

function floodFillRegion({
  data,
  width,
  height,
  channels,
  seedX,
  seedY,
  regionId,
  regionGrid,
  barrierGrid,
  seedHue,
  hueTolerance,
  minSaturation,
}) {
  const queue = [[seedX, seedY]];
  let filledCount = 0;

  while (queue.length) {
    const [pixelX, pixelY] = queue.pop();
    const gridIndex = pixelY * width + pixelX;

    if (regionGrid[gridIndex] !== 0) continue;
    if (barrierGrid[gridIndex]) continue;

    const bufferIndex = gridIndex * channels;
    const red = data[bufferIndex];
    const green = data[bufferIndex + 1];
    const blue = data[bufferIndex + 2];

    if (isParchment(red, green, blue)) continue;

    const saturation = pixelSaturation(red, green, blue);
    if (saturation < minSaturation) continue;

    const pixelHue = rgbToHue(red, green, blue);
    if (seedHue >= 0 && pixelHue >= 0 && hueDistance(seedHue, pixelHue) > hueTolerance) {
      continue;
    }

    regionGrid[gridIndex] = regionId;
    filledCount += 1;

    if (pixelX > 0) queue.push([pixelX - 1, pixelY]);
    if (pixelX < width - 1) queue.push([pixelX + 1, pixelY]);
    if (pixelY > 0) queue.push([pixelX, pixelY - 1]);
    if (pixelY < height - 1) queue.push([pixelX, pixelY + 1]);
  }

  return filledCount;
}

/** Partition lines are hand-drawn and thin — dilate so they block flood fills. */
const YELLOW_BARRIER_RADIUS = 8;

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

function hueDistance(leftHue, rightHue) {
  if (leftHue < 0 || rightHue < 0) return 0;
  const delta = Math.abs(leftHue - rightHue);
  return Math.min(delta, 360 - delta);
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

function buildFamilyGrid(data, width, height, channels, barrierGrid) {
  const familyGrid = new Uint8Array(width * height);
  const familyCodes = {
    none: 0,
    cyan: 1,
    orange: 2,
    yellow: 3,
    magenta: 4,
    green: 5,
    brown: 6,
  };

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
      familyGrid[gridIndex] = familyCodes[family] || 0;
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

/** Curated component IDs — use componentIds[] when a region spans multiple islands. */
const MANUAL_COMPONENT_MAP = {
  14: { family: "yellow", componentIds: [2257] },
  21: { family: "orange", componentIds: [1] },
  23: {
    family: "yellow",
    componentIds: [358, 363, 369, 382, 388, 391, 392, 630, 830, 872, 894, 925],
  },
  25: { family: "cyan", componentIds: [32] },
  26: { family: "green", componentIds: [188] },
  27: { family: "magenta", componentIds: [156] },
  29: { family: "orange", componentIds: [1168] },
  30: { family: "yellow", componentIds: [1536] },
  31: { family: "cyan", componentIds: [67] },
  33: { family: "green", componentIds: [302] },
};

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

/** Label each contiguous overlay island (yellow lines are hard walls). */
function labelConnectedComponents(overlayGrid, width, height) {
  const componentGrid = new Int32Array(width * height);
  let nextComponentId = 1;
  const componentSizes = new Map();

  for (let seedY = 0; seedY < height; seedY += 1) {
    for (let seedX = 0; seedX < width; seedX += 1) {
      const seedIndex = seedY * width + seedX;
      if (!overlayGrid[seedIndex] || componentGrid[seedIndex] !== 0) continue;

      const queue = [[seedX, seedY]];
      componentGrid[seedIndex] = nextComponentId;
      let size = 0;

      while (queue.length) {
        const [pixelX, pixelY] = queue.pop();
        const gridIndex = pixelY * width + pixelX;
        if (componentGrid[gridIndex] !== nextComponentId) continue;
        size += 1;

        if (pixelX > 0) {
          const neighbourIndex = gridIndex - 1;
          if (overlayGrid[neighbourIndex] && componentGrid[neighbourIndex] === 0) {
            componentGrid[neighbourIndex] = nextComponentId;
            queue.push([pixelX - 1, pixelY]);
          }
        }
        if (pixelX < width - 1) {
          const neighbourIndex = gridIndex + 1;
          if (overlayGrid[neighbourIndex] && componentGrid[neighbourIndex] === 0) {
            componentGrid[neighbourIndex] = nextComponentId;
            queue.push([pixelX + 1, pixelY]);
          }
        }
        if (pixelY > 0) {
          const neighbourIndex = gridIndex - width;
          if (overlayGrid[neighbourIndex] && componentGrid[neighbourIndex] === 0) {
            componentGrid[neighbourIndex] = nextComponentId;
            queue.push([pixelX, pixelY - 1]);
          }
        }
        if (pixelY < height - 1) {
          const neighbourIndex = gridIndex + width;
          if (overlayGrid[neighbourIndex] && componentGrid[neighbourIndex] === 0) {
            componentGrid[neighbourIndex] = nextComponentId;
            queue.push([pixelX, pixelY + 1]);
          }
        }
      }

      componentSizes.set(nextComponentId, size);
      nextComponentId += 1;
    }
  }

  return { componentGrid, componentSizes };
}

const FAMILY_CODES = {
  cyan: 1,
  orange: 2,
  yellow: 3,
  magenta: 4,
  green: 5,
  brown: 6,
};

/** Fallback family when no manual component map entry exists. */
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

  for (const region of regions) {
    const seedX = Math.round(region.seed.x * (width - 1));
    const seedY = Math.round(region.seed.y * (height - 1));
    const bufferIndex = (seedY * width + seedX) * channels;
    const seedColour = {
      r: data[bufferIndex],
      g: data[bufferIndex + 1],
      b: data[bufferIndex + 2],
    };

    const manualEntry = MANUAL_COMPONENT_MAP[region.id];
    const familyName = manualEntry?.family || REGION_COLOUR_FAMILY[region.id] || "brown";
    const familyCode = FAMILY_CODES[familyName];
    const cacheKey = String(familyCode);

    if (!familyComponentCache.has(cacheKey)) {
      familyComponentCache.set(
        cacheKey,
        labelFamilyComponents(familyGrid, width, height, familyCode)
      );
    }

    const { componentGrid, componentSizes } = familyComponentCache.get(cacheKey);
    const componentIds = manualEntry?.componentIds?.length
      ? manualEntry.componentIds
      : manualEntry?.componentId
        ? [manualEntry.componentId]
        : [findComponentAtSeed(componentGrid, width, height, seedX, seedY)].filter(Boolean);

    let filledCount = 0;
    for (const componentId of componentIds) {
      if (!componentId || claimedComponents.has(`${cacheKey}:${componentId}`)) continue;
      claimedComponents.add(`${cacheKey}:${componentId}`);
      for (let index = 0; index < componentGrid.length; index += 1) {
        if (componentGrid[index] === componentId) {
          regionGrid[index] = region.id;
          filledCount += 1;
        }
      }
    }

    fillStats.push({
      id: region.id,
      filledCount,
      seedColour,
      seedX,
      seedY,
      family: familyName,
      componentIds,
      componentSize: componentIds.reduce(
        (sum, componentId) => sum + (componentSizes.get(componentId) || 0),
        0
      ),
    });
  }

  fillStats.sort((left, right) => left.id - right.id);

  console.log("\nFamily component assignment:");
  for (const stat of fillStats) {
    const componentLabel = stat.componentIds?.length
      ? stat.componentIds.join("+")
      : "none";
    console.log(
      `  Region ${stat.id} (${stat.family} ${componentLabel}): ${stat.filledCount} px`
    );
  }

  return { regionGrid, fillStats, barrierGrid };
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
        luma >= 0.34 &&
        saturation < 0.34 &&
        !warmParchment &&
        luma >= 0.16;

      if (creamFloor) {
        interiorGrid[gridIndex] = 1;
      }
    }
  }

  interiorGrid = dilateMask(interiorGrid, width, height, 3);
  return interiorGrid;
}

function buildInteriorGridFromRegions(regionGrid, width, height) {
  const interiorGrid = new Uint8Array(width * height);
  for (let index = 0; index < regionGrid.length; index += 1) {
    if (regionGrid[index] > 0) interiorGrid[index] = 1;
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

function excludeDecorZones(interiorGrid, width, height) {
  for (let pixelY = 0; pixelY < height; pixelY += 1) {
    for (let pixelX = 0; pixelX < width; pixelX += 1) {
      const normalizedX = pixelX / (width - 1);
      const normalizedY = pixelY / (height - 1);
      const gridIndex = pixelY * width + pixelX;
      const isCompassZone = normalizedX < 0.22 && normalizedY < 0.17;
      const isTitleZone = normalizedY < 0.13 && normalizedX > 0.32;
      if (isCompassZone || isTitleZone) {
        interiorGrid[gridIndex] = 0;
      }
    }
  }
  return interiorGrid;
}

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

function applyFeather(alphaChannel, width, height, radius) {
  if (radius <= 0) return alphaChannel;
  const output = new Float32Array(alphaChannel.length);
  const kernelSize = radius * 2 + 1;
  const kernelArea = kernelSize * kernelSize;

  for (let pixelY = 0; pixelY < height; pixelY += 1) {
    for (let pixelX = 0; pixelX < width; pixelX += 1) {
      let sum = 0;
      for (let offsetY = -radius; offsetY <= radius; offsetY += 1) {
        for (let offsetX = -radius; offsetX <= radius; offsetX += 1) {
          const sampleX = Math.min(width - 1, Math.max(0, pixelX + offsetX));
          const sampleY = Math.min(height - 1, Math.max(0, pixelY + offsetY));
          sum += alphaChannel[sampleY * width + sampleX];
        }
      }
      output[pixelY * width + pixelX] = sum / kernelArea;
    }
  }

  return Uint8Array.from(output, (value) => Math.round(value * 255));
}

function maskToRgbaBuffer(mask, width, height, featherRadius) {
  const floatAlpha = new Float32Array(width * height);
  for (let index = 0; index < mask.length; index += 1) {
    floatAlpha[index] = mask[index] ? 1 : 0;
  }
  const alpha = applyFeather(floatAlpha, width, height, featherRadius);
  const rgba = Buffer.alloc(width * height * 4);
  for (let index = 0; index < width * height; index += 1) {
    const offset = index * 4;
    rgba[offset] = 255;
    rgba[offset + 1] = 255;
    rgba[offset + 2] = 255;
    rgba[offset + 3] = alpha[index];
  }
  return rgba;
}

async function resizeMaskToMap(maskRgba, refWidth, refHeight, mapWidth, mapHeight) {
  return sharp(maskRgba, { raw: { width: refWidth, height: refHeight, channels: 4 } })
    .resize(mapWidth, mapHeight, { kernel: sharp.kernel.lanczos3 })
    .png()
    .toBuffer();
}

async function writeMaskPng(buffer, filePath) {
  await fs.promises.writeFile(filePath, buffer);
}

async function main() {
  fs.mkdirSync(paths.outputDir, { recursive: true });

  const [{ data, info }, mapMeta] = await Promise.all([
    readPixels(paths.colouredReference),
    sharp(paths.targetMap).metadata(),
  ]);

  const { width, height, channels } = info;
  const mapWidth = mapMeta.width;
  const mapHeight = mapMeta.height;

  console.log(`Reference: ${width}x${height}`);
  console.log(`Target map: ${mapWidth}x${mapHeight}`);

  const { regionGrid, fillStats, barrierGrid } = buildRegionGrid({
    data,
    width,
    height,
    channels,
    regions: DEATH_HOUSE_BASEMENT_REGIONS,
  });

  console.log("\nRegion fill stats:");
  for (const stat of fillStats) {
    console.log(
      `  Region ${stat.id} (${stat.family}): ${stat.filledCount} px`
    );
    if (stat.filledCount < 100) {
      console.warn(`    WARNING: Very small region — check seed for region ${stat.id}`);
    }
  }

  const overlayInterior = buildOverlayGrid(data, width, height, channels, barrierGrid);
  const revealedInterior = await buildInteriorFromRevealedMap(
    paths.targetMap,
    width,
    height
  );
  const regionInterior = buildInteriorGridFromRegions(regionGrid, width, height);

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
  interiorGrid = excludeDecorZones(interiorGrid, width, height);

  let interiorPixelCount = 0;
  for (let index = 0; index < interiorGrid.length; index += 1) {
    if (interiorGrid[index]) interiorPixelCount += 1;
  }
  console.log(`Interior mask: ${interiorPixelCount} px`);

  const manifest = {
    mapId: MAP_ID,
    referenceSize: { width, height },
    mapSize: { width: mapWidth, height: mapHeight },
    featherRadius: FEATHER_RADIUS,
    regions: DEATH_HOUSE_BASEMENT_REGIONS.map((region) => ({
      id: region.id,
      label: region.label,
      seed: region.seed,
      maskFile: `/maps/${MAP_ID}/fow/region-${region.id}.png`,
      pixelCount: fillStats.find((stat) => stat.id === region.id)?.filledCount ?? 0,
    })),
    interiorMaskFile: `/maps/${MAP_ID}/fow/interior-mask.png`,
    regionIds: DEATH_HOUSE_BASEMENT_REGIONS.map((region) => region.id),
  };

  for (const region of DEATH_HOUSE_BASEMENT_REGIONS) {
    const regionMask = new Uint8Array(width * height);
    for (let index = 0; index < regionGrid.length; index += 1) {
      regionMask[index] = regionGrid[index] === region.id ? 1 : 0;
    }

    const rgba = maskToRgbaBuffer(regionMask, width, height, FEATHER_RADIUS);
    const resized = await resizeMaskToMap(rgba, width, height, mapWidth, mapHeight);
    const outputPath = path.join(paths.outputDir, `region-${region.id}.png`);
    await writeMaskPng(resized, outputPath);
    console.log(`Wrote ${path.relative(root, outputPath)}`);
  }

  const interiorRgba = maskToRgbaBuffer(interiorGrid, width, height, 2);
  const interiorResized = await resizeMaskToMap(
    interiorRgba,
    width,
    height,
    mapWidth,
    mapHeight
  );
  const interiorPath = path.join(paths.outputDir, "interior-mask.png");
  await writeMaskPng(interiorResized, interiorPath);
  console.log(`Wrote ${path.relative(root, interiorPath)}`);

  const manifestPath = path.join(paths.outputDir, "manifest.json");
  await fs.promises.writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(`Wrote ${path.relative(root, manifestPath)}`);

  const debugRgba = Buffer.alloc(width * height * 4);
  const palette = {
    14: [255, 255, 0],
    21: [255, 140, 0],
    23: [255, 255, 0],
    25: [0, 255, 255],
    26: [0, 200, 0],
    27: [200, 0, 200],
    29: [255, 120, 0],
    30: [255, 220, 0],
    31: [0, 180, 255],
    33: [0, 255, 100],
  };
  for (let index = 0; index < regionGrid.length; index += 1) {
    const regionId = regionGrid[index];
    const offset = index * 4;
    if (regionId > 0 && palette[regionId]) {
      const [red, green, blue] = palette[regionId];
      debugRgba[offset] = red;
      debugRgba[offset + 1] = green;
      debugRgba[offset + 2] = blue;
      debugRgba[offset + 3] = 140;
    }
  }
  const debugPath = path.join(paths.outputDir, "debug-regions.png");
  await sharp(debugRgba, { raw: { width, height, channels: 4 } })
    .resize(mapWidth, mapHeight)
    .png()
    .toFile(debugPath);
  console.log(`Wrote ${path.relative(root, debugPath)} (QA overlay)`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
