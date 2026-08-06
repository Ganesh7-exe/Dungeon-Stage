/**
 * Find colour-family component id at normalized map coordinates.
 * Usage: node scripts/find-component-at-point.mjs 0.15 0.35
 */
import sharp from "sharp";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const colouredPath = path.join(
  root,
  "public/maps/death-house-basement/reference/region-mask-coloured.png"
);

const YELLOW_BARRIER_RADIUS = 8;
const FAMILY_CODES = { cyan: 1, orange: 2, yellow: 3, magenta: 4, green: 5, brown: 6 };

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
  if (maxChannel === redNorm) hue = ((greenNorm - blueNorm) / delta) % 6;
  else if (maxChannel === greenNorm) hue = (blueNorm - redNorm) / delta + 2;
  else hue = (redNorm - greenNorm) / delta + 4;
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

function dilateMask(mask, width, height, radius) {
  const output = new Uint8Array(mask.length);
  for (let pixelY = 0; pixelY < height; pixelY += 1) {
    for (let pixelX = 0; pixelX < width; pixelX += 1) {
      const gridIndex = pixelY * width + pixelX;
      if (!mask[gridIndex]) continue;
      for (let offsetY = -radius; offsetY <= radius; offsetY += 1) {
        for (let offsetX = -radius; offsetX <= radius; offsetX += 1) {
          const neighbourX = pixelX + offsetX;
          const neighbourY = pixelY + offsetY;
          if (neighbourX < 0 || neighbourY < 0 || neighbourX >= width || neighbourY >= height) continue;
          output[neighbourY * width + neighbourX] = 1;
        }
      }
    }
  }
  return output;
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

        for (const [neighbourX, neighbourY] of [
          [pixelX - 1, pixelY],
          [pixelX + 1, pixelY],
          [pixelX, pixelY - 1],
          [pixelX, pixelY + 1],
        ]) {
          if (neighbourX < 0 || neighbourY < 0 || neighbourX >= width || neighbourY >= height) continue;
          const neighbourIndex = neighbourY * width + neighbourX;
          if (familyGrid[neighbourIndex] === familyCode && componentGrid[neighbourIndex] === 0) {
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

const normalizedX = Number(process.argv[2] ?? 0.17);
const normalizedY = Number(process.argv[3] ?? 0.43);

const { data, info } = await sharp(colouredPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const { width, height, channels } = info;

const barrierGrid = new Uint8Array(width * height);
const familyGrid = new Uint8Array(width * height);

for (let gridIndex = 0; gridIndex < width * height; gridIndex += 1) {
  const bufferIndex = gridIndex * channels;
  const red = data[bufferIndex];
  const green = data[bufferIndex + 1];
  const blue = data[bufferIndex + 2];
  if (isYellowPartition(red, green, blue)) barrierGrid[gridIndex] = 1;
}
const dilatedBarrier = dilateMask(barrierGrid, width, height, YELLOW_BARRIER_RADIUS);

for (let gridIndex = 0; gridIndex < width * height; gridIndex += 1) {
  if (dilatedBarrier[gridIndex]) continue;
  const bufferIndex = gridIndex * channels;
  const red = data[bufferIndex];
  const green = data[bufferIndex + 1];
  const blue = data[bufferIndex + 2];
  if (isParchment(red, green, blue)) continue;
  const family = classifyColourFamily(red, green, blue);
  familyGrid[gridIndex] = FAMILY_CODES[family] || 0;
}

const seedX = Math.round(normalizedX * (width - 1));
const seedY = Math.round(normalizedY * (height - 1));
const seedIndex = seedY * width + seedX;
const familyCode = familyGrid[seedIndex];
const familyName = Object.entries(FAMILY_CODES).find(([, code]) => code === familyCode)?.[0] ?? "none";

const { componentGrid, componentSizes } = labelFamilyComponents(
  familyGrid,
  width,
  height,
  familyCode
);
const componentId = componentGrid[seedIndex];

console.log(
  `Point (${normalizedX}, ${normalizedY}) -> pixel (${seedX}, ${seedY}) family=${familyName} component=#${componentId} size=${componentSizes.get(componentId) ?? 0}px`
);
