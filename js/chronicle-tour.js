// ── Campaign Chronicle — interactive tours on the real interface (Driver.js) ─
// The tours point at the app's own controls. Each step highlights one real element and explains it;
// where it is safe the visitor can use that element (tap a marker, filter the quests, type a search)
// and the tour follows; "Siguiente" does the same on their behalf and moves on, across screens.
//
//   • STEPS / TOURS — the step definitions: plain data plus small functions of a context object
//     (the app's state: route, panels, layout, what the campaign holds). No DOM except in `target`.
//       screen   where the step needs to be — ok(ctx), go(ctx) → hash (null = cannot)
//       ui       panels that must be open or closed: more, search, mapPanel, mapPopup
//       target   the real element to highlight ($ = first match really on screen); none = centred
//       text     key of the title/description in locales/*.js (tour.<text>T / tour.<text>D); a
//                function picks a variant from the context and the element found (all in `variants`)
//       done     the expected action happened → the next step follows by itself
//       perform  what "Siguiente" does for the visitor before moving on (open a marker's card…)
//       fallback what to show when the screen cannot be reached or the element never appears: a
//                step is never skipped in silence and never points at something that is not there
//       none     the screen is there and the element cannot come (e.g. no marker at all): the
//                fallback shows at once instead of after the wait's time limit
//       when     the step exists only in that context, decided before the tour starts so that
//                "Paso 3 de 8" stays true (no located event → no "what a marker opens")
//   • createProgress(storage) — completed tours and the dismissed welcome, versioned.
//   • createRunner({ driver, app }) — the runtime: establishes each step's screen (the page stays
//     dimmed while it changes), waits until the element is rendered and still, drives Driver.js's
//     highlight() and keeps the highlight and its popover on that element while the app
//     re-renders, scrolls, resizes or loads its fonts.
//
// window.ChronicleTour in the page; module.exports in Node (tests/tour.test.js).
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.ChronicleTour = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // Bump VERSION when the tours change enough to be offered again: completion and the dismissed
  // welcome are remembered per version (v1: the old three-card guide; v2: the first, longer tours).
  const VERSION = 3;
  const KEYS = { version: "chronicle-tour-version", completed: "chronicle-tour-completed", invite: "chronicle-tour-invite" };
  const LEGACY_KEY = "chronicle-tutorial-seen";

  const enc = s => encodeURIComponent(s);
  const val = (v, c) => (typeof v === "function" ? v(c) : v);
  const is = (el, sel) => !!(el && el.matches && el.matches(sel));
  const onList = (c, section) => c.route.section === section && !c.route.kind;
  const list = section => ({ ok: c => onList(c, section), go: () => `#/${section}` });
  const HOME = list("chronicle");
  const CALM = { search: false, more: false };                      // no panel over the page
  // The map itself is on screen: a pin focus keeps it; an open entry covers it below 1024px.
  const mapVisible = c => c.route.section === "map" && (!c.route.kind || c.route.kind === "at" || c.isWide);
  const MAP = { ok: mapVisible, go: () => "#/map" };
  const fillExample = (api, c) => { if (!c.search.q.trim() && c.example.personName) api.act("searchQ", c.example.personName); };
  // The map is on screen with no marker on it at all (filters hide every event): nothing to wait for.
  const noMarker = $ => { const vp = $(".cc-vp"); return !!vp && !vp.querySelectorAll(".cc-marker").length; };

  // Shared by the main tour and the map tour: the same logic, their own words.
  // A real marker near the centre of the visible map; tapping it (or "Siguiente") opens its card.
  const MARKER = { screen: MAP, ui: { more: false, search: false, mapPanel: false, mapPopup: false },
    target: ($, c, env) => env.marker(c), settle: 3, timeout: 4000,          // after the lazy map has laid out and centred
    none: noMarker,
    side: "bottom", interactive: true,
    remember: el => ({ pin: (el.getAttribute("data-ev") || "").split(" ").filter(Boolean) }),
    done: c => !!c.mapPopup,
    perform: api => api.act("mapPopup", true) };
  // The card a marker opens. A list (several events) can be used — choosing one shows its card; a
  // card is read-only here, so "Leer entrada" never takes the visitor off the map mid-tour.
  const CARD = { screen: MAP, ui: { more: false, mapPanel: false, mapPopup: true }, when: c => !!c.mapHasMarkers,
    target: $ => $(".cc-vp [data-popup]"), settle: 3, side: "bottom",
    interactive: c => c.mapPopup === "list" };

  const STEPS = {
    // ── The main tour: eight steps, one idea each ──
    // ① What the Chronicle is, and the bar that moves between its sections ("Más" on phones)
    sections: { screen: HOME, ui: CALM,
      target: ($, c) => $(c.isMobile ? ".cc-bottom" : ".cc-tabs"),
      text: c => (c.isMobile ? "sectionsPhone" : "sections"), variants: ["sections", "sectionsPhone"],
      side: c => (c.isMobile ? "top" : "bottom"), align: "center" },
    // ② The Chronicle: the first day (or session) on screen when it fits, else its first card
    chronicle: { screen: HOME, ui: CALM,
      target: ($, c, env) => env.compact(env.inView(".cc-group"), env.inView(".cc-evlist .cc-card")) || $(".cc-empty") || $(".cc-chead"),
      text: (c, el) => (is(el, ".cc-group, .cc-card") ? "chronicle" : "chronicleNone"), variants: ["chronicle", "chronicleNone"],
      side: "bottom" },
    // ③ Sessions: always explained — a real session as the example, the heading while there is none
    sessions: { screen: list("sessions"), ui: CALM,
      target: ($, c, env) => env.inView(".cc-list .cc-scard") || $(".cc-sechead"),
      text: (c, el) => (is(el, ".cc-scard") ? "sessions" : "sessionsNone"), variants: ["sessions", "sessionsNone"],
      side: "bottom" },
    // ④ Quests: grouped by status; the status filter is the real control and can be used
    quests: { screen: list("quests"), ui: CALM,
      target: ($, c) => (c.hasQuests && $(".cc-statusbar")) || $(".cc-sechead"),
      text: (c, el) => (is(el, ".cc-statusbar") ? "quests" : "questsNone"), variants: ["quests", "questsNone"],
      side: "bottom", interactive: c => !!c.hasQuests },
    // ⑤ ⑥ The map: a real marker to tap, then the card it opens (and that the map has its own tour)
    map: { ...MARKER, text: "map",
      fallback: { target: $ => $(".cc-vp"), text: c => (c.mapHasMarkers ? "mapNone" : "mapEmpty"), variants: ["mapNone", "mapEmpty"] } },
    mapCard: { ...CARD, text: c => (c.mapPopup === "list" ? "mapCardList" : "mapCard"), variants: ["mapCard", "mapCardList"],
      fallback: { target: $ => $(".cc-vp"), text: "popupNone" } },
    // ⑦ The search: the magnifier in the top bar, on every screen (its own tour shows it in use)
    find: { screen: HOME, ui: CALM,
      target: $ => $(".cc-top .cc-searchbtn"),
      text: c => (c.isMobile ? "findPhone" : "find"), variants: ["find", "findPhone"], side: "bottom", align: "end" },
    // ⑧ Help, last — so it is what stays: "?" in the top bar; on phones More → Help (the sheet opens)
    help: { final: true, more: true, screen: HOME, ui: { search: false, more: c => !!c.isMobile },
      target: ($, c) => $(c.isMobile ? ".cc-sheet [data-tour=help]" : ".cc-top [data-tour=help]"),
      text: c => (c.isMobile ? "helpPhone" : "help"), variants: ["help", "helpPhone"],
      side: c => (c.isMobile ? "top" : "bottom"), align: c => (c.isMobile ? "center" : "end") },

    // ── The map tour: markers, groups, the party filter and its journeys, moving around ──
    marker: { ...MARKER, text: "marker",
      fallback: { target: $ => $(".cc-vp"), text: c => (c.mapHasMarkers ? "markerNone" : "mapEmpty"), variants: ["markerNone", "mapEmpty"] } },
    popup: { ...CARD, text: c => (c.mapPopup === "list" ? "popupList" : "popup"), variants: ["popup", "popupList"],
      fallback: { target: $ => $(".cc-vp"), text: "popupNone" } },
    cluster: { screen: MAP, ui: { more: false, mapPanel: false, mapPopup: false },
      target: ($, c, env) => env.marker(c, { group: true }), settle: 3, timeout: 3000,
      none: $ => { const vp = $(".cc-vp"); return !!vp && ![...vp.querySelectorAll(".cc-marker")].some(m => (m.getAttribute("data-ev") || "").includes(" ")); },
      text: "cluster", side: "bottom",
      fallback: { target: $ => $(".cc-vp"), text: "clusterNone" } },      // no group in view: explained over the map
    party: { screen: MAP, ui: { more: false, mapPanel: false, mapPopup: false },
      target: $ => $(".cc-mapbar .cc-mapbtn"), text: "party", side: "bottom", align: "start", interactive: true,
      done: c => c.mapPanelOpen,
      perform: api => api.act("mapPanel", true) },
    partyRows: { screen: MAP, ui: { more: false, mapPanel: true },
      target: ($, c, env) => env.compact($("[data-tour=party-rows]"), $(".cc-mappanel .cc-partyrow")),
      text: "partyRows", side: c => (c.isMobile ? "bottom" : "right"), interactive: true },
    zoom: { screen: MAP, ui: { more: false, mapPanel: false, mapPopup: false },
      target: $ => $(".cc-zoom"), text: "zoom", side: "top", align: "start", interactive: true },
    doneMap: { final: true, more: true, text: "doneMap", ui: { more: false, mapPanel: false } },

    // ── The search tour: open it, type, see the real results, open one and follow its links ──
    search: { ui: CALM,
      target: $ => $(".cc-searchbtn"), text: "search", side: "bottom", align: "end", interactive: true,
      reset: run => { run.searchedAway = false; },
      done: c => c.search.open,
      perform: api => api.act("search", true) },
    searchType: { ui: { search: true },
      target: $ => $(".cc-spanel .cc-shead .cc-search"), text: "searchType", side: "bottom", interactive: true, keepFocus: true,
      tryName: c => c.example.personName || "",                     // a real name from the campaign, one tap
      done: (c, mem, run) => !c.search.open && (run.searchedAway = true),   // Enter opened a result
      perform: fillExample },
    searchResults: { ui: { search: true },
      skip: (c, run, dir) => dir > 0 && !!run.searchedAway,
      prepare: fillExample,
      target: $ => $(".cc-spanel .cc-sgroup") || $(".cc-spanel .cc-snone"),
      text: (c, el) => (is(el, ".cc-snone") ? "searchNone" : "searchResults"), variants: ["searchResults", "searchNone"],
      side: "bottom", interactive: true, keepFocus: c => !c.isMobile, blur: c => c.isMobile,
      done: (c, mem, run) => !c.search.open && (run.searchedAway = true),   // a result was opened
      perform: api => api.act("search", false) },
    // An opened entry and its connections ("Ver en la Crónica" filters the story by it)
    entry: {
      screen: { ok: c => !!c.route.kind && c.route.kind !== "recap" && c.route.kind !== "at",
        go: c => (c.example.personId ? `#/${c.route.section === "map" ? "chronicle" : c.route.section}/character/${enc(c.example.personId)}` : null) },
      ui: CALM,
      target: $ => $(".cc-detail .cc-actrow") || $("[data-tour=event-people]") || $(".cc-detail .cc-byline"),
      text: (c, el) => (is(el, ".cc-actrow") ? "entry" : "links"), variants: ["entry", "links"],
      side: c => (c.isWide ? "left" : "bottom"), interactive: true,
      done: (c, mem) => c.hash !== mem.hash,
      fallback: { text: "entryNone" } },                                 // no entry to open: said without pointing
    doneSearch: { final: true, more: true, text: "doneSearch", ui: CALM },
  };
  Object.keys(STEPS).forEach(id => { STEPS[id].id = id; });

  const TOURS = {
    // Eight steps: the sections, the Chronicle, Sessions, Quests, the map (a marker and what it
    // opens), the search, and — last, so it is what stays — where the help and these tours live.
    main:   ["sections", "chronicle", "sessions", "quests", "map", "mapCard", "find", "help"],
    // The specific tours go further than the introduction.
    map:    ["marker", "popup", "cluster", "party", "partyRows", "zoom", "doneMap"],
    search: ["search", "searchType", "searchResults", "entry", "doneSearch"],
  };

  // The steps that apply in this context (decided by the campaign's content, never by the layout).
  function plan(tourId, c) { return (TOURS[tourId] || []).map(id => STEPS[id]).filter(s => !s.when || s.when(c)); }

  // "Paso 3 de 8": every popover is one step, counted on the plan.
  function progress(steps, step) {
    const i = steps.indexOf(step);
    return i < 0 ? null : { n: i + 1, total: steps.length };
  }

  function params(c) {
    return { ...(c.labels || {}), name: (c.example && c.example.personName) || "", n: c.latest != null ? c.latest : "" };
  }
  function textOf(step, c, el, t) {
    const key = typeof step.text === "function" ? step.text(c, el) : step.text, p = params(c);
    return { key, title: t(`tour.${key}T`, p), body: t(`tour.${key}D`, p) };
  }
  // Every locale key a tour can show (tests check both languages have them, short).
  function textKeys(tourId) {
    const keys = new Set(["tour.next", "tour.prev", "tour.finish", "tour.skip", "tour.more", "tour.progress", "tour.try"]);
    const texts = s => s.variants || (typeof s.text === "string" ? [s.text] : []);
    (tourId ? TOURS[tourId] : Object.keys(STEPS)).map(id => STEPS[id]).forEach(s => {
      texts(s).concat(s.fallback ? texts(s.fallback) : []).forEach(k => { keys.add(`tour.${k}T`); keys.add(`tour.${k}D`); });
      if (s.nextLabel) keys.add(`tour.${s.nextLabel}`);
    });
    return [...keys];
  }

  const escapeHtml = s => String(s == null ? "" : s).replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);

  // ── Progress: which tours were completed, whether the welcome was dismissed ──
  // Three separate keys: the version they refer to, the completed tours, the welcome. A newer
  // VERSION makes the older flags stale (the tours are offered again) without touching anything
  // else the visitor keeps (language, favourites, history, preferences).
  function createProgress(storage) {
    let usable = !!storage;
    try { if (storage) storage.getItem(KEYS.version); } catch (e) { usable = false; }
    const mem = { completed: new Set(), dismissed: false };
    const get = k => { if (!usable) return null; try { return storage.getItem(k); } catch (e) { return null; } };
    const set = (k, v) => { if (usable) try { storage.setItem(k, v); } catch (e) {} };
    const del = k => { if (usable) try { storage.removeItem(k); } catch (e) {} };
    const current = () => Number(get(KEYS.version)) === VERSION;
    function stored() {
      if (!current()) return [];
      try { const v = JSON.parse(get(KEYS.completed) || "[]"); return Array.isArray(v) ? v.filter(x => typeof x === "string") : []; } catch (e) { return []; }
    }
    function stamp() { if (!current()) { set(KEYS.version, String(VERSION)); set(KEYS.completed, "[]"); del(KEYS.invite); } }
    const completed = () => [...new Set([...stored(), ...mem.completed])];
    const dismissed = () => mem.dismissed || (current() && get(KEYS.invite) === "dismissed");
    return {
      persistent: usable,
      completed,
      isCompleted: id => completed().includes(id),
      inviteDismissed: dismissed,
      // Without storage the welcome never nags (it could not be dismissed for good).
      showInvite: () => usable && !completed().includes("main") && !dismissed(),
      complete(id) { mem.completed.add(id); stamp(); const c = stored(); if (!c.includes(id)) set(KEYS.completed, JSON.stringify([...c, id])); },
      dismissInvite() { mem.dismissed = true; stamp(); set(KEYS.invite, "dismissed"); },
      // The old guide's flag is superseded by the versioned keys.
      migrate() { del(LEGACY_KEY); },
    };
  }

  // ── Runtime ─────────────────────────────────────────────────────────────────
  // app: { t() → translator, ctx() → context, go(hash) (replaces the current history entry),
  //        act(name, value, run) → false when impossible, say(text), ended({ id, completed, reason, step }) }
  function createRunner(opts) {
    const app = opts.app, makeDriver = opts.driver, win = opts.window || window, doc = win.document;
    const ARIA = ["aria-haspopup", "aria-expanded", "aria-controls"];
    const DURATION = 260;                                    // Driver.js's move from one element to the next
    let drv = null, run = null, seq = 0, syncQueued = false, clampQueued = false, refreshQueued = false, probe = null, ro = null;
    const raf = cb => win.requestAnimationFrame(cb);
    const reduced = () => !!(win.matchMedia && win.matchMedia("(prefers-reduced-motion: reduce)").matches);

    // Only elements really on screen count (display:none ancestors, hidden, zero size do not).
    function shown(el) {
      if (!el || !el.isConnected) return false;
      if (el.checkVisibility && !el.checkVisibility({ visibilityProperty: true, checkVisibilityCSS: true })) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    }
    const $ = sel => { for (const el of doc.querySelectorAll(sel)) if (shown(el)) return el; return null; };
    // Where an element can be seen: the pane it scrolls in (list, reading pane, panel), inside the window.
    function viewBox(el) {
      const W = { top: 0, left: 0, bottom: win.innerHeight, right: win.innerWidth };
      const pane = el.closest && el.closest(".cc-main, .cc-detail, .cc-sbody, .cc-mappanel");
      if (!pane) return W;
      const r = pane.getBoundingClientRect();
      return { top: Math.max(W.top, r.top), left: Math.max(W.left, r.left), bottom: Math.min(W.bottom, r.bottom), right: Math.min(W.right, r.right) };
    }
    function whole(el) { const r = el.getBoundingClientRect(), b = viewBox(el); return r.top >= b.top - 1 && r.bottom <= b.bottom + 1; }
    function partly(el) { const r = el.getBoundingClientRect(), b = viewBox(el); return r.bottom > b.top && r.top < b.bottom; }

    const env = {
      // A real marker inside the visible map (never under its bars, never off screen). The marker step
      // prefers one event, then one place with several, then a group of nearby places — near the centre,
      // the example event among them; { group } wants a numbered group (the map tour's cluster step).
      marker(c, o) {
        const vp = $(".cc-vp"); if (!vp) return null;
        const V = vp.getBoundingClientRect(), bar = $(".cc-mapbar"), zoom = $(".cc-zoom"), Z = zoom && zoom.getBoundingClientRect();
        const top = Math.max(V.top, bar ? bar.getBoundingClientRect().bottom : V.top) + 10;
        const cx = (V.left + V.right) / 2, cy = (top + V.bottom) / 2, group = !!(o && o.group);
        let best = null, bestScore = Infinity;
        vp.querySelectorAll(".cc-marker").forEach(el => {
          if (!shown(el)) return;
          const r = el.getBoundingClientRect(), ids = (el.getAttribute("data-ev") || "").split(" ").filter(Boolean);
          const cluster = el.getAttribute("data-kind") === "cluster", many = ids.length > 1;
          if (r.left < V.left + 16 || r.right > V.right - 16 || r.top < top || r.bottom > V.bottom - 16) return;
          if (Z && r.right > Z.left - 8 && r.left < Z.right + 8 && r.bottom > Z.top - 8) return;
          if (group && !many) return;
          const rank = group ? (cluster ? 0 : 1) : (cluster ? 2 : many ? 1 : 0);
          const score = rank * 4000 + Math.hypot((r.left + r.right) / 2 - cx, (r.top + r.bottom) / 2 - cy)
            - (c.example.mapEventId && ids.includes(c.example.mapEventId) ? 400 : 0);
          if (score < bestScore) { bestScore = score; best = el; }
        });
        return best;
      },
      // The whole block when it is in view and leaves room for the popover; else its first row.
      compact(block, row) { return block && whole(block) && block.getBoundingClientRect().height <= win.innerHeight * 0.45 ? block : (row || block); },
      // The first match already visible where it scrolls (whole, else in part), so the tour does not
      // move the page to reach it; only when none is visible, the first one (Driver.js scrolls to it).
      inView(sel) {
        const els = [...doc.querySelectorAll(sel)].filter(shown);
        return els.find(whole) || els.find(partly) || els[0] || null;
      },
    };

    // Waits for the element to exist, be visible and keep still for a few frames (layout, centring
    // and lazy panels have settled). Condition-based: `none` (the screen says it cannot come, for a
    // dozen frames in a row) ends the wait at once; the timeout only ends a wait for an element that
    // never comes. Either way the step's fallback is shown.
    function waitFor(resolve, frames, timeout, token, none) {
      return new Promise(done => {
        let last = null, key = "", still = 0, empty = 0, over = false;
        const timer = win.setTimeout(() => finish(null), timeout);
        function finish(v) { if (over) return; over = true; win.clearTimeout(timer); done(v); }
        (function tick() {
          if (over) return;
          if (token !== seq) return finish(null);
          let el = null; try { el = resolve(); } catch (e) { el = null; }
          if (el) {
            empty = 0;
            const r = el.getBoundingClientRect(), k = [r.left, r.top, r.width, r.height].map(Math.round).join(",");
            if (el === last && k === key) { if (++still >= frames) return finish(el); } else { last = el; key = k; still = 0; }
          } else {
            last = null; still = 0;
            let gone = false; try { gone = !!(none && none()); } catch (e) { gone = false; }
            if (gone && ++empty >= 12) return finish(null);
            if (!gone) empty = 0;
          }
          raf(tick);
        })();
      });
    }

    function ensure() {
      if (drv) return drv;
      drv = makeDriver({
        animate: !reduced(), duration: DURATION, smoothScroll: false,
        allowClose: false, allowKeyboardControl: false,         // Esc and ← → are handled by the page (tour.next/prev/stop)
        overlayClickBehavior: () => nudge(),                    // a tap outside never ends the tour by accident
        overlayColor: "#070402", overlayOpacity: 0.74, stagePadding: 6, stageRadius: 12, popoverOffset: 12,
        popoverClass: "cc-tour",
      });
      return drv;
    }

    const uiValue = (c, k) => (k === "more" ? c.moreOpen : k === "search" ? c.search.open : k === "mapPanel" ? c.mapPanelOpen : k === "mapPopup" ? !!c.mapPopup : undefined);
    function satisfied(step, c) {
      if (step.screen && !step.screen.ok(c)) return false;
      return !step.ui || Object.keys(step.ui).every(k => uiValue(c, k) === val(step.ui[k], c));
    }
    // Brings the app to the step's screen and panels; false when that is impossible (→ its fallback).
    function establish(step) {
      let c = app.ctx();
      if (step.screen && !step.screen.ok(c)) {
        const hash = step.screen.go(c); if (!hash) return false;
        app.go(hash); c = app.ctx();
        if (!step.screen.ok(c)) return false;
      }
      if (step.ui) for (const k of Object.keys(step.ui)) {
        const want = val(step.ui[k], c);
        if (uiValue(c, k) !== want && app.act(k, want, run) === false) return false;
        c = app.ctx();
      }
      return true;
    }

    const api = { go: hash => app.go(hash), act: (name, value) => app.act(name, value, run) };

    // Between screens the spotlight closes first — the whole page dimmed, no popover — while the app
    // changes screen, and opens again on the next element: the cut-out never shows the old place over
    // the new screen, and the change is never a jump. Resolves once Driver.js has finished that move
    // (on the next frame without animations; a timer only covers a move that was interrupted).
    function park() {
      if (!drv || !drv.isActive() || !run || !run.el) return Promise.resolve();
      const left = run.el; run.el = null; run.settled = false;
      return new Promise(done => {
        let over = false;
        const finish = () => { if (over) return; over = true; win.clearTimeout(timer); done(); };
        const timer = win.setTimeout(finish, DURATION + 240);
        drv.highlight({ element: undefined, onHighlighted: finish });
        restoreAria(left);
      });
    }

    async function show(i, dir, o) {
      if (!run) return;
      const token = ++seq, follow = !!(o && o.follow);
      run.busy = true; run.ready = false;
      doc.body.classList.add("cc-tour-busy");                 // the popover waits, hidden, for the next screen
      for (;;) {
        if (!run || token !== seq) return;
        const steps = plan(run.id, app.ctx());
        if (i < 0) i = 0;
        if (i >= steps.length) return stop("done");
        const step = steps[i];
        if (step.skip && step.skip(app.ctx(), run, dir)) { i += dir || 1; continue; }
        if (step.reset) step.reset(run);
        // Another screen or other panels: close the spotlight before the page changes under it.
        if (!follow && !satisfied(step, app.ctx())) { await park(); if (!run || token !== seq) return; }
        const reached = establish(step);
        if (reached && step.prepare) step.prepare(api, app.ctx());
        let el = null, missing = !reached;
        if (reached && step.target) {
          el = await waitFor(() => step.target($, app.ctx(), env), step.settle || 2, step.timeout || 4000, token, step.none && (() => step.none($, app.ctx())));
          if (!run || token !== seq) return;
          missing = !el;
        }
        const fallback = missing && !!step.fallback;
        if (fallback && step.fallback.target) {
          el = await waitFor(() => step.fallback.target($, app.ctx(), env), 2, 1500, token);
          if (!run || token !== seq) return;
        }
        run.busy = false;
        doc.body.classList.remove("cc-tour-busy");
        render(step, el, { fallback, follow: follow && run.step === step });
        return;
      }
    }

    function snapshotAria(el) { const s = {}; ARIA.forEach(a => { s[a] = el.getAttribute(a); }); return s; }
    // Driver.js strips aria-haspopup/expanded/controls from the element it leaves: put back the app's own.
    function restoreAria(el) {
      const s = run && run.saved.get(el); if (!s || !el.isConnected) return;
      ARIA.forEach(a => { if (s[a] == null) el.removeAttribute(a); else el.setAttribute(a, s[a]); });
    }

    function render(step, el, o) {
      ensure();
      const c = app.ctx(), t = app.t(), steps = plan(run.id, c), idx = steps.indexOf(step);
      const prog = progress(steps, step), fb = o.fallback && step.fallback;
      const tx = textOf(fb || step, c, el, t);
      const left = run.el;
      if (el && !run.saved.has(el)) run.saved.set(el, snapshotAria(el));
      run.step = step; run.el = el || null; run.fallback = !!fb; run.ready = false; run.settled = false;
      if (!o.follow) { run.mem = { hash: c.hash }; run.repairs = 0; }
      if (el && step.remember && !fb) Object.assign(run, step.remember(el));
      const keep = !!val(step.keepFocus, c), quiet = o.follow || keep;
      // Siguiente / Finalizar, Anterior from the second step on, "Omitir tutorial" until the last one.
      const buttons = ["next"].concat(step.final ? [] : ["close"], idx > 0 ? ["previous"] : []);
      observe(el);
      drv.highlight({
        element: el || undefined,
        disableActiveInteraction: !val(step.interactive, c) || !!fb,
        onHighlighted: () => { if (run && run.step === step) { run.settled = true; refreshSoon(); } },
        popover: {
          title: escapeHtml(tx.title), description: escapeHtml(tx.body),
          side: val(step.side, c) || "bottom", align: val(step.align, c) || "start",
          showButtons: buttons, showProgress: !!prog, progressText: prog ? escapeHtml(t("tour.progress", prog)) : "",
          nextBtnText: escapeHtml(t(`tour.${step.nextLabel || (step.final ? "finish" : "next")}`)), prevBtnText: escapeHtml(t("tour.prev")),
          onNextClick: () => next(), onPrevClick: () => prev(), onCloseClick: () => stop("close"),
          onPopoverRender: p => decorate(p, step, c, { quiet, prog, t }),
        },
      });
      if (left && left !== el) restoreAria(left);
      // Driver.js un-marks only the element it last finished moving to, so steps in quick succession
      // can leave an earlier one marked (and clickable through the dimmed layer): only `el` stays marked.
      doc.querySelectorAll(".driver-active-element").forEach(x => {
        if (x !== el && x.id !== "driver-dummy-element") { x.classList.remove("driver-active-element", "driver-no-interaction"); restoreAria(x); }
      });
      if (val(step.blur, c) && doc.activeElement && doc.activeElement.blur) doc.activeElement.blur();
      // Focus stays in the page (typing in the search): say the instruction instead.
      if (quiet && !o.follow) app.say([prog ? t("tour.progress", prog) : "", tx.title, tx.body].filter(Boolean).join(". "));
    }

    function button(parent, label, fn, first) {
      const b = doc.createElement("button");
      b.type = "button"; b.className = "driver-popover-footer-btn cc-tour-alt"; b.textContent = label;
      b.addEventListener("click", e => { e.preventDefault(); fn(); });
      if (first && parent.firstChild) parent.insertBefore(b, parent.firstChild); else parent.appendChild(b);
      return b;
    }
    function decorate(p, step, c, o) {
      if (!run || run.step !== step) return;                   // a popover Driver.js drew late for a step already left
      const t = o.t, w = p.wrapper;
      run.ready = true;                                        // its buttons exist: Siguiente / Anterior can act
      w.setAttribute("lang", (t.meta && t.meta.htmlLang) || "");
      // Top row: "Paso 3 de 8" and a thin bar, with "Omitir tutorial" (Driver.js's close button) on its right.
      if (o.prog) {
        const head = doc.createElement("div"), bar = doc.createElement("span"), fill = doc.createElement("i");
        head.className = "cc-tour-head"; bar.className = "cc-tour-bar"; bar.setAttribute("aria-hidden", "true");
        fill.style.width = `${Math.round((100 * o.prog.n) / o.prog.total)}%`;
        bar.appendChild(fill); head.appendChild(p.progress); head.appendChild(bar);
        w.insertBefore(head, p.title);
      }
      p.closeButton.textContent = t("tour.skip");
      p.closeButton.removeAttribute("aria-label");             // its name is the visible "Omitir tutorial"
      p.closeButton.classList.add("cc-tour-skip");
      w.appendChild(p.closeButton);                            // last in the tab order; still drawn top-right
      const name = step.tryName && step.tryName(c);
      if (name && !c.search.q.trim()) {
        const b = button(p.description, t("tour.try", { name }), () => { if (!run) return; app.act("searchQ", name, run); next(); });
        b.className = "cc-tour-try";
      }
      if (step.more) button(p.footer, t("tour.more"), () => stop("more"), true);
      if (o.quiet) {
        // Driver.js focuses the popover's first control; while the visitor types (or the element just
        // re-rendered) nothing should move: nothing is focusable for that one moment.
        const btns = [...w.querySelectorAll("button")].filter(b => !b.disabled);
        btns.forEach(b => { b.disabled = true; });
        doc.body.classList.add("cc-tour-hold");
        Promise.resolve().then(() => { btns.forEach(b => { b.disabled = false; }); doc.body.classList.remove("cc-tour-hold"); });
      } else {
        Promise.resolve().then(() => { if (p.nextButton.isConnected) p.nextButton.focus({ preventScroll: true }); });
      }
      if (ro) ro.observe(w);
      clampSoon();
    }

    // A tap on the dimmed page: the tour stays, the popover's main button is pointed out.
    function nudge() {
      const p = doc.querySelector(".driver-popover.cc-tour"); if (!p) return;
      const btn = p.querySelector(".driver-popover-next-btn"); if (btn) btn.focus({ preventScroll: true });
      if (reduced()) return;
      p.classList.remove("cc-tour-nudge"); void p.offsetWidth; p.classList.add("cc-tour-nudge");
    }

    // Keep the popover inside the visible area — safe areas (notches, home bar) and the part of the
    // screen the virtual keyboard leaves (visualViewport) — and off the element it explains. Driver.js
    // places it; this only nudges.
    function insets() {
      if (!probe) {
        probe = doc.createElement("div");
        probe.setAttribute("aria-hidden", "true");
        probe.style.cssText = "position:fixed;inset:0;visibility:hidden;pointer-events:none;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left);";
        doc.body.appendChild(probe);
      }
      const s = win.getComputedStyle(probe), n = v => parseFloat(v) || 0;
      return { top: n(s.paddingTop), right: n(s.paddingRight), bottom: n(s.paddingBottom), left: n(s.paddingLeft) };
    }
    function clamp() {
      clampQueued = false;
      const p = doc.querySelector(".driver-popover.cc-tour"); if (!p || !run) return;
      p.style.translate = "";
      let r = p.getBoundingClientRect(); if (!r.width) return;
      const s = insets(), vv = win.visualViewport;
      const W = win.innerWidth, H = vv ? Math.min(win.innerHeight, vv.offsetTop + vv.height) : win.innerHeight;
      const L = s.left + 8, R = W - s.right - 8, T = s.top + 8, B = H - s.bottom - 8;
      let dx = 0, dy = 0;
      // No side had room (a low screen, a tall card): Driver.js then lays the popover over the element.
      // Move it to the larger free band above or below the element instead, shortening its text (which
      // then scrolls, faded at the edge) when that band is a little too short. The shortened height is
      // kept for the step, so the next placement measures the same popover (no back and forth).
      const e = run.el && shown(run.el) ? run.el.getBoundingClientRect() : null, gap = 14;
      if (e && r.left < e.right && r.right > e.left && r.top < e.bottom + gap && r.bottom > e.top - gap) {
        const above = e.top - gap - T, below = B - (e.bottom + gap), band = Math.max(above, below);
        const d = p.querySelector(".driver-popover-description");
        const shorten = by => { d.style.maxHeight = `${Math.max(48, d.clientHeight - by)}px`; d.classList.add("cc-tour-cut"); r = p.getBoundingClientRect(); };
        if (d && r.height > band && band >= 150) shorten(r.height - band);
        if (r.height <= band) dy = below >= above ? e.bottom + gap - r.top : e.top - gap - r.bottom;
        else {
          // Neither above nor below (a phone on its side): beside the element, narrower.
          const lw = e.left - gap - L, rw = R - (e.right + gap), w = Math.max(lw, rw);
          if (w >= 200) {
            p.classList.add("cc-tour-narrow"); p.style.width = `${Math.floor(Math.min(w, r.width))}px`;
            r = p.getBoundingClientRect();
            if (d && r.height > B - T) shorten(r.height - (B - T));
            dx = rw >= lw ? e.right + gap - r.left : e.left - gap - r.right;
            dy = (e.top + e.bottom) / 2 - (r.top + r.bottom) / 2;
          }
        }
      }
      if (r.right + dx > R) dx = R - r.right;
      if (r.left + dx < L) dx = L - r.left;
      if (r.bottom + dy > B) dy = B - r.bottom;
      if (r.top + dy < T) dy = T - r.top;
      if (dx || dy) p.style.translate = `${Math.round(dx)}px ${Math.round(dy)}px`;
    }
    function clampSoon() { if (clampQueued) return; clampQueued = true; raf(() => raf(clamp)); }

    // Re-place the highlight and the popover — only once Driver.js has finished moving to the element
    // (refreshing mid-move would snap the spotlight back to the previous one).
    function refresh() { if (run && !run.busy && run.settled && drv) { drv.refresh(); clampSoon(); } }
    function refreshSoon() { if (refreshQueued) return; refreshQueued = true; raf(() => { refreshQueued = false; refresh(); }); }
    // The highlight follows its element and the popover when they change size (a font arriving, a list
    // filling in, a longer text): at most one refresh per frame.
    function observe(el) {
      if (!win.ResizeObserver) return;
      if (!ro) ro = new win.ResizeObserver(() => refreshSoon());
      ro.disconnect();
      if (el) ro.observe(el);
    }
    const onScroll = () => refreshSoon();                    // the app scrolls inside its panes, not the window
    const onViewport = () => refreshSoon();                  // window or keyboard resize, fonts loaded

    function start(tourId) {
      if (!TOURS[tourId] || typeof makeDriver !== "function") return false;
      if (run) stop("restart", { silent: true });
      run = { id: tourId, step: null, el: null, mem: {}, busy: false, ready: false, settled: false, pin: null, searchedAway: false, saved: new Map() };
      ensure();
      doc.addEventListener("scroll", onScroll, true);
      win.addEventListener("resize", onViewport);
      if (win.visualViewport) win.visualViewport.addEventListener("resize", onViewport);
      if (doc.fonts && doc.fonts.addEventListener) doc.fonts.addEventListener("loadingdone", onViewport);
      show(0, 1);
      return true;
    }
    // Siguiente / Anterior act only once the step's popover is there (no flying through steps while
    // the next screen is still on its way).
    function next() {
      if (!run || run.busy || !run.ready || !run.step) return;
      const step = run.step;
      if (step.final) return stop("done");
      if (step.perform && !run.fallback) step.perform(api, app.ctx(), run.el);
      go(1);
    }
    function prev() { if (run && !run.busy && run.ready && run.step) go(-1); }
    function go(dir) {
      const steps = plan(run.id, app.ctx());
      let i = steps.indexOf(run.step);
      if (i < 0) i = afterIndex(steps, run.step) - (dir > 0 ? 1 : 0);
      if (i + dir < 0) return;                                 // ← on the first step: nothing before it
      show(i + dir, dir);
    }
    // Where a step that no longer applies would have been.
    function afterIndex(steps, step) {
      const order = TOURS[run.id], at = order.indexOf(step.id);
      const k = steps.findIndex(s => order.indexOf(s.id) > at);
      return k < 0 ? steps.length : k;
    }

    // Called after every render of the app: an action the step waited for moves the tour on; a
    // re-rendered element is highlighted again; otherwise the highlight follows layout changes.
    function sync() { if (!run || syncQueued) return; syncQueued = true; raf(() => { syncQueued = false; check(); }); }
    function check() {
      if (!run || run.busy || !run.step) return;
      const c = app.ctx(), steps = plan(run.id, c), step = run.step, i = steps.indexOf(step);
      if (i < 0) return show(afterIndex(steps, step), 1);
      if (step.done && !run.fallback && step.done(c, run.mem, run)) return show(i + 1, 1);
      // The screen changed under the step (rare: the highlighted element can only do the step's own
      // action, or the layout crossed a breakpoint): set it up again — a few times at most, never a loop.
      if (!run.fallback && !satisfied(step, c) && (run.repairs = (run.repairs || 0) + 1) <= 6) return show(i, 1, { follow: true });
      if (step.target && !run.fallback && !shown(run.el)) {
        const el = step.target($, c, env);
        if (el) return render(step, el, { follow: true });
        if (run.el) return show(i, 1, { follow: true });      // its element went away: wait for the new one
      }
      // Something typed already: the "try this name" shortcut is no longer needed.
      if (step.tryName) { const b = doc.querySelector(".driver-popover.cc-tour .cc-tour-try"); if (b) b.hidden = !!c.search.q.trim(); }
      refresh();
    }
    // Same step, current language (the texts are read again).
    function rerender() { if (run && !run.busy && run.step) render(run.step, run.el, { fallback: run.fallback, follow: false }); }

    function stop(reason, o) {
      if (!run) return;
      const r = run, completed = reason === "done" || reason === "more" || !!(r.step && r.step.final);
      run = null; seq++; syncQueued = false; refreshQueued = false;
      doc.removeEventListener("scroll", onScroll, true);
      win.removeEventListener("resize", onViewport);
      if (win.visualViewport) win.visualViewport.removeEventListener("resize", onViewport);
      if (doc.fonts && doc.fonts.removeEventListener) doc.fonts.removeEventListener("loadingdone", onViewport);
      if (ro) ro.disconnect();
      if (drv && drv.isActive()) drv.destroy();
      r.saved.forEach((s, el) => { if (el.isConnected) ARIA.forEach(a => { if (s[a] == null) el.removeAttribute(a); else el.setAttribute(a, s[a]); }); });
      doc.body.classList.remove("cc-tour-busy", "cc-tour-hold");
      if (probe) { probe.remove(); probe = null; }
      if (!(o && o.silent)) app.ended({ id: r.id, completed, reason, step: r.step ? r.step.id : null });
    }

    return { start, stop, next, prev, sync, rerender, refresh,
      isActive: () => !!run, tourId: () => (run ? run.id : null), stepId: () => (run && run.step ? run.step.id : null) };
  }

  return { VERSION, KEYS, LEGACY_KEY, STEPS, TOURS, plan, progress, textOf, textKeys, escapeHtml, createProgress, createRunner };
});
