// Optional narrative depth for events: description ("what happened"), consequences ("what changed")
// and unresolved ("what is still open") — all optional, translatable, never required, never invented.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { Model, I18N, PCS, campaign, ev, loadRealData, buildReal, ids } = require("./helpers");

const big = ev("big", ["mortis"], {
  type: "revelation", questIds: ["q1"],
  description: "A long account.\n\nIn two paragraphs.",
  consequences: ["The party knows the name.", "The temple is closed to them."],
  unresolved: ["Who sent the raven?", "Will the temple reopen?"],
});
const small = ev("small", ["ayante"], { type: "travel" });

test("1 · an important event carries description, consequences and unresolved", () => {
  const m = campaign([big, small]);
  const e = m.eventById.get("big");
  assert.equal(e.description, big.description);
  assert.deepEqual(e.consequences, big.consequences);
  assert.deepEqual(e.unresolved, big.unresolved);
  assert.equal(m.issues.length, 0);
});

test("2 · an event without the new fields keeps working (empty, never undefined)", () => {
  const e = campaign([small]).eventById.get("small");
  assert.equal(e.description, "");
  assert.deepEqual(e.consequences, []);
  assert.deepEqual(e.unresolved, []);
  // Every real event has no extra fields yet — and they all build exactly as before.
  const m = buildReal("es-AR");
  m.events.forEach(x => { assert.deepEqual(x.unresolved, []); assert.equal(typeof x.description, "string"); });
});

test("3 · relations are untouched by the new fields", () => {
  const plain = campaign([{ ...big, description: undefined, consequences: undefined, unresolved: undefined }, small]);
  const rich = campaign([big, small]);
  const shape = m => m.events.map(e => [e.id, e.characterIds, e.questIds, e.relatedIds, e.chronoIndex]);
  assert.deepEqual(shape(rich), shape(plain));
  assert.deepEqual(rich.questById.get("q1").eventIds, plain.questById.get("q1").eventIds);
});

test("4 · translations overlay each field; positional lists only when the length matches; fallback per field", () => {
  const translations = { "es-AR": { events: { big: {
    description: "Un relato largo.",
    consequences: ["El grupo sabe el nombre.", "El templo les está cerrado."],
    unresolved: ["¿Quién mandó el cuervo?"],                  // one entry for two English ones → English
  } } } };
  const m = Model.build({ characters: PCS, npcs: [], locations: [], routes: {}, sessions: { 1: {} }, quests: [{ id: "q1", title: "Q", sessions: [1] }], events: [big] },
    { locale: "es-AR", t: I18N.createTranslator("es-AR"), translations });
  const e = m.eventById.get("big");
  assert.equal(e.description, "Un relato largo.");
  assert.deepEqual(e.consequences, ["El grupo sabe el nombre.", "El templo les está cerrado."]);
  assert.deepEqual(e.unresolved, big.unresolved, "length mismatch → English");
  assert.ok(m.issues.some(i => /event "big" unresolved: has 1 entries/.test(i.msg)));
  // A description translated for an event that has none in English is never shown.
  const orphan = Model.checkTranslations({ events: [small] }, { events: { small: { description: "Nada" } } }, "es-AR");
  assert.ok(orphan.some(i => /description has no English source/.test(i.msg)));
});

test("5 · the new text is searchable in both languages", () => {
  const translations = { "es-AR": { events: { big: { unresolved: ["¿Quién mandó el cuervo?", "¿Reabrirá el templo?"] } } } };
  const m = Model.build({ characters: PCS, npcs: [], locations: [], routes: {}, sessions: { 1: {} }, quests: [{ id: "q1", title: "Q", sessions: [1] }], events: [big, small] },
    { locale: "en", translations });
  assert.deepEqual(ids(Model.filterEvents(m, { text: "raven" })), ["big"]);
  assert.deepEqual(ids(Model.filterEvents(m, { text: "cuervo" })), ["big"]);
  assert.deepEqual(ids(Model.filterEvents(m, { text: "temple is closed" })), ["big"]);
});

test("6 · malformed values are reported, never shown as garbage", () => {
  const m = campaign([ev("x", [], { description: 42, consequences: "Just one line", unresolved: ["ok", "", null] })]);
  const e = m.eventById.get("x");
  assert.equal(e.description, "");
  assert.deepEqual(e.consequences, ["Just one line"], "a lone string still reads as one item");
  assert.deepEqual(e.unresolved, ["ok"]);
  assert.ok(m.issues.some(i => /"description" must be text/.test(i.msg)));
  assert.ok(m.issues.some(i => /"consequences" should be a list/.test(i.msg)));
  assert.ok(m.issues.some(i => /"unresolved" has empty or non-text entries/.test(i.msg)));
});

test("7 · the real events.json keeps its ids and needs no change", () => {
  const raw = loadRealData();
  assert.ok(raw.events.every(e => e.unresolved === undefined), "nothing was filled in automatically");
  assert.deepEqual(ids(buildReal("en").events).sort(), raw.events.map(e => e.id).sort());
});
