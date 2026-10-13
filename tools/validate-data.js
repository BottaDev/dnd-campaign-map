#!/usr/bin/env node
// Validates data/*.json: JSON syntax, unique ids, cross-references, asset paths.
// Uses the same model the page uses (js/chronicle-model.js), so anything that
// passes here loads in the browser. Exit code 1 on errors; warnings don't fail.
//
//   node tools/validate-data.js
"use strict";
const fs = require("fs");
const path = require("path");
const Model = require("../js/chronicle-model.js");

const ROOT = path.resolve(__dirname, "..");
const FILES = {
  characters: { required: true,  shape: "array" },
  routes:     { required: true,  shape: "object" },
  events:     { required: true,  shape: "array" },
  sessions:   { required: true,  shape: "object" },
  quests:     { required: true,  shape: "array" },
  npcs:       { required: false, shape: "array" },
  locations:  { required: false, shape: "array" },
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
  pts.forEach((p, i) => { if (typeof p.xp !== "number" || typeof p.yp !== "number") err(`routes.json["${id}"][${i}] needs numeric xp/yp`); });
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

const mapless = m.events.filter(e => !e.hasCoords).length;
console.log(`\n${m.events.length} events (${mapless} without map position) · ${m.sessions.length} sessions · ${m.quests.length} quests · ${m.pcs.length} PCs · ${m.npcs.length} NPCs/factions · ${m.places.length} places`);
if (unmatched.size) console.log(`Session-log entries not linked to an entity (fine for items; add an alias to link them): ${[...unmatched].join(", ")}`);
console.log(errors ? `\n${errors} error(s), ${warnings} warning(s)` : `\nOK — ${warnings} warning(s)`);
process.exit(errors ? 1 : 0);
