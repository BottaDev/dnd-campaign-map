// ── Chronicle editor core ───────────────────────────────────────────────────
// The data side of the Taller del Cronista (the DM's editor) and of the map editor. No DOM, no React:
// it runs in the browser (window.ChronicleEditor, loaded only when the Taller or the map editor opens)
// and in Node (tests/, tools/apply-draft.js).
//
//   Coordinates  pointer ↔ map percent from the map's real on-screen box, so zoom, pan, screen size and CSS
//                transforms never change the result; nudges, the text to copy.
//   Suggestions  where an event (or place) probably is — recorded positions only, saying where it came from.
//   Drafts       record-level changes over the published data. A record is a pair { en, es }: its object in
//                data/*.json and its entry in the Spanish overlay (data/i18n/es-AR.json). Each change keeps
//                the published version it was edited from, so newer published data is never overwritten
//                silently (conflicts, field-level merges).
//   Validation   ChronicleModel.validateData on the applied data (only what the draft introduced) plus the
//                form checks, each tied to its record and field.
//   Export       the applied data written in each file's own JSON layout (untouched files and records stay
//                byte-identical), a dependency-free ZIP (stored entries), the draft file (import sanitized).
//   Storage      IndexedDB (memory when unavailable) with revisions — two tabs never overwrite each other —
//                and automatic backups before anything destructive.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./chronicle-model.js"));
  else root.ChronicleEditor = factory(root.ChronicleModel);
})(typeof self !== "undefined" ? self : this, function (Model) {
  "use strict";

  // ── Small helpers ─────────────────────────────────────────────────────────
  const isObj = v => v != null && typeof v === "object" && !Array.isArray(v);
  const isNum = v => typeof v === "number" && isFinite(v);
  const nonEmpty = v => typeof v === "string" && v.trim() !== "";
  const arr = v => (Array.isArray(v) ? v : []);
  const str = v => (v == null ? "" : String(v));
  const clone = v => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
  const fold = s => Model.fold(s);
  // JSON with sorted keys: two values are the same record whatever their key order.
  function canonical(v) {
    if (Array.isArray(v)) return "[" + v.map(canonical).join(",") + "]";
    if (isObj(v)) return "{" + Object.keys(v).sort().filter(k => v[k] !== undefined).map(k => JSON.stringify(k) + ":" + canonical(v[k])).join(",") + "}";
    return JSON.stringify(v === undefined ? null : v);
  }
  const same = (a, b) => canonical(a == null ? null : a) === canonical(b == null ? null : b);
  // cyrb53 (public domain): a fast 53-bit string hash — fingerprints of published data, not security.
  function hash(s) {
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677); }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507); h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507); h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
  }
  const hashOf = v => hash(canonical(v == null ? null : v));
  const isEmpty = v => v == null || v === "" || (Array.isArray(v) && !v.length) || (isObj(v) && !Object.keys(v).length);
  const getIn = (o, path) => path.reduce((a, k) => (a == null ? undefined : a[k]), o);
  // Immutable set: containers are copied along the path (a number key makes an array).
  function setIn(o, path, v) {
    if (!path.length) return v;
    const [k, ...rest] = path;
    const base = o == null ? (typeof k === "number" ? [] : {}) : o;
    const copy = Array.isArray(base) ? base.slice() : { ...base };
    copy[k] = setIn(base[k], rest, v);
    return copy;
  }
  function deleteIn(o, path) {
    if (o == null || !path.length) return o;
    const [k, ...rest] = path;
    const copy = Array.isArray(o) ? o.slice() : { ...o };
    if (!rest.length) { if (Array.isArray(copy)) copy.splice(k, 1); else delete copy[k]; return copy; }
    copy[k] = deleteIn(o[k], rest);
    return copy;
  }

  // ── Map coordinates ───────────────────────────────────────────────────────
  // Events and places are positioned in percent of the map image (assets/exandria-map.jpeg, 8100×5400 px;
  // the preview is the same picture at 2400×1600): a resolution-free system, kept as it is. Two decimals are
  // stored — 0.01 % is under one pixel of the full-resolution map.
  const MAP_AR = 5400 / 8100;
  const DECIMALS = 2;
  const roundPct = v => Math.round(v * 100) / 100;
  const clampPct = v => Math.min(100, Math.max(0, v));
  const validPoint = p => !!p && isNum(p.xp) && isNum(p.yp) && p.xp >= 0 && p.xp <= 100 && p.yp >= 0 && p.yp <= 100;
  const point = (xp, yp) => ({ xp: roundPct(clampPct(+xp)), yp: roundPct(clampPct(+yp)) });

  // Pointer → map percent. `rect` is the on-screen box of the element the markers are positioned in (its
  // getBoundingClientRect): left, top and width already include every CSS translate and scale, so the result is
  // the same at any zoom, pan, container or screen size, on any device. The height comes from the map's aspect
  // ratio (the picture may still be loading). A point off the map is clamped to its edge (inside: false).
  function clientToPercent(clientX, clientY, rect, ar) {
    const w = rect && rect.width, h = w * (ar || MAP_AR);
    if (!(w > 0)) return null;
    const x = (clientX - rect.left) / w * 100, y = (clientY - rect.top) / h * 100;
    return { ...point(x, y), inside: x >= 0 && x <= 100 && y >= 0 && y <= 100 };
  }
  // Map percent → pointer position on screen (the inverse, for tests and for placing things over a point).
  function percentToClient(p, rect, ar) {
    return { x: rect.left + p.xp / 100 * rect.width, y: rect.top + p.yp / 100 * rect.width * (ar || MAP_AR) };
  }
  // The same from the map viewport's own state (index.html MapViewport: at zoom 1 the map is as wide as the
  // viewport, `view` translates it by x/y px and scales it by `scale`); sx/sy relative to the viewport.
  function viewToPercent(sx, sy, view, viewportWidth, ar) {
    return clientToPercent(sx, sy, { left: view.x, top: view.y, width: viewportWidth * view.scale }, ar);
  }
  // One screen pixel of the map at this zoom, in percent (never under the stored precision): an arrow key moves a
  // marker by one visible pixel whatever the zoom; Shift moves it ten.
  function pixelStep(mapWidthPx, ar) {
    const w = mapWidthPx > 0 ? mapWidthPx : 1000;
    return { x: Math.max(0.01, roundPct(100 / w)), y: Math.max(0.01, roundPct(100 / (w * (ar || MAP_AR)))) };
  }
  const nudge = (p, dx, dy) => point(p.xp + dx, p.yp + dy);
  // What "Copiar coordenadas" puts on the clipboard: valid JSON, ready to paste into a data file or a prompt.
  const coordsText = p => `{"xp": ${roundPct(p.xp).toFixed(DECIMALS)}, "yp": ${roundPct(p.yp).toFixed(DECIMALS)}}`;
  // A pasted position: that JSON, "42.3, 39.51", "xp 42.3 yp 39.51"… → a point, or null.
  function parseCoords(text) {
    const s = str(text);
    const named = /xp["'\s:=]*(-?\d+(?:[.,]\d+)?)[\s\S]*?yp["'\s:=]*(-?\d+(?:[.,]\d+)?)/i.exec(s);
    const pair = named || /(-?\d+(?:\.\d+)?)\s*[,;\s]\s*(-?\d+(?:\.\d+)?)/.exec(s);
    if (!pair) return null;
    const x = parseFloat(pair[1].replace(",", ".")), y = parseFloat(pair[2].replace(",", "."));
    return isNum(x) && isNum(y) && x >= 0 && x <= 100 && y >= 0 && y <= 100 ? point(x, y) : null;
  }

  // ── Position suggestions ──────────────────────────────────────────────────
  // Where an event at `locationId` probably is, from what is recorded on the (draft) model — never invented,
  // always saying where it comes from:
  //   source "place"  — the place's own reference position (locations.json xp/yp), exact or approximate as recorded
  //   source "events" — the point most used by other events at this place (approximate)
  //   source "inside" — the point most used by events at places inside it (approximate)
  //   source "parent" — the reference or the events of the nearest place it lies in (approximate)
  //   source null     — no known position; reason "noPlace" | "unknownPlace" | "planar" (never on the map) | "none"
  // `excludeEventId` keeps an event from suggesting its own position. Ties go to the most recent event's point.
  function mostUsed(evs) {
    const by = new Map();
    evs.forEach(e => {
      const k = `${e.xp},${e.yp}`, c = by.get(k) || { xp: e.xp, yp: e.yp, n: 0, last: -1, ids: [] };
      c.n++; c.last = Math.max(c.last, isNum(e.chronoIndex) ? e.chronoIndex : 0); c.ids.push(e.id); by.set(k, c);
    });
    return [...by.values()].sort((a, b) => b.n - a.n || b.last - a.last)[0] || null;
  }
  function suggestPosition(model, opts) {
    const o = opts || {}, id = o.locationId;
    if (!id) return { source: null, reason: "noPlace" };
    const pl = model.placeById.get(id);
    if (!pl) return { source: null, reason: "unknownPlace", placeId: id };
    if (pl.isPlanar) return { source: null, reason: "planar", placeId: id };
    const located = ids => ids.map(x => model.eventById.get(x)).filter(e => e && e.hasCoords && e.id !== o.excludeEventId);
    const from = (source, placeId, evs, precision) => {
      const best = mostUsed(evs);
      return { source, placeId, precision: precision || "approximate", point: point(best.xp, best.yp), count: evs.length, sameCount: best.n, eventIds: best.ids };
    };
    if (pl.ref) return { source: "place", placeId: id, precision: pl.ref.precision, point: point(pl.ref.xp, pl.ref.yp) };
    const here = located(pl.eventIds);
    if (here.length) return from("events", id, here);
    const inside = located(pl.allEventIds.filter(x => !pl.eventIds.includes(x)));
    if (inside.length) return from("inside", id, inside);
    for (const aid of pl.ancestorIds) {
      const a = model.placeById.get(aid);
      if (!a) continue;
      if (a.ref) return { source: "parent", placeId: aid, precision: "approximate", point: point(a.ref.xp, a.ref.yp) };
      const evs = located(a.allEventIds);
      if (evs.length) return from("parent", aid, evs);
    }
    return { source: null, reason: "none", placeId: id };
  }

  // ── Records ───────────────────────────────────────────────────────────────
  // The kinds of record the Taller edits: their file in data/, and their part of the content translation.
  // Routes and lore are never edited here (routes are drawn journeys; lore is curated canon with sources).
  const LOCALE = "es-AR";
  const CONTENT_PATH = `data/i18n/${LOCALE}.json`;
  const KINDS = {
    session:   { file: "sessions",   content: "sessions", keyed: true },
    event:     { file: "events",     content: "events" },
    quest:     { file: "quests",     content: "quests" },
    place:     { file: "locations",  content: "places" },
    character: { file: "characters", content: "people" },
    npc:       { file: "npcs",       content: "people" },
  };
  const KIND_LIST = Object.keys(KINDS);
  const EDITABLE_FILES = ["characters", "npcs", "locations", "quests", "sessions", "events"];
  // The usual order of fields, as the files have them (README): an existing record keeps its own order and a
  // field added to it goes to its usual place; a new record is written in this order.
  const FIELDS = {
    event: ["id", "date", "session", "campaignDay", "igDate", "igLabel", "order", "type", "title", "summary", "description", "consequences", "unresolved",
      "locationId", "xp", "yp", "characterIds", "npcIds", "questIds", "relatedEventIds"],
    session: ["dateLabel", "title", "playedOn", "startedHere", "endedHere", "ig", "effects", "activePlots", "completedPlots", "recap"],
    quest: ["id", "title", "status", "giver", "giverId", "summary", "objectives", "sessions", "characterIds"],
    place: ["id", "name", "aliases", "kind", "parentId", "xp", "yp", "mapPrecision"],
    character: ["id", "name", "role", "color", "sealImg", "aliases", "relations"],
    npc: ["id", "name", "aliases", "category", "race", "role", "sealImg", "factionIds", "relations"],
  };
  const ES_FIELDS = {
    event: ["title", "summary", "igLabel", "description", "consequences", "unresolved"],
    session: ["title", "startedHere", "endedHere", "ig", "effects", "activePlots", "completedPlots", "recap"],
    quest: ["title", "giver", "summary", "objectives"],
    place: ["name", "aliases"],
    character: ["name", "aliases", "race", "role", "relations"],
    npc: ["name", "aliases", "race", "role", "relations"],
  };
  const SUB_FIELDS = { ig: ["start", "end", "rest"], recap: ["summary", "highlights"], plot: ["name", "questId", "closed", "qt", "npcs", "notes"],
    plotNpc: ["name", "race", "region", "role"], relation: ["id", "label", "reverseLabel"] };
  // What is translated (and so written as a pair): plain texts, positional lists of texts, lists of objects
  // with translated fields — the overlays ChronicleModel.build() reads. Ids, dates, numbers and links never are.
  const TEXTS = {
    event: { strings: [["title"], ["summary"], ["igLabel"], ["description"]], lists: [["consequences"], ["unresolved"]] },
    session: { strings: [["title"], ["startedHere"], ["endedHere"], ["ig", "start"], ["ig", "end"], ["ig", "rest"], ["recap", "summary"]], lists: [["effects"]],
      plots: ["activePlots", "completedPlots"] },
    quest: { strings: [["title"], ["summary"], ["giver"]], lists: [["objectives"]] },
    place: { strings: [["name"]], lists: [["aliases"]] },
    character: { strings: [["name"], ["race"], ["role"]], lists: [["aliases"]], objects: { relations: ["label", "reverseLabel"] } },
    npc: { strings: [["name"], ["race"], ["role"]], lists: [["aliases"]], objects: { relations: ["label", "reverseLabel"] } },
  };
  const PLOT_TEXTS = { strings: ["name", "qt", "closed"], lists: ["notes"], npcs: ["name", "race", "role", "region"] };

  // Keys of `obj` in the published record's order; a key the record did not have goes after the last present key
  // that precedes it in the usual order (unknown new keys last).
  function orderKeys(obj, canon, prevKeys) {
    const keys = Object.keys(obj), at = k => { const i = canon.indexOf(k); return i < 0 ? Infinity : i; };
    const out = (prevKeys || []).filter(k => k in obj);
    keys.filter(k => !out.includes(k)).sort((a, b) => at(a) - at(b)).forEach(k => {
      const ci = at(k);
      let pos = out.length;
      if (ci !== Infinity) { pos = 0; out.forEach((x, j) => { if (at(x) <= ci) pos = j + 1; }); }
      out.splice(pos, 0, k);
    });
    const res = {};
    out.forEach(k => { res[k] = obj[k]; });
    return res;
  }
  // A record as the draft stores it: an empty field is removed unless the published record had it empty too
  // (so untouched records never change), keys in the published order, nested objects tidied the same way.
  // Lists keep empty items while they are being written — the export drops them.
  function tidyObject(o, canon, prev) {
    if (!isObj(o)) return o;
    const out = {};
    Object.keys(o).forEach(k => {
      const v = o[k];
      if (isEmpty(v) && !(isObj(prev) && k in prev && isEmpty(prev[k]))) return;
      out[k] = v;
    });
    return orderKeys(out, canon, isObj(prev) ? Object.keys(prev) : []);
  }
  function tidyEn(kind, en, prev) {
    if (!isObj(en)) return null;
    let o = { ...en };
    if (kind === "session") ["ig", "recap"].forEach(k => { if (isObj(o[k])) o[k] = tidyObject(o[k], SUB_FIELDS[k], prev && prev[k]); });
    return tidyObject(o, FIELDS[kind], prev);
  }
  function tidyEs(kind, es) {
    if (!isObj(es)) return null;
    let o = { ...es };
    if (kind === "session") ["ig", "recap"].forEach(k => { if (isObj(o[k])) o[k] = tidyObject(o[k], SUB_FIELDS[k], null); });
    const out = tidyObject(o, ES_FIELDS[kind], null);
    return Object.keys(out).length ? out : null;
  }

  // ── Bilingual pairs ───────────────────────────────────────────────────────
  // The forms edit a pair: `en` (data/*.json) and `es` (the Spanish overlay, sparse). Every list keeps the two
  // languages aligned item by item — the overlay's lists are positional — so adding, removing or reordering an item
  // never pairs a translation with the wrong text.
  const textAt = (pair, path, lang) => str(getIn(pair && pair[lang], path));
  // Whether the overlay's lists along `path` (every list the path goes through) are as long as the English ones —
  // the page ignores a translation list that is not — and the overlay's list at `path` when it is.
  function alignment(pair, path) {
    for (let i = 0; i < path.length; i++) {
      if (typeof path[i] !== "number") continue;
      const lp = path.slice(0, i), e = getIn(pair.en, lp), s = getIn(pair.es, lp);
      if (!Array.isArray(s) || !Array.isArray(e) || s.length !== e.length) return { parents: false, list: null };
    }
    const en = arr(getIn(pair.en, path)), es = getIn(pair.es, path);
    return { parents: true, list: Array.isArray(es) && es.length === en.length ? es : null };
  }
  const esList = (pair, path) => alignment(pair, path).list;
  // Every list along `path` in the overlay exists and matches the English one's length (a translation that no
  // longer lined up is dropped: the page was not showing it).
  function alignEs(pair, path) {
    let es = isObj(pair.es) ? pair.es : {};
    for (let i = 0; i < path.length; i++) {
      if (typeof path[i] !== "number") continue;
      const listPath = path.slice(0, i), en = arr(getIn(pair.en, listPath));
      const cur = getIn(es, listPath);
      if (!Array.isArray(cur) || cur.length !== en.length) es = setIn(es, listPath, en.map(x => (typeof x === "string" ? "" : {})));
    }
    return { ...pair, es };
  }
  function withText(pair, path, lang, value) {
    if (lang === "en") return { ...pair, en: setIn(pair.en || {}, path, value) };
    const p = alignEs(pair, path);
    return { ...p, es: setIn(p.es, path, value) };
  }
  // List operations on both languages at once: withList(pair, path, "add", index?, item = "") · "remove", index ·
  // "move", index, ±1. A translation list that no longer lined up is dropped (the page was not showing it).
  function withList(pair, path, op, index, extra) {
    const en = arr(getIn(pair.en, path)).slice(), al = alignment(pair, path), es2 = al.list ? al.list.slice() : null;
    if (op === "add") {
      const at = index == null ? en.length : Math.max(0, Math.min(en.length, index));
      const item = extra === undefined ? "" : clone(extra);
      en.splice(at, 0, item);
      if (es2) es2.splice(at, 0, typeof item === "string" ? "" : {});
    } else if (op === "remove") {
      if (!(index >= 0 && index < en.length)) return pair;
      en.splice(index, 1); if (es2) es2.splice(index, 1);
    } else if (op === "move") {
      const j = index + extra;
      if (!(index >= 0 && index < en.length && j >= 0 && j < en.length)) return pair;
      [en[index], en[j]] = [en[j], en[index]];
      if (es2) [es2[index], es2[j]] = [es2[j], es2[index]];
    } else return pair;
    let out = { ...pair, en: setIn(pair.en || {}, path, en) };
    if (es2) out = { ...out, es: setIn(pair.es || {}, path, es2) };
    else if (al.parents && getIn(pair.es, path) !== undefined) out = { ...out, es: deleteIn(pair.es, path) };
    return out;
  }
  // A plain (not translated) field: ids, numbers, dates, links, coordinates.
  const withField = (pair, path, value) => ({ ...pair, en: setIn(pair.en || {}, path, value) });

  // ── Drafts ────────────────────────────────────────────────────────────────
  // { format, version, id, createdAt, updatedAt, rev, base: { files: { <file>: hash }, at },
  //   changes: { <kind>: { <id>: { op: "set"|"delete", en, es, base: { en, es } | null (new record), at } } } }
  // `base` on a change is the published pair when the record was first edited: if the published record is no
  // longer that one, the change is a conflict and is never exported until the DM decides.
  const DRAFT_FORMAT = "chronicle-taller-draft";
  const DRAFT_VERSION = 1;
  const nowIso = () => new Date().toISOString();
  const randomId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  // The published data the Taller works on: { raw: { characters, events, …, routes, lore }, content: es-AR overlay }.
  function fingerprint(base) {
    const raw = (base && base.raw) || {}, files = {};
    EDITABLE_FILES.forEach(f => { files[f] = hashOf(raw[f]); });
    files.content = hashOf((base && base.content) || null);
    return files;
  }
  function emptyDraft(base, now) {
    const at = now || nowIso(), changes = {};
    KIND_LIST.forEach(k => { changes[k] = {}; });
    return { format: DRAFT_FORMAT, version: DRAFT_VERSION, id: randomId(), createdAt: at, updatedAt: at, rev: 0,
      base: { files: fingerprint(base), at }, changes };
  }
  const changesOf = (draft, kind) => (draft && draft.changes && draft.changes[kind]) || {};
  // The published version of a record: { en, es } (en null when it is not published).
  function publishedPair(base, kind, id) {
    const k = KINDS[kind], raw = (base && base.raw) || {}, content = (base && base.content) || {};
    const key = String(id);
    const en = k.keyed ? (isObj(raw[k.file]) ? raw[k.file][key] : null) : arr(raw[k.file]).find(r => r && r.id === key);
    const tr = isObj(content[k.content]) ? content[k.content][key] : null;
    return { en: en ? clone(en) : null, es: isObj(tr) ? clone(tr) : null };
  }
  const publishedOrNull = (base, kind, id) => { const p = publishedPair(base, kind, id); return p.en ? p : null; };
  // The record as the draft has it now (null when deleted or unknown).
  function currentPair(draft, base, kind, id) {
    const ch = changesOf(draft, kind)[String(id)];
    if (ch) return ch.op === "delete" ? null : { en: clone(ch.en), es: clone(ch.es) || null };
    return publishedOrNull(base, kind, id);
  }
  function statusOf(draft, kind, id) {
    const ch = changesOf(draft, kind)[String(id)];
    return !ch ? "published" : ch.op === "delete" ? "deleted" : ch.base ? "modified" : "new";
  }
  const bump = (draft, changes, now) => ({ ...draft, changes, updatedAt: now || nowIso(), rev: (draft.rev || 0) + 1 });
  const pairsEqual = (a, b) => same(a ? a.en : null, b ? b.en : null) && same(a ? a.es || null : null, b ? b.es || null : null);
  // Writes a record into the draft. A record brought back to its published state leaves the draft.
  function putRecord(draft, base, kind, id, pair, now) {
    const key = String(id), prev = changesOf(draft, kind)[key];
    const from = prev ? prev.base : publishedOrNull(base, kind, key);
    const en = tidyEn(kind, pair.en, from && from.en), es = tidyEs(kind, pair.es);
    const next = { ...changesOf(draft, kind) };
    if (from && pairsEqual(from, { en, es })) delete next[key];
    else next[key] = { op: "set", en, es, base: from ? clone(from) : null, at: now || nowIso() };
    return bump(draft, { ...draft.changes, [kind]: next }, now);
  }
  // Removes a record: a new one simply leaves the draft; a published one is marked for deletion.
  function deleteRecord(draft, base, kind, id, now) {
    const key = String(id), prev = changesOf(draft, kind)[key];
    const from = prev ? prev.base : publishedOrNull(base, kind, key);
    const next = { ...changesOf(draft, kind) };
    if (!from) delete next[key];
    else next[key] = { op: "delete", en: null, es: null, base: clone(from), at: now || nowIso() };
    return bump(draft, { ...draft.changes, [kind]: next }, now);
  }
  // Forgets the draft's change to one record (the published version comes back).
  function revertRecord(draft, kind, id, now) {
    const key = String(id);
    if (!changesOf(draft, kind)[key]) return draft;
    const next = { ...changesOf(draft, kind) };
    delete next[key];
    return bump(draft, { ...draft.changes, [kind]: next }, now);
  }

  // Every id in use (published and draft, deletions included until exported) for a kind's namespace: people and
  // places share one (the model rejects a person and a place with the same id).
  function idsInUse(base, draft, kind) {
    const raw = (base && base.raw) || {}, out = new Set();
    const kinds = kind === "quest" ? ["quest"] : kind === "event" ? ["event"] : kind === "session" ? ["session"] : ["character", "npc", "place"];
    kinds.forEach(k => {
      const K = KINDS[k];
      if (K.keyed) Object.keys(isObj(raw[K.file]) ? raw[K.file] : {}).forEach(x => out.add(x));
      else arr(raw[K.file]).forEach(r => { if (r && r.id) out.add(String(r.id)); });
      Object.keys(changesOf(draft, k)).forEach(x => out.add(x));
    });
    return out;
  }
  const ID_RE = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/;
  // "Gilmore's shop" → "gilmores-shop" (the repository's convention: lower case, accents dropped, hyphens).
  function slugify(text) {
    return fold(text).replace(/['`]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48).replace(/-+$/, "");
  }
  function uniqueId(baseId, taken) {
    const b = baseId || "entry";
    if (!taken.has(b)) return b;
    for (let i = 2; ; i++) if (!taken.has(`${b}-${i}`)) return `${b}-${i}`;
  }
  // A new quest, place or person: its name as an id, unique in its namespace.
  const newRecordId = (base, draft, kind, name) => uniqueId(slugify(name) || kind, idsInUse(base, draft, kind));
  // Events: s<session>_<nn>, the next number of that session.
  function nextEventId(base, draft, session) {
    const taken = idsInUse(base, draft, "event"), re = new RegExp(`^s${Number(session)}_(\\d+)$`);
    let n = 0;
    taken.forEach(id => { const m = re.exec(id); if (m) n = Math.max(n, +m[1]); });
    let id;
    do { n++; id = `s${Number(session)}_${String(n).padStart(2, "0")}`; } while (taken.has(id));
    return id;
  }
  function sessionNumbers(base, draft) {
    const raw = (base && base.raw) || {}, nos = new Set(Object.keys(isObj(raw.sessions) ? raw.sessions : {}).map(Number));
    Object.entries(changesOf(draft, "session")).forEach(([k, ch]) => { if (ch.op === "delete") nos.delete(+k); else nos.add(+k); });
    return [...nos].filter(n => Number.isInteger(n) && n > 0).sort((a, b) => a - b);
  }
  const nextSessionNo = (base, draft) => { const n = sessionNumbers(base, draft); return n.length ? n[n.length - 1] + 1 : 1; };

  // A new record's id can still change (its title, an event's session): every link to it inside the draft
  // follows. Published records never change id — other files and shared links point at them.
  function renameNew(draft, kind, oldId, newId, now) {
    const from = String(oldId), to = String(newId), ch = changesOf(draft, kind)[from];
    if (!ch || ch.base || from === to || changesOf(draft, kind)[to]) return draft;
    const swap = v => (String(v) === from ? (kind === "session" ? Number(to) : to) : v);
    const mapIds = list => (Array.isArray(list) ? list.map(swap) : list);
    const changes = {};
    KIND_LIST.forEach(k => {
      changes[k] = {};
      Object.entries(changesOf(draft, k)).forEach(([id, c]) => {
        let en = c.en;
        if (en && c.op === "set") {
          en = { ...en };
          if (kind === "event" && k === "event") en.relatedEventIds = mapIds(en.relatedEventIds);
          if (kind === "event" && k === "session" && isObj(en.recap)) en.recap = { ...en.recap, highlights: mapIds(en.recap.highlights) };
          if (kind === "quest" && k === "event") en.questIds = mapIds(en.questIds);
          if (kind === "quest" && k === "session") ["activePlots", "completedPlots"].forEach(pk => { if (Array.isArray(en[pk])) en[pk] = en[pk].map(p => (p && p.questId === from ? { ...p, questId: to } : p)); });
          if (kind === "place" && k === "event" && en.locationId === from) en.locationId = to;
          if (kind === "place" && k === "place" && en.parentId === from) en.parentId = to;
          if ((kind === "character" || kind === "npc") && k === "event") { en.characterIds = mapIds(en.characterIds); en.npcIds = mapIds(en.npcIds); }
          if ((kind === "character" || kind === "npc") && k === "quest") { if (en.giverId === from) en.giverId = to; en.characterIds = mapIds(en.characterIds); }
          if ((kind === "character" || kind === "npc") && (k === "npc" || k === "character")) {
            en.factionIds = mapIds(en.factionIds);
            if (Array.isArray(en.relations)) en.relations = en.relations.map(r => (r && r.id === from ? { ...r, id: to } : r));
          }
          if (kind === "session" && k === "event" && String(en.session) === from) en.session = Number(to);
          Object.keys(en).forEach(x => { if (en[x] === undefined) delete en[x]; });
        }
        const key = k === kind && id === from ? to : id;
        changes[k][key] = key === to && k === kind ? { ...c, en: en && kind !== "session" ? { ...en, id: to } : en } : { ...c, en };
      });
    });
    return bump(draft, changes, now);
  }

  // A new session renumbered: its events follow, and its new events take ids of the new number (s<no>_<nn>).
  function renameSession(base, draft, from, to, now) {
    let d = renameNew(draft, "session", String(from), String(to), now);
    if (d === draft) return draft;
    const re = new RegExp(`^s${Number(from)}_\\d+$`);
    Object.entries(changesOf(d, "event")).forEach(([id, c]) => {
      if (!c.base && c.op === "set" && c.en && Number(c.en.session) === Number(to) && re.test(id)) d = renameNew(d, "event", id, nextEventId(base, d, to), now);
    });
    return d;
  }

  // ── Applying a draft ──────────────────────────────────────────────────────
  // The finishing touches a record gets on its way out (the draft keeps what the DM typed):
  //   • a text written only in Spanish is also the English text (data/*.json must have it; the page shows it in
  //     both languages until someone translates it — the validator says so);
  //   • spaces around texts trimmed; list items left empty dropped (in both languages, positions kept aligned);
  //   • the conventions of the files filled in for a new record: an event's legacy `date` (its session's
  //     playedOn) and a session's `dateLabel` ("Recorded 25 Feb 2026 · Title").
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function trimDeep(v) {
    if (typeof v === "string") return v.trim();
    if (Array.isArray(v)) return v.map(trimDeep);
    if (isObj(v)) { const o = {}; Object.keys(v).forEach(k => { o[k] = trimDeep(v[k]); }); return o; }
    return v;
  }
  function fillPath(en, es, path) {
    if (!nonEmpty(getIn(en, path)) && nonEmpty(getIn(es, path))) return setIn(en, path, getIn(es, path));
    return en;
  }
  // Nothing written: empty texts, and lists/objects holding only empty texts.
  const blankDeep = v => v == null || (typeof v === "string" ? !v.trim() : Array.isArray(v) ? v.every(blankDeep) : isObj(v) ? Object.values(v).every(blankDeep) : false);
  // A positional list in both languages, item by item: `fin(enItem, esItem) → [en, es]` finishes one item (Spanish
  // filling what English lacks); an item still blank in English is dropped from both, so positions stay aligned.
  // A list written only in Spanish becomes the English list too.
  function finishList(en, es, path, isBlank, fin) {
    const a = getIn(en, path), b0 = getIn(es, path);
    if (!Array.isArray(a)) {
      if (!Array.isArray(b0)) return { en, es };
      const items = b0.map(y => fin(undefined, y)).filter(([x]) => !isBlank(x));
      return items.length ? { en: setIn(en, path, items.map(i => i[0])), es: setIn(es, path, items.map(i => i[1])) } : { en, es: deleteIn(es, path) };
    }
    const b = Array.isArray(b0) && b0.length === a.length ? b0 : null, keepEn = [], keepEs = [];
    a.forEach((x, i) => { const [fx, fy] = fin(x, b ? b[i] : undefined); if (!isBlank(fx)) { keepEn.push(fx); keepEs.push(fy); } });
    let outEs = es;
    if (b) outEs = keepEs.every(blankDeep) ? deleteIn(es, path) : setIn(es || {}, path, keepEs);
    else if (b0 !== undefined) outEs = deleteIn(es, path);
    return { en: setIn(en, path, keepEn), es: outEs };
  }
  const finText = (x, y) => [nonEmpty(x) ? x : nonEmpty(y) ? y : "", typeof y === "string" ? y : ""];
  // An object item (relation, who's-who entry): its translated fields filled from Spanish, empty ones removed.
  const finObject = (fields, canon) => (x, y) => {
    const o = isObj(x) ? { ...x } : {}, ty = isObj(y) ? y : {};
    fields.forEach(f => { if (!nonEmpty(o[f]) && nonEmpty(ty[f])) o[f] = ty[f]; if (o[f] === "") delete o[f]; });
    return [orderKeys(o, canon, isObj(x) ? Object.keys(x) : []), { ...ty }];
  };
  // A session plot: its texts, its notes and its who's-who, each list finished in both languages.
  const finPlot = (x, y) => {
    let o = isObj(x) ? { ...x } : {}, ty = isObj(y) ? { ...y } : {};
    PLOT_TEXTS.strings.forEach(f => { if (!nonEmpty(o[f]) && nonEmpty(ty[f])) o[f] = ty[f]; });
    ({ en: o, es: ty } = finishList(o, ty, ["notes"], x2 => !nonEmpty(x2), finText));
    ({ en: o, es: ty } = finishList(o, ty, ["npcs"], n => !isObj(n) || !nonEmpty(n.name), finObject(PLOT_TEXTS.npcs, SUB_FIELDS.plotNpc)));
    Object.keys(o).forEach(f => { if (o[f] === "" || (Array.isArray(o[f]) && !o[f].length && !(isObj(x) && Array.isArray(x[f])))) delete o[f]; });
    return [orderKeys(o, SUB_FIELDS.plot, isObj(x) ? Object.keys(x) : []), ty];
  };
  // A plot with nothing in it at all (no name, state, quest, notes or people) is an unused form row.
  const blankPlot = p => !isObj(p) || (!nonEmpty(p.name) && !nonEmpty(p.qt) && !p.questId && blankDeep(p.notes) && !arr(p.npcs).some(n => isObj(n) && nonEmpty(n.name)));
  function finishPair(kind, pair, ctx) {
    let en = trimDeep(clone(pair.en)) || {}, es = trimDeep(clone(pair.es)) || {};
    const spec = TEXTS[kind];
    spec.strings.forEach(path => { en = fillPath(en, es, path); });
    spec.lists.forEach(path => { ({ en, es } = finishList(en, es, path, x => !nonEmpty(x), finText)); });
    Object.entries(spec.objects || {}).forEach(([k, fields]) => {
      ({ en, es } = finishList(en, es, [k], r => !isObj(r) || !nonEmpty(r.id), finObject(fields, SUB_FIELDS.relation)));
    });
    (spec.plots || []).forEach(k => { ({ en, es } = finishList(en, es, [k], blankPlot, finPlot)); });
    if (ctx && ctx.isNew && kind === "event" && !en.date && ctx.playedOn) en.date = ctx.playedOn;
    if (ctx && ctx.isNew && kind === "session") {
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str(en.playedOn));
      if (m) en.dateLabel = `Recorded ${+m[3]} ${MONTHS[+m[2] - 1]} ${m[1]}${nonEmpty(en.title) ? ` · ${en.title}` : ""}`;
    }
    return { en: tidyEn(kind, en, ctx && ctx.base && ctx.base.en), es: tidyEs(kind, es) };
  }
  // Where a new record goes in its file: an event after the last event of its session (or of the closest earlier
  // session), anything else at the end — the files stay grouped as they are.
  function insertIndex(kind, list, rec) {
    if (kind !== "event") return list.length;
    const s = Number(rec.session);
    let at = -1, best = -Infinity;
    list.forEach((r, i) => {
      const rs = Number(r && r.session);
      if (rs === s) at = i;
      else if (at < 0 && rs < s && rs >= best) { best = rs; at = -2 - i; }
    });
    if (at >= 0) return at + 1;
    if (at <= -2) return -at - 1;                          // after the closest earlier session's last event
    return list.length;
  }
  // The data as it will be once the draft is incorporated: the published files with every change applied in place
  // — untouched records exactly as published and where they were; new ones at their usual place; deleted ones gone.
  function applyDraft(base, draft) {
    const raw = clone((base && base.raw) || {}), content = clone((base && base.content) || {}) || {};
    const playedOf = no => { const s = isObj(raw.sessions) ? raw.sessions[String(no)] : null; return s && s.playedOn; };
    ["session", "place", "character", "npc", "quest", "event"].forEach(kind => {
      const K = KINDS[kind];
      Object.entries(changesOf(draft, kind)).forEach(([id, ch]) => {
        const done = ch.op === "set" ? finishPair(kind, ch, { isNew: !ch.base, base: ch.base, playedOn: kind === "event" && ch.en ? playedOf(ch.en.session) : null }) : null;
        if (K.keyed) {
          if (!isObj(raw[K.file])) raw[K.file] = {};
          if (done) raw[K.file][id] = done.en; else delete raw[K.file][id];
        } else {
          if (!Array.isArray(raw[K.file])) raw[K.file] = [];
          const list = raw[K.file], i = list.findIndex(r => r && r.id === id);
          if (!done) { if (i >= 0) list.splice(i, 1); }
          else if (i >= 0) list[i] = done.en;
          else list.splice(insertIndex(kind, list, done.en), 0, done.en);
        }
        // Its Spanish entry (characters and NPCs share "people"; their ids never collide).
        const bag = isObj(content[K.content]) ? content[K.content] : null;
        if (done && done.es) (bag || (content[K.content] = {}))[id] = done.es;
        else if (bag && bag[id] !== undefined) delete bag[id];
      });
    });
    return { raw, content };
  }

  // ── Conflicts with newer published data ───────────────────────────────────
  // The published files may change while a draft waits (a session added through Claude Code, a fix on GitHub).
  // Records the draft does not touch simply take the new version. A change conflicts when its record is no longer
  // the published one it was edited from: it is listed with what changed on each side, field by field, and the
  // DM chooses — keep mine, take the published one, or (when no field was changed on both sides) combine both.
  function fieldDiff(baseP, mine, pub) {
    const fields = [];
    ["en", "es"].forEach(lang => {
      const b = (baseP && baseP[lang]) || {}, m = (mine && mine[lang]) || {}, p = (pub && pub[lang]) || {};
      new Set([...Object.keys(b), ...Object.keys(m), ...Object.keys(p)]).forEach(k => {
        const byMe = !same(b[k], m[k]), upstream = !same(b[k], p[k]);
        if (byMe || upstream) fields.push({ lang, field: k, byMe, upstream, clash: byMe && upstream && !same(m[k], p[k]), base: b[k], mine: m[k], published: p[k] });
      });
    });
    return fields;
  }
  // Changes the published data already holds — the DM's export was incorporated (or the same edit was made there):
  // nothing is left to do for them, so they are never conflicts and they can leave the draft. A change counts once
  // its record, as the export writes it, is the published one; a deletion once the record is gone.
  function publishedChanges(base, draft) {
    const out = [];
    let applied = null;
    KIND_LIST.forEach(kind => Object.entries(changesOf(draft, kind)).forEach(([id, ch]) => {
      const pub = publishedOrNull(base, kind, id);
      if (ch.op === "delete") { if (!pub) out.push({ kind, id }); return; }
      if (!pub || pairsEqual(pub, ch.base)) return;                         // still waiting to be published
      if (!applied) applied = applyDraft(base, draft);
      if (pairsEqual(pub, publishedOrNull(applied, kind, id))) out.push({ kind, id });
    }));
    return out;
  }
  function dropPublished(base, draft, now) {
    const done = publishedChanges(base, draft);
    if (!done.length) return draft;
    const changes = { ...draft.changes };
    done.forEach(({ kind, id }) => { changes[kind] = { ...changes[kind] }; delete changes[kind][id]; });
    return bump(draft, changes, now);
  }
  function conflicts(base, draft) {
    const out = [], done = new Set(publishedChanges(base, draft).map(c => `${c.kind}:${c.id}`));
    KIND_LIST.forEach(kind => Object.entries(changesOf(draft, kind)).forEach(([id, ch]) => {
      const pub = publishedOrNull(base, kind, id);
      if (pairsEqual(pub, ch.base) || done.has(`${kind}:${id}`)) return;
      const type = !ch.base ? "taken" : !pub ? "removed" : "changed";
      const fields = type === "changed" && ch.op === "set" ? fieldDiff(ch.base, ch, pub) : [];
      out.push({ kind, id, type, op: ch.op, fields, mergeable: type === "changed" && ch.op === "set" && !fields.some(f => f.clash) });
    }));
    return out;
  }
  // how: "mine" (my version over the new published one), "published" (forget my change), "merge" (the published
  // record with only the fields I changed — offered when no field changed on both sides).
  function resolveConflict(base, draft, kind, id, how, now) {
    const key = String(id), ch = changesOf(draft, kind)[key];
    if (!ch) return draft;
    const pub = publishedOrNull(base, kind, key);
    if (how === "published") return revertRecord(draft, kind, key, now);
    let en = ch.en, es = ch.es;
    if (how === "merge" && pub && ch.op === "set") {
      const mergeLang = lang => {
        const b = (ch.base && ch.base[lang]) || {}, m = ch[lang] || {}, p = pub[lang] || {};
        const out = clone(p) || {};
        new Set([...Object.keys(b), ...Object.keys(m)]).forEach(k => { if (!same(b[k], m[k])) { if (m[k] === undefined) delete out[k]; else out[k] = clone(m[k]); } });
        return out;
      };
      en = orderKeys(mergeLang("en"), FIELDS[kind], Object.keys(pub.en || {}));
      es = tidyEs(kind, mergeLang("es"));
    }
    const next = { ...changesOf(draft, kind) };
    if (ch.op === "delete" && !pub) delete next[key];                       // deleted on both sides
    else next[key] = { ...ch, en, es, base: pub ? clone(pub) : null, at: now || nowIso() };
    return bump(draft, { ...draft.changes, [kind]: next }, now);
  }
  // Files whose published version is not the one the draft started from (informational: conflicts() decides).
  function changedFiles(base, draft) {
    const now = fingerprint(base), was = (draft && draft.base && draft.base.files) || {};
    return Object.keys(now).filter(f => was[f] && was[f] !== now[f]);
  }
  // After the DM has seen it: the draft's base becomes the current published data (conflicts are separate).
  const rebase = (base, draft, now) => ({ ...draft, base: { files: fingerprint(base), at: now || nowIso() } });

  // ── Summary and references ────────────────────────────────────────────────
  function summarize(draft) {
    const out = { total: 0, added: [], modified: [], deleted: [], byKind: {} };
    KIND_LIST.forEach(kind => {
      const c = out.byKind[kind] = { added: 0, modified: 0, deleted: 0 };
      Object.entries(changesOf(draft, kind)).forEach(([id, ch]) => {
        const item = { kind, id, at: ch.at }, group = ch.op === "delete" ? "deleted" : ch.base ? "modified" : "added";
        out[group].push(item); c[group]++; out.total++;
      });
    });
    return out;
  }
  // What still points at a record in the (applied) data — before it can be deleted.
  function referencesTo(raw, kind, id) {
    const key = String(id), out = [], events = arr(raw.events), sessions = isObj(raw.sessions) ? raw.sessions : {};
    const people = [...arr(raw.characters).map(p => ["character", p]), ...arr(raw.npcs).map(p => ["npc", p])];
    if (kind === "event") {
      events.forEach(e => { if (e && e.id !== key && arr(e.relatedEventIds).includes(key)) out.push({ kind: "event", id: e.id }); });
      Object.entries(sessions).forEach(([no, s]) => { if (s && s.recap && arr(s.recap.highlights).includes(key)) out.push({ kind: "session", id: no }); });
    }
    if (kind === "session") events.forEach(e => { if (e && String(e.session) === key) out.push({ kind: "event", id: e.id }); });
    if (kind === "quest") {
      events.forEach(e => { if (e && arr(e.questIds).includes(key)) out.push({ kind: "event", id: e.id }); });
      Object.entries(sessions).forEach(([no, s]) => { if (s && [...arr(s.activePlots), ...arr(s.completedPlots)].some(p => p && p.questId === key)) out.push({ kind: "session", id: no }); });
    }
    if (kind === "place") {
      events.forEach(e => { if (e && e.locationId === key) out.push({ kind: "event", id: e.id }); });
      arr(raw.locations).forEach(p => { if (p && p.parentId === key) out.push({ kind: "place", id: p.id }); });
      Object.entries(isObj(raw.routes) ? raw.routes : {}).forEach(([pc, pts]) => { if (arr(pts).some(p => p && p.locationId === key)) out.push({ kind: "route", id: pc }); });
    }
    if (kind === "character" || kind === "npc") {
      events.forEach(e => { if (e && (arr(e.characterIds).includes(key) || arr(e.npcIds).includes(key))) out.push({ kind: "event", id: e.id }); });
      arr(raw.quests).forEach(q => { if (q && (q.giverId === key || arr(q.characterIds).includes(key))) out.push({ kind: "quest", id: q.id }); });
      people.forEach(([k, p]) => { if (p && p.id !== key && (arr(p.factionIds).includes(key) || arr(p.relations).some(r => r && r.id === key))) out.push({ kind: k, id: p.id }); });
      if (isObj(raw.routes) && raw.routes[key]) out.push({ kind: "route", id: key });
    }
    return out;
  }

  // ── Validation ────────────────────────────────────────────────────────────
  // What would break or read wrong once the draft is incorporated. Form checks first (localized by code, tied to
  // a record and field), then the model's own checks on the applied data — the validator's rules — keeping only
  // the problems the draft introduced (never blaming the DM for what was already published). Errors block the
  // export; warnings do not. `opts.assets`: image paths a portrait may use.
  const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
  const validDate = s => { const m = DATE_RE.exec(str(s)); if (!m) return false; const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])); return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3]; };
  const hasText = (en, es, path) => nonEmpty(getIn(en, path)) || nonEmpty(getIn(es, path));
  function validate(base, draft, opts) {
    const o = opts || {}, applied = applyDraft(base, draft), raw = applied.raw, issues = [];
    const add = (level, kind, id, field, code, params) => issues.push({ level, kind, id: String(id), field: field || null, code, params: params || {} });
    const E = (...a) => add("error", ...a), W = (...a) => add("warn", ...a);
    const ids = list => new Set(arr(list).map(r => r && r.id).filter(Boolean));
    const evIds = ids(raw.events), qIds = ids(raw.quests), plIds = ids(raw.locations), pcIds = ids(raw.characters), npcIds = ids(raw.npcs);
    const sessions = isObj(raw.sessions) ? raw.sessions : {};
    KIND_LIST.forEach(kind => Object.entries(changesOf(draft, kind)).forEach(([id, ch]) => {
      if (ch.op === "delete") {
        const refs = referencesTo(raw, kind, id);
        if (refs.length) E(kind, id, null, "referenced", { refs });
        return;
      }
      const en = ch.en || {}, es = ch.es || {};
      const need = (path, field) => { if (!hasText(en, es, path)) E(kind, id, field || path.join("."), "required"); };
      const noEnglish = path => { if (!nonEmpty(getIn(en, path)) && nonEmpty(getIn(es, path))) W(kind, id, path.join("."), "noEnglish"); };
      (TEXTS[kind].strings || []).forEach(noEnglish);
      if (kind !== "session" && (!ID_RE.test(id) || (en.id != null && en.id !== id))) E(kind, id, "id", "idFormat");
      if (!ch.base && kind !== "session") {
        const clash = publishedOrNull(base, kind, id) || (["character", "npc", "place"].includes(kind) && ["character", "npc", "place"].some(k => k !== kind && (changesOf(draft, k)[id] || publishedOrNull(base, k, id))));
        if (clash) E(kind, id, "id", "idTaken", { id });
      }
      if (kind === "session") {
        if (!/^[1-9]\d*$/.test(id)) E(kind, id, "no", "sessionNumber");
        need(["title"]);
        if (!nonEmpty(en.playedOn)) E(kind, id, "playedOn", "required");
        else if (!validDate(en.playedOn)) E(kind, id, "playedOn", "date");
        const hl = arr(en.recap && en.recap.highlights);
        hl.forEach(eid => { const ev = arr(raw.events).find(e => e && e.id === eid); if (!ev) E(kind, id, "recap.highlights", "unknownRef", { ref: eid, what: "event" }); else if (String(ev.session) !== id) E(kind, id, "recap.highlights", "highlightOther", { ref: eid }); });
        if (hl.length && (hl.length < 3 || hl.length > 5)) W(kind, id, "recap.highlights", "highlightsCount", { count: hl.length });
        ["activePlots", "completedPlots"].forEach(pk => arr(en[pk]).forEach((p, i) => {
          if (!isObj(p)) return;
          const tp = Array.isArray(es[pk]) && es[pk].length === arr(en[pk]).length && isObj(es[pk][i]) ? es[pk][i] : {};
          const merged = { ...tp, ...Object.fromEntries(Object.entries(p).filter(([, v]) => !blankDeep(v))) };
          if (!nonEmpty(p.name) && !nonEmpty(tp.name) && !blankPlot(merged)) E(kind, id, `${pk}.${i}.name`, "required");
          if (p.questId && !qIds.has(p.questId)) E(kind, id, `${pk}.${i}.questId`, "unknownRef", { ref: p.questId, what: "quest" });
          else if (p.questId) {
            const q = arr(raw.quests).find(y => y && y.id === p.questId), nos = arr(q && q.sessions).map(Number);
            if (nos.length && !nos.includes(Number(id))) W(kind, id, `${pk}.${i}.questId`, "plotQuestSession", { ref: p.questId, n: Number(id) });
          }
        }));
      }
      if (kind === "event") {
        need(["title"]); need(["summary"]);
        const no = en.session;
        if (no == null || no === "") E(kind, id, "session", "required");
        else if (!Number.isInteger(Number(no)) || Number(no) < 1) E(kind, id, "session", "sessionNumber");
        else if (!sessions[String(no)]) E(kind, id, "session", "sessionMissing", { n: Number(no) });
        if (en.type != null && !Model.EVENT_TYPES[en.type]) E(kind, id, "type", "badValue", { value: en.type });
        if (en.campaignDay != null && !(Number.isInteger(en.campaignDay) && en.campaignDay >= 0)) E(kind, id, "campaignDay", "integer");
        if (en.order != null && !isNum(en.order)) E(kind, id, "order", "number");
        const hx = en.xp != null, hy = en.yp != null;
        if (hx !== hy) E(kind, id, "xp", "coordsPair");
        else if (hx && !validPoint(en)) E(kind, id, "xp", "coordsRange");
        if (en.locationId && !plIds.has(en.locationId)) E(kind, id, "locationId", "unknownRef", { ref: en.locationId, what: "place" });
        arr(en.characterIds).forEach(x => { if (!pcIds.has(x)) E(kind, id, "characterIds", npcIds.has(x) ? "notPc" : "unknownRef", { ref: x, what: "character" }); });
        arr(en.npcIds).forEach(x => { if (!npcIds.has(x) && !pcIds.has(x)) E(kind, id, "npcIds", "unknownRef", { ref: x, what: "npc" }); });
        arr(en.questIds).forEach(x => {
          if (!qIds.has(x)) return E(kind, id, "questIds", "unknownRef", { ref: x, what: "quest" });
          const q = arr(raw.quests).find(y => y && y.id === x), nos = arr(q && q.sessions).map(Number);
          if (nos.length && no != null && !nos.includes(Number(no))) W(kind, id, "questIds", "questSession", { ref: x, n: Number(no) });
        });
        arr(en.relatedEventIds).forEach(x => { if (x === id) E(kind, id, "relatedEventIds", "selfRef"); else if (!evIds.has(x)) E(kind, id, "relatedEventIds", "unknownRef", { ref: x, what: "event" }); });
        // An event at a place on another plane may still carry a recorded pin (the page captions it as such).
      }
      if (kind === "quest") {
        need(["title"]);
        if (!Model.QUEST_STATUS[en.status]) E(kind, id, "status", "badValue", { value: str(en.status) });
        if (en.giverId && !pcIds.has(en.giverId) && !npcIds.has(en.giverId)) E(kind, id, "giverId", "unknownRef", { ref: en.giverId, what: "person" });
        arr(en.sessions).forEach(n => { if (!Number.isInteger(n) || n < 1) E(kind, id, "sessions", "sessionNumber"); else if (!sessions[String(n)]) W(kind, id, "sessions", "sessionNoLog", { n }); });
        arr(en.characterIds).forEach(x => { if (!pcIds.has(x) && !npcIds.has(x)) E(kind, id, "characterIds", "unknownRef", { ref: x, what: "character" }); });
      }
      if (kind === "place") {
        need(["name"]);
        if (en.kind != null && !Model.PLACE_KINDS[en.kind]) E(kind, id, "kind", "badValue", { value: en.kind });
        if (!en.kind) W(kind, id, "kind", "noKind");
        if (en.parentId) {
          if (!plIds.has(en.parentId)) E(kind, id, "parentId", "unknownRef", { ref: en.parentId, what: "place" });
          else if (ancestorsIn(raw, en.parentId).concat(en.parentId).includes(id)) E(kind, id, "parentId", "cycle");
        }
        const hx = en.xp != null, hy = en.yp != null;
        if (hx !== hy) E(kind, id, "xp", "coordsPair");
        else if (hx && !validPoint(en)) E(kind, id, "xp", "coordsRange");
        else if (hx && isPlanarIn(raw, id)) E(kind, id, "xp", "planarCoords");
        if (en.mapPrecision != null && !Model.MAP_PRECISION.includes(en.mapPrecision)) E(kind, id, "mapPrecision", "badValue", { value: en.mapPrecision });
      }
      if (kind === "character" || kind === "npc") {
        need(["name"]);
        if (kind === "npc" && en.category != null && !["person", "deity", "creature", "faction"].includes(en.category)) E(kind, id, "category", "badValue", { value: en.category });
        if (kind === "character" && en.color != null && !/^#[0-9a-f]{6}$/i.test(en.color)) E(kind, id, "color", "color");
        if (en.sealImg != null && (/^(\/|[a-z]+:)/i.test(en.sealImg) || (o.assets && !o.assets.includes(en.sealImg)))) E(kind, id, "sealImg", "asset", { value: en.sealImg });
        arr(en.factionIds).forEach(x => { const f = arr(raw.npcs).find(p => p && p.id === x); if (!f) E(kind, id, "factionIds", "unknownRef", { ref: x, what: "faction" }); else if (f.category !== "faction") W(kind, id, "factionIds", "notFaction", { ref: x }); });
        arr(en.relations).forEach((r, i) => { if (!isObj(r) || !r.id) return; if (r.id === id) E(kind, id, `relations.${i}`, "selfRef"); else if (!pcIds.has(r.id) && !npcIds.has(r.id)) E(kind, id, `relations.${i}`, "unknownRef", { ref: r.id, what: "person" }); });
      }
    }));
    // The model's own checks: what the draft introduced, unless a form check already flagged that record. The
    // published data's own issues are computed once per published data.
    const before = publishedIssues(base);
    const after = Model.validateData(raw, { translations: { [LOCALE]: applied.content } });
    const seen = new Set(before.issues.map(i => `${i.level}|${i.msg}`));
    const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const flagged = issues.map(i => new RegExp(i.kind === "session" ? `\\b[Ss]ession ${esc(i.id)}(?!\\d)` : `"${esc(i.id)}"`));
    after.issues.filter(i => !seen.has(`${i.level}|${i.msg}`) && !flagged.some(re => re.test(i.msg)))
      .forEach(i => issues.push({ level: i.level === "error" ? "error" : "warn", kind: null, id: null, field: null, code: "model", params: { msg: i.msg } }));
    const errors = issues.filter(i => i.level === "error"), warnings = issues.filter(i => i.level !== "error");
    return { ok: !errors.length, errors, warnings, issues, model: after.model, applied };
  }
  const BEFORE = typeof WeakMap === "function" ? new WeakMap() : null;
  function publishedIssues(base) {
    const raw = (base && base.raw) || {}, content = (base && base.content) || null;
    const hit = BEFORE && BEFORE.get(raw);
    if (hit && hit.content === content) return hit.val;
    const val = Model.validateData(raw, { translations: { [LOCALE]: content } });
    if (BEFORE) BEFORE.set(raw, { content, val });
    return val;
  }
  function ancestorsIn(raw, id) {
    const out = [], byId = new Map(arr(raw.locations).filter(p => p && p.id).map(p => [p.id, p]));
    let p = byId.get(id);
    while (p && p.parentId && !out.includes(p.parentId) && out.length < byId.size) { out.push(p.parentId); p = byId.get(p.parentId); }
    return out;
  }
  function isPlanarIn(raw, id) {
    const byId = new Map(arr(raw.locations).filter(p => p && p.id).map(p => [p.id, p]));
    return [id, ...ancestorsIn(raw, id)].some(x => byId.get(x) && byId.get(x).kind === "plane");
  }

  // ── Export: the repository's own JSON layouts ─────────────────────────────
  // Each data file keeps its layout, so an export changes only the lines of the records that changed:
  //   pretty   — JSON.stringify(…, null, 2): events, sessions, characters, routes, the translations
  //   compact  — records expanded, lists of plain values and small flat objects on one line: quests, npcs
  //   rows     — one record per line: locations
  const FILE_STYLE = { characters: "pretty", routes: "pretty", events: "pretty", sessions: "pretty", quests: "compact", npcs: "compact", locations: "rows", content: "pretty" };
  const isPrim = v => v === null || typeof v !== "object";
  const inline = v => {
    if (isPrim(v)) return JSON.stringify(v);
    if (Array.isArray(v)) return "[" + v.map(inline).join(", ") + "]";
    const ks = Object.keys(v);
    return ks.length ? "{ " + ks.map(k => JSON.stringify(k) + ": " + inline(v[k])).join(", ") + " }" : "{}";
  };
  const flat = v => isObj(v) && Object.values(v).every(isPrim);
  function compact(v, depth) {
    const pad = "  ".repeat(depth), pad1 = "  ".repeat(depth + 1);
    if (isPrim(v)) return JSON.stringify(v);
    if (Array.isArray(v)) {
      if (!v.length) return "[]";
      if (v.every(isPrim)) return inline(v);
      return "[\n" + v.map(x => pad1 + (depth >= 1 && flat(x) ? inline(x) : compact(x, depth + 1))).join(",\n") + "\n" + pad + "]";
    }
    const ks = Object.keys(v);
    if (!ks.length) return "{}";
    return "{\n" + ks.map(k => pad1 + JSON.stringify(k) + ": " + compact(v[k], depth + 1)).join(",\n") + "\n" + pad + "}";
  }
  function serialize(file, value) {
    const style = FILE_STYLE[file] || "pretty";
    if (style === "compact") return compact(value, 0) + "\n";
    if (style === "rows") return Array.isArray(value) && value.length ? "[\n" + value.map(x => "  " + inline(x)).join(",\n") + "\n]\n" : JSON.stringify(value || []) + "\n";
    return JSON.stringify(value, null, 2) + "\n";
  }
  // The files the draft changes, complete and ready to replace the repository's: [{ path, file, text }].
  function exportFiles(base, draft) {
    const applied = applyDraft(base, draft), out = [];
    EDITABLE_FILES.forEach(f => {
      const before = serialize(f, ((base && base.raw) || {})[f] || (f === "sessions" ? {} : [])), after = serialize(f, applied.raw[f] || (f === "sessions" ? {} : []));
      if (before !== after) out.push({ path: `data/${f}.json`, file: f, text: after });
    });
    const cb = serialize("content", (base && base.content) || {}), ca = serialize("content", applied.content || {});
    if (cb !== ca) out.push({ path: CONTENT_PATH, file: "content", text: ca });
    return out;
  }

  // ── ZIP (stored, no compression — the files are small, and no library is needed) ──
  let CRC_TABLE = null;
  function crc32(bytes) {
    if (!CRC_TABLE) { CRC_TABLE = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; CRC_TABLE[n] = c >>> 0; } }
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }
  const utf8 = s => new TextEncoder().encode(s);
  // zip([{ name, data: string | Uint8Array }], date) → Uint8Array (UTF-8 names, DOS timestamps).
  function zip(entries, date) {
    const d = date instanceof Date ? date : new Date();
    const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    const day = ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    const parts = [], central = [];
    let offset = 0;
    entries.forEach(e => {
      const name = utf8(e.name), data = typeof e.data === "string" ? utf8(e.data) : e.data, crc = crc32(data);
      const local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true); local.setUint16(6, 0x0800, true); local.setUint16(8, 0, true);
      local.setUint16(10, time, true); local.setUint16(12, day, true); local.setUint32(14, crc, true);
      local.setUint32(18, data.length, true); local.setUint32(22, data.length, true); local.setUint16(26, name.length, true); local.setUint16(28, 0, true);
      parts.push(new Uint8Array(local.buffer), name, data);
      const cd = new DataView(new ArrayBuffer(46));
      cd.setUint32(0, 0x02014b50, true); cd.setUint16(4, 20, true); cd.setUint16(6, 20, true); cd.setUint16(8, 0x0800, true); cd.setUint16(10, 0, true);
      cd.setUint16(12, time, true); cd.setUint16(14, day, true); cd.setUint32(16, crc, true); cd.setUint32(20, data.length, true); cd.setUint32(24, data.length, true);
      cd.setUint16(28, name.length, true); cd.setUint16(30, 0, true); cd.setUint16(32, 0, true); cd.setUint16(34, 0, true); cd.setUint16(36, 0, true);
      cd.setUint32(38, 0, true); cd.setUint32(42, offset, true);
      central.push(new Uint8Array(cd.buffer), name);
      offset += 30 + name.length + data.length;
    });
    const cdSize = central.reduce((n, p) => n + p.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, entries.length, true); end.setUint16(10, entries.length, true);
    end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
    const all = [...parts, ...central, new Uint8Array(end.buffer)], out = new Uint8Array(all.reduce((n, p) => n + p.length, 0));
    let at = 0;
    all.forEach(p => { out.set(p, at); at += p.length; });
    return out;
  }
  // unzip(bytes, { inflateRaw }) → Promise<[{ name, data }]>: stored entries, and deflated ones when an inflater is
  // given (the browser's DecompressionStream). Every entry's CRC is checked.
  async function unzip(bytes, opts) {
    const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), v = new DataView(b.buffer, b.byteOffset, b.byteLength);
    let eocd = -1;
    for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error("not a zip file");
    const count = v.getUint16(eocd + 10, true), out = [];
    let p = v.getUint32(eocd + 16, true);
    const dec = new TextDecoder();
    for (let n = 0; n < count; n++) {
      if (v.getUint32(p, true) !== 0x02014b50) throw new Error("broken zip directory");
      const method = v.getUint16(p + 10, true), crc = v.getUint32(p + 16, true), size = v.getUint32(p + 20, true);
      const nameLen = v.getUint16(p + 28, true), extraLen = v.getUint16(p + 30, true), commentLen = v.getUint16(p + 32, true), local = v.getUint32(p + 42, true);
      const name = dec.decode(b.subarray(p + 46, p + 46 + nameLen));
      const start = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
      let data = b.subarray(start, start + size);
      if (method === 8) {
        if (!opts || typeof opts.inflateRaw !== "function") throw new Error("compressed zip entries are not supported here");
        data = await opts.inflateRaw(data, v.getUint32(p + 24, true));
      } else if (method !== 0) throw new Error(`unsupported zip method ${method}`);
      if (crc32(data) !== crc) throw new Error(`corrupt zip entry ${name}`);
      if (!name.endsWith("/")) out.push({ name, data });
      p += 46 + nameLen + extraLen + commentLen;
    }
    return out;
  }

  // ── The draft as a file (backup, hand-over, re-import) ────────────────────
  // Read as data only: parsed, sanitized (plain JSON values; no __proto__/constructor keys; bounded depth and size),
  // and checked entry by entry — a malformed entry is skipped and reported, never trusted.
  const MAX_FILE = 8 * 1024 * 1024;
  function sanitize(v, depth) {
    if (depth > 24) throw new Error("too deep");
    if (v === null || typeof v === "string" || typeof v === "boolean") return v;
    if (typeof v === "number") return isFinite(v) ? v : null;
    if (Array.isArray(v)) return v.map(x => sanitize(x, depth + 1));
    if (isObj(v)) {
      const out = {};
      Object.keys(v).forEach(k => { if (k !== "__proto__" && k !== "constructor" && k !== "prototype") out[k] = sanitize(v[k], depth + 1); });
      return out;
    }
    return null;
  }
  const draftToText = draft => JSON.stringify({ ...draft, exportedAt: nowIso() }, null, 2) + "\n";
  function parseDraft(text) {
    if (typeof text !== "string") return { error: "notJson" };
    if (text.length > MAX_FILE) return { error: "tooLarge" };
    let v;
    try { v = sanitize(JSON.parse(text.replace(/^﻿/, "")), 0); } catch (e) { return { error: "notJson", detail: e.message }; }
    if (!isObj(v) || v.format !== DRAFT_FORMAT) return { error: "notDraft" };
    if (!Number.isInteger(v.version) || v.version < 1 || v.version > DRAFT_VERSION) return { error: "version", version: v.version };
    const draft = { format: DRAFT_FORMAT, version: DRAFT_VERSION, id: typeof v.id === "string" ? v.id.slice(0, 40) : randomId(),
      createdAt: str(v.createdAt) || nowIso(), updatedAt: str(v.updatedAt) || nowIso(), rev: Number.isInteger(v.rev) && v.rev >= 0 ? v.rev : 0,
      base: { files: {}, at: str(v.base && v.base.at) }, changes: {} };
    Object.entries(isObj(v.base) && isObj(v.base.files) ? v.base.files : {}).forEach(([f, h]) => { if (typeof h === "string" && /^[a-z0-9]{1,16}$/.test(h)) draft.base.files[f] = h; });
    const skipped = [];
    const pairOk = p => p == null || (isObj(p) && isObj(p.en) && (p.es == null || isObj(p.es)));
    const problem = (kind, id, c) => {
      if (kind === "session" ? !/^[1-9]\d{0,5}$/.test(id) : !ID_RE.test(id)) return "id";
      if (!isObj(c)) return "entry";
      if (c.op !== "set" && c.op !== "delete") return "op";
      if (c.op === "set" && (!isObj(c.en) || (kind !== "session" && c.en.id !== id))) return "record";
      if (c.es != null && !isObj(c.es)) return "translation";
      if (!pairOk(c.base) || (c.op === "delete" && !isObj(c.base))) return "base";
      return null;
    };
    KIND_LIST.forEach(kind => {
      draft.changes[kind] = {};
      const list = isObj(v.changes) && isObj(v.changes[kind]) ? v.changes[kind] : {};
      Object.entries(list).forEach(([id, c]) => {
        const reason = problem(kind, id, c);
        if (reason) { skipped.push({ kind, id, reason }); return; }
        draft.changes[kind][id] = { op: c.op, en: c.op === "set" ? c.en : null, es: c.op === "set" && isObj(c.es) ? c.es : null,
          base: isObj(c.base) && isObj(c.base.en) ? { en: c.base.en, es: isObj(c.base.es) ? c.base.es : null } : null, at: str(c.at) || nowIso() };
      });
    });
    return { draft, skipped };
  }
  // Two drafts in one: the imported changes go over the current ones; `replaced` lists the records both touched.
  function mergeDrafts(current, incoming, now) {
    const changes = {}, replaced = [];
    KIND_LIST.forEach(kind => {
      changes[kind] = { ...changesOf(current, kind) };
      Object.entries(changesOf(incoming, kind)).forEach(([id, c]) => { if (changes[kind][id]) replaced.push({ kind, id }); changes[kind][id] = clone(c); });
    });
    return { draft: bump(current, changes, now), replaced };
  }
  // The records of an imported data file (events.json, quests.json, sessions.json, … or es-AR.json) that differ from
  // the published ones, as draft changes. A record missing from the file is never read as a deletion.
  function changesFromFile(base, draft, fileName, value) {
    const name = String(fileName || "").split(/[\\/]/).pop().replace(/\.json$/i, "");
    const out = [];
    const kindOfFile = Object.keys(KINDS).find(k => KINDS[k].file === name);
    if (kindOfFile) {
      const K = KINDS[kindOfFile];
      const entries = K.keyed ? Object.entries(isObj(value) ? value : {}) : arr(value).filter(r => isObj(r) && typeof r.id === "string").map(r => [r.id, r]);
      entries.forEach(([id, rec]) => {
        if (!isObj(rec) || (K.keyed ? !/^[1-9]\d*$/.test(id) : !ID_RE.test(id))) return;
        const cur = currentPair(draft, base, kindOfFile, id);
        const pair = { en: rec, es: cur ? cur.es : null };
        if (!cur || !same(cur.en, rec)) out.push({ kind: kindOfFile, id, pair, isNew: !cur });
      });
      return { ok: true, file: name, changes: out };
    }
    if (name === LOCALE && isObj(value)) {
      KIND_LIST.forEach(kind => {
        const bag = isObj(value[KINDS[kind].content]) ? value[KINDS[kind].content] : {};
        Object.entries(bag).forEach(([id, tr]) => {
          const cur = currentPair(draft, base, kind, id);
          if (!cur || !isObj(tr) || same(cur.es, tr)) return;
          out.push({ kind, id, pair: { en: cur.en, es: tr }, isNew: false });
        });
      });
      return { ok: true, file: name, changes: out };
    }
    return { ok: false, file: name, changes: out };
  }

  // ── Storage ───────────────────────────────────────────────────────────────
  // The working draft lives in this browser only: IndexedDB (its own database, apart from the public page's
  // localStorage), or memory when IndexedDB is unavailable (some private windows, blocked site data) — the Taller
  // then says so and the backup download is the way to keep the work. Saving checks what it last saw — `expect` is
  // { id, rev } of the draft it loaded or saved, "none" when it found none, null to skip the check — so a second tab
  // never overwrites the first one's work silently. Backups: the draft as it was before anything destructive
  // (discard all, replace by an import, restore, take the published version), the newest 30 kept.
  const DB_NAME = "chronicle-taller", MAX_BACKUPS = 30;
  const clashes = (cur, expect) => expect != null && (expect === "none" ? !!cur : !cur || cur.id !== expect.id || cur.rev !== expect.rev);
  function memoryStore() {
    let current = null, backups = [], seq = 0;
    return {
      kind: "memory", persistent: false,
      load: () => Promise.resolve(clone(current)),
      save: (draft, expect) => {
        if (clashes(current, expect)) return Promise.resolve({ ok: false, conflict: true, stored: current ? { id: current.id, rev: current.rev } : null });
        current = clone(draft); return Promise.resolve({ ok: true });
      },
      clear: () => { current = null; return Promise.resolve(); },
      backup: (draft, reason) => { backups.push({ id: ++seq, at: nowIso(), reason, rev: draft.rev, count: summarize(draft).total, draft: clone(draft) }); backups = backups.slice(-MAX_BACKUPS); return Promise.resolve(seq); },
      backups: () => Promise.resolve(backups.slice().reverse().map(b => ({ id: b.id, at: b.at, reason: b.reason, rev: b.rev, count: b.count }))),
      getBackup: id => Promise.resolve(clone((backups.find(b => b.id === id) || {}).draft || null)),
    };
  }
  function idbStore(idb, name) {
    let dbp = null;
    const open = () => dbp || (dbp = new Promise((resolve, reject) => {
      let req;
      try { req = idb.open(name, 1); } catch (e) { reject(e); return; }
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("draft")) db.createObjectStore("draft");
        if (!db.objectStoreNames.contains("backups")) db.createObjectStore("backups", { keyPath: "id", autoIncrement: true });
      };
      req.onsuccess = () => { const db = req.result; db.onversionchange = () => db.close(); resolve(db); };
      req.onerror = () => reject(req.error || new Error("indexedDB open failed"));
      req.onblocked = () => reject(new Error("indexedDB blocked"));
    }));
    // One transaction; `fn(tx, done)` sets the result from inside it (after its requests succeed).
    const run = (stores, mode, fn) => open().then(db => new Promise((resolve, reject) => {
      let result, tx;
      try { tx = db.transaction(stores, mode); } catch (e) { reject(e); return; }
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error || new Error("indexedDB error"));
      tx.onabort = () => reject(tx.error || new Error("indexedDB transaction aborted"));
      fn(tx, v => { result = v; });
    }));
    return {
      kind: "indexeddb", persistent: true,
      load: () => run(["draft"], "readonly", (tx, done) => { const r = tx.objectStore("draft").get("current"); r.onsuccess = () => done(r.result || null); }),
      save: (draft, expect) => run(["draft"], "readwrite", (tx, done) => {
        const s = tx.objectStore("draft"), r = s.get("current");
        r.onsuccess = () => {
          const cur = r.result;
          if (clashes(cur, expect)) { done({ ok: false, conflict: true, stored: cur ? { id: cur.id, rev: cur.rev } : null }); return; }
          s.put(draft, "current"); done({ ok: true });
        };
      }),
      clear: () => run(["draft"], "readwrite", tx => { tx.objectStore("draft").delete("current"); }),
      backup: (draft, reason) => run(["backups"], "readwrite", (tx, done) => {
        const s = tx.objectStore("backups"), add = s.add({ at: nowIso(), reason, rev: draft.rev, count: summarize(draft).total, draft });
        add.onsuccess = () => {
          done(add.result);
          const keys = s.getAllKeys();
          keys.onsuccess = () => { const all = keys.result || []; all.slice(0, Math.max(0, all.length - MAX_BACKUPS)).forEach(k => s.delete(k)); };
        };
      }),
      backups: () => run(["backups"], "readonly", (tx, done) => {
        const r = tx.objectStore("backups").getAll();
        r.onsuccess = () => done((r.result || []).reverse().map(b => ({ id: b.id, at: b.at, reason: b.reason, rev: b.rev, count: b.count })));
      }),
      getBackup: id => run(["backups"], "readonly", (tx, done) => { const r = tx.objectStore("backups").get(id); r.onsuccess = () => done(r.result ? r.result.draft : null); }),
    };
  }
  // createStore({ indexedDB }) — the IndexedDB store, falling back to memory when it cannot be opened.
  async function createStore(opts) {
    const idb = opts && opts.indexedDB;
    if (!idb) return memoryStore();
    const s = idbStore(idb, (opts && opts.name) || DB_NAME);
    try { await s.load(); return s; } catch (e) { const m = memoryStore(); m.error = String(e && e.message || e); return m; }
  }

  return {
    // coordinates
    MAP_AR, DECIMALS, roundPct, clampPct, point, validPoint, clientToPercent, percentToClient, viewToPercent, pixelStep, nudge, coordsText, parseCoords,
    // suggestions
    suggestPosition,
    // records, pairs, drafts
    LOCALE, CONTENT_PATH, KINDS, KIND_LIST, EDITABLE_FILES, FIELDS, ES_FIELDS, SUB_FIELDS, TEXTS, ID_RE, DRAFT_FORMAT, DRAFT_VERSION,
    canonical, same, hash, hashOf, getIn, setIn, deleteIn, orderKeys, tidyEn, tidyEs,
    textAt, esList, withText, withList, withField,
    fingerprint, emptyDraft, publishedPair, currentPair, statusOf, putRecord, deleteRecord, revertRecord, renameNew, renameSession,
    idsInUse, slugify, uniqueId, newRecordId, nextEventId, sessionNumbers, nextSessionNo,
    applyDraft, finishPair, publishedChanges, dropPublished, conflicts, resolveConflict, changedFiles, rebase, summarize, referencesTo, validDate,
    // validation, export, files
    validate, serialize, exportFiles, crc32, zip, unzip, sanitize, draftToText, parseDraft, mergeDrafts, changesFromFile,
    // storage
    createStore, memoryStore,
  };
});
