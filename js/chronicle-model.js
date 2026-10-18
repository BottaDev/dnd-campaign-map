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
  // `family` is the colour group the interface uses (index.html: --ev-<family> tokens). The
  // colour says which kind of moment it is; each type keeps its own icon and label.
  const EVENT_TYPES = {
    encounter:    { label: "Encounter",       glyph: "☉",  family: "social" },
    conversation: { label: "Conversation",    glyph: "❝",  family: "social" },
    revelation:   { label: "Revelation",      glyph: "✶",  family: "arcane" },
    vision:       { label: "Divine vision",   glyph: "☀︎", family: "vision" },
    dream:        { label: "Dream",           glyph: "☾",  family: "vision" },
    decision:     { label: "Decision",        glyph: "⚖︎", family: "turning" },
    discovery:    { label: "Discovery",       glyph: "✦",  family: "discovery" },
    combat:       { label: "Combat",          glyph: "⚔︎", family: "conflict" },
    quest:        { label: "Quest milestone", glyph: "⚑",  family: "turning" },
    travel:       { label: "Journey",         glyph: "➶",  family: "journey" },
    planar:       { label: "Other plane",     glyph: "◈",  family: "arcane" },
    downtime:     { label: "Rest & rites",    glyph: "⌂",  family: "journey" },
    other:        { label: "Event",           glyph: "❦",  family: "neutral" },
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

  // Optional structured lore facts (data/lore.json entries[id].facts), shown in this order.
  // Labels come from the interface dictionaries (lore.fact.<key>); unknown keys are ignored.
  const LORE_FACTS = ["alsoKnownAs", "continent", "region", "government", "portfolio", "domains", "symbol",
    "worshippers", "temples", "base", "purpose", "patron", "affiliation", "role"];

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
  const foldAll = list => uniq(list.flat().map(fold).filter(Boolean));
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

  // External links from data files: only absolute https:// URLs to a real host, without
  // credentials or whitespace/control characters. Anything else (javascript:, data:, http:,
  // relative paths, "//host") returns null and is never rendered as a link.
  function safeExternalUrl(value) {
    const s = typeof value === "string" ? value.trim() : "";
    if (!s || /[\s\u0000-\u001f\u007f<>"`]/.test(s) || !/^https:\/\//i.test(s)) return null;
    let u;
    try { u = new URL(s); } catch (e) { return null; }
    if (u.protocol !== "https:" || u.username || u.password || !/\.[a-z]{2,}$/i.test(u.hostname)) return null;
    return u.href;
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
      const src = arr(raw.events).find(e => e.id === id), te = content.events[id];
      lenCheck(`event "${id}" consequences`, te.consequences, src.consequences);
      lenCheck(`event "${id}" unresolved`, te.unresolved, src.unresolved);
      if (nonEmpty(te.description) && !nonEmpty(src.description)) warn(`event "${id}": description has no English source — it is never shown`);
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
    const loreEntries = raw.lore && raw.lore.entries && typeof raw.lore.entries === "object" ? raw.lore.entries : {};
    Object.keys(content.lore || {}).forEach(id => {
      if (!personIds.has(id) && !placeIds.has(id)) return warn(`unknown lore entity "${id}"`);
      const src = loreEntries[id];
      if (!src) return warn(`lore "${id}" has no English entry in lore.json — it is never shown`);
      const tf = content.lore[id] && content.lore[id].facts;
      Object.keys(tf && typeof tf === "object" ? tf : {}).forEach(k => {
        if (!src.facts || !nonEmpty(src.facts[k])) warn(`lore "${id}": fact "${k}" has no English source — it is never shown`);
      });
    });
    Object.keys(content.sessions || {}).forEach(no => {
      const src = rawSessions[no];
      if (!src) return warn(`unknown session "${no}"`);
      const ts = content.sessions[no];
      lenCheck(`session ${no} effects`, ts.effects, src.effects);
      if (ts.recap && nonEmpty(ts.recap.summary) && !(src.recap && nonEmpty(src.recap.summary))) warn(`session ${no}: recap.summary has no English source — it is never shown`);
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

  // ── Lore: curated background from the wider world (data/lore.json) ────────
  // lore.json: { sources: { <sourceId>: { label, url?, community?, spoilers? } },
  //              entries: { <personOrPlaceId>: { references: [{ source, url, title? }], summary?,
  //                                               facts?: { <LORE_FACTS key>: text }, basedOn?: [sourceId], lastReviewed? } } }
  // Lore is a separate layer: it is attached to an entity as `entity.lore` and never changes
  // campaign fields, links, relations or search. Summaries/facts must cite at least one valid
  // reference; links are https:// only (see safeExternalUrl). Translations: content.lore[id]
  // { summary, facts: { key: text } } and content.loreSources[id].label — English fallback per field.
  function normalizeLore(rawLore, o) {
    const byId = new Map(), sources = {};
    if (rawLore == null) return { byId, sources };
    if (typeof rawLore !== "object" || Array.isArray(rawLore)) { o.error("lore.json must be a JSON object { sources, entries }"); return { byId, sources }; }
    const obj = v => (v && typeof v === "object" && !Array.isArray(v) ? v : {});
    Object.keys(obj(rawLore.sources)).forEach(id => {
      const s = obj(rawLore.sources[id]);
      if (!nonEmpty(s.label)) { o.error(`lore.json: source "${id}" needs a label`); return; }
      const home = s.url != null ? safeExternalUrl(s.url) : null;
      if (s.url != null && !home) o.error(`lore.json: source "${id}" has an invalid url "${str(s.url)}" (https:// only)`);
      sources[id] = { id, label: pickStr(overlay(o.content, "loreSources", id), "label", s.label.trim()), labelEn: s.label.trim(),
        url: home, community: s.community === true, spoilers: s.spoilers !== false };
    });
    const entries = obj(rawLore.entries);
    Object.keys(entries).forEach(id => {
      const e = entries[id], at = `lore.json entries["${id}"]`;
      if (!e || typeof e !== "object" || Array.isArray(e)) { o.error(`${at} must be an object`); return; }
      if (!o.personById.has(id) && !o.placeById.has(id)) { o.error(`${at}: unknown person or place id`); return; }
      const tr = overlay(o.content, "lore", id) || {};
      const seen = new Set();
      const references = arr(e.references).map((r, i) => {
        r = obj(r);
        const url = safeExternalUrl(r.url);
        if (!url) { o.error(`${at}.references[${i}]: invalid url "${str(r.url)}" — only https:// links are allowed`); return null; }
        if (seen.has(url)) { o.warn(`${at}.references[${i}]: duplicate link ${url}`); return null; }
        seen.add(url);
        const src = sources[r.source];
        if (!src) o.warn(`${at}.references[${i}]: unknown source "${str(r.source)}"`);
        return { source: src ? src.id : null, sourceLabel: src ? src.label : new URL(url).hostname.replace(/^www\./, ""),
          title: str(r.title).trim(), url, community: src ? src.community : false, spoilers: src ? src.spoilers : true };
      }).filter(Boolean);
      const summaryEn = str(e.summary).trim();
      const rf = obj(e.facts), tf = obj(tr.facts);
      Object.keys(rf).forEach(k => {
        if (!LORE_FACTS.includes(k)) o.warn(`${at}: unknown fact "${k}" ignored (known: ${LORE_FACTS.join(", ")})`);
        else if (!nonEmpty(rf[k])) o.warn(`${at}: fact "${k}" is empty`);
      });
      const facts = LORE_FACTS.filter(k => nonEmpty(rf[k])).map(k => ({ key: k, label: o.L(`lore.fact.${k}`, k), value: pickStr(tf, k, rf[k].trim()) }));
      if ((summaryEn || facts.length) && !references.length) { o.error(`${at}: a summary or facts need at least one valid reference (the source they come from) — not shown`); return; }
      if (!references.length) { o.warn(`${at}: empty entry`); return; }
      const words = summaryEn ? summaryEn.split(/\s+/).length : 0;
      if (words > 120) o.warn(`${at}: summary has ${words} words — keep it brief (about 40–80) and link the article for the rest`);
      arr(e.basedOn).forEach(s => { if (!sources[s]) o.warn(`${at}: basedOn names unknown source "${s}"`); });
      const basedOn = uniq((e.basedOn ? arr(e.basedOn) : references.map(r => r.source)).filter(s => sources[s]).map(s => sources[s].label));
      const reviewed = /^\d{4}-\d{2}-\d{2}$/.test(str(e.lastReviewed)) ? e.lastReviewed : null;
      if (e.lastReviewed != null && !reviewed) o.warn(`${at}: lastReviewed must be YYYY-MM-DD`);
      const translated = nonEmpty(tr.summary);
      byId.set(id, {
        entityId: id, summary: translated ? tr.summary.trim() : summaryEn, summaryEn,
        summaryLang: summaryEn && !translated ? "en" : o.locale, summaryFallback: !!summaryEn && !translated && o.locale !== "en",
        facts, references, basedOn, spoilers: references.some(r => r.spoilers),
        lastReviewed: reviewed, reviewedLabel: reviewed ? o.dateLabel(reviewed) : "",
      });
    });
    return { byId, sources };
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
    const people = [], personById = new Map(), rawPeople = new Map();
    const addPerson = (p, kind) => {
      if (!p || !p.id) { error(`${kind === "pc" ? "characters" : "npcs"}.json: entry without id`); return; }
      if (personById.has(p.id)) { error(`Duplicate person id "${p.id}"`); return; }
      rawPeople.set(p.id, p);
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
      person.nameKeys = foldAll([...variants("people", p.id, "name", nameEn), ...variants("people", p.id, "aliases", aliasesEn)]);
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
      // kindKey: one of PLACE_KINDS, or "place" for a missing or unknown kind (a plain place: generic icon).
      const known = Object.prototype.hasOwnProperty.call(PLACE_KINDS, l.kind);
      if (!known) warn(l.kind ? `Place "${l.id}": unknown kind "${l.kind}" (shown as a plain place)` : `Place "${l.id}": no kind (shown as a plain place)`);
      const kindLabel = known ? L(`placeKind.${l.kind}`, PLACE_KINDS[l.kind]) : (l.kind ? cap(str(l.kind)) : L("kinds.place", "Place"));
      const place = { ...l, name: pickStr(tr, "name", nameEn), nameEn, aliases: pickArr(tr, "aliases", aliasesEn), aliasesEn, kindLabel, kindKey: known ? l.kind : "place",
        childIds: [], eventIds: [], allEventIds: [], notes: [], questIds: [], personIds: [], sessionNos: [] };
      place.nameKeys = foldAll([...variants("places", l.id, "name", nameEn), ...variants("places", l.id, "aliases", aliasesEn)]);
      place.searchText = fold([...variants("places", l.id, "name", nameEn), ...variants("places", l.id, "aliases", aliasesEn),
        ...(known ? vocab(`placeKind.${l.kind}`, PLACE_KINDS[l.kind]) : [kindLabel])].join(" • "));
      places.push(place); placeById.set(l.id, place);
    });
    places.forEach(p => {
      if (p.parentId && !placeById.has(p.parentId)) { error(`Place "${p.id}": unknown parentId "${p.parentId}"`); p.parentId = null; }
    });
    // A parentId chain that comes back to where it started (a → b → a, or a place inside itself) has no
    // top: the first place of the loop (in file order) is shown at the top level, and the loop is reported.
    places.forEach(p => {
      const seen = [p.id]; let q = p;
      while (q.parentId) {
        if (q.parentId === p.id) { error(`Place "${p.id}": parentId loop (${[...seen, p.id].join(" → ")}) — shown at the top level`); p.parentId = null; break; }
        if (seen.includes(q.parentId)) break;                  // a loop further up: reported from one of its own places
        seen.push(q.parentId); q = placeById.get(q.parentId);
      }
    });
    places.forEach(p => { if (p.parentId) placeById.get(p.parentId).childIds.push(p.id); });
    const ancestorsOf = (id) => { const out = []; let p = placeById.get(id);
      while (p && p.parentId && out.length < places.length) { out.push(p.parentId); p = placeById.get(p.parentId); } return out; };
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
        title: pickStr(tr, "title", str(q.title) || q.id), titleEn: str(q.title) || q.id,
        summary: pickStr(tr, "summary", str(q.summary)), summaryEn: str(q.summary),
        sessionNos: arr(q.sessions).map(Number).filter(isNum), characterIds: arr(q.characterIds),
        objectives: pickArr(tr, "objectives", arr(q.objectives)), objectivesEn: arr(q.objectives), giverId: q.giverId || null,
        giver: giverEn ? pickStr(tr, "giver", giverEn) : "",
        eventIds: [], npcIds: [], placeIds: [], progress: [] };
      quest.nameKeys = foldAll(variants("quests", q.id, "title", quest.titleEn));
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
      // Optional editorial recap ("Previously on…"): { summary?, highlights?: [eventId] }.
      // Highlights are checked once the events are known (see below); nothing is ever inferred.
      const rc = s.recap && typeof s.recap === "object" && !Array.isArray(s.recap) ? s.recap : {};
      if (s.recap != null && rc !== s.recap) error(`Session ${no}: "recap" must be an object { summary?, highlights? }`);
      const trc = tr.recap && typeof tr.recap === "object" ? tr.recap : null;
      const recapEn = nonEmpty(rc.summary) ? rc.summary.trim() : "";
      const recap = { summaryEn: recapEn, summary: recapEn ? pickStr(trc, "summary", recapEn) : "",
        summaryFallback: !!recapEn && !(trc && nonEmpty(trc.summary)) && locale !== "en",
        highlightIds: arr(rc.highlights).map(str).filter(Boolean) };
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
        recap,
        eventIds: [], characterIds: [], questIds: [], npcIds: [], placeIds: [], days: [],
      };
      session.playedLabel = session.playedOn ? dateLabel(session.playedOn) : "";
      session.nameKeys = foldAll([`session ${no}`, ...searchTs.map(f => f("common.session", { n: no })),
        ...variants("sessions", String(no), "title", titleEn)]);
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
        summary: pickStr(tr, "summary", str(e.summary)),
        // Optional narrative depth for the important moments (all three may be absent):
        //   description  — what happened, in full;  consequences — what changed (verified at the table);
        //   unresolved   — what is still open (questions, conflicts, pending objectives).
        description: nonEmpty(e.description) ? pickStr(tr, "description", str(e.description)) : "",
        consequences: pickArr(tr, "consequences", arr(e.consequences).filter(nonEmpty)),
        unresolved: pickArr(tr, "unresolved", arr(e.unresolved).filter(nonEmpty)),
        type: typeKey, typeLabel: L(`eventType.${typeKey}`, EVENT_TYPES[typeKey].label), typeGlyph: EVENT_TYPES[typeKey].glyph, typeFamily: EVENT_TYPES[typeKey].family,
        characterIds: arr(e.characterIds), npcIds: arr(e.npcIds), questIds: arr(e.questIds),
        locationId: e.locationId || null, relatedIds: arr(e.relatedEventIds),
        igLabel, igDate: str(e.igDate), whenLabel: ig.when, placeLabel: ig.where,
        campaignDay: isNum(e.campaignDay) ? e.campaignDay : parseDay(e.igLabel),
        dayApprox: false, hasCoords, xp: hasCoords ? e.xp : null, yp: hasCoords ? e.yp : null,
        order: isNum(e.order) ? e.order : null,
      };
      if (!hasCoords && (e.xp != null || e.yp != null)) warn(`Event "${e.id}": incomplete map coordinates (needs both xp and yp)`);
      if (e.description != null && typeof e.description !== "string") warn(`Event "${e.id}": "description" must be text`);
      ["consequences", "unresolved"].forEach(k => {
        if (e[k] != null && !Array.isArray(e[k])) warn(`Event "${e.id}": "${k}" should be a list of sentences`);
        else if (arr(e[k]).some(x => !nonEmpty(x))) warn(`Event "${e.id}": "${k}" has empty or non-text entries (ignored)`);
      });
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
      e.nameKeys = foldAll(variants("events", e.id, "title", e.titleEn));
      e.searchText = fold([
        ...variants("events", e.id, "title", e.titleEn), ...variants("events", e.id, "summary", str(e.raw.summary)),
        ...variants("events", e.id, "description", str(e.raw.description)), ...variants("events", e.id, "consequences", arr(e.raw.consequences)),
        ...variants("events", e.id, "unresolved", arr(e.raw.unresolved)),
        ...variants("events", e.id, "igLabel", str(e.raw.igLabel)), e.igDate,
        ...vocab(`eventType.${e.type}`, EVENT_TYPES[e.type].label), sess ? sess.searchText : `session ${e.session}`,
        ...names, ...qs, ...pl].join(" • "));
    });
    // Wider context for the universal search (third tier, after names and own fields): the people,
    // places and events a quest or session is linked to — so "Mortis" also finds his quests and the
    // sessions he took part in. The Chronicle's own quick results never use it.
    const namesOf = (ids, byId) => ids.map(id => byId.get(id)).filter(Boolean).flatMap(x => x.nameKeys);
    quests.forEach(q => {
      q.contextText = fold([...variants("quests", q.id, "summary", q.summaryEn), ...variants("quests", q.id, "objectives", q.objectivesEn),
        ...namesOf([...q.characterIds, ...q.npcIds], personById), ...namesOf(q.placeIds, placeById)].join(" • "));
    });
    sessions.forEach(s => {
      s.contextText = fold([...namesOf([...s.characterIds, ...s.npcIds], personById), ...namesOf(s.placeIds, placeById),
        ...namesOf(s.eventIds, eventById), ...[...s.activePlots, ...s.completedPlots].map(p => p.name)].join(" • "));
    });

    // The contextual searches of the Sessions and Quests lists (findSessions / findQuests): what an entry
    // records and what is explicitly linked to it, one part per text, so a match can say where it was
    // found. `text` is what this language shows (`shown`, folded); `keys` the English original and every
    // loaded translation, folded. A linked place counts with the places it is recorded inside (an event at
    // the Chapel of Pelor happened in Vasselheim), as in the Chronicle's place filter; nothing is inferred.
    const part = (field, ref, text, keys) => ({ field, ref, text: str(text), shown: fold(text), keys: fold(uniq(keys.filter(nonEmpty)).join(" ")) });
    const named = (field, x) => part(field, x.id, x.name || x.title, x.nameKeys);
    const within = ids => uniq(ids.flatMap(id => [id, ...placeById.get(id).ancestorIds]));
    // One record's texts at a path, e.g. ["activePlots", 0, "notes", 2]: this language's (its translation,
    // else English) and every language's for the keys — positional arrays only when as long as the English
    // one, the rule of every overlay. Several paths make one line joined by " — " (a who's-who entry).
    const textsOf = (kind, id, src) => {
      const trs = overlays.map(o => overlay(o, kind, id)), cur = overlay(content, kind, id);
      const get = (o, path) => {
        let s = src;
        for (const k of path) {
          if (o == null || s == null) return null;
          if (typeof k === "number" && !(Array.isArray(o) && Array.isArray(s) && o.length === s.length)) return null;
          o = o[k]; s = s[k];
        }
        return nonEmpty(o) ? o : null;
      };
      const line = (o, paths, fb) => paths.map(p => get(o, p) || (fb ? get(src, p) : null)).filter(Boolean).join(" — ");
      return (field, ref, ...paths) => part(field, ref, line(cur, paths, true), [line(src, paths), ...trs.map(tr => line(tr, paths))]);
    };
    const eventParts = new Map(events.map(e => {
      const at = textsOf("events", e.id, e.raw), list = k => arr(e.raw[k]).map((x, i) => at("event", e.id, [k, i]));
      return [e.id, [at("event", e.id, ["title"]), at("event", e.id, ["summary"]), at("event", e.id, ["description"]),
        ...list("consequences"), ...list("unresolved"), at("event", e.id, ["igLabel"]),
        part("event", e.id, `${e.typeLabel} — ${e.title}`, vocab(`eventType.${e.type}`, EVENT_TYPES[e.type].label))]];
    }));
    const plotParts = new Map();                                   // questId → the session-log lines that carry it
    sessions.forEach(s => {
      const src = rawSessions[String(s.no)] || {}, at = textsOf("sessions", String(s.no), src);
      const plots = ["activePlots", "completedPlots"].flatMap(k => arr(src[k]).flatMap((p, i) => {
        const lines = [at("plot", s.no, [k, i, "name"]), at("plot", s.no, [k, i, "qt"]), at("plot", s.no, [k, i, "closed"]),
          ...arr(p && p.notes).map((x, j) => at("plot", s.no, [k, i, "notes", j])),
          ...arr(p && p.npcs).map((x, j) => at("plot", s.no, [k, i, "npcs", j, "name"], [k, i, "npcs", j, "role"], [k, i, "npcs", j, "region"]))];
        const qid = p && p.questId;
        if (qid && questById.has(qid)) plotParts.set(qid, [...(plotParts.get(qid) || []), ...lines]);
        return lines;
      }));
      s.find = [part("title", null, s.title, variants("sessions", String(s.no), "title", s.titleEn)),
        at("opening", null, ["startedHere"]), at("ending", null, ["endedHere"]), at("recap", null, ["recap", "summary"]),
        ...s.eventIds.flatMap(id => eventParts.get(id)), ...plots,
        ...arr(src.effects).map((x, i) => at("effect", null, ["effects", i])),
        at("date", null, ["ig", "start"]), at("date", null, ["ig", "end"]), at("date", null, ["ig", "rest"]),
        ...s.questIds.map(id => named("quest", questById.get(id))),
        ...[...s.characterIds, ...s.npcIds].map(id => named("person", personById.get(id))),
        ...within(s.placeIds).map(id => named("place", placeById.get(id)))].filter(p => p.keys);
      s.findText = s.find.map(p => p.keys).join("\n");            // a query word never holds a line break: no match across parts
    });
    const rawQuests = new Map();
    arr(raw.quests).forEach(q => { if (q && q.id && !rawQuests.has(q.id)) rawQuests.set(q.id, q); });
    quests.forEach(q => {
      const src = rawQuests.get(q.id) || {}, at = textsOf("quests", q.id, src);
      q.find = [part("title", null, q.title, variants("quests", q.id, "title", q.titleEn)), at("summary", null, ["summary"]),
        ...q.objectivesEn.map((x, i) => at("objective", null, ["objectives", i])),
        src.giver !== "—" ? at("giver", null, ["giver"]) : null,              // a giverId's person is among the people below
        ...(plotParts.get(q.id) || []), ...q.eventIds.flatMap(id => eventParts.get(id)),
        ...[...q.characterIds, ...q.npcIds].map(id => named("person", personById.get(id))),
        ...within(q.placeIds).map(id => named("place", placeById.get(id)))].filter(p => p && p.keys);
      q.findText = q.find.map(p => p.keys).join("\n");
    });
    // People (the Characters list): exactly what its filter has always matched (`searchText`: names, aliases,
    // kind and role), one part per text so a row can say why it appeared — an alias, the kind, the role. A
    // translation whose aliases do not line up with the English ones still counts, through the last alias part.
    people.forEach(p => {
      const at = textsOf("people", p.id, rawPeople.get(p.id));
      p.find = [part("name", null, p.name, variants("people", p.id, "name", p.nameEn)),
        ...p.aliasesEn.map((x, i) => at("alias", null, ["aliases", i])),
        part("alias", null, p.aliases.join(", "), variants("people", p.id, "aliases", p.aliasesEn)),
        at("race", null, ["race"]), at("role", null, ["role"])].filter(x => x.keys);
      p.findText = p.find.map(x => x.keys).join("\n");
    });

    // Recap highlights: only events recorded in that same session, in the editor's order.
    sessions.forEach(s => {
      s.recap.highlightIds = uniq(s.recap.highlightIds).filter(id => {
        const ev = eventById.get(id);
        if (!ev) { error(`Session ${s.no}: recap highlight "${id}" is not an event`); return false; }
        if (ev.session !== s.no) { warn(`Session ${s.no}: recap highlight "${id}" belongs to session ${ev.session} — ignored`); return false; }
        return true;
      });
      if (s.recap.highlightIds.length > 5) warn(`Session ${s.no}: recap has ${s.recap.highlightIds.length} highlights — 3 to 5 read best`);
    });

    // Lore of Exandria — attached last, read-only beside the campaign data (see normalizeLore).
    const lore = normalizeLore(raw.lore, { content, locale, personById, placeById, warn, error, L, dateLabel });
    people.forEach(p => { p.lore = lore.byId.get(p.id) || null; });
    places.forEach(p => { p.lore = lore.byId.get(p.id) || null; });

    // Routes: per-character waypoints, cleaned into polyline segments (see normalizeRoutes).
    const routes = raw.routes && typeof raw.routes === "object" ? raw.routes : {};
    const routeById = normalizeRoutes(routes, personById, placeById, warn);

    const days = uniq(events.map(e => e.campaignDay).filter(isNum)).sort((a, b) => a - b);
    const dayLabels = {};
    events.forEach(e => { if (e.campaignDay != null && e.igDate && !e.dayApprox && !dayLabels[e.campaignDay]) dayLabels[e.campaignDay] = e.igDate; });

    return {
      locale, events, eventById, sessions, sessionByNo, quests, questById, people, personById, places, placeById,
      routes, routeById, days, dayLabels, issues, lore: lore.byId, loreSources: lore.sources,
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

  // ── Presentation order (never stored in the data) ─────────────────────────
  // Defaults: the Chronicle opens on the latest events, Sessions on the first session.
  // Only an explicit choice is persisted ("chronicleOrder" / "sessionsOrder": "asc" | "desc"),
  // so a default is never frozen into storage. Legacy prefs: `sessionsDesc: true` could only
  // come from the user (the old default was false) and is kept; the old `sortDesc` / a false
  // `sessionsDesc` were written along with any other preference, so they are dropped.
  const DEFAULT_ORDER = Object.freeze({ chronicle: "desc", sessions: "asc" });
  const isOrder = v => v === "asc" || v === "desc";

  function normalizePrefs(stored) {
    const p = stored && typeof stored === "object" ? stored : {};
    const out = {};
    if (p.groupBy === "day" || p.groupBy === "session") out.groupBy = p.groupBy;
    if (isOrder(p.chronicleOrder)) out.chronicleOrder = p.chronicleOrder;
    if (isOrder(p.sessionsOrder)) out.sessionsOrder = p.sessionsOrder;
    else if (p.sessionsDesc === true) out.sessionsOrder = "desc";
    return out;
  }

  function sortOrders(prefs) {
    const p = normalizePrefs(prefs);
    return { chronicle: p.chronicleOrder || DEFAULT_ORDER.chronicle, sessions: p.sessionsOrder || DEFAULT_ORDER.sessions };
  }

  // Chronicle groups (by campaign day or by session) in the chosen order. `events` must be in
  // chronological order (model.events / filterEvents). Only the groups are reversed for "desc":
  // inside a day or session the entries keep their recorded narrative order (day → session →
  // `order` → file order), so a day still reads from its first scene to its last. Events with
  // no campaign day form one "undated" group, always listed last.
  function chronicleGroups(events, { groupBy = "day", order = DEFAULT_ORDER.chronicle } = {}) {
    const groups = [], byKey = new Map();
    events.forEach(ev => {
      const key = groupBy === "session" ? `s${ev.session}` : (ev.campaignDay != null ? `d${ev.campaignDay}` : "d?");
      if (!byKey.has(key)) { const g = { key, events: [] }; byKey.set(key, g); groups.push(g); }
      byKey.get(key).events.push(ev);
    });
    if (order !== "desc") return groups;
    const undated = groups.filter(g => g.key === "d?");
    return [...groups.filter(g => g.key !== "d?").reverse(), ...undated];
  }

  // The Sessions list: sessions by number (numeric, never by label), with a gap marker for
  // every run of session numbers that has no entry. "desc" reverses the whole list.
  function sessionListItems(model, { order = DEFAULT_ORDER.sessions } = {}) {
    const asc = model.sessions.slice().sort((a, b) => a.no - b.no), items = [];
    asc.forEach((s, i) => {
      const prev = asc[i - 1];
      if (prev && s.no - prev.no > 1) items.push({ gap: true, from: prev.no + 1, to: s.no - 1 });
      items.push({ gap: false, session: s });
    });
    return order === "desc" ? items.reverse() : items;
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

  // ── Universal search (every kind of entry, ranked) ────────────────────────
  // One relevance scale for every kind, lower is better:
  //   0 the whole name/title (or alias, or "Session 12") is the query
  //   1 a name starts with the query          2 a word in a name starts with the query
  //   3 every word of the query is in a name  4 every word is in the entry's own text
  //     (summary, role, type, place, people… — the same text the Chronicle filter searches)
  //   5 every word is in its wider context (a quest's or session's linked people, places, events)
  // Names and texts hold the English original and every loaded translation, folded (no accents,
  // no case), so either language finds the same entry. Ties keep a fixed, useful order per kind.
  const SEARCH_KINDS = ["character", "place", "quest", "session", "event"];
  const wordsOf = s => " " + s.replace(/[^a-z0-9]+/g, " ").trim() + " ";
  // "s12" / "session 12" / "sesión 12" / "12" → { no: 12 }. A bare number with no such session means that campaign day.
  const numberQuery = q => { const m = /^(s|session|sesion)?\s*(\d+)$/.exec(q); return m ? { no: +m[2], bare: !m[1] } : null; };

  function scoreEntry(q, toks, names, own, context) {
    let best = null;
    const qw = wordsOf(q).trim();
    for (const n of names || []) {
      let s = null;
      if (n === q) return 0;
      if (n.startsWith(q)) s = 1;
      else if (qw && wordsOf(n).includes(" " + qw)) s = 2;
      else if (toks.every(t => n.includes(t))) s = 3;
      if (s != null && (best == null || s < best)) best = s;
    }
    if (best != null) return best;
    if (own && toks.every(t => own.includes(t))) return 4;
    if (context && toks.every(t => context.includes(t))) return 5;
    return null;
  }

  function searchAll(model, text, opts) {
    const o = opts || {}, maxScore = o.maxScore == null ? 5 : o.maxScore;
    const q = fold(text), toks = q.split(" ").filter(Boolean);
    const empty = { query: q, total: 0, groups: [] };
    if (!toks.length) return empty;
    const num = numberQuery(q);
    if (num) num.day = num.bare && !model.sessionByNo.has(num.no);   // "39": no session 39, so campaign day 39
    const kinds = o.kinds || SEARCH_KINDS;
    const candidates = {
      character: model.people.map(p => [p, scoreEntry(q, toks, p.nameKeys, p.searchText)]),
      place: model.places.map(p => [p, scoreEntry(q, toks, p.nameKeys, p.searchText)]),
      quest: model.quests.map(x => [x, scoreEntry(q, toks, x.nameKeys, x.searchText, x.contextText)]),
      // A number means that session (and its events) — never every text that happens to contain the digits.
      session: model.sessions.map(s => [s, num ? (s.no === num.no ? 0 : null) : scoreEntry(q, toks, s.nameKeys, s.searchText, s.contextText)]),
      event: model.events.map(e => [e, num ? ((num.day ? e.campaignDay === num.no : e.session === num.no) ? 4 : null) : scoreEntry(q, toks, e.nameKeys, e.searchText)]),
    };
    // Last-resort ties use the English names, so the order is the same in every language.
    const tie = {
      character: (a, b) => (a.kind === "pc" ? 0 : 1) - (b.kind === "pc" ? 0 : 1) || b.eventIds.length - a.eventIds.length || a.nameEn.localeCompare(b.nameEn),
      place: (a, b) => b.allEventIds.length - a.allEventIds.length || a.nameEn.localeCompare(b.nameEn),
      quest: (a, b) => a.statusOrder - b.statusOrder || (b.lastSession || 0) - (a.lastSession || 0) || a.titleEn.localeCompare(b.titleEn),
      session: (a, b) => b.no - a.no,
      event: (a, b) => b.chronoIndex - a.chronoIndex,                       // latest first, like the Chronicle
    };
    const groups = kinds.map(kind => {
      const items = candidates[kind].filter(([, s]) => s != null && s <= maxScore)
        .sort((a, b) => a[1] - b[1] || tie[kind](a[0], b[0]))
        .map(([entity, score]) => ({ kind, id: kind === "session" ? entity.no : entity.id, score, entity }));
      return { kind, items, best: items.length ? items[0].score : Infinity };
    }).filter(g => g.items.length)
      .sort((a, b) => a.best - b.best || SEARCH_KINDS.indexOf(a.kind) - SEARCH_KINDS.indexOf(b.kind));
    return { query: q, total: groups.reduce((n, g) => n + g.items.length, 0), groups };
  }

  // The Chronicle's "also in the archive" chips: people, quests, places and sessions whose own
  // text matches (no wider context), best matches first.
  function search(model, text, limit) {
    limit = limit || 6;
    const r = searchAll(model, text, { maxScore: 4, kinds: ["character", "quest", "place", "session"] });
    const of = kind => { const g = r.groups.find(x => x.kind === kind); return g ? g.items.slice(0, limit).map(i => i.entity) : []; };
    return { people: of("character"), quests: of("quest"), places: of("place"), sessions: of("session") };
  }

  // The Chronicle filter that shows the same events as a search: a session number becomes the
  // session filter (when that session exists), anything else the free-text filter.
  function chronicleFilterFor(model, text) {
    const num = numberQuery(fold(text));
    return num && model.sessionByNo.has(num.no) ? { session: String(num.no) } : { text: str(text).trim() };
  }

  // Where each word of the query first appears in `text` (case- and accent-insensitive), as
  // [start, end) ranges of the original string, merged — for highlighting a result's title.
  function highlightRanges(text, query) {
    const s = str(text), toks = fold(query).split(" ").filter(Boolean);
    if (!s || !toks.length) return [];
    let f = ""; const at = [];
    for (let i = 0; i < s.length; i++) {
      const c = s[i].normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[’‘`´]/g, "'").toLowerCase();
      for (const ch of c) { f += ch; at.push(i); }
    }
    const ranges = toks.map(t => { const i = f.indexOf(t); return i < 0 ? null : [at[i], at[i + t.length - 1] + 1]; })
      .filter(Boolean).sort((a, b) => a[0] - b[0]);
    return ranges.reduce((out, r) => { const last = out[out.length - 1]; if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]); else out.push(r); return out; }, []);
  }

  // ── Contextual search: the Sessions and Quests lists ──────────────────────
  // A filter, never a ranking: each list keeps its own order (Sessions the chosen one, Quests by status and
  // latest session), and the Quests status filter applies on top (AND). An entry is found when every word
  // of the query — accents and case ignored, in either language — is in its parts (build(): `find`); the
  // first part holding them all says why it appeared, { field, ref, text } — one that holds them in the
  // language on screen first (so they can be highlighted), else the part holding the most. A session
  // number ("12", "s12", "Sesión 12", "Session 12") means that session only, never stray digits; in Quests,
  // the quests recorded in that session. The Characters list (findPeople) reads numbers as words, as it
  // always has.
  function findIn(entries, keyOf, text, byNumber) {
    const q = fold(text), toks = q.split(" ").filter(Boolean), hits = new Map();
    const out = { query: q, searching: toks.length > 0, number: null, hits };
    if (!toks.length) return out;
    const num = byNumber ? numberQuery(q) : null;
    if (num) {
      out.number = num.no;
      entries.forEach(x => { const hit = byNumber(x, num.no); if (hit) hits.set(keyOf(x), hit); });
      return out;
    }
    entries.forEach(x => {
      if (!toks.every(t => x.findText.includes(t))) return;
      let here = null, all = null, some = null, most = 0;
      for (const p of x.find) {
        const n = toks.filter(t => p.keys.includes(t)).length;
        if (n === toks.length) {
          if (toks.every(t => p.shown.includes(t))) { here = p; break; }
          if (!all) all = p;
        } else if (n > most) { some = p; most = n; }
      }
      const best = here || all || some;
      if (best) hits.set(keyOf(x), { field: best.field, ref: best.ref, text: best.text });
    });
    return out;
  }

  function findSessions(model, text) {
    return findIn(model.sessions, s => s.no, text, (s, no) => (s.no === no ? { field: "number", ref: no, text: "" } : null));
  }

  function findQuests(model, text) {
    return findIn(model.quests, q => q.id, text, (q, no) => {
      const at = q.progress.find(p => p.session === no);
      if (!at) return null;
      const plot = at.plots[0], ev = at.eventIds.length ? model.eventById.get(at.eventIds[0]) : null;
      return { field: "session", ref: no, text: plot ? plot.qt || plot.name : ev ? ev.title : "" };
    });
  }

  function findPeople(model, text) {
    return findIn(model.people, p => p.id, text, null);
  }

  // A short piece of `text` around the query (accents and case ignored) — it opens a little before the first
  // place the query's longest word (the most telling one) appears — cut between words with an ellipsis, and
  // the ranges to highlight in it: the line saying why an entry appeared. Without the words in it (they were
  // in the other language), the text's beginning.
  function excerpt(text, query, opts) {
    const o = opts || {}, max = o.max || 160, lead = o.lead == null ? 32 : o.lead;
    const s = str(text).replace(/\s+/g, " ").trim();
    const at = fold(query).split(" ").filter(Boolean).sort((a, b) => b.length - a.length).map(w => highlightRanges(s, w)[0]).find(Boolean);
    let a = 0, b = s.length;
    if (s.length > max) {
      if (at && at[0] > lead) { const sp = s.indexOf(" ", at[0] - lead); a = sp >= 0 && sp < at[0] ? sp + 1 : at[0] - lead; }
      b = Math.min(s.length, a + max);
      if (b < s.length) { const sp = s.lastIndexOf(" ", b); if (sp > (at ? Math.max(a, at[1]) : a)) b = sp; }
    }
    const cut = (a > 0 ? "…" : "") + s.slice(a, b).trim() + (b < s.length ? "…" : "");
    return { text: cut, ranges: highlightRanges(cut, query) };
  }

  // ── The Places index: a tree of recorded parentId links ───────────────────
  // Siblings in story order — the first event recorded there or inside — then by name (`cmp`; English
  // names by default, so the order is the same in every language); places never visited come last.
  // The top level is split into the Atlas (the world on the map) and other planes (kind "plane": isPlanar).
  // Nothing is regrouped or inferred: a place without a parentId is simply a top-level place.
  function placeIndex(model, opts) {
    const o = opts || {}, byName = typeof o.cmp === "function" ? o.cmp : (a, b) => a.nameEn.localeCompare(b.nameEn);
    const first = p => (p.allEventIds.length ? model.eventById.get(p.allEventIds[0]).chronoIndex : Infinity);
    const sorted = list => list.slice().sort((a, b) => (first(a) - first(b)) || byName(a, b));
    const childIds = new Map(model.places.map(p => [p.id, sorted(p.childIds.map(id => model.placeById.get(id))).map(c => c.id)]));
    const size = id => childIds.get(id).reduce((n, c) => n + size(c), 1);
    const roots = sorted(model.places.filter(p => !p.parentId));
    const groups = [["atlas", roots.filter(p => !p.isPlanar)], ["planes", roots.filter(p => p.isPlanar)]]
      .filter(([, list]) => list.length)
      .map(([key, list]) => ({ key, rootIds: list.map(p => p.id), count: list.reduce((n, p) => n + size(p.id), 0) }));
    return { groups, childIds, branchIds: model.places.filter(p => p.childIds.length).map(p => p.id) };
  }

  // Every place once, in index order: a place, then what it holds (the Chronicle's place filter uses it).
  function placeOrder(model, index) {
    const out = [], walk = ids => ids.forEach(id => { out.push(id); walk(index.childIds.get(id)); });
    index.groups.forEach(g => walk(g.rootIds));
    return out;
  }

  // Branches the visitor opened or closed: `open` = { <placeId>: true|false }. Any other branch shows its
  // default — open at the top level, closed below — so the main places and their first level are in view.
  function isPlaceOpen(model, open, id) {
    const p = model.placeById.get(id);
    if (!p || !p.childIds.length) return false;
    return open && Object.prototype.hasOwnProperty.call(open, id) ? !!open[id] : !p.parentId;
  }

  // Opening a place shows it in the tree: its ancestors open. Nothing else changes — not the place itself
  // (selecting never unfolds it), not the other branches. The same object comes back when nothing had to.
  function revealPlace(model, open, id) {
    const cur = open || {}, p = model.placeById.get(String(id));
    const closed = p ? p.ancestorIds.filter(a => !isPlaceOpen(model, cur, a)) : [];
    if (!closed.length) return cur;
    const next = { ...cur };
    closed.forEach(a => { next[a] = true; });
    return next;
  }

  // What the tree shows: per group, nested nodes { id, depth, childCount, expanded, match, context, children }.
  // With a query, the places the universal search finds for it (names, aliases and kinds, in either
  // language, accents and case ignored) plus their ancestors as context, every branch on the way open.
  // A search never touches `open`, so clearing it brings the tree back exactly as it was.
  function placeTreeView(model, index, opts) {
    const o = opts || {}, open = o.open || {}, q = fold(o.query);
    const found = q ? searchAll(model, q, { kinds: ["place"] }).groups.flatMap(g => g.items.map(i => String(i.id))) : null;
    const matches = found && new Set(found);
    const keep = found && new Set(found.flatMap(id => [id, ...model.placeById.get(id).ancestorIds]));
    const rootOf = id => { const a = model.placeById.get(id).ancestorIds; return a.length ? a[a.length - 1] : id; };
    const node = (id, depth) => {
      const kids = index.childIds.get(id), shown = keep ? kids.filter(k => keep.has(k)) : kids;
      const expanded = keep ? shown.length > 0 : isPlaceOpen(model, open, id);
      return { id, depth, childCount: kids.length, expanded, match: !!matches && matches.has(id), context: !!matches && !matches.has(id),
        children: expanded ? shown.map(k => node(k, depth + 1)) : [] };
    };
    const groups = index.groups.map(g => {
      const roots = keep ? g.rootIds.filter(id => keep.has(id)) : g.rootIds;
      return { key: g.key, count: g.count, matchCount: matches ? found.filter(id => g.rootIds.includes(rootOf(id))).length : g.count,
        nodes: roots.map(id => node(id, 0)) };
    }).filter(g => g.nodes.length);
    return {
      query: q, searching: !!matches, total: model.places.length, matchCount: matches ? matches.size : model.places.length, groups,
      allOpen: index.branchIds.every(id => isPlaceOpen(model, open, id)), allClosed: index.branchIds.every(id => !isPlaceOpen(model, open, id)),
    };
  }

  // ── Entries by reference (favourites, history, links) ─────────────────────
  function resolveRef(model, kind, id) {
    if (!model || id == null) return null;
    if (kind === "event") return model.eventById.get(String(id)) || null;
    if (kind === "session") return model.sessionByNo.get(Number(id)) || null;
    if (kind === "quest") return model.questById.get(String(id)) || null;
    if (kind === "character") return model.personById.get(String(id)) || null;
    if (kind === "place") return model.placeById.get(String(id)) || null;
    return null;
  }

  // ── "Previously on…" ──────────────────────────────────────────────────────
  // The latest session is the highest session NUMBER that has a log in sessions.json (never the
  // order of labels or of the Sessions list); if none has a log yet, the highest with events.
  function latestSession(model) {
    const logged = model.sessions.filter(s => !s.isStub);
    return (logged.length ? logged : model.sessions).reduce((a, s) => (!a || s.no > a.no ? s : a), null);
  }

  // Everything the recap shows, taken as recorded — no event is ranked unless an editor listed it
  // in sessions.json recap.highlights; otherwise every recorded event is listed in order.
  function recapOf(model, no) {
    const s = model.sessionByNo.get(Number(no));
    if (!s) return null;
    const events = s.eventIds.map(id => model.eventById.get(id));
    const highlights = s.recap.highlightIds.map(id => model.eventById.get(id));
    const curated = highlights.length > 0;
    const latest = latestSession(model);
    return {
      session: s, isLatest: !!latest && latest.no === s.no, curated,
      summary: s.recap.summary, summaryFallback: s.recap.summaryFallback,
      events, highlights,
      // With highlights, decisions not among them are listed apart; without, they are already in the list.
      decisions: curated ? events.filter(e => e.type === "decision" && !highlights.includes(e)) : [],
      quests: s.questIds.map(id => model.questById.get(id)).sort((a, b) => a.statusOrder - b.statusOrder || a.titleEn.localeCompare(b.titleEn)),
      pending: s.activePlots,                          // threads recorded as still open at the session's end
      closed: s.completedPlots,
      unresolved: events.flatMap(e => e.unresolved.map(text => ({ eventId: e.id, text }))),
      effects: s.effects, startedHere: s.startedHere, endedHere: s.endedHere,
    };
  }

  // Real examples for the guide, picked from the data (so they follow the campaign as it grows).
  function guideExamples(model) {
    const evs = model.events;
    const rich = evs.slice().reverse().find(e => e.characterIds.length && e.questIds.length && e.locationId) || evs[evs.length - 1] || null;
    const person = model.pcs.slice().sort((a, b) => b.eventIds.length - a.eventIds.length)[0] || model.people[0] || null;
    const mapped = rich && rich.hasCoords ? rich : evs.slice().reverse().find(e => e.hasCoords) || null;
    return { event: rich, person, mapEvent: mapped };
  }

  return { build, filterEvents, search, searchAll, chronicleFilterFor, highlightRanges, findSessions, findQuests, findPeople, excerpt,
    SEARCH_KINDS, resolveRef, latestSession, recapOf, guideExamples,
    placeIndex, placeOrder, placeTreeView, isPlaceOpen, revealPlace,
    activeFilterCount, matchesCharacters, selectedCharacterIds, toggleVisibleCharacter,
    chronicleGroups, sessionListItems, normalizePrefs, sortOrders, DEFAULT_ORDER,
    checkTranslations, normalizeRoutes, normalizeLore, safeExternalUrl, fold, FILTER_PREDICATES, EMPTY_FILTERS, NO_CHARACTER, NO_ONE,
    EVENT_TYPES, QUEST_STATUS, PERSON_CATEGORIES, PLACE_KINDS, LORE_FACTS, fmtDate, parseDay, parseRecorded, splitIgLabel };
});
