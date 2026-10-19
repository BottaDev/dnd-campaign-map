#!/usr/bin/env node
// Validates data/*.json: JSON syntax, unique ids, cross-references, asset paths,
// route waypoints, the Exandria lore layer (data/lore.json: https-only links, every
// summary sourced) and the content translations in data/i18n/<locale>.json.
// Uses the same model the page uses (js/chronicle-model.js) — the rules that need no
// file system are ChronicleModel.validateData, which the Taller del Cronista runs in the
// browser too — so anything that passes here loads in the browser. Exit code 1 on
// errors; warnings don't fail.
//
//   node tools/validate-data.js
//   node tools/validate-data.js --data <folder>   check a package exported from the Taller before
//                                                 copying it in: <folder>/<name>.json (and
//                                                 <folder>/i18n/<locale>.json) replace the repo's
//                                                 files of the same name; the others are the repo's.
"use strict";
const fs = require("fs");
const path = require("path");
const Model = require("../js/chronicle-model.js");
const I18N = require("../js/i18n.js");

const ROOT = path.resolve(__dirname, "..");
const FILES = {
  characters: { required: true,  shape: "array" },
  routes:     { required: true,  shape: "object" },
  events:     { required: true,  shape: "array" },
  sessions:   { required: true,  shape: "object" },
  quests:     { required: true,  shape: "array" },
  npcs:       { required: false, shape: "array" },
  locations:  { required: false, shape: "array" },
  lore:       { required: false, shape: "object" },
};

const argAt = process.argv.indexOf("--data");
const OVERRIDE = argAt > 0 ? path.resolve(process.argv[argAt + 1] || "") : null;
if (OVERRIDE && !fs.existsSync(OVERRIDE)) { console.error(`--data: folder not found: ${OVERRIDE}`); process.exit(1); }
// A data file: the override folder's copy when it has one, else the repository's.
const dataFile = rel => {
  const own = OVERRIDE && path.join(OVERRIDE, rel);
  return own && fs.existsSync(own) ? own : path.join(ROOT, "data", rel);
};
const shown = file => path.relative(ROOT, file).split(path.sep).join("/");

let errors = 0, warnings = 0;
const err  = m => { errors++;   console.error("  ✗ " + m); };
const warn = m => { warnings++; console.warn("  ! " + m); };

const raw = {};
console.log(OVERRIDE ? `Parsing data/*.json (files in ${OVERRIDE} take precedence)` : "Parsing data/*.json");
for (const [name, spec] of Object.entries(FILES)) {
  const file = dataFile(name + ".json");
  if (OVERRIDE && !file.startsWith(ROOT + path.sep)) console.log(`  · ${name}.json from ${file}`);
  if (!fs.existsSync(file)) { (spec.required ? err : warn)(`data/${name}.json is missing`); raw[name] = spec.shape === "array" ? [] : {}; continue; }
  try {
    const v = JSON.parse(fs.readFileSync(file, "utf8"));
    const ok = spec.shape === "array" ? Array.isArray(v) : v && typeof v === "object" && !Array.isArray(v);
    if (!ok) err(`data/${name}.json must be a JSON ${spec.shape}`);
    raw[name] = v;
  } catch (e) { err(`${shown(file)}: ${e.message}`); raw[name] = spec.shape === "array" ? [] : {}; }
}

// Content translations (data/i18n/<locale>.json): JSON syntax here; unknown ids and positional arrays below.
const translations = {};
I18N.LOCALES.filter(l => l.code !== I18N.FALLBACK_LOCALE).forEach(l => {
  const file = dataFile(path.join("i18n", l.code + ".json"));
  if (!fs.existsSync(file)) { warn(`data/i18n/${l.code}.json is missing — that language shows the English text`); return; }
  try { translations[l.code] = JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) { err(`${shown(file)}: ${e.message}`); }
});

console.log("Checking references, map positions, routes and translations");
const { model: m, issues } = Model.validateData(raw, { translations });
issues.forEach(i => (i.level === "error" ? err : warn)(i.msg));

const coverage = Object.entries(translations).map(([code, content]) => {
  const has = (kind, ids) => ids.filter(id => content[kind] && content[kind][id]).length;
  const logged = m.sessions.filter(s => !s.isStub);
  const lore = [...m.lore.values()].filter(x => x.summaryEn);
  return `${code}: events ${has("events", m.events.map(e => e.id))}/${m.events.length} · sessions ${has("sessions", logged.map(s => String(s.no)))}/${logged.length} · quests ${has("quests", m.quests.map(q => q.id))}/${m.quests.length} · lore summaries ${lore.filter(x => content.lore && content.lore[x.entityId] && content.lore[x.entityId].summary).length}/${lore.length}`;
});
// Asset paths referenced from data must exist (relative paths keep GitHub Pages working).
m.people.forEach(p => ["sealImg", "portrait"].forEach(k => {
  if (!p[k]) return;
  if (/^(\/|[a-z]+:)/i.test(p[k])) warn(`Person "${p.id}": ${k} "${p[k]}" is absolute — use a relative path for GitHub Pages`);
  else if (!fs.existsSync(path.join(ROOT, p[k]))) err(`Person "${p.id}": ${k} "${p[k]}" not found`);
}));
// Session-log notes that did not match any person/place (informational).
const unmatched = new Set();
m.sessions.forEach(s => [...s.activePlots, ...s.completedPlots].forEach(p => p.npcs.forEach(n => {
  const k = String(n.name || "").toLowerCase().replace(/\s+/g, " ").trim();
  const known = m.people.some(x => [x.name, ...x.aliases].some(a => a.toLowerCase() === k)) || m.places.some(x => [x.name, ...x.aliases].some(a => a.toLowerCase() === k));
  if (!known) unmatched.add(n.name);
})));

// The offline copy (sw.js) must list files that exist, or the service worker cannot install.
const swFile = path.join(ROOT, "sw.js");
if (fs.existsSync(swFile)) {
  const sw = fs.readFileSync(swFile, "utf8"), list = /const PRECACHE = \[([\s\S]*?)\];/.exec(sw);
  if (!list) warn("sw.js: PRECACHE list not found");
  else [...list[1].matchAll(/"([^"]+)"/g)].map(x => x[1]).filter(f => f !== "./").forEach(f => { if (!fs.existsSync(path.join(ROOT, f))) err(`sw.js precaches "${f}", which does not exist (bump VERSION after fixing the list)`); });
  ["characters", "routes", "events", "sessions", "quests", "npcs", "locations", "lore"].forEach(n => {
    if (fs.existsSync(path.join(ROOT, "data", n + ".json")) && list && !list[1].includes(`"data/${n}.json"`)) warn(`sw.js does not precache data/${n}.json — it would be missing offline`);
  });
}

// What is still to be written (never filled in automatically): unchronicled sessions, events without
// narrative depth, sessions without an editorial recap. Informational only.
const gaps = Model.sessionListItems(m, { order: "asc" }).filter(it => it.gap).map(it => (it.from === it.to ? `${it.from}` : `${it.from}–${it.to}`));
const deep = m.events.filter(e => e.description || e.consequences.length || e.unresolved.length).length;
const curated = m.sessions.filter(s => s.recap.highlightIds.length || s.recap.summaryEn).length;

const mapless = m.events.filter(e => !e.hasCoords).length;
const placed = m.places.filter(p => p.ref).length;
console.log(`\n${m.events.length} events (${mapless} without map position) · ${m.sessions.length} sessions · ${m.quests.length} quests · ${m.pcs.length} PCs · ${m.npcs.length} NPCs/factions · ${m.places.length} places (${placed} with their own map position) · lore for ${m.lore.size} entities (${[...m.lore.values()].reduce((n, x) => n + x.references.length, 0)} links)`);
coverage.forEach(c => console.log("Translated " + c));
console.log(`Pending to write: sessions not chronicled ${gaps.length ? gaps.join(", ") : "none"} · events with description/consequences/unresolved ${deep}/${m.events.length} · sessions with an editorial recap ${curated}/${m.sessions.filter(s => !s.isStub).length}`);
if (unmatched.size) console.log(`Session-log entries not linked to an entity (fine for items; add an alias to link them): ${[...unmatched].join(", ")}`);
// Places index: top-level places of the Atlas other than continents (informational — a parent is never inferred;
// add parentId only when the campaign records where the place lies).
const loose = m.places.filter(p => !p.parentId && !p.isPlanar && p.kind !== "continent");
if (loose.length) console.log(`Places at the top level of the Atlas (no parentId; fine unless the campaign recorded where they lie): ${loose.map(p => p.nameEn).join(", ")}`);
console.log(errors ? `\n${errors} error(s), ${warnings} warning(s)` : `\nOK — ${warnings} warning(s)`);
process.exit(errors ? 1 : 0);
