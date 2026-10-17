// Renders an SVG to PNGs at icon sizes, using headless Chromium so the toolbar
// icon matches the SVG used in the popup header exactly.
// Usage: node rasterize.mjs <svg> <outdir> [previewOut]
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";

const [svgPath, outDir, previewOut] = process.argv.slice(2);
const svg = await readFile(svgPath, "utf8");
const sizes = [16, 32, 48, 128];

const browser = await chromium.launch();
for (const size of sizes) {
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  await page.setContent(
    `<!doctype html><meta charset=utf8><style>html,body{margin:0}svg{width:${size}px;height:${size}px;display:block}</style>${svg}`,
    { waitUntil: "networkidle" }
  );
  await page.locator("svg").screenshot({ path: `${outDir}/icon${size}.png`, omitBackground: true });
  await page.close();
}
if (previewOut) {
  // A large flat preview on a neutral page to judge the art.
  const page = await browser.newPage({ viewport: { width: 420, height: 240 }, deviceScaleFactor: 2 });
  await page.setContent(
    `<!doctype html><meta charset=utf8><style>html,body{margin:0;background:#e9edf3;display:flex;gap:28px;align-items:center;justify-content:center;height:240px}svg{display:block}.a{width:128px;height:128px}.b{width:48px;height:48px}.c{width:16px;height:16px}</style>
     <div class="a">${svg}</div><div class="b">${svg}</div><div class="c">${svg}</div>`,
    { waitUntil: "networkidle" }
  );
  await page.screenshot({ path: previewOut });
  await page.close();
}
await browser.close();
console.log("rasterized", sizes.join(","));
