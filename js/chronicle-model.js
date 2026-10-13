// ── Chronicle model ─────────────────────────────────────────────────────────
// Pure data layer for Campaign Chronicle: normalizes the raw data/*.json files,
// builds the relationship indexes between events, sessions, quests, people and
// places, and exposes filtering + search. No DOM, no React — it runs in the
// browser (window.ChronicleModel) and in Node (tools/validate-data.js).
//
// Every field added in the v2 data model is optional; records written for the
// original map-first app (events with only date/igLabel/xp/yp, sessions with
// only dateLabel, …) are normalized here so they keep working unchanged.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.ChronicleModel = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // ── Vocabularies ──────────────────────────────────────────────────────────
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

  // ── Small helpers ─────────────────────────────────────────────────────────
  const arr  = v => Array.isArray(v) ? v : (v == null || v === "" ? [] : [v]);
  const str  = v => (v == null ? "" : String(v));
  const norm = s => str(s).toLowerCase().replace(/\s+/g, " ").trim();
  const uniq = a => [...new Set(a)];
  const isNum = v => typeof v === "number" && isFinite(v);
  const cap = s => s ? s[0].toUpperCase() + s.slice(1) : s;

  function fmtDate(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str(iso));
    return m ? `${+m[3]} ${MONTHS[+m[2] - 1]} ${m[1]}` : str(iso);
  }
  // "Day 26 · Emon" → 26
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
  function rangeText(nums, prefix) {
    const n = uniq(nums.filter(isNum)).sort((a, b) => a - b);
    if (!n.length) return "";
    return n.length === 1 ? `${prefix}${n[0]}` : `${prefix}${n[0]}–${n[n.length - 1]}`;
  }

  // ── build() — raw files → linked campaign model ───────────────────────────
  function build(raw) {
    raw = raw || {};
    const issues = [];
    const warn  = (msg) => issues.push({ level: "warn", msg });
    const error = (msg) => issues.push({ level: "error", msg });

    // People: PCs (characters.json) + NPCs/deities/factions (npcs.json)
    const people = [], personById = new Map();
    const addPerson = (p, kind) => {
      if (!p || !p.id) { error(`${kind === "pc" ? "characters" : "npcs"}.json: entry without id`); return; }
      if (personById.has(p.id)) { error(`Duplicate person id "${p.id}"`); return; }
      const person = {
        ...p, kind,
        category: kind === "pc" ? "party" : (PERSON_CATEGORIES[p.category] ? p.category : "person"),
        name: str(p.name) || p.id, aliases: arr(p.aliases),
        factionIds: arr(p.factionIds), ownRelations: arr(p.relations),
        relations: [], memberIds: [], eventIds: [], questIds: [], placeIds: [], sessionNos: [], notes: [],
      };
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
      const place = { ...l, name: str(l.name) || l.id, aliases: arr(l.aliases), kindLabel: PLACE_KINDS[l.kind] || cap(str(l.kind)) || "Place",
        childIds: [], eventIds: [], allEventIds: [], notes: [], questIds: [], personIds: [], sessionNos: [] };
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
    // Matching is exact (case/space-insensitive) against names + declared aliases.
    const nameIndex = new Map();
    const indexName = (name, ref) => {
      const k = norm(name); if (!k) return;
      const prev = nameIndex.get(k);
      if (prev && (prev.type !== ref.type || prev.id !== ref.id)) warn(`Name "${name}" is declared by both ${prev.type} "${prev.id}" and ${ref.type} "${ref.id}"`);
      else nameIndex.set(k, ref);
    };
    people.forEach(p => [p.name, ...p.aliases].forEach(n => indexName(n, { type: "person", id: p.id })));
    places.forEach(p => [p.name, ...p.aliases].forEach(n => indexName(n, { type: "place", id: p.id })));

    // Quests
    const quests = [], questById = new Map();
    arr(raw.quests).forEach((q, i) => {
      if (!q || !q.id) { error(`quests.json[${i}]: entry without id`); return; }
      if (questById.has(q.id)) { error(`Duplicate quest id "${q.id}"`); return; }
      const status = str(q.status) || "active";
      const st = QUEST_STATUS[status] || { label: cap(status), tone: "other", order: 5 };
      const quest = { ...q, status, statusLabel: st.label, statusTone: st.tone, statusOrder: st.order,
        title: str(q.title) || q.id, summary: str(q.summary),
        sessionNos: arr(q.sessions).map(Number).filter(isNum), characterIds: arr(q.characterIds),
        objectives: arr(q.objectives), giverId: q.giverId || null,
        giver: q.giver && q.giver !== "—" ? str(q.giver) : "",
        eventIds: [], npcIds: [], placeIds: [], progress: [] };
      quests.push(quest); questById.set(q.id, quest);
    });

    // Sessions
    const rawSessions = raw.sessions && typeof raw.sessions === "object" ? raw.sessions : {};
    const sessions = [], sessionByNo = new Map();
    const addSession = (no, s, stub) => {
      s = s || {};
      const ig = s.ig || {};
      const mapPlot = (p, closed) => ({ ...p, name: str(p.name), qt: str(p.qt), closed: closed ? (str(p.closed) || "Closed") : "",
        isClosed: !!closed, questId: p.questId || null, npcs: arr(p.npcs), notes: arr(p.notes) });
      const session = {
        ...s, no, isStub: !!stub,
        title: str(s.title) || titleFromLabel(s.dateLabel),
        playedOn: s.playedOn || parseRecorded(s.dateLabel) || null,
        dateLabel: str(s.dateLabel),
        startedHere: str(s.startedHere), endedHere: str(s.endedHere),
        igStart: str(ig.start), igEnd: str(ig.end), igRest: str(ig.rest),
        effects: arr(s.effects),
        activePlots: arr(s.activePlots).map(p => mapPlot(p, false)),
        completedPlots: arr(s.completedPlots).map(p => mapPlot(p, true)),
        eventIds: [], characterIds: [], questIds: [], npcIds: [], placeIds: [], days: [],
      };
      session.playedLabel = session.playedOn ? fmtDate(session.playedOn) : "";
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
      const no = Number(e.session);
      const typeKey = EVENT_TYPES[e.type] ? e.type : "other";
      if (e.type && !EVENT_TYPES[e.type]) warn(`Event "${e.id}": unknown type "${e.type}" (shown as "Event")`);
      const ig = splitIgLabel(e.igLabel);
      const hasCoords = isNum(e.xp) && isNum(e.yp);
      const ev = {
        ...e, raw: e, _idx: idx,
        session: isNum(no) ? no : null,
        title: str(e.title) || e.id, summary: str(e.summary), description: str(e.description),
        consequences: arr(e.consequences),
        type: typeKey, typeLabel: EVENT_TYPES[typeKey].label, typeGlyph: EVENT_TYPES[typeKey].glyph,
        characterIds: arr(e.characterIds), npcIds: arr(e.npcIds), questIds: arr(e.questIds),
        locationId: e.locationId || null, relatedIds: arr(e.relatedEventIds),
        igLabel: str(e.igLabel), igDate: str(e.igDate), whenLabel: ig.when, placeLabel: ig.where,
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

    // Chronological order: in-world day → session → explicit order → file order.
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

      e.characterIds = e.characterIds.filter(id => {
        const p = personById.get(id);
        if (!p) { error(`Event "${e.id}": unknown character "${id}"`); return false; }
        if (p.kind !== "pc") warn(`Event "${e.id}": "${id}" is an NPC — list it in npcIds instead of characterIds`);
        return true;
      });
      e.npcIds = e.npcIds.filter(id => { if (!personById.has(id)) { error(`Event "${e.id}": unknown NPC "${id}"`); return false; } return true; });
      e.questIds = e.questIds.filter(id => { if (!questById.has(id)) { error(`Event "${e.id}": unknown quest "${id}"`); return false; } return true; });
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
      s.dayText = rangeText(s.days, "Day ");
      const qids = [...evs.flatMap(e => e.questIds), ...quests.filter(q => q.sessionNos.includes(s.no)).map(q => q.id)];
      [...s.activePlots, ...s.completedPlots].forEach(p => {
        if (p.questId) {
          const q = questById.get(p.questId);
          if (!q) { error(`Session ${s.no}: plot "${p.name}" links unknown quest "${p.questId}"`); p.questId = null; }
          else { qids.push(q.id); if (q.sessionNos.length && !q.sessionNos.includes(s.no)) warn(`Session ${s.no}: plot "${p.name}" links quest "${q.id}", whose sessions[] does not list ${s.no}`); }
        }
        // Session-log notes about NPCs/places — attached only on exact name match.
        p.npcs.forEach(n => {
          const ref = nameIndex.get(norm(n && n.name));
          const text = [n.role, n.region].filter(Boolean).join(" · ");
          if (!ref) return;
          const note = { session: s.no, plot: p.name, questId: p.questId, race: str(n.race), text, recordedAs: str(n.name) };
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
      q.dayText = rangeText(days, "Day ");
    });

    // ── People: relations (both directions), factions, rollups ──────────────
    people.forEach(p => {
      p.factionIds = p.factionIds.filter(fid => {
        const f = personById.get(fid);
        if (!f) { error(`Person "${p.id}": unknown faction "${fid}"`); return false; }
        f.memberIds.push(p.id); return true;
      });
      p.ownRelations.forEach(r => {
        const o = r && personById.get(r.id);
        if (!o) { error(`Person "${p.id}": relation to unknown person "${r && r.id}"`); return; }
        p.relations.push({ id: o.id, label: str(r.label) });
        o.relations.push({ id: p.id, label: str(r.reverseLabel || r.label) });
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
      p.categoryLabel = PERSON_CATEGORIES[p.category].label;
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

    // Search text per event (lower-case, built once).
    events.forEach(e => {
      const names = [...e.characterIds, ...e.npcIds].flatMap(id => { const p = personById.get(id); return [p.name, ...p.aliases]; });
      const qs = e.questIds.map(id => questById.get(id).title);
      const pl = e.locationId ? [placeById.get(e.locationId).name, ...placeById.get(e.locationId).ancestorIds.map(id => placeById.get(id).name)] : [];
      e.searchText = norm([e.title, e.summary, e.description, ...e.consequences, e.igLabel, e.igDate, e.typeLabel, `session ${e.session}`, e.sessionTitle, ...names, ...qs, ...pl].join(" • "));
    });

    // Routes: per-character waypoints (kept as-is for the map).
    const routes = raw.routes && typeof raw.routes === "object" ? raw.routes : {};
    Object.keys(routes).forEach(k => { if (!personById.has(k)) warn(`routes.json: unknown character "${k}"`); });

    const days = uniq(events.map(e => e.campaignDay).filter(isNum)).sort((a, b) => a - b);
    const dayLabels = {};
    events.forEach(e => { if (e.campaignDay != null && e.igDate && !e.dayApprox && !dayLabels[e.campaignDay]) dayLabels[e.campaignDay] = e.igDate; });

    return {
      events, eventById, sessions, sessionByNo, quests, questById, people, personById, places, placeById,
      routes, days, dayLabels, issues,
      // Exact (case/space-insensitive) name or alias → { type: "person"|"place", id }.
      resolveName: (name) => nameIndex.get(norm(name)) || null,
      pcs: people.filter(p => p.kind === "pc"),
      npcs: people.filter(p => p.kind === "npc"),
    };
  }

  // ── Filtering ─────────────────────────────────────────────────────────────
  const EMPTY_FILTERS = Object.freeze({ text: "", pcs: [], npc: "", quest: "", session: "", type: "", place: "",
    dayFrom: "", dayTo: "", playedFrom: "", playedTo: "" });

  // One predicate per filter — add new ones here without touching the UI (OCP).
  const FILTER_PREDICATES = [
    (ev, f) => !f.text || norm(f.text).split(" ").every(tok => ev.searchText.includes(tok)),
    (ev, f) => !f.pcs || !f.pcs.length || ev.characterIds.some(id => f.pcs.includes(id)),
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

  // ── Cross-entity quick search (people, quests, places, sessions) ──────────
  function search(model, text, limit) {
    const q = norm(text); limit = limit || 6;
    if (!q) return { people: [], quests: [], places: [], sessions: [] };
    const toks = q.split(" ");
    const hit = (hay) => { const h = norm(hay); return toks.every(t => h.includes(t)); };
    const sessNo = /^(?:s|session\s*)?(\d+)$/.exec(q);
    return {
      people: model.people.filter(p => hit([p.name, ...p.aliases, p.race, p.role].join(" "))).slice(0, limit),
      quests: model.quests.filter(x => hit([x.title, x.giver].join(" "))).slice(0, limit),
      places: model.places.filter(p => hit([p.name, ...p.aliases].join(" "))).slice(0, limit),
      sessions: model.sessions.filter(s => (sessNo && s.no === +sessNo[1]) || hit(`session ${s.no} ${s.title}`)).slice(0, limit),
    };
  }

  return { build, filterEvents, search, activeFilterCount, FILTER_PREDICATES, EMPTY_FILTERS,
    EVENT_TYPES, QUEST_STATUS, PERSON_CATEGORIES, PLACE_KINDS, fmtDate, parseDay, parseRecorded, splitIgLabel };
});
