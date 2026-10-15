// Shared fixtures for the unit tests (node --test). Small synthetic campaigns keep each
// rule visible; tests that need the real campaign read data/*.json through loadRealData().
"use strict";
const fs = require("fs");
const path = require("path");
const Model = require("../js/chronicle-model.js");
const MapL = require("../js/chronicle-map.js");
const I18N = require("../js/i18n.js");
I18N.register("en", require("../locales/en.js"));
I18N.register("es-AR", require("../locales/es-AR.js"));

const ROOT = path.resolve(__dirname, "..");
const readJson = rel => JSON.parse(fs.readFileSync(path.join(ROOT, rel), "utf8"));
// Source text with LF line ends: on Windows checkouts (core.autocrlf) the files are CRLF on disk,
// and the tests read index.html by its lines.
const readText = rel => fs.readFileSync(path.join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");

const PCS = [
  { id: "ayante", name: "Ayante", color: "#3D3830" },
  { id: "ereldra", name: "Ereldra", color: "#474B68" },
  { id: "mortis", name: "Mortis", color: "#858590" },
  { id: "sorfon", name: "Sorfon", color: "#C49B6A" },
];

// ev("id", ["ayante"], { xp, yp, questIds, … })
const ev = (id, characterIds, extra) => ({ id, session: 1, campaignDay: 1, title: `Event ${id}`, summary: `Summary ${id}`, characterIds, ...(extra || {}) });

function campaign(events, more) {
  return Model.build({
    characters: PCS, npcs: [], locations: [], routes: {},
    sessions: { 1: { title: "One", playedOn: "2026-01-01" }, 2: { title: "Two", playedOn: "2026-01-08" } },
    quests: [{ id: "q1", title: "Quest one", status: "active", sessions: [1, 2] }, { id: "q2", title: "Quest two", status: "completed", sessions: [1, 2] }],
    events, ...(more || {}),
  });
}

function loadRealData() {
  return {
    characters: readJson("data/characters.json"), routes: readJson("data/routes.json"), events: readJson("data/events.json"),
    sessions: readJson("data/sessions.json"), quests: readJson("data/quests.json"), npcs: readJson("data/npcs.json"),
    locations: readJson("data/locations.json"), lore: readJson("data/lore.json"),
  };
}
const loadContent = code => readJson(`data/i18n/${code}.json`);

function buildReal(locale) {
  const raw = loadRealData(), translations = { "es-AR": loadContent("es-AR") };
  return Model.build(raw, { locale, t: I18N.createTranslator(locale), translations,
    searchTs: I18N.LOCALES.map(l => I18N.createTranslator(l.code)) });
}

const ids = list => list.map(e => e.id);

module.exports = { Model, MapL, I18N, ROOT, PCS, ev, campaign, loadRealData, loadContent, buildReal, readJson, readText, ids };
