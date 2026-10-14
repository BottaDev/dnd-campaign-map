// Installable + offline copy: the manifest, the service worker's file lists and strategy, and how
// index.html wires them — without a browser (tests/browser/smoke.mjs checks it live).
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { ROOT, loadRealData } = require("./helpers");

const read = rel => fs.readFileSync(path.join(ROOT, rel), "utf8");
const sw = read("sw.js"), html = read("index.html");
const listOf = name => { const m = new RegExp(`const ${name} = \\[([\\s\\S]*?)\\];`).exec(sw); assert.ok(m, `${name} in sw.js`); return [...m[1].matchAll(/"([^"]+)"/g)].map(x => x[1]); };
const pngSize = rel => { const b = fs.readFileSync(path.join(ROOT, rel)); assert.equal(b.toString("ascii", 1, 4), "PNG", rel); return [b.readUInt32BE(16), b.readUInt32BE(20)]; };

test("1 · manifest: valid JSON, relative scope and start (GitHub Pages sub-path), dark colours", () => {
  const m = JSON.parse(read("manifest.webmanifest"));
  for (const k of ["name", "short_name", "start_url", "scope", "display", "background_color", "theme_color", "icons"]) assert.ok(m[k], k);
  assert.equal(m.scope, "./");
  assert.ok(m.start_url.startsWith("./"), "relative start_url");
  assert.equal(m.display, "standalone");
  assert.equal(m.theme_color, /<meta name="theme-color" content="(#[0-9a-f]{6})">/.exec(html)[1], "same theme colour as the page");
  assert.equal(m.background_color, "#0c0a06", "the page's first-paint background");
});

test("2 · manifest icons exist with the declared sizes, including a maskable one", () => {
  const m = JSON.parse(read("manifest.webmanifest"));
  for (const icon of m.icons) {
    assert.ok(fs.existsSync(path.join(ROOT, icon.src)), icon.src);
    if (icon.type === "image/png") { const [w, h] = pngSize(icon.src); assert.equal(`${w}x${h}`, icon.sizes, icon.src); }
  }
  assert.ok(m.icons.some(i => i.purpose === "maskable"));
  assert.ok(m.icons.some(i => i.sizes === "192x192") && m.icons.some(i => i.sizes === "512x512"));
  assert.deepEqual(pngSize("assets/app-icon-180.png"), [180, 180], "apple-touch-icon");
});

test("3 · index.html links the manifest and icons and registers ./sw.js (relative, http(s) only)", () => {
  assert.match(html, /<link rel="manifest" href="manifest\.webmanifest">/);
  assert.match(html, /<link rel="apple-touch-icon" href="assets\/app-icon-180\.png">/);
  assert.match(html, /navigator\.serviceWorker\.register\("\.\/sw\.js"\)/);
  assert.match(html, /\/\^https\?:\$\/\.test\(location\.protocol\)/, "never on file://");
  assert.match(html, /<script src="\.\/js\/chronicle-library\.js"><\/script>/);
});

test("4 · every precached file exists, and everything the page loads at start is precached", () => {
  const pre = listOf("PRECACHE");
  pre.filter(f => f !== "./").forEach(f => assert.ok(fs.existsSync(path.join(ROOT, f)), `precached file missing: ${f}`));
  const scripts = [...html.matchAll(/<script src="\.\/([^"]+)"/g)].map(m => m[1]);
  scripts.forEach(s => assert.ok(pre.includes(s), `script ${s} is precached`));
  ["characters", "routes", "events", "sessions", "quests", "npcs", "locations", "lore"].forEach(n => assert.ok(pre.includes(`data/${n}.json`), n));
  assert.ok(pre.includes("data/i18n/es-AR.json"));
  loadRealData().characters.forEach(c => { if (c.sealImg) assert.ok(pre.includes(c.sealImg), `portrait ${c.sealImg}`); });
  assert.ok(pre.includes("./") && pre.includes("index.html"));
});

test("5 · the 15 MB full-resolution map is never stored (and no huge file is precached)", () => {
  const pre = listOf("PRECACHE");
  assert.ok(!pre.some(f => /exandria-map\.jpeg$/.test(f)));
  assert.match(sw, /const NEVER_CACHE = \/\\\/assets\\\/exandria-map\\\.jpeg\$\//);
  assert.match(sw, /if \(NEVER_CACHE\.test\(url\.pathname\)\) return;/, "left to the browser, not intercepted");
  const total = pre.filter(f => f !== "./").reduce((n, f) => n + fs.statSync(path.join(ROOT, f)).size, 0);
  assert.ok(total < 1.5e6, `precache is ${(total / 1e6).toFixed(2)} MB`);
});

test("6 · updates: versioned caches, old ones deleted on activate, network first for pages, code and data", () => {
  assert.match(sw, /const VERSION = "[^"]+";/);
  assert.match(sw, /const SHELL = `chronicle-shell-\$\{VERSION\}`;/);
  assert.match(sw, /n\.startsWith\("chronicle-"\) && !keep\.includes\(n\)/, "only this app's old caches are deleted");
  assert.match(sw, /self\.skipWaiting\(\)/);
  assert.match(sw, /self\.clients\.claim\(\)/);
  assert.match(sw, /req\.mode === "navigate"\) return event\.respondWith\(networkFirst/);
  assert.match(sw, /return event\.respondWith\(networkFirst\(req\)\);/, "scripts and data/*.json: network first");
  assert.match(sw, /cache: "no-cache"/, "revalidated past the HTTP cache, so new sessions appear");
  assert.match(sw, /x-chronicle-offline/, "the offline copy is marked");
  assert.match(html, /x-chronicle-offline/, "and the page reads the mark");
});

test("7 · user data is separate: the worker never touches localStorage, the page never prunes against an offline copy", () => {
  assert.ok(!/localStorage|indexedDB/.test(sw.replace(/^\s*\/\/.*$/gm, "")), "sw.js code has no storage access");
  assert.match(html, /if\(!this\._servedOffline\) this\.lib\.prune\(/);
});
