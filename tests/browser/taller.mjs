// Browser checks of the map editor and the Taller del Cronista (real page, real browser) — npm run test:taller
// Same harness as smoke.mjs: a tiny static server, the installed Edge/Chrome through playwright-core.
// Everything is test data in a fresh browser profile (IndexedDB of a throw-away context): nothing is written to
// data/; the exported package is unpacked into a temporary folder and checked with the repository's own tools.
//   BROWSER_CHANNEL=chrome npm run test:taller   (default: msedge) — run from PowerShell/cmd on Windows.
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(import.meta.url);
const Editor = require(path.join(ROOT, "js", "chronicle-editor.js"));
const OUT = path.join(ROOT, "test-results");
fs.mkdirSync(OUT, { recursive: true });
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "chronicle-taller-"));
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".css": "text/css", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json" };

// `rewrite.json(rel, value)` may change a data file on the fly (the published data changing under a draft).
const rewrite = { json: null };
const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(new URL(req.url, "http://x").pathname).replace(/^\/+/, "") || "index.html";
  const file = path.join(ROOT, rel);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end("not found"); }
  res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream", "cache-control": "no-cache" });
  if (rewrite.json && /\.json$/.test(file)) { const v = rewrite.json(rel.replace(/\\/g, "/"), JSON.parse(fs.readFileSync(file, "utf8"))); return res.end(JSON.stringify(v)); }
  fs.createReadStream(file).pipe(res);
});
await new Promise(r => server.listen(0, "127.0.0.1", r));
const BASE = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || "msedge", headless: true });
const results = [], errors = [];
const only = process.env.TALLER_ONLY ? new RegExp(process.env.TALLER_ONLY, "i") : null;
async function check(name, fn) {
  if (only && !only.test(name)) return;
  try { await fn(); results.push(["ok", name]); console.log(`ok   ${name}`); }
  catch (e) { results.push(["FAIL", name, e.message]); console.log(`FAIL ${name}\n     ${e.message.split("\n").slice(0, 6).join("\n     ")}`); }
}
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
const eq = (a, b, msg) => assert(JSON.stringify(a) === JSON.stringify(b), `${msg}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
const near = (a, b, tol, msg) => assert(Math.abs(a - b) <= tol, `${msg}: expected ${b} ±${tol}, got ${a}`);
const DESKTOP = { viewport: { width: 1360, height: 860 } };
const LAPTOP = { viewport: { width: 1180, height: 760 } };
const PHONE = { viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 };
const AR = 5400 / 8100;
const published = name => JSON.parse(fs.readFileSync(path.join(ROOT, "data", name), "utf8"));

async function open(ctxOpts, hash, { ctx: given } = {}) {
  const ctx = given || await browser.newContext({ ...ctxOpts, acceptDownloads: true });
  if (!given) await ctx.addInitScript(() => { try { localStorage.setItem("chronicle-tour-version", "3"); localStorage.setItem("chronicle-tour-invite", "dismissed"); } catch (e) {} });
  const page = await ctx.newPage();
  page.on("pageerror", e => errors.push(`${hash}: ${e.message}`));
  page.on("console", m => { if ((m.type() === "error" && !/Failed to load resource/.test(m.text())) || /\[i18n\] missing key/.test(m.text())) errors.push(`${hash}: ${m.text()}`); });
  page.on("response", r => { if (r.status() >= 400 && !/favicon.ico$/.test(r.url())) errors.push(`${hash}: ${r.status()} ${r.url()}`); });
  await page.goto(BASE + (hash || ""));
  return { ctx, page };
}
// The draft as this browser stored it (IndexedDB), read from the page.
const readDraft = page => page.evaluate(() => new Promise((resolve, reject) => {
  const req = indexedDB.open("chronicle-taller", 1);
  req.onerror = () => reject(req.error);
  req.onsuccess = () => { const db = req.result; const g = db.transaction("draft").objectStore("draft").get("current"); g.onsuccess = () => { resolve(g.result || null); db.close(); }; g.onerror = () => reject(g.error); };
}));
async function waitSaved(page, test, msg) {
  const t0 = Date.now();
  for (;;) {
    const d = await readDraft(page).catch(() => null);
    if (d && test(d)) return d;
    if (Date.now() - t0 > 6000) throw new Error(`draft never saved: ${msg}`);
    await page.waitForTimeout(150);
  }
}
const worldRect = page => page.$eval("[data-world]", el => { const r = el.getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width }; });
const vpRect = page => page.$eval(".cc-vp", el => { const r = el.getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; });
const pending = async page => {
  const text = await page.$eval(".cc-mx-pos b, .cc-mx-mini .cc-mx-m", el => el.textContent);
  const m = /X ([\d.]+) · Y ([\d.]+)/.exec(text);
  if (!m) throw new Error(`no position shown (${text})`);
  return { x: +m[1], y: +m[2] };
};
const px = v => Math.round(v);
const expected = (r, x, y) => ({ x: Math.round(Math.min(100, Math.max(0, (x - r.left) / r.width * 100)) * 100) / 100, y: Math.round(Math.min(100, Math.max(0, (y - r.top) / (r.width * AR) * 100)) * 100) / 100 });
const settle = async page => { let last = "", still = 0; for (let i = 0; i < 40 && still < 4; i++) { const s = await page.$eval("[data-world]", el => el.style.transform); still = s === last ? still + 1 : 0; last = s; await page.waitForTimeout(100); } };
// Wait until the map editor shows its marker (or its list) and the view stopped moving (centring retries for ~600 ms).
async function editorReady(page, withTarget) {
  await page.waitForSelector(withTarget ? ".cc-mx .cc-mx-foot, .cc-mx .cc-mx-mini" : ".cc-mx .cc-mx-list", { timeout: 15000 });
  let last = "", still = 0;
  for (let i = 0; i < 60 && still < 7; i++) { const s = await page.$eval("[data-world]", el => el.style.transform); still = s === last ? still + 1 : 0; last = s; await page.waitForTimeout(120); }
}

// ── Map editor: coordinates ─────────────────────────────────────────────────
await check("map editor · a click puts the marker at the exact map percent (pointer → world box)", async () => {
  const { ctx, page } = await open(DESKTOP, "#/map/edit/s12_01");
  await editorReady(page, true);
  const vp = await vpRect(page), r = await worldRect(page);
  for (const [fx, fy] of [[0.35, 0.5], [0.62, 0.3], [0.5, 0.8]]) {
    const x = px(vp.left + vp.width * fx), y = px(vp.top + vp.height * fy);
    await page.mouse.click(x, y);
    const got = await pending(page), want = expected(r, x, y), tol = 0.011;
    near(got.x, want.x, tol, `x at ${fx}`); near(got.y, want.y, tol, `y at ${fy}`);
  }
  assert(await page.isVisible(".cc-mx-src.is-pending"), "the position is marked as not confirmed");
  await page.screenshot({ path: path.join(OUT, "taller-map-click.png") });
  await ctx.close();
});

await check("map editor · the same map point keeps its coordinates whatever the zoom and the pan", async () => {
  const { ctx, page } = await open(DESKTOP, "#/map/edit/s12_01");
  await editorReady(page, true);
  const target = { xp: 37.5, yp: 55.25 };                    // open sea, far from every recorded marker
  const clickAt = async label => {
    await page.fill("#cc-mx-x", "3"); await page.fill("#cc-mx-y", "3");          // the marker out of the way (it is a drag handle)
    const r = await worldRect(page), x = px(r.left + target.xp / 100 * r.width), y = px(r.top + target.yp / 100 * r.width * AR);
    const vp = await vpRect(page);
    assert(x > vp.left && x < vp.left + vp.width && y > vp.top && y < vp.top + vp.height, `${label}: the point is in view`);
    await page.mouse.click(x, y);
    const got = await pending(page), want = expected(r, x, y);
    near(got.x, want.x, 0.011, `${label} x`); near(got.y, want.y, 0.011, `${label} y`);
    near(got.x, target.xp, 100 / r.width + 0.011, `${label} x within a pixel of the point`); near(got.y, target.yp, 100 / (r.width * AR) + 0.011, `${label} y within a pixel of the point`);
    return r.width;
  };
  // Zoom out to the whole map, centre on the point and zoom in step by step; pan in between.
  await page.click(".cc-zbtn.solo");
  await settle(page);
  const w1 = await clickAt("zoom 1");
  for (let i = 0; i < 4; i++) {
    const r = await worldRect(page), x = r.left + target.xp / 100 * r.width, y = r.top + target.yp / 100 * r.width * AR;
    await page.mouse.move(x, y); await page.mouse.wheel(0, -240); await settle(page);
  }
  const w2 = await clickAt("zoomed in (wheel about the point)");
  assert(w2 > w1 * 1.6, `the map really zoomed (${w1} → ${w2} px)`);
  // Pan: drag the map by mouse, then the point is still found at its coordinates.
  const vp = await vpRect(page);
  await page.mouse.move(vp.left + vp.width * 0.5, vp.top + vp.height * 0.5);
  await page.mouse.down(); await page.mouse.move(vp.left + vp.width * 0.5 - 90, vp.top + vp.height * 0.5 + 60, { steps: 8 }); await page.mouse.up();
  await settle(page);
  await clickAt("after panning");
  await page.click(".cc-zbtn[aria-label]:not(.solo)");      // the + button
  await settle(page);
  await clickAt("zoom button");
  await ctx.close();
});

await check("map editor · drag the marker by mouse; arrows nudge one screen pixel (Shift: ten); off the map is clamped", async () => {
  const { ctx, page } = await open(DESKTOP, "#/map/edit/s12_01");
  await editorReady(page, true);
  const r = await worldRect(page), box = await page.locator(".cc-editpin").boundingBox();
  const before = await pending(page);
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy); await page.mouse.down();
  await page.mouse.move(cx + 40, cy - 25, { steps: 6 }); await page.mouse.move(cx + 80, cy - 50, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(100);
  const after = await pending(page), tol = 100 / r.width + 0.02;
  near(after.x - before.x, 80 / r.width * 100, tol, "dragged x");
  near(after.y - before.y, -50 / (r.width * AR) * 100, tol, "dragged y");
  assert(JSON.stringify(await worldRect(page)) === JSON.stringify(r), "dragging the marker does not move the map");
  // Keyboard: the marker keeps the focus after the drag.
  const step = Editor.pixelStep(r.width);
  await page.focus(".cc-editpin");
  await page.keyboard.press("ArrowRight"); await page.keyboard.press("ArrowRight"); await page.keyboard.press("Shift+ArrowDown");
  const k = await pending(page);
  near(k.x, after.x + 2 * step.x, 0.011, "two steps right"); near(k.y, after.y + 10 * step.y, 0.011, "ten steps down");
  // Fields typed key by key: "42.5" lands as 42.5 (the field never reformats what is being typed).
  await page.click("#cc-mx-x"); await page.keyboard.press("Control+A"); await page.keyboard.type("42.5");
  eq(await page.inputValue("#cc-mx-x"), "42.5", "the field shows what was typed");
  eq((await pending(page)).x, 42.5, "x typed key by key");
  await page.keyboard.press("Tab");
  eq(await page.inputValue("#cc-mx-x"), "42.50", "leaving the field shows the stored value");
  // Fields: typed values are clamped to the map.
  await page.fill("#cc-mx-x", "150");
  eq((await pending(page)).x, 100, "x clamped to 100");
  await page.fill("#cc-mx-y", "-4");
  eq((await pending(page)).y, 0, "y clamped to 0");
  // A click off the picture (the band around the map at zoom 1) lands on its edge.
  await page.click(".cc-zbtn.solo"); await settle(page);
  const w = await worldRect(page), vp = await vpRect(page);
  if (w.top > vp.top + 8) {
    await page.mouse.click(vp.left + vp.width / 2, vp.top + 4);
    eq((await pending(page)).y, 0, "a click above the picture is the top edge");
  }
  const right = Math.min(vp.left + vp.width - 3, w.left + w.width + 2);
  const what = await page.evaluate(([x, y]) => { const el = document.elementFromPoint(x, y); return el ? el.className || el.tagName : "none"; }, [right, vp.top + vp.height / 2]);
  await page.mouse.click(right, vp.top + vp.height / 2);
  const edge = await pending(page);
  assert(edge.x >= 100 - 100 / w.width * 4, `at the right edge (${JSON.stringify(edge)}, clicked on ${what}, world ${JSON.stringify(w)}, vp ${JSON.stringify(vp)})`);
  await ctx.close();
});

await check("map editor · Cancel discards the move; Confirm saves it in the draft only; the public map and the routes stay as published", async () => {
  const { ctx, page } = await open(DESKTOP, "#/map/edit/s12_01");
  await editorReady(page, true);
  const pub = published("events.json").find(e => e.id === "s12_01");
  const vp = await vpRect(page);
  await page.mouse.click(vp.left + vp.width * 0.3, vp.top + vp.height * 0.6);
  await page.click(".cc-mx-foot .cc-btn.ghost");                       // Cancelar
  await page.waitForSelector(".cc-mx .cc-mx-list");
  eq(await page.locator(".cc-editpin").count(), 0, "back to the list, no marker");
  const d0 = await readDraft(page);
  assert(!d0 || !d0.changes.event.s12_01, "nothing stored after cancelling");
  // Confirm: stored in the draft, the list says it is placed.
  await page.goto(BASE + "#/map/edit/s12_01"); await editorReady(page, true);
  const r = await worldRect(page), x = px(vp.left + vp.width * 0.31), y = px(vp.top + vp.height * 0.52);
  await page.mouse.click(x, y);
  const want = expected(r, x, y);
  await page.click(".cc-mx-foot .cc-btn:not(.ghost)");                 // Confirmar
  const d = await waitSaved(page, d => d.changes.event.s12_01, "s12_01 position");
  near(d.changes.event.s12_01.en.xp, want.x, 0.011, "stored xp"); near(d.changes.event.s12_01.en.yp, want.y, 0.011, "stored yp");
  eq(d.changes.event.s12_01.base.en.xp, pub.xp, "the change remembers the published position");
  eq(Object.keys(d.changes.event), ["s12_01"], "no other event moved");
  // The public map: every marker where it was, the journeys untouched.
  await page.goto(BASE + "#/map"); await page.waitForSelector(".cc-marker"); await page.waitForTimeout(900);
  const total = await page.$$eval(".cc-marker", bs => bs.reduce((n, b) => { const m = /^(\d+) /.exec(b.getAttribute("title")); return n + (m ? +m[1] : 1); }, 0));
  eq(total, 33, "33 published events on the public map");
  const lines = await page.$$eval(".cc-routes polyline", ps => ps.map(p => p.getAttribute("points")));
  const routes = published("routes.json"), allPts = Object.values(routes).flat().map(p => `${p.xp},${p.yp}`);
  assert(lines.length > 0 && lines.every(l => l.split(" ").every(pt => allPts.includes(pt))), "every drawn route point is a published waypoint");
  await page.goto(BASE + "#/chronicle/event/s12_01"); await page.waitForSelector(".cc-minimap", { state: "attached" });
  const style = await page.$eval(".cc-minimap", a => a.getAttribute("style"));
  assert(new RegExp(`--x:\\s*${pub.xp};`).test(style) && new RegExp(`--y:\\s*${pub.yp};`).test(style), `the public page still shows the published point (${style})`);
  await ctx.close();
});

await check("map editor · a marker on the map chooses what to place; places get an exact/approximate reference; a phone places by tap without moving the map", async () => {
  const { ctx, page } = await open(DESKTOP, "#/map/edit");
  await editorReady(page, false);
  await page.locator(".cc-marker").first().click();
  await page.waitForFunction(() => /#\/map\/edit\/./.test(location.hash) || document.querySelector(".cc-mx-list .cc-mx-item"));
  // Places: the list of places, a place's own position with its precision.
  await page.goto(BASE + "#/map/editplace/whitestone"); await editorReady(page, true);
  assert(await page.isVisible("#cc-mx-prec"), "precision select for a place");
  const vp = await vpRect(page);
  await page.mouse.click(vp.left + vp.width * 0.55, vp.top + vp.height * 0.45);
  await page.selectOption("#cc-mx-prec", "approximate");
  await page.click(".cc-mx-foot .cc-btn:not(.ghost)");
  const d = await waitSaved(page, d => d.changes.place.whitestone, "whitestone reference");
  eq(d.changes.place.whitestone.en.mapPrecision, "approximate", "precision stored");
  eq(Object.keys(d.changes.event || {}), [], "placing a place moves no event");
  await ctx.close();
  // Phone: the panel is a sheet; a tap places, the map does not pan.
  const ph = await open(PHONE, "#/map/edit/s12_01");
  await editorReady(ph.page, true);
  assert(await ph.page.isVisible(".cc-mx-mini"), "on a phone the sheet starts compact: the map stays free");
  await ph.page.click(".cc-mx-mini [aria-label='Mostrar el panel']");
  await ph.page.fill("#cc-mx-x", "3"); await ph.page.fill("#cc-mx-y", "3");      // the marker out of the way (a tap on it starts a drag)
  await ph.page.click(".cc-mx-h [aria-label='Achicar el panel']");
  const before = await ph.page.$eval("[data-world]", el => el.style.transform), pv = await vpRect(ph.page);
  const r = await worldRect(ph.page), tx = px(r.left + 0.35 * r.width), ty = px(r.top + 0.45 * r.width * AR);   // open sea, no marker there
  const sheetTop = (await ph.page.locator(".cc-mx-sheet").boundingBox()).y;
  assert(tx > pv.left && tx < pv.left + pv.width && ty > pv.top && ty < sheetTop, `the point is in view above the sheet (${tx},${ty}, sheet at ${sheetTop})`);
  eq(await ph.page.evaluate(([x, y]) => !!document.elementFromPoint(x, y).closest(".cc-marker"), [tx, ty]), false, "no marker under the finger");
  await ph.page.touchscreen.tap(tx, ty);
  await ph.page.waitForTimeout(200);
  eq(await ph.page.$eval("[data-world]", el => el.style.transform), before, "a tap does not move the map");
  const miniText = await ph.page.textContent(".cc-mx-mini .cc-mx-m"), mini = miniText.match(/X ([\d.]+) · Y ([\d.]+)/);
  assert(mini, `the compact bar shows the coordinates (${miniText})`);
  const got = { x: +mini[1], y: +mini[2] }, want = expected(r, tx, ty);
  near(got.x, want.x, 0.011, "tap x"); near(got.y, want.y, 0.011, "tap y");
  const sheet = await ph.page.locator(".cc-mx-sheet").boundingBox();
  assert(sheet && sheet.y + sheet.height <= 812 && sheet.x >= 0 && sheet.x + sheet.width <= 375, "the sheet fits the phone");
  eq(await ph.page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false, "no sideways scroll");
  await ph.page.screenshot({ path: path.join(OUT, "taller-map-phone.png") });
  await ph.ctx.close();
});

// ── Taller ──────────────────────────────────────────────────────────────────
await check("taller · the whole path: a test session, two events, a party member, a quest, a position — saved, reloaded, exported, valid", async () => {
  const { ctx, page } = await open(LAPTOP, "#/taller");
  await page.waitForSelector(".cc-tl-tabs", { timeout: 15000 });
  // 1. A fictitious session 99 (the dialog suggests 13: the number is changed on purpose).
  await page.click(".cc-tl-quick .cc-qa-i:has-text('Nueva sesión')");
  await page.waitForSelector("[data-dialog=taller]");
  await page.fill("#tl-new-no", "99");
  await page.fill("#tl-new-title", "Sesión de prueba del taller");
  await page.fill("#tl-new-date", "2026-10-25");
  await page.click("[data-dialog=taller] button[type=submit]");
  await page.waitForFunction(() => location.hash === "#/taller/session/99");
  await page.waitForSelector(".cc-detail .cc-doc-h");
  eq((await page.textContent(".cc-detail .cc-doc-h")).trim(), "Sesión de prueba del taller", "the preview is the real session page");
  // 2. Two events from the session's own form.
  await page.click("button:has-text('Agregar un acontecimiento a esta sesión')");
  await page.waitForFunction(() => location.hash === "#/taller/event/s99_01");
  await page.fill("#tl-event-s99_01-title-es", "Llegada de prueba a Vasselheim");
  await page.fill("#tl-event-s99_01-summary-es", "El grupo llega a la ciudad para una prueba del taller.");
  await page.selectOption("#tl-event-s99_01-type", "travel");
  await page.fill("#tl-event-s99_01-campaignDay", "41");
  await page.selectOption("#tl-event-s99_01-locationId", "vasselheim");
  // 3. A party member.
  await page.click(".cc-tl-chips .cc-pcchip:has-text('Sorfon')");
  // 4. A quest — and the one-tap fix that lists this session in it.
  await page.locator(".cc-tl-pick").nth(1).locator("label:has-text('Traer de vuelta a Cassandra') input").check();
  await page.click("button:has-text('Agregar la sesión 99 a la misión')");
  // 5. Its position, through the map editor, and back to the form.
  await page.click("button:has-text('Ubicar en el mapa')");
  await page.waitForFunction(() => location.hash === "#/map/edit/s99_01");
  await editorReady(page, true);
  assert(await page.isVisible(".cc-mx-sug"), "a suggestion from earlier events in Vasselheim");
  await page.click(".cc-mx-sug button");
  const sug = await pending(page);
  const vp = await vpRect(page);
  await page.mouse.click(vp.left + vp.width * 0.52, vp.top + vp.height * 0.48);
  const moved = await pending(page);
  assert(moved.x !== sug.x || moved.y !== sug.y, "adjusted after the suggestion");
  await page.click(".cc-mx-foot .cc-btn:not(.ghost)");
  await page.waitForFunction(() => location.hash === "#/taller/event/s99_01");
  await page.waitForSelector(".cc-mx-pos b");
  // The second event (no position: a dream).
  await page.goto(BASE + "#/taller/session/99");
  await page.click("button:has-text('Agregar un acontecimiento a esta sesión')");
  await page.waitForFunction(() => location.hash === "#/taller/event/s99_02");
  await page.fill("#tl-event-s99_02-title-es", "Un sueño de prueba");
  await page.fill("#tl-event-s99_02-summary-es", "Sin lugar en el mapa.");
  await page.selectOption("#tl-event-s99_02-type", "dream");
  // 6. Saved in this browser.
  const d = await waitSaved(page, d => d.changes.event.s99_02 && d.changes.event.s99_02.es && d.changes.event.s99_02.es.summary === "Sin lugar en el mapa.", "both events");
  eq(Object.keys(d.changes.session), ["99"], "the session");
  eq(Object.keys(d.changes.event).sort(), ["s99_01", "s99_02"], "the two events");
  eq(d.changes.event.s99_01.en.characterIds, ["sorfon"], "the party member");
  eq(d.changes.event.s99_01.en.questIds, ["cassandra"], "the quest");
  assert(typeof d.changes.event.s99_01.en.xp === "number", "the position");
  assert(d.changes.quest.cassandra.en.sessions.includes(99), "the quest lists the session");
  // 7. Reload: the work is recovered; the public chronicle never shows it.
  await page.reload();
  await page.goto(BASE + "#/taller/tab/sessions");
  await page.waitForSelector(".cc-tl-row[href='#/taller/session/99']", { timeout: 15000 });
  await page.goto(BASE + "#/sessions"); await page.waitForSelector(".cc-scard");
  assert(!(await page.textContent(".cc-page")).includes("Sesión de prueba del taller"), "the public Sessions list does not show the draft");
  // 8. Export.
  await page.goto(BASE + "#/taller/tab/draft");
  await page.waitForSelector("text=Todo en orden: el borrador se puede exportar.");
  const [dl] = await Promise.all([page.waitForEvent("download"), page.click("button:has-text('Exportar el paquete (.zip)')")]);
  const zipPath = path.join(TMP, dl.suggestedFilename());
  await dl.saveAs(zipPath);
  await page.waitForSelector("text=Cambios exportados correctamente. Todavía no están publicados.");
  // 9. The package: the changed files, complete, accepted by the repository's validator and apply tool.
  const entries = await Editor.unzip(fs.readFileSync(zipPath));
  const names = entries.map(e => e.name).sort();
  eq(names, ["LEEME.txt", "cambios.json", "data/events.json", "data/i18n/es-AR.json", "data/quests.json", "data/sessions.json"], "package contents");
  const pkg = path.join(TMP, "pkg");
  entries.forEach(e => { const out = path.join(pkg, e.name); fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, e.data); });
  const evs = JSON.parse(fs.readFileSync(path.join(pkg, "data/events.json"), "utf8")), orig = published("events.json");
  eq(evs.length, orig.length + 2, "every published event kept, two added");
  orig.forEach(e => eq(evs.find(x => x.id === e.id), e, `event ${e.id} untouched`));
  const sess = JSON.parse(fs.readFileSync(path.join(pkg, "data/sessions.json"), "utf8"));
  eq(Object.keys(sess), [...Object.keys(published("sessions.json")), "99"], "sessions kept, 99 added");
  eq(sess["99"].title, "Sesión de prueba del taller", "a Spanish-only title is also the English one");
  assert(/^Recorded 25 Oct 2026 · /.test(sess["99"].dateLabel), "the files' dateLabel convention");
  const out = execFileSync(process.execPath, [path.join(ROOT, "tools", "validate-data.js"), "--data", path.join(pkg, "data")], { encoding: "utf8" });
  assert(/OK — /.test(out), `the validator accepts the package:\n${out.slice(-400)}`);
  const copy = path.join(TMP, "repo-data"); fs.cpSync(path.join(ROOT, "data"), copy, { recursive: true });
  execFileSync(process.execPath, [path.join(ROOT, "tools", "apply-draft.js"), zipPath, "--data", copy], { encoding: "utf8" });
  ["events.json", "sessions.json", "quests.json", "i18n/es-AR.json"].forEach(f => eq(fs.readFileSync(path.join(copy, f), "utf8"), fs.readFileSync(path.join(pkg, "data", f), "utf8"), `apply-draft writes the same ${f}`));
  assert(/TODAVÍA NO ESTÁN PUBLICADOS/.test(fs.readFileSync(path.join(pkg, "LEEME.txt"), "utf8")), "the read-me says nothing is published");
  // 10. Discard, then import the package back: the work returns.
  await page.click("button:has-text('Descartar todo el borrador')");
  await page.click("[data-dialog=taller] .cc-btn.is-danger");
  await waitSaved(page, d => !Object.keys(d.changes.session).length, "discarded");
  await page.setInputFiles("#tl-import", zipPath);
  await page.waitForSelector("[data-dialog=taller]");
  await page.click("[data-dialog=taller] .cc-btn:not(.ghost)");
  await waitSaved(page, d => d.changes.session["99"] && d.changes.event.s99_01, "imported back");
  await page.screenshot({ path: path.join(OUT, "taller-draft.png"), fullPage: false });
  fs.copyFileSync(zipPath, path.join(TMP, "package.zip"));
  await ctx.close();
});

await check("taller · modifying a published session and a published quest changes only those records (and their threads stay aligned in both languages)", async () => {
  const { ctx, page } = await open(LAPTOP, "#/taller/session/12");
  await page.waitForSelector("#tl-session-12-endedHere-es", { timeout: 15000 });
  await page.fill("#tl-session-12-endedHere-es", "La capilla de Pelor, al amanecer (corregido).");
  // A note added to the first open thread, in Spanish: the English list gets an aligned empty slot, filled on export.
  await page.locator(".cc-tl-plot").first().locator("button:has-text('Agregar nota')").click();
  const note = page.locator(".cc-tl-plot").first().locator("textarea[aria-label^='Nota'], input[aria-label^='Nota']").last();
  await note.fill("Nota nueva de prueba");
  await page.goto(BASE + "#/taller/quest/hunted");
  await page.waitForSelector("#tl-quest-hunted-status");
  await page.selectOption("#tl-quest-hunted-status", "completed");
  const d = await waitSaved(page, d => d.changes.quest.hunted && d.changes.session["12"] && d.changes.session["12"].es, "session 12 and quest hunted");
  eq(Object.keys(d.changes.session), ["12"], "only session 12");
  eq(Object.keys(d.changes.quest), ["hunted"], "only that quest");
  eq(d.changes.quest.hunted.en.status, "completed", "the new status (one of the app's four)");
  const pub = published("sessions.json")["12"], en = d.changes.session["12"].en, es = d.changes.session["12"].es;
  eq(en.activePlots[0].notes.length, pub.activePlots[0].notes.length + 1, "one note more in English");
  eq(es.activePlots[0].notes.length, en.activePlots[0].notes.length, "the Spanish list lines up with it");
  eq(es.activePlots[0].notes[es.activePlots[0].notes.length - 1], "Nota nueva de prueba", "the Spanish note in its place");
  eq(Object.keys(en), Object.keys(pub), "the session keeps its fields in their published order");
  await page.goto(BASE + "#/taller/tab/draft");
  await page.waitForSelector("text=Todo en orden: el borrador se puede exportar.");
  const [dl] = await Promise.all([page.waitForEvent("download"), page.click("button:has-text('Exportar el paquete (.zip)')")]);
  const p = path.join(TMP, "modify.zip"); await dl.saveAs(p);
  const entries = await Editor.unzip(fs.readFileSync(p)), file = n => JSON.parse(new TextDecoder().decode(entries.find(e => e.name === n).data));
  const s12 = file("data/sessions.json")["12"];
  eq(s12.activePlots[0].notes[s12.activePlots[0].notes.length - 1], "Nota nueva de prueba", "a Spanish-only note is also the English one");
  eq(file("data/quests.json").find(q => q.id === "hunted").status, "completed", "exported status");
  const allSessions = file("data/sessions.json"), pubAll = published("sessions.json");
  Object.keys(pubAll).filter(k => k !== "12").forEach(k => eq(allSessions[k], pubAll[k], `session ${k} untouched`));
  await ctx.close();
});

await check("taller · invalid data is caught: required fields, a missing session, export blocked until fixed", async () => {
  const { ctx, page } = await open(LAPTOP, "#/taller/tab/events");
  await page.waitForSelector(".cc-tl-tools", { timeout: 15000 });
  await page.click(".cc-tl-tools .cc-btn:has-text('Nuevo acontecimiento')");
  await page.waitForSelector("[data-dialog=taller]");
  await page.click("[data-dialog=taller] button[type=submit]");          // no title: allowed, the form asks for it
  await page.waitForFunction(() => /#\/taller\/event\/s12_/.test(location.hash));
  await page.goto(BASE + "#/taller/tab/draft");
  await page.waitForSelector(".cc-tl-note.is-error");
  assert(await page.isDisabled("button:has-text('Exportar el paquete (.zip)')"), "export disabled while there are errors");
  const issues = await page.textContent(".cc-tl-issues");
  assert(/Falta «Título»/.test(issues) && /Falta «Resumen»/.test(issues), `required fields named: ${issues}`);
  await page.click(".cc-tl-issues a");
  await page.waitForSelector(".cc-tl-form");
  const id = decodeURIComponent((await page.evaluate(() => location.hash)).split("/").pop());
  await page.fill(`#tl-event-${id}-title-es`, "Con título");
  await page.fill(`#tl-event-${id}-summary-es`, "Y con resumen.");
  await page.goto(BASE + "#/taller/tab/draft");
  await page.waitForSelector("text=Todo en orden: el borrador se puede exportar.");
  assert(!(await page.isDisabled("button:has-text('Exportar el paquete (.zip)')")), "export enabled once fixed");
  await ctx.close();
});

await check("taller · a draft never overwrites newer published data silently: the conflict is shown and combined", async () => {
  const { ctx, page } = await open(LAPTOP, "#/taller/event/s12_03");
  await page.waitForSelector("#tl-event-s12_03-title-es", { timeout: 15000 });
  await page.click(".cc-tl-langbar button[lang=en]");
  await page.fill("#tl-event-s12_03-title-en", "My title in the draft");
  await waitSaved(page, d => d.changes.event.s12_03, "edit");
  // The published data changes meanwhile (another field of the same event, and an untouched one).
  rewrite.json = (rel, v) => {
    if (rel === "data/events.json") { v.find(e => e.id === "s12_03").summary = "Summary fixed upstream."; v.find(e => e.id === "s12_04").title = "Untouched, changed upstream"; }
    return v;
  };
  try {
    await page.goto(BASE + "#/taller/tab/draft");
    await page.waitForSelector(".cc-tl-conflict", { timeout: 10000 });
    assert(await page.isDisabled("button:has-text('Exportar el paquete (.zip)')"), "export blocked by the conflict");
    await page.click(".cc-tl-conflict button:has-text('Combinar las dos')");
    await page.waitForSelector("text=Todo en orden: el borrador se puede exportar.");
    const [dl] = await Promise.all([page.waitForEvent("download"), page.click("button:has-text('Exportar el paquete (.zip)')")]);
    const p = path.join(TMP, "conflict.zip"); await dl.saveAs(p);
    const entries = await Editor.unzip(fs.readFileSync(p));
    const evs = JSON.parse(new TextDecoder().decode(entries.find(e => e.name === "data/events.json").data));
    eq(evs.find(e => e.id === "s12_03").summary, "Summary fixed upstream.", "the published fix is kept");
    eq(evs.find(e => e.id === "s12_04").title, "Untouched, changed upstream", "untouched records take the newer version");
    eq(evs.find(e => e.id === "s12_03").title, "My title in the draft", "and the draft's change too");
    assert(!entries.some(e => e.name === "data/i18n/es-AR.json"), "the Spanish file did not change, so it is not in the package");
  } finally { rewrite.json = null; }
  await ctx.close();
});

await check("taller · once an export is incorporated its changes leave the draft by themselves, with a backup — never as conflicts", async () => {
  const { ctx, page } = await open(LAPTOP, "#/taller");
  const editTitle = async (id, text) => {
    await page.goto(BASE + `#/taller/event/${id}`);
    await page.waitForSelector(`#tl-event-${id}-title-es, #tl-event-${id}-title-en`, { timeout: 15000 });
    await page.click(".cc-tl-langbar button[lang=en]");
    await page.fill(`#tl-event-${id}-title-en`, text);
    await waitSaved(page, d => d.changes.event[id] && d.changes.event[id].en.title === text, `edit ${id}`);
  };
  const exportNow = async name => {
    await page.goto(BASE + "#/taller/tab/draft");
    await page.waitForSelector("text=Todo en orden: el borrador se puede exportar.");
    const [dl] = await Promise.all([page.waitForEvent("download"), page.click("button:has-text('Exportar el paquete (.zip)')")]);
    const p = path.join(TMP, name); await dl.saveAs(p);
    return Object.fromEntries((await Editor.unzip(fs.readFileSync(p))).filter(e => e.name.startsWith("data/")).map(e => [e.name, new TextDecoder().decode(e.data)]));
  };
  let served = {};
  rewrite.json = (rel, v) => (served[rel] ? JSON.parse(served[rel]) : v);   // the maintainer incorporates what is put here
  try {
    // The page stays open while the export is incorporated: back on Borrador, the change is recognised.
    await editTitle("s12_03", "A title the DM corrected");
    served = await exportNow("incorporated-1.zip");
    eq(Object.keys(served), ["data/events.json"], "the package");
    await page.goto(BASE + "#/taller/tab/events");
    await page.goto(BASE + "#/taller/tab/draft");
    await page.waitForSelector("text=Un cambio ya está en la versión publicada", { timeout: 10000 });
    await waitSaved(page, d => !d.changes.event.s12_03, "the incorporated change left the stored draft");
    await page.waitForSelector("text=Todavía no hay cambios en el borrador.");
    eq(await page.locator(".cc-tl-conflict").count(), 0, "no conflict");
    await page.waitForSelector(".cc-tl-backups >> text=Antes de quitar cambios ya publicados");
    // Another day: the DM opens the Taller after the next export was incorporated.
    await editTitle("s12_04", "Another corrected title");
    served = await exportNow("incorporated-2.zip");
    eq(JSON.parse(served["data/events.json"]).find(e => e.id === "s12_03").title, "A title the DM corrected", "written over the incorporated version");
    await page.reload();
    await page.waitForSelector("text=Un cambio ya está en la versión publicada", { timeout: 15000 });
    await waitSaved(page, d => !d.changes.event.s12_04, "the second change left the stored draft");
    eq(await page.locator(".cc-tl-conflict").count(), 0, "no conflict after reopening");
  } finally { rewrite.json = null; }
  await ctx.close();
});

await check("taller · two tabs never overwrite each other's draft", async () => {
  const { ctx, page } = await open(LAPTOP, "#/taller/quest/cassandra");
  await page.waitForSelector("#tl-quest-cassandra-title-es", { timeout: 15000 });
  const second = await open(LAPTOP, "#/taller/quest/hunted", { ctx });
  await second.page.waitForSelector("#tl-quest-hunted-title-es", { timeout: 15000 });
  await page.fill("#tl-quest-cassandra-title-es", "Primera pestaña");
  await waitSaved(page, d => d.changes.quest.cassandra, "first tab");
  await second.page.fill("#tl-quest-hunted-title-es", "Segunda pestaña");
  await second.page.waitForSelector("text=El borrador cambió en otra pestaña", { timeout: 6000 });
  const d = await readDraft(page);
  assert(d.changes.quest.cassandra && !d.changes.quest.hunted, "the first tab's work was not overwritten");
  await ctx.close();
});

await check("taller · preview links stay put; the Taller is keyboard-usable, labelled, in both languages; no sideways scroll on a phone", async () => {
  const { ctx, page } = await open(LAPTOP, "#/taller/event/s11_04");
  await page.waitForSelector(".cc-detail .cc-preview-note", { timeout: 15000 });
  const before = await page.evaluate(() => location.hash);
  await page.click(".cc-detail .cc-doc a.cc-a >> nth=0");
  eq(await page.evaluate(() => location.hash), before, "a link in the preview does not navigate");
  // Every form control has a label.
  const unlabelled = await page.$$eval(".cc-tl-form input:not([type=checkbox]):not([type=search]), .cc-tl-form select, .cc-tl-form textarea", els => els.filter(el => {
    const id = el.id; return !(el.getAttribute("aria-label") || (id && document.querySelector(`label[for="${CSS.escape(id)}"]`)) || el.closest("label"));
  }).map(el => el.outerHTML.slice(0, 80)));
  eq(unlabelled, [], "unlabelled controls");
  // English interface.
  await page.click(".cc-lang button:has-text('EN')");
  await page.waitForFunction(() => document.documentElement.lang === "en");
  assert((await page.textContent(".cc-tl-tabs")).includes("Cartography"), "tabs in English");
  await page.click(".cc-lang button:has-text('ES')");
  await ctx.close();
  const ph = await open(PHONE, "#/taller");
  await ph.page.waitForSelector(".cc-tl-tabs", { timeout: 15000 });
  for (const hash of ["#/taller", "#/taller/tab/events", "#/taller/session/12", "#/taller/event/s12_03", "#/taller/tab/draft"]) {
    await ph.page.goto(BASE + hash); await ph.page.waitForSelector(".cc-tl", { timeout: 15000 }); await ph.page.waitForTimeout(250);
    eq(await ph.page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false, `${hash}: no sideways scroll`);
  }
  await ph.page.screenshot({ path: path.join(OUT, "taller-phone.png") });
  await ph.ctx.close();
});

await check("taller · new quest, place and character from their dialogs; a place can never be put inside itself or what it holds", async () => {
  const { ctx, page } = await open(LAPTOP, "#/taller/tab/quests");
  await page.waitForSelector(".cc-tl-tools", { timeout: 15000 });
  const create = async (tab, button, name, extra) => {
    await page.goto(BASE + `#/taller/tab/${tab}`);
    await page.click(`.cc-tl-tools .cc-btn:has-text('${button}')`);
    await page.waitForSelector("[data-dialog=taller]");
    await page.fill("#tl-new-title", name);
    if (extra) await extra();
    await page.click("[data-dialog=taller] button[type=submit]");
    await page.waitForSelector(".cc-tl-form");
    return decodeURIComponent((await page.evaluate(() => location.hash)).split("/").pop());
  };
  eq(await create("quests", "Nueva misión", "Misión de prueba"), "mision-de-prueba", "quest id from its title");
  eq(await create("places", "Nuevo lugar", "Lugar de prueba", () => page.selectOption("#tl-new-parentId", "emon")), "lugar-de-prueba", "place id");
  eq(await create("characters", "Nuevo personaje", "Pnj de prueba", () => page.selectOption("#tl-new-category", "deity")), "pnj-de-prueba", "character id");
  const d = await waitSaved(page, d => d.changes.npc["pnj-de-prueba"], "the three records");
  eq(d.changes.place["lugar-de-prueba"].en.parentId, "emon", "the place lies in Emon");
  eq(d.changes.npc["pnj-de-prueba"].en.category, "deity", "category");
  eq(d.changes.quest["mision-de-prueba"].en.status, "active", "status");
  // Emon's "lies within": neither Emon nor anything inside it can be chosen.
  await page.goto(BASE + "#/taller/place/emon"); await page.waitForSelector("#tl-place-emon-parentId");
  const disabled = await page.$$eval("#tl-place-emon-parentId option[disabled]", os => os.map(o => o.value));
  ["emon", "academic-district", "gilmores-shop", "greyskull-keep", "lugar-de-prueba"].forEach(id => assert(disabled.includes(id), `${id} cannot be Emon's parent`));
  assert(!disabled.includes("taldorei"), "its continent can");
  await ctx.close();
});

await check("taller · deleting an event mentioned elsewhere offers to remove the mentions; discarding everything keeps a backup that restores", async () => {
  const raw = published("events.json"), target = raw.find(e => raw.some(o => (o.relatedEventIds || []).includes(e.id)));
  assert(target, "an event that another event mentions");
  const by = raw.filter(o => (o.relatedEventIds || []).includes(target.id)).map(o => o.id);
  const { ctx, page } = await open(LAPTOP, `#/taller/event/${target.id}`);
  await page.waitForSelector(".cc-tl-form", { timeout: 15000 });
  await page.click(".cc-tl-form details.cc-disc > summary");
  await page.click("button:has-text('Eliminar acontecimiento')");
  await page.waitForSelector("[data-dialog=taller] li");
  await page.click("[data-dialog=taller] button:has-text('Eliminar y quitar las menciones')");
  const d = await waitSaved(page, d => d.changes.event[target.id], "deleted");
  eq(d.changes.event[target.id].op, "delete", "marked for deletion");
  by.forEach(id => assert(!(d.changes.event[id].en.relatedEventIds || []).includes(target.id), `${id} no longer mentions it`));
  // Discard everything (a backup first), then restore that backup.
  await page.goto(BASE + "#/taller/tab/draft");
  await page.click("button:has-text('Descartar todo el borrador')");
  await page.click("[data-dialog=taller] .cc-btn.is-danger");
  await waitSaved(page, d => !Object.keys(d.changes.event).length, "discarded");
  await page.waitForSelector(".cc-tl-backups li:has-text('Antes de descartar todo')");
  await page.click(".cc-tl-backups li:has-text('Antes de descartar todo') button");
  await page.click("[data-dialog=taller] .cc-btn:not(.ghost)");
  await waitSaved(page, d => d.changes.event[target.id] && d.changes.event[target.id].op === "delete", "restored");
  await ctx.close();
});

await check("map editor · closing the page with a marker moved but not confirmed asks first", async () => {
  const { ctx, page } = await open(DESKTOP, "#/map/edit/s12_01");
  await editorReady(page, true);
  const vp = await vpRect(page);
  await page.mouse.click(px(vp.left + vp.width * 0.4), px(vp.top + vp.height * 0.4));
  let asked = null;
  page.on("dialog", dg => { asked = dg.type(); dg.dismiss().catch(() => {}); });
  await page.close({ runBeforeUnload: true });
  for (let i = 0; i < 30 && !asked; i++) await new Promise(r => setTimeout(r, 100));
  eq(asked, "beforeunload", "the browser asks before leaving");
  await ctx.close();
});

await check("places · a place's own recorded position: its page and the map show it (wide: beside the map; phone: #/map/near/…)", async () => {
  rewrite.json = (rel, v) => { if (rel === "data/locations.json") Object.assign(v.find(p => p.id === "whitestone"), { xp: 48.6, yp: 30.2, mapPrecision: "approximate" }); return v; };
  try {
    const { ctx, page } = await open(LAPTOP, "#/places/place/whitestone");
    await page.waitForSelector(".cc-doc .cc-placemap", { timeout: 15000 });
    assert((await page.textContent(".cc-doc .cc-placemap")).includes("La posición aproximada registrada del lugar en el mapa."), "the caption says it is the place's own, approximate");
    const style = await page.$eval(".cc-doc .cc-minimap", a => a.getAttribute("style"));
    assert(/--x:\s*48\.6;/.test(style) && /--y:\s*30\.2;/.test(style), `the preview is at the place's position (${style})`);
    eq(await page.getAttribute(".cc-doc .cc-minimap", "href"), "#/places/place/whitestone".replace("/places/", "/map/"), "View on map: the place beside the map");
    await page.goto(BASE + "#/map/place/whitestone"); await page.waitForSelector(".cc-placemark", { timeout: 10000 });
    assert((await page.textContent(".cc-placemark")).includes("Whitestone"), "a lozenge with its name marks it");
    await ctx.close();
    const ph = await open(PHONE, "#/places/place/whitestone");
    await ph.page.waitForSelector(".cc-doc .cc-placemap", { timeout: 15000 });
    eq(await ph.page.getAttribute(".cc-doc .cc-minimap", "href"), "#/map/near/whitestone", "on a phone: the map centred on it, no pane");
    await ph.page.click(".cc-doc .cc-minimap");
    await ph.page.waitForSelector(".cc-placemark", { timeout: 10000 });
    const mark = await ph.page.locator(".cc-placemark-d").boundingBox(), vp = await vpRect(ph.page);
    assert(mark.x > vp.left && mark.x < vp.left + vp.width && mark.y > vp.top && mark.y < vp.top + vp.height, "in view");
    await ph.ctx.close();
  } finally { rewrite.json = null; }
});

await check("taller · typing stays fluid: each key well under a frame budget on the real data", async () => {
  const { ctx, page } = await open(LAPTOP, "#/taller/event/s12_03");
  await page.waitForSelector("#tl-event-s12_03-summary-es", { timeout: 15000 });
  await page.click("#tl-event-s12_03-summary-es");
  await page.keyboard.press("Control+End");
  const len0 = (await page.inputValue("#tl-event-s12_03-summary-es")).length;
  const t0 = Date.now();
  await page.keyboard.type(" Una frase agregada para medir.", { delay: 0 });
  const per = (Date.now() - t0) / 31;
  console.log(`     ${per.toFixed(1)} ms per key (render + controlled input)`);
  assert(per < 60, `${per.toFixed(1)} ms per key`);
  const after = await page.inputValue("#tl-event-s12_03-summary-es");
  assert(after.endsWith(" Una frase agregada para medir.") && after.length === len0 + 31, `every key landed, in order, at the caret (${after.slice(-40)})`);
  await ctx.close();
});

await check("no console errors, missing strings or failed requests", async () => { eq(errors, [], "errors"); });

await browser.close();
server.close();
fs.rmSync(TMP, { recursive: true, force: true });
const failed = results.filter(r => r[0] === "FAIL");
console.log(`\n${results.length - failed.length}/${results.length} taller checks passed · screenshots in test-results/`);
process.exit(failed.length ? 1 : 0);
