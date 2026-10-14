// Lore of Exandria (data/lore.json): external references, curated summaries, translations,
// spoiler flags, link safety, and — above all — that the lore layer never changes campaign data.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { Model, I18N, ROOT, PCS, buildReal, loadRealData, loadContent, readJson } = require("./helpers");

const WIKI = "https://criticalrole.fandom.com/wiki/";
const SOURCES = {
  "cr-wiki": { label: "Critical Role Wiki", community: true, spoilers: true },
  "official": { label: "Critical Role (official site)", spoilers: true },
};
const PLACES = [{ id: "taldorei", name: "Tal'Dorei", kind: "continent" }, { id: "emon", name: "Emon", kind: "city", parentId: "taldorei" },
  { id: "inn", name: "The inn", kind: "site" }];
const NPCS = [{ id: "pelor", name: "Pelor", category: "deity" }, { id: "diomedes", name: "Diomedes", category: "person" }];
const EVENTS = [{ id: "e1", session: 1, campaignDay: 1, title: "Arrival", summary: "We arrive.", characterIds: ["ayante"], npcIds: ["pelor"], locationId: "emon" }];

// A small campaign with an optional lore file and Spanish content overlay.
function world(lore, es, locale) {
  const raw = { characters: PCS, npcs: NPCS, locations: PLACES, routes: {}, events: EVENTS, quests: [],
    sessions: { 1: { title: "One", playedOn: "2026-01-01" } }, lore };
  const code = locale || "en";
  return Model.build(raw, { locale: code, t: I18N.createTranslator(code), translations: es ? { "es-AR": es } : {} });
}
const errorsOf = m => m.issues.filter(i => i.level === "error").map(i => i.msg);
const strip = o => JSON.parse(JSON.stringify(o, (k, v) => (k === "lore" ? undefined : v instanceof Map ? [...v.keys()] : v)));

// ── References ──────────────────────────────────────────────────────────────
test("references · an entity with one external link", () => {
  const m = world({ sources: SOURCES, entries: { taldorei: { references: [{ source: "cr-wiki", title: "Tal'Dorei", url: WIKI + "Tal%27Dorei" }] } } });
  const lo = m.placeById.get("taldorei").lore;
  assert.equal(lo.references.length, 1);
  assert.deepEqual(lo.references[0], { source: "cr-wiki", sourceLabel: "Critical Role Wiki", title: "Tal'Dorei",
    url: "https://criticalrole.fandom.com/wiki/Tal%27Dorei", community: true, spoilers: true });
  assert.equal(lo.spoilers, true);
  assert.deepEqual(errorsOf(m), []);
});

test("references · several sources per entity, duplicates dropped, unknown source labelled by host", () => {
  const m = world({ sources: SOURCES, entries: { pelor: { summary: "God of the sun.", references: [
    { source: "cr-wiki", title: "The Dawnfather", url: WIKI + "The_Dawnfather" },
    { source: "official", title: "Pelor", url: "https://critrole.com/pelor" },
    { source: "cr-wiki", url: WIKI + "The_Dawnfather" },                        // same link twice
    { source: "dndb", title: "Pelor", url: "https://www.dndbeyond.com/pelor" },  // source not declared
  ] } } });
  const lo = m.personById.get("pelor").lore;
  assert.deepEqual(lo.references.map(r => r.sourceLabel), ["Critical Role Wiki", "Critical Role (official site)", "dndbeyond.com"]);
  assert.deepEqual(lo.basedOn, ["Critical Role Wiki", "Critical Role (official site)"]);
  assert.ok(m.issues.some(i => /duplicate link/.test(i.msg)));
  assert.ok(m.issues.some(i => /unknown source "dndb"/.test(i.msg)));
});

test("references · an entity without lore has none (and the section is not built)", () => {
  const m = world({ sources: SOURCES, entries: { taldorei: { references: [{ source: "cr-wiki", url: WIKI + "Tal%27Dorei" }] } } });
  assert.equal(m.personById.get("diomedes").lore, null);
  assert.equal(m.placeById.get("inn").lore, null);
  assert.equal(world(undefined).placeById.get("taldorei").lore, null, "no lore.json at all");
  assert.deepEqual(errorsOf(world(undefined)), []);
});

test("references · invalid URLs are rejected (never rendered as links)", () => {
  const bad = ["javascript:alert(1)", "JaVaScRiPt:alert(1)", "data:text/html,<b>x</b>", "http://criticalrole.fandom.com/wiki/Emon",
    "//criticalrole.fandom.com/wiki/Emon", "/wiki/Emon", "https://user:pw@criticalrole.fandom.com/", "https://criticalrole.fandom.com/wiki/A B",
    "https://localhost/x", "https://criticalrole.fandom.com/\"onmouseover=\"x", "", null, 42];
  bad.forEach(u => assert.equal(Model.safeExternalUrl(u), null, String(u)));
  assert.equal(Model.safeExternalUrl(" https://criticalrole.fandom.com/wiki/Tal%27Dorei "), "https://criticalrole.fandom.com/wiki/Tal%27Dorei");
  const m = world({ sources: SOURCES, entries: {
    emon: { summary: "A city.", references: [{ source: "cr-wiki", url: "javascript:alert(1)" }] },
    taldorei: { references: [{ source: "cr-wiki", url: "javascript:alert(1)" }, { source: "cr-wiki", url: WIKI + "Tal%27Dorei" }] },
  } });
  assert.equal(m.placeById.get("emon").lore, null, "summary without a valid reference is not shown");
  assert.deepEqual(m.placeById.get("taldorei").lore.references.map(r => r.url), [WIKI + "Tal%27Dorei"]);
  assert.equal(errorsOf(m).filter(e => /invalid url/.test(e)).length, 2);
});

test("references · links open in a new tab with rel=noopener noreferrer (template)", () => {
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const links = [...html.matchAll(/<a [^>]*class="cc-extlink"[^>]*>/g)].map(m => m[0]);
  assert.equal(links.length, 1);
  assert.match(links[0], /href="\{\{ r\.url \}\}"/);
  assert.match(links[0], /target="_blank"/);
  assert.match(links[0], /rel="noopener noreferrer"/);
  assert.ok(!/dangerouslySetInnerHTML|innerHTML/.test(html), "no raw HTML rendering");
});

// ── Summaries and facts ─────────────────────────────────────────────────────
test("lore · summary + facts, English and Spanish; facts in vocabulary order, unknown keys ignored", () => {
  const lore = { sources: SOURCES, entries: { pelor: { summary: "God of the sun.", lastReviewed: "2026-10-14",
    facts: { symbol: "An eight-pointed star", domains: "Life, Light", favouriteFood: "bread" },
    references: [{ source: "cr-wiki", url: WIKI + "The_Dawnfather" }] } } };
  const es = { lore: { pelor: { summary: "Dios del sol.", facts: { domains: "Vida, Luz" } } } };
  const en = world(lore, es, "en").personById.get("pelor").lore;
  assert.equal(en.summary, "God of the sun.");
  assert.deepEqual(en.facts.map(f => [f.key, f.label, f.value]), [["domains", "Domains", "Life, Light"], ["symbol", "Symbol", "An eight-pointed star"]]);
  assert.equal(en.summaryLang, "en");
  assert.equal(en.reviewedLabel, "14 Oct 2026");
  const mEs = world(lore, es, "es-AR"), sp = mEs.personById.get("pelor").lore;
  assert.equal(sp.summary, "Dios del sol.");
  assert.equal(sp.summaryFallback, false);
  assert.deepEqual(sp.facts.map(f => [f.label, f.value]), [["Dominios", "Vida, Luz"], ["Símbolo", "An eight-pointed star"]], "per-field English fallback");
  assert.equal(sp.reviewedLabel, "14 oct 2026");
  assert.ok(mEs.issues.some(i => /unknown fact "favouriteFood"/.test(i.msg)));
});

test("lore · a link without a summary is allowed", () => {
  const m = world({ sources: SOURCES, entries: { taldorei: { references: [{ source: "cr-wiki", url: WIKI + "Tal%27Dorei" }] } } });
  const lo = m.placeById.get("taldorei").lore;
  assert.equal(lo.summary, "");
  assert.deepEqual(lo.facts, []);
  assert.deepEqual(errorsOf(m), []);
});

test("lore · missing translation falls back to English and is flagged", () => {
  const lore = { sources: SOURCES, entries: { emon: { summary: "Capital of Tal'Dorei.", references: [{ source: "cr-wiki", url: WIKI + "Emon" }] } } };
  const lo = world(lore, { lore: {} }, "es-AR").placeById.get("emon").lore;
  assert.equal(lo.summary, "Capital of Tal'Dorei.");
  assert.equal(lo.summaryLang, "en");
  assert.equal(lo.summaryFallback, true);
  assert.equal(world(lore, null, "en").placeById.get("emon").lore.summaryFallback, false, "English is never a fallback");
});

test("lore · translations for unknown entities or facts without English source are reported", () => {
  const raw = { characters: PCS, npcs: NPCS, locations: PLACES,
    lore: { sources: SOURCES, entries: { pelor: { summary: "x", facts: { domains: "Life" }, references: [{ source: "cr-wiki", url: WIKI + "The_Dawnfather" }] } } } };
  const msgs = Model.checkTranslations(raw, { lore: { nobody: { summary: "y" }, emon: { summary: "z" }, pelor: { facts: { symbol: "s" } } } }, "es-AR").map(i => i.msg);
  assert.ok(msgs.some(m => /unknown lore entity "nobody"/.test(m)));
  assert.ok(msgs.some(m => /lore "emon" has no English entry/.test(m)));
  assert.ok(msgs.some(m => /fact "symbol" has no English source/.test(m)));
});

test("lore · no unverified content: summaries/facts need a reference; unknown entities are errors", () => {
  const m = world({ sources: SOURCES, entries: {
    emon: { summary: "Unsourced claim." },
    pelor: { facts: { domains: "Life" }, references: [] },
    ghost: { summary: "x", references: [{ source: "cr-wiki", url: WIKI + "Ghost" }] },
  } });
  assert.equal(m.placeById.get("emon").lore, null);
  assert.equal(m.personById.get("pelor").lore, null);
  const errs = errorsOf(m);
  assert.ok(errs.some(e => /entries\["emon"\]: a summary or facts need at least one valid reference/.test(e)));
  assert.ok(errs.some(e => /entries\["pelor"\]: a summary or facts need/.test(e)));
  assert.ok(errs.some(e => /entries\["ghost"\]: unknown person or place id/.test(e)));
  assert.ok(world({ sources: SOURCES, entries: { emon: { summary: Array(130).fill("word").join(" "), references: [{ source: "cr-wiki", url: WIKI + "Emon" }] } } })
    .issues.some(i => /keep it brief/.test(i.msg)));
  assert.deepEqual(errorsOf(world([])), ["lore.json must be a JSON object { sources, entries }"]);
});

// ── Separation: lore never touches campaign data ────────────────────────────
test("integration · campaign data, relations, links and search are identical with and without lore", () => {
  const raw = loadRealData();
  const opts = locale => ({ locale, t: I18N.createTranslator(locale), translations: { "es-AR": loadContent("es-AR") } });
  for (const locale of ["en", "es-AR"]) {
    const withLore = Model.build(raw, opts(locale)), without = Model.build({ ...raw, lore: undefined }, opts(locale));
    for (const k of ["events", "sessions", "quests", "people", "places"]) assert.deepEqual(strip(withLore[k]), strip(without[k]), `${locale} ${k}`);
    const campaignIssues = m => m.issues.filter(i => !/\blore\b/.test(i.msg));
    assert.deepEqual(campaignIssues(withLore), campaignIssues(without));
    assert.deepEqual(withLore.issues.filter(i => /\blore\b/.test(i.msg)), [], "the real lore is clean");
    assert.deepEqual(Model.search(withLore, "Letherna"), { people: [], quests: [], places: [], sessions: [] }, "lore text is not searchable campaign data");
  }
  const m = buildReal("en");
  assert.equal(m.personById.get("pelor").name, "Pelor", "our name is kept (wiki title is 'The Dawnfather')");
  assert.deepEqual(m.personById.get("pelor").relations.map(r => r.id).sort(), ["ayante", "sorfon", "torog"], "no relations derived from lore");
  assert.deepEqual(m.personById.get("cassandra").eventIds, buildReal("en").personById.get("cassandra").eventIds);
});

// ── The real lore file ──────────────────────────────────────────────────────
test("real data · every lore entry is sourced, https-only, reviewed, bilingual and spoiler-flagged", () => {
  const lore = readJson("data/lore.json"), es = loadContent("es-AR");
  const en = buildReal("en"), sp = buildReal("es-AR");
  assert.deepEqual(en.issues.filter(i => /lore/i.test(i.msg)), []);
  assert.ok(en.lore.size >= 20, `${en.lore.size} entities with lore`);
  for (const [id, lo] of en.lore) {
    assert.ok(lo.references.length >= 1, id);
    lo.references.forEach(r => {
      assert.ok(r.url.startsWith("https://criticalrole.fandom.com/wiki/"), `${id}: ${r.url}`);
      assert.equal(r.source, "cr-wiki");
      assert.ok(r.title, `${id}: article title`);
    });
    assert.equal(lo.spoilers, true, id);
    assert.match(lo.lastReviewed, /^\d{4}-\d{2}-\d{2}$/, id);
    const words = lo.summaryEn.split(/\s+/).length;
    assert.ok(words >= 15 && words <= 80, `${id}: ${words} words`);
    assert.ok(!/<[a-z/!]/i.test(JSON.stringify(lore.entries[id]) + JSON.stringify(es.lore[id] || {})), `${id}: no HTML`);
    const s = sp.personById.get(id) || sp.placeById.get(id);
    assert.ok(es.lore[id] && es.lore[id].summary, `${id}: Spanish summary`);
    assert.equal(s.lore.summaryFallback, false, id);
    assert.notEqual(s.lore.summary, lo.summary, `${id}: translated`);
  }
  assert.equal(lore.sources["cr-wiki"].community, true, "the CR Wiki is identified as a community wiki");
  // Party members and the DM's own NPCs carry no external lore.
  en.pcs.forEach(p => assert.equal(p.lore, null, p.id));
  ["diomedes", "marco", "locus", "caval", "tyr", "ubu", "sorfons-mother", "metrodidacts", "sarenraes-faithful"].forEach(id => assert.equal(en.personById.get(id).lore, null, id));
});

test("i18n · every lore interface key exists in both locales (incl. fact labels)", () => {
  for (const code of ["en", "es-AR"]) {
    for (const k of ["heading", "hint", "noSummary", "inEnglish", "readMore", "community", "newTab", "basedOn", "reviewed", "precedence"])
      assert.ok(I18N.get(I18N.dicts[code], `lore.${k}`), `${code} lore.${k}`);
    Model.LORE_FACTS.forEach(k => assert.ok(I18N.get(I18N.dicts[code], `lore.fact.${k}`), `${code} lore.fact.${k}`));
    const t = I18N.createTranslator(code);
    assert.match(t("lore.spoiler", { count: 1 }), /Critical Role/);
    assert.notEqual(t("lore.spoiler", { count: 1 }), t("lore.spoiler", { count: 2 }));
  }
  assert.equal(I18N.createTranslator("es-AR")("lore.spoiler", { count: 1 }), "El artículo externo puede contener spoilers del universo de Critical Role.");
});

test("template · the lore section is a collapsed disclosure keyed per entity, placed after the campaign sections", () => {
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const tag = /<details class="cc-disc cc-lore"[^>]*>/.exec(html);
  assert.ok(tag, "lore disclosure exists");
  assert.ok(!/\bopen\b/.test(tag[0]), "not open by default");
  assert.match(tag[0], /key="\{\{ lo\.key \}\}"/);
  const at = html.indexOf(tag[0]);
  assert.ok(at > html.indexOf("<!-- CHARACTER -->") && at > html.indexOf("<!-- PLACE -->") && at < html.indexOf("cc-prevnext\""), "after both entity sections");
});
