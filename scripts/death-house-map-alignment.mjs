/**
 * Landmark alignment between the coloured reference (708×876) and the playable map.
 * The reference partition art does not share the same pixel grid as the final map PNG.
 */
import sharp from "sharp";

export const DEFAULT_DEATH_HOUSE_ALIGNMENT = {
  scaleX: 1.067830550016187,
  offsetX: -16.88174129366473,
  scaleY: 0.9905044688356096,
  offsetY: 17.12566066892767,
  landmarks: [
    { name: "pit", ref: [123.29, 372.54], map: [117.27, 362.93] },
    { name: "room27", ref: [439.61, 383.88], map: [452.28, 419.67] },
    { name: "compass", ref: [85.41, 87.87], map: [72.09, 105.05] },
  ],
};

export function computeScaleOffset(refValues, mapValues) {
  const count = refValues.length;
  let sumRef = 0;
  let sumMap = 0;
  let sumRefSquared = 0;
  let sumRefMap = 0;

  for (let index = 0; index < count; index += 1) {
    sumRef += refValues[index];
    sumMap += mapValues[index];
    sumRefSquared += refValues[index] ** 2;
    sumRefMap += refValues[index] * mapValues[index];
  }

  const scale =
    (count * sumRefMap - sumRef * sumMap) / (count * sumRefSquared - sumRef ** 2);
  const offset = (sumMap - scale * sumRef) / count;
  return { scale, offset };
}

export function computeAlignmentFromLandmarks(landmarks) {
  const horizontal = computeScaleOffset(
    landmarks.map((landmark) => landmark.ref[0]),
    landmarks.map((landmark) => landmark.map[0])
  );
  const vertical = computeScaleOffset(
    landmarks.map((landmark) => landmark.ref[1]),
    landmarks.map((landmark) => landmark.map[1])
  );

  return {
    scaleX: horizontal.scale,
    offsetX: horizontal.offset,
    scaleY: vertical.scale,
    offsetY: vertical.offset,
    landmarks,
  };
}

export function mapPixelToReferencePixel(mapX, mapY, alignment) {
  return {
    x: (mapX - alignment.offsetX) / alignment.scaleX,
    y: (mapY - alignment.offsetY) / alignment.scaleY,
  };
}

function sampleGrid(grid, sourceWidth, sourceHeight, refX, refY) {
  const sourceX = Math.round(refX);
  const sourceY = Math.round(refY);
  if (sourceX < 0 || sourceY < 0 || sourceX >= sourceWidth || sourceY >= sourceHeight) {
    return 0;
  }
  return grid[sourceY * sourceWidth + sourceX];
}

export function remapInt16GridToMap(
  sourceGrid,
  sourceWidth,
  sourceHeight,
  targetWidth,
  targetHeight,
  alignment
) {
  const output = new Int16Array(targetWidth * targetHeight);
  for (let mapY = 0; mapY < targetHeight; mapY += 1) {
    for (let mapX = 0; mapX < targetWidth; mapX += 1) {
      const referencePixel = mapPixelToReferencePixel(mapX, mapY, alignment);
      output[mapY * targetWidth + mapX] = sampleGrid(
        sourceGrid,
        sourceWidth,
        sourceHeight,
        referencePixel.x,
        referencePixel.y
      );
    }
  }
  return output;
}

export function remapUint8GridToMap(
  sourceGrid,
  sourceWidth,
  sourceHeight,
  targetWidth,
  targetHeight,
  alignment
) {
  const output = new Uint8Array(targetWidth * targetHeight);
  for (let mapY = 0; mapY < targetHeight; mapY += 1) {
    for (let mapX = 0; mapX < targetWidth; mapX += 1) {
      const referencePixel = mapPixelToReferencePixel(mapX, mapY, alignment);
      output[mapY * targetWidth + mapX] = sampleGrid(
        sourceGrid,
        sourceWidth,
        sourceHeight,
        referencePixel.x,
        referencePixel.y
      )
        ? 1
        : 0;
    }
  }
  return output;
}

async function findFeatureCentroid(imagePath, predicate) {
  const { data, info } = await sharp(imagePath).ensureAlpha().raw().toBuffer({
    resolveWithObject: true,
  });
  const { width, height, channels } = info;
  let sumX = 0;
  let sumY = 0;
  let count = 0;

  for (let pixelY = 0; pixelY < height; pixelY += 1) {
    for (let pixelX = 0; pixelX < width; pixelX += 1) {
      const bufferIndex = (pixelY * width + pixelX) * channels;
      const red = data[bufferIndex];
      const green = data[bufferIndex + 1];
      const blue = data[bufferIndex + 2];
      if (
        !predicate({
          pixelX,
          pixelY,
          normalizedX: pixelX / (width - 1),
          normalizedY: pixelY / (height - 1),
          red,
          green,
          blue,
          width,
          height,
        })
      ) {
        continue;
      }
      sumX += pixelX;
      sumY += pixelY;
      count += 1;
    }
  }

  if (!count) return null;
  return [sumX / count, sumY / count];
}

export async function calibrateDeathHouseAlignment({ mapPath, referencePath }) {
  const pitPredicate = ({ normalizedX, normalizedY, red, green, blue }) =>
    normalizedX > 0.12 &&
    normalizedX < 0.24 &&
    normalizedY > 0.36 &&
    normalizedY < 0.48 &&
    red < 40 &&
    green < 40 &&
    blue < 40;

  const room27Predicate = ({ normalizedX, normalizedY, red, green, blue }) =>
    normalizedX > 0.58 &&
    normalizedX < 0.68 &&
    normalizedY > 0.42 &&
    normalizedY < 0.52 &&
    red > 80 &&
    red < 180 &&
    green > 50 &&
    green < 120 &&
    blue < 80;

  const compassPredicate = ({ normalizedX, normalizedY, red, green, blue }) =>
    normalizedX > 0.06 &&
    normalizedX < 0.14 &&
    normalizedY > 0.04 &&
    normalizedY < 0.12 &&
    red < 60 &&
    green < 60 &&
    blue < 60;

  const [mapPit, refPit, mapRoom27, refRoom27, mapCompass, refCompass] =
    await Promise.all([
      findFeatureCentroid(mapPath, pitPredicate),
      findFeatureCentroid(referencePath, pitPredicate),
      findFeatureCentroid(mapPath, room27Predicate),
      findFeatureCentroid(referencePath, room27Predicate),
      findFeatureCentroid(mapPath, compassPredicate),
      findFeatureCentroid(referencePath, compassPredicate),
    ]);

  const landmarks = [];
  if (mapPit && refPit) landmarks.push({ name: "pit", ref: refPit, map: mapPit });
  if (mapCompass && refCompass) {
    landmarks.push({ name: "compass", ref: refCompass, map: mapCompass });
  }
  if (landmarks.length < 2 && mapRoom27 && refRoom27) {
    landmarks.push({ name: "room27", ref: refRoom27, map: mapRoom27 });
  }

  if (landmarks.length < 2) {
    throw new Error("Could not find enough shared landmarks to calibrate map alignment.");
  }

  return computeAlignmentFromLandmarks(landmarks);
}
