#!/usr/bin/env node
// Validates data/*.json: JSON syntax, unique ids, cross-references, asset paths,
// route waypoints, the Exandria lore layer (data/lore.json: https-only links, every
// summary sourced) and the content translations in data/i18n/<locale>.json.
// Uses the same model the page uses (js/chronicle-model.js), so anything that
// passes here loads in the browser. Exit code 1 on errors; warnings don't fail.
//
//   node tools/validate-data.js
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

let errors = 0, warnings = 0;
const err  = m => { errors++;   console.error("  ✗ " + m); };
const warn = m => { warnings++; console.warn("  ! " + m); };

const raw = {};
console.log("Parsing data/*.json");
for (const [name, spec] of Object.entries(FILES)) {
  const file = path.join(ROOT, "data", name + ".json");
  if (!fs.existsSync(file)) { (spec.required ? err : warn)(`data/${name}.json is missing`); raw[name] = spec.shape === "array" ? [] : {}; continue; }
  try {
    const v = JSON.parse(fs.readFileSync(file, "utf8"));
    const ok = spec.shape === "array" ? Array.isArray(v) : v && typeof v === "object" && !Array.isArray(v);
    if (!ok) err(`data/${name}.json must be a JSON ${spec.shape}`);
    raw[name] = v;
  } catch (e) { err(`data/${name}.json: ${e.message}`); raw[name] = spec.shape === "array" ? [] : {}; }
}

console.log("Checking references");
const m = Model.build(raw);
m.issues.forEach(i => (i.level === "error" ? err : warn)(i.msg));

// Coordinates must be percentages of the map image.
m.events.forEach(e => {
  if (e.hasCoords && (e.xp < 0 || e.xp > 100 || e.yp < 0 || e.yp > 100)) err(`Event "${e.id}": xp/yp must be 0–100 (% of the map)`);
});
Object.entries(m.routes).forEach(([id, pts]) => {
  if (!Array.isArray(pts)) { err(`routes.json["${id}"] must be an array`); return; }
  pts.forEach((p, i) => {
    const at = `routes.json["${id}"][${i}]`;
    if (!p || typeof p.xp !== "number" || typeof p.yp !== "number") return err(`${at} needs numeric xp/yp`);
    if (p.xp < 0 || p.xp > 100 || p.yp < 0 || p.yp > 100) err(`${at}: xp/yp must be 0–100 (% of the map)`);
    if (p.leg != null && (typeof p.leg !== "string" || !p.leg)) err(`${at}: "leg" must be a non-empty string id`);
    if (p.break != null && typeof p.break !== "boolean") err(`${at}: "break" must be true or false`);
    if (p.session != null && typeof p.session !== "number") err(`${at}: "session" must be a session number`);
  });
});
// A shared leg id must be used by at least two characters (otherwise it is just a solo route).
const legUse = {};
m.routeById.forEach((r, id) => r.legIds.forEach(leg => (legUse[leg] = legUse[leg] || []).push(id)));
Object.entries(legUse).forEach(([leg, ids]) => { if (ids.length < 2) warn(`routes.json: leg "${leg}" is only used by ${ids[0]} — shared legs need two or more characters`); });

// Content translations (data/i18n/<locale>.json): JSON syntax, unknown ids, positional arrays.
console.log("Checking content translations");
const coverage = [];
I18N.LOCALES.filter(l => l.code !== I18N.FALLBACK_LOCALE).forEach(l => {
  const file = path.join(ROOT, "data", "i18n", l.code + ".json");
  if (!fs.existsSync(file)) { warn(`data/i18n/${l.code}.json is missing — that language shows the English text`); return; }
  let content;
  try { content = JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) { err(`data/i18n/${l.code}.json: ${e.message}`); return; }
  Model.checkTranslations(raw, content, l.code).forEach(i => (i.level === "error" ? err : warn)(i.msg));
  const has = (kind, ids) => ids.filter(id => content[kind] && content[kind][id]).length;
  const logged = m.sessions.filter(s => !s.isStub);
  const lore = [...m.lore.values()].filter(x => x.summaryEn);
  coverage.push(`${l.code}: events ${has("events", m.events.map(e => e.id))}/${m.events.length} · sessions ${has("sessions", logged.map(s => String(s.no)))}/${logged.length} · quests ${has("quests", m.quests.map(q => q.id))}/${m.quests.length} · lore summaries ${lore.filter(x => content.lore && content.lore[x.entityId] && content.lore[x.entityId].summary).length}/${lore.length}`);
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

// Lore links to party members are allowed but unusual (player characters are our own creations).
m.lore.forEach((x, id) => { const p = m.personById.get(id); if (p && p.kind === "pc") warn(`lore.json: "${id}" is a party member — lore is meant for entities that exist in Exandria's canon`); });

const mapless = m.events.filter(e => !e.hasCoords).length;
console.log(`\n${m.events.length} events (${mapless} without map position) · ${m.sessions.length} sessions · ${m.quests.length} quests · ${m.pcs.length} PCs · ${m.npcs.length} NPCs/factions · ${m.places.length} places · lore for ${m.lore.size} entities (${[...m.lore.values()].reduce((n, x) => n + x.references.length, 0)} links)`);
coverage.forEach(c => console.log("Translated " + c));
if (unmatched.size) console.log(`Session-log entries not linked to an entity (fine for items; add an alias to link them): ${[...unmatched].join(", ")}`);
console.log(errors ? `\n${errors} error(s), ${warnings} warning(s)` : `\nOK — ${warnings} warning(s)`);
process.exit(errors ? 1 : 0);
