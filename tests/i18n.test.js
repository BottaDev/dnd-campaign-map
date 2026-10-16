// Interface + content translation: default language, persistence, fallback, bilingual
// accent-insensitive search, localized dates, and untouched ids/relations.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { Model, I18N, ROOT, buildReal, loadRealData, loadContent, ids } = require("./helpers");

const memStorage = () => { const s = {}; return { getItem: k => (k in s ? s[k] : null), setItem: (k, v) => { s[k] = String(v); }, _s: s }; };

test("1 · Spanish (es-AR) is the default language", () => {
  assert.equal(I18N.DEFAULT_LOCALE, "es-AR");
  assert.equal(I18N.loadLocale(memStorage()), "es-AR");
  assert.equal(I18N.loadLocale(null), "es-AR");
  assert.equal(I18N.loadLocale({ getItem: () => { throw new Error("blocked"); } }), "es-AR");
  assert.equal(I18N.resolveLocale("fr"), "es-AR");
});

test("2/3/4 · switching ES → EN → ES persists in localStorage", () => {
  const st = memStorage();
  I18N.saveLocale(st, "en");
  assert.equal(st._s[I18N.STORAGE_KEY], "en");
  assert.equal(I18N.loadLocale(st), "en");
  I18N.saveLocale(st, "es-AR");
  assert.equal(I18N.loadLocale(st), "es-AR");
  I18N.saveLocale(st, "xx");                                     // unknown codes are ignored
  assert.equal(I18N.loadLocale(st), "es-AR");
});

test("5 · the language is not part of the URL (index.html routes stay language-free)", () => {
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const def = /const routeHash = r => ([^\n]*)/.exec(html);
  assert.ok(def && /r\.section/.test(def[1]));
  assert.ok(!/lang/.test(def[1]), "routeHash never encodes the language");
  assert.match(html, /setLang\(code\)\{[\s\S]*?this\.setState\(\{lang:code\}\);/, "setLang only re-renders, it does not navigate");
});

test("6 · interface strings: both dictionaries have exactly the same keys, none empty", () => {
  const en = I18N.keysOf(I18N.dicts.en), es = I18N.keysOf(I18N.dicts["es-AR"]);
  assert.deepEqual(es.slice().sort(), en.slice().sort());
  for (const code of ["en", "es-AR"]) for (const k of en) {
    const v = I18N.get(I18N.dicts[code], k);
    if (Array.isArray(v)) assert.equal(v.length, 12, `${code} ${k}`);
    else if (typeof v === "object") { assert.ok(v.one && v.other, `${code} ${k} plural`); }
    else assert.ok(typeof v === "string" && v.trim(), `${code} ${k} is empty`);
  }
});

test("6b · every key used by index.html exists (no raw keys on screen)", () => {
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const used = new Set();
  for (const m of html.matchAll(/\{\{\s*t\.([\w.]+)\s*\}\}/g)) used.add(m[1]);
  for (const m of html.matchAll(/\bt\("([\w.]+)"/g)) used.add(m[1]);
  for (const m of html.matchAll(/\bthis\.t\("([\w.]+)"/g)) used.add(m[1]);
  const dyn = { "eventType.": Object.keys(Model.EVENT_TYPES), "personCategory.": Object.keys(Model.PERSON_CATEGORIES), "personCategoryOne.": Object.keys(Model.PERSON_CATEGORIES), "nav.": ["chronicle", "sessions", "quests", "characters", "places", "map"], "kinds.": ["event", "session", "quest", "character", "place"] };
  Object.entries(dyn).forEach(([p, ks]) => ks.forEach(k => used.add(p + k)));
  const missing = [...used].filter(k => I18N.get(I18N.dicts.en, k) === undefined || I18N.get(I18N.dicts["es-AR"], k) === undefined);
  assert.deepEqual(missing, []);
  assert.ok(used.size > 150, `found ${used.size} keys`);
});

test("6c · buttons and filters are translated", () => {
  const es = I18N.createTranslator("es-AR"), en = I18N.createTranslator("en");
  assert.equal(es("nav.quests"), "Misiones");
  assert.equal(en("nav.quests"), "Quests");
  assert.equal(es("chronicle.filters"), "Filtros");
  assert.equal(es("chronicle.filtersActive", { count: 1 }), "Filtros (1 activo)");
  assert.equal(es("chronicle.filtersActive", { count: 3 }), "Filtros (3 activos)");
  assert.equal(es("questStatus.active"), "En curso");
  assert.equal(es("map.showRoutes"), "Mostrar recorridos registrados");
});

test("7 · narrative content is shown in Spanish, the English original is kept", () => {
  const es = buildReal("es-AR"), en = buildReal("en"), raw = loadRealData();
  const s104 = id => [es.eventById.get(id), en.eventById.get(id)];
  const [e1, e2] = s104("s11_04");
  assert.equal(e2.title, raw.events.find(e => e.id === "s11_04").title);
  assert.notEqual(e1.title, e2.title);
  assert.equal(e1.titleEn, e2.title);
  assert.equal(es.sessionByNo.get(8).title, loadContent("es-AR").sessions["8"].title);
  assert.equal(es.questById.get("cassandra").title, loadContent("es-AR").quests.cassandra.title);
  assert.equal(es.eventById.get("s1_01").typeLabel, "Viaje");
  assert.equal(en.eventById.get("s1_01").typeLabel, "Journey");
  // The source files themselves are untouched English.
  assert.ok(/^[\x00-\x7F’—–…·]*$/.test(raw.events.map(e => e.title).join("")) || raw.events.every(e => !/[áéíóúñ]/.test(e.title)));
});

test("8 · missing translations fall back to English (never empty, never a key)", () => {
  const raw = loadRealData();
  const partial = { events: { s1_01: { title: "Llegada a Emon", summary: "" } }, sessions: { "8": { effects: ["solo uno"] } } };
  const m = Model.build(raw, { locale: "es-AR", t: I18N.createTranslator("es-AR"), translations: { "es-AR": partial } });
  const e = m.eventById.get("s1_01"), orig = raw.events.find(x => x.id === "s1_01");
  assert.equal(e.title, "Llegada a Emon");
  assert.equal(e.summary, orig.summary, "empty translated summary → English");
  assert.equal(m.eventById.get("s1_02").title, raw.events.find(x => x.id === "s1_02").title);
  assert.deepEqual(m.sessionByNo.get(8).effects, raw.sessions["8"].effects, "length mismatch → English array");
  assert.ok(m.issues.some(i => /session 8 effects/.test(i.msg)));
  const t = I18N.createTranslator("es-AR", { dicts: { "es-AR": { a: { b: "" } }, en: { a: { b: "Hello" } } } });
  assert.equal(t("a.b"), "Hello");
  assert.equal(t("does.not.exist"), "");
});

test("9 · search finds entries in either language", () => {
  for (const lang of ["es-AR", "en"]) {
    const m = buildReal(lang);
    const find = q => ids(Model.filterEvents(m, { text: q }));
    const rev = find("revelation");
    assert.ok(rev.length > 0, lang);
    assert.deepEqual(find("revelación"), rev, `${lang}: revelación`);
    assert.deepEqual(find("reina cuervo").sort(), find("raven queen").sort(), `${lang}: Raven Queen`);
    assert.ok(Model.search(m, "misiones de la reina").quests.length + Model.search(m, "reina cuervo").quests.length > 0);
    assert.ok(Model.search(m, "Tienda de Gilmore").places.some(p => p.id === "gilmores-shop"));
    assert.ok(Model.search(m, "Gilmore's shop").places.some(p => p.id === "gilmores-shop"));
    assert.ok(Model.search(m, "sesion 8").sessions.some(s => s.no === 8));
  }
});

test("10 · search ignores accents and case", () => {
  const m = buildReal("es-AR");
  const find = q => ids(Model.filterEvents(m, { text: q }));
  assert.deepEqual(find("revelacion"), find("Revelación"));
  assert.deepEqual(find("REVELACION"), find("revelación"));
  assert.equal(Model.fold("Ilión  ÉPICA"), "ilion epica");
  assert.ok(find("vision divina").length > 0, "translated category, no accent");
});

test("11 · dates are localized; chronological order does not depend on the language", () => {
  const es = buildReal("es-AR"), en = buildReal("en");
  assert.equal(es.sessionByNo.get(8).playedLabel, "25 jun 2026");
  assert.equal(en.sessionByNo.get(8).playedLabel, "25 Jun 2026");
  assert.equal(es.sessionByNo.get(8).playedOn, "2026-06-25");
  assert.match(es.sessionByNo.get(8).dayText, /^Días 32–35$/);
  assert.match(en.sessionByNo.get(8).dayText, /^Days 32–35$/);
  assert.deepEqual(ids(es.events), ids(en.events));
  assert.equal(es.eventById.get("s2_01").igDate, en.eventById.get("s2_01").igDate, "in-world dates are verbatim");
});

test("12 · ids and relations are identical in both languages", () => {
  const es = buildReal("es-AR"), en = buildReal("en");
  const shape = m => ({
    events: m.events.map(e => [e.id, e.session, e.campaignDay, e.xp, e.yp, e.locationId, e.characterIds, e.npcIds, e.questIds, e.relatedIds]),
    quests: m.quests.map(q => [q.id, q.status, q.eventIds, q.npcIds, q.placeIds, q.sessionNos]),
    people: m.people.map(p => [p.id, p.eventIds, p.questIds, p.placeIds, p.relations.map(r => r.id), p.notes.length]),
    places: m.places.map(p => [p.id, p.parentId, p.allEventIds, p.notes.length]),
    sessions: m.sessions.map(s => [s.no, s.eventIds, s.questIds, s.npcIds, s.activePlots.map(p => p.questId)]),
  });
  assert.deepEqual(shape(es), shape(en));
  // Session-log names still link by their English spelling while showing the Spanish one.
  const plot = es.sessionByNo.get(8).activePlots[1];
  const temple = plot.npcs.find(n => n.nameEn === "Temple of Pelor");
  assert.ok(temple && temple.name !== temple.nameEn);
  assert.deepEqual(es.resolveName(temple.nameEn), { type: "place", id: "temple-of-pelor" });
  assert.equal(es.issues.filter(i => i.level === "error").length, 0);
});

test("content translation file covers every event, session and quest", () => {
  const c = loadContent("es-AR"), raw = loadRealData();
  assert.deepEqual(Object.keys(c.events).sort(), raw.events.map(e => e.id).sort());
  assert.deepEqual(Object.keys(c.quests).sort(), raw.quests.map(q => q.id).sort());
  assert.deepEqual(Object.keys(c.sessions).sort(), Object.keys(raw.sessions).sort());
  assert.deepEqual(Model.checkTranslations(raw, c, "es-AR"), []);
});
