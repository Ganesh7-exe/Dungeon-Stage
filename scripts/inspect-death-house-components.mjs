/** List colour-family components with size + centroid for manual region mapping. */
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
  if (saturation < 0.07) return 0;
  const hue = rgbToHue(red, green, blue);
  if (hue < 0) return 6;
  if (hue >= 155 && hue <= 205) return 1;
  if (hue >= 5 && hue <= 48) return 2;
  if (hue >= 49 && hue <= 78) return 3;
  if (hue >= 275 && hue <= 345) return 4;
  if (hue >= 79 && hue <= 154) return 5;
  return 6;
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

const familyNames = ["none", "cyan", "orange", "yellow", "magenta", "green", "brown"];

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
  familyGrid[gridIndex] = classifyColourFamily(red, green, blue);
}

for (const familyCode of [1, 2, 3, 4, 5, 6]) {
  const componentGrid = new Int32Array(width * height);
  const stats = [];
  let nextId = 1;

  for (let seedY = 0; seedY < height; seedY += 1) {
    for (let seedX = 0; seedX < width; seedX += 1) {
      const seedIndex = seedY * width + seedX;
      if (familyGrid[seedIndex] !== familyCode || componentGrid[seedIndex]) continue;

      const queue = [[seedX, seedY]];
      componentGrid[seedIndex] = nextId;
      let size = 0;
      let sumX = 0;
      let sumY = 0;

      while (queue.length) {
        const [pixelX, pixelY] = queue.pop();
        const gridIndex = pixelY * width + pixelX;
        if (componentGrid[gridIndex] !== nextId) continue;
        size += 1;
        sumX += pixelX;
        sumY += pixelY;

        for (const [neighbourX, neighbourY] of [
          [pixelX - 1, pixelY],
          [pixelX + 1, pixelY],
          [pixelX, pixelY - 1],
          [pixelX, pixelY + 1],
        ]) {
          if (neighbourX < 0 || neighbourY < 0 || neighbourX >= width || neighbourY >= height) continue;
          const neighbourIndex = neighbourY * width + neighbourX;
          if (familyGrid[neighbourIndex] === familyCode && !componentGrid[neighbourIndex]) {
            componentGrid[neighbourIndex] = nextId;
            queue.push([neighbourX, neighbourY]);
          }
        }
      }

      stats.push({
        id: nextId,
        size,
        centroidX: (sumX / size / width).toFixed(3),
        centroidY: (sumY / size / height).toFixed(3),
      });
      nextId += 1;
    }
  }

  const familyName = familyNames[familyCode];
  const notable = stats.filter((entry) => entry.size >= 200).sort((left, right) => right.size - left.size);
  console.log(`\n=== ${familyName.toUpperCase()} (${notable.length} components >= 200px) ===`);
  for (const entry of notable.slice(0, 25)) {
    console.log(`  #${entry.id}: ${entry.size} px  centroid (${entry.centroidX}, ${entry.centroidY})`);
  }
}
