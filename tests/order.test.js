// Default list orders — the Chronicle opens on the latest events, Sessions on the first session —
// and the rules behind them: numeric session order, stable narrative order inside a day, independent
// per-section preferences, and no dependence on the interface language or the filters.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { Model, campaign, ev, buildReal, ids } = require("./helpers");

const flat = groups => groups.flatMap(g => g.events.map(e => e.id));
const keys = groups => groups.map(g => g.key);

test("1 · defaults: Chronicle latest first, Sessions oldest first", () => {
  assert.deepEqual(Model.DEFAULT_ORDER, { chronicle: "desc", sessions: "asc" });
  assert.deepEqual(Model.sortOrders(null), { chronicle: "desc", sessions: "asc" });
  assert.deepEqual(Model.sortOrders({}), { chronicle: "desc", sessions: "asc" });
});

test("2 · an explicit saved choice wins, per section and independently", () => {
  assert.deepEqual(Model.sortOrders({ chronicleOrder: "asc" }), { chronicle: "asc", sessions: "asc" });
  assert.deepEqual(Model.sortOrders({ sessionsOrder: "desc" }), { chronicle: "desc", sessions: "desc" });
  assert.deepEqual(Model.sortOrders({ chronicleOrder: "asc", sessionsOrder: "desc" }), { chronicle: "asc", sessions: "desc" });
  assert.deepEqual(Model.sortOrders({ chronicleOrder: "sideways", sessionsOrder: 3 }), { chronicle: "desc", sessions: "asc" }, "junk is ignored");
});

test("3 · legacy prefs: only a choice the user must have made survives", () => {
  // The old app stored {groupBy, sortDesc, sessionsDesc} together whenever any of them changed.
  assert.deepEqual(Model.normalizePrefs({ groupBy: "session", sortDesc: false, sessionsDesc: false }), { groupBy: "session" });
  assert.deepEqual(Model.sortOrders({ sortDesc: false }), { chronicle: "desc", sessions: "asc" }, "an old default does not pin the Chronicle to oldest");
  assert.deepEqual(Model.normalizePrefs({ sessionsDesc: true }), { sessionsOrder: "desc" }, "latest-first sessions was explicit (old default: false)");
  assert.deepEqual(Model.normalizePrefs({ sessionsDesc: true, sessionsOrder: "asc" }), { sessionsOrder: "asc" }, "the new key wins");
  assert.deepEqual(Model.normalizePrefs("garbage"), {});
  assert.deepEqual(Model.normalizePrefs({ groupBy: "week" }), {});
});

test("4 · Chronicle latest first: newest day on top, each day still in narrative order", () => {
  const m = buildReal("es-AR");
  const desc = Model.chronicleGroups(m.events, { groupBy: "day", order: "desc" });
  const asc = Model.chronicleGroups(m.events, { groupBy: "day", order: "asc" });
  assert.equal(desc[0].key, `d${Math.max(...m.days)}`, "latest day first");
  assert.equal(desc[desc.length - 1].key, `d${Math.min(...m.days)}`, "first day last");
  assert.deepEqual(keys(desc), keys(asc).slice().reverse(), "groups reversed");
  desc.forEach(g => {
    const ci = g.events.map(e => e.chronoIndex);
    assert.deepEqual(ci, ci.slice().sort((a, b) => a - b), `${g.key} keeps its recorded order`);
    assert.deepEqual(ids(g.events), ids(asc.find(a => a.key === g.key).events), `${g.key}: same entries, same order`);
  });
  assert.deepEqual(flat(asc), ids(m.events), "oldest first = the chronological list");
  assert.equal(flat(desc).length, m.events.length, "nothing lost or duplicated");
});

test("5 · grouped by session: latest session first, numeric (10 after 8, 12 first)", () => {
  const m = buildReal("en");
  const desc = Model.chronicleGroups(m.events, { groupBy: "session", order: "desc" });
  const nos = desc.map(g => Number(g.key.slice(1)));
  assert.deepEqual(nos, nos.slice().sort((a, b) => b - a));
  assert.equal(nos[0], Math.max(...m.sessions.map(s => s.no)));
});

test("6 · same-day ties: recorded `order`, then file order — stable in both directions", () => {
  const m = campaign([
    ev("late", [], { campaignDay: 5, order: 3 }),
    ev("early", [], { campaignDay: 5, order: 1 }),
    ev("filed-1", [], { campaignDay: 5 }),          // no order → file position (2) decides
    ev("other-day", [], { campaignDay: 4 }),
  ]);
  for (const order of ["asc", "desc"]) {
    const d5 = Model.chronicleGroups(m.events, { order }).find(g => g.key === "d5");
    assert.deepEqual(ids(d5.events), ["early", "filed-1", "late"], order);
  }
  assert.deepEqual(keys(Model.chronicleGroups(m.events, { order: "desc" })), ["d5", "d4"]);
});

test("7 · undated events stay last in both orders", () => {
  const m = campaign([ev("dated", [], { campaignDay: 2 }), ev("undated", [], { campaignDay: undefined, session: 2 }), ev("dated2", [], { campaignDay: 3 })]);
  for (const order of ["asc", "desc"]) {
    const k = keys(Model.chronicleGroups(m.events, { order }));
    assert.equal(k[k.length - 1], "d?", order);
  }
});

test("8 · the interface language never changes the order", () => {
  const es = buildReal("es-AR"), en = buildReal("en");
  for (const groupBy of ["day", "session"]) for (const order of ["asc", "desc"])
    assert.deepEqual(flat(Model.chronicleGroups(es.events, { groupBy, order })), flat(Model.chronicleGroups(en.events, { groupBy, order })), `${groupBy}/${order}`);
  assert.deepEqual(Model.sessionListItems(es, { order: "desc" }).map(i => i.gap ? `gap${i.from}` : i.session.no),
    Model.sessionListItems(en, { order: "desc" }).map(i => i.gap ? `gap${i.from}` : i.session.no));
});

test("9 · filters and order are independent: same entries either way", () => {
  const m = buildReal("es-AR");
  for (const f of [{ pcs: ["mortis"] }, { type: "vision" }, { text: "pelor" }, { quest: "cassandra" }]) {
    const evs = Model.filterEvents(m, f);
    const asc = flat(Model.chronicleGroups(evs, { order: "asc" })), desc = flat(Model.chronicleGroups(evs, { order: "desc" }));
    assert.deepEqual(asc.slice().sort(), desc.slice().sort(), JSON.stringify(f));
    assert.deepEqual(asc, ids(evs), `${JSON.stringify(f)}: oldest first is the filtered chronology`);
  }
});

test("10 · Sessions oldest first: numeric order with gap markers; latest first reverses it", () => {
  const m = Model.build({
    characters: [], npcs: [], locations: [], routes: {}, quests: [], events: [],
    sessions: { "10": { title: "Ten" }, "2": { title: "Two" }, "1": { title: "One" }, "9": { title: "Nine" }, "12": { title: "Twelve" } },
  });
  const show = order => Model.sessionListItems(m, { order }).map(i => i.gap ? `gap ${i.from}-${i.to}` : i.session.no);
  assert.deepEqual(show("asc"), [1, 2, "gap 3-8", 9, 10, "gap 11-11", 12], "never 1, 10, 12, 2, 9");
  assert.deepEqual(show("desc"), [12, "gap 11-11", 10, 9, "gap 3-8", 2, 1]);
  assert.deepEqual(show(undefined), show("asc"), "default");
});
