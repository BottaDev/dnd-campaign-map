// The help centre ("How the Chronicle works"): the guided tours (tests/tour.test.js), short answers
// to frequent questions, what each section holds, and the glossary of icons and colours; the
// first-visit introduction and invitation; the contextual hints. Optional — never opened on its own.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { Model, I18N, ROOT } = require("./helpers");

const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const mount = html.slice(html.indexOf("componentDidMount(){"), html.indexOf("componentDidUpdate(){"));
const helpTpl = html.slice(html.indexOf("<!-- ═══ HELP"), html.indexOf("<!-- ═══ UNIVERSAL SEARCH"));
const SECTIONS = ["chronicle", "sessions", "quests", "characters", "places", "map"];

test("1 · help centre: the three tours, what each section holds, six short answers — in both languages", () => {
  for (const code of ["es-AR", "en"]) {
    const t = I18N.createTranslator(code);
    for (const id of ["main", "map", "search"]) {
      assert.ok(t(`help.tour.${id}`).length <= 32, `${code} help.tour.${id}`);
      assert.ok(t(`help.tour.${id}Sub`).length <= 80, `${code} help.tour.${id}Sub`);
    }
    SECTIONS.forEach(s => assert.ok(t(`nav.desc.${s}`).length <= 70, `${code} nav.desc.${s} is one short line`));
    for (let n = 1; n <= 6; n++) {
      assert.ok(t(`help.faq.q${n}`).endsWith("?"), `${code} q${n}`);
      assert.ok(t(`help.faq.a${n}`).length <= 240, `${code} a${n} is a short answer`);
    }
    ["title", "intro", "faqH", "sectionsQ", "completed", "unavailable"].forEach(k => assert.ok(t(`help.${k}`), `${code} help.${k}`));
  }
  const es = I18N.createTranslator("es-AR");
  assert.equal(es("help.faq.q1"), "¿Qué diferencia hay entre Crónica y Sesiones?");
  assert.match(es("help.faq.a5"), /spoilers/, "lore vs. campaign answer mentions spoilers");
  assert.match(es("help.faq.a6"), /ES \/ EN/, "the language answer points at the real switch");
  // The tab titles carry the same one-line description (a hint on hover, no extra text on screen).
  assert.match(html, /title:`\$\{label\(s\)\} — \$\{t\(`nav\.desc\.\$\{s\.id\}`\)\}`/);
});

test("2 · optional and quiet: nothing opens by itself; a first visit gets an introduction and an invitation in the Chronicle", () => {
  assert.ok(!/openHelp\(|startTour\(|help:\{/.test(mount), "componentDidMount opens nothing");
  assert.match(html, /const intro=!st\.tourOn&&this\.onboarding\.showInvite\(\);/, "the introduction is for first visits only");
  assert.match(html, /<sc-if value="\{\{ c\.intro \}\}">\s*<section class="cc-intro"/);
  assert.match(html, /onClick="\{\{ onStartTour \}\}">\{\{ t\.tour\.inviteGo \}\}/, "“Show me how it works” starts the tour");
  assert.match(html, /onClick="\{\{ onDismissInvite \}\}"[^>]*>\{\{ t\.tour\.inviteNo \}\}/, "“Not now” dismisses it");
  // Afterwards: the tagline under the heading (desktop) and the quiet "How does it work?" link.
  assert.match(html, /<sc-if value="\{\{ c\.tagline \}\}"><p class="cc-sec-sub">\{\{ t\.chronicle\.introH \}\}<\/p><\/sc-if>/);
  // The help is reachable from the top bar, the Chronicle, the More sheet (phones) and the map.
  assert.match(html, /class="cc-iconbtn" onClick="\{\{ onOpenHelp \}\}"/);
  assert.match(html, /class="cc-linkbtn cc-qa-help" onClick="\{\{ onOpenHelp \}\}"/);
  assert.match(html, /class="cc-sheet-item" onClick="\{\{ onOpenHelp \}\}"/);
  assert.match(html, /class="cc-sheet-item" onClick="\{\{ onOpenGlossary \}\}"/);
  assert.match(html, /class="cc-mapbtn cc-maphelp" onClick="\{\{ mp\.onTour \}\}"/);
  // The old three-card tutorial is gone (one tutorial, not two explaining the same thing).
  for (const gone of ["GUIDE_STEPS", "_mapSketch", "guideTry", "cc-guide-ill", "chronicle-tutorial-seen\";"]) assert.ok(!html.includes(gone), gone);
});

test("3 · quick actions: catch up (the real latest recap) and find anything", () => {
  assert.match(html, /<a class="cc-qa-i cc-latest" href="\{\{ recapEntry\.href \}\}"/);
  assert.match(html, /<button class="cc-qa-i" onClick="\{\{ onOpenSearch \}\}" aria-haspopup="dialog">/);
  for (const code of ["es-AR", "en"]) ["qaRecap", "qaSearch", "qaSearchSub", "qaHelp", "qaHelpAria", "introH", "introT"].forEach(k => assert.ok(I18N.dicts[code].chronicle[k], `${code} chronicle.${k}`));
  assert.equal(I18N.createTranslator("es-AR")("chronicle.introH"), "Nuestra historia, en un solo lugar.");
});

test("4 · contextual help only where it is needed: filters, the recap's source, the map, the lore", () => {
  assert.match(html, /<div class="cc-filters cc-scroll" id="cc-filters">\s*<p class="cc-hint">\{\{ icons\.help \}\}<span>\{\{ t\.chronicle\.filtersHint \}\}<\/span><\/p>/);
  assert.match(html, /<p class="cc-hint">\{\{ icons\.help \}\}<span>\{\{ rc\.source \}\}<\/span><\/p>/);
  assert.match(html, /source:t\(rc\.curated\?"recap\.sourceCurated":"recap\.source",\{n:s\.no\}\)/);
  for (const code of ["es-AR", "en"]) {
    const t = I18N.createTranslator(code);
    assert.match(t("chronicle.filtersHint"), code === "en" ? /combine/ : /combinan/);
    assert.match(t("recap.source", { n: 12 }), /12/);
    assert.match(t("lore.hint"), /Critical Role/);
    assert.match(t("lore.hint"), /spoilers/, `${code}: the lore says it is external and may spoil`);
    assert.ok(t("map.howTo") && t("map.howToAria"));
  }
  // Few question marks: the hints are text lines, not a row of "?" icons.
  assert.ok((html.match(/class="cc-hint"/g) || []).length <= 3);
});

test("5 · glossary: every event type, every colour family and every quest status, labelled in both languages", () => {
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

test("6 · the help is text and real controls — no images, no illustrations standing in for the app", () => {
  assert.ok(!/<img/.test(helpTpl), "no <img> in the help");
  assert.match(helpTpl, /data-dialog="help"/);
  assert.match(helpTpl, /<details class="cc-faq-i">/, "answers fold away");
});
