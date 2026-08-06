/** @deprecated Use npm run generate-map-layers -- death-house-basement */
import path from "path";
import { fileURLToPath } from "url";
import { generateMapLayers } from "./map-layer-generator.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

generateMapLayers({ mapId: "death-house-basement", rootDirectory: root }).catch((error) => {
  console.error(error);
  process.exit(1);
});
