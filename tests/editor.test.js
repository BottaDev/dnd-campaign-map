// The editor core (js/chronicle-editor.js): map coordinates, position suggestions, drafts over the published data,
// bilingual pairs, conflicts, validation, export in each file's own layout, the ZIP, draft files and storage —
// plus the optional map position of places in the model and the validation shared with tools/validate-data.js.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const { Model, ROOT, PCS, loadRealData, loadContent, readText } = require("./helpers");
const E = require("../js/chronicle-editor.js");

// A small published campaign: two sessions, a place tree (with a plane), a quest, an NPC, events with and without positions.
const base0 = () => ({
  raw: {
    characters: PCS.map(p => ({ ...p })), routes: {},
    npcs: [{ id: "gilmore", name: "Gilmore", category: "person", race: "human" }, { id: "guild", name: "The Guild", category: "faction" }],
    locations: [
      { id: "land", name: "The Land", kind: "continent" },
      { id: "city", name: "The City", kind: "city", parentId: "land" },
      { id: "shop", name: "The Shop", kind: "site", parentId: "city" },
      { id: "keep", name: "The Keep", kind: "site", parentId: "city" },
      { id: "far", name: "Far Town", kind: "city", parentId: "land" },
      { id: "void", name: "The Void", kind: "plane" },
    ],
    quests: [{ id: "q1", title: "Quest one", status: "active", giver: "Gilmore", giverId: "gilmore", summary: "Find it.", sessions: [1, 2], characterIds: ["ayante"] }],
    sessions: { 1: { dateLabel: "Recorded 1 Jan 2026 · One", title: "One", playedOn: "2026-01-01", effects: ["Tired"], activePlots: [{ name: "Plot A", questId: "q1", qt: "Open.", notes: ["n1", "n2"] }], completedPlots: [] },
                2: { dateLabel: "Recorded 8 Jan 2026 · Two", title: "Two", playedOn: "2026-01-08" } },
    events: [
      { id: "s1_01", date: "2026-01-01", session: 1, campaignDay: 1, type: "travel", title: "Arrive", summary: "They arrive.", locationId: "city", xp: 40, yp: 40, characterIds: ["ayante"] },
      { id: "s1_02", date: "2026-01-01", session: 1, campaignDay: 1, type: "encounter", title: "Shop", summary: "At the shop.", locationId: "shop", xp: 41, yp: 41, characterIds: ["ayante"], npcIds: ["gilmore"], questIds: ["q1"] },
      { id: "s2_01", date: "2026-01-08", session: 2, campaignDay: 2, type: "combat", title: "Fight", summary: "A fight.", locationId: "shop", xp: 41, yp: 41, characterIds: ["mortis"] },
      { id: "s2_02", date: "2026-01-08", session: 2, campaignDay: 2, type: "dream", title: "Dream", summary: "A dream.", characterIds: ["mortis"] },
    ],
    lore: null,
  },
  content: { locale: "es-AR", events: { s1_01: { title: "Llegada", summary: "Llegan." } }, sessions: { 1: { title: "Uno", effects: ["Cansados"], activePlots: [{ name: "Trama A", notes: ["n1 es", "n2 es"] }] } },
    quests: { q1: { title: "Misión uno" } }, people: {}, places: { shop: { name: "La Tienda" } } },
});
const model = base => Model.build(E.applyDraft(base, E.emptyDraft(base)).raw);

// ── Coordinates ─────────────────────────────────────────────────────────────
test("coordinates · pointer ↔ percent through the map's on-screen box, at any zoom and pan", () => {
  for (const rect of [{ left: 0, top: 0, width: 1000 }, { left: 120, top: 64, width: 836 }, { left: -2400, top: -1900, width: 6000 }, { left: 37.5, top: -12.25, width: 393.7 }]) {
    for (const p of [{ xp: 0, yp: 0 }, { xp: 100, yp: 100 }, { xp: 42.3, yp: 39.51 }, { xp: 0.01, yp: 99.99 }, { xp: 63.07, yp: 12.5 }]) {
      const c = E.percentToClient(p, rect), back = E.clientToPercent(c.x, c.y, rect);
      assert.deepEqual([back.xp, back.yp], [p.xp, p.yp], `${JSON.stringify(rect)} ${JSON.stringify(p)}`);
      assert.equal(back.inside, true);
    }
  }
  // The height comes from the map's 3:2 ratio, not from a box that may not have laid out its image yet.
  const r = { left: 0, top: 0, width: 900 };
  assert.deepEqual(E.clientToPercent(450, 300, r), { xp: 50, yp: 50, inside: true });
  assert.equal(E.MAP_AR, 5400 / 8100);
  assert.equal(E.clientToPercent(10, 10, { left: 0, top: 0, width: 0 }), null, "no box, no position");
});

test("coordinates · the same point whatever the viewport does (MapViewport math: zoom about a point, pan, clamp)", () => {
  // index.html MapViewport: at scale s the world is vw·s wide, translated by (x, y); zoom keeps the point under the cursor.
  const vw = 1180, vh = 700, ar = 5400 / 8100;
  const zoom = (v, px, py, f) => { const s2 = Math.max(1, Math.min(6, v.scale * f)), k = s2 / v.scale; return { scale: s2, x: px - (px - v.x) * k, y: py - (py - v.y) * k }; };
  const target = { xp: 42.3, yp: 39.51 };
  const screenOf = v => ({ x: v.x + target.xp / 100 * vw * v.scale, y: v.y + target.yp / 100 * vw * ar * v.scale });
  let v = { scale: 1, x: 0, y: (vh - vw * ar) / 2 };
  for (const [f, px, py, dx, dy] of [[1.4, 300, 200, 0, 0], [1.4, 900, 500, -250, 40], [2, 590, 350, 133, -77], [1 / 1.4, 10, 10, 0, 0], [6, 400, 400, -999, -321]]) {
    v = zoom(v, px, py, f); v = { ...v, x: v.x + dx, y: v.y + dy };
    const s = screenOf(v), p = E.viewToPercent(s.x, s.y, v, vw);
    assert.deepEqual([p.xp, p.yp], [target.xp, target.yp], `scale ${v.scale.toFixed(3)}`);
  }
});

test("coordinates · clamped to the map, two decimals, steps of one screen pixel, the text to copy", () => {
  const r = { left: 100, top: 100, width: 800 };
  const out = E.clientToPercent(50, 1000, r);
  assert.deepEqual(out, { xp: 0, yp: 100, inside: false }, "off the map: the nearest edge");
  assert.deepEqual(E.clientToPercent(100 + 800 * 0.123456, 100, r), { xp: 12.35, yp: 0, inside: true });
  assert.deepEqual(E.nudge({ xp: 99.99, yp: 0.02 }, 0.05, -0.05), { xp: 100, yp: 0 });
  assert.deepEqual(E.pixelStep(1000), { x: 0.1, y: 0.15 });
  assert.deepEqual(E.pixelStep(100000), { x: 0.01, y: 0.01 }, "never under the stored precision");
  assert.equal(E.coordsText({ xp: 42.3, yp: 39.51 }), '{"xp": 42.30, "yp": 39.51}');
  assert.deepEqual(JSON.parse(E.coordsText({ xp: 7, yp: 100 })), { xp: 7, yp: 100 }, "valid JSON");
  for (const s of ['{"xp": 42.3, "yp": 39.51}', "42.3, 39.51", "xp 42.3 yp 39.51", "xp: 42,3 · yp: 39,51"]) assert.deepEqual(E.parseCoords(s), { xp: 42.3, yp: 39.51 }, s);
  assert.equal(E.parseCoords("101, 3"), null);
  assert.equal(E.parseCoords("nothing"), null);
});

// ── Places: their own map position (model) ──────────────────────────────────
test("places · an optional own position, exact or approximate, never for other planes; the map focus prefers it", () => {
  const b = base0();
  b.raw.locations[1] = { ...b.raw.locations[1], xp: 40.5, yp: 39.25, mapPrecision: "exact" };   // city
  b.raw.locations[4] = { ...b.raw.locations[4], xp: 70, yp: 20 };                                // far: no precision → approximate
  b.raw.locations[5] = { ...b.raw.locations[5], xp: 10, yp: 10 };                                // void: a plane
  b.raw.locations[2] = { ...b.raw.locations[2], xp: 5 };                                         // shop: half a position
  const m = Model.build(b.raw);
  assert.deepEqual(m.placeById.get("city").ref, { xp: 40.5, yp: 39.25, precision: "exact" });
  assert.equal(m.placeById.get("far").ref.precision, "approximate");
  assert.equal(m.placeById.get("void").ref, null);
  assert.equal(m.placeById.get("shop").ref, null);
  assert.ok(m.issues.some(i => /Place "void": another plane is not on the map/.test(i.msg)));
  assert.ok(m.issues.some(i => /Place "shop": incomplete map coordinates/.test(i.msg)));
  assert.deepEqual(m.placeById.get("city").mapPoint, { xp: 40.5, yp: 39.25, source: "ref", precision: "exact" });
  assert.deepEqual(m.placeById.get("keep").mapPoint, null, "nothing recorded there, nothing invented");
  assert.deepEqual(m.placeById.get("shop").mapPoint, { xp: 41, yp: 41, source: "event", eventId: "s1_02" }, "else its first located event");
  assert.equal(m.placeById.get("city").focusEventId, "s1_01", "events keep their own focus and positions");
  assert.equal(m.eventById.get("s1_01").xp, 40, "a place's position never moves an event");
  const bad = base0(); bad.raw.locations[1] = { ...bad.raw.locations[1], xp: 140, yp: 3, mapPrecision: "roughly" };
  const v = Model.validateData(bad.raw);
  assert.ok(v.issues.some(i => i.level === "error" && /Place "city": xp\/yp must be 0–100/.test(i.msg)));
  assert.ok(v.issues.some(i => /unknown mapPrecision "roughly"/.test(i.msg)));
});

test("validation · ChronicleModel.validateData holds the validator's rules (the real data passes clean)", () => {
  const raw = loadRealData();
  const v = Model.validateData(raw, { translations: { "es-AR": loadContent("es-AR") } });
  assert.deepEqual(v.issues, []);
  const broken = loadRealData();
  broken.events[0].xp = 120; broken.routes.sorfon[1].leg = 7;
  const w = Model.validateData(broken).issues.map(i => i.msg);
  assert.ok(w.some(m => /Event "s1_01": xp\/yp must be 0–100/.test(m)));
  assert.ok(w.some(m => /routes\.json\["sorfon"\]\[1\]: "leg" must be a non-empty string id/.test(m)));
  const src = readText("tools/validate-data.js");
  assert.match(src, /Model\.validateData\(raw, \{ translations \}\)/, "the validator runs the shared rules");
});

// ── Suggestions ─────────────────────────────────────────────────────────────
test("suggestions · the place's own position first, then its events, places inside, places around — or nothing", () => {
  const b = base0();
  let m = model(b);
  assert.deepEqual(E.suggestPosition(m, { locationId: "shop" }), { source: "events", placeId: "shop", precision: "approximate", point: { xp: 41, yp: 41 }, count: 2, sameCount: 2, eventIds: ["s1_02", "s2_01"] });
  assert.equal(E.suggestPosition(m, { locationId: "shop", excludeEventId: "s2_01" }).count, 1, "an event never suggests its own position");
  const land = E.suggestPosition(m, { locationId: "land" });
  assert.equal(land.source, "inside"); assert.equal(land.precision, "approximate");
  const keep = E.suggestPosition(m, { locationId: "keep" });
  assert.deepEqual([keep.source, keep.placeId], ["parent", "city"], "the city it lies in");
  assert.deepEqual(E.suggestPosition(m, { locationId: "void" }), { source: null, reason: "planar", placeId: "void" });
  assert.deepEqual(E.suggestPosition(m, { locationId: "" }), { source: null, reason: "noPlace" });
  assert.equal(E.suggestPosition(m, { locationId: "nowhere" }).reason, "unknownPlace");
  // A recorded reference wins and says how sure it is.
  b.raw.locations[3] = { ...b.raw.locations[3], xp: 44.44, yp: 40.04, mapPrecision: "exact" };
  m = model(b);
  assert.deepEqual(E.suggestPosition(m, { locationId: "keep" }), { source: "place", placeId: "keep", precision: "exact", point: { xp: 44.44, yp: 40.04 } });
  // Ties between equally used points go to the most recent event's point.
  b.raw.events.push({ id: "s2_03", session: 2, campaignDay: 3, title: "t", summary: "s", locationId: "city", xp: 39, yp: 39 });
  m = model(b);
  assert.deepEqual(E.suggestPosition(m, { locationId: "city" }).point, { xp: 39, yp: 39 });
  // Nothing anywhere up the tree.
  const empty = base0(); empty.raw.events = [];
  assert.deepEqual(E.suggestPosition(model(empty), { locationId: "far" }), { source: null, reason: "none", placeId: "far" });
});

// ── Drafts ──────────────────────────────────────────────────────────────────
test("drafts · a change keeps the published version it started from; back to published = no change", () => {
  const b = base0();
  let d = E.emptyDraft(b, "2026-10-18T00:00:00.000Z");
  assert.equal(d.format, E.DRAFT_FORMAT); assert.equal(d.rev, 0);
  const pub = E.publishedPair(b, "event", "s1_01");
  d = E.putRecord(d, b, "event", "s1_01", E.withText(pub, ["title"], "es", "Llegada a la ciudad"));
  assert.equal(E.statusOf(d, "event", "s1_01"), "modified");
  assert.deepEqual(d.changes.event.s1_01.base, pub);
  assert.equal(E.currentPair(d, b, "event", "s1_01").es.title, "Llegada a la ciudad");
  d = E.putRecord(d, b, "event", "s1_01", pub);
  assert.equal(E.statusOf(d, "event", "s1_01"), "published", "an edit undone leaves the draft");
  assert.equal(d.rev, 2);
  // New, deleted, reverted.
  d = E.putRecord(d, b, "quest", "q2", { en: { id: "q2", title: "Two", status: "pending" }, es: null });
  assert.equal(E.statusOf(d, "quest", "q2"), "new");
  d = E.deleteRecord(d, b, "quest", "q2");
  assert.equal(E.statusOf(d, "quest", "q2"), "published", "a new record deleted simply leaves");
  assert.equal(E.currentPair(d, b, "quest", "q2"), null);
  d = E.deleteRecord(d, b, "event", "s2_02");
  assert.equal(E.statusOf(d, "event", "s2_02"), "deleted");
  d = E.revertRecord(d, "event", "s2_02");
  assert.equal(E.statusOf(d, "event", "s2_02"), "published");
});

test("drafts · tidy records: empty fields removed unless published that way, published key order kept, new keys at their usual place", () => {
  const b = base0();
  b.raw.events[3].npcIds = [];                                                       // published with an empty list
  let d = E.emptyDraft(b);
  let p = E.publishedPair(b, "event", "s2_02");
  p = E.withField(p, ["locationId"], "keep");
  p = E.withField(p, ["questIds"], []);
  p = E.withField(p, ["npcIds"], []);
  d = E.putRecord(d, b, "event", "s2_02", p);
  const en = d.changes.event.s2_02.en;
  assert.deepEqual(Object.keys(en), ["id", "date", "session", "campaignDay", "type", "title", "summary", "locationId", "characterIds", "npcIds"]);
  assert.deepEqual(en.npcIds, [], "kept: the published record had it empty");
  assert.equal("questIds" in en, false, "an empty new field is not written");
});

test("pairs · lists stay aligned in both languages: add, remove, move, nested plot notes", () => {
  const b = base0();
  let p = E.publishedPair(b, "session", "1");
  assert.deepEqual(E.esList(p, ["effects"]), ["Cansados"]);
  p = E.withList(p, ["effects"], "add");
  assert.deepEqual([p.en.effects, p.es.effects], [["Tired", ""], ["Cansados", ""]]);
  p = E.withText(p, ["effects", 1], "es", "Heridos");
  p = E.withList(p, ["effects"], "move", 1, -1);
  assert.deepEqual([p.en.effects, p.es.effects], [["", "Tired"], ["Heridos", "Cansados"]]);
  p = E.withList(p, ["effects"], "remove", 1);
  assert.deepEqual([p.en.effects, p.es.effects], [[""], ["Heridos"]]);
  // Nested: a plot's notes.
  p = E.withList(p, ["activePlots", 0, "notes"], "add", 0);
  assert.deepEqual(p.en.activePlots[0].notes, ["", "n1", "n2"]);
  assert.deepEqual(p.es.activePlots[0].notes, ["", "n1 es", "n2 es"]);
  // A translation written where none existed creates the aligned list.
  let q = E.publishedPair(b, "quest", "q1");
  q = E.withList(q, ["objectives"], "add", null, "Find the door");
  q = E.withList(q, ["objectives"], "add");
  q = E.withText(q, ["objectives", 1], "es", "Abrirla");
  assert.deepEqual([q.en.objectives, q.es.objectives], [["Find the door", ""], ["", "Abrirla"]]);
  // A translation list that no longer lined up is dropped when the list is edited (the page ignored it).
  const r = { en: { effects: ["a", "b"] }, es: { effects: ["solo uno"] } };
  assert.equal(E.esList(r, ["effects"]), null);
  assert.equal(E.withList(r, ["effects"], "add").es.effects, undefined);
});

test("apply · untouched records stay as published; new events go after their session; deletions and translations applied", () => {
  const b = base0();
  let d = E.emptyDraft(b);
  d = E.putRecord(d, b, "session", "3", { en: { title: "Three", playedOn: "2026-01-15" }, es: { title: "Tres" } });
  d = E.putRecord(d, b, "event", "s1_03", { en: { id: "s1_03", session: 1, title: "Late", summary: "Later that day." }, es: null });
  d = E.putRecord(d, b, "event", "s3_01", { en: { id: "s3_01", session: 3, title: "", summary: "" }, es: { title: "Sólo en español", summary: "Resumen." } });
  d = E.deleteRecord(d, b, "event", "s2_02");
  const a = E.applyDraft(b, d);
  assert.deepEqual(a.raw.events.map(e => e.id), ["s1_01", "s1_02", "s1_03", "s2_01", "s3_01"]);
  assert.deepEqual(a.raw.events[0], b.raw.events[0], "untouched");
  assert.equal(a.raw.events[2].date, "2026-01-01", "a new event takes its session's play date (the files' convention)");
  assert.deepEqual([a.raw.events[4].title, a.raw.events[4].summary], ["Sólo en español", "Resumen."], "written only in Spanish: also the English text");
  assert.deepEqual(a.content.events.s3_01, { title: "Sólo en español", summary: "Resumen." });
  assert.equal(a.raw.sessions["3"].dateLabel, "Recorded 15 Jan 2026 · Three");
  assert.deepEqual(Object.keys(a.raw.sessions), ["1", "2", "3"]);
  assert.deepEqual(b.raw.events.length, 4, "the published data is never mutated");
  // A backfilled session's events go between their neighbours.
  let d2 = E.putRecord(E.emptyDraft(b), b, "event", "s1_09", { en: { id: "s1_09", session: 1, title: "x", summary: "y" }, es: null });
  assert.deepEqual(E.applyDraft(b, d2).raw.events.map(e => e.id).slice(0, 3), ["s1_01", "s1_02", "s1_09"]);
});

test("apply · empty list items dropped in both languages (positions aligned), texts trimmed, published key order kept", () => {
  const b = base0();
  let p = E.publishedPair(b, "session", "1");
  p = E.withList(p, ["effects"], "add", 0);                          // ["", "Tired"] / ["", "Cansados"]
  p = E.withList(p, ["activePlots", 0, "notes"], "add", 1);         // ["n1", "", "n2"]
  p = E.withText(p, ["title"], "en", "  One, again  ");
  p = E.withList(p, ["activePlots"], "add", null, {});
  const d = E.putRecord(E.emptyDraft(b), b, "session", "1", p);
  const a = E.applyDraft(b, d), s = a.raw.sessions["1"], t = a.content.sessions["1"];
  assert.deepEqual(s.effects, ["Tired"]); assert.deepEqual(t.effects, ["Cansados"]);
  assert.deepEqual(s.activePlots[0].notes, ["n1", "n2"]); assert.deepEqual(t.activePlots[0].notes, ["n1 es", "n2 es"]);
  assert.equal(s.activePlots.length, 1, "an unused plot row is dropped");
  assert.equal(s.title, "One, again");
  assert.deepEqual(Object.keys(s), Object.keys(b.raw.sessions["1"]));
});

// ── Export ──────────────────────────────────────────────────────────────────
test("export · every data file is written back byte for byte in its own layout", () => {
  const raw = loadRealData();
  for (const f of ["characters", "npcs", "locations", "quests", "sessions", "events", "routes"]) assert.equal(E.serialize(f, raw[f]), readText(`data/${f}.json`), f);
  assert.equal(E.serialize("content", loadContent("es-AR")), readText("data/i18n/es-AR.json"));
});

test("export · only the files a draft changes, and in them only the changed records' lines", () => {
  const base = { raw: loadRealData(), content: loadContent("es-AR") };
  let d = E.emptyDraft(base);
  assert.deepEqual(E.exportFiles(base, d), [], "nothing changed, nothing to export");
  const p = E.publishedPair(base, "event", "s8_04");
  d = E.putRecord(d, base, "event", "s8_04", { ...E.withField(p, ["xp"], 30.12), en: { ...E.withField(p, ["xp"], 30.12).en, yp: 27.34 } });
  const files = E.exportFiles(base, d);
  assert.deepEqual(files.map(f => f.path), ["data/events.json"]);
  const before = readText("data/events.json").split("\n"), after = files[0].text.split("\n");
  assert.equal(after.length, before.length);
  const diff = before.map((l, i) => (l !== after[i] ? i : -1)).filter(i => i >= 0);
  assert.equal(diff.length, 2, "two lines: xp and yp of that one event");
  assert.ok(after[diff[0]].includes("30.12") && after[diff[1]].includes("27.34"));
});

// ── Conflicts ───────────────────────────────────────────────────────────────
test("conflicts · newer published data is never overwritten silently", () => {
  const b = base0();
  let d = E.putRecord(E.emptyDraft(b), b, "event", "s1_02", E.withField(E.publishedPair(b, "event", "s1_02"), ["xp"], 43));
  assert.deepEqual(E.conflicts(b, d), []);
  // Meanwhile the published data changes: an untouched record and the edited one (another field).
  const newer = base0();
  newer.raw.events[0].title = "Arrive (fixed)";
  newer.raw.events[1].summary = "At the shop, fixed upstream.";
  assert.deepEqual(E.changedFiles(newer, d), ["events"]);
  const cs = E.conflicts(newer, d);
  assert.equal(cs.length, 1);
  assert.deepEqual([cs[0].kind, cs[0].id, cs[0].type, cs[0].mergeable], ["event", "s1_02", "changed", true]);
  assert.deepEqual(cs[0].fields.map(f => [f.field, f.byMe, f.upstream, f.clash]), [["summary", false, true, false], ["xp", true, false, false]]);
  // The untouched record takes the new version in the export.
  assert.equal(E.applyDraft(newer, d).raw.events[0].title, "Arrive (fixed)");
  // Combine: their summary, my position.
  const merged = E.resolveConflict(newer, d, "event", "s1_02", "merge");
  assert.deepEqual(E.conflicts(newer, merged), []);
  const ev = E.applyDraft(newer, merged).raw.events[1];
  assert.deepEqual([ev.summary, ev.xp], ["At the shop, fixed upstream.", 43]);
  // Keep mine (overwrite consciously) or take theirs.
  assert.equal(E.applyDraft(newer, E.resolveConflict(newer, d, "event", "s1_02", "mine")).raw.events[1].summary, "At the shop.");
  assert.equal(E.statusOf(E.resolveConflict(newer, d, "event", "s1_02", "published"), "event", "s1_02"), "published");
  // Both sides changed the same field: no automatic merge.
  newer.raw.events[1].xp = 44;
  const c2 = E.conflicts(newer, d)[0];
  assert.equal(c2.mergeable, false);
  assert.ok(c2.fields.find(f => f.field === "xp").clash);
  // A new record whose id was published meanwhile; a record deleted meanwhile.
  let d3 = E.putRecord(E.emptyDraft(b), b, "quest", "q9", { en: { id: "q9", title: "Mine", status: "pending" }, es: null });
  d3 = E.putRecord(d3, b, "event", "s2_02", E.withText(E.publishedPair(b, "event", "s2_02"), ["title"], "es", "Sueño"));
  const up = base0();
  up.raw.quests.push({ id: "q9", title: "Theirs", status: "active" });
  up.raw.events.splice(3, 1);
  assert.deepEqual(E.conflicts(up, d3).map(c => [c.id, c.type]).sort(), [["q9", "taken"], ["s2_02", "removed"]]);
});

test("published · an incorporated export is recognised: never a conflict, its changes can leave the draft", () => {
  const b = base0();
  // A moved event, a new quest, a corrected translation and a deletion — exported and incorporated as they are.
  let d = E.putRecord(E.emptyDraft(b), b, "event", "s1_02", E.withField(E.withField(E.publishedPair(b, "event", "s1_02"), ["xp"], 43.5), ["yp"], 39.25));
  d = E.putRecord(d, b, "quest", "q9", { en: { id: "q9", title: "New quest", status: "pending", summary: "Soon." }, es: { title: "Misión nueva" } });
  d = E.putRecord(d, b, "event", "s1_01", E.withText(E.publishedPair(b, "event", "s1_01"), ["title"], "es", "Llegada (corregida)"));
  d = E.deleteRecord(d, b, "event", "s2_02");
  assert.deepEqual(E.publishedChanges(b, d), [], "nothing is published yet");
  assert.equal(E.dropPublished(b, d), d);
  const published = E.applyDraft(b, d);
  assert.deepEqual(E.conflicts(published, d), [], "the same values on both sides are not a conflict");
  assert.deepEqual(E.publishedChanges(published, d).map(c => `${c.kind}:${c.id}`).sort(), ["event:s1_01", "event:s1_02", "event:s2_02", "quest:q9"]);
  assert.deepEqual(E.exportFiles(published, d), [], "nothing left to write");
  const left = E.dropPublished(published, d);
  assert.equal(E.summarize(left).total, 0);
  assert.equal(left.rev, d.rev + 1);
  // Only what the published data really holds leaves: a record edited again after the export stays, as a conflict
  // that shows the DM's newer value beside the published one.
  const d2 = E.putRecord(d, b, "event", "s1_02", E.withField(E.currentPair(d, b, "event", "s1_02"), ["xp"], 44));
  assert.deepEqual(E.publishedChanges(published, d2).map(c => c.id).sort(), ["q9", "s1_01", "s2_02"]);
  const cs = E.conflicts(published, d2);
  assert.deepEqual(cs.map(c => [c.id, c.type, c.mergeable]), [["s1_02", "changed", false]]);
  assert.deepEqual(cs[0].fields.filter(f => f.clash).map(f => [f.field, f.mine, f.published]), [["xp", 44, 43.5]]);
});

// ── Validation ──────────────────────────────────────────────────────────────
test("validation · form checks tied to record and field; only problems the draft introduced; errors block, warnings do not", () => {
  const b = base0();
  let d = E.emptyDraft(b);
  assert.equal(E.validate(b, d).ok, true);
  d = E.putRecord(d, b, "session", "4", { en: { title: "", playedOn: "2026-02-30", recap: { highlights: ["s1_01"] } }, es: null });
  d = E.putRecord(d, b, "event", "s5_01", { en: { id: "s5_01", session: 5, title: "", summary: "x", xp: 10, characterIds: ["gilmore"], questIds: ["nope"], relatedEventIds: ["s5_01"] }, es: null });
  d = E.putRecord(d, b, "place", "keep", E.withField(E.publishedPair(b, "place", "keep"), ["parentId"], "keep"));
  d = E.putRecord(d, b, "place", "void", { ...E.publishedPair(b, "place", "void"), en: { ...E.publishedPair(b, "place", "void").en, xp: 1, yp: 2 } });
  d = E.deleteRecord(d, b, "quest", "q1");
  const v = E.validate(b, d);
  const got = v.errors.map(i => `${i.kind}:${i.id}:${i.field}:${i.code}`);
  for (const want of ["session:4:title:required", "session:4:playedOn:date", "session:4:recap.highlights:highlightOther",
    "event:s5_01:title:required", "event:s5_01:session:sessionMissing", "event:s5_01:xp:coordsPair", "event:s5_01:characterIds:notPc",
    "event:s5_01:questIds:unknownRef", "event:s5_01:relatedEventIds:selfRef", "place:keep:parentId:cycle", "place:void:xp:planarCoords", "quest:q1:null:referenced"])
    assert.ok(got.includes(want), `${want} in ${got.join(", ")}`);
  assert.equal(v.ok, false);
  assert.ok(v.warnings.some(i => i.code === "highlightsCount"));
  // The model's checks add only what is new (none of the published issues), and never repeat a flagged record.
  assert.ok(!v.issues.some(i => i.code === "model" && /"s5_01"/.test(i.params.msg)));
  // Warnings only: a Spanish-only text, a quest not listing the event's session.
  let w = E.putRecord(E.emptyDraft(b), b, "event", "s2_09", { en: { id: "s2_09", session: 2, title: "", summary: "x", questIds: ["q1"] }, es: { title: "Solo español" } });
  const vw = E.validate(b, w);
  assert.equal(vw.ok, true);
  assert.deepEqual(vw.warnings.map(i => i.code).sort(), ["noEnglish"]);
  w = E.putRecord(w, b, "event", "s2_09", { en: { id: "s2_09", session: 2, title: "t", summary: "x", questIds: ["q1"] }, es: null });
  b.raw.quests[0].sessions = [1];
  assert.ok(E.validate(b, w).warnings.some(i => i.code === "questSession"));
});

// ── Ids ─────────────────────────────────────────────────────────────────────
test("ids · the repository's conventions, never colliding; a new record's links follow when it is renamed", () => {
  assert.equal(E.slugify("Gilmore's shop"), "gilmores-shop");
  assert.equal(E.slugify("  La Torre de Ilión — norte "), "la-torre-de-ilion-norte");
  const b = base0();
  let d = E.emptyDraft(b);
  assert.equal(E.nextSessionNo(b, d), 3);
  assert.equal(E.nextEventId(b, d, 2), "s2_03");
  assert.equal(E.nextEventId(b, d, 7), "s7_01");
  assert.equal(E.newRecordId(b, d, "place", "The City"), "the-city");
  assert.equal(E.newRecordId(b, d, "npc", "City"), "city-2", "people and places share one namespace");
  d = E.putRecord(d, b, "quest", "the-hunt", { en: { id: "the-hunt", title: "The hunt", status: "active" }, es: null });
  d = E.putRecord(d, b, "event", "s2_03", { en: { id: "s2_03", session: 2, title: "t", summary: "s", questIds: ["the-hunt"] }, es: null });
  d = E.renameNew(d, "quest", "the-hunt", "great-hunt");
  assert.equal(E.statusOf(d, "quest", "great-hunt"), "new");
  assert.equal(d.changes.quest["great-hunt"].en.id, "great-hunt");
  assert.deepEqual(d.changes.event.s2_03.en.questIds, ["great-hunt"]);
  assert.equal(E.renameNew(d, "event", "s1_01", "x"), d, "published records never change id");
  // A new session renumbered takes its new events along.
  d = E.putRecord(d, b, "session", "3", { en: { title: "T", playedOn: "2026-02-01" }, es: null });
  d = E.putRecord(d, b, "event", "s3_01", { en: { id: "s3_01", session: 3, title: "t", summary: "s" }, es: null });
  d = E.renameSession(b, d, 3, 4);
  assert.deepEqual(Object.keys(d.changes.session), ["4"]);
  assert.equal(d.changes.event.s4_01.en.session, 4);
});

// ── ZIP ─────────────────────────────────────────────────────────────────────
test("zip · stored entries with UTF-8 names and CRCs, read back exactly", async () => {
  const files = [{ name: "LEEME.txt", data: "Cambios exportados — todavía no están publicados.\n" }, { name: "data/events.json", data: readText("data/events.json") }, { name: "año/ñandú.json", data: "{}" }];
  const bytes = E.zip(files, new Date(2026, 9, 18, 12, 30, 10));
  assert.equal(new DataView(bytes.buffer).getUint32(0, true), 0x04034b50);
  const back = await E.unzip(bytes);
  assert.deepEqual(back.map(f => f.name), files.map(f => f.name));
  back.forEach((f, i) => assert.equal(new TextDecoder().decode(f.data), files[i].data));
  assert.equal(E.crc32(new TextEncoder().encode("123456789")), 0xcbf43926, "the standard CRC-32 check value");
  const broken = bytes.slice(); broken[40] ^= 0xff;
  await assert.rejects(E.unzip(broken), /corrupt|zip/);
  await assert.rejects(E.unzip(new Uint8Array(30)), /not a zip/);
});

test("zip · other tools open it (the system's tar reads zip files)", t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "chronicle-zip-"));
  try {
    fs.writeFileSync(path.join(dir, "p.zip"), E.zip([{ name: "data/quests.json", data: readText("data/quests.json") }]));
    // Windows' own tar (bsdtar) reads zip files; Git Bash's GNU tar does not, so it is tried first.
    const tars = [process.env.SystemRoot && path.join(process.env.SystemRoot, "System32", "tar.exe"), "bsdtar", "tar"].filter(Boolean);
    const ok = tars.some(bin => { try { execFileSync(bin, ["-xf", "p.zip"], { cwd: dir, stdio: "pipe" }); return fs.existsSync(path.join(dir, "data", "quests.json")); } catch (e) { return false; } });
    if (!ok) { t.skip("no tar able to read zip files here"); return; }
    assert.equal(fs.readFileSync(path.join(dir, "data", "quests.json"), "utf8"), readText("data/quests.json"));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ── Draft files ─────────────────────────────────────────────────────────────
test("draft files · round trip; anything else is rejected or skipped, never trusted", () => {
  const b = base0();
  let d = E.putRecord(E.emptyDraft(b), b, "event", "s1_01", E.withText(E.publishedPair(b, "event", "s1_01"), ["title"], "es", "Otra"));
  d = E.deleteRecord(d, b, "event", "s2_02");
  const back = E.parseDraft(E.draftToText(d));
  assert.deepEqual(back.skipped, []);
  assert.deepEqual(back.draft.changes, d.changes);
  assert.deepEqual(back.draft.base, d.base);
  assert.equal(E.parseDraft("not json").error, "notJson");
  assert.equal(E.parseDraft('{"format":"other"}').error, "notDraft");
  assert.equal(E.parseDraft(JSON.stringify({ ...d, version: 99 })).error, "version");
  const evil = JSON.parse(E.draftToText(d));
  evil.changes.event["../x"] = { op: "set", en: { id: "../x" } };
  evil.changes.event.s1_02 = { op: "set", en: { id: "other" } };
  evil.changes.quest.q1 = { op: "explode" };
  evil.changes.event.s1_01.en = JSON.parse('{"id":"s1_01","title":"x","__proto__":{"polluted":true}}');
  const r = E.parseDraft(JSON.stringify(evil));
  assert.deepEqual(r.skipped.map(s => `${s.id}:${s.reason}`).sort(), ["../x:id", "q1:op", "s1_02:record"]);
  assert.equal({}.polluted, undefined, "no prototype pollution");
  assert.equal(Object.prototype.hasOwnProperty.call(r.draft.changes.event.s1_01.en, "__proto__"), false);
});

test("import · drafts merge (listing what both touched); data files become changes, never deletions", () => {
  const b = base0();
  const mine = E.putRecord(E.emptyDraft(b), b, "event", "s1_01", E.withText(E.publishedPair(b, "event", "s1_01"), ["title"], "es", "Mía"));
  const theirs = E.putRecord(E.putRecord(E.emptyDraft(b), b, "event", "s1_01", E.withText(E.publishedPair(b, "event", "s1_01"), ["title"], "es", "Suya")),
    b, "quest", "q7", { en: { id: "q7", title: "Q7", status: "pending" }, es: null });
  const m = E.mergeDrafts(mine, theirs);
  assert.deepEqual(m.replaced, [{ kind: "event", id: "s1_01" }]);
  assert.equal(m.draft.changes.event.s1_01.es.title, "Suya");
  assert.equal(E.statusOf(m.draft, "quest", "q7"), "new");
  const file = b.raw.events.slice(0, 2).map(e => ({ ...e }));
  file[1].title = "Shop (edited)";
  file.push({ id: "s2_05", session: 2, title: "Imported", summary: "x" });
  const ch = E.changesFromFile(b, E.emptyDraft(b), "events.json", file);
  assert.deepEqual(ch.changes.map(c => [c.id, c.isNew]), [["s1_02", false], ["s2_05", true]], "s1_01 unchanged; missing events are not deletions");
  const tr = E.changesFromFile(b, E.emptyDraft(b), "es-AR.json", { events: { s1_02: { title: "La tienda" } } });
  assert.deepEqual(tr.changes.map(c => [c.kind, c.id, c.pair.es.title]), [["event", "s1_02", "La tienda"]]);
  assert.equal(E.changesFromFile(b, E.emptyDraft(b), "random.json", []).ok, false);
});

// ── Storage ─────────────────────────────────────────────────────────────────
test("storage · revisions keep two tabs from overwriting each other; backups newest first, 30 kept", async () => {
  const s = E.memoryStore(), b = base0();
  assert.equal(await s.load(), null);
  const d0 = E.emptyDraft(b);
  assert.deepEqual(await s.save(d0, "none"), { ok: true });
  assert.equal((await s.save(d0, "none")).conflict, true, "a draft appeared meanwhile");
  const d1 = E.putRecord(d0, b, "quest", "q5", { en: { id: "q5", title: "5", status: "active" }, es: null });
  assert.deepEqual(await s.save(d1, { id: d0.id, rev: 0 }), { ok: true });
  const stale = await s.save(E.putRecord(d0, b, "quest", "q6", { en: { id: "q6", title: "6", status: "active" }, es: null }), { id: d0.id, rev: 0 });
  assert.deepEqual(stale, { ok: false, conflict: true, stored: { id: d0.id, rev: 1 } }, "another tab saved revision 1 meanwhile");
  const fresh = E.emptyDraft(b);
  assert.equal((await s.save(fresh, { id: fresh.id, rev: 1 })).conflict, true, "same revision number, another draft: still a clash");
  assert.equal(E.statusOf(await s.load(), "quest", "q5"), "new");
  for (let i = 0; i < 33; i++) await s.backup(d1, `r${i}`);
  const list = await s.backups();
  assert.equal(list.length, 30); assert.equal(list[0].reason, "r32"); assert.equal(list[0].count, 1);
  assert.equal(E.statusOf(await s.getBackup(list[0].id), "quest", "q5"), "new");
  const fallback = await E.createStore({});
  assert.equal(fallback.kind, "memory");
});

// ── The whole path, in Node: a test session drafted, validated, exported, checked by the real validator ──
test("integration · a test session with two events, a party member, a quest and a position exports files the validator accepts", () => {
  const base = { raw: loadRealData(), content: loadContent("es-AR") };
  let d = E.emptyDraft(base);
  const no = E.nextSessionNo(base, d);
  assert.equal(no, 13);
  d = E.putRecord(d, base, "session", no, { en: { title: "Test session", playedOn: "2026-10-25" }, es: { title: "Sesión de prueba" } });
  const id1 = E.nextEventId(base, d, no);
  d = E.putRecord(d, base, "event", id1, { en: { id: id1, session: no, campaignDay: 41, type: "travel", title: "Test arrival", summary: "A test.", locationId: "vasselheim", characterIds: ["sorfon"], questIds: ["cassandra"] }, es: { title: "Llegada de prueba", summary: "Una prueba." } });
  const m = Model.build(E.applyDraft(base, d).raw);
  const sug = E.suggestPosition(m, { locationId: "vasselheim", excludeEventId: id1 });
  assert.equal(sug.source, "events", "the point earlier events in Vasselheim used");
  assert.equal(sug.precision, "approximate");
  let p = E.currentPair(d, base, "event", id1);
  p = E.withField(E.withField(p, ["xp"], sug.point.xp), ["yp"], sug.point.yp);
  d = E.putRecord(d, base, "event", id1, p);
  const id2 = E.nextEventId(base, d, no);
  assert.equal(id2, "s13_02");
  d = E.putRecord(d, base, "event", id2, { en: { id: id2, session: no, campaignDay: 41, type: "dream", title: "", summary: "" }, es: { title: "Un sueño de prueba", summary: "Sin lugar en el mapa." } });
  // The quest lists its sessions: add this one.
  const q = E.currentPair(d, base, "quest", "cassandra");
  d = E.putRecord(d, base, "quest", "cassandra", E.withField(q, ["sessions"], [...q.en.sessions, no]));
  const v = E.validate(base, d);
  assert.equal(v.ok, true, JSON.stringify(v.errors));
  const files = E.exportFiles(base, d);
  assert.deepEqual(files.map(f => f.path).sort(), ["data/events.json", "data/i18n/es-AR.json", "data/quests.json", "data/sessions.json"]);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "chronicle-export-"));
  try {
    files.forEach(f => { const out = path.join(dir, f.path.replace(/^data\//, "")); fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, f.text); });
    const outText = execFileSync(process.execPath, [path.join(ROOT, "tools", "validate-data.js"), "--data", dir], { encoding: "utf8" });
    assert.match(outText, /OK — 0 warning\(s\)/);
    assert.match(outText, /35 events/);
    // tools/apply-draft.js applies the same draft to a copy of the data, and refuses a conflicting one.
    const data = path.join(dir, "repo-data");
    fs.cpSync(path.join(ROOT, "data"), data, { recursive: true });
    fs.writeFileSync(path.join(dir, "cambios.json"), E.draftToText(d));
    fs.writeFileSync(path.join(dir, "paquete.zip"), E.zip([{ name: "cambios.json", data: E.draftToText(d) }]));
    execFileSync(process.execPath, [path.join(ROOT, "tools", "apply-draft.js"), path.join(dir, "paquete.zip"), "--data", data], { encoding: "utf8" });
    files.forEach(f => assert.equal(fs.readFileSync(path.join(data, f.path.replace(/^data\//, "")), "utf8"), f.text, f.path));
    // Running it again finds every change already in the data: nothing to do, nothing written, no conflict.
    const again = execFileSync(process.execPath, [path.join(ROOT, "tools", "apply-draft.js"), path.join(dir, "paquete.zip"), "--data", data], { encoding: "utf8" });
    assert.match(again, /already in the data: 4 change\(s\)/);
    assert.match(again, /Nothing to change: the data already holds this draft\./);
    files.forEach(f => assert.equal(fs.readFileSync(path.join(data, f.path.replace(/^data\//, "")), "utf8"), f.text, f.path));
    const evs = JSON.parse(fs.readFileSync(path.join(data, "events.json"), "utf8"));
    evs.find(e => e.id === "s12_01").title = "Changed in the repository meanwhile";
    const qs = JSON.parse(fs.readFileSync(path.join(data, "quests.json"), "utf8"));
    qs.find(x => x.id === "cassandra").summary = "Changed in the repository meanwhile";
    fs.writeFileSync(path.join(data, "quests.json"), E.serialize("quests", qs));
    let code = 0;
    try { execFileSync(process.execPath, [path.join(ROOT, "tools", "apply-draft.js"), path.join(dir, "cambios.json"), "--data", data, "--check"], { stdio: "pipe" }); } catch (e) { code = e.status; }
    assert.equal(code, 2, "a conflict stops it (nothing written)");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
