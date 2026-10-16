// Converts the Grimorio textures (PNG layers of light and dark specks, at most ~13 % opaque) into the
// WebP files the page tiles: assets/textures/paper.webp (pages, popups, dialogs) and leather.webp
// (the top and bottom bars, the controls over the map).
// Development tool only (the WebP files are committed):
//   node tools/make-textures.mjs "<folder with a-paper.png and c-leather.png>"
// PowerShell/cmd on Windows — needs `npm install` once; uses the installed Edge (BROWSER_CHANNEL=chrome
// for Chrome), nothing is downloaded. Encoding is lossless (canvas → image/webp at quality 1; lossy WebP
// is larger for this kind of noise) after rounding every alpha to a multiple of 4: on the page that
// moves no pixel by more than 2/255 and takes about 75 % off the PNG size.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = process.argv[2];
const FILES = [["a-paper.png", "paper.webp"], ["c-leather.png", "leather.webp"]];
const ALPHA_STEP = 4;
if (!SRC || !FILES.every(([f]) => fs.existsSync(path.join(SRC, f)))) {
  console.error(`usage: node tools/make-textures.mjs <folder with ${FILES.map(([f]) => f).join(", ")}>`);
  process.exit(1);
}
fs.mkdirSync(path.join(ROOT, "assets/textures"), { recursive: true });

const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || "msedge", headless: true });
const page = await browser.newPage();
for (const [from, to] of FILES) {
  const png = fs.readFileSync(path.join(SRC, from));
  const webp = await page.evaluate(async ({ b64, step }) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.width; c.height = img.height;
    const x = c.getContext("2d");
    x.drawImage(img, 0, 0);
    const data = x.getImageData(0, 0, c.width, c.height);
    const d = data.data;
    for (let i = 0; i < d.length; i += 4) {
      d[i + 3] = Math.round(d[i + 3] / step) * step;
      if (!d[i + 3]) d[i] = d[i + 1] = d[i + 2] = 0;
    }
    x.putImageData(data, 0, 0);
    return c.toDataURL("image/webp", 1).split(",")[1];
  }, { b64: png.toString("base64"), step: ALPHA_STEP });
  const out = Buffer.from(webp, "base64");
  fs.writeFileSync(path.join(ROOT, "assets/textures", to), out);
  console.log(`assets/textures/${to} (${(out.length / 1024).toFixed(0)} KB, from ${from} ${(png.length / 1024).toFixed(0)} KB)`);
}
await browser.close();
