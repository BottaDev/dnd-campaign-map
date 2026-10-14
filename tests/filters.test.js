// Party-member filtering: shared events use OR between the selected characters,
// never the first entry of characterIds; events without party members are consistent.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { Model, MapL, campaign, ev, ids } = require("./helpers");

const m = campaign([
  ev("solo", ["mortis"], { xp: 10, yp: 10, questIds: ["q1"] }),
  ev("pair", ["ayante", "sorfon"], { xp: 20, yp: 20, questIds: ["q1"] }),
  ev("trio", ["sorfon", "mortis", "ereldra"], { xp: 30, yp: 30, questIds: ["q2"] }),
  ev("none", [], { xp: 40, yp: 40 }),
  ev("missing", undefined, { xp: 50, yp: 50 }),
]);
const show = pcs => ids(Model.filterEvents(m, { pcs }));

test("1 · an event of a single character shows only with that character", () => {
  assert.ok(show(["mortis"]).includes("solo"));
  assert.ok(!show(["ayante"]).includes("solo"));
});

test("2 · an event shared by two characters shows with either of them", () => {
  assert.ok(show(["ayante"]).includes("pair"), "Ayante on, Sorfon off");
  assert.ok(show(["sorfon"]).includes("pair"), "Sorfon on, Ayante off — not just the first id");
  assert.equal(show(["ayante", "sorfon"]).filter(id => id === "pair").length, 1, "both on: once");
  assert.ok(!show(["mortis"]).includes("pair"), "neither on: hidden");
});

test("3 · an event shared by three characters shows with any of them", () => {
  for (const id of ["sorfon", "mortis", "ereldra"]) assert.ok(show([id]).includes("trio"), id);
  assert.ok(!show(["ayante"]).includes("trio"));
});

test("4 · events without party members (empty or missing characterIds)", () => {
  assert.deepEqual(Model.filterEvents(m, {}).length, 5, "no filter: everything, unassigned included");
  assert.ok(!show(["mortis"]).includes("none") && !show(["mortis"]).includes("missing"), "a selection hides them");
  assert.deepEqual(show([Model.NO_CHARACTER]).sort(), ["missing", "none"], "they can be picked on purpose");
  assert.ok(show(["mortis", Model.NO_CHARACTER]).includes("none"));
  assert.ok(m.hasUnassigned);
});

test("5 · activating a single character", () => {
  assert.deepEqual(show(["sorfon"]).sort(), ["pair", "trio"]);
});

test("6 · activating several characters (OR, no duplicates)", () => {
  assert.deepEqual(show(["ayante", "mortis"]).sort(), ["pair", "solo", "trio"]);
});

test("7 · switching every character off shows nothing character-bound", () => {
  // The map's "all rows off" state is [NO_ONE]; it is not the same as "no filter".
  let pcs = [];
  for (const id of ["ayante", "ereldra", "mortis", "sorfon", Model.NO_CHARACTER]) pcs = Model.toggleVisibleCharacter(m, pcs, id);
  assert.deepEqual(pcs, [Model.NO_ONE]);
  assert.deepEqual(show(pcs), []);
  // …and switching them all back on collapses to "no filter" again.
  for (const id of ["ayante", "ereldra", "mortis", "sorfon", Model.NO_CHARACTER]) pcs = Model.toggleVisibleCharacter(m, pcs, id);
  assert.deepEqual(pcs, []);
  assert.equal(show(pcs).length, 5);
});

test("7b · map rows: hiding one character keeps the events it shares", () => {
  const pcs = Model.toggleVisibleCharacter(m, [], "ayante");
  assert.ok(!pcs.includes("ayante"));
  const v = show(pcs);
  assert.ok(v.includes("pair"), "shared with Sorfon stays");
  assert.ok(v.includes("none"), "unassigned row is still on");
});

test("8 · the order of characterIds does not matter", () => {
  const a = campaign([ev("x", ["ayante", "sorfon"])]), b = campaign([ev("x", ["sorfon", "ayante"])]);
  for (const sel of [["ayante"], ["sorfon"], ["ayante", "sorfon"], ["mortis"]])
    assert.deepEqual(ids(Model.filterEvents(a, { pcs: sel })), ids(Model.filterEvents(b, { pcs: sel })), sel.join("+"));
});

test("9 · character and quest filters combine (AND across filters, OR within characters)", () => {
  assert.deepEqual(ids(Model.filterEvents(m, { pcs: ["sorfon"], quest: "q1" })), ["pair"]);
  assert.deepEqual(ids(Model.filterEvents(m, { pcs: ["sorfon", "mortis"], quest: "q2" })), ["trio"]);
  assert.deepEqual(ids(Model.filterEvents(m, { pcs: ["ayante"], quest: "q2" })), []);
});

test("10 · no duplicated markers for events with several characters", () => {
  const evs = Model.filterEvents(m, { pcs: ["ayante", "sorfon", "mortis", "ereldra"] });
  const spots = MapL.groupSpots(evs);
  const all = spots.flatMap(s => ids(s.events));
  assert.equal(all.length, new Set(all).size);
  assert.equal(all.length, evs.length);
  // Even a character listed twice in characterIds yields one event.
  const dup = campaign([ev("d", ["mortis", "mortis"], { xp: 5, yp: 5 })]);
  assert.deepEqual(dup.events[0].characterIds, ["mortis"]);
});

test("selectedCharacterIds follows the same filter (routes use it)", () => {
  assert.deepEqual(Model.selectedCharacterIds(m, []), ["ayante", "ereldra", "mortis", "sorfon"]);
  assert.deepEqual(Model.selectedCharacterIds(m, ["sorfon", "mortis"]), ["mortis", "sorfon"]);
  assert.deepEqual(Model.selectedCharacterIds(m, [Model.NO_ONE]), []);
});
