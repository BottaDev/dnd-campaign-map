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
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript", ".json": "application/json; charset=utf-8", ".jpeg": "image/jpeg", ".jpg": "image/jpeg", ".png": "image/png", ".css": "text/css", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json" };

// A static server like `npx serve`. `rewrite(rel, text)` may change a text file on the fly (used to
// publish "new content" in the offline/update test); `close()` drops every connection (= offline).
function startServer({ port = 0, rewrite } = {}) {
  const sockets = new Set();
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(new URL(req.url, "http://x").pathname).replace(/^\/+/, "") || "index.html";
    const file = path.join(ROOT, rel);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end("not found"); }
    res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream", "cache-control": "no-cache" });
    if (rewrite && /\.(json|js|html)$/.test(file)) return res.end(rewrite(rel, fs.readFileSync(file, "utf8")));
    fs.createReadStream(file).pipe(res);
  });
  server.on("connection", s => { sockets.add(s); s.on("close", () => sockets.delete(s)); });
  return new Promise(r => server.listen(port, "127.0.0.1", () => r({
    server, port: server.address().port, base: `http://127.0.0.1:${server.address().port}/`,
    close: () => new Promise(done => { sockets.forEach(s => s.destroy()); server.close(() => done()); }),
  })));
}
const main = await startServer();
const server = main.server;
const BASE = main.base;

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
  if (!keepGuide) await ctx.addInitScript(() => { try { localStorage.setItem("chronicle-tour-version", "2"); localStorage.setItem("chronicle-tour-invite", "dismissed"); } catch (e) {} });
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
  assert(await page.isVisible(".cc-invite:has-text('Descubrí cómo explorar las aventuras de Bund Der Vier')"), "the tour invitation is in Spanish");
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
  for (const hash of ["#/chronicle", "#/sessions", "#/quests", "#/characters", "#/places", "#/map", "#/saved", "#/chronicle/session/8", "#/chronicle/recap/12", "#/quests/quest/cassandra", "#/characters/character/pike", "#/places/place/vasselheim"]) {
    await page.evaluate(h => { location.hash = h; }, hash);
    await page.waitForTimeout(250);
    const text = await page.evaluate(() => document.querySelector(".cc-app").innerText);
    for (const w of ["Filters", "Session ", "Quests", "Characters", "Back", "Show in Chronicle", "What happened", "Unresolved threads", "Party member", "Events on the map", "Zoom in", "Read entry", "Played ", "Day ", "Previously on", "Saved", "Favourites", "Search"])
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
    for (const hash of ["#/chronicle", "#/chronicle/event/s12_03", "#/chronicle/recap/12", "#/sessions", "#/quests/quest/cassandra", "#/characters", "#/places", "#/saved", "#/map"]) {
      await page.evaluate(x => { location.hash = x; }, hash);
      await page.waitForTimeout(300);
      const sw = await page.evaluate(() => document.documentElement.scrollWidth);
      assert(sw <= w, `${hash}: scrollWidth ${sw} > ${w}`);
    }
    // The search and the help (both views, every answer open) fit too — no sideways scroll inside them either.
    const inside = sel => page.$eval(sel, el => [el.scrollWidth, el.clientWidth, document.documentElement.scrollWidth]);
    await page.click(".cc-searchbtn");
    await page.fill(".cc-spanel input", "Vasselheim");
    await page.waitForTimeout(150);
    { const [a, b, c] = await inside(".cc-sbody"); assert(a <= b && c <= w, `search ${a}/${b}, page ${c}`); }
    if (w === 390 || w === 1280) await page.screenshot({ path: path.join(OUT, `search-${w}.png`) });
    await page.keyboard.press("Escape");
    await page.evaluate(() => { location.hash = "#/chronicle"; });
    await page.locator(phone ? ".cc-bottom button.cc-bn" : ".cc-actions button").first().click();
    if (phone) await page.locator(".cc-sheet-item", { hasText: "Ayuda" }).click();
    await page.waitForSelector("[data-dialog=help]");
    await page.$$eval(".cc-faq-i", ds => ds.forEach(d => { d.open = true; }));
    { const [a, b, c] = await inside(".cc-help"); assert(a <= b && c <= w, `help ${a}/${b}, page ${c}`); }
    if (w === 320 || w === 1280) await page.screenshot({ path: path.join(OUT, `help-${w}-open.png`) });
    await page.click(".cc-help-tabs button:last-child");
    { const [a, b, c] = await inside(".cc-help"); assert(a <= b && c <= w, `glossary ${a}/${b}, page ${c}`); }
    await page.keyboard.press("Escape");
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
  await ctx.addInitScript(() => { try { localStorage.setItem("chronicle-tour-version", "2"); localStorage.setItem("chronicle-tour-invite", "dismissed"); if (!sessionStorage.getItem("seeded")) { localStorage.setItem("chronicle-theme", JSON.stringify("light")); sessionStorage.setItem("seeded", "1"); } } catch (e) {} });
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
  eq(await page.locator(".cc-sheet-item").count(), 6, "Characters, Places, Map + Saved, Guide, Icons & colours");
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

// ── Onboarding: first visit, interactive tours (Driver.js), help centre ─────
// The tours run on the real page: these checks click the real controls the popovers point at.
const TOUR = page => page.evaluate(() => {
  const p = document.querySelector(".driver-popover.cc-tour");
  if (!p || getComputedStyle(p).display === "none" || document.body.classList.contains("cc-tour-busy")) return null;
  const r = p.getBoundingClientRect(), a = document.querySelector(".driver-active-element"), ar = a && a.getBoundingClientRect();
  const q = s => { const e = p.querySelector(s); return e && getComputedStyle(e).display !== "none" ? e.textContent.trim() : ""; };
  return { title: q(".driver-popover-title"), progress: q(".driver-popover-progress-text"), next: q(".driver-popover-next-btn"),
    box: [r.left, r.top, r.right, r.bottom].map(Math.round),
    active: a && a.id !== "driver-dummy-element" ? { cls: a.className, tour: a.getAttribute("data-tour") || "", box: [ar.left, ar.top, ar.right, ar.bottom].map(Math.round), inert: a.classList.contains("driver-no-interaction") } : null };
});
// Waits for the next popover (optionally a given title, or any title but `not`), placed and settled.
async function tourAt(page, title, { not, timeout = 10000 } = {}) {
  await page.waitForFunction(([t, n]) => {
    const p = document.querySelector(".driver-popover.cc-tour");
    if (!p || getComputedStyle(p).display === "none" || document.body.classList.contains("cc-tour-busy")) return false;
    const h = p.querySelector(".driver-popover-title"), s = h ? h.textContent.trim() : "";
    return (!t || s === t) && (!n || s !== n);
  }, [title || "", not || ""], { timeout });
  await page.waitForTimeout(80);                                    // Driver.js places it on the next frames
  return TOUR(page);
}
const tourNext = page => page.click(".driver-popover.cc-tour .driver-popover-next-btn");
async function tourStepNext(page) { const s = await TOUR(page); await tourNext(page); return tourAt(page, null, { not: s.title }); }
async function tourNextTo(page, title) { let s = await TOUR(page); for (let i = 0; i < 12 && s.title !== title; i++) s = await tourStepNext(page); eq(s.title, title, "reached"); return s; }
const tourGone = page => page.waitForFunction(() => !document.querySelector(".driver-popover") && !document.body.classList.contains("driver-active"), null, { timeout: 5000 });
const onboarding = page => page.evaluate(() => ({ version: localStorage.getItem("chronicle-tour-version"), completed: JSON.parse(localStorage.getItem("chronicle-tour-completed") || "[]"), invite: localStorage.getItem("chronicle-tour-invite") }));
// The popover is on screen, does not cover the control it explains, and that control can still be
// tapped (the point at its centre belongs to it); the page never scrolls sideways. Measured once the
// highlight has finished moving (Driver.js animates the cut-out; map popups settle once more).
const FIT = ([w, h]) => {
  const p = document.querySelector(".driver-popover.cc-tour");
  if (!p || getComputedStyle(p).display === "none" || document.body.classList.contains("cc-tour-busy")) return { ok: false, why: "no popover" };
  const r = p.getBoundingClientRect(), title = p.querySelector(".driver-popover-title").textContent.trim();
  if (r.left < 0 || r.top < 0 || r.right > w || r.bottom > h) return { ok: false, why: `“${title}”: popover ${[r.left, r.top, r.right, r.bottom].map(Math.round)} outside ${w}×${h}` };
  if (document.documentElement.scrollWidth > w) return { ok: false, why: `horizontal scroll (${document.documentElement.scrollWidth}px)` };
  const a = document.querySelector(".driver-active-element");
  if (!a || a.id === "driver-dummy-element") return { ok: true };
  const q = a.getBoundingClientRect();
  const ix = Math.max(0, Math.min(r.right, q.right) - Math.max(r.left, q.left)), iy = Math.max(0, Math.min(r.bottom, q.bottom) - Math.max(r.top, q.top));
  const cover = ix * iy / Math.max(1, q.width * q.height);
  if (cover >= 0.35) return { ok: false, why: `“${title}”: the popover covers ${Math.round(100 * cover)}% of its control` };
  if (!a.classList.contains("driver-no-interaction")) {
    const x = Math.round((Math.max(q.left, 0) + Math.min(q.right, w)) / 2), y = Math.round((Math.max(q.top, 0) + Math.min(q.bottom, h)) / 2), e = document.elementFromPoint(x, y);
    if (!(e && a.contains(e))) return { ok: false, why: `“${title}”: its control cannot be tapped at ${x},${y}` };
  }
  return { ok: true };
};
async function fits(page, w, h, label) {
  try { await page.waitForFunction(FIT, [w, h], { timeout: 2500 }); }
  catch (e) { const r = await page.evaluate(FIT, [w, h]); throw new Error(`${label}: ${r.why}`); }
  return TOUR(page);
}

await check("tour · first visit: an introduction and an invitation, no window; the main tour follows real clicks across screens; remembered", async () => {
  const { ctx, page } = await open(DESKTOP, "#/chronicle", { keepGuide: true });
  eq(await page.locator(".driver-popover, [data-dialog]").count(), 0, "nothing opens by itself");
  assert(await page.isVisible(".cc-intro:has-text('Nuestra historia, en un solo lugar.')"), "what this is");
  assert(await page.isVisible(".cc-invite:has-text('¿Primera vez por acá?')"), "the invitation");
  const len0 = await page.evaluate(() => history.length);
  await page.click(".cc-invite .cc-btn");
  let s = await tourAt(page, "Crónica de Exandria");
  eq([s.progress, s.next], ["1 de 7", "Comenzar"], "welcome");
  eq(await page.evaluate(() => document.activeElement.classList.contains("driver-popover-next-btn")), true, "focus on “Comenzar”");
  eq(await page.locator(".driver-popover .cc-tour-alt:has-text('Omitir')").count(), 1, "can be skipped");
  await page.screenshot({ path: path.join(OUT, "tour-desktop-welcome.png") });
  await tourNext(page);
  s = await tourAt(page, "Recordá la última sesión");
  assert(/cc-latest/.test(s.active.cls), "the real “Previously on…” entry");
  await page.click(".cc-latest");                                                   // the visitor does it
  await page.waitForFunction(() => location.hash === "#/chronicle/recap/12");
  s = await tourAt(page, "Anteriormente en…");
  eq(s.active.tour, "recap-where", "what the recap holds");
  await tourNext(page);
  s = await tourAt(page, "Explorá la Crónica");
  eq(await page.evaluate(() => location.hash), "#/chronicle", "back on the list");
  assert(/cc-card/.test(s.active.cls), "a real event card");
  await page.click(".driver-active-element");
  await page.waitForFunction(() => /^#\/chronicle\/event\//.test(location.hash));
  s = await tourAt(page, "Descubrí las conexiones");
  eq(s.active.tour, "event-people", "one clear relation: who was there");
  await page.screenshot({ path: path.join(OUT, "tour-desktop-links.png") });
  await page.locator(".driver-active-element a.cc-chip").nth(2).click();
  await page.waitForFunction(() => /^#\/chronicle\/character\//.test(location.hash));
  s = await tourAt(page, "Encontrá cualquier cosa");
  assert(/cc-searchbtn/.test(s.active.cls), "the real search button");
  await page.click(".cc-searchbtn");
  s = await tourAt(page, "Escribí lo que buscás");
  eq(await page.evaluate(() => document.activeElement.getAttribute("role")), "combobox", "focus stays in the field");
  assert(await page.isVisible(".cc-tour-try:has-text('Buscar «Sorfon»')"), "a real name to try");
  await page.keyboard.type("Mortis");
  await page.waitForFunction(() => document.querySelector(".cc-tour-try").hidden);
  await tourNext(page);
  s = await tourAt(page, "Resultados al instante");
  assert(/cc-sgroup/.test(s.active.cls), "the real result groups");
  await page.locator(".driver-active-element .cc-hit").first().click();
  await page.waitForFunction(() => location.hash === "#/chronicle/character/mortis");
  s = await tourAt(page, "Explorá el mapa");
  assert(/cc-tab/.test(s.active.cls), "the Map tab");
  await page.click(".driver-active-element");
  await page.waitForFunction(() => location.hash === "#/map");
  s = await tourAt(page, "Los marcadores");
  assert(/cc-marker/.test(s.active.cls), "a real marker");
  eq(await page.evaluate(() => { const a = document.querySelector(".driver-active-element").getBoundingClientRect(), v = document.querySelector(".cc-vp").getBoundingClientRect(); return a.left >= v.left && a.right <= v.right && a.top >= v.top && a.bottom <= v.bottom; }), true, "inside the visible map");
  await page.screenshot({ path: path.join(OUT, "tour-desktop-marker.png") });
  await page.click(".driver-active-element");
  s = await tourAt(page, null, { not: "Los marcadores" });
  assert(["Leé lo que pasó acá", "Varios acontecimientos acá"].includes(s.title), `the marker's card: ${s.title}`);
  eq(await page.locator(".driver-active-element[data-popup]").count(), 1, "the popup is highlighted");
  await tourNext(page);
  s = await tourAt(page, "Personajes y recorridos");
  eq(s.progress, "7 de 7", "Map B");
  await page.click(".driver-active-element");
  s = await tourAt(page, "Las líneas punteadas");
  assert(await page.isVisible(".cc-mappanel"), "the party filter is open");
  await page.screenshot({ path: path.join(OUT, "tour-desktop-routes.png") });
  await tourNext(page);
  s = await tourAt(page, "¡Listo!");
  eq(s.next, "Empezar a explorar", "finish");
  assert(await page.isVisible(".driver-popover .cc-tour-alt:has-text('Ver más tutoriales')"), "more tutorials");
  await tourNext(page);
  await tourGone(page);
  eq((await onboarding(page)).completed, ["main"], "completion remembered");
  eq(await page.evaluate(() => [history.length, history.state]), [len0 + 1, null], "one ordinary history entry for the whole tour");
  eq(await page.getAttribute(".cc-searchbtn", "aria-haspopup"), "dialog", "the app's own aria attributes are back");
  eq(await markerTotal(page), 33, "the map works as before");
  await page.locator(".cc-marker").first().click();
  await page.waitForSelector("[data-popup]");
  await page.goBack();
  await page.waitForFunction(() => location.hash === "#/chronicle");
  eq(await page.locator(".cc-intro").count(), 0, "the introduction steps back once the tour is done");
  assert(await page.isVisible(".cc-sec-sub:has-text('Nuestra historia')"), "…leaving the one-line tagline");
  await ctx.close();
});

await check("tour · leaving early restores the start (route, list scroll, filters, panels) — Esc, ✕, Back; “Omitir” = not now", async () => {
  const { ctx, page } = await open(DESKTOP, "#/chronicle", { keepGuide: true });
  await page.click("button[aria-controls=cc-filters]");
  await page.locator(".cc-pcchip", { hasText: "Mortis" }).click();
  await page.click(".cc-factions .cc-btn:not(.ghost)");
  await page.evaluate(() => { document.querySelector(".cc-main").scrollTop = 700; });
  await page.waitForTimeout(150);
  const state = () => page.evaluate(() => ({ hash: location.hash, top: Math.round(document.querySelector(".cc-main") ? document.querySelector(".cc-main").scrollTop : -1), filters: sessionStorage.getItem("chronicle-filters"), len: history.length, marker: history.state }));
  const before = await state();
  // Esc after the tour moved to the recap (another screen).
  await page.click(".cc-invite .cc-btn");
  await tourAt(page, "Crónica de Exandria"); await tourNext(page);
  await tourAt(page, "Recordá la última sesión"); await tourNext(page);
  await tourAt(page, "Anteriormente en…");
  await page.keyboard.press("Escape");
  await tourGone(page);
  await page.waitForTimeout(200);
  let after = await state();
  // history.length keeps the tour's entry as a "forward" one until the next navigation replaces it.
  eq({ ...after, top: Math.abs(after.top - before.top) <= 2, len: after.len - before.len <= 1 }, { ...before, top: true, len: true }, "Esc: route, scroll, filters and current history entry as before");
  eq((await onboarding(page)).completed, [], "not completed");
  assert(await page.isVisible(".cc-invite"), "the invitation stays (it was not dismissed)");
  // ✕ in the map tutorial after toggling a party member: filters and panel come back.
  await page.evaluate(() => { location.hash = "#/map"; });
  await page.waitForSelector(".cc-mapbar");
  await page.waitForTimeout(400);
  await page.click(".cc-maphelp");
  await tourAt(page, "Los marcadores");
  await tourNextTo(page, "Las líneas punteadas");
  await page.locator(".driver-active-element .cc-partyrow, .cc-partyrow.driver-active-element").first().click();
  assert((await page.evaluate(() => sessionStorage.getItem("chronicle-filters"))) !== before.filters, "the visitor changed a filter during the tour");
  await page.click(".driver-popover .driver-popover-close-btn");
  await tourGone(page);
  await page.waitForTimeout(150);
  eq(await page.evaluate(() => [location.hash, sessionStorage.getItem("chronicle-filters"), !!document.querySelector(".cc-mappanel"), !!document.querySelector("[data-popup]")]), ["#/map", before.filters, false, false], "✕: filters, panel and popups as before");
  // Back (browser / Android gesture) during the main tour started from the help centre.
  await page.evaluate(() => { location.hash = "#/sessions"; });
  await page.waitForSelector(".cc-scard");
  await page.click(".cc-actions button[aria-haspopup=dialog]");
  await page.waitForSelector("[data-dialog=help]");
  await page.locator(".cc-tourrow").first().click();
  await tourAt(page, "Crónica de Exandria"); await tourNext(page);
  await tourAt(page, "Recordá la última sesión");
  eq(await page.evaluate(() => location.hash), "#/chronicle", "the tour moved to the Chronicle");
  await page.goBack();
  await tourGone(page);
  await page.waitForTimeout(150);
  eq(await page.evaluate(() => [location.hash, history.state, document.querySelectorAll("[data-dialog]").length]), ["#/sessions", null, 0], "Back: the tour ends where it started");
  // "Omitir" on the welcome = "not now".
  await page.evaluate(() => { location.hash = "#/chronicle"; });
  await page.waitForSelector(".cc-invite");
  await page.click(".cc-invite .cc-btn");
  await tourAt(page, "Crónica de Exandria");
  await page.click(".driver-popover .cc-tour-alt:has-text('Omitir')");
  await tourGone(page);
  eq(await onboarding(page), { version: "2", completed: [], invite: "dismissed" }, "the invitation is dismissed, the tour not completed");
  eq(await page.locator(".cc-intro").count(), 0, "the introduction steps back");
  await page.reload();
  await page.waitForSelector(".cc-card");
  eq(await page.locator(".cc-intro, .driver-popover").count(), 0, "and stays back after a reload");
  await ctx.close();
});

await check("tour · phone 375: “More” → map, every popover on screen and off its control; touch still works after", async () => {
  const { ctx, page } = await open(PHONE, "#/chronicle", { keepGuide: true });
  const tap = sel => page.locator(sel).first().tap();
  await tap(".cc-invite .cc-btn");
  await tourAt(page, "Crónica de Exandria"); await fits(page, 375, 812, "phone");
  await tap(".driver-popover-next-btn");
  await tourAt(page, "Recordá la última sesión"); await fits(page, 375, 812, "phone");
  await tap(".cc-latest");
  await tourAt(page, "Anteriormente en…"); await fits(page, 375, 812, "phone");
  await tap(".driver-popover-next-btn");
  await tourAt(page, "Explorá la Crónica"); await fits(page, 375, 812, "phone");
  await tap(".driver-active-element");
  await tourAt(page, "Descubrí las conexiones"); await fits(page, 375, 812, "phone");
  await tap(".driver-popover-next-btn");
  await tourAt(page, "Encontrá cualquier cosa"); await fits(page, 375, 812, "phone");
  await tap(".cc-searchbtn");
  await tourAt(page, "Escribí lo que buscás"); await fits(page, 375, 812, "phone");
  await tap(".cc-tour-try");                                                         // "Buscar «Sorfon»"
  await tourAt(page, "Resultados al instante"); await fits(page, 375, 812, "phone");
  eq(await page.evaluate(() => document.activeElement.tagName === "INPUT"), false, "the keyboard is put away to show the results");
  await tap(".driver-popover-next-btn");
  let s = await tourAt(page, "El mapa está en «Más»"); await fits(page, 375, 812, "phone");
  assert(/cc-bn/.test(s.active.cls), "the bottom bar's More");
  await tap(".driver-active-element");
  s = await tourAt(page, "Explorá el mapa"); await fits(page, 375, 812, "phone");
  assert(await page.isVisible(".cc-sheet"), "the More sheet is open");
  await tap(".driver-active-element");
  await page.waitForFunction(() => location.hash === "#/map");
  s = await tourAt(page, "Los marcadores"); await fits(page, 375, 812, "phone");
  await page.screenshot({ path: path.join(OUT, "tour-phone-marker.png") });
  await tap(".driver-active-element");
  s = await tourAt(page, null, { not: "Los marcadores" }); await fits(page, 375, 812, "phone");
  await tap(".driver-popover-next-btn");
  await tourAt(page, "Personajes y recorridos"); await fits(page, 375, 812, "phone");
  await tap(".driver-active-element");
  await tourAt(page, "Las líneas punteadas"); await fits(page, 375, 812, "phone");
  await page.screenshot({ path: path.join(OUT, "tour-phone-routes.png") });
  await tap(".driver-popover-next-btn");
  await tourAt(page, "¡Listo!"); await fits(page, 375, 812, "phone");
  await tap(".driver-popover-next-btn");
  await tourGone(page);
  eq((await onboarding(page)).completed, ["main"], "completed on the phone");
  await page.locator(".cc-marker").first().tap();
  await page.waitForSelector("[data-popup]");
  eq(await page.evaluate(() => document.documentElement.scrollWidth), 375, "no sideways scroll");
  await ctx.close();
});

// Next all the way (the tour does each action itself) at every width.
for (const [w, h] of [[320, 640], [360, 740], [390, 844], [430, 932], [768, 1024], [1280, 820]]) {
  await check(`tour · ${w}px: every step of the main tour fits, keeps its control usable, and “Next” carries on across screens`, async () => {
    const phone = w < 720;
    const { ctx, page } = await open({ viewport: { width: w, height: h }, hasTouch: phone, isMobile: phone }, "#/chronicle", { keepGuide: true });
    await page.click(".cc-invite .cc-btn");
    let s = await tourAt(page);
    const titles = [];
    for (let i = 0; i < 20; i++) {
      titles.push(s.title);
      await fits(page, w, h, `${w}px`);
      if (w === 320 || w === 1280) await page.screenshot({ path: path.join(OUT, `tour-${w}-${String(i + 1).padStart(2, "0")}.png`) });
      if (s.title === "¡Listo!") break;
      s = await tourStepNext(page);
    }
    const expected = ["Crónica de Exandria", "Recordá la última sesión", "Anteriormente en…", "Explorá la Crónica", "Descubrí las conexiones",
      "Encontrá cualquier cosa", "Escribí lo que buscás", "Resultados al instante", ...(phone ? ["El mapa está en «Más»"] : []), "Explorá el mapa",
      "Los marcadores", "", "Personajes y recorridos", "Las líneas punteadas", "¡Listo!"];
    eq(titles.map((t, i) => expected[i] === "" ? "" : t), expected, "the steps, in order");
    await tourNext(page);
    await tourGone(page);
    eq((await onboarding(page)).completed, ["main"], "completed");
    await ctx.close();
  });
}

await check("tour · keyboard and screen readers: labelled dialog, focus in it, → ← Tab, Esc gives focus back; reduced motion", async () => {
  const { ctx, page } = await open({ ...DESKTOP, reducedMotion: "reduce" }, "#/chronicle", { keepGuide: true });
  await page.focus(".cc-actions button[aria-haspopup=dialog]");
  await page.keyboard.press("Enter");
  await page.waitForSelector("[data-dialog=help]");
  await page.locator(".cc-tourrow").first().focus();
  await page.keyboard.press("Enter");
  await tourAt(page, "Crónica de Exandria");
  const a11y = await page.evaluate(() => { const p = document.querySelector(".driver-popover"); return { role: p.getAttribute("role"), name: document.getElementById(p.getAttribute("aria-labelledby")).textContent, desc: !!document.getElementById(p.getAttribute("aria-describedby")), close: p.querySelector(".driver-popover-close-btn").getAttribute("aria-label"), focus: document.activeElement.textContent.trim(), lang: p.getAttribute("lang"), progress: p.querySelector(".driver-popover-progress-text").getAttribute("aria-label"), motion: document.body.className }; });
  eq(a11y, { role: "dialog", name: "Crónica de Exandria", desc: true, close: "Cerrar el recorrido", focus: "Comenzar", lang: "es-AR", progress: "Paso 1 de 7", motion: a11y.motion }, "labelled dialog, focus on its main button");
  assert(/driver-simple/.test(a11y.motion) && !/driver-fade/.test(a11y.motion), "no animation with reduced motion");
  await page.keyboard.press("ArrowRight");
  await tourAt(page, "Recordá la última sesión");
  await page.keyboard.press("ArrowLeft");
  await tourAt(page, "Crónica de Exandria");
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press("Tab");
    eq(await page.evaluate(() => !!document.activeElement.closest(".driver-popover")), true, `Tab ${i + 1} stays in the tour`);
  }
  await page.keyboard.press("Escape");
  await tourGone(page);
  await page.waitForTimeout(150);
  eq(await page.evaluate(() => document.activeElement.getAttribute("aria-label")), "Ayuda: cómo funciona la Crónica", "focus back where the tour was started from");
  await ctx.close();
});

await check("tour · language: started in English it speaks English; switching language re-reads the step", async () => {
  const ctx = await browser.newContext(DESKTOP);
  await ctx.addInitScript(() => { try { localStorage.setItem("chronicle-lang", "en"); } catch (e) {} });
  const page = await ctx.newPage();
  page.on("pageerror", e => errors.push(`tour lang: ${e.message}`));
  await page.goto(BASE + "#/chronicle");
  await page.waitForSelector(".cc-invite");
  assert(await page.isVisible(".cc-invite:has-text('First time here?')"), "English invitation");
  await page.click(".cc-invite .cc-btn");
  let s = await tourAt(page, "Exandria Chronicle");
  eq([s.progress, s.next], ["1 of 7", "Start"], "English welcome");
  await tourNext(page);
  await tourAt(page, "Catch up on the last session");
  // The switch sits under the tour's dimmed layer; any language change re-reads the open step.
  await page.evaluate(() => document.querySelector(".cc-lang button[lang='es-AR']").click());
  s = await tourAt(page, "Recordá la última sesión");
  eq([s.progress, s.next], ["2 de 7", "Siguiente"], "the same step, now in Spanish");
  await page.keyboard.press("Escape");
  await tourGone(page);
  await ctx.close();
});

await check("tour · map tutorial from the map's “¿Cómo funciona?”: waits for the lazy map, real marker, party lines, zoom; the map works after", async () => {
  const { ctx, page } = await open(DESKTOP, "#/map");
  await page.waitForSelector(".cc-maphelp");
  await page.click(".cc-maphelp");
  let s = await tourAt(page, "Los marcadores");
  eq(s.progress, "1 de 3", "three ideas");
  assert(/cc-marker/.test(s.active.cls), "a real marker");
  eq(await page.locator(".cc-maphelp").count(), 0, "no second tour button during the tour");
  const titles = [s.title];
  while (s.title !== "Ya sabés usar el mapa" && titles.length < 10) { s = await tourStepNext(page); titles.push(s.title); await fits(page, 1280, 820, "map tour"); }
  ["Las líneas punteadas", "Moverse por el mapa", "Ya sabés usar el mapa"].forEach(t => assert(titles.includes(t), `${t} in ${titles}`));
  eq(s.next, "Explorar el mapa", "finish label");
  await tourNext(page);
  await tourGone(page);
  assert((await onboarding(page)).completed.includes("map"), "remembered");
  const z0 = await page.textContent(".cc-zlabel");
  await page.mouse.move(640, 430); await page.mouse.wheel(0, -400);
  await page.waitForTimeout(200);
  assert((await page.textContent(".cc-zlabel")) !== z0, "wheel zoom still works");
  await page.click(".cc-zoom .cc-zbtn.solo");
  await page.waitForTimeout(150);
  eq(await markerTotal(page), 33, "every marker still there");
  assert(await page.isVisible(".cc-maphelp"), "the map's help is back");
  await ctx.close();
});

await check("tour · search tutorial: open, try a real name, results, open one, its connections", async () => {
  const { ctx, page } = await open(DESKTOP, "#/quests");
  await page.click(".cc-actions button[aria-haspopup=dialog]");
  await page.locator(".cc-tourrow").nth(2).click();
  let s = await tourAt(page, "Encontrá cualquier cosa");
  eq(s.progress, "1 de 2", "two ideas");
  await page.click(".cc-searchbtn");
  await tourAt(page, "Escribí lo que buscás");
  await page.click(".cc-tour-try");
  s = await tourAt(page, "Resultados al instante");
  eq(await page.inputValue(".cc-spanel input"), "Sorfon", "a real party member");
  await page.locator(".driver-active-element .cc-hit").first().click();
  await page.waitForFunction(() => location.hash === "#/quests/character/sorfon");
  s = await tourAt(page, "Todo está conectado");
  assert(/cc-actrow/.test(s.active.cls), "“Ver en la Crónica”");
  await tourNext(page);
  s = await tourAt(page, "Ya sabés buscar");
  await tourNext(page);
  await tourGone(page);
  eq(await page.evaluate(() => location.hash), "#/quests/character/sorfon", "it ends where the visitor got to");
  assert((await onboarding(page)).completed.includes("search"), "remembered");
  await ctx.close();
});

await check("help · centre: three tours with “Hecho”, answers that fold, every section explained; glossary tab; phone 320 from More", async () => {
  const ctx = await browser.newContext({ viewport: { width: 320, height: 640 }, hasTouch: true, isMobile: true });
  await ctx.addInitScript(() => { try { localStorage.setItem("chronicle-tour-version", "2"); localStorage.setItem("chronicle-tour-completed", "[\"main\"]"); } catch (e) {} });
  const page = await ctx.newPage();
  page.on("pageerror", e => errors.push(`help: ${e.message}`));
  await page.goto(BASE + "#/chronicle");
  await page.waitForSelector(".cc-card");
  eq(await page.locator(".cc-intro").count(), 0, "no introduction after the main tour");
  await page.locator("button.cc-bn").tap();
  await page.locator(".cc-sheet-item", { hasText: "Ayuda" }).tap();
  await page.waitForSelector("[data-dialog=help]");
  eq(await page.locator(".cc-tourrow").count(), 3, "three tours");
  eq(await page.locator(".cc-tourrow").first().locator(".cc-badge").textContent(), "Hecho", "the main tour is marked done");
  eq(await page.locator(".cc-faq-i").count(), 7, "sections + six answers");
  eq(await page.locator(".cc-faq-i[open]").count(), 0, "all folded");
  await page.locator(".cc-faq-i summary").first().tap();
  eq(await page.locator(".cc-sec").count(), 6, "every section in one line");
  await page.locator(".cc-faq-i summary", { hasText: "líneas punteadas" }).tap();
  assert(await page.isVisible(".cc-faq-a:has-text('viajes registrados')"), "a short answer");
  eq(await page.$eval(".cc-help", el => [el.scrollWidth <= el.clientWidth, document.documentElement.scrollWidth]), [true, 320], "no sideways scroll");
  await page.screenshot({ path: path.join(OUT, "help-320.png") });
  await page.locator(".cc-help-tabs button").last().tap();
  eq(await page.locator(".cc-gl-row").count(), 13, "13 event types");
  eq(await page.locator(".cc-gl-badges .cc-badge").count(), 4, "4 quest statuses");
  assert((await page.locator(".cc-gl-mrow").count()) >= 11, "map marks + other marks");
  const famColours = await page.$$eval(".cc-gl-famh", els => els.map(e => getComputedStyle(e).color));
  eq(new Set(famColours).size, famColours.length, "each family its own colour");
  await page.goBack();
  await page.waitForTimeout(200);
  eq(await page.locator("[data-dialog]").count(), 0, "Back closes the help");
  await page.locator("button.cc-bn").tap();
  await page.locator(".cc-sheet-item", { hasText: "Íconos y colores" }).tap();
  await page.waitForSelector(".cc-gl-row");
  await ctx.close();
});

await check("tour · a direct link to an entry is never interrupted (first visit, phone and desktop)", async () => {
  for (const opts of [PHONE, DESKTOP]) {
    // A fresh visitor (nothing stored) arriving straight on an entry; wait for the entry itself.
    const ctx = await browser.newContext(opts), page = await ctx.newPage();
    page.on("pageerror", e => errors.push(`deep link: ${e.message}`));
    await page.goto(BASE + "#/chronicle/event/s12_03");
    await page.waitForSelector(".cc-doc-h", { timeout: 15000 });
    await page.waitForTimeout(400);
    eq(await page.locator("[data-dialog], .driver-popover").count(), 0, "no dialog, no tour");
    eq(await page.textContent(".cc-doc-h"), "Mortis muere para llegar a la Reina Cuervo", "the entry is there");
    if (opts === PHONE) eq(await page.locator(".cc-intro").isVisible().catch(() => false), false, "no introduction over the entry on a phone");
    await ctx.close();
  }
});

// ── Universal search ────────────────────────────────────────────────────────
await check("search · Ctrl+K from anywhere; grouped results (name first); keyboard to a result; Back has no dead step", async () => {
  const { ctx, page } = await open(DESKTOP, "#/chronicle");
  await page.focus(".cc-searchbtn");
  await page.keyboard.press("Control+K");
  await page.waitForSelector("[data-dialog=search]");
  eq(await page.evaluate(() => document.activeElement.getAttribute("role")), "combobox", "the field takes the focus");
  await page.keyboard.type("Mortis");
  await page.waitForTimeout(100);
  const groups = await page.$$eval(".cc-sgh", els => els.map(e => e.textContent.replace(/\d+\s*$/, "").trim()));
  eq(groups.slice(0, 2), ["Personajes", "Acontecimientos"], "groups, best first");
  assert(groups.includes("Misiones") && groups.includes("Sesiones"), `linked quests and sessions: ${groups}`);
  eq((await page.textContent(".cc-hit.is-active .cc-hit-t")).trim(), "Mortis", "first result active");
  eq(await page.locator(".cc-hit.is-active mark").count(), 1, "the match is highlighted");
  await page.keyboard.press("ArrowDown");
  eq(await page.getAttribute(".cc-spanel input", "aria-activedescendant"), "cc-opt-1", "aria-activedescendant follows");
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => location.hash === "#/chronicle/event/s12_03");
  eq(await page.locator("[data-dialog]").count(), 0, "search closed");
  eq(await page.evaluate(() => document.activeElement.className), "cc-doc-h", "focus on the opened entry");
  await page.goBack();
  await page.waitForFunction(() => location.hash === "#/chronicle");
  eq(await page.locator("[data-dialog]").count(), 0, "one Back returns to the Chronicle");
  // Escape closes and gives the focus back.
  await page.focus(".cc-searchbtn");
  await page.keyboard.press("Control+K");
  eq(await page.inputValue(".cc-spanel input"), "Mortis", "the last search is kept");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(100);
  eq(await page.locator("[data-dialog]").count(), 0, "Esc closes");
  eq(await page.evaluate(() => document.activeElement.classList.contains("cc-searchbtn")), true, "focus returns to the button");
  eq(new URL(page.url()).hash, "#/chronicle", "closing never navigates");
  await ctx.close();
});

await check("search · bilingual, no accents needed, empty state, from Quests and the Map; Chronicle filter untouched", async () => {
  const { ctx, page } = await open(DESKTOP, "#/quests");
  const evCount = async q => { await page.fill(".cc-spanel input", q); await page.waitForTimeout(120); return page.$$eval(".cc-sgh", els => els.map(e => e.textContent.replace(/\s+/g, " ").trim())); };
  await page.click(".cc-searchbtn");
  const a = await evCount("revelacion"), b = await evCount("revelación");
  eq(a, b, "accents optional");
  assert(a.some(g => /Acontecimientos 2/.test(g)), `revelación finds the two revelations: ${a}`);
  await evCount("raven queen");
  assert((await page.locator(".cc-hit-t", { hasText: "La Reina Cuervo" }).count()) > 0, "English query, Spanish entry");
  await evCount("zzqqxx");
  assert(await page.isVisible(".cc-snone"), "no-results message");
  eq((await page.textContent(".cc-snone .cc-strong")).trim(), "Nada en la crónica coincide con «zzqqxx».", "message text");
  await page.fill(".cc-spanel input", "");
  assert(await page.isVisible(".cc-sintro"), "empty state explains what to search");
  await evCount("Vasselheim");
  await page.click(".cc-hit:has-text('Vasselheim') >> nth=0");
  await page.waitForFunction(() => location.hash === "#/quests/place/vasselheim");
  eq(await page.textContent(".cc-doc-h"), "Vasselheim", "opened in the current section");
  await page.evaluate(() => { location.hash = "#/map"; });
  await page.waitForSelector(".cc-mapwrap");
  assert(await page.isVisible(".cc-searchbtn"), "available on the map");
  await page.click(".cc-searchbtn");
  await evCount("pelor");
  await page.click(".cc-hit-more:has-text('Ver los')");                        // "See all in the Chronicle"
  await page.waitForFunction(() => location.hash === "#/chronicle");
  eq(await page.inputValue(".cc-toolbar input[type=search]"), "pelor", "the Chronicle filter takes the search");
  assert(/de 33/.test(await page.textContent(".cc-results-t")), "Chronicle filtered");
  await ctx.close();
});

await check("search · phone: full screen, typing right away, readable 44px rows, tap a result, Back closes without leaving", async () => {
  const { ctx, page } = await open(PHONE, "#/sessions");
  await page.locator(".cc-searchbtn").tap();
  await page.waitForSelector("[data-dialog=search]");
  const box = await page.locator(".cc-spanel").boundingBox();
  eq([box.x, box.y, box.width, box.height], [0, 0, 375, 812], "the whole screen");
  eq(await page.evaluate(() => document.activeElement.getAttribute("role")), "combobox", "field focused");
  await page.keyboard.type("vass");
  await page.waitForTimeout(100);
  const rows = await page.$$eval(".cc-hit", els => els.map(e => { const r = e.getBoundingClientRect(); return [r.height, r.left, r.right, parseFloat(getComputedStyle(e.querySelector(".cc-hit-t")).fontSize)]; }));
  assert(rows.length > 5 && rows.every(([h, l, r, f]) => h >= 44 && l >= 0 && r <= 375 && f >= 16), `rows ${JSON.stringify(rows.slice(0, 3))}`);
  const first = await page.locator(".cc-hit").first().boundingBox();
  assert(first.y < 200, "results start right under the field (above a virtual keyboard)");
  await page.locator(".cc-hit").first().tap();
  await page.waitForFunction(() => location.hash === "#/sessions/place/vasselheim");
  await page.locator(".cc-back").first().tap();
  await page.waitForFunction(() => location.hash === "#/sessions");
  await page.locator(".cc-searchbtn").tap();
  await page.goBack();                                                        // Android's back gesture
  await page.waitForTimeout(300);
  eq(await page.locator("[data-dialog]").count(), 0, "Back closed the search");
  eq(new URL(page.url()).hash, "#/sessions", "and stayed on the page");
  await page.locator(".cc-searchbtn").tap();
  await page.locator(".cc-sback").tap();
  eq(await page.locator("[data-dialog]").count(), 0, "the back arrow closes it");
  await ctx.close();
});

// ── Previously on… ──────────────────────────────────────────────────────────
await check("recap · from the Chronicle: the latest session (12, by number), real events only, link to the full log; EN", async () => {
  const { ctx, page } = await open(DESKTOP, "#/chronicle");
  eq((await page.textContent("a.cc-latest .cc-qa-t")).trim(), "Ponete al día", "quick action");
  eq((await page.textContent("a.cc-latest .cc-qa-s")).trim(), "Anteriormente en… · Sesión 12", "entry label");
  await page.click("a.cc-latest");
  await page.waitForFunction(() => location.hash === "#/chronicle/recap/12");
  eq(await page.textContent(".cc-doc-h"), "Anteriormente en Bund Der Vier…", "heading");
  assert((await page.textContent(".cc-byline")).includes("Sesión 12"), "session 12");
  eq(await page.locator(".cc-doc .cc-evrow").count(), 7, "session 12's seven recorded events");
  assert(await page.isVisible("text=Lo que quedó registrado"), "neutral heading (no editor-chosen highlights)");
  assert(await page.isVisible(".cc-where"), "where the party was left");
  eq(await page.locator(".cc-doc .cc-plot").count(), 3, "the three threads still open");
  await page.click(".cc-lang button:has-text('EN')");
  eq(await page.textContent(".cc-doc-h"), "Previously on Bund Der Vier…", "English");
  await page.click(".cc-doc .cc-btn:has-text('Read the full session')");
  await page.waitForFunction(() => location.hash === "#/chronicle/session/12");
  await ctx.close();
});

await check("recap · Sessions keeps oldest first and offers the same recap; phone 320px reads it without sideways scroll", async () => {
  const { ctx, page } = await open({ viewport: { width: 320, height: 640 }, hasTouch: true, isMobile: true }, "#/sessions");
  const nos = await page.$$eval(".cc-scard-no", els => els.map(e => +e.textContent));
  eq(nos, nos.slice().sort((a, b) => a - b), "Sessions oldest first");
  eq(await page.getAttribute("a.cc-latest", "href"), "#/sessions/recap/12", "recap of session 12");
  await page.locator("a.cc-latest").tap();
  await page.waitForSelector(".cc-where");
  eq(await page.evaluate(() => [document.documentElement.scrollWidth, document.querySelector(".cc-detail").scrollWidth]), [320, 320], "no horizontal scroll");
  await page.screenshot({ path: path.join(OUT, "recap-320.png"), fullPage: false });
  await ctx.close();
});

// ── Favourites + recently viewed ────────────────────────────────────────────
await check("saved · star an event and a character; listed newest first; history after a moment; kept after reload; remove; clear", async () => {
  const { ctx, page } = await open(DESKTOP, "#/chronicle/event/s12_03");
  await page.waitForSelector(".cc-favbtn");
  eq(await page.getAttribute(".cc-favbtn", "aria-pressed"), "false", "not a favourite yet");
  await page.click(".cc-favbtn");
  eq(await page.getAttribute(".cc-favbtn", "aria-pressed"), "true", "now a favourite");
  eq(await page.getAttribute(".cc-favbtn", "aria-label"), "Quitar de favoritos", "label says what a tap does");
  await page.waitForTimeout(1400);                                              // counts as viewed
  await page.evaluate(() => { location.hash = "#/chronicle/character/mortis"; });
  await page.waitForFunction(() => document.querySelector(".cc-doc-h").textContent === "Mortis");
  await page.click(".cc-favbtn");
  await page.waitForTimeout(1400);
  await page.click(".cc-actions a[href='#/saved']");
  await page.waitForFunction(() => location.hash === "#/saved");
  const favs = () => page.locator(".cc-page .cc-savedrow .cc-favbtn").count();
  const list = i => page.$$eval(".cc-page .cc-hits", (h, i) => [...h[i].querySelectorAll(".cc-hit-t")].map(e => e.textContent.trim()), i);
  eq(await list(0), ["Mortis", "Mortis muere para llegar a la Reina Cuervo"], "favourites, newest first");
  eq(await list(1), ["Mortis", "Mortis muere para llegar a la Reina Cuervo"], "recently viewed, newest first");
  await page.reload();
  await page.waitForSelector(".cc-savedrow");
  eq(await favs(), 2, "kept after reload");
  await page.locator(".cc-savedrow .cc-favbtn").first().click();
  eq(await favs(), 1, "removed from the list");
  await page.click(".cc-page .cc-h2 .cc-linkbtn");                             // "Borrar historial"
  assert(await page.isVisible("text=Las fichas que abras van a aparecer acá."), "history cleared");
  await page.click(".cc-hit");
  await page.waitForFunction(() => location.hash === "#/saved/event/s12_03");
  eq(await page.textContent(".cc-doc-h"), "Mortis muere para llegar a la Reina Cuervo", "a favourite opens beside the list");
  // The search panel offers the history before anything is typed.
  await page.waitForTimeout(1400);
  await page.keyboard.press("Control+K");
  eq((await page.textContent(".cc-sgh")).replace(/\s+/g, " ").trim(), "Consultados recientemente", "history in the empty search");
  await ctx.close();
});

await check("saved · stale references are dropped; storage blocked → still works for the visit, with a note", async () => {
  const ctx = await browser.newContext(DESKTOP);
  await ctx.addInitScript(() => { try { if (!sessionStorage.getItem("seeded")) { sessionStorage.setItem("seeded", "1"); localStorage.setItem("chronicle-tour-version", "2"); localStorage.setItem("chronicle-tour-invite", "dismissed");
    localStorage.setItem("chronicle-favorites", JSON.stringify({ v: 1, items: [{ kind: "character", id: "baxcazhak", at: 1 }, { kind: "event", id: "s1_01", at: 2 }, { kind: "potion", id: "x" }] })); } } catch (e) {} });
  const page = await ctx.newPage();
  page.on("pageerror", e => errors.push(`saved: ${e.message}`));
  await page.goto(BASE + "#/saved");
  await page.waitForSelector(".cc-savedrow");
  eq(await page.locator(".cc-savedrow").count(), 1, "only the entry that exists");
  eq(await page.evaluate(() => JSON.parse(localStorage.getItem("chronicle-favorites")).items.map(r => r.id)), ["s1_01"], "storage cleaned");
  await ctx.close();
  const blocked = await browser.newContext(DESKTOP);
  await blocked.addInitScript(() => { Object.defineProperty(window, "localStorage", { configurable: true, get() { throw new DOMException("blocked", "SecurityError"); } }); });
  const p2 = await blocked.newPage();
  p2.on("pageerror", e => errors.push(`blocked storage: ${e.message}`));
  await p2.goto(BASE + "#/chronicle/event/s12_03");
  await p2.waitForSelector(".cc-favbtn");
  await p2.click(".cc-favbtn");
  eq(await p2.getAttribute(".cc-favbtn", "aria-pressed"), "true", "the star still works");
  await p2.evaluate(() => { location.hash = "#/saved"; });
  await p2.waitForSelector(".cc-savedrow");
  assert(await p2.isVisible(".cc-page .cc-lore-warn"), "a note says nothing will be kept");
  await blocked.close();
});

// ── Installable + offline ───────────────────────────────────────────────────
await check("pwa · installable; after one visit it opens offline (favourites kept); new content shows when back online", async () => {
  const srv = await startServer();
  const ctx = await browser.newContext(DESKTOP);
  await ctx.addInitScript(() => { try { localStorage.setItem("chronicle-tour-version", "2"); localStorage.setItem("chronicle-tour-invite", "dismissed"); localStorage.setItem("chronicle-lang", "en"); } catch (e) {} });
  const page = await ctx.newPage();
  page.on("pageerror", e => errors.push(`pwa: ${e.message}`));
  await page.goto(srv.base + "#/chronicle/event/s12_03");
  await page.waitForSelector(".cc-favbtn");
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 15000 });
  const cdp = await ctx.newCDPSession(page);
  const inst = await cdp.send("Page.getInstallabilityErrors");
  // Test contexts are off-the-record profiles, which Chromium never offers to install ("in-incognito"); anything else is a real problem.
  eq(inst.installabilityErrors.map(e => e.errorId).filter(id => id !== "in-incognito"), [], "no installability errors");
  const manifest = await cdp.send("Page.getAppManifest");
  assert(!manifest.errors.length && /Crónica/.test(manifest.data), "manifest parsed");
  await page.click(".cc-favbtn");                                               // a favourite before going offline
  // Offline: the server is gone.
  await srv.close();
  await page.reload();
  await page.waitForSelector(".cc-doc-h", { timeout: 15000 });
  eq(await page.textContent(".cc-doc-h"), "Mortis Dies to Reach the Raven Queen", "the entry opens offline");
  assert(await page.isVisible(".cc-offline"), "an offline note");
  eq(await page.getAttribute(".cc-favbtn", "aria-pressed"), "true", "favourite kept");
  await page.evaluate(() => { location.hash = "#/sessions"; });
  await page.waitForSelector(".cc-scard");
  eq(await page.locator(".cc-scard").count(), 6, "the sessions list offline");
  const stored = await page.evaluate(async () => { const out = []; for (const n of await caches.keys()) for (const r of await (await caches.open(n)).keys()) out.push(r.url); return out; });
  assert(!stored.some(u => /exandria-map\.jpeg$/.test(u)), "the full-resolution map is not stored");
  assert(stored.some(u => /data\/sessions\.json$/.test(u)) && stored.some(u => /react\.production\.min\.js$/.test(u)), "data and React are");
  // New content is published; back online it shows on the next load (and becomes the new offline copy).
  const title12 = "Freshly Published Title";
  const again = await startServer({ port: srv.port, rewrite: (rel, text) => (rel === "data/sessions.json" ? JSON.stringify({ ...JSON.parse(text), 12: { ...JSON.parse(text)[12], title: title12 } }) : text) });
  await page.reload();
  await page.waitForSelector(".cc-scard");
  assert((await page.textContent(".cc-page")).includes("Freshly Published Title"), "new session title online");
  eq(await page.locator(".cc-offline").count(), 0, "no offline note when online");
  await again.close();
  await page.reload();
  await page.waitForSelector(".cc-scard", { timeout: 15000 });
  assert((await page.textContent(".cc-page")).includes("Freshly Published Title"), "the offline copy was refreshed");
  eq(await page.evaluate(() => JSON.parse(localStorage.getItem("chronicle-favorites")).items.length), 1, "favourites untouched by updates");
  await page.screenshot({ path: path.join(OUT, "offline-sessions.png") });
  await ctx.close();
});

await check("no console errors or page errors", async () => { eq(errors, [], "errors"); });

await browser.close();
server.close();
const failed = results.filter(r => r[0] === "FAIL");
console.log(`\n${results.length - failed.length}/${results.length} browser checks passed · screenshots in test-results/`);
process.exit(failed.length ? 1 : 0);
