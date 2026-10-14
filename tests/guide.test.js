// The guide ("How the Chronicle works") and the glossary of icons and colours: three short steps in
// both languages with real examples from the data; optional (never opened on its own); the glossary
// covers every event type, colour family and quest status that exists.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { Model, I18N, ROOT, buildReal } = require("./helpers");

const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const mount = html.slice(html.indexOf("componentDidMount(){"), html.indexOf("componentDidUpdate(){"));

test("1 · three steps, each with a title, a short text, three points and a try-it action — in both languages", () => {
  assert.match(html, /const GUIDE_STEPS = 3;/);
  for (const code of ["es-AR", "en"]) {
    const t = I18N.createTranslator(code);
    for (const n of [1, 2, 3]) {
      const title = t(`guide.s${n}T`), text = t(`guide.s${n}D`);
      assert.ok(title && title.split(" ").length <= 4, `${code} step ${n} title is brief: "${title}"`);
      assert.ok(text && text.length <= 140, `${code} step ${n} text is short (${text.length} chars)`);
      ["a", "b", "c"].forEach(x => assert.ok(t(`guide.s${n}${x}`, { name: "X" }).length <= 130, `${code} s${n}${x}`));
      assert.ok(t(`guide.s${n}Try`, { name: "X" }), `${code} s${n}Try`);
    }
    assert.ok(t("guide.step", { n: 2, total: 3 }).includes("2") && t("guide.step", { n: 2, total: 3 }).includes("3"), "step indicator");
    ["prev", "next", "done", "skip", "closeAria", "inviteText", "inviteOpen", "inviteDismiss"].forEach(k => assert.ok(t(`guide.${k}`), `${code} guide.${k}`));
  }
  assert.equal(I18N.createTranslator("es-AR")("guide.s1T"), "Explorá la historia");
  assert.equal(I18N.createTranslator("es-AR")("guide.s2T"), "Encontrá información");
  assert.equal(I18N.createTranslator("es-AR")("guide.s3T"), "Explorá el mundo");
});

test("2 · optional: the page never opens the guide by itself; a first visit gets a quiet invitation instead", () => {
  assert.ok(!/openGuide|guide:\{/.test(mount), "componentDidMount does not open the guide");
  assert.ok(!/showTutorial/.test(html), "the old auto-opening modal is gone");
  assert.match(html, /invite:!st\.inviteSeen&&!st\.guide/, "the invitation lives in the Chronicle list");
  assert.match(html, /const GUIDE_KEY = "chronicle-tutorial-seen";/, "same storage key as before (old visitors are not invited again)");
  assert.match(html, /_markGuideSeen\(how\)\{ try\{ localStorage\.setItem\(GUIDE_KEY,how\); \}catch\(e\)\{\}/);
  // Reachable from the help button, the More sheet (phones) and the invitation.
  assert.match(html, /class="cc-iconbtn" onClick="\{\{ onOpenTutorial \}\}"/);
  assert.match(html, /class="cc-sheet-item" onClick="\{\{ onOpenTutorial \}\}"/);
  assert.match(html, /class="cc-sheet-item" onClick="\{\{ onOpenGlossary \}\}"/);
});

test("3 · the examples are real entries from the campaign", () => {
  const m = buildReal("es-AR"), ex = Model.guideExamples(m);
  assert.ok(m.eventById.get(ex.event.id), "step 1: a recorded event");
  assert.ok(ex.event.characterIds.length && ex.event.questIds.length && ex.event.locationId, "well connected, so its page shows the links");
  assert.equal(ex.person.kind, "pc", "step 2: a party member");
  assert.ok(Model.searchAll(m, ex.person.name).groups.length >= 3, "whose name finds several kinds of entry");
  assert.ok(ex.mapEvent.hasCoords, "step 3: an event on the map");
  assert.deepEqual(Model.guideExamples(Model.build({ characters: [], events: [], sessions: {}, quests: [], routes: {} })), { event: null, person: null, mapEvent: null }, "an empty campaign does not break the guide");
});

test("4 · glossary: every event type, every colour family and every quest status, labelled in both languages", () => {
  const families = [...new Set(Object.values(Model.EVENT_TYPES).map(t => t.family))];
  for (const code of ["es-AR", "en"]) {
    families.forEach(f => assert.ok(I18N.dicts[code].glossary.family[f], `${code}: family ${f}`));
    ["mapPin", "mapSeal", "mapCount", "mapCluster", "mapRoute", "mapShared", "mapGap", "approx", "lore", "star", "latest"].forEach(k => assert.ok(I18N.dicts[code].glossary[k], `${code}: glossary.${k}`));
  }
  // Built from the vocabularies themselves, so a new type or status appears without editing the glossary.
  assert.match(html, /Object\.keys\(M\.EVENT_TYPES\)\.filter\(k=>M\.EVENT_TYPES\[k\]\.family===f\)/);
  assert.match(html, /const statuses=Object\.keys\(M\.QUEST_STATUS\)/);
  assert.match(html, /\.\.\.Object\.values\(M\.EVENT_TYPES\)\.map\(x=>x\.family\)/, "unknown families are appended, never dropped");
});

test("5 · the illustrations are drawn, not downloaded (no new images in the guide)", () => {
  const guide = html.slice(html.indexOf("<!-- ═══ GUIDE"), html.indexOf("<!-- ═══ UNIVERSAL SEARCH"));
  assert.ok(!/<img/.test(guide), "no <img> in the guide");
  assert.match(html, /_mapSketch\(\)\{/);
});
