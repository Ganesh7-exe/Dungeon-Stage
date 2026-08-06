/**
 * Diagnose overlay / parchment / yellow classification on the coloured reference.
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

function isYellowPartition(red, green, blue) {
  return red > 170 && green > 170 && blue < 130 && red + green > blue * 2.2;
}

function isParchmentStrict(red, green, blue) {
  const maxChannel = Math.max(red, green, blue);
  const minChannel = Math.min(red, green, blue);
  const saturation = maxChannel > 0 ? (maxChannel - minChannel) / maxChannel : 0;
  const warmBrown = red >= green && green >= blue * 0.85;
  return saturation < 0.22 && warmBrown && maxChannel > 60 && maxChannel < 230;
}

function isParchmentLoose(red, green, blue) {
  const maxChannel = Math.max(red, green, blue);
  const minChannel = Math.min(red, green, blue);
  const saturation = maxChannel > 0 ? (maxChannel - minChannel) / maxChannel : 0;
  return saturation < 0.08 && maxChannel > 40;
}

const { data, info } = await sharp(colouredPath)
  .ensureAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true });

const { width, height, channels } = info;
let yellowCount = 0;
let strictParchment = 0;
let looseParchment = 0;
let colouredOverlay = 0;

for (let index = 0; index < data.length; index += channels) {
  const red = data[index];
  const green = data[index + 1];
  const blue = data[index + 2];
  if (isYellowPartition(red, green, blue)) {
    yellowCount += 1;
    continue;
  }
  if (isParchmentStrict(red, green, blue)) {
    strictParchment += 1;
    continue;
  }
  if (isParchmentLoose(red, green, blue)) {
    looseParchment += 1;
    continue;
  }
  colouredOverlay += 1;
}

console.log(`Image: ${width}x${height} = ${width * height} px`);
console.log(`Yellow partition: ${yellowCount}`);
console.log(`Strict parchment: ${strictParchment}`);
console.log(`Loose parchment (not strict): ${looseParchment}`);
console.log(`Coloured overlay: ${colouredOverlay}`);
