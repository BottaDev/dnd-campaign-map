// Map markers: one pin per exact coordinate, zoom-dependent clusters for nearby pins,
// no event lost, original coordinates untouched.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { Model, MapL, campaign, ev, ids } = require("./helpers");

// A 375px-wide phone map: 3.75 px per 1 % horizontally, 2.5 px vertically (3:2 image).
const PHONE = { pxX: 3.75, pxY: 2.5, threshold: 42 };
const cluster = (evs, scale) => MapL.clusterSpots(MapL.groupSpots(evs), { ...PHONE, scale });
const allIds = markers => markers.flatMap(mk => ids(mk.events)).sort();

const m = campaign([
  ev("a1", ["mortis"], { xp: 30, yp: 26.3 }),
  ev("a2", ["sorfon"], { xp: 30, yp: 26.3 }),
  ev("b1", ["mortis"], { xp: 29.6, yp: 25.9 }),
  ev("c1", ["ayante"], { xp: 29.2, yp: 25.5 }),
  ev("far", ["ayante"], { xp: 70, yp: 60 }),
  ev("nopos", ["ayante"]),
  ev("half", ["ayante"], { xp: 10 }),
]);

test("1 · events with identical coordinates share one marker", () => {
  const spots = MapL.groupSpots(m.events);
  const s = spots.find(x => x.xp === 30 && x.yp === 26.3);
  assert.deepEqual(ids(s.events), ["a1", "a2"]);
});

test("2 · nearby (different) coordinates merge into a cluster at low zoom", () => {
  const mk = cluster(m.events, 1);
  const near = mk.find(x => x.isCluster);
  assert.ok(near, "cluster exists");
  assert.equal(near.spots.length, 3, "three distinct places, not one");
  assert.deepEqual(ids(near.events).sort(), ["a1", "a2", "b1", "c1"]);
  assert.equal(mk.find(x => ids(x.events).includes("far")).isCluster, false);
});

test("3 · markers separate as the zoom increases", () => {
  const counts = [1, 6, 20, 60].map(s => cluster(m.events, s).length);
  for (let i = 1; i < counts.length; i++) assert.ok(counts[i] >= counts[i - 1], counts.join(","));
  assert.equal(counts[counts.length - 1], 4, "at extreme zoom every distinct spot has its own marker");
  // No two markers ever overlap at the zoom they were computed for.
  for (const s of [1, 2, 4, 6]) {
    const mk = cluster(m.events, s);
    for (let i = 0; i < mk.length; i++) for (let j = i + 1; j < mk.length; j++)
      assert.ok(MapL.screenDist(mk[i], mk[j], s, PHONE.pxX, PHONE.pxY) >= PHONE.threshold, `scale ${s}`);
  }
});

test("4 · filters update the grouping", () => {
  const onlyMortis = Model.filterEvents(m, { pcs: ["mortis"] });
  const mk = cluster(onlyMortis, 1);
  assert.deepEqual(allIds(mk), ["a1", "b1"]);
  assert.ok(!mk.some(x => ids(x.events).includes("a2")), "a2 is Sorfon's only");
});

test("5 · every event of a grouped marker is reachable (list) and keeps its own coordinates", () => {
  const mk = cluster(m.events, 1);
  assert.deepEqual(allIds(mk), ["a1", "a2", "b1", "c1", "far"], "nothing lost, nothing duplicated");
  const near = mk.find(x => x.isCluster);
  near.events.forEach(e => assert.ok(m.eventById.get(e.id).xp === e.xp && m.eventById.get(e.id).yp === e.yp));
  // The cluster sits at the centroid for display only.
  assert.notDeepEqual([near.xp, near.yp], [30, 26.3]);
  assert.equal(m.eventById.get("a1").xp, 30);
  // Zooming in: either it separates fully, or the list remains the way in.
  const sep = MapL.separationScale(near, { ...PHONE, scale: 1, maxScale: 6 });
  assert.ok(sep && sep.scale > 1 && sep.scale <= 6);
  assert.equal(MapL.separationScale(near, { ...PHONE, scale: 6, maxScale: 6 }), null, "no zoom left");
});

test("6 · invalid or missing coordinates never break the map", () => {
  const bad = [...m.events, { id: "weird", hasCoords: true, xp: NaN, yp: 3 }, { id: "out", hasCoords: true, xp: 150, yp: 3 }, null];
  const spots = MapL.groupSpots(bad);
  const got = spots.flatMap(s => ids(s.events));
  assert.ok(!got.includes("nopos") && !got.includes("half") && !got.includes("weird") && !got.includes("out"));
  assert.doesNotThrow(() => cluster(bad, 1));
  assert.ok(m.issues.some(i => /incomplete map coordinates/.test(i.msg)));
});

test("popups stay inside the viewport horizontally", () => {
  assert.equal(MapL.clampShift(187, 280, 375, 10), 0);
  assert.equal(MapL.clampShift(20, 280, 375, 10), 130);         // near the left edge → pushed right
  assert.equal(MapL.clampShift(370, 280, 375, 10), -145);       // near the right edge → pushed left
  const left = 20 - 140 + MapL.clampShift(20, 280, 375, 10);
  assert.ok(left >= 10 && left + 280 <= 365);
});
