// ── Chronicle library: favourites + recently viewed ─────────────────────────
// What a reader keeps at hand, stored in this browser only (localStorage) — no account, no
// server, no sync. Entries are references { kind, id } to the campaign data, never copies of it,
// so they always show the current text and language; a reference whose entry no longer exists
// is dropped (prune). Everything fails soft: unreadable or corrupt storage starts empty, and a
// browser that refuses storage (private mode, blocked site data) keeps the lists in memory for
// the visit (`persistent` is then false). No DOM — it runs in the browser
// (window.ChronicleLibrary) and in Node (tests/).
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.ChronicleLibrary = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const KINDS = ["event", "session", "quest", "character", "place"];
  const FAV_KEY = "chronicle-favorites";
  const RECENT_KEY = "chronicle-recent";
  const MAX_FAVORITES = 200;
  const MAX_RECENT = 20;          // kept
  const SHOW_RECENT = 5;          // shown

  const refKey = r => `${r.kind}:${r.id}`;
  function cleanRef(x) {
    if (!x || typeof x !== "object") return null;
    const kind = String(x.kind || ""), id = x.id == null ? "" : String(x.id);
    if (!KINDS.includes(kind) || !id || id.length > 120) return null;
    return { kind, id, at: typeof x.at === "number" && isFinite(x.at) ? x.at : 0 };
  }
  // Stored as { v: 1, items: [...] }; a bare array (or garbage) is read as well as possible.
  function readList(storage, key) {
    try {
      const v = JSON.parse(storage.getItem(key) || "null");
      const items = Array.isArray(v) ? v : (v && Array.isArray(v.items) ? v.items : []);
      const seen = new Set();
      return items.map(cleanRef).filter(r => r && !seen.has(refKey(r)) && seen.add(refKey(r)));
    } catch (e) { return []; }
  }

  function createLibrary(storage, opts) {
    const o = opts || {};
    const now = typeof o.now === "function" ? o.now : () => Date.now();
    let persistent = false;
    try {
      if (storage) { storage.setItem("chronicle-probe", "1"); storage.removeItem("chronicle-probe"); persistent = true; }
    } catch (e) { persistent = false; }
    let favorites = persistent ? readList(storage, FAV_KEY) : [];
    let recent = persistent ? readList(storage, RECENT_KEY) : [];
    const write = (key, list) => {
      if (!persistent) return;
      try { storage.setItem(key, JSON.stringify({ v: 1, items: list })); } catch (e) { persistent = false; }
    };
    const has = (list, ref) => list.some(r => r.kind === ref.kind && r.id === String(ref.id));

    const lib = {
      get persistent() { return persistent; },
      favorites: () => favorites.slice(),
      recent: n => recent.slice(0, n == null ? SHOW_RECENT : n),
      isFavorite: ref => !!ref && has(favorites, ref),
      addFavorite(ref) {
        const r = cleanRef({ ...ref, at: now() });
        if (!r || has(favorites, r)) return false;
        favorites = [r, ...favorites].slice(0, MAX_FAVORITES);           // newest first
        write(FAV_KEY, favorites);
        return true;
      },
      removeFavorite(ref) {
        const r = cleanRef(ref);
        if (!r || !has(favorites, r)) return false;
        favorites = favorites.filter(x => refKey(x) !== refKey(r));
        write(FAV_KEY, favorites);
        return true;
      },
      // Returns the new state: true = now a favourite.
      toggleFavorite(ref) { return lib.isFavorite(ref) ? (lib.removeFavorite(ref), false) : lib.addFavorite(ref); },
      // Opening an entry again moves it to the top instead of adding a second row.
      addRecent(ref) {
        const r = cleanRef({ ...ref, at: now() });
        if (!r) return false;
        if (recent.length && refKey(recent[0]) === refKey(r)) { recent[0] = r; write(RECENT_KEY, recent); return false; }
        recent = [r, ...recent.filter(x => refKey(x) !== refKey(r))].slice(0, MAX_RECENT);
        write(RECENT_KEY, recent);
        return true;
      },
      clearRecent() { recent = []; write(RECENT_KEY, recent); },
      // Drops references whose entry no longer exists (renamed or removed ids). exists(ref) → boolean.
      // Returns how many were removed; storage is rewritten only when something changed.
      prune(exists) {
        const keep = list => list.filter(r => { try { return !!exists(r); } catch (e) { return false; } });
        const f = keep(favorites), r = keep(recent), removed = favorites.length - f.length + recent.length - r.length;
        if (f.length !== favorites.length) { favorites = f; write(FAV_KEY, favorites); }
        if (r.length !== recent.length) { recent = r; write(RECENT_KEY, recent); }
        return removed;
      },
      // Re-read after another tab changed the lists (the "storage" event).
      reload() { if (persistent) { favorites = readList(storage, FAV_KEY); recent = readList(storage, RECENT_KEY); } },
    };
    return lib;
  }

  return { createLibrary, KINDS, FAV_KEY, RECENT_KEY, MAX_FAVORITES, MAX_RECENT, SHOW_RECENT, refKey, cleanRef, readList };
});
