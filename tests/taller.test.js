// The Taller del Cronista and the map editor as wired into the page: their interface strings (loaded only when the
// Taller opens, complete in both languages, no drift from the few keys index.html keeps), the routes, the lazy
// loading and the offline copy, and the isolation rules (local drafts only, data never rendered as HTML, no
// external host, no credentials). The data rules themselves are tests/editor.test.js; the real page is
// tests/browser/taller.mjs.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { Model, I18N, readText } = require("./helpers");

const lazy = { en: require("../locales/taller.en.js"), "es-AR": require("../locales/taller.es-AR.js") };
const html = readText("index.html"), ui = readText("js/chronicle-taller.js"), core = readText("js/chronicle-editor.js"), sw = readText("sw.js");
// The dictionaries as the Taller sees them: the main one with its own strings merged in (ChronicleI18n.extend).
const merged = code => I18N.extend(code, lazy[code]) && I18N.createTranslator(code);

test("1 · the Taller's strings: the same keys in both languages, none empty, plurals complete", () => {
  const en = I18N.keysOf(lazy.en), es = I18N.keysOf(lazy["es-AR"]);
  assert.deepEqual(es.slice().sort(), en.slice().sort());
  for (const code of ["en", "es-AR"]) for (const k of en) {
    const v = I18N.get(lazy[code], k);
    if (typeof v === "object") assert.ok(v.one && v.other, `${code} ${k}: plural forms`);
    else assert.ok(typeof v === "string" && v.trim(), `${code} ${k} is empty`);
  }
  // The few keys index.html itself shows stay in the main dictionaries — with the same words.
  for (const code of ["en", "es-AR"]) for (const k of ["taller.title", "taller.loading", "taller.loadError", "taller.helpLine", "mx.title", "mx.exit", "mx.pickMarker"])
    assert.equal(I18N.get(I18N.dicts[code], k), I18N.get(lazy[code], k), `${code} ${k}: no drift between the two files`);
});

test("2 · every string the Taller uses exists in both languages (static keys and every key family it builds)", () => {
  const used = new Set();
  for (const m of ui.matchAll(/["`]((?:taller|mx)\.[A-Za-z0-9_.-]+)["`]/g)) if (!m[1].includes("${")) used.add(m[1]);
  for (const m of ui.matchAll(/\bt\("((?:common|kinds|session|quest|place|eventType|questStatus|placeKind|personCategory|personCategoryOne)\.[\w.]+)"/g)) used.add(m[1]);
  const families = {
    "taller.kind.": ["session", "event", "quest", "character", "place"], "taller.kindLow.": ["session", "event", "quest", "character", "place"],
    "taller.what.": ["event", "quest", "place", "person", "character", "npc", "faction"],
    "taller.v.": ["required", "date", "sessionNumber", "sessionTaken", "sessionMissing", "sessionNoLog", "idFormat", "idTaken", "unknownRef", "notPc", "notFaction",
      "coordsPair", "coordsRange", "planarCoords", "cycle", "selfRef", "highlightsCount", "highlightOther", "noEnglish", "referenced", "color", "asset", "badValue",
      "integer", "number", "questSession", "plotQuestSession", "noKind"],
    "taller.new.": ["session", "event", "quest", "place", "npc", "sessionHint", "eventHint", "questHint", "placeHint", "npcHint"],
    "taller.tab.": ["home", "sessions", "events", "quests", "characters", "places", "map", "draft"],
    "taller.flow.": ["s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8"], "taller.status.": ["new", "modified", "deleted"],
    "taller.formSub.": ["session", "event", "quest", "character", "place"],
    "taller.backupReason.": ["open", "discard", "import-replace", "import-merge", "import-data", "restore", "conflict", "unreadable", "other-tab"],
    "taller.conflict.": ["taken", "removed", "changed"], "taller.diff.": ["field", "base", "mine", "published"],
    "taller.import.": ["notJson", "notDraft", "version", "tooLarge"], "taller.": ["importDraft", "importData", "importRestore"],
    "kinds.": ["event", "session", "quest", "character", "place", "partyMember"], "mx.": ["x", "y"],
    "eventType.": Object.keys(Model.EVENT_TYPES), "questStatus.": Object.keys(Model.QUEST_STATUS), "placeKind.": Object.keys(Model.PLACE_KINDS),
    "personCategory.": Object.keys(Model.PERSON_CATEGORIES), "personCategoryOne.": ["person", "deity", "creature", "faction"],
  };
  Object.entries(families).forEach(([p, ks]) => ks.forEach(k => used.add(p + k)));
  // Field labels: every field a form or a check can name (taller.f.<key>).
  const fieldKeys = [...ui.matchAll(/t\("taller\.f\.(\w+)"\)/g)].map(m => m[1]);
  ["no", "id", "title", "summary", "name", "session", "playedOn", "type", "campaignDay", "order", "locationId", "position", "characterIds", "npcIds", "questIds",
    "relatedEventIds", "status", "giverId", "sessions", "questCharacters", "kind", "parentId", "mapPrecision", "category", "color", "sealImg", "factionIds",
    "relations", "highlights", "plotName", "plotQuest", "plots", "igStart", "igEnd", "igRest", "recapSummary", "effects", "description", "consequences", "unresolved",
    "aliases", "race", "role", "giver", "objectives", "startedHere", "endedHere", "igDate", "igLabel"].concat(fieldKeys).forEach(k => used.add("taller.f." + k));
  for (const code of ["en", "es-AR"]) {
    const t = merged(code), d = I18N.dicts[code];
    const missing = [...used].filter(k => I18N.get(d, k) === undefined);
    assert.deepEqual(missing, [], `${code}: missing`);
    assert.equal(t("taller.v.required", { field: "X" }).includes("X"), true);
  }
  assert.ok(used.size > 400, `found ${used.size} keys`);
});

test("3 · the issue codes of js/chronicle-editor.js all have a message", () => {
  const codes = new Set([...core.matchAll(/\b[EW]\(kind, id, [^,]+, "(\w+)"/g)].map(m => m[1]));
  assert.ok(codes.size >= 20, `found ${codes.size} codes`);
  for (const code of ["en", "es-AR"]) codes.forEach(c => assert.ok(I18N.get(lazy[code], `taller.v.${c}`), `${code}: taller.v.${c}`));
});

test("4 · routes: #/taller/… and the map editor never open the public reading pane, history or favourites", () => {
  const fn = html.slice(html.indexOf("function parseHash(hash){"), html.indexOf("const routeHash"));
  const consts = ["SECTION_IDS", "KINDS", "MAP_KINDS", "TALLER_KINDS"];
  const parseHash = new Function(...consts, `${fn}; return parseHash;`)(
    ["chronicle", "sessions", "quests", "characters", "places", "map", "saved", "taller"],
    { event: 1, session: 1, quest: 1, character: 1, place: 1, recap: 1 }, { at: 1, near: 1, edit: 1, editplace: 1 },
    { tab: 1, session: 1, event: 1, quest: 1, character: 1, place: 1 });
  assert.deepEqual(parseHash("#/taller"), { section: "taller", kind: null, id: null });
  assert.deepEqual(parseHash("#/taller/tab/draft"), { section: "taller", kind: "tab", id: "draft" });
  assert.deepEqual(parseHash("#/taller/event/s13_01"), { section: "taller", kind: "event", id: "s13_01" });
  assert.deepEqual(parseHash("#/taller/recap/12"), { section: "taller", kind: null, id: null }, "only the Taller's own kinds");
  assert.deepEqual(parseHash("#/map/edit"), { section: "map", kind: "edit", id: null }, "the editor's list");
  assert.deepEqual(parseHash("#/map/edit/s1_01"), { section: "map", kind: "edit", id: "s1_01" });
  assert.deepEqual(parseHash("#/map/editplace/emon"), { section: "map", kind: "editplace", id: "emon" });
  assert.deepEqual(parseHash("#/map/near/emon"), { section: "map", kind: "near", id: "emon" });
  assert.deepEqual(parseHash("#/chronicle/edit/s1_01"), { section: "chronicle", kind: null, id: null }, "map kinds stay on the map");
  assert.match(html, /const routeHash = r => "#\/"\+r\.section\+\(r\.kind\?`\/\$\{r\.kind\}`\+\(r\.id!=null\?`\/\$\{enc\(r\.id\)\}`:""\):""\);/);
  assert.match(html, /const isEntryRoute = r => r\.section!=="taller"&&!!r\.kind&&r\.kind in KINDS;/);
  assert.match(html, /if\(isEntryRoute\(r\)&&r\.kind in FAV_KINDS&&M\.resolveRef/, "Taller pages never enter the recently viewed");
  assert.match(html, /favRef=hasDetail&&d\.open&&!d\.notFound&&isEntryRoute\(r\)&&r\.kind in FAV_KINDS/, "no favourite star on a preview");
  assert.match(html, /\{ id:"taller",\s+icon:"quill", hidden:true \}/, "a hidden section: never a tab");
});

test("5 · loaded only when needed, kept offline after first use, never precached for every visitor", () => {
  const head = html.slice(0, html.indexOf("</head>"));
  assert.ok(!/chronicle-editor\.js|chronicle-taller\.js|taller\.(en|es-AR)\.js/.test(head), "no <script> tag for the Taller: the public page never downloads it");
  assert.match(html, /const TALLER_SCRIPTS = \["js\/chronicle-editor\.js",\.\.\.I18N\.LOCALES\.map\(l=>`locales\/taller\.\$\{l\.code\}\.js`\),"js\/chronicle-taller\.js"\];/);
  assert.match(html, /if\(r\.section==="taller"\|\|isMapEdit\(r\)\) this\._taller\(\);/, "a route change loads it");
  const pre = /const PRECACHE = \[([\s\S]*?)\];/.exec(sw)[1];
  assert.ok(!/chronicle-editor|chronicle-taller|taller\./.test(pre), "not precached");
  assert.match(sw, /return event\.respondWith\(networkFirst\(req\)\);/, "network first stores them on first use");
  assert.match(html, /addEventListener\("beforeunload",this\._onBeforeUnload\)/, "closing the page asks while work is not safely stored");
});

test("6 · isolation: drafts in IndexedDB only, imported data never rendered as HTML, no external host, no credentials", () => {
  for (const [name, src] of [["chronicle-taller.js", ui], ["chronicle-editor.js", core]]) {
    const code = src.replace(/^\s*\/\/.*$/gm, "");
    assert.ok(!/localStorage|sessionStorage|document\.cookie/.test(code), `${name}: no localStorage/cookies (drafts live in IndexedDB)`);
    assert.ok(!/innerHTML|dangerouslySetInnerHTML|outerHTML\s*=|insertAdjacentHTML|eval\(|new Function/.test(code), `${name}: no HTML or code from data`);
    assert.ok(!/https?:\/\//.test(code.replace(/"https?:\/\/[^"]*"/g, (m) => (/github|api|token/i.test(m) ? m : ""))), `${name}: no request to another host`);
    assert.ok(!/Authorization|Bearer |access_token|api\.github\.com|ghp_|github_pat_|type: "password"/i.test(code), `${name}: no credentials, no GitHub API`);
  }
  assert.match(core, /if \(k !== "__proto__" && k !== "constructor" && k !== "prototype"\)/, "imports are sanitized");
  assert.match(ui, /fetch\(path, \{ cache: "no-store" \}\)/, "the published data is re-read past every cache before exporting");
  assert.match(ui, /E\.CONTENT_PATH/, "…the Spanish file included (never exported without it)");
  assert.ok(!/indexedDB/.test(sw.replace(/^\s*\/\/.*$/gm, "")), "the service worker never touches the drafts");
});

test("7 · the preview is the public page itself, fed by the draft, its links inert", () => {
  assert.match(ui, /const saved = app\.model; app\.model = m;/, "the same view-model builders, on the draft's model");
  assert.match(ui, /finally \{ app\.model = saved; \}/, "…and the page's own model back afterwards");
  assert.match(html, /<div class="cc-doc" onClickCapture="\{\{ d\.onCapture \}\}">/);
  assert.match(html, /<sc-if value="\{\{ d\.previewNote \}\}"><p class="cc-preview-note" role="note">/);
  assert.match(ui, /if \(!el \|\| el\.closest\("\.cc-docbar"\)\) return;\n\s*e\.preventDefault\(\); e\.stopPropagation\(\);/);
});

test("8 · the map editor reads the pointer through the map's own box and leaves the public map alone", () => {
  assert.match(html, /<div style="\{\{ mp\.worldStyle \}\}" data-world="1">/);
  assert.match(ui, /const w = app\._vpEl && app\._vpEl\.querySelector\("\[data-world\]"\); return w \? w\.getBoundingClientRect\(\) : null;/);
  assert.match(ui, /E\.clientToPercent\(cx, cy, r\)/);
  assert.match(html, /const tl=isMapEdit\(r\)\?this\._tl:null;\s*\n\s*const evs=tl\?tl\.mapEvents\(\):this\._mapEvents\(\);/, "public pins unless the editor is open");
  assert.match(html, /const held=e=>!!\(e\.target&&e\.target\.closest&&e\.target\.closest\("\[data-nopan\],\[data-nodrag\]"\)\);/, "dragging the marker never pans the map");
  assert.match(ui, /"data-nodrag": "1"/);
});
