/**
 * Place tight manual region PNGs onto full-map crop layers with auto-alignment.
 */
import sharp from "sharp";
import fs from "fs";
import path from "path";

function buildOpacityMask(data, width, height, channels) {
  const mask = new Uint8Array(width * height);
  for (let index = 0; index < width * height; index += 1) {
    const alpha = channels > 3 ? data[index * channels + 3] : 255;
    mask[index] = alpha > 20 ? 1 : 0;
  }
  return mask;
}

function buildGray(data, width, height, channels) {
  const gray = new Float32Array(width * height);
  for (let index = 0; index < width * height; index += 1) {
    const offset = index * channels;
    gray[index] = (data[offset] + data[offset + 1] + data[offset + 2]) / 3;
  }
  return gray;
}

function isParchment(red, green, blue) {
  const maxChannel = Math.max(red, green, blue);
  const minChannel = Math.min(red, green, blue);
  const saturation = maxChannel > 0 ? (maxChannel - minChannel) / maxChannel : 0;
  const warmBrown = red >= green && green >= blue * 0.85;
  return saturation < 0.22 && warmBrown && maxChannel > 60 && maxChannel < 230;
}

export async function findManualCropPlacement({
  manualCropPath,
  mapPath,
  searchRegion = { minX: 0, maxX: 280, minY: 200, maxY: 550 },
}) {
  const [manual, map] = await Promise.all([
    sharp(manualCropPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
    sharp(mapPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
  ]);

  const cropWidth = manual.info.width;
  const cropHeight = manual.info.height;
  const mapWidth = map.info.width;
  const mapHeight = map.info.height;
  const manualMask = buildOpacityMask(
    manual.data,
    cropWidth,
    cropHeight,
    manual.info.channels
  );
  const manualGray = buildGray(manual.data, cropWidth, cropHeight, manual.info.channels);
  const mapGray = buildGray(map.data, mapWidth, mapHeight, map.info.channels);

  let bestMatch = { score: Infinity, offsetX: 0, offsetY: 0, pixelCount: 0 };

  for (
    let offsetY = searchRegion.minY;
    offsetY <= searchRegion.maxY;
    offsetY += 1
  ) {
    for (
      let offsetX = searchRegion.minX;
      offsetX <= searchRegion.maxX;
      offsetX += 1
    ) {
      if (offsetX + cropWidth >= mapWidth || offsetY + cropHeight >= mapHeight) continue;

      let score = 0;
      let pixelCount = 0;
      for (let cropY = 0; cropY < cropHeight; cropY += 1) {
        for (let cropX = 0; cropX < cropWidth; cropX += 1) {
          const cropIndex = cropY * cropWidth + cropX;
          if (!manualMask[cropIndex]) continue;
          const mapIndex = (offsetY + cropY) * mapWidth + (offsetX + cropX);
          const delta = manualGray[cropIndex] - mapGray[mapIndex];
          score += delta * delta;
          pixelCount += 1;
        }
      }

      if (!pixelCount) continue;
      const averageScore = score / pixelCount;
      if (averageScore < bestMatch.score) {
        bestMatch = { score: averageScore, offsetX, offsetY, pixelCount };
      }
    }
  }

  return bestMatch;
}

function isNearBlack(red, green, blue, threshold = 40) {
  return red < threshold && green < threshold && blue < threshold;
}

function isMapExteriorPixel(red, green, blue) {
  const luma = (red + green + blue) / (255 * 3);
  const maxChannel = Math.max(red, green, blue);
  const minChannel = Math.min(red, green, blue);
  const saturation = maxChannel > 0 ? (maxChannel - minChannel) / maxChannel : 0;
  if (luma > 0.48) return false;
  if (luma < 0.07) return true;
  return saturation > 0.04 && saturation < 0.4 && luma > 0.1 && luma < 0.48;
}

function isCropExteriorPixel(red, green, blue) {
  const luma = (red + green + blue) / (255 * 3);
  const maxChannel = Math.max(red, green, blue);
  const minChannel = Math.min(red, green, blue);
  const saturation = maxChannel > 0 ? (maxChannel - minChannel) / maxChannel : 0;
  if (luma > 0.58) return false;
  if (isParchment(red, green, blue)) return true;
  return luma > 0.28 && luma < 0.58 && saturation > 0.05 && saturation < 0.42;
}

function isDungeonWalkablePixel(red, green, blue) {
  const luma = (red + green + blue) / (255 * 3);
  if (luma < 0.06) return false;
  const maxChannel = Math.max(red, green, blue);
  const minChannel = Math.min(red, green, blue);
  const saturation = maxChannel > 0 ? (maxChannel - minChannel) / maxChannel : 0;
  if (luma < 0.48 && saturation > 0.04 && saturation < 0.4 && luma > 0.1) {
    return false;
  }
  return true;
}

function findBrightFloodFillSeed(mapData, mapWidth, channels, bounds) {
  let bestMapIndex = bounds.minY * mapWidth + bounds.minX;
  let bestLuma = 0;
  for (let mapY = bounds.minY; mapY <= bounds.maxY; mapY += 1) {
    for (let mapX = bounds.minX; mapX <= bounds.maxX; mapX += 1) {
      const mapIndex = mapY * mapWidth + mapX;
      const mapOffset = mapIndex * channels;
      const red = mapData[mapOffset];
      const green = mapData[mapOffset + 1];
      const blue = mapData[mapOffset + 2];
      const luma = (red + green + blue) / (255 * 3);
      if (luma > bestLuma && isDungeonWalkablePixel(red, green, blue)) {
        bestLuma = luma;
        bestMapIndex = mapIndex;
      }
    }
  }
  return {
    mapX: bestMapIndex % mapWidth,
    mapY: Math.floor(bestMapIndex / mapWidth),
    luma: bestLuma,
  };
}

function buildFloodFillMask(
  mapData,
  mapWidth,
  mapHeight,
  channels,
  seedX,
  seedY,
  bounds
) {
  const mask = new Uint8Array(mapWidth * mapHeight);
  const visited = new Uint8Array(mapWidth * mapHeight);
  const queue = [seedY * mapWidth + seedX];

  while (queue.length) {
    const mapIndex = queue.pop();
    if (visited[mapIndex]) continue;

    const mapX = mapIndex % mapWidth;
    const mapY = Math.floor(mapIndex / mapWidth);
    if (
      mapX < bounds.minX ||
      mapX > bounds.maxX ||
      mapY < bounds.minY ||
      mapY > bounds.maxY
    ) {
      continue;
    }

    const mapOffset = mapIndex * channels;
    const red = mapData[mapOffset];
    const green = mapData[mapOffset + 1];
    const blue = mapData[mapOffset + 2];
    if (!isDungeonWalkablePixel(red, green, blue)) continue;

    visited[mapIndex] = 1;
    mask[mapIndex] = 1;

    if (mapX > bounds.minX) queue.push(mapIndex - 1);
    if (mapX < bounds.maxX) queue.push(mapIndex + 1);
    if (mapY > bounds.minY) queue.push(mapIndex - mapWidth);
    if (mapY < bounds.maxY) queue.push(mapIndex + mapWidth);
  }

  return mask;
}

function buildCropStencilMask(manualData, channels, cropWidth, cropHeight, offsetX, offsetY, mapWidth, mapHeight) {
  const stencil = new Uint8Array(mapWidth * mapHeight);
  for (let cropY = 0; cropY < cropHeight; cropY += 1) {
    for (let cropX = 0; cropX < cropWidth; cropX += 1) {
      const mapX = offsetX + cropX;
      const mapY = offsetY + cropY;
      if (mapX < 0 || mapY < 0 || mapX >= mapWidth || mapY >= mapHeight) continue;

      const manualOffset = (cropY * cropWidth + cropX) * channels;
      const red = manualData[manualOffset];
      const green = manualData[manualOffset + 1];
      const blue = manualData[manualOffset + 2];
      const sourceAlpha = channels > 3 ? manualData[manualOffset + 3] : 255;
      if (sourceAlpha < 20 || isNearBlack(red, green, blue)) continue;

      stencil[mapY * mapWidth + mapX] = 1;
    }
  }
  return stencil;
}

function composeMaskedWalkableCropLayer({
  mapData,
  mapWidth,
  mapHeight,
  channels,
  stencilMask,
}) {
  const visited = new Uint8Array(mapWidth * mapHeight);
  const revealMask = new Uint8Array(mapWidth * mapHeight);
  let componentCount = 0;
  let skippedExteriorComponents = 0;

  for (let mapIndex = 0; mapIndex < stencilMask.length; mapIndex += 1) {
    if (!stencilMask[mapIndex] || visited[mapIndex]) continue;

    componentCount += 1;
    const componentIndices = [];
    const queue = [mapIndex];
    visited[mapIndex] = 1;

    while (queue.length) {
      const currentIndex = queue.pop();
      componentIndices.push(currentIndex);
      const mapX = currentIndex % mapWidth;
      const mapY = Math.floor(currentIndex / mapWidth);

      const neighbors = [
        mapX > 0 ? currentIndex - 1 : -1,
        mapX < mapWidth - 1 ? currentIndex + 1 : -1,
        mapY > 0 ? currentIndex - mapWidth : -1,
        mapY < mapHeight - 1 ? currentIndex + mapWidth : -1,
      ];

      for (const neighborIndex of neighbors) {
        if (neighborIndex < 0 || visited[neighborIndex] || !stencilMask[neighborIndex]) {
          continue;
        }
        visited[neighborIndex] = 1;
        queue.push(neighborIndex);
      }
    }

    let includesWalkableFloor = false;
    for (const componentIndex of componentIndices) {
      const mapOffset = componentIndex * channels;
      if (
        isDungeonWalkablePixel(
          mapData[mapOffset],
          mapData[mapOffset + 1],
          mapData[mapOffset + 2]
        )
      ) {
        includesWalkableFloor = true;
        break;
      }
    }

    if (!includesWalkableFloor) {
      skippedExteriorComponents += componentIndices.length;
      continue;
    }

    for (const componentIndex of componentIndices) {
      revealMask[componentIndex] = 1;
    }
  }

  const cropRgba = Buffer.alloc(mapWidth * mapHeight * 4);
  let pixelCount = 0;
  for (let mapIndex = 0; mapIndex < revealMask.length; mapIndex += 1) {
    if (!revealMask[mapIndex]) continue;
    const mapOffset = mapIndex * channels;
    const outputOffset = mapIndex * 4;
    cropRgba[outputOffset] = mapData[mapOffset];
    cropRgba[outputOffset + 1] = mapData[mapOffset + 1];
    cropRgba[outputOffset + 2] = mapData[mapOffset + 2];
    cropRgba[outputOffset + 3] = 255;
    pixelCount += 1;
  }

  return { cropRgba, pixelCount, componentCount, skippedExteriorComponents };
}

function composeFloodFillCropLayer({
  mapData,
  mapWidth,
  mapHeight,
  channels,
  offsetX,
  offsetY,
  cropWidth,
  cropHeight,
}) {
  const bounds = {
    minX: offsetX,
    maxX: offsetX + cropWidth - 1,
    minY: offsetY,
    maxY: offsetY + cropHeight - 1,
  };
  const seed = findBrightFloodFillSeed(mapData, mapWidth, channels, bounds);
  const fillMask = buildFloodFillMask(
    mapData,
    mapWidth,
    mapHeight,
    channels,
    seed.mapX,
    seed.mapY,
    bounds
  );

  const cropRgba = Buffer.alloc(mapWidth * mapHeight * 4);
  let pixelCount = 0;

  for (let mapIndex = 0; mapIndex < fillMask.length; mapIndex += 1) {
    if (!fillMask[mapIndex]) continue;
    const mapOffset = mapIndex * channels;
    const outputOffset = mapIndex * 4;
    cropRgba[outputOffset] = mapData[mapOffset];
    cropRgba[outputOffset + 1] = mapData[mapOffset + 1];
    cropRgba[outputOffset + 2] = mapData[mapOffset + 2];
    cropRgba[outputOffset + 3] = 255;
    pixelCount += 1;
  }

  return { cropRgba, pixelCount, seed };
}

function shouldIncludeStencilPixel(
  cropRed,
  cropGreen,
  cropBlue,
  mapRed,
  mapGreen,
  mapBlue,
  composeOptions = {}
) {
  if (composeOptions.skipNearBlack !== false && isNearBlack(cropRed, cropGreen, cropBlue)) {
    return false;
  }
  if (isParchment(cropRed, cropGreen, cropBlue)) {
    return false;
  }

  if (composeOptions.minRevealLuma != null) {
    const cropLuma = (cropRed + cropGreen + cropBlue) / 3;
    const mapLuma = (mapRed + mapGreen + mapBlue) / 3;
    if (cropLuma >= composeOptions.minRevealLuma) {
      return true;
    }
    if (
      composeOptions.includeDarkFeatures &&
      cropLuma < 95 &&
      mapLuma > 25 &&
      mapLuma < 200
    ) {
      return true;
    }
    return false;
  }

  if (composeOptions.skipDualExterior) {
    if (
      isCropExteriorPixel(cropRed, cropGreen, cropBlue) &&
      isMapExteriorPixel(mapRed, mapGreen, mapBlue)
    ) {
      return false;
    }
  } else if (composeOptions.skipMapExterior) {
    if (isMapExteriorPixel(mapRed, mapGreen, mapBlue)) {
      return false;
    }
  }

  return true;
}

export async function composeManualCropLayer({
  manualCropPath,
  mapPath,
  mapWidth,
  mapHeight,
  offsetX,
  offsetY,
  interiorGrid = null,
  composeOptions = {},
}) {
  const manual = await sharp(manualCropPath).ensureAlpha().raw().toBuffer({
    resolveWithObject: true,
  });
  const map = await sharp(mapPath)
    .resize(mapWidth, mapHeight, { kernel: sharp.kernel.lanczos3 })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const cropWidth = manual.info.width;
  const cropHeight = manual.info.height;

  if (
    composeOptions.composeMode === "flood-fill" ||
    composeOptions.composeMode === "crop-mask-walkable"
  ) {
    const stencilMask = buildCropStencilMask(
      manual.data,
      manual.info.channels,
      cropWidth,
      cropHeight,
      offsetX,
      offsetY,
      mapWidth,
      mapHeight
    );

    if (composeOptions.composeMode === "crop-mask-walkable") {
      const maskedWalkableResult = composeMaskedWalkableCropLayer({
        mapData: map.data,
        mapWidth,
        mapHeight,
        channels: map.info.channels,
        stencilMask,
      });
      console.log(
        `  Crop-mask walkable fill: ${maskedWalkableResult.componentCount} components, ${maskedWalkableResult.pixelCount} px`
      );
      return {
        cropRgba: maskedWalkableResult.cropRgba,
        pixelCount: maskedWalkableResult.pixelCount,
        cropWidth,
        cropHeight,
      };
    }

    const floodFillResult = composeFloodFillCropLayer({
      mapData: map.data,
      mapWidth,
      mapHeight,
      channels: map.info.channels,
      offsetX,
      offsetY,
      cropWidth,
      cropHeight,
    });
    console.log(
      `  Flood-fill seed for crop at (${floodFillResult.seed.mapX}, ${floodFillResult.seed.mapY}), luma ${floodFillResult.seed.luma.toFixed(3)}`
    );
    return {
      cropRgba: floodFillResult.cropRgba,
      pixelCount: floodFillResult.pixelCount,
      cropWidth,
      cropHeight,
    };
  }

  const cropRgba = Buffer.alloc(mapWidth * mapHeight * 4);
  let pixelCount = 0;

  for (let cropY = 0; cropY < cropHeight; cropY += 1) {
    for (let cropX = 0; cropX < cropWidth; cropX += 1) {
      const mapX = offsetX + cropX;
      const mapY = offsetY + cropY;
      if (mapX < 0 || mapY < 0 || mapX >= mapWidth || mapY >= mapHeight) continue;

      const manualOffset = (cropY * cropWidth + cropX) * manual.info.channels;
      const red = manual.data[manualOffset];
      const green = manual.data[manualOffset + 1];
      const blue = manual.data[manualOffset + 2];
      const sourceAlpha = manual.info.channels > 3 ? manual.data[manualOffset + 3] : 255;

      if (sourceAlpha < 20) continue;

      const mapIndex = mapY * mapWidth + mapX;
      if (interiorGrid && !interiorGrid[mapIndex]) continue;

      const mapOffset = mapIndex * map.info.channels;
      const mapRed = map.data[mapOffset];
      const mapGreen = map.data[mapOffset + 1];
      const mapBlue = map.data[mapOffset + 2];

      if (
        !shouldIncludeStencilPixel(
          red,
          green,
          blue,
          mapRed,
          mapGreen,
          mapBlue,
          composeOptions
        )
      ) {
        continue;
      }

      if (!composeOptions.useMapColors && isParchment(red, green, blue)) continue;

      const outputOffset = mapIndex * 4;
      if (composeOptions.useMapColors) {
        cropRgba[outputOffset] = mapRed;
        cropRgba[outputOffset + 1] = mapGreen;
        cropRgba[outputOffset + 2] = mapBlue;
      } else {
        cropRgba[outputOffset] = red;
        cropRgba[outputOffset + 1] = green;
        cropRgba[outputOffset + 2] = blue;
      }
      cropRgba[outputOffset + 3] = 255;
      pixelCount += 1;
    }
  }

  return { cropRgba, pixelCount, cropWidth, cropHeight };
}

export async function loadManualCropOverrides(layersDirectory) {
  const overridesPath = path.join(layersDirectory, "manual-overrides.json");
  if (!fs.existsSync(overridesPath)) return {};
  return JSON.parse(await fs.promises.readFile(overridesPath, "utf8"));
}

export async function applyManualCropOverride({
  regionId,
  override,
  layersDirectory,
  mapPath,
  mapWidth,
  mapHeight,
  interiorGrid,
  composeOptions = {},
}) {
  const sourcePath = path.join(layersDirectory, override.sourceFile);
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Manual crop source missing for region ${regionId}: ${sourcePath}`);
  }

  let offsetX = override.offsetX;
  let offsetY = override.offsetY;

  if (override.autoAlign !== false && (offsetX == null || offsetY == null)) {
    const placement = await findManualCropPlacement({
      manualCropPath: sourcePath,
      mapPath,
      searchRegion: override.searchRegion,
    });
    offsetX = placement.offsetX;
    offsetY = placement.offsetY;
    console.log(
      `  Auto-aligned manual crop ${regionId} at (${offsetX}, ${offsetY}), score ${placement.score.toFixed(2)}`
    );
  }

  const mergedComposeOptions = {
    ...composeOptions,
    ...override.composeOptions,
  };

  const { cropRgba, pixelCount } = await composeManualCropLayer({
    manualCropPath: sourcePath,
    mapPath,
    mapWidth,
    mapHeight,
    offsetX,
    offsetY,
    interiorGrid,
    composeOptions: mergedComposeOptions,
  });

  return {
    cropRgba,
    pixelCount,
    placement: { offsetX, offsetY },
  };
}
