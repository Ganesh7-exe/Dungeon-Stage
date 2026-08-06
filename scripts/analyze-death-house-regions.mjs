/**
 * Quick probe of the coloured region reference — dimensions and pixel samples.
 * Run: node scripts/analyze-death-house-regions.mjs
 */
import sharp from "sharp";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const colouredPath = path.join(
  root,
  "public/maps/death-house-dungeon-level/reference/region-mask-coloured.png"
);
const dungeonPath = path.join(root, "public/maps/death-house-dungeon-level.png");

const colouredMeta = await sharp(colouredPath).metadata();
const dungeonMeta = await sharp(dungeonPath).metadata();

console.log("Coloured reference:", colouredMeta.width, "x", colouredMeta.height);
console.log("Dungeon map:", dungeonMeta.width, "x", dungeonMeta.height);

const { data, info } = await sharp(colouredPath)
  .ensureAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true });

const width = info.width;
const height = info.height;
const channels = info.channels;

function pixelAt(x, y) {
  const clampedX = Math.max(0, Math.min(width - 1, Math.round(x)));
  const clampedY = Math.max(0, Math.min(height - 1, Math.round(y)));
  const index = (clampedY * width + clampedX) * channels;
  return {
    r: data[index],
    g: data[index + 1],
    b: data[index + 2],
    a: channels > 3 ? data[index + 3] : 255,
  };
}

function rgbString(pixel) {
  return `rgb(${pixel.r},${pixel.g},${pixel.b})`;
}

/** Sample grid across the image to find distinct fill colours. */
const colourBuckets = new Map();
for (let sampleY = 0; sampleY < height; sampleY += 4) {
  for (let sampleX = 0; sampleX < width; sampleX += 4) {
    const pixel = pixelAt(sampleX, sampleY);
    const maxChannel = Math.max(pixel.r, pixel.g, pixel.b);
    const minChannel = Math.min(pixel.r, pixel.g, pixel.b);
    const saturation = maxChannel > 0 ? (maxChannel - minChannel) / maxChannel : 0;
    if (saturation < 0.15) continue; // skip parchment/neutral
    const bucketKey = `${Math.round(pixel.r / 16)},${Math.round(pixel.g / 16)},${Math.round(pixel.b / 16)}`;
    colourBuckets.set(bucketKey, (colourBuckets.get(bucketKey) || 0) + 1);
  }
}

const topColours = [...colourBuckets.entries()]
  .sort((left, right) => right[1] - left[1])
  .slice(0, 20);

console.log("\nTop saturated colour buckets (r/16,g/16,b/16): count");
for (const [key, count] of topColours) {
  console.log(`  ${key}: ${count}`);
}

/** Count yellow-ish partition pixels. */
let yellowCount = 0;
for (let index = 0; index < data.length; index += channels) {
  const red = data[index];
  const green = data[index + 1];
  const blue = data[index + 2];
  const isYellowLine =
    red > 180 && green > 180 && blue < 120 && red + green > blue * 2.5;
  if (isYellowLine) yellowCount += 1;
}
console.log(`\nYellow partition pixels (heuristic): ${yellowCount}`);

/** Manual seed points — normalized 0–1, one per reveal button. */
const seedPoints = {
  25: { x: 0.18, y: 0.42 },
  21: { x: 0.42, y: 0.18 },
  23: { x: 0.72, y: 0.22 },
  27: { x: 0.62, y: 0.48 },
  26: { x: 0.48, y: 0.52 },
  30: { x: 0.38, y: 0.72 },
  29: { x: 0.55, y: 0.68 },
  31: { x: 0.72, y: 0.72 },
  33: { x: 0.55, y: 0.85 },
  14: { x: 0.38, y: 0.88 },
};

console.log("\nSeed point colours:");
for (const [regionId, point] of Object.entries(seedPoints)) {
  const pixel = pixelAt(point.x * width, point.y * height);
  console.log(`  Region ${regionId} @ (${point.x}, ${point.y}): ${rgbString(pixel)}`);
}
