import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";

const BASE_URL = process.env.SMOKE_URL || "http://localhost:5173";
const SHOT_DIR = "scripts/screenshots";
const problems = [];

function watch(page, pageName) {
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    if (/favicon|\[vite\]|AudioContext/i.test(text)) return;
    problems.push(`[${pageName}] ${text}`);
  });
  page.on("pageerror", (error) => {
    problems.push(`[${pageName}] pageerror: ${error.message}`);
  });
}

async function settle(page, frames = 60) {
  await page.evaluate(
    (frameCount) =>
      new Promise((resolve) => {
        let remaining = frameCount;
        const step = () => {
          remaining -= 1;
          if (remaining <= 0) resolve();
          else requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      }),
    frames
  );
}

await mkdir(SHOT_DIR, { recursive: true });

const browser = await chromium.launch({
  args: [
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
    "--ignore-gpu-blocklist",
  ],
});
const context = await browser.newContext({
  viewport: { width: 1600, height: 1000 },
});

console.log("--- Control panel ---");
const controlPage = await context.newPage();
watch(controlPage, "control");
await controlPage.goto(BASE_URL, {
  waitUntil: "domcontentloaded",
  timeout: 90000,
});
await controlPage.waitForSelector("#preview-canvas", { timeout: 60000 });
await settle(controlPage, 90);

if ((await controlPage.locator("#venue-panel-mount .card").count()) !== 1) {
  problems.push("venue panel missing");
}
if ((await controlPage.locator("#stage-fx-panel-mount .card").count()) !== 1) {
  problems.push("fx panel missing");
}

await controlPage.locator("#pos-elevation").fill("0.85");
await controlPage.locator("#pos-elevation").dispatchEvent("input");
await settle(controlPage, 45);
await controlPage
  .locator("#preview-canvas")
  .screenshot({ path: `${SHOT_DIR}/01-preview-standard.png` });

await controlPage
  .locator("#venue-panel-mount label.row")
  .filter({ hasText: "Enable anamorphic projection" })
  .locator("input")
  .check();
await controlPage.evaluate(() => document.getElementById("save-scene")?.click());
await settle(controlPage, 30);
await controlPage.screenshot({ path: `${SHOT_DIR}/02-control-panel.png` });
await controlPage.close();

console.log("--- Projector (anamorphic) ---");
const stagePage = await context.newPage();
watch(stagePage, "stage");
await stagePage.goto(`${BASE_URL}/stage.html?projector=projector-1`, {
  waitUntil: "domcontentloaded",
  timeout: 90000,
});
await stagePage.waitForSelector("#stage-canvas", { timeout: 60000 });
await settle(stagePage, 120);

const handleCount = await stagePage.locator(".corner-handle").count();
console.log(`  handles: ${handleCount}`);
if (handleCount !== 8) problems.push(`expected 8 handles, got ${handleCount}`);

await stagePage.screenshot({ path: `${SHOT_DIR}/16-anamorphic.png` });
await stagePage.keyboard.press("h");
await settle(stagePage, 30);
await stagePage.screenshot({ path: `${SHOT_DIR}/17-anamorphic-clean.png` });

await browser.close();

console.log("--- Result ---");
if (problems.length === 0) {
  console.log("Smoke test passed.\n");
  process.exit(0);
}
for (const problem of [...new Set(problems)]) console.log(`  ${problem}`);
process.exit(1);
