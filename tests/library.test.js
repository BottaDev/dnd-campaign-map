// Favourites + recently viewed (js/chronicle-library.js): localStorage only, references not copies,
// no duplicates, stale references pruned, corrupt or blocked storage handled.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../js/chronicle-library.js");
const { Model, buildReal } = require("./helpers");

const memStorage = (seed) => { const s = { ...(seed || {}) }; return { getItem: k => (k in s ? s[k] : null), setItem: (k, v) => { s[k] = String(v); }, removeItem: k => { delete s[k]; }, _s: s }; };
let clock = 1000;
const now = () => ++clock;
const keys = list => list.map(r => `${r.kind}:${r.id}`);

test("1 · add and remove favourites; toggle returns the new state", () => {
  const lib = L.createLibrary(memStorage(), { now });
  assert.equal(lib.toggleFavorite({ kind: "event", id: "s12_03" }), true);
  assert.equal(lib.addFavorite({ kind: "character", id: "mortis" }), true);
  assert.equal(lib.addFavorite({ kind: "character", id: "mortis" }), false, "no duplicates");
  assert.ok(lib.isFavorite({ kind: "event", id: "s12_03" }));
  assert.deepEqual(keys(lib.favorites()), ["character:mortis", "event:s12_03"], "newest first");
  assert.equal(lib.toggleFavorite({ kind: "event", id: "s12_03" }), false);
  assert.equal(lib.removeFavorite({ kind: "event", id: "s12_03" }), false, "already gone");
  assert.deepEqual(keys(lib.favorites()), ["character:mortis"]);
  // Sessions are referenced by number; numbers and strings are the same entry.
  lib.addFavorite({ kind: "session", id: 12 });
  assert.ok(lib.isFavorite({ kind: "session", id: "12" }));
});

test("2 · persisted in localStorage and read back by a new page", () => {
  const st = memStorage();
  const a = L.createLibrary(st, { now });
  a.addFavorite({ kind: "place", id: "vasselheim" });
  a.addRecent({ kind: "quest", id: "cassandra" });
  assert.ok(JSON.parse(st._s[L.FAV_KEY]).items.length === 1 && JSON.parse(st._s[L.FAV_KEY]).v === 1);
  const b = L.createLibrary(st, { now });
  assert.deepEqual(keys(b.favorites()), ["place:vasselheim"]);
  assert.deepEqual(keys(b.recent()), ["quest:cassandra"]);
  assert.equal(b.persistent, true);
});

test("3 · recently viewed: newest first, no duplicates, five shown, twenty kept", () => {
  const lib = L.createLibrary(memStorage(), { now });
  ["a", "b", "c"].forEach(id => lib.addRecent({ kind: "event", id }));
  assert.equal(lib.addRecent({ kind: "event", id: "c" }), false, "the same entry again is not a new row");
  lib.addRecent({ kind: "event", id: "a" });
  assert.deepEqual(keys(lib.recent()), ["event:a", "event:c", "event:b"], "reopening moves it to the top");
  for (let i = 0; i < 30; i++) lib.addRecent({ kind: "place", id: `p${i}` });
  assert.equal(lib.recent().length, L.SHOW_RECENT);
  assert.equal(lib.recent(100).length, L.MAX_RECENT);
  assert.equal(lib.recent()[0].id, "p29");
  lib.clearRecent();
  assert.deepEqual(lib.recent(), []);
});

test("4 · invalid references are dropped safely (prune against the real campaign)", () => {
  const m = buildReal("es-AR");
  const lib = L.createLibrary(memStorage(), { now });
  lib.addFavorite({ kind: "event", id: "s12_03" });
  lib.addFavorite({ kind: "character", id: "baxcazhak" });                 // an old, renamed id
  lib.addRecent({ kind: "session", id: 12 });
  lib.addRecent({ kind: "session", id: 4 });                                // never chronicled
  const removed = lib.prune(r => !!Model.resolveRef(m, r.kind, r.id));
  assert.equal(removed, 2);
  assert.deepEqual(keys(lib.favorites()), ["event:s12_03"]);
  assert.deepEqual(keys(lib.recent()), ["session:12"]);
  assert.equal(lib.prune(() => { throw new Error("boom"); }), 2, "a failing check drops the reference instead of crashing");
  assert.equal(Model.resolveRef(m, "event", "nope"), null);
  assert.equal(Model.resolveRef(m, "unknown-kind", "x"), null);
  assert.equal(Model.resolveRef(m, "session", "12").no, 12);
});

test("5 · corrupt, foreign or old-format storage starts clean (never throws)", () => {
  const st = memStorage({
    [L.FAV_KEY]: "{not json",
    [L.RECENT_KEY]: JSON.stringify([{ kind: "event", id: "a" }, { kind: "spell", id: "x" }, { kind: "event" }, "junk", { kind: "event", id: "a" }, { kind: "place", id: "b", at: "yesterday" }]),
  });
  const lib = L.createLibrary(st, { now });
  assert.deepEqual(lib.favorites(), []);
  assert.deepEqual(keys(lib.recent()), ["event:a", "place:b"], "bare arrays are read; unknown kinds, missing ids and duplicates skipped");
  assert.equal(lib.addFavorite({ kind: "dragon", id: "x" }), false);
  assert.equal(lib.addFavorite(null), false);
  assert.equal(lib.addRecent({ kind: "event", id: "" }), false);
});

test("6 · storage unavailable (blocked, private mode, quota): works in memory for the visit", () => {
  const blocked = { getItem: () => { throw new Error("SecurityError"); }, setItem: () => { throw new Error("SecurityError"); }, removeItem: () => {} };
  for (const st of [null, blocked]) {
    const lib = L.createLibrary(st, { now });
    assert.equal(lib.persistent, false);
    assert.equal(lib.addFavorite({ kind: "event", id: "s1_01" }), true);
    assert.ok(lib.isFavorite({ kind: "event", id: "s1_01" }));
    lib.addRecent({ kind: "event", id: "s1_01" });
    assert.equal(lib.recent().length, 1);
  }
  // Storage that fills up later: the lists keep working, and the library says it no longer persists.
  const st = memStorage(); let full = false;
  const flaky = { ...st, setItem: (k, v) => { if (full && k !== "chronicle-probe") throw new Error("QuotaExceeded"); st.setItem(k, v); } };
  const lib = L.createLibrary(flaky, { now });
  full = true;
  assert.equal(lib.addFavorite({ kind: "event", id: "x" }), true);
  assert.equal(lib.persistent, false);
});

test("7 · another tab's change is picked up by reload()", () => {
  const st = memStorage();
  const a = L.createLibrary(st, { now }), b = L.createLibrary(st, { now });
  a.addFavorite({ kind: "quest", id: "locus" });
  assert.equal(b.favorites().length, 0);
  b.reload();
  assert.deepEqual(keys(b.favorites()), ["quest:locus"]);
});
