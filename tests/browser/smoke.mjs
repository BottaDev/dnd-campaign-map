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
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript", ".json": "application/json; charset=utf-8", ".jpeg": "image/jpeg", ".jpg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".css": "text/css", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json" };

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
  if (!keepGuide) await ctx.addInitScript(() => { try { localStorage.setItem("chronicle-tour-version", "3"); localStorage.setItem("chronicle-tour-invite", "dismissed"); } catch (e) {} });
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
  assert(await page.isVisible(".cc-welcome:has-text('Descubrí las aventuras de Bund Der Vier')"), "the first-visit welcome is in Spanish");
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
  eq(await routeInks(page), ["#5a1f24|2 7"], "one shared journey line (not four, not chronological), dotted in sealing wax");
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

// ── Places: the atlas index ─────────────────────────────────────────────────
const placeRows = page => page.$$eval(".cc-app .cc-node-row", rows => rows.filter(r => r.getClientRects().length).map(r => r.dataset.place));
const placeFind = ".cc-atlas input[type=search]";

await check("places · main places and their first level in view; a caret folds without opening (mouse, Enter, Space); expand / collapse all", async () => {
  const { ctx, page } = await open(DESKTOP, "#/places");
  const rows = await placeRows(page);
  eq(rows.slice(0, 5), ["taldorei", "emon", "kraghammer", "ozmit-sea", "vasselheim"], "story order, first level shown");
  assert(!rows.includes("academic-district") && !rows.includes("chapel-of-pelor"), "deeper places folded");
  eq(await page.$$eval(".cc-atlas-grp .cc-h2", hs => hs.map(h => h.textContent.replace(/\s+/g, " ").trim())), ["Atlas de Exandria 25", "Otros planos 3"], "the Atlas and the other planes apart");
  const caret = page.locator('[data-place="emon"] .cc-twisty');
  eq([await caret.getAttribute("aria-expanded"), await caret.getAttribute("aria-controls"), await caret.getAttribute("aria-label")], ["false", "cc-pt-emon", "2 lugares dentro de Emon"], "caret state and name");
  assert((await page.textContent('[data-place="emon"] .cc-node-k')).includes("2 lugares"), "a folded branch says what it holds");
  await caret.click();
  eq(await caret.getAttribute("aria-expanded"), "true", "unfolded");
  assert((await placeRows(page)).includes("academic-district"), "its places shown");
  eq(new URL(page.url()).hash, "#/places", "folding never opens the place");
  await caret.focus();
  await page.keyboard.press("Enter");
  eq(await caret.getAttribute("aria-expanded"), "false", "Enter folds");
  await page.keyboard.press(" ");
  eq(await caret.getAttribute("aria-expanded"), "true", "Space unfolds");
  eq(await caret.evaluate(el => getComputedStyle(el).outlineStyle), "solid", "visible focus");
  await page.click(".cc-atlas-tools button:has-text('Expandir todo')");
  eq((await placeRows(page)).length, 28, "every place");
  assert(await page.locator(".cc-atlas-tools button:has-text('Expandir todo')").isDisabled(), "nothing left to expand");
  await page.screenshot({ path: path.join(OUT, "places-1280-all.png"), fullPage: false });
  await page.click(".cc-atlas-tools button:has-text('Contraer todo')");
  eq((await placeRows(page)).length, 10, "the top level only");
  assert(await page.locator(".cc-atlas-tools button:has-text('Contraer todo')").isDisabled(), "nothing left to collapse");
  await ctx.close();
});

await check("places · opening a place: not unfolded, marked, its ancestors revealed; breadcrumbs go up; its places one tap away", async () => {
  const { ctx, page } = await open(DESKTOP, "#/places/place/chapel-of-pelor");
  await page.waitForSelector(".cc-crumbs");
  eq(await page.locator('[data-place="high-pass"] .cc-twisty').getAttribute("aria-expanded"), "true", "a deep link unfolds the ancestors");
  const row = page.locator('[data-place="chapel-of-pelor"]');
  assert(await row.isVisible(), "the open place is in view");
  eq(await row.locator(".cc-node-a").getAttribute("aria-current"), "true", "marked as current");
  assert(await row.evaluate(r => r.classList.contains("is-sel")), "raised, with the ribbon");
  eq(await page.$$eval(".cc-crumbs li", ls => ls.map(l => l.textContent.trim())), ["Vasselheim", "High Pass, Vasselheim", "Capilla de Pelor, High Pass"], "the recorded path, the place last");
  eq(await page.getAttribute(".cc-crumb.is-here", "aria-current"), "location", "the last step is where we are");
  await page.click(".cc-crumbs a:has-text('Vasselheim')");
  await page.waitForFunction(() => location.hash === "#/places/place/vasselheim");
  eq(await page.textContent(".cc-doc-h"), "Vasselheim", "one level up");
  eq(await page.locator(".cc-crumbs").count(), 0, "a top-level place has no invented path");
  eq(await page.locator('[data-place="vasselheim"] .cc-twisty').getAttribute("aria-expanded"), "true", "selecting does not fold it either");
  await page.locator('[data-place="high-pass"] .cc-twisty').click();                        // fold it, then open it from the page
  await page.click(".cc-doc .cc-chip.is-place:has-text('High Pass')");
  await page.waitForFunction(() => location.hash === "#/places/place/high-pass");
  eq(await page.locator('[data-place="high-pass"] .cc-twisty').getAttribute("aria-expanded"), "false", "opening a branch never unfolds it");
  eq((await page.textContent(".cc-doc .cc-h2:has-text('Dentro')")).replace(/\s+/g, " ").trim(), "Dentro 2", "what it holds, counted");
  await page.screenshot({ path: path.join(OUT, "places-1280-open.png") });
  await ctx.close();
});

await check("places · search: nested places with their context, highlighted; kinds and English; none → the whole chronicle; clearing restores the tree", async () => {
  const { ctx, page } = await open(DESKTOP, "#/places");
  await page.locator('[data-place="vasselheim"] .cc-twisty').click();                       // the visitor's own folding
  const before = await placeRows(page);
  await page.fill(placeFind, "gilmore");
  await page.waitForTimeout(120);
  eq(await placeRows(page), ["taldorei", "emon", "academic-district", "gilmores-shop"], "the shop and where it lies");
  eq(await page.$$eval(".cc-node-row.is-ctx", rs => rs.map(r => r.dataset.place)), ["taldorei", "emon", "academic-district"], "ancestors as context");
  eq(await page.$$eval(".cc-node-n mark", ms => ms.map(m => m.textContent)), ["Gilmore"], "highlighted");
  eq((await page.textContent("#cc-atlas-status")).trim(), "1 de 28 lugares coincide", "count, announced");
  eq(await page.locator(".cc-atlas .cc-twisty:not(.none)").count(), 0, "no carets while filtering");
  await page.fill(placeFind, "DISTRICT");
  await page.waitForTimeout(120);
  eq(await page.$$eval(".cc-node-row:not(.is-ctx)", rs => rs.map(r => r.dataset.place)), ["academic-district", "high-pass", "main-avenue", "war-district"], "a kind, in English, in capitals");
  await page.fill(placeFind, "xyzzy");
  await page.waitForTimeout(120);
  assert((await page.textContent(".cc-atlas .cc-empty")).includes("Ningún lugar coincide con «xyzzy»."), "no-results message");
  await page.click(".cc-atlas .cc-empty button:has-text('Buscar en toda la crónica')");
  await page.waitForSelector("[data-dialog=search]");
  eq(await page.inputValue(".cc-spanel input"), "xyzzy", "the universal search takes the words");
  await page.keyboard.press("Escape");
  await page.click(".cc-atlas .cc-search-x");
  await page.waitForTimeout(120);
  eq(await placeRows(page), before, "the folding comes back as it was");
  eq(await page.evaluate(() => document.activeElement.getAttribute("type")), "search", "focus back in the field");
  await ctx.close();
});

await check("places · the map: a row's map action, the page's preview (never for other planes, a note when no event has a position)", async () => {
  const { ctx, page } = await open(DESKTOP, "#/places/place/gilmores-shop");
  await page.waitForSelector(".cc-placemap");
  eq(await page.getAttribute(".cc-placemap .cc-minimap", "href"), "#/map/place/gilmores-shop", "the preview opens the map");
  assert((await page.textContent(".cc-placemap .cc-mini-cap")).includes("El encuentro en lo de Gilmore"), "says which event places it");
  eq(await page.getAttribute('[data-place="vasselheim"] .cc-node-map', "href"), "#/map/place/vasselheim", "row action (wide: map + its page)");
  eq(await page.locator('[data-place="whitestone"] a.cc-node-map').count(), 0, "no map action without a position");
  await page.click('[data-place="vasselheim"] .cc-node-map');
  await page.waitForFunction(() => location.hash === "#/map/place/vasselheim");
  await page.waitForSelector(".cc-mapwrap");
  eq(await page.textContent(".cc-doc-h"), "Vasselheim", "the place beside the map");
  eq(await page.locator(".cc-doc .cc-placemap").count(), 0, "no preview beside the full map");
  for (const [id, note] of [["shadowfell", "Otro plano de existencia"], ["whitestone", "Sin marcador en el mapa"]]) {
    await page.evaluate(h => { location.hash = h; }, `#/places/place/${id}`);
    await page.waitForFunction(i => location.hash.endsWith(i), id);
    await page.waitForTimeout(200);
    eq(await page.locator(".cc-doc .cc-placemap").count(), 0, `${id}: no preview`);
    assert((await page.textContent(".cc-doc")).includes(note), `${id}: says why`);
  }
  await ctx.close();
});

for (const [w, h] of [[320, 640], [375, 812]]) {
  await check(`places · ${w}px phone: everything expanded fits, carets and map actions are comfortable, Back keeps the folding`, async () => {
    const { ctx, page } = await open({ viewport: { width: w, height: h }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 }, "#/places");
    await page.locator(".cc-atlas-tools button:has-text('Expandir todo')").tap();
    eq((await placeRows(page)).length, 28, "every place");
    eq(await page.evaluate(() => [document.documentElement.scrollWidth, document.querySelector(".cc-main").scrollWidth]), [w, w], "no horizontal scroll");
    const boxes = await page.$$eval(".cc-twisty:not(.none), .cc-node-map:not(.none)", els => els.map(e => { const r = e.getBoundingClientRect(), a = getComputedStyle(e, "::after"); return [r.width + (a.content !== "none" ? 8 : 0), r.height, r.right]; }));
    assert(boxes.every(([bw, bh, right]) => bw >= 36 && bh >= 42 && right <= w), `targets ${JSON.stringify(boxes.slice(0, 4))}`);
    await page.screenshot({ path: path.join(OUT, `places-${w}-all.png`) });
    await page.locator('[data-place="tyrs-forge"] .cc-node-a').tap();
    await page.waitForFunction(() => location.hash === "#/places/place/tyrs-forge");
    await page.waitForSelector(".cc-crumbs");
    eq(await page.evaluate(() => [document.documentElement.scrollWidth, document.querySelector(".cc-detail").scrollWidth]), [w, w], "the page fits too");
    if (w === 375) await page.screenshot({ path: path.join(OUT, "places-375-open.png") });
    await page.locator(".cc-back").first().tap();
    await page.waitForFunction(() => location.hash === "#/places");
    eq((await placeRows(page)).length, 28, "the list as it was left");
    await ctx.close();
  });
}

await check("places · ES → EN keeps the filter and the folding; labels translated", async () => {
  const { ctx, page } = await open(DESKTOP, "#/places");
  await page.locator('[data-place="emon"] .cc-twisty').click();
  await page.fill(placeFind, "pelor");
  await page.waitForTimeout(120);
  const es = await placeRows(page);
  await page.click(".cc-lang button:has-text('EN')");
  await page.waitForFunction(() => document.documentElement.lang === "en");
  eq([await page.inputValue(placeFind), await placeRows(page)], ["pelor", es], "same filter, same places");
  eq((await page.textContent("#cc-atlas-status")).trim(), "2 of 28 places match", "English count");
  await page.fill(placeFind, "");
  await page.waitForTimeout(120);
  eq(await page.locator('[data-place="emon"] .cc-twisty').getAttribute("aria-expanded"), "true", "folding kept");
  eq(await page.$$eval(".cc-atlas-grp .cc-h2", hs => hs.map(h => h.textContent.replace(/\s+/g, " ").trim())), ["Atlas of Exandria 25", "Other planes 3"], "group names");
  await ctx.close();
});

// ── Sessions and Quests: their own searches ────────────────────────────────
const sessionFind = 'input[aria-label="Buscar sesiones"]', questFind = 'input[aria-label="Buscar misiones"]', charFind = 'input[aria-label="Buscar un personaje"]';
const sessionNos = page => page.$$eval(".cc-main .cc-scard-no", els => els.map(e => +e.textContent));
const questTitles = page => page.$$eval(".cc-main a.cc-qcard .cc-ctitle", els => els.map(e => e.textContent));
const typeIn = async (page, sel, q) => { await page.fill(sel, q); await page.waitForTimeout(120); };
const whyLabels = page => page.$$eval(".cc-main .cc-scard, .cc-main .cc-qcard", cs => cs.map(c => { const k = c.querySelector(".cc-why-k"); return k ? k.textContent.replace(/:\s*$/, "").trim() : ""; }));
const fold = s => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

await check("sessions · search: a number, a title, what was recorded, accents and case; the count and why each appeared; the order kept; no results", async () => {
  const { ctx, page } = await open(DESKTOP, "#/sessions");
  eq(await sessionNos(page), [1, 2, 8, 10, 11, 12], "every session, oldest first");
  eq(await page.locator(".cc-main .cc-gap").count(), 2, "the unchronicled runs are marked (3–7, 9)");
  eq(await page.locator("#cc-sessions-status").count(), 0, "no count until something is typed");
  for (const q of ["12", "Sesión 12", "session 12"]) { await typeIn(page, sessionFind, q); eq(await sessionNos(page), [12], q); }
  await typeIn(page, sessionFind, "1");
  eq(await sessionNos(page), [1], "1 is session 1 — not 10, 11 or 12");
  eq(await page.locator(".cc-main .cc-gap").count(), 0, "a search leaves the gap markers out");
  await typeIn(page, sessionFind, "vigilados");
  eq(await page.$$eval(".cc-main .cc-scard .cc-ctitle mark", ms => ms.map(m => m.textContent)), ["Vigilados"], "the title's words, marked");
  // A word told in the logs: an event, an opening line, a plot, an effect — each card says where.
  await typeIn(page, sessionFind, "incienso");
  eq(await sessionNos(page), [8, 10, 11, 12], "what was recorded");
  eq((await page.textContent("#cc-sessions-status")).trim(), "4 de 6 sesiones", "the count");
  eq(await whyLabels(page), ["Acontecimiento", "", "Hilo", "Efecto"], "where the words were found (the opening line needs no label)");
  eq(await page.$$eval(".cc-main .cc-scard .cc-ctext mark", ms => ms.map(m => m.textContent.toLowerCase())), ["incienso", "incienso", "incienso", "incienso"], "the word marked in its sentence");
  const markBg = await page.$eval(".cc-main .cc-scard .cc-ctext mark", m => getComputedStyle(m).backgroundColor);
  eq(markBg, "rgba(207, 166, 80, 0.3)", "a faint gilt underlay, not a bright yellow");
  eq(await page.getAttribute(sessionFind, "aria-describedby"), "cc-sessions-status", "the field is described by its count");
  await page.screenshot({ path: path.join(OUT, "find-sessions-1280.png") });
  // The order the reader chose applies to the results too.
  await page.click(".cc-results .cc-seg button:last-child");
  eq(await sessionNos(page), [12, 11, 10, 8], "latest first");
  eq(await page.inputValue(sessionFind), "incienso", "the words stay");
  await page.click(".cc-results .cc-seg button:first-child");
  eq(await sessionNos(page), [8, 10, 11, 12], "oldest first again");
  // Accents and case.
  await typeIn(page, sessionFind, "PELÓR");
  const pelor = await sessionNos(page);
  await typeIn(page, sessionFind, "pelor");
  eq(await sessionNos(page), pelor, "PELÓR = pelor");
  assert(pelor.length > 1, `pelor: ${pelor}`);
  // Nothing found: said plainly, with the way out; an unchronicled number says so.
  await typeIn(page, sessionFind, "Sesión 3");
  const empty = (await page.textContent(".cc-main .cc-empty")).replace(/\s+/g, " ");
  assert(empty.includes("No encontramos sesiones que coincidan con tu búsqueda.") && empty.includes("La sesión 3 no tiene crónica."), empty);
  eq((await page.textContent("#cc-sessions-status")).trim(), "0 de 6 sesiones", "the count says none");
  await page.screenshot({ path: path.join(OUT, "find-sessions-none.png") });
  await page.click(".cc-main .cc-empty button:has-text('Borrar la búsqueda')");
  await page.waitForTimeout(120);
  eq([await page.inputValue(sessionFind), (await sessionNos(page)).length], ["", 6], "cleared: every session back");
  eq(await page.evaluate(() => document.activeElement.getAttribute("aria-label")), "Buscar sesiones", "the focus stays in the field");
  // ✕ and Esc clear too, the focus kept in the field.
  await typeIn(page, sessionFind, "Locus");
  eq(await page.getAttribute(".cc-main .cc-search-x", "aria-label"), "Borrar la búsqueda", "the ✕ has a name");
  await page.click(".cc-main .cc-search-x");
  await page.waitForTimeout(120);
  eq([await page.inputValue(sessionFind), await page.evaluate(() => document.activeElement.getAttribute("aria-label"))], ["", "Buscar sesiones"], "✕");
  await typeIn(page, sessionFind, "Locus");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(120);
  eq([await page.inputValue(sessionFind), (await sessionNos(page)).length, new URL(page.url()).hash], ["", 6, "#/sessions"], "Esc clears, and stays");
  await page.fill(sessionFind, "zzqq");
  await page.click(".cc-main .cc-empty button:has-text('Buscar en toda la crónica')");
  await page.waitForSelector("[data-dialog=search]");
  eq(await page.inputValue(".cc-spanel input"), "zzqq", "the universal search takes the words");
  await page.keyboard.press("Escape");
  await ctx.close();
});

await check("sessions · the count is said once typing pauses, not at every key", async () => {
  const { ctx, page } = await open(DESKTOP, "#/sessions");
  await page.evaluate(() => { const el = document.querySelector(".cc-app > .cc-sr[aria-live]"); window.__said = []; new MutationObserver(() => window.__said.push(el.textContent.trim())).observe(el, { childList: true, subtree: true, characterData: true }); });
  await page.locator(sessionFind).pressSequentially("cassandra", { delay: 60 });
  await page.waitForTimeout(200);
  eq(await page.evaluate(() => window.__said.filter(Boolean)), [], "nothing said while typing");
  await page.waitForTimeout(1200);
  eq([...new Set(await page.evaluate(() => window.__said.filter(Boolean)))], ["4 de 6 sesiones"], "then the count, once");
  await ctx.close();
});

await check("sessions · a search survives opening a session and coming back — beside the list on desktop, Back on a phone (words, order, scroll); not the next visit", async () => {
  let { ctx, page } = await open(DESKTOP, "#/sessions");
  await typeIn(page, sessionFind, "Vasselheim");
  const found = await sessionNos(page);
  await page.click('.cc-main a.cc-scard[href="#/sessions/session/11"]');
  await page.waitForFunction(() => location.hash === "#/sessions/session/11");
  await page.waitForSelector(".cc-detail .cc-doc-h");
  eq([await page.inputValue(sessionFind), await sessionNos(page)], ["Vasselheim", found], "the list beside the entry keeps its search");
  eq(await page.locator(".cc-main .cc-scard.is-sel .cc-scard-no").textContent(), "11", "the open session is marked in the results");
  await page.screenshot({ path: path.join(OUT, "find-sessions-1280-open.png") });
  await page.click(".cc-docbar .cc-wide-only");                                    // ✕ closes the entry
  await page.waitForFunction(() => location.hash === "#/sessions");
  eq(await page.inputValue(sessionFind), "Vasselheim", "closed: still searching");
  await ctx.close();
  ({ ctx, page } = await open(PHONE, "#/sessions"));
  await page.click(".cc-results .cc-seg button:last-child");                      // latest first
  await typeIn(page, sessionFind, "Cassandra");
  const nos = await sessionNos(page);
  eq(nos, [12, 11, 10, 8], "latest first, found");
  const scrolled = await page.evaluate(() => { const m = document.querySelector(".cc-main"); m.scrollTop = 300; return m.scrollTop; });
  assert(scrolled > 50, `the results scroll (${scrolled})`);
  await page.waitForTimeout(150);
  await page.locator(".cc-main .cc-scard").nth(2).tap();
  await page.waitForFunction(() => location.hash === "#/sessions/session/10");
  await page.locator(".cc-back").first().tap();
  await page.waitForFunction(() => location.hash === "#/sessions");
  await page.waitForTimeout(250);
  eq([await page.inputValue(sessionFind), await sessionNos(page)], ["Cassandra", nos], "Back: the same words, the same order");
  const top = await page.evaluate(() => document.querySelector(".cc-main").scrollTop);
  assert(Math.abs(top - scrolled) <= 4, `the scroll position too (${top}, left at ${scrolled})`);
  // Another section and back: still there (this visit); the next visit starts empty.
  await page.locator(".cc-bn", { hasText: "Crónica" }).tap();
  await page.waitForSelector(".cc-results-t");
  await page.locator(".cc-bn", { hasText: "Sesiones" }).tap();
  await page.waitForSelector(sessionFind);
  eq(await page.inputValue(sessionFind), "Cassandra", "kept across sections");
  await page.reload();
  await page.waitForSelector(sessionFind);
  eq([await page.inputValue(sessionFind), (await sessionNos(page)).length], ["", 6], "a new visit starts with the whole list");
  await ctx.close();
});

await check("quests · search AND status: the words survive status changes, the status survives clearing; ‘see N in other statuses’; no results explain both", async () => {
  const { ctx, page } = await open(DESKTOP, "#/quests");
  const tab = name => page.locator(".cc-statusbar button", { hasText: name });
  const on = () => page.$eval(".cc-statusbar .is-on", b => b.textContent.replace(/\s*\d+\s*$/, "").trim());
  const counts = () => page.$$eval(".cc-statusbar .cc-count", cs => cs.map(c => +c.textContent));
  const all = await counts();
  await tab("En curso").click();
  await typeIn(page, questFind, "Cassandra");
  const active = await questTitles(page);
  eq(active.length, 4, `active quests holding Cassandra: ${active}`);
  assert(await page.$$eval(".cc-main a.cc-qcard .cc-badge", bs => bs.every(b => b.textContent.trim() === "En curso")), "only active ones");
  eq((await page.textContent("#cc-quests-status")).trim(), "4 de 17 misiones", "the count against every quest");
  eq(await counts(), all, "the tabs keep counting every quest of their status");
  eq((await page.textContent(".cc-main .cc-results .cc-linkbtn")).trim(), "Ver 2 en otros estados", "the matches the status hides, one tap away");
  assert((await whyLabels(page)).includes("Sesión 8"), "a session note says which session");
  eq(await page.$$eval(".cc-main a.cc-qcard mark", ms => [...new Set(ms.map(m => m.textContent))]), ["Cassandra"], "marked in titles and reasons");
  await page.screenshot({ path: path.join(OUT, "find-quests-1280.png") });
  await tab("Completada").click();
  await page.waitForTimeout(120);
  eq(await page.inputValue(questFind), "Cassandra", "changing the status keeps the words");
  eq((await questTitles(page)).length, 2, "completed quests holding Cassandra");
  await tab("Todas").click();
  await page.waitForTimeout(120);
  eq((await questTitles(page)).length, 6, "every status: still searching");
  // Nothing in this status: both criteria are named, the way to the others offered — nothing is changed by itself.
  await tab("Completada").click();
  await typeIn(page, questFind, "Pike");
  const empty = (await page.textContent(".cc-main .cc-empty")).replace(/\s+/g, " ");
  assert(empty.includes("No encontramos misiones que coincidan con tu búsqueda.") && empty.includes("Solo se muestran las misiones «Completada»."), empty);
  eq(await on(), "Completada", "the status filter is not removed by itself");
  await page.screenshot({ path: path.join(OUT, "find-quests-none.png") });
  await page.click(".cc-main .cc-empty button:has-text('en otros estados')");
  await page.waitForTimeout(120);
  eq([await on(), await page.inputValue(questFind), (await questTitles(page)).length], ["Todas", "Pike", 5], "every status, the same words");
  // Clearing the words keeps the status.
  await tab("En curso").click();
  await page.click(".cc-main .cc-search-x");
  await page.waitForTimeout(120);
  eq([await on(), await page.inputValue(questFind), (await questTitles(page)).length], ["En curso", "", 11], "cleared: the status stays");
  eq(await page.locator("#cc-quests-status").count(), 0, "no count without words");
  await ctx.close();
});

await check("quests · status and words survive opening a quest and Back (phone)", async () => {
  const { ctx, page } = await open({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }, "#/quests");
  await page.locator(".cc-statusbar button", { hasText: "En curso" }).tap();
  await typeIn(page, questFind, "Cassandra");
  const titles = await questTitles(page);
  await page.locator(".cc-main a.cc-qcard").nth(1).tap();
  await page.waitForFunction(() => /^#\/quests\/quest\//.test(location.hash));
  await page.waitForSelector(".cc-doc-h");
  await page.locator(".cc-back").first().tap();
  await page.waitForFunction(() => location.hash === "#/quests");
  await page.waitForTimeout(200);
  eq([await page.$eval(".cc-statusbar .is-on", b => b.textContent.replace(/\s*\d+\s*$/, "").trim()), await page.inputValue(questFind), await questTitles(page)],
    ["En curso", "Cassandra", titles], "the same status, words and quests");
  await ctx.close();
});

await check("characters · search: the same matches with a count; the reason on a row's quiet line (alias, kind, role); names marked; no results with its way out; ES ↔ EN", async () => {
  const { ctx, page } = await open(DESKTOP, "#/characters");
  const rows = () => page.$$eval(".cc-main .cc-pcard, .cc-main .cc-row", as => as.map(a => a.getAttribute("href").split("/").pop()));
  const sub = id => page.$eval(`.cc-main a[href$="/character/${id}"] .cc-row-sub`, s => ({ label: s.querySelector(".cc-why-k") ? s.querySelector(".cc-why-k").textContent.replace(/:\s*$/, "").trim() : "",
    text: s.textContent.replace(/\s+/g, " ").trim(), marks: [...s.querySelectorAll("mark")].map(m => m.textContent) }));
  eq((await rows()).length, 42, "everyone, as before");
  eq(await page.locator("#cc-characters-status").count(), 0, "no count until something is typed");
  await typeIn(page, charFind, "Morgas");
  eq(await rows(), ["mortis"], "an alias");
  eq((await page.textContent("#cc-characters-status")).trim(), "1 de 42 personajes", "the count");
  eq(await page.getAttribute(charFind, "aria-describedby"), "cc-characters-status", "the field is described by its count");
  eq(await sub("mortis"), { label: "Alias", text: "Alias: Morgas", marks: ["Morgas"] }, "the reason, marked, on the card's own line");
  await typeIn(page, charFind, "nigromancia");
  eq([await rows(), await sub("mortis")], [["mortis"], { label: "", text: "Mago · Escuela de Nigromancia / Clérigo · Dominio de la Muerte", marks: ["Nigromancia"] }], "the role the card already shows, just marked");
  await typeIn(page, charFind, "dampiro");
  eq([await rows(), await sub("locus")], [["locus"], { label: "", text: "dampiro", marks: ["dampiro"] }], "the kind the row already shows, just marked");
  await typeIn(page, charFind, "custodio");
  eq([await rows(), await sub("marco")], [["marco"], { label: "Alias", text: "Alias: El custodio de la capilla de Pelor", marks: ["custodio"] }], "an alias the row did not show");
  await page.screenshot({ path: path.join(OUT, "find-characters-1280.png") });
  await typeIn(page, charFind, "Bahamut");
  const names = await page.$$eval(".cc-main .cc-ctitle mark", ms => ms.map(m => m.textContent));
  assert(names.length > 0 && names.every(n => n === "Bahamut"), `names marked: ${names}`);
  // Nothing found: said plainly, with the way out; Esc clears too.
  await typeIn(page, charFind, "zzqq");
  const empty = (await page.textContent(".cc-main .cc-empty")).replace(/\s+/g, " ");
  assert(empty.includes("No encontramos personajes que coincidan con tu búsqueda.") && empty.includes("Borrar la búsqueda") && empty.includes("Buscar en toda la crónica"), empty);
  eq((await page.textContent("#cc-characters-status")).trim(), "0 de 42 personajes", "the count says none");
  await page.click(".cc-main .cc-empty button:has-text('Borrar la búsqueda')");
  await page.waitForTimeout(120);
  eq([await page.inputValue(charFind), (await rows()).length, await page.evaluate(() => document.activeElement.getAttribute("aria-label"))], ["", 42, "Buscar un personaje"], "cleared, the focus kept in the field");
  await typeIn(page, charFind, "Pike");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(120);
  eq([await page.inputValue(charFind), (await rows()).length], ["", 42], "Esc clears");
  // The other language: the same people, the reason in English.
  await typeIn(page, charFind, "custodian");
  await page.click(".cc-lang button:has-text('EN')");
  await page.waitForFunction(() => document.documentElement.lang === "en");
  const enFind = 'input[aria-label="Find a character"]';
  eq([await page.inputValue(enFind), await rows()], ["custodian", ["marco"]], "same words, same people");
  eq((await page.textContent("#cc-characters-status")).trim(), "1 of 42 characters", "English count");
  eq(await sub("marco"), { label: "Alias", text: "Alias: The custodian of Pelor's chapel", marks: ["custodian"] }, "English reason");
  await ctx.close();
});

for (const [w, h] of [[320, 640], [360, 740], [390, 844], [720, 1000], [768, 1024], [1024, 768], [1440, 900]]) {
  await check(`find · ${w}px: the Sessions, Quests and Characters fields fit with their hint, ✕ comfortable, no sideways scroll`, async () => {
    const phone = w < 720;
    const { ctx, page } = await open({ viewport: { width: w, height: h }, hasTouch: phone, isMobile: phone }, "#/sessions");
    const hints = { sessions: ["Número, título o contenido…", "Buscar sesiones por número, título o contenido…"], quests: ["Nombre o contenido…", "Buscar misiones por nombre o contenido…"],
      characters: ["Nombre, alias, especie o rol…", "Buscar un personaje, deidad o facción…"] };
    for (const [hash, sel, q, name] of [["#/sessions", sessionFind, "Cassandra", "sessions"], ["#/quests", questFind, "Vasselheim", "quests"], ["#/characters", charFind, "dragón", "characters"]]) {
      await page.evaluate(x => { location.hash = x; }, hash);
      await page.waitForSelector(sel);
      const hint = await page.$eval(sel, el => { const cs = getComputedStyle(el), c = document.createElement("canvas").getContext("2d");
        c.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`; return [c.measureText(el.placeholder).width, el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight), el.placeholder]; });
      assert(hint[0] <= hint[1], `${name}: the hint “${hint[2]}” (${Math.round(hint[0])}px) fits its field (${hint[1]}px)`);
      eq(hint[2], hints[name][phone ? 0 : 1], `${name} hint`);
      await typeIn(page, sel, q);
      const box = await page.$eval(".cc-main .cc-search-x", b => { const r = b.getBoundingClientRect(), f = b.parentElement.getBoundingClientRect(); return [r.width, r.height, r.right <= f.right && r.left >= f.left]; });
      assert(box[0] >= 40 && box[1] >= 40 && box[2], `${name}: ✕ ${box}`);
      const sw = await page.evaluate(() => [document.documentElement.scrollWidth, document.querySelector(".cc-main").scrollWidth - document.querySelector(".cc-main").clientWidth]);
      assert(sw[0] <= w && sw[1] <= 0, `${name}: horizontal scroll ${sw}`);
      assert((await page.locator(".cc-main .cc-scard, .cc-main .cc-qcard, .cc-main .cc-row, .cc-main .cc-pcard").count()) > 0, `${name}: results`);
      await page.screenshot({ path: path.join(OUT, `find-${name}-${w}.png`) });
    }
    if (w >= 1024) {                                                             // the open book: the list keeps its search beside the entry
      await page.evaluate(() => { location.hash = "#/quests"; });
      await page.waitForSelector(".cc-main a.cc-qcard");
      eq(await page.inputValue(questFind), "Vasselheim", "back on Quests: its search is still there");
      await page.locator(".cc-main a.cc-qcard").first().click();
      await page.waitForSelector(".cc-detail .cc-doc-h");
      eq(await page.inputValue(questFind), "Vasselheim", "beside the open quest");
      await page.screenshot({ path: path.join(OUT, `find-quests-${w}-open.png`) });
    }
    await ctx.close();
  });
}

await check("find · ES → EN keeps the words and the status; count, reasons and empty states in English", async () => {
  const { ctx, page } = await open(DESKTOP, "#/sessions");
  await typeIn(page, sessionFind, "Pelor");
  const es = await sessionNos(page);
  await page.click(".cc-lang button:has-text('EN')");
  await page.waitForFunction(() => document.documentElement.lang === "en");
  const enFind = 'input[aria-label="Search the sessions"]';
  eq([await page.inputValue(enFind), await sessionNos(page)], ["Pelor", es], "same words, same sessions");
  eq((await page.textContent("#cc-sessions-status")).trim(), `${es.length} of 6 sessions`, "English count");
  eq(await page.getAttribute(enFind, "placeholder"), "Search sessions by number, title or content…", "English hint");
  assert((await whyLabels(page)).some(l => ["Event", "Thread", "Effect", "Began", "Ended", "Character", "Place", "Quest"].includes(l)), `English reasons: ${await whyLabels(page)}`);
  await page.evaluate(() => { location.hash = "#/quests"; });
  const enQuest = 'input[aria-label="Search the quests"]';
  await page.waitForSelector(enQuest);
  await page.locator(".cc-statusbar button", { hasText: "Completed" }).click();
  await typeIn(page, enQuest, "Pike");
  const empty = (await page.textContent(".cc-main .cc-empty")).replace(/\s+/g, " ");
  assert(empty.includes("We couldn't find any quests matching your search.") && empty.includes("Only “Completed” quests are shown.") && empty.includes("See 5 in other statuses"), empty);
  await page.click(".cc-lang button:has-text('ES')");
  await page.waitForFunction(() => document.documentElement.lang === "es-AR");
  eq(await page.inputValue(questFind), "Pike", "and back");
  await ctx.close();
});

// ── One dark theme ──────────────────────────────────────────────────────────
const lum = rgb => { const [r, g, b] = rgb.match(/[\d.]+/g).slice(0, 3).map(Number).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
await check("theme · always dark: no toggle, an old light preference is ignored and removed, dark browser chrome", async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, colorScheme: "light" });
  await ctx.addInitScript(() => { try { localStorage.setItem("chronicle-tour-version", "3"); localStorage.setItem("chronicle-tour-invite", "dismissed"); if (!sessionStorage.getItem("seeded")) { localStorage.setItem("chronicle-theme", JSON.stringify("light")); sessionStorage.setItem("seeded", "1"); } } catch (e) {} });
  const page = await ctx.newPage();
  page.on("pageerror", e => errors.push(`theme: ${e.message}`));
  await page.goto(BASE + "#/places/place/vasselheim");
  await page.waitForSelector(".cc-lore");
  eq(await page.locator(".theme-light, .theme-dark").count(), 0, "no theme classes");
  eq(await page.evaluate(() => localStorage.getItem("chronicle-theme")), null, "old preference removed");
  eq(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme), "dark", "color-scheme");
  eq(await page.getAttribute("meta[name=theme-color]", "content"), "#1b1513", "theme-color (the leather of the bars)");
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
  eq(await page.$eval(".cc-lore-p", el => getComputedStyle(el).color), "rgb(217, 207, 190)", "lore text uses --body2");
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
  await page.click(".cc-results .cc-seg button:last-child");                      // under the Sessions search
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

// ── Quest cards and people chips, as in the design ──────────────────────────
await check("cards · quest cards show their status badge beside the title (under it below 360px); people chips put the role, kind or part played under the name", async () => {
  // Every quest card of the list: the badge repeats its group's status with the icon, and the card stays inside the list.
  const quests = page => page.$$eval(".cc-main .cc-list", lists => lists.flatMap(list => {
    const lr = list.getBoundingClientRect(), group = list.previousElementSibling.textContent.replace(/\s*\d+\s*$/, "").trim();
    return [...list.querySelectorAll("a.cc-qcard")].map(a => {
      const r = a.getBoundingClientRect(), b = a.querySelector(".cc-qcard-h .cc-badge"), t = a.querySelector(".cc-qcard-h .cc-ctitle");
      const br = b.getBoundingClientRect(), tr = t.getBoundingClientRect(), rib = a.classList.contains("is-sel") ? getComputedStyle(a, "::after") : null;
      return { title: t.textContent, group, badge: b.textContent.trim(), icon: !!b.querySelector("svg[aria-hidden=true]"),
        inside: r.left >= lr.left - 0.5 && r.right <= lr.right + 0.5, beside: br.left > tr.right && Math.abs(br.top - tr.top) < 4, below: br.top >= tr.bottom - 1,
        clear: br.right <= r.right - 40 && (!rib || r.right - parseFloat(rib.right) - 16 >= br.right) };
    });
  }));
  const chips = (page, sel) => page.$$eval(sel, cs => cs.map(c => {
    const n = c.querySelector(".cc-chip-l"), s = c.querySelector(".cc-chip-sub");
    return [n.textContent, s.textContent, s.getBoundingClientRect().top >= n.getBoundingClientRect().bottom - 1];
  }));
  let { ctx, page } = await open({ viewport: { width: 320, height: 640 }, hasTouch: true, isMobile: true }, "#/quests");
  let cards = await quests(page);
  eq(cards.length, 17, "every quest");
  cards.forEach(c => assert(c.badge === c.group && c.icon && c.inside && c.below && c.clear, `320: ${JSON.stringify(c)}`));
  await page.screenshot({ path: path.join(OUT, "quests-320.png") });
  // On a phone the chips keep inside their row: a long role ends in an ellipsis instead of widening the chip.
  await page.evaluate(() => { location.hash = "#/chronicle/event/s11_02"; });
  await page.waitForSelector("[data-tour=event-people] .cc-chip");
  const narrow = await page.$$eval("[data-tour=event-people] .cc-chip", cs => cs.map(c => {
    const r = c.getBoundingClientRect(), row = c.parentElement.getBoundingClientRect(), s = c.querySelector(".cc-chip-sub");
    return { name: c.querySelector(".cc-chip-l").textContent, inside: r.right <= row.right + 0.5, cut: s.scrollWidth > s.clientWidth };
  }));
  narrow.forEach(c => assert(c.inside, `320: chip inside its row ${JSON.stringify(c)}`));
  eq(narrow.filter(c => c.cut).map(c => c.name), ["Mortis"], "only the longest role is cut");
  await ctx.close();
  // Desktop: beside the title; the open quest's ribbon hangs over the chevron, clear of the badge.
  ({ ctx, page } = await open(DESKTOP, "#/quests/quest/corrupted-dragon"));
  cards = await quests(page);
  cards.forEach(c => assert(c.badge === c.group && c.icon && c.inside && c.beside && c.clear, `1280: ${JSON.stringify(c)}`));
  // The quest's giver says what they did; a party member shows their class; anyone else what they are.
  const giver = (await chips(page, ".cc-detail .cc-chips .cc-chip:not(.plain)")).find(c => c[0].startsWith("Bahamut"));
  eq(giver, ["Bahamut, el Dragón de Platino", "encargó la misión", true], "the giver's chip");
  await page.evaluate(() => { location.hash = "#/chronicle/event/s12_04"; });
  await page.waitForSelector("[data-tour=event-people] .cc-chip");
  eq(await chips(page, "[data-tour=event-people] .cc-chip"), [["Sorfon", "Paladín · Juramento de Venganza", true], ["Pelor", "Deidad", true], ["Torog, el Rey Reptante", "Deidad", true], ["Haftifaflmorhen", "Criatura", true]], "name over role or kind");
  await page.locator("[data-tour=event-people]").screenshot({ path: path.join(OUT, "chips-1280.png") });
  await page.click(".cc-lang button:has-text('EN')");
  await page.waitForTimeout(200);
  eq((await chips(page, "[data-tour=event-people] .cc-chip")).map(c => c[1]), ["Paladin · Oath of Vengeance", "Deity", "Deity", "Creature"], "in English too");
  await ctx.close();
});

// ── Onboarding: the first-visit welcome, interactive tours (Driver.js), help centre ─────
// The tours run on the real page: these checks click the real controls the popovers point at.
const TOUR = page => page.evaluate(() => {
  const p = document.querySelector(".driver-popover.cc-tour");
  if (!p || getComputedStyle(p).display === "none" || document.body.classList.contains("cc-tour-busy")) return null;
  const r = p.getBoundingClientRect(), a = document.querySelector(".driver-active-element"), ar = a && a.getBoundingClientRect();
  const q = s => { const e = p.querySelector(s); return e && getComputedStyle(e).display !== "none" ? e.textContent.trim() : ""; };
  return { title: q(".driver-popover-title"), text: q(".driver-popover-description"), progress: q(".driver-popover-progress-text"), next: q(".driver-popover-next-btn"),
    prev: q(".driver-popover-prev-btn"), skip: q(".cc-tour-skip"), more: q(".cc-tour-alt"), hash: location.hash,
    box: [r.left, r.top, r.right, r.bottom].map(Math.round),
    active: a && a.id !== "driver-dummy-element" ? { cls: a.className, tour: a.getAttribute("data-tour") || "", box: [ar.left, ar.top, ar.right, ar.bottom].map(Math.round), inert: a.classList.contains("driver-no-interaction") } : null };
});
// Waits for the next popover (optionally a given title, or any title but `not`), placed, settled and usable.
async function tourAt(page, title, { not, timeout = 12000 } = {}) {
  await page.waitForFunction(([t, n]) => {
    const p = document.querySelector(".driver-popover.cc-tour");
    if (!p || getComputedStyle(p).display === "none" || document.body.classList.contains("cc-tour-busy")) return false;
    const h = p.querySelector(".driver-popover-title"), s = h ? h.textContent.trim() : "";
    return (!t || s === t) && (!n || s !== n);
  }, [title || "", not || ""], { timeout });
  await page.waitForTimeout(320);                                   // Driver.js finishes moving the spotlight (260 ms)
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
  if (cover >= 0.1) return { ok: false, why: `“${title}”: the popover covers ${Math.round(100 * cover)}% of its control` };
  if (q.bottom < 0 || q.top > h || q.right < 0 || q.left > w) return { ok: false, why: `“${title}”: its control is off screen` };
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
// The first-visit welcome once its entrance has finished: where it is, what it says, whether it holds the focus.
const WELCOME = page => page.evaluate(async () => {
  const el = document.querySelector(".cc-welcome"); if (!el) return null;
  await Promise.all(el.getAnimations().map(a => a.finished.catch(() => {})));
  const r = el.getBoundingClientRect(), nav = document.querySelector(".cc-bottom");
  return { box: [r.left, r.top, r.right, r.bottom].map(Math.round), role: el.getAttribute("role"), modal: el.getAttribute("aria-modal"),
    name: document.getElementById(el.getAttribute("aria-labelledby")).textContent.trim(), text: [...el.querySelectorAll("p, h2, span")].map(x => x.textContent).join(" ").replace(/\s+/g, " "),
    focused: el === document.activeElement || el.contains(document.activeElement), navTop: nav && getComputedStyle(nav).display !== "none" ? Math.round(nav.getBoundingClientRect().top) : null,
    buttons: [...el.querySelectorAll("button")].map(b => b.textContent.trim()), backdrop: !!document.querySelector(".cc-overlay, .driver-overlay") };
});
const MAIN_TITLES = ["Las secciones", "La Crónica", "Sesiones", "Misiones", "El mapa", "", "Encontrá cualquier cosa", "¿Necesitás ayuda otra vez?"];

await check("onboarding · first visit: the welcome appears by itself once the chronicle loads — a card, not a modal; the page stays usable", async () => {
  const { ctx, page } = await open(DESKTOP, "#/chronicle", { keepGuide: true });
  await page.waitForSelector(".cc-welcome");
  const w = await WELCOME(page);
  eq([w.role, w.modal, w.name, w.backdrop], ["dialog", "false", "Crónica de Exandria", false], "a labelled, non-modal dialog without a backdrop");
  for (const s of ["Te damos la bienvenida", "Descubrí las aventuras de Bund Der Vier, explorá los lugares que visitaron y seguí las historias, personajes y misiones de la campaña.", "Te mostramos cómo funciona todo con un breve recorrido interactivo.", "8 pasos", "Ayuda (?)"])
    assert(w.text.includes(s), `says “${s}”`);
  eq(w.buttons, ["Comenzar recorrido", "Ahora no"], "two clear answers");
  eq(w.focused, true, "the focus lands in it (nothing else had it)");
  assert(w.box[2] <= 1280 && w.box[3] <= 820 && (w.box[2] - w.box[0]) * (w.box[3] - w.box[1]) < 1280 * 820 * 0.2, `a corner card, not a screen (${w.box})`);
  eq(await page.locator(".driver-popover, [data-dialog]").count(), 0, "no tour, no help opened by itself");
  // The page under it works: a card can be opened (the welcome waits on the home, so it steps aside).
  await page.locator(".cc-card").first().click();
  await page.waitForFunction(() => /^#\/chronicle\/event\//.test(location.hash));
  eq(await page.locator(".cc-welcome").count(), 0, "not over an open entry");
  await page.goBack();
  await page.waitForSelector(".cc-welcome");
  eq((await WELCOME(page)).focused, false, "back on the home it waits without taking the focus again");
  await page.screenshot({ path: path.join(OUT, "welcome-desktop.png") });
  await ctx.close();
});

await check("tour · the main tour: eight steps by real clicks and “Siguiente”, “Paso N de 8”, consistent controls; remembered", async () => {
  const { ctx, page } = await open(DESKTOP, "#/chronicle", { keepGuide: true });
  await page.waitForSelector(".cc-welcome");
  const len0 = await page.evaluate(() => history.length);
  await page.click(".cc-welcome-go");
  let s = await tourAt(page, "Las secciones");
  eq([s.progress, s.next, s.prev, s.skip], ["Paso 1 de 8", "Siguiente", "", "Omitir tutorial"], "first step");
  assert(/cc-tabs/.test(s.active.cls), "the real section tabs");
  eq(await page.evaluate(() => document.activeElement.classList.contains("driver-popover-next-btn")), true, "focus on “Siguiente”");
  await page.screenshot({ path: path.join(OUT, "tour-desktop-sections.png") });
  s = await tourStepNext(page);
  eq([s.title, s.progress, s.prev], ["La Crónica", "Paso 2 de 8", "Anterior"], "the Chronicle");
  assert(/cc-group|cc-card/.test(s.active.cls), "a real day of the story");
  s = await tourStepNext(page);
  eq([s.title, s.hash, s.progress], ["Sesiones", "#/sessions", "Paso 3 de 8"], "Sessions — always explained");
  assert(/cc-scard/.test(s.active.cls), "a real session");
  assert(s.text.includes("Anteriormente en…"), "and where to catch up");
  s = await tourStepNext(page);
  eq([s.title, s.hash], ["Misiones", "#/quests"], "Quests");
  assert(/cc-statusbar/.test(s.active.cls) && !s.active.inert, "the status filter, usable");
  await page.locator(".driver-active-element .cc-btn").nth(2).click();                     // the visitor filters by a status
  await page.waitForTimeout(300);
  eq((await TOUR(page)).title, "Misiones", "using it keeps the step");
  s = await tourStepNext(page);
  eq([s.title, s.hash, s.progress], ["El mapa", "#/map", "Paso 5 de 8"], "the map");
  assert(/cc-marker/.test(s.active.cls), "a real marker");
  eq(await page.evaluate(() => { const a = document.querySelector(".driver-active-element").getBoundingClientRect(), v = document.querySelector(".cc-vp").getBoundingClientRect(); return a.left >= v.left && a.right <= v.right && a.top >= v.top && a.bottom <= v.bottom; }), true, "inside the visible map");
  await page.screenshot({ path: path.join(OUT, "tour-desktop-map.png") });
  await page.click(".driver-active-element");                                            // the visitor taps it
  s = await tourAt(page, null, { not: "El mapa" });
  assert(["Lo que pasó ahí", "Varios acontecimientos ahí"].includes(s.title), `the marker's card: ${s.title}`);
  eq(s.progress, "Paso 6 de 8", "the tap moved the tour on");
  eq(await page.locator(".driver-active-element[data-popup]").count(), 1, "the card is highlighted");
  assert(/¿Cómo funciona\?/.test(s.text), "and the map's own tour is pointed out");
  assert(await page.isVisible(".cc-maphelp"), "…which stays in view");
  s = await tourStepNext(page);
  eq([s.title, s.hash], ["Encontrá cualquier cosa", "#/chronicle"], "the search, back on the home");
  assert(/cc-searchbtn/.test(s.active.cls), "the real magnifier");
  s = await tourStepNext(page);
  eq([s.title, s.progress, s.next, s.skip, s.more], ["¿Necesitás ayuda otra vez?", "Paso 8 de 8", "Finalizar", "", "Ver más tutoriales"], "help, last");
  eq(s.active.tour, "help", "the real “?” button");
  assert(/botón de ayuda \(\?\)/.test(s.text) && /mapa y de la búsqueda/.test(s.text), "how to come back, and the other tutorials");
  await page.screenshot({ path: path.join(OUT, "tour-desktop-help.png") });
  // Anterior works across screens too.
  await page.click(".driver-popover-prev-btn");
  s = await tourAt(page, "Encontrá cualquier cosa");
  s = await tourStepNext(page);
  await tourNext(page);
  await tourGone(page);
  eq(await onboarding(page), { version: "3", completed: ["main"], invite: null }, "completion remembered");
  eq(await page.evaluate(() => [history.length, history.state, location.hash]), [len0 + 1, null, "#/chronicle"], "one ordinary history entry; it ends on the home");
  eq(await page.getAttribute(".cc-searchbtn", "aria-haspopup"), "dialog", "the app's own aria attributes are back");
  eq(await page.evaluate(() => document.activeElement.className), "cc-linkbtn cc-qa-help", "focus on the Chronicle's “¿Cómo funciona?”");
  eq(await page.locator(".cc-welcome").count(), 0, "the welcome does not come back");
  await page.reload();
  await page.waitForSelector(".cc-card");
  await page.waitForTimeout(400);
  eq(await page.locator(".cc-welcome, .driver-popover").count(), 0, "nor after a reload");
  await ctx.close();
});

await check("onboarding · “Ahora no”, Esc in the welcome and leaving the tour early: the welcome does not come back by itself", async () => {
  // "Ahora no": dismissed for good, said aloud, focus to "¿Cómo funciona?".
  let { ctx, page } = await open(DESKTOP, "#/chronicle", { keepGuide: true });
  await page.waitForSelector(".cc-welcome");
  await page.click(".cc-welcome .cc-btn.ghost");
  await page.waitForFunction(() => !document.querySelector(".cc-welcome"));
  eq(await onboarding(page), { version: "3", completed: [], invite: "dismissed" }, "dismissed, not completed");
  eq(await page.evaluate(() => document.activeElement.className), "cc-linkbtn cc-qa-help", "the focus shows where the help is");
  eq((await page.textContent("div.cc-sr[aria-live]")).trim(), "Siempre a mano en Ayuda (?)", "said aloud where the tour stays");
  await page.reload();
  await page.waitForSelector(".cc-card");
  await page.waitForTimeout(400);
  eq(await page.locator(".cc-welcome").count(), 0, "not after a reload");
  await ctx.close();
  // Esc while in the welcome = "Ahora no".
  ({ ctx, page } = await open(DESKTOP, "#/chronicle", { keepGuide: true }));
  await page.waitForSelector(".cc-welcome");
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => !document.querySelector(".cc-welcome"));
  eq((await onboarding(page)).invite, "dismissed", "Esc dismissed it");
  await ctx.close();
  // Leaving the tour early: back where it started (route, list scroll, filters) and the welcome stays away.
  ({ ctx, page } = await open(DESKTOP, "#/chronicle", { keepGuide: true }));
  await page.waitForSelector(".cc-welcome");
  await page.click("button[aria-controls=cc-filters]");
  eq(await page.locator(".cc-welcome").count(), 0, "the welcome steps aside while the filters are open");
  await page.locator(".cc-pcchip", { hasText: "Mortis" }).click();
  await page.click(".cc-factions .cc-btn:not(.ghost)");
  await page.waitForSelector(".cc-welcome");
  await page.evaluate(() => { document.querySelector(".cc-main").scrollTop = 700; });
  await page.waitForTimeout(150);
  const state = () => page.evaluate(() => ({ hash: location.hash, top: Math.round(document.querySelector(".cc-main") ? document.querySelector(".cc-main").scrollTop : -1), filters: sessionStorage.getItem("chronicle-filters"), marker: history.state }));
  const before = await state();
  await page.click(".cc-welcome-go");
  await tourAt(page, "Las secciones"); await tourNext(page);
  await tourAt(page, "La Crónica"); await tourNext(page);
  await tourAt(page, "Sesiones");
  await page.keyboard.press("Escape");
  await tourGone(page);
  await page.waitForTimeout(200);
  const after = await state();
  eq({ ...after, top: Math.abs(after.top - before.top) <= 2 }, { ...before, top: true }, "Esc: route, scroll, filters and history entry as before");
  eq(await onboarding(page), { version: "3", completed: [], invite: "dismissed" }, "not completed, and the welcome stays away");
  eq(await page.locator(".cc-welcome").count(), 0, "no welcome right after");
  await ctx.close();
});

await check("onboarding · the help centre restarts the main tour from step 1; Back, “Omitir tutorial” and the map tutorial restore their start", async () => {
  const { ctx, page } = await open(DESKTOP, "#/sessions");
  await page.waitForSelector(".cc-scard");
  // Back (browser / Android gesture) during the main tour started from the help centre.
  await page.click(".cc-actions button[aria-haspopup=dialog]");
  await page.waitForSelector("[data-dialog=help]");
  await page.locator(".cc-tourrow").first().click();
  let s = await tourAt(page, "Las secciones");
  eq([s.progress, s.hash], ["Paso 1 de 8", "#/chronicle"], "from the first step, on the home");
  await tourNext(page);
  await tourAt(page, "La Crónica");
  await page.goBack();
  await tourGone(page);
  await page.waitForTimeout(150);
  eq(await page.evaluate(() => [location.hash, history.state, document.querySelectorAll("[data-dialog]").length]), ["#/sessions", null, 0], "Back: the tour ends where it started");
  // Again from the help centre: a fresh start at step 1 (not where it was left).
  await page.click(".cc-actions button[aria-haspopup=dialog]");
  await page.waitForSelector("[data-dialog=help]");
  await page.locator(".cc-tourrow").first().click();
  s = await tourAt(page, "Las secciones");
  eq(s.progress, "Paso 1 de 8", "restarts from the beginning");
  await page.click(".driver-popover .cc-tour-skip");                             // "Omitir tutorial"
  await tourGone(page);
  await page.waitForTimeout(150);
  eq(await page.evaluate(() => location.hash), "#/sessions", "“Omitir tutorial”: back where it started");
  // "Omitir tutorial" in the map tutorial after toggling a party member: filters and panel come back.
  const filters = await page.evaluate(() => sessionStorage.getItem("chronicle-filters"));
  await page.evaluate(() => { location.hash = "#/map"; });
  await page.waitForSelector(".cc-mapbar");
  await page.waitForTimeout(400);
  await page.click(".cc-maphelp");
  await tourAt(page, "Los marcadores");
  await tourNextTo(page, "Las líneas punteadas");
  await page.locator(".driver-active-element .cc-partyrow, .cc-partyrow.driver-active-element").first().click();
  assert((await page.evaluate(() => sessionStorage.getItem("chronicle-filters"))) !== filters, "the visitor changed a filter during the tour");
  await page.click(".driver-popover .cc-tour-skip");
  await tourGone(page);
  await page.waitForTimeout(150);
  eq(await page.evaluate(() => [location.hash, sessionStorage.getItem("chronicle-filters"), !!document.querySelector(".cc-mappanel"), !!document.querySelector("[data-popup]")]), ["#/map", filters, false, false], "filters, panel and popups as before");
  await ctx.close();
});

await check("onboarding · a direct link is never interrupted (phone and desktop): the welcome waits for the Chronicle's home", async () => {
  for (const opts of [PHONE, DESKTOP]) {
    // A fresh visitor (nothing stored) arriving straight on an entry, then on a section.
    const ctx = await browser.newContext(opts), page = await ctx.newPage();
    page.on("pageerror", e => errors.push(`deep link: ${e.message}`));
    await page.goto(BASE + "#/chronicle/event/s12_03");
    await page.waitForSelector(".cc-doc-h", { timeout: 15000 });
    await page.waitForTimeout(600);
    eq(await page.locator("[data-dialog], .driver-popover, .cc-welcome").count(), 0, "no dialog, no tour, no welcome over the entry");
    eq(await page.textContent(".cc-doc-h"), "Mortis muere para llegar a la Reina Cuervo", "the entry is there");
    await page.evaluate(() => { location.hash = "#/quests"; });
    await page.waitForSelector(".cc-qcard");
    await page.waitForTimeout(300);
    eq(await page.locator(".cc-welcome").count(), 0, "not on another section either");
    await page.evaluate(() => { location.hash = "#/chronicle"; });
    await page.waitForSelector(".cc-welcome", { timeout: 5000 });
    eq((await onboarding(page)).invite, null, "still pending: shown once the visitor reaches the home");
    await ctx.close();
  }
});

await check("tour · phone 375: welcome above the bottom bar; the 8 steps; help shown as More → Ayuda; every popover on screen and off its control", async () => {
  const { ctx, page } = await open(PHONE, "#/chronicle", { keepGuide: true });
  const tap = sel => page.locator(sel).first().tap();
  await page.waitForSelector(".cc-welcome");
  const w = await WELCOME(page);
  assert(w.box[0] >= 8 && w.box[2] <= 367 && w.box[1] >= 0 && w.box[3] <= w.navTop, `inside the screen, above the bottom bar (${w.box}, bar at ${w.navTop})`);
  assert(w.text.includes("Más → Ayuda"), "says where the help lives on a phone");
  await page.screenshot({ path: path.join(OUT, "welcome-phone.png") });
  await tap(".cc-welcome-go");
  let s = await tourAt(page, "Las secciones"); await fits(page, 375, 812, "phone");
  assert(/cc-bottom/.test(s.active.cls) && s.text.includes("«Más»"), "the bottom bar, and “Más”");
  await tap(".driver-popover-next-btn");
  await tourAt(page, "La Crónica"); await fits(page, 375, 812, "phone");
  await tap(".driver-popover-next-btn");
  await tourAt(page, "Sesiones"); await fits(page, 375, 812, "phone");
  await tap(".driver-popover-next-btn");
  await tourAt(page, "Misiones"); await fits(page, 375, 812, "phone");
  await tap(".driver-popover-next-btn");
  s = await tourAt(page, "El mapa"); await fits(page, 375, 812, "phone");
  await page.screenshot({ path: path.join(OUT, "tour-phone-map.png") });
  await tap(".driver-active-element");                                                   // a real tap on the marker
  s = await tourAt(page, null, { not: "El mapa" }); await fits(page, 375, 812, "phone");
  eq(s.progress, "Paso 6 de 8", "the tap moved the tour on");
  await tap(".driver-popover-next-btn");
  s = await tourAt(page, "Encontrá cualquier cosa"); await fits(page, 375, 812, "phone");
  await tap(".driver-popover-next-btn");
  s = await tourAt(page, "¿Necesitás ayuda otra vez?"); await fits(page, 375, 812, "phone");
  assert(await page.isVisible(".cc-sheet"), "the More sheet is open");
  eq([s.active.tour, s.active.inert], ["help", true], "its “Ayuda”, highlighted");
  assert(/cc-sheet-item/.test(s.active.cls), "the sheet's item, not the hidden “?”");
  assert(s.text.includes("«Más» → «Ayuda»"), "More → Help, in words");
  await page.screenshot({ path: path.join(OUT, "tour-phone-help.png") });
  await tap(".driver-popover-next-btn");
  await tourGone(page);
  eq(await page.locator(".cc-sheet").count(), 0, "the sheet closes with the tour");
  eq((await onboarding(page)).completed, ["main"], "completed on the phone");
  eq(await page.evaluate(() => document.documentElement.scrollWidth), 375, "no sideways scroll");
  await ctx.close();
});

// Next all the way (the tour does each action itself) at every width.
for (const [w, h] of [[320, 640], [360, 740], [390, 844], [430, 932], [768, 1024], [1280, 820]]) {
  await check(`tour · ${w}px: the welcome fits; every step fits, keeps its control visible and usable, and “Siguiente” carries on across screens`, async () => {
    const phone = w < 720;
    const { ctx, page } = await open({ viewport: { width: w, height: h }, hasTouch: phone, isMobile: phone }, "#/chronicle", { keepGuide: true });
    await page.waitForSelector(".cc-welcome");
    const wc = await WELCOME(page);
    assert(wc.box[0] >= 0 && wc.box[2] <= w && wc.box[1] >= 0 && wc.box[3] <= (wc.navTop || h), `welcome inside the screen (${wc.box})`);
    assert((wc.box[3] - wc.box[1]) <= h * 0.6, `the welcome leaves most of the screen free (${wc.box[3] - wc.box[1]}px of ${h})`);
    eq(await page.evaluate(() => document.documentElement.scrollWidth), w, "no sideways scroll");
    if (w === 320) await page.screenshot({ path: path.join(OUT, "welcome-320.png") });
    await page.click(".cc-welcome-go");
    let s = await tourAt(page);
    const titles = [];
    for (let i = 0; i < 12; i++) {
      titles.push(s.title);
      await fits(page, w, h, `${w}px`);
      if (w === 320 || w === 1280) await page.screenshot({ path: path.join(OUT, `tour-${w}-${String(i + 1).padStart(2, "0")}.png`) });
      if (s.next === "Finalizar") break;
      s = await tourStepNext(page);
    }
    eq(titles.map((t, i) => MAIN_TITLES[i] === "" ? "" : t), MAIN_TITLES, "the steps, in order");
    await tourNext(page);
    await tourGone(page);
    eq((await onboarding(page)).completed, ["main"], "completed");
    await ctx.close();
  });
}

await check("tour · keyboard and screen readers: labelled dialog, focus in it, → ← Tab, Esc gives focus back; reduced motion", async () => {
  const { ctx, page } = await open({ ...DESKTOP, reducedMotion: "reduce" }, "#/chronicle");
  await page.focus(".cc-actions button[aria-haspopup=dialog]");
  await page.keyboard.press("Enter");
  await page.waitForSelector("[data-dialog=help]");
  await page.locator(".cc-tourrow").first().focus();
  await page.keyboard.press("Enter");
  await tourAt(page, "Las secciones");
  const a11y = await page.evaluate(() => { const p = document.querySelector(".driver-popover"), skip = p.querySelector(".cc-tour-skip"); return { role: p.getAttribute("role"), name: document.getElementById(p.getAttribute("aria-labelledby")).textContent, desc: !!document.getElementById(p.getAttribute("aria-describedby")), skip: [skip.textContent, skip.getAttribute("aria-label")], focus: document.activeElement.textContent.trim(), lang: p.getAttribute("lang"), progress: p.querySelector(".driver-popover-progress-text").textContent, bar: p.querySelector(".cc-tour-bar").getAttribute("aria-hidden"), motion: document.body.className }; });
  eq(a11y, { role: "dialog", name: "Las secciones", desc: true, skip: ["Omitir tutorial", null], focus: "Siguiente", lang: "es-AR", progress: "Paso 1 de 8", bar: "true", motion: a11y.motion }, "labelled dialog, focus on its main button, visible names");
  assert(/driver-simple/.test(a11y.motion) && !/driver-fade/.test(a11y.motion), "no animation with reduced motion");
  const ring = await page.evaluate(() => getComputedStyle(document.querySelector(".driver-active-element")).outlineStyle);
  eq(ring, "solid", "the highlighted control has a visible ring");
  await page.keyboard.press("ArrowRight");
  await tourAt(page, "La Crónica");
  await page.keyboard.press("ArrowLeft");
  await tourAt(page, "Las secciones");
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

await check("tour · language: a first visit in English is welcomed and guided in English; switching language re-reads the step", async () => {
  const ctx = await browser.newContext(DESKTOP);
  await ctx.addInitScript(() => { try { localStorage.setItem("chronicle-lang", "en"); } catch (e) {} });
  const page = await ctx.newPage();
  page.on("pageerror", e => errors.push(`tour lang: ${e.message}`));
  await page.goto(BASE + "#/chronicle");
  await page.waitForSelector(".cc-welcome");
  const w = await WELCOME(page);
  eq([w.name, w.buttons], ["Exandria Chronicle", ["Start the tour", "Not now"]], "English welcome");
  assert(w.text.includes("8 steps") && w.text.includes("Discover Bund Der Vier's adventures"), "English text");
  await page.click(".cc-welcome-go");
  let s = await tourAt(page, "The sections");
  eq([s.progress, s.next, s.skip], ["Step 1 of 8", "Next", "Skip tour"], "English controls");
  await tourNext(page);
  await tourAt(page, "The Chronicle");
  // The switch sits under the tour's dimmed layer; any language change re-reads the open step.
  await page.evaluate(() => document.querySelector(".cc-lang button[lang='es-AR']").click());
  s = await tourAt(page, "La Crónica");
  eq([s.progress, s.next, s.prev, s.skip], ["Paso 2 de 8", "Siguiente", "Anterior", "Omitir tutorial"], "the same step, now in Spanish — no mixed labels");
  await page.keyboard.press("Escape");
  await tourGone(page);
  await ctx.close();
});

await check("onboarding · a campaign without sessions or events: the tour still explains every section and points at nothing that is not there", async () => {
  const empty = await startServer({ rewrite: (rel, text) => (rel === "data/sessions.json" ? "{}" : rel === "data/events.json" ? "[]" : text) });
  const ctx = await browser.newContext(DESKTOP), page = await ctx.newPage();
  page.on("pageerror", e => errors.push(`empty campaign: ${e.message}`));
  await page.goto(empty.base + "#/chronicle");
  await page.waitForSelector(".cc-welcome", { timeout: 15000 });
  assert((await WELCOME(page)).text.includes("7 pasos"), "no located event: seven steps, said up front");
  await page.click(".cc-welcome-go");
  let s = await tourAt(page, "Las secciones");
  const seen = [];
  for (let i = 0; i < 9; i++) {
    await fits(page, 1280, 820, "empty campaign");
    seen.push([s.title, s.progress, s.active ? s.active.cls.split(" ")[0] : "", s.text]);
    if (s.next === "Finalizar") break;
    s = await tourStepNext(page);
  }
  eq(seen.map(x => x[0]), ["Las secciones", "La Crónica", "Sesiones", "Misiones", "El mapa", "Encontrá cualquier cosa", "¿Necesitás ayuda otra vez?"], "every section, none skipped");
  eq(seen.map(x => x[1]), [1, 2, 3, 4, 5, 6, 7].map(n => `Paso ${n} de 7`), "an honest count");
  eq(seen[2][2], "cc-sechead", "Sessions: its heading, not an invented session");
  assert(seen[2][3].includes("Todavía no hay sesiones registradas"), "and says so");
  assert(seen[4][3].includes("Todavía no hay acontecimientos ubicados en el mapa"), "the map says it is empty");
  await tourNext(page);
  await tourGone(page);
  await ctx.close();
  await empty.close();
});

await check("tour · map tutorial from the map's “¿Cómo funciona?”: waits for the lazy map, real marker, party lines, zoom; the map works after", async () => {
  const { ctx, page } = await open(DESKTOP, "#/map");
  await page.waitForSelector(".cc-maphelp");
  await page.click(".cc-maphelp");
  let s = await tourAt(page, "Los marcadores");
  eq(s.progress, "Paso 1 de 7", "seven steps");
  assert(/cc-marker/.test(s.active.cls), "a real marker");
  const titles = [s.title];
  while (s.title !== "Ya sabés usar el mapa" && titles.length < 10) { s = await tourStepNext(page); titles.push(s.title); await fits(page, 1280, 820, "map tour"); }
  ["Marcadores agrupados", "Las líneas punteadas", "Moverse por el mapa", "Ya sabés usar el mapa"].forEach(t => assert(titles.includes(t), `${t} in ${titles}`));
  eq([s.next, s.progress], ["Finalizar", "Paso 7 de 7"], "finish label");
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
  assert(await page.isVisible(".cc-maphelp"), "the map's help is there");
  await ctx.close();
});

await check("tour · search tutorial: open, try a real name, results, open one, its connections", async () => {
  const { ctx, page } = await open(DESKTOP, "#/quests");
  await page.click(".cc-actions button[aria-haspopup=dialog]");
  await page.locator(".cc-tourrow").nth(2).click();
  let s = await tourAt(page, "Encontrá cualquier cosa");
  eq(s.progress, "Paso 1 de 5", "five steps");
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
  eq(s.next, "Finalizar", "consistent finish label");
  await tourNext(page);
  await tourGone(page);
  eq(await page.evaluate(() => location.hash), "#/quests/character/sorfon", "it ends where the visitor got to");
  assert((await onboarding(page)).completed.includes("search"), "remembered");
  await ctx.close();
});

await check("help · centre: three tours with “Hecho”, answers that fold, every section explained; glossary tab; phone 320 from More", async () => {
  const ctx = await browser.newContext({ viewport: { width: 320, height: 640 }, hasTouch: true, isMobile: true });
  await ctx.addInitScript(() => { try { localStorage.setItem("chronicle-tour-version", "3"); localStorage.setItem("chronicle-tour-completed", "[\"main\"]"); } catch (e) {} });
  const page = await ctx.newPage();
  page.on("pageerror", e => errors.push(`help: ${e.message}`));
  await page.goto(BASE + "#/chronicle");
  await page.waitForSelector(".cc-card");
  await page.waitForTimeout(300);
  eq(await page.locator(".cc-welcome").count(), 0, "no welcome after the main tour");
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
  await ctx.addInitScript(() => { try { if (!sessionStorage.getItem("seeded")) { sessionStorage.setItem("seeded", "1"); localStorage.setItem("chronicle-tour-version", "3"); localStorage.setItem("chronicle-tour-invite", "dismissed");
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
  await ctx.addInitScript(() => { try { localStorage.setItem("chronicle-tour-version", "3"); localStorage.setItem("chronicle-tour-invite", "dismissed"); localStorage.setItem("chronicle-lang", "en"); } catch (e) {} });
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

// The tour helpers (TOUR, tourAt, tourGone…) are defined with the onboarding checks above.
await check("find · the main tour shows the real Sessions list and gives the Sessions and Quests searches back", async () => {
  const { ctx, page } = await open(DESKTOP, "#/sessions");
  await typeIn(page, sessionFind, "zzqq");                                          // a search that hides every session
  await page.evaluate(() => { location.hash = "#/quests"; });
  await typeIn(page, questFind, "Cassandra");
  await page.click(".cc-actions button[aria-haspopup=dialog]");
  await page.waitForSelector("[data-dialog=help]");
  await page.locator(".cc-tourrow").first().click();
  await tourAt(page, "Las secciones");
  const s = await tourNextTo(page, "Sesiones");
  assert(/cc-scard/.test(s.active.cls), `a real session, not the empty heading: ${s.active.cls}`);
  await page.click(".driver-popover .cc-tour-skip");
  await tourGone(page);
  await page.waitForTimeout(150);
  eq(await page.evaluate(() => location.hash), "#/quests", "back where it started");
  eq(await page.inputValue(questFind), "Cassandra", "the Quests search is back");
  await page.evaluate(() => { location.hash = "#/sessions"; });
  await page.waitForSelector(sessionFind);
  eq(await page.inputValue(sessionFind), "zzqq", "the Sessions search is back");
  await ctx.close();
});

await check("no console errors or page errors", async () => { eq(errors, [], "errors"); });

await browser.close();
server.close();
const failed = results.filter(r => r[0] === "FAIL");
console.log(`\n${results.length - failed.length}/${results.length} browser checks passed · screenshots in test-results/`);
process.exit(failed.length ? 1 : 0);
