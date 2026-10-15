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
});

test("4 · one dark theme: no light tokens, no toggle, no theme strings", () => {
  for (const gone of ["theme-light", "theme-dark", "toggleTheme", "darkMode", "onThemeToggle", "t.theme.", "prefers-color-scheme"])
    assert.ok(!html.includes(gone), `index.html still mentions ${gone}`);
  assert.match(html, /<meta name="color-scheme" content="dark">/);
  assert.match(html, /<meta name="theme-color" content="#[0-9a-f]{6}">/);
  // The tour popover (.cc-tour, appended to <body> by Driver.js) shares the same dark tokens.
  assert.match(css, /\.cc-app,\.cc-tour\{color-scheme:dark;/);
  // The page is painted dark before any script runs (inline style in <head>, ahead of support.js).
  const head = html.slice(0, html.indexOf("</head>"));
  assert.ok(head.indexOf("background:#0c0a06") >= 0 && head.indexOf("background:#0c0a06") < head.indexOf("support.js"));
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
