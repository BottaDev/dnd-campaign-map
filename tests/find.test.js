// The Sessions and Quests searches (ChronicleModel.findSessions / findQuests / excerpt): a filter over each
// list, never a ranking — session numbers, titles, what was recorded and what is explicitly linked (people,
// places with the places they lie in, quests), in either language, without accents or case; the part that
// says why an entry appeared; nothing found through links of links. Plus their wiring in index.html.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { Model, I18N, PCS, buildReal, readText } = require("./helpers");

const es = buildReal("es-AR"), en = buildReal("en");
const sessionsOf = (m, q) => [...Model.findSessions(m, q).hits.keys()].sort((a, b) => a - b);
const questsOf = (m, q) => [...Model.findQuests(m, q).hits.keys()].sort();

// A small campaign where every link is visible (English source + a Spanish overlay).
const content = {
  people: { cass: { aliases: ["Casi", "La heredera"] } },          // two aliases for one in English: they do not line up
  sessions: { 1: { title: "Llegada a Emon", activePlots: [{ notes: ["Un kobold dejó huellas hacia las cloacas."] }] } },
  quests: { censer: { title: "El incensario perdido", summary: "Recuperar el incensario del dios sol.", objectives: ["Encontrar al ladrón kobold", "Devolver el incensario a la capilla"] } },
};
function tiny(locale) {
  return Model.build({
    characters: PCS, routes: {},
    npcs: [{ id: "cass", name: "Cassandra de Rolo", aliases: ["Cass"] }, { id: "pike", name: "Pike Trickfoot" }, { id: "ghost", name: "Ghostly Monk" }],
    locations: [{ id: "vass", name: "Vasselheim", kind: "city" }, { id: "chapel", name: "Chapel of Pelor", kind: "site", parentId: "vass" }, { id: "emon", name: "Emon", kind: "city" }],
    sessions: {
      1: { title: "Arrival in Emon", startedHere: "The docks of Emon at dawn.", endedHere: "A tavern by the river.", effects: ["Blessed by the sun"],
        activePlots: [{ name: "Plot A — The lost censer", questId: "censer", qt: "The censer was stolen.", notes: ["A kobold left tracks to the sewers."], npcs: [{ name: "Cassandra de Rolo", role: "waiting in Whitestone" }] }] },
      2: { title: "The Chapel", startedHere: "Rain over the city." },
      4: { title: "Later" },
    },
    events: [
      { id: "e1", session: 1, campaignDay: 1, title: "The docks", summary: "The party lands.", locationId: "emon", characterIds: ["ayante"] },
      { id: "e2", session: 2, campaignDay: 2, title: "Vigil", summary: "A quiet night of prayer.", locationId: "chapel", npcIds: ["ghost"], questIds: ["censer"], type: "revelation" },
      { id: "e3", session: 4, campaignDay: 3, title: "Council", summary: "Twelve candles and nothing else.", characterIds: ["mortis"] },
    ],
    quests: [
      { id: "censer", title: "The Lost Censer", status: "active", giverId: "pike", summary: "Recover the sun god's censer.", objectives: ["Find the kobold thief", "Return the censer to the chapel"], sessions: [1, 2], characterIds: ["sorfon"] },
      { id: "debt", title: "The Debt", status: "completed", giver: "Allura", summary: "Repay Allura in gold.", sessions: [4] },
    ],
  }, { locale, t: I18N.createTranslator(locale), translations: { "es-AR": content }, searchTs: I18N.LOCALES.map(l => I18N.createTranslator(l.code)) });
}
const tes = tiny("es-AR"), ten = tiny("en");

test("1 · Sessions: a session number means that session only — never stray digits", () => {
  for (const q of ["12", "s12", "Sesión 12", "SESIÓN 12", "sesion 12", "Session 12", "  12  "]) {
    const r = Model.findSessions(es, q);
    assert.equal(r.number, 12, q);
    assert.deepEqual([...r.hits.keys()], [12], q);
    assert.equal(r.hits.get(12).field, "number", `${q}: found by its number, nothing to explain`);
  }
  assert.deepEqual(sessionsOf(es, "1"), [1], "1 is session 1, not 10, 11 or 12");
  assert.deepEqual(sessionsOf(es, "3"), [], "an unchronicled number finds nothing");
  assert.equal(Model.findSessions(es, "3").number, 3, "…and says which number it was");
  assert.deepEqual(sessionsOf(es, "867"), [], "digits inside the logs (\"38 Horisal 867\") are not a session number");
  assert.deepEqual(sessionsOf(tes, "12"), [], "no session 12 here: a number never falls back to the logs' text");
});

test("2 · Sessions: the title, partly typed, in either language", () => {
  const titled = (m, q) => [...Model.findSessions(m, q).hits].filter(([, h]) => h.field === "title").map(([no]) => no);
  for (const m of [es, en]) {
    for (const [q, no] of [["vigilados", 10], ["Watched", 10], ["watch", 10], ["pacto bajo", 1], ["Beneath", 1], ["cacer", 12], ["Councils", 12]])
      assert.deepEqual(titled(m, q), [no], `${m.locale}: “${q}” is in session ${no}'s title (other sessions may hold it elsewhere)`);
  }
  // "Watched" is also the quest "Hunted and Watched": the sessions it moved are found too — by that quest
  // (11 and 12 never use the word in their own log; a later log may, and is then found by its own text).
  const watched = Model.findSessions(es, "Watched").hits;
  assert.deepEqual([watched.get(11).field, watched.get(12).field], ["quest", "quest"]);
  assert.deepEqual(sessionsOf(tes, "arriv"), [1]);
  assert.deepEqual(sessionsOf(tes, "llegada"), [1], "the Spanish title");
});

test("3 · Sessions: what was recorded — opening and closing lines, plots, effects, the events' own text", () => {
  const field = (m, q, no) => Model.findSessions(m, q).hits.get(no).field;
  assert.equal(field(ten, "docks of emon", 1), "opening");
  assert.equal(field(ten, "tavern", 1), "ending");
  assert.equal(field(ten, "blessed", 1), "effect");
  assert.equal(field(ten, "sewers", 1), "plot", "a note of the session's plot");
  assert.equal(field(tes, "cloacas", 1), "plot", "…in Spanish too");
  assert.equal(field(ten, "quiet night", 2), "event", "an event's summary");
  assert.equal(field(ten, "revelation", 2), "event", "an event's kind");
  assert.equal(field(tes, "revelacion", 2), "event", "…named in Spanish, without its accent");
  assert.equal(Model.findSessions(tes, "revelacion").hits.get(2).text, "Revelación — Vigil", "the kind and the event it names");
  // The real campaign: "incienso" is told in an event (8), an opening line (10), a plot (11) and an effect (12).
  const r = Model.findSessions(es, "incienso");
  assert.deepEqual([8, 10, 11, 12].map(no => r.hits.has(no) && r.hits.get(no).field), ["event", "opening", "plot", "effect"]);
  for (const h of r.hits.values()) assert.ok(Model.fold(h.text).includes("incienso"), `the reason shows the word: ${h.text}`);
});

test("4 · Sessions: people, places and quests linked to them — explicitly, never through links of links", () => {
  const hit = (q, no) => Model.findSessions(ten, q).hits.get(no);
  assert.equal(hit("ghostly", 2).field, "person", "an NPC of one of its events");
  assert.equal(hit("cass", 1).field, "plot", "a name recorded in its log (the alias)");
  assert.deepEqual(sessionsOf(ten, "Vasselheim"), [2], "an event at the chapel, recorded inside Vasselheim");
  assert.equal(hit("vasselheim", 2).field, "place");
  assert.equal(hit("vasselheim", 2).text, "Vasselheim");
  assert.deepEqual(sessionsOf(ten, "emon"), [1]);
  assert.equal(hit("lost censer", 2).field, "quest", "a quest one of its events moved");
  // Not through the quest: its giver, summary or objectives do not make the session match.
  assert.deepEqual(sessionsOf(ten, "pike"), [], "the quest's giver is not in these sessions");
  assert.deepEqual(sessionsOf(ten, "recover"), [], "the quest's summary is the quest's own text");
  assert.deepEqual(sessionsOf(ten, "kobold thief"), [], "so are its objectives");
  // The real campaign, the examples asked for: Cassandra and Vasselheim.
  const cass = sessionsOf(es, "Cassandra"), vass = sessionsOf(es, "Vasselheim");
  [8, 10, 11, 12].forEach(n => assert.ok(cass.includes(n), `Cassandra: session ${n}`));
  [10, 11, 12].forEach(n => assert.ok(vass.includes(n), `Vasselheim: session ${n}`));
  [1, 2].forEach(n => assert.ok(!cass.includes(n) && !vass.includes(n), `session ${n} (Emon) has neither`));
  const inVass = id => id === "vasselheim" || es.placeById.get(id).ancestorIds.includes("vasselheim");
  vass.forEach(n => {
    const s = es.sessionByNo.get(n);
    assert.ok(s.placeIds.some(inVass) || /vasselheim/.test(s.findText), `session ${n} is recorded in or about Vasselheim`);
  });
});

test("5 · Sessions and Quests ignore accents and case, and read both languages", () => {
  for (const m of [es, en]) {
    assert.deepEqual(sessionsOf(m, "PELÓR"), sessionsOf(m, "pelor"), m.locale);
    assert.deepEqual(sessionsOf(m, "Revelación"), sessionsOf(m, "REVELACION"), m.locale);
    assert.ok(sessionsOf(m, "revelacion").includes(11), `${m.locale}: the revelation of session 11`);
    assert.deepEqual(sessionsOf(m, "raven queen"), sessionsOf(m, "reina cuervo"), `${m.locale}: Raven Queen`);
    assert.deepEqual(questsOf(m, "baruk"), questsOf(m, "Barûk"), m.locale);
    assert.deepEqual(questsOf(m, "incense"), questsOf(m, "incienso"), m.locale);
  }
  assert.deepEqual(sessionsOf(es, "Vasselheim"), sessionsOf(en, "Vasselheim"), "same sessions whatever the interface language");
  assert.deepEqual(questsOf(es, "Cassandra"), questsOf(en, "Cassandra"));
});

test("6 · nothing found, nothing typed", () => {
  for (const find of [Model.findSessions, Model.findQuests]) {
    const none = find(es, "zzqqxx");
    assert.equal(none.searching, true);
    assert.equal(none.hits.size, 0);
    for (const q of ["", "   ", null, undefined]) {
      const r = find(es, q);
      assert.equal(r.searching, false, JSON.stringify(q));
      assert.equal(r.hits.size, 0);
    }
  }
  assert.equal(Model.findSessions(es, "•").hits.size, 0, "the joints between texts are never found");
  assert.equal(Model.findQuests(es, "•").hits.size, 0);
});

test("7 · a search keeps the Sessions order (default oldest first, or latest first) and leaves the gaps out", () => {
  const r = Model.findSessions(es, "Vasselheim");
  const shown = order => Model.sessionListItems(es, { order }).filter(it => !it.gap && r.hits.has(it.session.no)).map(it => it.session.no);
  assert.deepEqual(shown("asc"), sessionsOf(es, "Vasselheim"), "oldest first");
  assert.deepEqual(shown("desc"), shown("asc").slice().reverse(), "latest first");
  assert.deepEqual(Model.sortOrders(null), { chronicle: "desc", sessions: "asc" }, "the default orders are untouched");
  assert.ok(Model.sessionListItems(es, {}).some(it => it.gap), "the whole list still has its gaps");
});

test("8 · Quests: title, summary, objectives, giver and the session notes that carry them", () => {
  const hit = (m, q, id) => Model.findQuests(m, q).hits.get(id);
  assert.equal(hit(es, "Barûk", "baruk-kazad").field, "title");
  assert.equal(hit(ten, "lost cens", "censer").field, "title", "partly typed");
  assert.equal(hit(ten, "recover", "censer").field, "summary", "the description");
  assert.equal(hit(ten, "kobold thief", "censer").field, "objective", "an objective");
  assert.equal(hit(tes, "ladron kobold", "censer").field, "objective", "…in Spanish, without the accent");
  assert.equal(hit(tes, "ladron kobold", "censer").text, "Encontrar al ladrón kobold", "shown in the reader's language");
  assert.equal(hit(ten, "allura", "debt").field, "summary");
  assert.equal(hit(ten, "sewers", "censer").field, "plot", "a note of a session plot linked by questId");
  assert.equal(hit(ten, "sewers", "censer").ref, 1, "…from session 1");
  assert.equal(hit(ten, "quiet night", "censer").field, "event", "an event that moved it");
  assert.deepEqual(questsOf(ten, "tavern"), [], "a session's text not linked to the quest stays out");
  // The real campaign: a word only in the summaries.
  assert.deepEqual(questsOf(es, "Whitestone").filter(id => ["cassandra", "raven-queen"].includes(id)), ["cassandra", "raven-queen"]);
});

test("9 · Quests: linked people and places (with the places they lie in), and a session number", () => {
  const hit = (q, id) => Model.findQuests(ten, q).hits.get(id);
  assert.equal(hit("pike", "censer").field, "person", "the giver (giverId)");
  assert.equal(hit("sorfon", "censer").field, "person", "a party member on the quest");
  assert.equal(hit("ghostly", "censer").field, "person", "an NPC of an event that moved it");
  assert.equal(hit("vasselheim", "censer").field, "place", "its event happened in the chapel, inside Vasselheim");
  assert.deepEqual(questsOf(ten, "emon"), [], "a place none of its events happened in");
  for (const q of ["2", "Sesión 2", "s2", "session 2"]) {
    const r = Model.findQuests(ten, q);
    assert.deepEqual([...r.hits.keys()], ["censer"], q);
    assert.deepEqual([r.hits.get("censer").field, r.hits.get("censer").ref], ["session", 2], q);
  }
  assert.deepEqual(questsOf(ten, "4"), ["debt"]);
  assert.deepEqual(questsOf(ten, "3"), [], "no quest in an unrecorded session");
  assert.equal(Model.findQuests(es, "Sesión 8").hits.size, es.quests.filter(q => q.progress.some(p => p.session === 8)).length);
});

test("10 · Quests: the search and the status filter combine (AND) without touching each other", () => {
  const r = Model.findQuests(es, "Cassandra");
  const shown = status => es.quests.filter(q => (status === "all" || q.status === status) && r.hits.has(q.id)).map(q => q.id);
  const active = shown("active"), done = shown("completed"), all = shown("all");
  assert.ok(active.length > 0 && done.length > 0, "Cassandra appears in quests of both statuses");
  assert.deepEqual(all.slice().sort(), [...active, ...done].sort(), "all = active + completed");
  assert.ok(active.includes("cassandra") && active.every(id => es.questById.get(id).status === "active"));
  assert.ok(done.every(id => es.questById.get(id).status === "completed"));
  assert.equal(r.hits.size, all.length, "the words alone do not depend on the status");
});

test("11 · the excerpt: around the first word found, cut between words, marked where the words are", () => {
  const short = Model.excerpt("Short text about Pelor.", "pelor");
  assert.deepEqual(short, { text: "Short text about Pelor.", ranges: [[17, 22]] }, "a short text stays whole");
  const long = "The custodian of the chapel waited through the night while the party argued in the square about the price of the scrolls, and only at dawn did anyone remember the sealed urn of incense resting on the altar of Pelor beside the open crypt.";
  const ex = Model.excerpt(long, "urn of incense");
  assert.ok(ex.text.startsWith("…") && !ex.text.endsWith("……"), ex.text);
  const mid = Model.excerpt(long, "square");
  assert.ok(mid.text.startsWith("…") && mid.text.endsWith("…"), `cut on both sides: ${mid.text}`);
  assert.ok(ex.text.length <= 162, `${ex.text.length} characters`);
  const words = ex.ranges.map(([a, b]) => ex.text.slice(a, b));
  assert.deepEqual(words, ["urn", "of", "incense"], "it opens before the longest word, not at an early “of”");
  assert.ok(ex.text.includes("sealed urn of incense resting"), ex.text);
  assert.ok(long.includes(ex.text.slice(1, -1)), "the text itself, never rewritten");
  assert.equal(long[long.indexOf(ex.text.slice(1, -1)) - 1], " ", "it starts at a word");
  const none = Model.excerpt(long, "dragon");
  assert.ok(!none.text.startsWith("…") && none.text.endsWith("…") && none.ranges.length === 0, "no word in it: its beginning, unmarked");
  assert.deepEqual(Model.excerpt("Revelación de Ilión", "REVELACION").ranges, [[0, 10]], "accents and case");
  assert.deepEqual(Model.excerpt("", "x"), { text: "", ranges: [] });
});

test("12 · every place a word can be found has a label in both languages", () => {
  const fields = new Set([es, tes].flatMap(m => [...m.sessions, ...m.quests, ...m.people].flatMap(x => x.find)).map(p => p.field));
  ["opening", "ending", "event", "plot", "effect", "date", "quest", "person", "place", "summary", "objective", "giver", "alias", "race", "role"].forEach(f => assert.ok(fields.has(f), `the model finds words in "${f}"`));
  fields.delete("title"); fields.delete("name");            // a title or a name needs no label (the card shows it)
  for (const code of ["en", "es-AR"]) for (const f of fields) {
    const v = I18N.get(I18N.dicts[code], `find.field.${f}`);
    assert.ok(typeof v === "string" && v.trim(), `${code}: find.field.${f}`);
  }
  const t = I18N.createTranslator("es-AR"), e = I18N.createTranslator("en");
  assert.equal(t("sessions.found", { shown: 3, count: 18 }), "3 de 18 sesiones");
  assert.equal(t("sessions.found", { shown: 1, count: 6 }), "1 de 6 sesiones", "the plural follows the total");
  assert.equal(t("quests.found", { shown: 4, count: 20 }), "4 de 20 misiones");
  assert.equal(e("quests.found", { shown: 4, count: 20 }), "4 of 20 quests");
  assert.equal(t("sessions.none"), "No encontramos sesiones que coincidan con tu búsqueda.");
  assert.equal(t("quests.none"), "No encontramos misiones que coincidan con tu búsqueda.");
  assert.equal(t("sessions.findPlaceholder"), "Buscar sesiones por número, título o contenido…");
  assert.equal(t("quests.findPlaceholder"), "Buscar misiones por nombre o contenido…");
  assert.equal(t("characters.found", { shown: 3, count: 42 }), "3 de 42 personajes");
  assert.equal(e("characters.found", { shown: 1, count: 42 }), "1 of 42 characters");
  assert.equal(t("characters.none"), "No encontramos personajes que coincidan con tu búsqueda.");
});

test("12b · Characters: the same matches as ever (names, aliases, kind, role, either language) — now saying why", () => {
  // Exactly the people its filter always found (person.searchText), for any words.
  const before = (m, q) => { const toks = Model.fold(q).split(" ").filter(Boolean); return m.people.filter(p => toks.every(t => p.searchText.includes(t))).map(p => p.id).sort(); };
  for (const m of [es, en, tes, ten]) for (const q of ["a", "mor", "Morgas", "custodio", "custodian", "dampiro", "dampir", "DRAGÓN", "dragon", "nigromancia", "necromancy", "Pike", "de rolo", "tyr", "herrero", "smith", "diosa", "goddess", "raven queen", "reina cuervo", "12", "1", "heredera", "casi", "zzqq", "maestro del combate", "o r"])
    assert.deepEqual([...Model.findPeople(m, q).hits.keys()].sort(), before(m, q), `${m.locale === "en" ? "en" : "es"}: “${q}”`);
  const hit = (m, q, id) => Model.findPeople(m, q).hits.get(id);
  assert.deepEqual([hit(es, "Morgas", "mortis").field, hit(es, "Morgas", "mortis").text], ["alias", "Morgas"], "an alias");
  assert.deepEqual([hit(es, "custodio", "marco").field, hit(es, "custodio", "marco").text], ["alias", "El custodio de la capilla de Pelor"], "the alias that holds the words, in Spanish");
  assert.deepEqual([hit(es, "custodian", "marco").field, hit(en, "custodio", "marco").text], ["alias", "The custodian of Pelor's chapel"], "either language");
  assert.deepEqual([hit(es, "dampiro", "locus").field, hit(es, "dampiro", "locus").text], ["race", "dampiro"], "the kind");
  assert.equal(hit(es, "nigromancia", "mortis").field, "role", "the role");
  assert.equal(hit(es, "Pike", "pike").field, "name", "a name first, even when an alias says it too");
  assert.equal(hit(es, "bahamut dragon", "bahamut").field, "name");
  assert.equal(Model.findPeople(es, "12").number, null, "numbers are words here, as they always were");
  assert.deepEqual([hit(tes, "heredera", "cass").field, hit(tes, "heredera", "cass").text], ["alias", "Cass"], "a translated alias that does not line up still counts (shown as the recorded aliases)");
  assert.equal(Model.findPeople(es, "").searching, false);
  assert.equal(Model.findPeople(es, "zzqq").hits.size, 0);
});

test("13 · the model builds the same links with the searches as before (ids, relations, issues)", () => {
  assert.equal(es.issues.filter(i => i.level === "error").length, 0);
  es.sessions.forEach(s => assert.equal(s.findText, s.find.map(p => p.keys).join("\n")));
  es.sessions.forEach(s => s.find.forEach(p => assert.ok(p.keys && typeof p.text === "string", `session ${s.no}: ${p.field}`)));
  // Built once with the model: the same entries in every language.
  assert.deepEqual(es.sessions.map(s => s.find.length), en.sessions.map(s => s.find.length));
  assert.deepEqual(es.quests.map(q => q.find.length), en.quests.map(q => q.find.length));
});

// ── index.html: the fields, their place, their state ──────────────────────
const html = readText("index.html");
const between = (a, b) => html.slice(html.indexOf(a), html.indexOf(b, html.indexOf(a)));

test("14 · index.html: one search field per section, the same markup and behaviour (label, ✕, Esc, describedby, count)", () => {
  for (const [vm, f, key] of [["sl", "sl.find", "sessions"], ["ql", "ql.find", "quests"], ["pl", "pl", "characters"]]) {
    const v = vm.replace(".", "\\."), fv = f.replace(".", "\\.");
    assert.match(html, new RegExp(`<input class="cc-input" ref="\\{\\{ ${fv}\\.inputRef \\}\\}" type="search" value="\\{\\{ ${fv}\\.query \\}\\}" onChange="\\{\\{ ${fv}\\.onQuery \\}\\}" onKeyDown="\\{\\{ ${fv}\\.onKey \\}\\}" placeholder="\\{\\{ ${v}\\.placeholder \\}\\}" aria-label="\\{\\{ t\\.${key}\\.findAria \\}\\}" aria-describedby="\\{\\{ ${v}\\.statusId \\}\\}" enterKeyHint="search" autoComplete="off" spellCheck="false" />`), `${key} input`);
    assert.match(html, new RegExp(`<sc-if value="\\{\\{ ${fv}\\.query \\}\\}"><button class="cc-search-x" onClick="\\{\\{ ${fv}\\.onClear \\}\\}" aria-label="\\{\\{ t\\.find\\.clear \\}\\}">✕</button></sc-if>`), `${key} clear button`);
    assert.match(html, new RegExp(`<span class="cc-results-t" id="cc-${key}-status">\\{\\{ ${v}\\.status \\}\\}</span>`), `${key} count`);
    assert.match(html, new RegExp(`<p style="margin:0 0 4px;">\\{\\{ t\\.${key}\\.none \\}\\}</p>`), `${key} no results`);
    assert.match(html, new RegExp(`<button class="cc-linkbtn" onClick="\\{\\{ ${v}\\.onSearchAll \\}\\}">\\{\\{ t\\.find\\.searchAll \\}\\}</button>`), `${key} hands the words to the universal search`);
  }
  assert.ok(html.includes('this._findMsg.characters=!r.searching?"":shown?status:t("characters.none");'), "the Characters count is said too");
  // Places shares the behaviour (Esc clears, ✕ keeps the focus in the field).
  assert.match(html, /onChange="\{\{ pll\.onQuery \}\}" onKeyDown="\{\{ pll\.onKey \}\}"/);
  for (const key of ["sessions", "quests", "characters", "places"]) assert.ok(html.includes(`this._findVm("${key}")`), `${key} uses _findVm`);
  assert.match(html, /onKey:e=>\{ if\(e\.key==="Escape"&&q\)\{ e\.preventDefault\(\); this\.setFind\(key,"",true\); \} \}/, "Esc clears a field that has words");
});

test("15 · index.html: header → search → order/status → list, as asked", () => {
  const sessions = between("<!-- ═══ SESSIONS", "<!-- ═══ QUESTS");
  const order = ["cc-sechead", "sl.find.inputRef", "t.sessions.orderAria", "sl.items", "sl.none"].map(s => sessions.indexOf(s));
  assert.ok(order.every((x, i) => x >= 0 && (!i || x > order[i - 1])), `Sessions: ${order}`);
  const quests = between("<!-- ═══ QUESTS", "<!-- ═══ CHARACTERS");
  const qorder = ["cc-sechead", "ql.find.inputRef", "cc-statusbar", "cc-quests-status", "ql.groups", "ql.none"].map(s => quests.indexOf(s));
  assert.ok(qorder.every((x, i) => x >= 0 && (!i || x > qorder[i - 1])), `Quests: ${qorder}`);
  // The quest list's headings stay right above their cards (h2 + list), as before.
  assert.match(quests, /<h2 class="\{\{ grp\.cls \}\}">[^\n]*\n\s*<div class="cc-list">/);
});

test("16 · index.html: status AND words; the tabs keep their counts; the words never stored", () => {
  assert.ok(html.includes("m.quests.filter(q=>q.status===st&&found(q))"), "a quest shows when it has the status AND holds the words");
  assert.ok(html.includes("count:m.quests.filter(q=>q.status===st).length"), "the tabs still count every quest of their status");
  assert.ok(html.includes('onClick:()=>this.setState({questStatus:tb.key})'), "changing the status does not touch the words");
  assert.ok(html.includes('onAllStatuses:()=>this.setState({questStatus:"all"})'), "…and seeing every status keeps them too");
  assert.match(html, /sessionsQuery:"", questsQuery:"",/, "this visit only, like the Characters and Places filters");
  assert.ok(!/(Prefs\.\w+|localStorage\.\w+|sessionStorage\.\w+)\([^)]*(sessionsQuery|questsQuery|peopleQuery|placesQuery)/.test(html), "never written to storage");
  assert.match(html, /setFind\(key,q,focus\)\{[\s\S]*?setTimeout\([\s\S]*?this\._say\(msg\)[\s\S]*?FIND_SAY\);/, "the count is said once typing pauses");
});

test("17 · index.html: the guided tour sees the real lists and gives the searches back", () => {
  assert.ok(html.includes("finds:{sessionsQuery:st.sessionsQuery,questsQuery:st.questsQuery}"), "kept with the tour's snapshot");
  assert.ok(html.includes('this.setState({tourOn:id,moreOpen:false,filtersOpen:false,sessionsQuery:"",questsQuery:""});'), "set aside while it runs");
  assert.ok(html.includes("...(snap&&snap.finds) };"), "given back however it ends");
});
