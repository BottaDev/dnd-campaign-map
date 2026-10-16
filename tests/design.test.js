// The visual system's contracts, read from index.html: every event type has exactly one icon and a
// colour family with a token; every quest status has an icon and a tone; and there is one dark theme
// only — no light tokens, no toggle, no stored preference that could bring it back.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { Model, I18N, readText } = require("./helpers");

const html = readText("index.html");
const block = name => {
  const start = html.indexOf(`const ${name} = {`);
  assert.ok(start >= 0, `${name} is defined`);
  return html.slice(start, html.indexOf("\n};", start));
};
const keysOf = src => [...src.matchAll(/^\s{2}(\w+):/gm)].map(m => m[1]);
const css = html.slice(html.indexOf("<style>\n"), html.indexOf("</style>\n</helmet>"));

test("1 · every event type has its own icon (and no icon for a type that does not exist)", () => {
  const icons = keysOf(block("EVENT_ICON_SHAPES"));
  assert.deepEqual(icons.slice().sort(), Object.keys(Model.EVENT_TYPES).sort());
  // No two types share a drawing (the Quests section flag is shared on purpose with "quest milestone").
  const shapes = icons.map(k => block("EVENT_ICON_SHAPES").split("\n").find(l => l.trim().startsWith(`${k}:`)).replace(/^\s*\w+:\s*/, "").replace(/\/\/.*$/, "").trim());
  assert.equal(new Set(shapes).size, shapes.length, "each type is drawn differently");
});

test("1b · every kind of place has its own icon, plus a plain marker for a place without a known kind", () => {
  const icons = keysOf(block("PLACE_ICON_SHAPES"));
  assert.deepEqual(icons.slice().sort(), [...Object.keys(Model.PLACE_KINDS), "place"].sort());
  const shapes = icons.map(k => block("PLACE_ICON_SHAPES").split("\n").find(l => l.trim().startsWith(`${k}:`)).replace(/^\s*\w+:\s*/, "").replace(/\/\/.*$/, "").trim());
  assert.equal(new Set(shapes).size, shapes.length, "each kind is drawn differently");
  assert.match(html, /placeIcon\(pl\)\s+\{ return PLACE_ICONS\[pl&&pl\.kindKey\]\|\|PLACE_ICONS\.place; \}/);
  // Other planes take the arcane family's colour (a token), as "other plane" events do; the rest is gilt.
  assert.match(css, /\.cc-node-row\.is-planar \.cc-node-ico\{color:var\(--ev-arcane\);\}/);
});

test("2 · every event family has a colour token and a class; every type belongs to one", () => {
  const families = [...new Set(Object.values(Model.EVENT_TYPES).map(t => t.family))];
  assert.ok(families.length >= 5 && families.every(Boolean));
  for (const f of families) {
    assert.match(css, new RegExp(`--ev-${f}:#[0-9a-f]{6};`), `--ev-${f} token`);
    assert.match(css, new RegExp(`\\.ev-${f}\\{--ev:var\\(--ev-${f}\\);\\}`), `.ev-${f} class`);
  }
  const ev = Model.build({ characters: [], npcs: [], locations: [], routes: {}, quests: [], sessions: { 1: {} },
    events: [{ id: "a", session: 1, title: "A", summary: "", type: "combat" }, { id: "b", session: 1, title: "B", summary: "", type: "unheard-of" }] });
  assert.equal(ev.eventById.get("a").typeFamily, "conflict");
  assert.equal(ev.eventById.get("b").typeFamily, "neutral", "unknown types fall back to the neutral family");
});

test("3 · every quest status tone has an icon, a token and a class (never colour alone)", () => {
  const tones = [...new Set(Object.values(Model.QUEST_STATUS).map(s => s.tone)), "other"];
  const icons = keysOf(block("STATUS_ICON_SHAPES"));
  for (const t of tones) {
    assert.ok(icons.includes(t), `status icon for ${t}`);
    assert.match(css, new RegExp(`\\.tone-${t}\\{--tone:var\\(`), `.tone-${t}`);
  }
  assert.match(html, /badgeIcon:this\.statusIcon\(q\.statusTone\)/, "status chips carry their icon");
  // …on every quest card too, beside the title: the edge colour and the group heading never carry the status alone.
  assert.match(html, /<span class="cc-qcard-h"><span class="cc-ctitle">\{\{ q\.title \}\}<\/span><span class="\{\{ q\.badgeCls \}\}">\{\{ q\.badgeIcon \}\}\{\{ q\.badge \}\}<\/span><\/span>/, "quest cards carry their status badge");
  assert.match(html, /const card=q=>\(\{ \.\.\.this\.questRow\(q\),/, "built like every other quest row");
});

test("4 · one dark theme: no light tokens, no toggle, no theme strings", () => {
  for (const gone of ["theme-light", "theme-dark", "toggleTheme", "darkMode", "onThemeToggle", "t.theme.", "prefers-color-scheme"])
    assert.ok(!html.includes(gone), `index.html still mentions ${gone}`);
  assert.match(html, /<meta name="color-scheme" content="dark">/);
  assert.match(html, /<meta name="theme-color" content="#[0-9a-f]{6}">/);
  // The tour popover (.cc-tour, appended to <body> by Driver.js) shares the same dark tokens.
  assert.match(css, /\.cc-app,\.cc-tour\{color-scheme:dark;/);
  // The page is painted dark before any script runs (inline style in <head>, ahead of support.js) — the
  // same warm black as the desk under the pages (--app-bg), so nothing flashes when the app takes over.
  const head = html.slice(0, html.indexOf("</head>"));
  assert.ok(head.indexOf("background:#0e0d0c") >= 0 && head.indexOf("background:#0e0d0c") < head.indexOf("support.js"));
  assert.match(css, /--app-bg:radial-gradient\([^;]*#0e0d0c\);/);
  for (const code of ["en", "es-AR"]) assert.equal(I18N.dicts[code].theme, undefined, `${code}: no theme labels`);
  assert.ok(!/claro\/oscuro|light\/dark/i.test(JSON.stringify(I18N.dicts)), "the guide no longer mentions a light mode");
});

test("5 · an old light-mode preference is discarded on load", () => {
  assert.match(html, /localStorage\.removeItem\("chronicle-theme"\)/);
  assert.ok(!/Prefs\.get\("chronicle-theme"/.test(html), "the old key is never read");
});

test("6 · type filter options carry no decorative glyphs (labels only)", () => {
  assert.ok(!/ty\.glyph/.test(html));
});

// «Grimorio»: texture on the large, still surfaces only; the crimson ribbon only where something is open or saved.
const rules = [...css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(m => ({ sel: m[1].trim(), body: m[2] }));

test("7 · textures: paper and leather are small WebP files, used through tokens, precached, dropped when saving data", () => {
  const fs = require("fs"), path = require("path"), { ROOT } = require("./helpers");
  for (const f of ["paper", "leather"]) {
    const rel = `assets/textures/${f}.webp`, b = fs.readFileSync(path.join(ROOT, rel));
    assert.equal(b.toString("ascii", 0, 4) + b.toString("ascii", 8, 12), "RIFFWEBP", `${rel} is a WebP`);
    assert.ok(b.length < 160 * 1024, `${rel} is ${Math.round(b.length / 1024)} KB`);
    assert.ok(css.includes(`--${f}:url("${rel}")`), `--${f} token`);
    assert.ok(readText("sw.js").includes(`"${rel}"`), `${rel} is precached`);
  }
  assert.ok(css.includes("@media (prefers-reduced-data:reduce),(max-width:359px){ .cc-app,.cc-tour{--paper:none;--leather:none;} }"), "flat surfaces when saving data / smallest phones");
  // Never inside what you touch: buttons, inputs, chips, cards and plates stay flat.
  const textured = /var\(--(paper|leather|page-bg|panel-bg|popup-bg|bar-bg|float-bg)\)/;
  for (const sel of [".cc-btn", ".cc-input", ".cc-select", ".cc-chip", ".cc-pcchip", ".cc-seg", ".cc-card", ".cc-scard,.cc-qcard,.cc-pcard,.cc-row", ".cc-qa-i", ".cc-tourrow", ".cc-partyrow"]) {
    const r = rules.filter(x => x.sel === sel);
    assert.ok(r.length, `${sel} rule`);
    r.forEach(x => assert.ok(!textured.test(x.body), `${sel} stays flat`));
  }
  // The runtime rewrites every " camelCase=" in the <x-dc> markup, the stylesheet included: an SVG data URI
  // must use plain attributes (width/height, not viewBox).
  assert.ok(!/\s[a-z]+[A-Z][A-Za-z0-9]*\s*=/.test(css), "no camelCase attribute inside the stylesheet");
  // …and on the leather only the covers: the bars and the controls floating over the map.
  rules.filter(x => /var\(--(bar-bg|float-bg|leather)\)/.test(x.body) && !x.sel.startsWith(".cc-app,.cc-tour"))
    .forEach(x => assert.match(x.sel, /^\.cc-(top|bottom|mapbtn|zbtn)$/, `leather on ${x.sel}`));
});

test("8 · the reading ribbon marks a state (open, current, saved), never decoration", () => {
  const withRibbon = rules.filter(x => /var\(--ribbon\)/.test(x.body) && !x.sel.startsWith(".cc-app,.cc-tour"));
  assert.ok(withRibbon.length >= 4);
  withRibbon.forEach(x => assert.match(x.sel, /is-sel|is-on|is-entry|cc-minipin/, `ribbon on ${x.sel}`));
  assert.match(css, /--ribbon:#b8404c; --ribbon-text:#e5848c;/);
});

test("9 · the illuminated initial is decoration: the paragraph keeps its whole text, the capital has empty alt text", () => {
  assert.match(html, /<p class="\{\{ e\.leadCls \}\}" data-initial="\{\{ e\.initial \}\}">\{\{ e\.summary \}\}<\/p>/);
  assert.match(css, /\.cc-lead\.drop::before\{content:attr\(data-initial\) \/ "";/);
  assert.match(css, /@supports \(content:"x" \/ ""\)\{/, "without alt text for generated content, a plain drop cap");
  assert.match(html, /initial=\/\\p\{L\}\/u\.test\(first\)\?first:""/, "only a letter goes in the box");
});
