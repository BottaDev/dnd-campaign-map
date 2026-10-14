// Dashed lines = recorded journeys from routes.json, per character; never derived from events.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { Model, MapL, campaign, ev, loadRealData, readJson } = require("./helpers");

const A = { xp: 10, yp: 10 }, B = { xp: 20, yp: 20 }, C = { xp: 30, yp: 30 }, D = { xp: 40, yp: 40 };
const coords = pts => pts.map(p => [p.xp, p.yp]);
const withRoutes = (routes, events) => campaign(events || [], { routes });
const layers = (m, ids) => MapL.routeLayers(m, ids);

test("1 · route A → B → C is one polyline in recorded order", () => {
  const m = withRoutes({ mortis: [A, B, C] });
  const l = layers(m, ["mortis"]);
  assert.equal(l.shared.length, 0);
  assert.deepEqual(l.individual.map(x => coords(x.points)), [[[10, 10], [20, 20], [30, 30]]]);
});

test("2 · revisits stay: A → B → A → C keeps the second visit to A", () => {
  const m = withRoutes({ mortis: [A, B, A, C] });
  assert.deepEqual(coords(layers(m, ["mortis"]).individual[0].points), [[10, 10], [20, 20], [10, 10], [30, 30]]);
});

test("2b · only accidental consecutive duplicates are dropped", () => {
  const m = withRoutes({ mortis: [A, A, B, B, A] });
  assert.deepEqual(coords(layers(m, ["mortis"]).individual[0].points), [[10, 10], [20, 20], [10, 10]]);
});

test("3 · two characters with independent routes are never mixed", () => {
  const m = withRoutes({ mortis: [A, B], sorfon: [C, D] });
  const l = layers(m, ["mortis", "sorfon"]);
  assert.equal(l.shared.length, 0);
  assert.deepEqual(l.individual.map(x => [x.characterId, coords(x.points)]),
    [["mortis", [[10, 10], [20, 20]]], ["sorfon", [[30, 30], [40, 40]]]]);
});

test("4 · a recorded shared leg is drawn once; own stretches stay individual", () => {
  const leg = p => ({ ...p, leg: "boat" });
  const m = withRoutes({
    mortis: [A, leg(B), leg(C)],                         // walks A → B alone, then sails B → C with Sorfon
    sorfon: [{ xp: 20.2, yp: 20.2, leg: "boat" }, { xp: 30.2, yp: 30.2, leg: "boat" }, D],
  });
  const both = layers(m, ["mortis", "sorfon"]);
  assert.equal(both.shared.length, 1, "one shared line, not two");
  assert.deepEqual(both.shared[0].memberIds, ["mortis", "sorfon"]);
  assert.deepEqual(coords(both.shared[0].points), [[20, 20], [30, 30]], "drawn with its first member's waypoints");
  assert.deepEqual(both.individual.map(x => [x.characterId, coords(x.points)]),
    [["mortis", [[10, 10], [20, 20]]], ["sorfon", [[30.2, 30.2], [40, 40]]]]);
  // Alone, a character's leg is just part of their own route.
  const solo = layers(m, ["sorfon"]);
  assert.equal(solo.shared.length, 0);
  assert.deepEqual(coords(solo.individual[0].points), [[20.2, 20.2], [30.2, 30.2], [40, 40]]);
});

test("4b · togetherness is never inferred from coordinates", () => {
  const m = withRoutes({ mortis: [A, B], sorfon: [A, B] });   // identical paths, no leg id
  const l = layers(m, ["mortis", "sorfon"]);
  assert.equal(l.shared.length, 0);
  assert.equal(l.individual.length, 2);
});

test("5 · changing the selection changes which routes are drawn", () => {
  const m = withRoutes({ mortis: [A, B], sorfon: [C, D], ayante: [A, D] });
  assert.deepEqual(layers(m, ["sorfon"]).individual.map(x => x.characterId), ["sorfon"]);
  assert.deepEqual(layers(m, ["sorfon", "ayante"]).individual.map(x => x.characterId), ["ayante", "sorfon"]);
  assert.deepEqual(layers(m, []).individual, []);
});

test("6 · break: true starts an independent segment (no line across the gap)", () => {
  const m = withRoutes({ mortis: [A, B, { ...C, break: true }, D] });
  assert.deepEqual(layers(m, ["mortis"]).individual.map(x => coords(x.points)), [[[10, 10], [20, 20]], [[30, 30], [40, 40]]]);
});

test("7 · characters and events without routes draw nothing", () => {
  const m = withRoutes({}, [ev("e1", ["mortis"], { xp: 10, yp: 10 }), ev("e2", ["mortis"], { xp: 80, yp: 80 })]);
  assert.deepEqual(layers(m, ["mortis", "sorfon"]), { shared: [], individual: [] });
  const one = withRoutes({ mortis: [A] });
  assert.deepEqual(layers(one, ["mortis"]).individual, [], "a single waypoint is not a journey");
});

test("8 · incomplete data breaks the route instead of bridging it", () => {
  const m = withRoutes({ mortis: [A, B, { xp: 25 }, C, D, { xp: 140, yp: 5 }, A], ghost: [A, B], sorfon: "nope" });
  assert.deepEqual(layers(m, ["mortis"]).individual.map(x => coords(x.points)), [[[10, 10], [20, 20]], [[30, 30], [40, 40]]]);
  const msgs = m.issues.map(i => i.msg).join("\n");
  assert.match(msgs, /invalid waypoint/);
  assert.match(msgs, /unknown character "ghost"/);
  assert.match(msgs, /must be an array/);
});

test("9 · narrative filters never create connections", () => {
  const events = [ev("emon", ["mortis"], { xp: 42, yp: 39, questIds: ["q1"] }), ev("vassel", ["mortis"], { xp: 30, yp: 26, questIds: ["q2"] })];
  const m = withRoutes({ mortis: [A, B] }, events);
  // Routes depend only on the party selection, which quest/type/text filters do not touch.
  for (const f of [{}, { quest: "q1" }, { quest: "q2" }, { text: "emon" }, { type: "combat" }]) {
    const sel = Model.selectedCharacterIds(m, f.pcs);
    assert.deepEqual(layers(m, sel).individual.map(x => coords(x.points)), [[[10, 10], [20, 20]]], JSON.stringify(f));
  }
  const all = layers(m, ["mortis"]).individual.flatMap(x => coords(x.points));
  assert.ok(!all.some(([x, y]) => (x === 42 && y === 39) || (x === 30 && y === 26)), "event pins are not route points");
});

test("10 · coordinates and order are preserved exactly (real routes.json)", () => {
  const raw = loadRealData(), m = Model.build(raw);
  for (const [id, pts] of Object.entries(readJson("data/routes.json"))) {
    const seg = m.routeById.get(id).segments.flat();
    assert.deepEqual(coords(seg), coords(pts), id);
  }
  // The recorded crossing is one shared leg for the four of them, drawn once.
  const l = MapL.routeLayers(m, m.pcs.map(p => p.id));
  assert.equal(l.shared.length, 1);
  assert.equal(l.individual.length, 0);
  assert.deepEqual(l.shared[0].memberIds, ["ayante", "ereldra", "mortis", "sorfon"]);
  // No line reaches Emon: the journey there (sessions 3–7) was never recorded.
  const emon = m.events.find(e => e.locationId === "emon");
  assert.ok(!l.shared[0].points.some(p => Math.hypot(p.xp - emon.xp, p.yp - emon.yp) < 2));
});
