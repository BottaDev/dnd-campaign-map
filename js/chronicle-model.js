// ── Chronicle model ─────────────────────────────────────────────────────────
// Pure data layer for Campaign Chronicle: normalizes the raw data/*.json files,
// builds the relationship indexes between events, sessions, quests, people and
// places, and exposes filtering + search. No DOM, no React — it runs in the
// browser (window.ChronicleModel) and in Node (tools/validate-data.js, tests/).
//
// Every field added in the v2 data model is optional; records written for the
// original map-first app (events with only date/igLabel/xp/yp, sessions with
// only dateLabel, …) are normalized here so they keep working unchanged.
//
// Localization: build(raw, { locale, t, translations }) overlays the content
// translations (data/i18n/<locale>.json) onto the display fields. The English
// files stay the source of truth: ids, links, name matching and ordering never
// depend on a translation, and any missing translated text falls back to English.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.ChronicleModel = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // ── Vocabularies (English defaults; localized labels come from opts.t) ────
  // ︎ forces text (not emoji) presentation so glyphs match the parchment UI.
  const EVENT_TYPES = {
    encounter:    { label: "Encounter",       glyph: "☉" },
    conversation: { label: "Conversation",    glyph: "❝" },
    revelation:   { label: "Revelation",      glyph: "✶" },
    vision:       { label: "Divine vision",   glyph: "☀︎" },
    dream:        { label: "Dream",           glyph: "☾" },
    decision:     { label: "Decision",        glyph: "⚖︎" },
    discovery:    { label: "Discovery",       glyph: "✦" },
    combat:       { label: "Combat",          glyph: "⚔︎" },
    quest:        { label: "Quest milestone", glyph: "⚑" },
    travel:       { label: "Journey",         glyph: "➶" },
    planar:       { label: "Other plane",     glyph: "◈" },
    downtime:     { label: "Rest & rites",    glyph: "⌂" },
    other:        { label: "Event",           glyph: "❦" },
  };

  const QUEST_STATUS = {
    active:    { label: "In progress", tone: "active",  order: 0 },
    pending:   { label: "Pending",     tone: "pending", order: 1 },
    completed: { label: "Completed",   tone: "done",    order: 2 },
    failed:    { label: "Failed",      tone: "failed",  order: 3 },
  };

  const PERSON_CATEGORIES = {
    party:    { label: "The party",          order: 0 },
    person:   { label: "People",             order: 1 },
    deity:    { label: "Deities",            order: 2 },
    creature: { label: "Creatures & spirits", order: 3 },
    faction:  { label: "Factions & orders",  order: 4 },
  };

  const PLACE_KINDS = {
    continent: "Continent", region: "Region", sea: "Sea", city: "City",
    district: "District", site: "Site", plane: "Plane",
  };

  const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

  // Character-filter sentinels (never valid person ids: ids are lower-case words).
  //   NO_CHARACTER — "events without any party member" (opt-in when a selection is active)
  //   NO_ONE       — every party member switched off: nothing character-bound is shown
  const NO_CHARACTER = "_none";
  const NO_ONE = "_nobody";

  // ── Small helpers ─────────────────────────────────────────────────────────
  const arr  = v => Array.isArray(v) ? v : (v == null || v === "" ? [] : [v]);
  const str  = v => (v == null ? "" : String(v));
  const norm = s => str(s).toLowerCase().replace(/\s+/g, " ").trim();
  // Search folding: case-, accent- and spacing-insensitive ("Revelación" → "revelacion").
  const fold = s => str(s).normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[’‘`´]/g, "'")
    .toLowerCase().replace(/\s+/g, " ").trim();
  const uniq = a => [...new Set(a)];
  const isNum = v => typeof v === "number" && isFinite(v);
  const cap = s => s ? s[0].toUpperCase() + s.slice(1) : s;
  const nonEmpty = v => typeof v === "string" && v.trim() !== "";

  function fmtDate(iso, months) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str(iso));
    const names = Array.isArray(months) && months.length === 12 ? months : MONTHS;
    return m ? `${+m[3]} ${names[+m[2] - 1]} ${m[1]}` : str(iso);
  }
  // "Day 26 · Emon" → 26   (structural: always parsed from the English label)
  function parseDay(label) {
    const m = /\bDay\s+(\d+)/i.exec(str(label));
    return m ? +m[1] : null;
  }
  // "Day 26 · Gilmore's shop, Emon" → { when:"Day 26", where:"Gilmore's shop, Emon" }
  function splitIgLabel(label) {
    const s = str(label), i = s.indexOf("·");
    return i < 0 ? { when: s.trim(), where: "" } : { when: s.slice(0, i).trim(), where: s.slice(i + 1).trim() };
  }
  // "Recorded 25 Feb 2026 · A Pact Beneath the Sun" → "2026-02-25"
  function parseRecorded(label) {
    const m = /(\d{1,2})\s+([A-Za-z]{3})[a-z]*\.?\s+(\d{4})/.exec(str(label));
    if (!m) return null;
    const mi = MONTHS.findIndex(x => x.toLowerCase() === m[2].toLowerCase());
    return mi < 0 ? null : `${m[3]}-${String(mi + 1).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  }
  function titleFromLabel(label) {
    const s = str(label), i = s.indexOf("·");
    return i < 0 ? "" : s.slice(i + 1).trim();
  }

  // ── Translation overlays ──────────────────────────────────────────────────
  // A translated value is used only when it is a non-empty string; positional
  // arrays only when their length matches the English source (else English).
  const pickStr = (o, k, fb) => (o && nonEmpty(o[k]) ? o[k] : fb);
  const sameLen = (t, src) => Array.isArray(t) && t.length === src.length;
  const pickArr = (o, k, src) => (o && sameLen(o[k], src) ? src.map((x, i) => (nonEmpty(o[k][i]) ? o[k][i] : x)) : src);
  const overlay = (content, kind, id) => (content && content[kind] && content[kind][id]) || null;

  // Checks a content-translation file against the English data: unknown ids and
  // positional arrays whose length differs (those fall back to English).
  function checkTranslations(raw, content, locale) {
    const out = [], tag = `i18n/${locale || content && content.locale || "?"}`;
    if (!content || typeof content !== "object") return out;
    const warn = msg => out.push({ level: "warn", msg: `${tag}: ${msg}` });
    const ids = (list) => new Set(arr(list).map(x => x && x.id).filter(Boolean));
    const evIds = ids(raw.events), qIds = ids(raw.quests), placeIds = ids(raw.locations);
    const personIds = new Set([...ids(raw.characters), ...ids(raw.npcs)]);
    const rawSessions = raw.sessions && typeof raw.sessions === "object" ? raw.sessions : {};
    const lenCheck = (where, t, src) => { if (t != null && !sameLen(t, arr(src))) warn(`${where}: has ${arr(t).length} entries, the English source has ${arr(src).length} — English is shown`); };
    Object.keys(content.events || {}).forEach(id => {
      if (!evIds.has(id)) return warn(`unknown event "${id}"`);
      const src = arr(raw.events).find(e => e.id === id);
      lenCheck(`event "${id}" consequences`, content.events[id].consequences, src.consequences);
    });
    Object.keys(content.quests || {}).forEach(id => {
      if (!qIds.has(id)) return warn(`unknown quest "${id}"`);
      const src = arr(raw.quests).find(q => q.id === id);
      lenCheck(`quest "${id}" objectives`, content.quests[id].objectives, src.objectives);
    });
    Object.keys(content.people || {}).forEach(id => {
      if (!personIds.has(id)) return warn(`unknown person "${id}"`);
      const src = [...arr(raw.characters), ...arr(raw.npcs)].find(p => p.id === id);
      lenCheck(`person "${id}" aliases`, content.people[id].aliases, src.aliases);
      lenCheck(`person "${id}" relations`, content.people[id].relations, src.relations);
    });
    Object.keys(content.places || {}).forEach(id => {
      if (!placeIds.has(id)) return warn(`unknown place "${id}"`);
      const src = arr(raw.locations).find(p => p.id === id);
      lenCheck(`place "${id}" aliases`, content.places[id].aliases, src.aliases);
    });
    Object.keys(content.sessions || {}).forEach(no => {
      const src = rawSessions[no];
      if (!src) return warn(`unknown session "${no}"`);
      const ts = content.sessions[no];
      lenCheck(`session ${no} effects`, ts.effects, src.effects);
      ["activePlots", "completedPlots"].forEach(k => {
        lenCheck(`session ${no} ${k}`, ts[k], src[k]);
        if (!sameLen(ts[k], arr(src[k]))) return;
        arr(src[k]).forEach((p, i) => {
          lenCheck(`session ${no} ${k}[${i}] npcs`, ts[k][i] && ts[k][i].npcs, p.npcs);
          lenCheck(`session ${no} ${k}[${i}] notes`, ts[k][i] && ts[k][i].notes, p.notes);
        });
      });
    });
    return out;
  }

  // ── Routes: per-character waypoints → clean polyline segments ─────────────
  // routes.json: { "<pcId>": [ { xp, yp, leg?, break?, session?, locationId? }, … ] }
  //   break: true  → do not connect this waypoint to the previous one (journey not recorded)
  //   leg: "<id>"  → shared journey id; consecutive waypoints carrying the same leg id on
  //                  several characters' routes are one journey travelled together.
  // Order is kept exactly (revisits A → B → A stay); only accidental *consecutive*
  // duplicates are dropped. An invalid waypoint breaks the route instead of being bridged.
  function normalizeRoutes(rawRoutes, personById, placeById, warn) {
    const out = new Map();
    Object.keys(rawRoutes || {}).forEach(id => {
      if (!personById.has(id)) { warn(`routes.json: unknown character "${id}"`); return; }
      const pts = rawRoutes[id];
      if (!Array.isArray(pts)) { warn(`routes.json["${id}"] must be an array`); return; }
      const segments = []; let cur = null, prev = null;
      pts.forEach((p, i) => {
        const ok = p && isNum(p.xp) && isNum(p.yp) && p.xp >= 0 && p.xp <= 100 && p.yp >= 0 && p.yp <= 100;
        if (!ok) { warn(`routes.json["${id}"][${i}]: invalid waypoint skipped (the route is broken there, not bridged)`); cur = null; prev = null; return; }
        if (p.locationId && placeById && !placeById.has(p.locationId)) warn(`routes.json["${id}"][${i}]: unknown locationId "${p.locationId}"`);
        const pt = { xp: p.xp, yp: p.yp, leg: p.leg ? String(p.leg) : null, session: isNum(p.session) ? p.session : null,
          locationId: p.locationId || null, index: i };
        if (p.break === true || !cur) { cur = [pt]; segments.push(cur); prev = pt; return; }
        if (prev.xp === pt.xp && prev.yp === pt.yp && prev.leg === pt.leg) return;   // accidental duplicate
        cur.push(pt); prev = pt;
      });
      out.set(id, { characterId: id, segments, legIds: uniq(segments.flat().map(p => p.leg).filter(Boolean)),
        pointCount: segments.reduce((n, s) => n + s.length, 0) });
    });
    return out;
  }

  // ── build() — raw files → linked campaign model ───────────────────────────
  function build(raw, opts) {
    raw = raw || {}; opts = opts || {};
    const issues = [];
    const warn  = (msg) => issues.push({ level: "warn", msg });
    const error = (msg) => issues.push({ level: "error", msg });
    const locale = opts.locale || "en";
    const translations = opts.translations || {};
    const content = translations[locale] || null;                 // overlay for display
    const overlays = Object.values(translations).filter(Boolean);  // every loaded language (search)
    const t = typeof opts.t === "function" ? opts.t : null;
    const searchTs = arr(opts.searchTs).filter(f => typeof f === "function");
    const L = (key, fb, params) => { const v = t ? t(key, params) : ""; return nonEmpty(v) ? v : fb; };
    const months = t ? t("date.monthsShort") : null;
    const dateLabel = iso => fmtDate(iso, months);
    const dayRange = nums => {
      const n = uniq(nums.filter(isNum)).sort((a, b) => a - b);
      if (!n.length) return "";
      return n.length === 1 ? L("days.one", `Day ${n[0]}`, { n: n[0] }) : L("days.range", `Day ${n[0]}–${n[n.length - 1]}`, { a: n[0], b: n[n.length - 1] });
    };
    // All language variants of a text field — the English original plus every overlay.
    const variants = (kind, id, field, base) => [base, ...overlays.map(o => { const x = overlay(o, kind, id); return x && x[field]; })]
      .flat().filter(nonEmpty);
    const vocab = (key, en) => uniq([en, ...searchTs.map(f => f(key))].filter(nonEmpty));
    if (content) checkTranslations(raw, content, locale).forEach(i => issues.push(i));

    // People: PCs (characters.json) + NPCs/deities/factions (npcs.json)
    const people = [], personById = new Map();
    const addPerson = (p, kind) => {
      if (!p || !p.id) { error(`${kind === "pc" ? "characters" : "npcs"}.json: entry without id`); return; }
      if (personById.has(p.id)) { error(`Duplicate person id "${p.id}"`); return; }
      const tr = overlay(content, "people", p.id);
      const nameEn = str(p.name) || p.id, aliasesEn = arr(p.aliases);
      const category = kind === "pc" ? "party" : (PERSON_CATEGORIES[p.category] ? p.category : "person");
      const person = {
        ...p, kind, category,
        name: pickStr(tr, "name", nameEn), nameEn, aliases: pickArr(tr, "aliases", aliasesEn), aliasesEn,
        role: pickStr(tr, "role", str(p.role)), race: pickStr(tr, "race", str(p.race)),
        factionIds: arr(p.factionIds), ownRelations: arr(p.relations), ownRelationsTr: tr && sameLen(tr.relations, arr(p.relations)) ? tr.relations : null,
        relations: [], memberIds: [], eventIds: [], questIds: [], placeIds: [], sessionNos: [], notes: [],
      };
      person.searchText = fold([...variants("people", p.id, "name", nameEn), ...variants("people", p.id, "aliases", aliasesEn),
        ...variants("people", p.id, "race", str(p.race)), ...variants("people", p.id, "role", str(p.role))].join(" • "));
      people.push(person); personById.set(p.id, person);
    };
    arr(raw.characters).forEach(c => addPerson(c, "pc"));
    arr(raw.npcs).forEach(n => addPerson(n, "npc"));

    // Places
    const places = [], placeById = new Map();
    arr(raw.locations).forEach(l => {
      if (!l || !l.id) { error("locations.json: entry without id"); return; }
      if (placeById.has(l.id)) { error(`Duplicate place id "${l.id}"`); return; }
      if (personById.has(l.id)) error(`Id "${l.id}" is used by both a person and a place`);
      const tr = overlay(content, "places", l.id);
      const nameEn = str(l.name) || l.id, aliasesEn = arr(l.aliases);
      const kindLabel = L(`placeKind.${l.kind}`, PLACE_KINDS[l.kind] || cap(str(l.kind)) || "Place");
      const place = { ...l, name: pickStr(tr, "name", nameEn), nameEn, aliases: pickArr(tr, "aliases", aliasesEn), aliasesEn, kindLabel,
        childIds: [], eventIds: [], allEventIds: [], notes: [], questIds: [], personIds: [], sessionNos: [] };
      place.searchText = fold([...variants("places", l.id, "name", nameEn), ...variants("places", l.id, "aliases", aliasesEn),
        ...vocab(`placeKind.${l.kind}`, PLACE_KINDS[l.kind] || "")].join(" • "));
      places.push(place); placeById.set(l.id, place);
    });
    places.forEach(p => {
      if (p.parentId && !placeById.has(p.parentId)) { error(`Place "${p.id}": unknown parentId "${p.parentId}"`); p.parentId = null; }
      if (p.parentId) placeById.get(p.parentId).childIds.push(p.id);
    });
    const ancestorsOf = (id) => { const out = []; let p = placeById.get(id), guard = 0;
      while (p && p.parentId && guard++ < 20) { out.push(p.parentId); p = placeById.get(p.parentId); } return out; };
    places.forEach(p => { p.ancestorIds = ancestorsOf(p.id); p.depth = p.ancestorIds.length; });

    // Exact-name index used only to attach session-log NPC/location notes.
    // Matching is exact (case/space-insensitive) against the ENGLISH names + declared aliases.
    const nameIndex = new Map();
    const indexName = (name, ref) => {
      const k = norm(name); if (!k) return;
      const prev = nameIndex.get(k);
      if (prev && (prev.type !== ref.type || prev.id !== ref.id)) warn(`Name "${name}" is declared by both ${prev.type} "${prev.id}" and ${ref.type} "${ref.id}"`);
      else nameIndex.set(k, ref);
    };
    people.forEach(p => [p.nameEn, ...p.aliasesEn].forEach(n => indexName(n, { type: "person", id: p.id })));
    places.forEach(p => [p.nameEn, ...p.aliasesEn].forEach(n => indexName(n, { type: "place", id: p.id })));

    // Quests
    const quests = [], questById = new Map();
    arr(raw.quests).forEach((q, i) => {
      if (!q || !q.id) { error(`quests.json[${i}]: entry without id`); return; }
      if (questById.has(q.id)) { error(`Duplicate quest id "${q.id}"`); return; }
      const tr = overlay(content, "quests", q.id);
      const status = str(q.status) || "active";
      const st = QUEST_STATUS[status] || { label: cap(status), tone: "other", order: 5 };
      const giverEn = q.giver && q.giver !== "—" ? str(q.giver) : "";
      const quest = { ...q, status, statusLabel: L(`questStatus.${status}`, st.label), statusTone: st.tone, statusOrder: st.order,
        title: pickStr(tr, "title", str(q.title) || q.id), titleEn: str(q.title) || q.id, summary: pickStr(tr, "summary", str(q.summary)),
        sessionNos: arr(q.sessions).map(Number).filter(isNum), characterIds: arr(q.characterIds),
        objectives: pickArr(tr, "objectives", arr(q.objectives)), giverId: q.giverId || null,
        giver: giverEn ? pickStr(tr, "giver", giverEn) : "",
        eventIds: [], npcIds: [], placeIds: [], progress: [] };
      quest.searchText = fold([...variants("quests", q.id, "title", quest.titleEn), ...variants("quests", q.id, "giver", giverEn),
        ...vocab(`questStatus.${status}`, st.label)].join(" • "));
      quests.push(quest); questById.set(q.id, quest);
    });

    // Sessions
    const rawSessions = raw.sessions && typeof raw.sessions === "object" ? raw.sessions : {};
    const sessions = [], sessionByNo = new Map();
    const addSession = (no, s, stub) => {
      s = s || {};
      const ig = s.ig || {};
      const tr = overlay(content, "sessions", String(no)) || {};
      const tig = tr.ig || {};
      const closedDefault = L("plot.closed", "Closed");
      const mapPlots = (list, trList, closed) => {
        const tl = sameLen(trList, list) ? trList : [];
        return list.map((p, i) => {
          const tp = tl[i] || {};
          const npcs = arr(p.npcs), tn = sameLen(tp.npcs, npcs) ? tp.npcs : [];
          return { ...p, name: pickStr(tp, "name", str(p.name)), nameEn: str(p.name), qt: pickStr(tp, "qt", str(p.qt)),
            closed: closed ? pickStr(tp, "closed", str(p.closed) || closedDefault) : "",
            isClosed: !!closed, questId: p.questId || null,
            npcs: npcs.map((n, j) => { n = n || {}; const x = tn[j] || {};
              return { ...n, nameEn: str(n.name), name: pickStr(x, "name", str(n.name)), race: pickStr(x, "race", str(n.race)),
                role: pickStr(x, "role", str(n.role)), region: pickStr(x, "region", str(n.region)) }; }),
            notes: pickArr(tp, "notes", arr(p.notes)) };
        });
      };
      const titleEn = str(s.title) || titleFromLabel(s.dateLabel);
      const session = {
        ...s, no, isStub: !!stub,
        title: pickStr(tr, "title", titleEn), titleEn,
        playedOn: s.playedOn || parseRecorded(s.dateLabel) || null,
        dateLabel: str(s.dateLabel),
        startedHere: pickStr(tr, "startedHere", str(s.startedHere)), endedHere: pickStr(tr, "endedHere", str(s.endedHere)),
        igStart: pickStr(tig, "start", str(ig.start)), igEnd: pickStr(tig, "end", str(ig.end)), igRest: pickStr(tig, "rest", str(ig.rest)),
        effects: pickArr(tr, "effects", arr(s.effects)),
        activePlots: mapPlots(arr(s.activePlots), tr.activePlots, false),
        completedPlots: mapPlots(arr(s.completedPlots), tr.completedPlots, true),
        eventIds: [], characterIds: [], questIds: [], npcIds: [], placeIds: [], days: [],
      };
      session.playedLabel = session.playedOn ? dateLabel(session.playedOn) : "";
      session.searchText = fold([`session ${no}`, ...searchTs.map(f => f("common.session", { n: no })),
        ...variants("sessions", String(no), "title", titleEn)].join(" • "));
      sessions.push(session); sessionByNo.set(no, session);
      return session;
    };
    Object.keys(rawSessions).forEach(k => {
      const no = Number(k);
      if (!isNum(no)) { error(`sessions.json: key "${k}" is not a session number`); return; }
      addSession(no, rawSessions[k], false);
    });

    // Events
    const events = [], eventById = new Map();
    arr(raw.events).forEach((e, idx) => {
      if (!e || !e.id) { error(`events.json[${idx}]: entry without id`); return; }
      if (eventById.has(e.id)) { error(`Duplicate event id "${e.id}"`); return; }
      const tr = overlay(content, "events", e.id);
      const no = Number(e.session);
      const typeKey = EVENT_TYPES[e.type] ? e.type : "other";
      if (e.type && !EVENT_TYPES[e.type]) warn(`Event "${e.id}": unknown type "${e.type}" (shown as "Event")`);
      const igLabel = pickStr(tr, "igLabel", str(e.igLabel));
      const ig = splitIgLabel(igLabel);
      const hasCoords = isNum(e.xp) && isNum(e.yp);
      const ev = {
        ...e, raw: e, _idx: idx,
        session: isNum(no) ? no : null,
        title: pickStr(tr, "title", str(e.title) || e.id), titleEn: str(e.title) || e.id,
        summary: pickStr(tr, "summary", str(e.summary)), description: pickStr(tr, "description", str(e.description)),
        consequences: pickArr(tr, "consequences", arr(e.consequences)),
        type: typeKey, typeLabel: L(`eventType.${typeKey}`, EVENT_TYPES[typeKey].label), typeGlyph: EVENT_TYPES[typeKey].glyph,
        characterIds: arr(e.characterIds), npcIds: arr(e.npcIds), questIds: arr(e.questIds),
        locationId: e.locationId || null, relatedIds: arr(e.relatedEventIds),
        igLabel, igDate: str(e.igDate), whenLabel: ig.when, placeLabel: ig.where,
        campaignDay: isNum(e.campaignDay) ? e.campaignDay : parseDay(e.igLabel),
        dayApprox: false, hasCoords, xp: hasCoords ? e.xp : null, yp: hasCoords ? e.yp : null,
        order: isNum(e.order) ? e.order : null,
      };
      if (!hasCoords && (e.xp != null || e.yp != null)) warn(`Event "${e.id}": incomplete map coordinates (needs both xp and yp)`);
      events.push(ev); eventById.set(ev.id, ev);
      if (ev.session == null) error(`Event "${e.id}": missing session number`);
      else if (!sessionByNo.has(ev.session)) { warn(`Event "${e.id}": session ${ev.session} has no entry in sessions.json`); addSession(ev.session, null, true); }
    });

    // Undated events inherit the nearest known day within their session (marked approximate).
    sessions.forEach(s => {
      const evs = events.filter(e => e.session === s.no).sort((a, b) => a._idx - b._idx);
      let last = null;
      evs.forEach(e => { if (e.campaignDay != null) last = e.campaignDay; else if (last != null) { e.campaignDay = last; e.dayApprox = true; } });
      let next = null;
      evs.slice().reverse().forEach(e => { if (e.campaignDay != null && !e.dayApprox) next = e.campaignDay; else if (e.campaignDay == null && next != null) { e.campaignDay = next; e.dayApprox = true; } });
    });

    // Chronological order: in-world day → session → explicit order → file order (never the language).
    const dayKey = e => e.campaignDay != null ? e.campaignDay : Infinity;
    events.sort((a, b) => (dayKey(a) - dayKey(b)) || ((a.session ?? 1e9) - (b.session ?? 1e9))
      || ((a.order ?? a._idx) - (b.order ?? b._idx)) || (a._idx - b._idx));
    events.forEach((e, i) => { e.chronoIndex = i; });

    // ── Link events to everything else ──────────────────────────────────────
    events.forEach(e => {
      const s = sessionByNo.get(e.session);
      e.playedOn = s ? s.playedOn : null;
      e.playedLabel = s ? s.playedLabel : "";
      e.sessionTitle = s ? s.title : "";
      if (s) { s.eventIds.push(e.id); if (e.campaignDay != null) s.days.push(e.campaignDay); }

      e.characterIds = uniq(e.characterIds).filter(id => {
        const p = personById.get(id);
        if (!p) { error(`Event "${e.id}": unknown character "${id}"`); return false; }
        if (p.kind !== "pc") warn(`Event "${e.id}": "${id}" is an NPC — list it in npcIds instead of characterIds`);
        return true;
      });
      e.npcIds = uniq(e.npcIds).filter(id => { if (!personById.has(id)) { error(`Event "${e.id}": unknown NPC "${id}"`); return false; } return true; });
      e.questIds = uniq(e.questIds).filter(id => { if (!questById.has(id)) { error(`Event "${e.id}": unknown quest "${id}"`); return false; } return true; });
      if (e.locationId && !placeById.has(e.locationId)) { error(`Event "${e.id}": unknown locationId "${e.locationId}"`); e.locationId = null; }
      e.relatedIds = e.relatedIds.filter(id => { if (!eventById.has(id)) { error(`Event "${e.id}": unknown related event "${id}"`); return false; } return id !== e.id; });

      [...e.characterIds, ...e.npcIds].forEach(pid => {
        const p = personById.get(pid);
        p.eventIds.push(e.id);
        if (e.session != null) p.sessionNos.push(e.session);
        p.questIds.push(...e.questIds);
        if (e.locationId) p.placeIds.push(e.locationId);
      });
      e.questIds.forEach(qid => {
        const q = questById.get(qid);
        q.eventIds.push(e.id);
        q.npcIds.push(...e.npcIds);
        if (e.locationId) q.placeIds.push(e.locationId);
        if (e.session != null && q.sessionNos.length && !q.sessionNos.includes(e.session))
          warn(`Event "${e.id}" (session ${e.session}) links quest "${qid}", whose sessions[] does not list session ${e.session}`);
      });
      if (e.locationId) {
        const pl = placeById.get(e.locationId);
        pl.eventIds.push(e.id);
        [pl.id, ...pl.ancestorIds].forEach(pid => {
          const p = placeById.get(pid);
          p.allEventIds.push(e.id);
          p.questIds.push(...e.questIds);
          p.personIds.push(...e.characterIds, ...e.npcIds);
          if (e.session != null) p.sessionNos.push(e.session);
        });
      }
    });
    // Event ↔ event relations are stored once and shown from both sides.
    events.forEach(e => e.relatedIds.forEach(id => { const o = eventById.get(id); if (!o.relatedIds.includes(e.id)) o.relatedIds.push(e.id); }));
    events.forEach(e => { e.relatedIds.sort((a, b) => eventById.get(a).chronoIndex - eventById.get(b).chronoIndex); });

    // ── Sessions: plots, notes and rollups ──────────────────────────────────
    sessions.sort((a, b) => a.no - b.no);
    sessions.forEach(s => {
      const evs = s.eventIds.map(id => eventById.get(id));
      s.characterIds = uniq(evs.flatMap(e => e.characterIds));
      s.npcIds = uniq(evs.flatMap(e => e.npcIds));
      s.placeIds = uniq(evs.map(e => e.locationId).filter(Boolean));
      s.days = uniq(s.days).sort((a, b) => a - b);
      s.dayText = dayRange(s.days);
      const qids = [...evs.flatMap(e => e.questIds), ...quests.filter(q => q.sessionNos.includes(s.no)).map(q => q.id)];
      [...s.activePlots, ...s.completedPlots].forEach(p => {
        if (p.questId) {
          const q = questById.get(p.questId);
          if (!q) { error(`Session ${s.no}: plot "${p.nameEn}" links unknown quest "${p.questId}"`); p.questId = null; }
          else { qids.push(q.id); if (q.sessionNos.length && !q.sessionNos.includes(s.no)) warn(`Session ${s.no}: plot "${p.nameEn}" links quest "${q.id}", whose sessions[] does not list ${s.no}`); }
        }
        // Session-log notes about NPCs/places — attached only on exact (English) name match.
        p.npcs.forEach(n => {
          const ref = nameIndex.get(norm(n.nameEn));
          const text = [n.role, n.region].filter(Boolean).join(" · ");
          if (!ref) return;
          const note = { session: s.no, plot: p.name, questId: p.questId, race: str(n.race), text, recordedAs: n.nameEn };
          if (ref.type === "person") { const pp = personById.get(ref.id); pp.notes.push(note); pp.sessionNos.push(s.no); if (pp.kind === "npc") s.npcIds.push(pp.id); }
          else { const pl = placeById.get(ref.id); pl.notes.push(note); }
        });
      });
      s.npcIds = uniq(s.npcIds);
      s.questIds = uniq(qids);
      s.eventIds.sort((a, b) => eventById.get(a).chronoIndex - eventById.get(b).chronoIndex);
    });
    sessions.forEach((s, i) => { s.prevNo = i > 0 ? sessions[i - 1].no : null; s.nextNo = i < sessions.length - 1 ? sessions[i + 1].no : null; });

    // ── Quests: progress chronicle ──────────────────────────────────────────
    quests.forEach(q => {
      q.characterIds = q.characterIds.filter(id => { if (!personById.has(id)) { error(`Quest "${q.id}": unknown character "${id}"`); return false; } return true; });
      if (q.giverId && !personById.has(q.giverId)) { error(`Quest "${q.id}": unknown giverId "${q.giverId}"`); q.giverId = null; }
      if (q.giverId) { const g = personById.get(q.giverId); g.questIds.push(q.id); q.npcIds.unshift(g.id); if (!q.giver) q.giver = g.name; }
      q.characterIds.forEach(id => personById.get(id).questIds.push(q.id));
      q.eventIds.sort((a, b) => eventById.get(a).chronoIndex - eventById.get(b).chronoIndex);
      q.npcIds = uniq(q.npcIds);
      q.placeIds = uniq(q.placeIds);
      q.sessionNos.forEach(n => { if (!sessionByNo.has(n)) warn(`Quest "${q.id}": session ${n} has no entry in sessions.json`); });
      const nos = uniq([...q.sessionNos, ...q.eventIds.map(id => eventById.get(id).session)].filter(isNum)).sort((a, b) => a - b);
      q.progress = nos.map(n => {
        const s = sessionByNo.get(n);
        const plots = s ? [...s.activePlots, ...s.completedPlots].filter(p => p.questId === q.id) : [];
        return { session: n, plots, eventIds: q.eventIds.filter(id => eventById.get(id).session === n) };
      });
      q.lastSession = nos.length ? nos[nos.length - 1] : null;
      q.firstSession = nos.length ? nos[0] : null;
      const days = q.eventIds.map(id => eventById.get(id).campaignDay).filter(isNum);
      q.dayText = dayRange(days);
    });

    // ── People: relations (both directions), factions, rollups ──────────────
    people.forEach(p => {
      p.factionIds = p.factionIds.filter(fid => {
        const f = personById.get(fid);
        if (!f) { error(`Person "${p.id}": unknown faction "${fid}"`); return false; }
        f.memberIds.push(p.id); return true;
      });
      p.ownRelations.forEach((r, i) => {
        const o = r && personById.get(r.id);
        if (!o) { error(`Person "${p.id}": relation to unknown person "${r && r.id}"`); return; }
        const tr = p.ownRelationsTr && p.ownRelationsTr[i];
        const label = pickStr(tr, "label", str(r.label));
        p.relations.push({ id: o.id, label });
        o.relations.push({ id: p.id, label: pickStr(tr, "reverseLabel", r.reverseLabel ? str(r.reverseLabel) : label) });
      });
    });
    people.forEach(p => {
      p.eventIds = uniq(p.eventIds).sort((a, b) => eventById.get(a).chronoIndex - eventById.get(b).chronoIndex);
      p.questIds = uniq(p.questIds);
      p.placeIds = uniq(p.placeIds);
      p.sessionNos = uniq(p.sessionNos).sort((a, b) => a - b);
      p.memberIds = uniq(p.memberIds);
      p.notes.sort((a, b) => a.session - b.session);
      p.race = p.race || (p.notes.find(n => n.race) || {}).race || "";
      p.categoryLabel = L(`personCategory.${p.category}`, PERSON_CATEGORIES[p.category].label);
    });
    places.forEach(p => {
      p.allEventIds = uniq(p.allEventIds).sort((a, b) => eventById.get(a).chronoIndex - eventById.get(b).chronoIndex);
      p.eventIds.sort((a, b) => eventById.get(a).chronoIndex - eventById.get(b).chronoIndex);
      p.questIds = uniq(p.questIds); p.personIds = uniq(p.personIds);
      p.sessionNos = uniq(p.sessionNos).sort((a, b) => a - b);
      p.notes.sort((a, b) => a.session - b.session);
      // Map focus: the first chronological event recorded here (or in a sub-place) with coordinates.
      // Other planes (and anything inside them) never get a map focus — they are not on the map.
      p.isPlanar = p.kind === "plane" || p.ancestorIds.some(id => placeById.get(id).kind === "plane");
      const fe = p.isPlanar ? null : p.allEventIds.map(id => eventById.get(id)).find(e => e.hasCoords);
      p.focusEventId = fe ? fe.id : null;
    });

    // Search text per event (folded, built once) — English original + every loaded translation,
    // so "revelación", "revelacion" and "revelation" all find the same entry in either language.
    events.forEach(e => {
      const names = [...e.characterIds, ...e.npcIds].map(id => personById.get(id).searchText);
      const qs = e.questIds.map(id => questById.get(id).searchText);
      const pl = e.locationId ? [e.locationId, ...placeById.get(e.locationId).ancestorIds].map(id => placeById.get(id).searchText) : [];
      const sess = sessionByNo.get(e.session);
      e.searchText = fold([
        ...variants("events", e.id, "title", e.titleEn), ...variants("events", e.id, "summary", str(e.raw.summary)),
        ...variants("events", e.id, "description", str(e.raw.description)), ...variants("events", e.id, "consequences", arr(e.raw.consequences)),
        ...variants("events", e.id, "igLabel", str(e.raw.igLabel)), e.igDate,
        ...vocab(`eventType.${e.type}`, EVENT_TYPES[e.type].label), sess ? sess.searchText : `session ${e.session}`,
        ...names, ...qs, ...pl].join(" • "));
    });

    // Routes: per-character waypoints, cleaned into polyline segments (see normalizeRoutes).
    const routes = raw.routes && typeof raw.routes === "object" ? raw.routes : {};
    const routeById = normalizeRoutes(routes, personById, placeById, warn);

    const days = uniq(events.map(e => e.campaignDay).filter(isNum)).sort((a, b) => a - b);
    const dayLabels = {};
    events.forEach(e => { if (e.campaignDay != null && e.igDate && !e.dayApprox && !dayLabels[e.campaignDay]) dayLabels[e.campaignDay] = e.igDate; });

    return {
      locale, events, eventById, sessions, sessionByNo, quests, questById, people, personById, places, placeById,
      routes, routeById, days, dayLabels, issues,
      // Exact (case/space-insensitive) English name or alias → { type: "person"|"place", id }.
      resolveName: (name) => nameIndex.get(norm(name)) || null,
      pcs: people.filter(p => p.kind === "pc"),
      npcs: people.filter(p => p.kind === "npc"),
      hasUnassigned: events.some(e => !e.characterIds.length),
      fmtDate: dateLabel,
    };
  }

  // ── Filtering ─────────────────────────────────────────────────────────────
  const EMPTY_FILTERS = Object.freeze({ text: "", pcs: [], npc: "", quest: "", session: "", type: "", place: "",
    dayFrom: "", dayTo: "", playedFrom: "", playedTo: "" });

  // Party-member filter. `pcs` empty = no character filter (every event, including events
  // without party members). Otherwise an event matches when ANY of its party members is
  // selected (OR — order in characterIds is irrelevant); events without party members
  // match only when NO_CHARACTER is selected.
  function matchesCharacters(ev, pcs) {
    if (!pcs || !pcs.length) return true;
    if (!ev.characterIds.length) return pcs.includes(NO_CHARACTER);
    return ev.characterIds.some(id => pcs.includes(id));
  }

  // One predicate per filter — add new ones here without touching the UI (OCP).
  const FILTER_PREDICATES = [
    (ev, f) => { const toks = fold(f.text).split(" ").filter(Boolean); return !toks.length || toks.every(tok => ev.searchText.includes(tok)); },
    (ev, f) => matchesCharacters(ev, f.pcs),
    (ev, f) => !f.npc || ev.npcIds.includes(f.npc),
    (ev, f) => !f.quest || ev.questIds.includes(f.quest),
    (ev, f) => !f.session || String(ev.session) === String(f.session),
    (ev, f) => !f.type || ev.type === f.type,
    (ev, f, m) => !f.place || (!!ev.locationId && (ev.locationId === f.place || m.placeById.get(ev.locationId).ancestorIds.includes(f.place))),
    (ev, f) => f.dayFrom === "" || f.dayFrom == null || (ev.campaignDay != null && ev.campaignDay >= Number(f.dayFrom)),
    (ev, f) => f.dayTo === "" || f.dayTo == null || (ev.campaignDay != null && ev.campaignDay <= Number(f.dayTo)),
    (ev, f) => !f.playedFrom || (!!ev.playedOn && ev.playedOn >= f.playedFrom),
    (ev, f) => !f.playedTo || (!!ev.playedOn && ev.playedOn <= f.playedTo),
  ];

  function filterEvents(model, filters) {
    const f = { ...EMPTY_FILTERS, ...(filters || {}) };
    return model.events.filter(ev => FILTER_PREDICATES.every(p => p(ev, f, model)));
  }

  function activeFilterCount(filters) {
    const f = { ...EMPTY_FILTERS, ...(filters || {}) };
    return Object.keys(EMPTY_FILTERS).filter(k => k !== "text" && (Array.isArray(f[k]) ? f[k].length : f[k] !== "" && f[k] != null)).length;
  }

  // Party members a character filter shows (pcs empty → everyone), in party order.
  function selectedCharacterIds(model, pcs) {
    if (!pcs || !pcs.length) return model.pcs.map(p => p.id);
    return model.pcs.map(p => p.id).filter(id => pcs.includes(id));
  }

  // Toggling one row of a "who is visible" list (the map's party rows) on the pcs filter.
  // The visible set is pcs (or everyone when pcs is empty); a full set collapses back to [],
  // an empty one becomes [NO_ONE] so "everything switched off" stays distinct from "no filter".
  function toggleVisibleCharacter(model, pcs, id) {
    const all = [...model.pcs.map(p => p.id), ...(model.hasUnassigned ? [NO_CHARACTER] : [])];
    const cur = pcs && pcs.length ? pcs.filter(x => x !== NO_ONE) : all.slice();
    const next = cur.includes(id) ? cur.filter(x => x !== id) : [...cur, id];
    if (all.every(x => next.includes(x))) return [];
    return next.length ? all.filter(x => next.includes(x)) : [NO_ONE];
  }

  // ── Cross-entity quick search (people, quests, places, sessions) ──────────
  function search(model, text, limit) {
    const q = fold(text); limit = limit || 6;
    if (!q) return { people: [], quests: [], places: [], sessions: [] };
    const toks = q.split(" ").filter(Boolean);
    const hit = (hay) => toks.every(t => hay.includes(t));
    const sessNo = /^(?:s|session\s*|sesion\s*)?(\d+)$/.exec(q);
    return {
      people: model.people.filter(p => hit(p.searchText)).slice(0, limit),
      quests: model.quests.filter(x => hit(x.searchText)).slice(0, limit),
      places: model.places.filter(p => hit(p.searchText)).slice(0, limit),
      sessions: model.sessions.filter(s => (sessNo && s.no === +sessNo[1]) || (!sessNo && hit(s.searchText))).slice(0, limit),
    };
  }

  return { build, filterEvents, search, activeFilterCount, matchesCharacters, selectedCharacterIds, toggleVisibleCharacter,
    checkTranslations, normalizeRoutes, fold, FILTER_PREDICATES, EMPTY_FILTERS, NO_CHARACTER, NO_ONE,
    EVENT_TYPES, QUEST_STATUS, PERSON_CATEGORIES, PLACE_KINDS, fmtDate, parseDay, parseRecorded, splitIgLabel };
});
