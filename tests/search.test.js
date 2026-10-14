// Universal search (ChronicleModel.searchAll): every kind of entry, grouped, ranked on one scale,
// bilingual and accent-insensitive — and the Chronicle's own search left as it was.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { Model, buildReal, ids } = require("./helpers");

const es = buildReal("es-AR"), en = buildReal("en");
const group = (r, kind) => (r.groups.find(g => g.kind === kind) || { items: [] }).items;
const idsOf = (r, kind) => group(r, kind).map(i => String(i.id));

test("1 · finds each kind of entry: events, sessions, characters, places, quests", () => {
  assert.ok(idsOf(Model.searchAll(es, "Locus baja del techo"), "event").includes("s12_01"), "event by its Spanish title");
  assert.deepEqual(idsOf(Model.searchAll(es, "sesión 12"), "session"), ["12"], "session by number");
  assert.ok(idsOf(Model.searchAll(es, "Consejos antes de la cacería"), "session").includes("12"), "session by its title");
  assert.equal(idsOf(Model.searchAll(es, "Mortis"), "character")[0], "mortis", "party member");
  assert.equal(idsOf(Model.searchAll(es, "Vasselheim"), "place")[0], "vasselheim", "place");
  assert.ok(idsOf(Model.searchAll(es, "Barûk-Kazad"), "quest").length > 0, "quest");
});

test("2 · results are grouped by kind, each group once, best matches first", () => {
  const r = Model.searchAll(es, "Mortis");
  const kinds = r.groups.map(g => g.kind);
  assert.equal(new Set(kinds).size, kinds.length, "one group per kind");
  assert.equal(kinds[0], "character", "the exact name leads");
  assert.equal(r.total, r.groups.reduce((n, g) => n + g.items.length, 0));
  for (const g of r.groups) for (let i = 1; i < g.items.length; i++) assert.ok(g.items[i - 1].score <= g.items[i].score, `${g.kind} sorted by relevance`);
  // Events whose title starts with the name come before events that only mention him.
  const evs = group(r, "event");
  assert.equal(evs[0].id, "s12_03");
  assert.ok(evs[0].score < evs[1].score);
});

test("3 · entries linked to a person are found from the person's name (events, quests, sessions)", () => {
  const r = Model.searchAll(es, "Mortis"), mortis = es.personById.get("mortis");
  assert.deepEqual(idsOf(r, "event").sort(), mortis.eventIds.slice().sort(), "his appearances");
  assert.ok(group(r, "quest").length > 0 && group(r, "quest").every(i => i.score === 5 || i.entity.title.includes("Mortis")), "quests through their links");
  const sessions = idsOf(r, "session").map(Number);
  assert.ok(sessions.length > 0 && sessions.every(n => mortis.sessionNos.includes(n)), "sessions he took part in");
});

test("4 · bilingual: the same entries whichever language the interface is in", () => {
  for (const m of [es, en]) {
    const a = Model.searchAll(m, "raven queen"), b = Model.searchAll(m, "reina cuervo");
    assert.deepEqual(idsOf(a, "character"), idsOf(b, "character"), m.locale);
    assert.deepEqual(idsOf(a, "event").sort(), idsOf(b, "event").sort(), m.locale);
    assert.ok(idsOf(a, "character").includes("raven-queen"));
  }
  assert.ok(idsOf(Model.searchAll(en, "Tienda de Gilmore"), "place").includes("gilmores-shop"), "Spanish name in the English interface");
  assert.ok(idsOf(Model.searchAll(es, "Gilmore's shop"), "place").includes("gilmores-shop"), "English name in the Spanish interface");
});

test("5 · accents and case do not matter (revelacion finds revelación)", () => {
  const plain = Model.searchAll(es, "revelacion"), accented = Model.searchAll(es, "Revelación"), upper = Model.searchAll(es, "REVELACIÓN");
  assert.ok(idsOf(plain, "event").length > 0);
  assert.deepEqual(idsOf(plain, "event"), idsOf(accented, "event"));
  assert.deepEqual(idsOf(plain, "event"), idsOf(upper, "event"));
  assert.deepEqual(idsOf(Model.searchAll(es, "baruk"), "quest"), idsOf(Model.searchAll(es, "Barûk"), "quest"));
});

test("6 · proper names: an alias or a part of the name is enough", () => {
  assert.ok(idsOf(Model.searchAll(es, "Pelor"), "character").includes("pelor"));
  const vax = es.people.find(p => p.aliasesEn.length);
  assert.ok(vax, "some person has an alias");
  assert.ok(idsOf(Model.searchAll(es, vax.aliasesEn[0]), "character").includes(vax.id), `alias "${vax.aliasesEn[0]}"`);
  assert.ok(Model.searchAll(es, "Vass").groups[0].items[0].score <= 2, "a name prefix ranks high");
});

test("7 · numbers: a session number means that session and its events, never stray digits", () => {
  for (const q of ["12", "s12", "sesion 12", "Sesión 12", "session 12"]) {
    const r = Model.searchAll(es, q);
    assert.deepEqual(idsOf(r, "session"), ["12"], q);
    assert.ok(group(r, "event").every(i => i.entity.session === 12) && group(r, "event").length === es.sessionByNo.get(12).eventIds.length, q);
  }
  // No session 39: a bare number is a campaign day.
  const d = Model.searchAll(es, "39");
  assert.ok(group(d, "event").length > 0 && group(d, "event").every(i => i.entity.campaignDay === 39));
  assert.deepEqual(Model.chronicleFilterFor(es, "s12"), { session: "12" });
  assert.deepEqual(Model.chronicleFilterFor(es, "  Mortis "), { text: "Mortis" });
});

test("8 · nothing found / nothing typed", () => {
  assert.deepEqual(Model.searchAll(es, "zzqqxx"), { query: "zzqqxx", total: 0, groups: [] });
  assert.equal(Model.searchAll(es, "").total, 0);
  assert.equal(Model.searchAll(es, "   ").groups.length, 0);
});

test("9 · the Chronicle's own search is unchanged: quick chips use names only, the filter finds the same events", () => {
  const quick = Model.search(es, "Mortis");
  assert.deepEqual(quick.people.map(p => p.id), ["mortis"]);
  assert.equal(quick.sessions.length, 0, "quick chips never match a session through its context");
  assert.ok(Model.search(es, "sesion 8").sessions.some(s => s.no === 8));
  // "See all in the Chronicle": the text filter returns exactly the search's events.
  for (const q of ["Mortis", "revelacion", "raven queen", "pelor"]) {
    const filtered = ids(Model.filterEvents(es, { ...Model.EMPTY_FILTERS, ...Model.chronicleFilterFor(es, q) })).sort();
    assert.deepEqual(idsOf(Model.searchAll(es, q), "event").sort(), filtered, q);
  }
});

test("10 · title highlighting is case- and accent-insensitive and maps back to the original text", () => {
  assert.deepEqual(Model.highlightRanges("Revelación de Ilión", "revelacion ilion"), [[0, 10], [14, 19]]);
  assert.deepEqual(Model.highlightRanges("Barûk-Kazad", "BARUK"), [[0, 5]]);
  assert.deepEqual(Model.highlightRanges("Mortis", "zzz"), []);
  assert.deepEqual(Model.highlightRanges("aaa", "a aa"), [[0, 2]], "overlapping words merge");
});

test("11 · ranking does not depend on the interface language", () => {
  for (const q of ["Mortis", "Vasselheim", "pelor", "12"]) {
    const a = Model.searchAll(es, q), b = Model.searchAll(en, q);
    assert.deepEqual(a.groups.map(g => [g.kind, g.items.map(i => String(i.id))]), b.groups.map(g => [g.kind, g.items.map(i => String(i.id))]), q);
  }
});
