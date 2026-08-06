/**
 * Generate dark-base + crop layers for a map reveal config.
 *
 *   npm run generate-map-layers -- death-house-basement
 *   npm run generate-map-layers -- death-house-dungeon-level
 */
import path from "path";
import { fileURLToPath } from "url";
import { generateMapLayers } from "./map-layer-generator.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const mapId = process.argv[2] || "death-house-basement";

generateMapLayers({ mapId, rootDirectory: root }).catch((error) => {
  console.error(error);
  process.exit(1);
});
