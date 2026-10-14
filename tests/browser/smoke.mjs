// Browser smoke tests (real browser, real page) — npm run test:browser
// Serves the repo with a tiny static server, drives the installed Edge/Chrome through
// playwright-core (no browser download) and checks language, routing, filters, routes,
// clustered markers, touch gestures and the responsive widths. Screenshots → test-results/.
//   BROWSER_CHANNEL=chrome npm run test:browser   (default: msedge)
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const OUT = path.join(ROOT, "test-results");
fs.mkdirSync(OUT, { recursive: true });
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript", ".json": "application/json; charset=utf-8", ".jpeg": "image/jpeg", ".jpg": "image/jpeg", ".png": "image/png", ".css": "text/css" };

const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(new URL(req.url, "http://x").pathname).replace(/^\/+/, "") || "index.html";
  const file = path.join(ROOT, rel);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end("not found"); }
  res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
});
await new Promise(r => server.listen(0, "127.0.0.1", r));
const BASE = `http://127.0.0.1:${server.address().port}/`;

const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || "msedge", headless: true });
const results = [];
const errors = [];
async function check(name, fn) {
  try { await fn(); results.push(["ok", name]); console.log(`ok   ${name}`); }
  catch (e) { results.push(["FAIL", name, e.message]); console.log(`FAIL ${name}\n     ${e.message}`); }
}
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
const eq = (a, b, msg) => assert(JSON.stringify(a) === JSON.stringify(b), `${msg}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);

async function open(ctxOpts, hash, { keepGuide = false } = {}) {
  const ctx = await browser.newContext(ctxOpts);
  if (!keepGuide) await ctx.addInitScript(() => { try { localStorage.setItem("chronicle-tutorial-seen", "1"); } catch (e) {} });
  const page = await ctx.newPage();
  page.on("pageerror", e => errors.push(`${hash}: ${e.message}`));
  page.on("console", m => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(`${hash}: ${m.text()}`); });
  // Every failed request is reported by URL (the site has no favicon, which browsers always ask for).
  page.on("response", r => { if (r.status() >= 400 && !/favicon.ico$/.test(r.url())) errors.push(`${hash}: ${r.status()} ${r.url()}`); });
  await page.goto(BASE + (hash || ""));
  await page.waitForSelector(".cc-page, .cc-mapwrap, .cc-doc", { timeout: 15000 });
  return { ctx, page };
}
const markerTotal = page => page.$$eval(".cc-marker", bs => bs.reduce((n, b) => { const m = /^(\d+) /.exec(b.getAttribute("title")); return n + (m ? +m[1] : 1); }, 0));
const routeInks = page => page.$$eval(".cc-routes polyline", ps => ps.map(p => `${p.getAttribute("stroke")}|${p.getAttribute("stroke-dasharray") || ""}`).filter(s => !s.startsWith("rgba")));
const DESKTOP = { viewport: { width: 1280, height: 820 } };
const PHONE = { viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 };

// ── Language ────────────────────────────────────────────────────────────────
await check("i18n · Spanish is the initial language (no saved preference)", async () => {
  const { ctx, page } = await open(DESKTOP, "", { keepGuide: true });
  eq(await page.getAttribute("html", "lang"), "es-AR", "html lang");
  eq(await page.title(), "Crónica de Exandria", "title");
  assert(await page.isVisible("text=Cómo funciona la Crónica"), "guide is in Spanish");
  await page.keyboard.press("Escape");
  eq((await page.textContent(".cc-tab.is-on")).trim(), "Crónica", "active tab");
  eq((await page.textContent(".cc-lang .is-on")).trim(), "ES", "ES pressed");
  await ctx.close();
});

await check("i18n · ES → EN keeps the open entry, translates UI + content, persists; EN → ES", async () => {
  const { ctx, page } = await open(DESKTOP, "#/chronicle/event/s11_04");
  const esTitle = await page.textContent(".cc-doc-h");
  await page.click(".cc-lang button:has-text('EN')");
  await page.waitForFunction(() => document.documentElement.lang === "en");
  eq(new URL(page.url()).hash, "#/chronicle/event/s11_04", "route kept");
  const enTitle = await page.textContent(".cc-doc-h");
  eq(enTitle, "What the Witch's Book Says of Locus", "English original");
  assert(esTitle !== enTitle, "content changed language");
  eq((await page.textContent(".cc-tab.is-on")).trim(), "Chronicle", "tab label");
  eq(await page.evaluate(() => localStorage.getItem("chronicle-lang")), "en", "saved");
  await page.reload();
  await page.waitForSelector(".cc-doc-h");
  eq(await page.textContent(".cc-doc-h"), enTitle, "restored after reload");
  await page.click(".cc-lang button:has-text('ES')");
  await page.waitForFunction(() => document.documentElement.lang === "es-AR");
  eq(await page.textContent(".cc-doc-h"), esTitle, "back to Spanish");
  eq((await page.textContent(".cc-dockind")).trim(), "Acontecimiento", "detail kind");
  await ctx.close();
});

await check("i18n · no interface text left in English on the main screens (ES)", async () => {
  const { ctx, page } = await open(DESKTOP, "#/chronicle");
  await page.click("button[aria-controls=cc-filters]");
  const leftovers = [];
  for (const hash of ["#/chronicle", "#/sessions", "#/quests", "#/characters", "#/places", "#/map", "#/chronicle/session/8", "#/quests/quest/cassandra", "#/characters/character/pike", "#/places/place/vasselheim"]) {
    await page.evaluate(h => { location.hash = h; }, hash);
    await page.waitForTimeout(250);
    const text = await page.evaluate(() => document.querySelector(".cc-app").innerText);
    for (const w of ["Filters", "Session ", "Quests", "Characters", "Back", "Show in Chronicle", "What happened", "Unresolved threads", "Party member", "Events on the map", "Zoom in", "Read entry", "Played ", "Day "])
      if (text.includes(w)) leftovers.push(`${hash}: "${w}"`);
  }
  eq(leftovers, [], "English UI strings found");
  await ctx.close();
});

await check("search · bilingual and accent-insensitive in the UI", async () => {
  const { ctx, page } = await open(DESKTOP, "#/chronicle");
  const count = async q => { await page.fill("input[type=search]", q); await page.waitForTimeout(120); return page.textContent(".cc-results-t"); };
  const a = await count("revelation"), b = await count("revelación"), c = await count("revelacion");
  eq([b, c], [a, a], "same results");
  assert(/^2 de 33/.test(a), `got "${a}"`);
  await ctx.close();
});

// ── Map: filters, routes, markers ───────────────────────────────────────────
await check("map · party filter uses OR for shared events; routes follow the selection only", async () => {
  const { ctx, page } = await open(DESKTOP, "#/map");
  await page.waitForTimeout(700);
  eq(await markerTotal(page), 33, "every event in exactly one marker");
  eq(await routeInks(page), ["#1a1208|7 5"], "one shared journey line (not four, not chronological)");
  await page.click(".cc-mapbtn");
  await page.waitForSelector(".cc-mappanel");
  const row = name => page.locator(".cc-partyrow", { hasText: name }).click();
  await row("Ayante");
  eq(await markerTotal(page), 32, "only Ayante's solo event hides; shared ones stay");
  await row("Ereldra"); await row("Sorfon");
  eq(await routeInks(page), ["#858590|11 4 2 4"], "Mortis alone: his own route in his colour");
  eq(await markerTotal(page), 23, "Mortis's events incl. shared");
  // A quest filter changes pins, never the routes.
  await page.evaluate(() => { location.hash = "#/chronicle"; });
  await page.click("button[aria-controls=cc-filters]");
  await page.selectOption(".cc-field:has-text('Misión') select", "cassandra");
  await page.evaluate(() => { location.hash = "#/map"; });
  await page.waitForTimeout(400);
  eq(await routeInks(page), ["#858590|11 4 2 4"], "quest filter leaves routes alone");
  assert(await markerTotal(page) < 23, "quest filter narrows pins");
  await ctx.close();
});

await check("map · phone: tap a cluster → list → event, popup inside the screen, no page scroll", async () => {
  const { ctx, page } = await open(PHONE, "#/map");
  await page.waitForTimeout(900);
  const big = page.locator(".cc-marker", { hasText: /^\d+$/ }).first();
  const n = +(await big.textContent());
  await big.tap();
  await page.waitForSelector(".cc-plist");
  eq(await page.$$eval(".cc-plist-i", l => l.length), n, "list shows every event of the cluster");
  await page.locator(".cc-plist-i").nth(1).tap();
  await page.waitForFunction(() => /#\/map\/at\//.test(location.hash));
  const box = await page.locator("[data-nopan]:has(.cc-popup-t)").boundingBox();
  assert(box.x >= 0 && box.x + box.width <= 375, `popup at ${box.x}..${box.x + box.width}`);
  eq(await page.evaluate(() => document.documentElement.scrollWidth), 375, "no horizontal scroll");
  await page.screenshot({ path: path.join(OUT, "map-phone-popup.png") });
  await ctx.close();
});

await check("map · small phone (320×640): every marker's popup fits on screen, below the map bar", async () => {
  const { ctx, page } = await open({ viewport: { width: 320, height: 640 }, hasTouch: true, isMobile: true }, "#/map");
  await page.waitForTimeout(900);
  const bounds = async () => {
    const vp = await page.locator(".cc-vp").boundingBox(), bar = await page.locator(".cc-mapbar").boundingBox();
    return { top: bar.y + bar.height, bottom: vp.y + vp.height, left: vp.x, right: vp.x + vp.width };
  };
  const inside = async (sel, label) => {
    await page.waitForTimeout(250);                                   // let the pop-in animation settle
    const b = await page.locator(sel).last().boundingBox(), r = await bounds();
    assert(b.x >= r.left && b.x + b.width <= r.right + 0.5, `${label}: x ${b.x.toFixed(0)}..${(b.x + b.width).toFixed(0)}`);
    assert(b.y >= r.top - 0.5 && b.y + b.height <= r.bottom + 0.5, `${label}: y ${b.y.toFixed(0)}..${(b.y + b.height).toFixed(0)} not within ${r.top.toFixed(0)}..${r.bottom.toFixed(0)}`);
  };
  const n = await page.locator(".cc-marker").count();
  for (let i = 0; i < n; i++) {
    await page.evaluate(() => { location.hash = "#/map"; });
    await page.waitForTimeout(300);
    const mk = page.locator(".cc-marker").nth(i);
    const title = await mk.getAttribute("title");
    await mk.tap();
    if (await page.locator(".cc-plist").count()) {
      await inside("[data-nopan]:has(.cc-plist)", `list "${title}"`);
      await page.locator(".cc-plist-i").first().tap();
    }
    await page.waitForSelector(".cc-popup-t");
    await inside("[data-nopan]:has(.cc-popup-t)", `popup "${title}"`);
  }
  await page.screenshot({ path: path.join(OUT, "map-320-popup.png") });
  await ctx.close();
});

await check("map · touch gestures: pinch zooms, one finger pans", async () => {
  const { ctx, page } = await open(PHONE, "#/map");
  await page.waitForTimeout(900);
  const cdp = await ctx.newCDPSession(page);
  const zoom = () => page.textContent(".cc-zlabel").then(t => parseInt(t, 10));
  const world = () => page.$eval(".cc-vp > div", d => d.style.transform);
  const z0 = await zoom();
  const pts = (d) => [{ x: 187 - d, y: 500 }, { x: 187 + d, y: 500 }];
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: pts(30) });
  for (let d = 40; d <= 120; d += 10) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: pts(d) });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  const z1 = await zoom();
  assert(z1 > z0, `pinch zoom ${z0}% → ${z1}%`);
  const w0 = await world();
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: 200, y: 450 }] });
  for (let i = 1; i <= 6; i++) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: 200 - i * 15, y: 450 - i * 10 }] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  assert((await world()) !== w0, "pan moved the map");
  await ctx.close();
});

await check("map · back to the Chronicle from the bottom nav keeps filters", async () => {
  const { ctx, page } = await open(PHONE, "#/map");
  await page.locator(".cc-bn", { hasText: "Crónica" }).tap();
  await page.waitForSelector(".cc-results-t");
  eq(new URL(page.url()).hash, "#/chronicle", "route");
  await ctx.close();
});

// ── Responsive widths ───────────────────────────────────────────────────────
for (const [w, h] of [[320, 640], [360, 740], [390, 844], [430, 932], [768, 1024], [1280, 820]]) {
  await check(`responsive · ${w}px: no horizontal scroll, header fits, language switch reachable`, async () => {
    const phone = w < 720;
    const { ctx, page } = await open({ viewport: { width: w, height: h }, hasTouch: phone, isMobile: phone }, "#/chronicle");
    for (const hash of ["#/chronicle", "#/chronicle/event/s12_03", "#/sessions", "#/quests/quest/cassandra", "#/characters", "#/places", "#/map"]) {
      await page.evaluate(x => { location.hash = x; }, hash);
      await page.waitForTimeout(300);
      const sw = await page.evaluate(() => document.documentElement.scrollWidth);
      assert(sw <= w, `${hash}: scrollWidth ${sw} > ${w}`);
    }
    const lang = await page.locator(".cc-lang").boundingBox(), brand = await page.locator(".cc-brand").boundingBox();
    assert(lang && lang.width > 0 && lang.x + lang.width <= w, "language switch visible");
    assert(brand.x + brand.width <= lang.x, "brand and switch do not overlap");
    assert((await page.locator(".cc-bottom").isVisible()) === phone, "bottom nav only on phones");
    await page.evaluate(() => { location.hash = "#/chronicle"; });
    await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(OUT, `chronicle-${w}.png`) });
    await page.evaluate(() => { location.hash = "#/map"; });
    await page.waitForTimeout(700);
    await page.screenshot({ path: path.join(OUT, `map-${w}.png`) });
    await ctx.close();
  });
}

// ── Lore of Exandria ────────────────────────────────────────────────────────
// External pages are stubbed: the tests never reach Fandom, they only check what the app asks for.
const stubWiki = ctx => ctx.route("https://criticalrole.fandom.com/**", r => r.fulfill({ status: 200, contentType: "text/html", body: "<title>stub</title>" }));

await check("lore · collapsed by default; safe new-tab link; spoiler warning; ES ↔ EN; next entry folds again", async () => {
  const { ctx, page } = await open(DESKTOP, "#/places/place/taldorei");
  await stubWiki(ctx);
  const isOpen = () => page.locator(".cc-lore").evaluate(d => d.open);
  eq(await isOpen(), false, "collapsed");
  assert(!(await page.locator(".cc-lore-p").isVisible()), "summary hidden while collapsed");
  await page.click(".cc-lore summary");
  assert(await page.locator(".cc-lore-p").isVisible(), "summary shown");
  const a = page.locator(".cc-extlink");
  eq(await a.count(), 1, "one reference");
  eq(await a.getAttribute("href"), "https://criticalrole.fandom.com/wiki/Tal%27Dorei", "href");
  eq([await a.getAttribute("target"), await a.getAttribute("rel")], ["_blank", "noopener noreferrer"], "target/rel");
  assert((await a.textContent()).includes("Critical Role Wiki"), "source named");
  eq((await page.textContent(".cc-lore-warn")).trim(), "El artículo externo puede contener spoilers del universo de Critical Role.", "spoiler warning");
  const [tab] = await Promise.all([ctx.waitForEvent("page"), a.click()]);
  await tab.waitForLoadState();
  eq(tab.url(), "https://criticalrole.fandom.com/wiki/Tal%27Dorei", "article opened in a new tab");
  eq(await tab.evaluate(() => window.opener), null, "no window.opener");
  await tab.close();
  eq(new URL(page.url()).hash, "#/places/place/taldorei", "the chronicle stays where it was");
  await page.click(".cc-lang button:has-text('EN')");
  await page.waitForFunction(() => document.documentElement.lang === "en");
  eq(await isOpen(), true, "still open after switching language");
  assert((await page.textContent(".cc-lore-p")).startsWith("One of the continents of Exandria"), "English summary");
  eq(await page.getAttribute(".cc-lore-p", "lang"), "en", "lang attribute");
  eq((await page.textContent(".cc-lore-warn")).trim(), "The external article may contain spoilers from the Critical Role universe.", "English warning");
  await page.evaluate(() => { location.hash = "#/places/place/emon"; });
  await page.waitForFunction(() => document.querySelector(".cc-doc-h").textContent === "Emon");
  eq(await isOpen(), false, "the next entry starts collapsed");
  await page.evaluate(() => { location.hash = "#/characters/character/diomedes"; });
  await page.waitForFunction(() => document.querySelector(".cc-doc-h").textContent === "Diomedes");
  eq(await page.locator(".cc-lore").count(), 0, "no lore section for the DM's own NPC");
  await ctx.close();
});

await check("lore · Chronicle → event → character → lore → back twice; search filter kept; campaign sections first", async () => {
  const { ctx, page } = await open(DESKTOP, "#/chronicle");
  await page.fill("input[type=search]", "Allura");
  await page.waitForTimeout(150);
  const results = await page.textContent(".cc-results-t");
  await page.click("a[data-ev=s2_04]");
  await page.waitForFunction(() => location.hash === "#/chronicle/event/s2_04");
  await page.click(".cc-doc a[href='#/chronicle/character/allura']");
  await page.waitForFunction(() => location.hash === "#/chronicle/character/allura");
  const order = await page.$$eval(".cc-doc > h2, .cc-doc > details", els => els.map(e => e.tagName));
  eq(order[order.length - 1], "DETAILS", "lore comes after every campaign section");
  assert(order.filter(x => x === "H2").length >= 2, "campaign sections present");
  await page.click(".cc-lore summary");
  assert((await page.textContent(".cc-lore-p")).includes("abjuración"), "Spanish summary");
  await page.click(".cc-back");
  await page.waitForFunction(() => location.hash === "#/chronicle/event/s2_04");
  await page.click(".cc-back");
  await page.waitForFunction(() => location.hash === "#/chronicle");
  eq(await page.inputValue("input[type=search]"), "Allura", "search kept");
  eq(await page.textContent(".cc-results-t"), results, "same results");
  await ctx.close();
});

for (const w of [320, 360, 390, 430]) {
  await check(`lore · ${w}px phone: tap to expand, readable, comfortable link, no horizontal scroll`, async () => {
    // Phones show an entry full-screen (the list is hidden), so open the list first, then the entry.
    const { ctx, page } = await open({ viewport: { width: w, height: 780 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 }, "#/characters");
    await page.evaluate(() => { location.hash = "#/characters/character/raven-queen"; });
    await page.waitForSelector(".cc-lore");
    const sum = page.locator(".cc-lore summary");
    const closedH = (await sum.boundingBox()).height;
    assert(closedH >= 44 && closedH <= 90, `collapsed section is one compact row (${closedH}px)`);
    await sum.scrollIntoViewIfNeeded();
    await sum.tap();
    await page.waitForFunction(() => document.querySelector(".cc-lore").open);
    const m = await page.evaluate(() => {
      const d = document.querySelector(".cc-detail"), a = document.querySelector(".cc-extlink").getBoundingClientRect();
      return { sw: document.documentElement.scrollWidth, dsw: d.scrollWidth, dcw: d.clientWidth, a: { x: a.x, r: a.right, h: a.height },
        font: parseFloat(getComputedStyle(document.querySelector(".cc-lore-p")).fontSize),
        warn: parseFloat(getComputedStyle(document.querySelector(".cc-lore-warn")).fontSize), facts: document.querySelectorAll(".cc-lore .cc-fact").length };
    });
    assert(m.sw <= w && m.dsw <= m.dcw, `horizontal scroll: page ${m.sw}, pane ${m.dsw}/${m.dcw}`);
    assert(m.a.h >= 44 && m.a.x >= 0 && m.a.r <= w, `link box ${JSON.stringify(m.a)}`);
    assert(m.font >= 16 && m.warn >= 14, `font sizes ${m.font}/${m.warn}`);
    eq(m.facts, 4, "deity facts");
    await page.locator(".cc-lore").screenshot({ path: path.join(OUT, `lore-${w}.png`) });
    await sum.tap();
    await page.waitForFunction(() => !document.querySelector(".cc-lore").open);
    await ctx.close();
  });
}

// ── One dark theme ──────────────────────────────────────────────────────────
const lum = rgb => { const [r, g, b] = rgb.match(/[\d.]+/g).slice(0, 3).map(Number).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
await check("theme · always dark: no toggle, an old light preference is ignored and removed, dark browser chrome", async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, colorScheme: "light" });
  await ctx.addInitScript(() => { try { localStorage.setItem("chronicle-tutorial-seen", "1"); if (!sessionStorage.getItem("seeded")) { localStorage.setItem("chronicle-theme", JSON.stringify("light")); sessionStorage.setItem("seeded", "1"); } } catch (e) {} });
  const page = await ctx.newPage();
  page.on("pageerror", e => errors.push(`theme: ${e.message}`));
  await page.goto(BASE + "#/places/place/vasselheim");
  await page.waitForSelector(".cc-lore");
  eq(await page.locator(".theme-light, .theme-dark").count(), 0, "no theme classes");
  eq(await page.evaluate(() => localStorage.getItem("chronicle-theme")), null, "old preference removed");
  eq(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme), "dark", "color-scheme");
  eq(await page.getAttribute("meta[name=theme-color]", "content"), "#140f08", "theme-color");
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  assert(lum(bg) < 0.02, `body background ${bg}`);
  // The reading pane fills the phone screen; go back to a list to reach the bottom bar's More sheet.
  await page.evaluate(() => { location.hash = "#/places"; });
  await page.locator("button.cc-bn").tap();                    // "More" (labelled with the current secondary section)
  await page.waitForSelector(".cc-sheet");
  const sheet = (await page.textContent(".cc-sheet")).toLowerCase();
  assert(!/modo|claro|oscuro|tema/.test(sheet), `sheet: ${sheet}`);
  eq(await page.locator(".cc-sheet-item").count(), 4, "Characters, Places, Map + guide");
  await page.keyboard.press("Escape");
  // Secondary surfaces use the dark tokens: lore text, popup panels, map controls.
  await page.evaluate(() => { location.hash = "#/places/place/vasselheim"; });
  await page.waitForSelector(".cc-lore");
  await page.locator(".cc-lore summary").tap();
  eq(await page.$eval(".cc-lore-p", el => getComputedStyle(el).color), "rgb(205, 181, 136)", "lore text uses --body2");
  await page.screenshot({ path: path.join(OUT, "theme-dark-390.png") });
  await page.evaluate(() => { location.hash = "#/map"; });
  await page.waitForSelector(".cc-mapbtn");
  for (const sel of [".cc-mapbtn", ".cc-zbtn"]) {
    const c = await page.$eval(sel, el => getComputedStyle(el).backgroundColor);
    assert(lum(c) < 0.05, `${sel} background ${c} is dark`);
  }
  await page.reload();
  await page.waitForSelector(".cc-mapwrap");
  eq(await page.evaluate(() => localStorage.getItem("chronicle-theme")), null, "still no theme after reload");
  await ctx.close();
});

await check("theme · no light flash: the document is dark before the app boots", async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: "light" });
  const page = await ctx.newPage();
  let release;
  const held = new Promise(r => { release = r; });
  await page.route("**/support.js", async r => { await held; await r.continue(); });
  const nav = page.goto(BASE + "#/chronicle", { waitUntil: "commit" });
  await nav;
  await page.waitForFunction(() => !!document.documentElement && !!document.head && !!document.querySelector("head style"));
  const bg = await page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor);
  release();
  assert(lum(bg) < 0.02, `html background before the runtime: ${bg}`);
  await ctx.close();
});

// ── Default orders ──────────────────────────────────────────────────────────
await check("order · Chronicle opens latest first, Sessions oldest first; both reversible, kept apart, kept across languages", async () => {
  const { ctx, page } = await open(DESKTOP, "#/chronicle");
  const days = () => page.$$eval(".cc-glabel", els => els.map(e => parseInt(e.textContent.replace(/\D+/g, ""), 10)));
  const d0 = await days();
  assert(d0.length > 3 && d0.every((d, i) => !i || d < d0[i - 1]), `latest day first: ${d0}`);
  const day39 = await page.$$eval(".cc-group", gs => { const g = gs.find(x => /39/.test(x.querySelector(".cc-glabel").textContent)); return [...g.querySelectorAll("a[data-ev]")].map(a => a.dataset.ev); });
  eq(day39.slice(0, 2), ["s11_05", "s11_06"], "inside a day, the recorded order (session 11 before 12)");
  const sortBtn = ".cc-results .cc-seg:last-child button";
  eq((await page.textContent(sortBtn)).trim(), "Recientes primero", "label");
  await page.click(sortBtn);
  const d1 = await days();
  eq(d1, d0.slice().reverse(), "oldest first after one tap");
  eq(await page.evaluate(() => JSON.parse(localStorage.getItem("chronicle-prefs")).chronicleOrder), "asc", "explicit choice saved");
  await page.click(".cc-lang button:has-text('EN')");
  await page.waitForFunction(() => document.documentElement.lang === "en");
  eq(await days(), d1, "language switch keeps the order");
  eq((await page.textContent(sortBtn)).trim(), "Oldest first", "English label");
  // Sessions: its own default, its own preference.
  await page.evaluate(() => { location.hash = "#/sessions"; });
  await page.waitForSelector(".cc-scard");
  const nos = () => page.$$eval(".cc-scard-no", els => els.map(e => +e.textContent));
  const s0 = await nos();
  eq(s0, s0.slice().sort((a, b) => a - b), "Sessions oldest first by default (numeric: 10 after 8)");
  await page.click(".cc-sechead .cc-seg button:last-child");
  eq(await nos(), s0.slice().reverse(), "latest first");
  await page.reload();
  await page.waitForSelector(".cc-scard");
  eq(await nos(), s0.slice().reverse(), "Sessions choice kept after reload");
  await page.evaluate(() => { location.hash = "#/chronicle"; });
  await page.waitForSelector(".cc-glabel");
  eq(await days(), d1, "the Chronicle choice is independent and kept too");
  await ctx.close();
});

await check("order · filters work with both orders (same entries, reversed days)", async () => {
  const { ctx, page } = await open(DESKTOP, "#/chronicle");
  await page.fill("input[type=search]", "pelor");
  await page.waitForTimeout(150);
  const evs = () => page.$$eval("a[data-ev]", as => as.map(a => a.dataset.ev));
  const desc = await evs(), count = await page.textContent(".cc-results-t");
  await page.click(".cc-results .cc-seg:last-child button");
  const asc = await evs();
  eq(asc.slice().sort(), desc.slice().sort(), "same entries");
  eq(await page.textContent(".cc-results-t"), count, "same count");
  assert(asc[0] !== desc[0], "different first entry");
  await ctx.close();
});

// ── Event cards: icon + label, three levels, compact ────────────────────────
await check("cards · every event card has its type icon (family colour) and label; title outranks metadata", async () => {
  const { ctx, page } = await open({ viewport: { width: 360, height: 740 }, hasTouch: true, isMobile: true }, "#/chronicle");
  const cards = await page.$$eval("a.cc-card", as => as.map(a => {
    const svg = a.querySelector(".cc-kind svg"), t = a.querySelector(".cc-card-t"), meta = a.querySelector(".cc-kind-l");
    const fam = [...a.classList].find(c => c.startsWith("ev-"));
    return { fam, svg: !!svg && svg.getAttribute("aria-hidden") === "true", label: meta && meta.textContent.trim(), iconColor: svg && getComputedStyle(svg).color,
      titlePx: parseFloat(getComputedStyle(t).fontSize), metaPx: parseFloat(getComputedStyle(meta).fontSize), h: a.getBoundingClientRect().height };
  }));
  eq(cards.length, 33, "all cards");
  for (const c of cards) {
    assert(c.fam && c.svg && c.label, `card ${JSON.stringify(c)}`);
    assert(c.titlePx >= 18 && c.metaPx >= 13 && c.titlePx > c.metaPx + 4, `hierarchy ${c.titlePx}/${c.metaPx}`);
    assert(c.h <= 180, `compact card (${c.h}px)`);
  }
  const byFam = {};
  cards.forEach(c => { (byFam[c.fam] = byFam[c.fam] || new Set()).add(c.iconColor); });
  Object.entries(byFam).forEach(([f, cs]) => eq(cs.size, 1, `one colour for ${f}`));
  eq(new Set(Object.values(byFam).map(s => [...s][0])).size, Object.keys(byFam).length, "families have distinct colours");
  await page.screenshot({ path: path.join(OUT, "cards-360.png") });
  await ctx.close();
});

await check("no console errors or page errors", async () => { eq(errors, [], "errors"); });

await browser.close();
server.close();
const failed = results.filter(r => r[0] === "FAIL");
console.log(`\n${results.length - failed.length}/${results.length} browser checks passed · screenshots in test-results/`);
process.exit(failed.length ? 1 : 0);
