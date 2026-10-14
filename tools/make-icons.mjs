// Renders assets/app-icon.svg into the PNG icons the web app manifest and iOS need.
// Development tool only (run it after changing the SVG; the PNGs are committed):
//   node tools/make-icons.mjs          (PowerShell/cmd on Windows — needs `npm install` once)
// Uses playwright-core with the installed Edge (BROWSER_CHANNEL=chrome for Chrome); nothing is downloaded.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const svg = fs.readFileSync(path.join(ROOT, "assets/app-icon.svg"), "utf8");
const src = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
// [file, size, maskable] — the maskable icon is full-bleed: its corners take the gradient's edge colour, and
// the emblem (ring radius 176 of 512) already sits inside the central 80% safe zone that launchers keep.
const OUT = [["app-icon-180.png", 180, false], ["app-icon-192.png", 192, false], ["app-icon-512.png", 512, false], ["app-icon-maskable-512.png", 512, true]];

const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || "msedge", headless: true });
for (const [file, size, maskable] of OUT) {
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  await page.setContent(`<html><body style="margin:0;width:${size}px;height:${size}px;display:flex;align-items:center;justify-content:center;background:${maskable ? "#110c06" : "transparent"}">
    <img src="${src}" width="${size}" height="${size}"></body></html>`);
  await page.waitForFunction(() => document.querySelector("img").complete);
  await page.screenshot({ path: path.join(ROOT, "assets", file), omitBackground: !maskable });
  await page.close();
  console.log(`assets/${file} (${size}×${size}${maskable ? ", maskable" : ""})`);
}
await browser.close();
