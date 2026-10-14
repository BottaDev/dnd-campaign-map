// "Previously on…" (ChronicleModel.latestSession / recapOf): the latest session by number, built only
// from what was recorded — highlights only when an editor chose them, translations with fallback.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { Model, I18N, PCS, buildReal, loadRealData, loadContent } = require("./helpers");

const raw = loadRealData();
const mini = (sessions, events, more) => Model.build({ characters: PCS, npcs: [], locations: [], routes: {}, quests: [], sessions, events, ...(more || {}) }, more && more.opts);
const ev = (id, session, extra) => ({ id, session, campaignDay: session, title: `Event ${id}`, summary: `Summary ${id}`, characterIds: [], ...(extra || {}) });

test("1 · the latest session is the highest NUMBER with a log — not the label order, not the list order", () => {
  const m = buildReal("es-AR");
  assert.equal(Model.latestSession(m).no, 12);
  // Keys out of order and numerically tricky (10 > 9 > 2), with a later session that has events but no log.
  const x = mini({ 2: { title: "Two" }, 10: { title: "Ten" }, 9: { title: "Nine" } }, [ev("a", 2), ev("b", 10), ev("c", 11)]);
  assert.equal(Model.latestSession(x).no, 10, "session 11 has no log (stub) — 10 is the latest written");
  assert.ok(x.sessionByNo.get(11).isStub);
  // With no log at all, the highest session with events.
  assert.equal(Model.latestSession(mini({}, [ev("a", 3), ev("b", 7)])).no, 7);
  assert.equal(Model.latestSession(mini({}, [])), null);
  // The Sessions list order (oldest first by default) does not change it.
  const items = Model.sessionListItems(m, { order: "asc" }).filter(i => !i.gap);
  assert.equal(items[0].session.no, 1);
  assert.equal(Model.latestSession(m).no, 12);
});

test("2 · session without a curated recap: every recorded event, in recorded order, nothing ranked", () => {
  const m = buildReal("es-AR"), rc = Model.recapOf(m, 12), s = m.sessionByNo.get(12);
  assert.equal(rc.curated, false);
  assert.deepEqual(rc.events.map(e => e.id), s.eventIds, "all events, recorded order");
  assert.deepEqual(rc.highlights, []);
  assert.deepEqual(rc.decisions, [], "decisions are already in the list (no duplicates)");
  assert.equal(rc.summary, "", "no summary is invented");
  assert.equal(rc.isLatest, true);
});

test("3 · session without events, and an unknown session", () => {
  const m = mini({ 1: { title: "One", endedHere: "At the gate" }, 2: { title: "Two" } }, [ev("a", 1)]);
  const rc = Model.recapOf(m, 2);
  assert.deepEqual(rc.events, []);
  assert.deepEqual(rc.pending, []);
  assert.equal(rc.endedHere, "");
  assert.equal(Model.recapOf(m, 1).endedHere, "At the gate");
  assert.equal(Model.recapOf(m, 99), null);
});

test("4 · session with several events and editorial highlights (order kept, decisions listed apart)", () => {
  const m = mini({ 1: { title: "One", recap: { summary: "We met.", highlights: ["c", "a"] } } },
    [ev("a", 1), ev("b", 1, { type: "decision" }), ev("c", 1, { type: "combat" }), ev("d", 1, { type: "decision" })]);
  const rc = Model.recapOf(m, 1);
  assert.equal(rc.curated, true);
  assert.deepEqual(rc.highlights.map(e => e.id), ["c", "a"], "the editor's order");
  assert.deepEqual(rc.decisions.map(e => e.id), ["b", "d"], "decisions not among the highlights");
  assert.equal(rc.summary, "We met.");
  assert.deepEqual(rc.events.map(e => e.id), ["a", "b", "c", "d"]);
});

test("5 · highlights are checked: unknown events and other sessions' events are rejected", () => {
  const m = mini({ 1: { recap: { highlights: ["a", "zzz", "b", "a"] } }, 2: {} }, [ev("a", 1), ev("b", 2)]);
  assert.deepEqual(m.sessionByNo.get(1).recap.highlightIds, ["a"]);
  assert.ok(m.issues.some(i => i.level === "error" && /recap highlight "zzz" is not an event/.test(i.msg)));
  assert.ok(m.issues.some(i => i.level === "warn" && /recap highlight "b" belongs to session 2/.test(i.msg)));
  const bad = mini({ 1: { recap: "text" } }, []);
  assert.ok(bad.issues.some(i => /"recap" must be an object/.test(i.msg)));
  const many = mini({ 1: { recap: { highlights: ["a", "b", "c", "d", "e", "f"] } } }, "abcdef".split("").map(x => ev(x, 1)));
  assert.ok(many.issues.some(i => /6 highlights/.test(i.msg)), "more than five is a warning, not an error");
});

test("6 · pending: the threads recorded as open at the session's end, plus events' own open questions", () => {
  const m = buildReal("en"), rc = Model.recapOf(m, 12), src = raw.sessions["12"];
  assert.deepEqual(rc.pending.map(p => p.name), src.activePlots.map(p => p.name));
  assert.deepEqual(rc.closed.map(p => p.name), src.completedPlots.map(p => p.name));
  assert.deepEqual(rc.effects, src.effects);
  const x = mini({ 1: {} }, [ev("a", 1, { unresolved: ["Who sent the letter?"] }), ev("b", 1)]);
  assert.deepEqual(Model.recapOf(x, 1).unresolved, [{ eventId: "a", text: "Who sent the letter?" }]);
});

test("7 · nothing invented: every text in the recap is a field of the data", () => {
  const m = buildReal("en"), s = raw.sessions["12"];
  const rc = Model.recapOf(m, 12);
  const known = new Set([s.endedHere, s.startedHere, ...s.effects, ...s.activePlots.flatMap(p => [p.name, p.qt]), ...s.completedPlots.flatMap(p => [p.name, p.qt]),
    ...raw.events.flatMap(e => [e.title, e.summary])]);
  const texts = [rc.endedHere, rc.startedHere, ...rc.effects, ...rc.pending.flatMap(p => [p.name, p.qt]), ...rc.closed.map(p => p.name),
    ...rc.events.flatMap(e => [e.title, e.summary])];
  texts.forEach(x => assert.ok(known.has(x), `not from the data: ${x}`));
  assert.ok(rc.quests.every(q => m.sessionByNo.get(12).questIds.includes(q.id)));
});

test("8 · translations: the recap summary is translated, English shown (and flagged) when missing", () => {
  const data = { characters: PCS, npcs: [], locations: [], routes: {}, quests: [], events: [ev("a", 1)],
    sessions: { 1: { title: "One", recap: { summary: "The party met." } }, 2: { title: "Two", recap: { summary: "They left." } } } };
  const translations = { "es-AR": { sessions: { 1: { recap: { summary: "El grupo se conoció." } }, 3: {} } } };
  const es = Model.build(data, { locale: "es-AR", t: I18N.createTranslator("es-AR"), translations });
  assert.equal(Model.recapOf(es, 1).summary, "El grupo se conoció.");
  assert.equal(Model.recapOf(es, 1).summaryFallback, false);
  assert.equal(Model.recapOf(es, 2).summary, "They left.", "English fallback");
  assert.equal(Model.recapOf(es, 2).summaryFallback, true);
  const en = Model.build(data, { locale: "en", translations });
  assert.equal(Model.recapOf(en, 1).summary, "The party met.");
  assert.equal(Model.recapOf(en, 1).summaryFallback, false);
  // A translated summary without an English one is never shown, and the checker says so.
  const orphan = Model.checkTranslations({ ...data, sessions: { 1: { title: "One" } } }, { sessions: { 1: { recap: { summary: "Huérfano" } } } }, "es-AR");
  assert.ok(orphan.some(i => /recap.summary has no English source/.test(i.msg)));
});

test("9 · the real data still validates and the content translation file needs no recap", () => {
  const m = buildReal("es-AR");
  assert.equal(m.issues.filter(i => i.level === "error").length, 0);
  assert.deepEqual(Model.checkTranslations(raw, loadContent("es-AR"), "es-AR"), []);
  m.sessions.forEach(s => assert.ok(Array.isArray(s.recap.highlightIds)));
});
