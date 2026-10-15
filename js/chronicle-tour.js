// ── Campaign Chronicle — interactive tours on the real interface (Driver.js) ─
// The tours point at the app's own controls and let the visitor use them. A step can wait for an
// action (open the recap, tap a card, open the search, open the map, tap a marker) and the tour
// follows to the screen that action leads to; "Next" does the same action on the visitor's behalf.
//
//   • STEPS / TOURS — the step definitions: plain data plus small functions of a context object
//     (the app's state: route, panels, examples from the data). No DOM except inside `target`.
//       screen   where the step needs to be — ok(ctx), go(ctx) → hash (null = cannot, skip it)
//       ui       panels that must be open or closed: more, search, mapPanel, mapPopup
//       target   the real element to highlight ($ = first match that is really on screen);
//                no target = a centred popover
//       text     key of the title/description in locales/*.js (tour.<text>T / tour.<text>D);
//                a function picks a variant by the element found (all listed in `variants`)
//       done     the expected action happened → the next step follows by itself
//       perform  what "Next" does for the visitor before moving on (navigate, open a panel…)
//       fallback what to show when the element never appears (the step is never left blank)
//       optional skip the step when its element is not there (instead of a fallback)
//   • createProgress(storage) — completed tours and the first-visit invitation, versioned.
//   • createRunner({ driver, app }) — the runtime: establishes each step's screen, waits until its
//     element is rendered and still, drives Driver.js's highlight() and keeps the highlight on
//     its element while the app re-renders, pans the map or scrolls.
//
// window.ChronicleTour in the page; module.exports in Node (tests/tour.test.js).
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.ChronicleTour = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // Bump VERSION when the tours change enough to be offered again: completion and the dismissed
  // invitation are remembered per version (v1 was the old three-card guide).
  const VERSION = 2;
  const KEYS = { version: "chronicle-tour-version", completed: "chronicle-tour-completed", invite: "chronicle-tour-invite" };
  const LEGACY_KEY = "chronicle-tutorial-seen";

  const enc = s => encodeURIComponent(s);
  const cssq = s => (typeof CSS !== "undefined" && CSS.escape ? CSS.escape(s) : String(s).replace(/["\\]/g, "\\$&"));
  const val = (v, c) => (typeof v === "function" ? v(c) : v);
  const onList = (c, section) => c.route.section === section && !c.route.kind;
  const notMap = c => c.route.section !== "map";
  // The map itself is on screen: a pin focus keeps it; an open entry covers it below 1024px.
  const mapVisible = c => c.route.section === "map" && (!c.route.kind || c.route.kind === "at" || c.isWide);
  const toMap = () => "#/map";
  const fillExample = (api, c) => { if (!c.search.q.trim() && c.example.personName) api.act("searchQ", c.example.personName); };

  const STEPS = {
    // ① What this is
    welcome: { chapter: "welcome", text: "welcome", nextLabel: "start", skipButton: true },

    // ② Previously on… — the real recap of the latest session
    recap: { chapter: "recap", when: c => c.latest != null,
      screen: { ok: c => onList(c, "chronicle"), go: () => "#/chronicle" }, ui: { search: false, more: false },
      target: $ => $(".cc-latest"), text: "recap", side: "bottom", interactive: true,
      done: c => c.route.kind === "recap",
      perform: (api, c) => api.go(`#/chronicle/recap/${c.latest}`) },
    recapView: { chapter: "recap", when: c => c.latest != null,
      screen: { ok: c => c.route.kind === "recap", go: c => `#/chronicle/recap/${c.latest}` }, ui: { search: false, more: false },
      target: $ => $("[data-tour=recap-where]") || $("[data-tour=recap-events]") || $(".cc-detail .cc-doc-h"),
      text: "recapView", side: c => (c.isWide ? "left" : "bottom") },
    // No session has a log yet: the Sessions section is the real alternative (nothing is invented).
    sessions: { chapter: "recap", when: c => c.latest == null, ui: { search: false, more: false },
      target: ($, c) => $(c.isMobile ? '.cc-bottom a[href="#/sessions"]' : '.cc-tabs a[href="#/sessions"]'),
      text: "sessions", side: c => (c.isMobile ? "top" : "bottom") },

    // ③ The Chronicle — a real card (the well-connected example when it is on screen)
    card: { chapter: "chronicle",
      screen: { ok: c => onList(c, "chronicle"), go: () => "#/chronicle" }, ui: { search: false, more: false },
      target: ($, c) => (c.example.eventId && $(`.cc-card[data-ev="${cssq(c.example.eventId)}"]`)) || $(".cc-evlist .cc-card") || $(".cc-ghead"),
      text: "card", side: "bottom", interactive: true,
      done: c => c.route.kind === "event",
      perform: (api, c, el) => { const id = (el && el.getAttribute("data-ev")) || c.example.eventId; if (id) api.go(`#/chronicle/event/${enc(id)}`); } },

    // ④ Connections — one relation of the open event (people, else quests, else its session/place)
    links: { chapter: "links",
      screen: { ok: c => c.route.kind === "event", go: c => (c.example.eventId ? `#/chronicle/event/${enc(c.example.eventId)}` : null) },
      ui: { search: false, more: false },
      target: $ => $("[data-tour=event-people]") || $("[data-tour=event-quests]") || $(".cc-detail .cc-byline"),
      text: (c, el) => variant(el, { "event-people": "links", "event-quests": "linksQuests" }, "linksByline"),
      variants: ["links", "linksQuests", "linksByline"],
      side: c => (c.isWide ? "left" : "bottom"), interactive: true,
      done: (c, mem) => c.hash !== mem.hash },

    // ⑤ The universal search — open it, type, see the real results, open one
    search: { chapter: "search", ui: { search: false, more: false },
      target: $ => $(".cc-searchbtn"), text: "search", side: "bottom", align: "end", interactive: true,
      reset: run => { run.searchedAway = false; },
      done: c => c.search.open,
      perform: api => api.act("search", true) },
    searchType: { chapter: "search", ui: { search: true },
      target: $ => $(".cc-spanel .cc-shead .cc-search"), text: "searchType", side: "bottom", interactive: true, keepFocus: true,
      tryName: c => c.example.personName || "",                     // a real name from the campaign, one tap
      done: (c, mem, run) => !c.search.open && (run.searchedAway = true),   // Enter opened a result
      perform: fillExample },
    searchResults: { chapter: "search", ui: { search: true },
      skip: (c, run, dir) => dir > 0 && !!run.searchedAway,
      prepare: fillExample,
      target: $ => $(".cc-spanel .cc-sgroup") || $(".cc-spanel .cc-snone"),
      text: (c, el) => (el && el.matches(".cc-snone") ? "searchNone" : "searchResults"), variants: ["searchResults", "searchNone"],
      side: "bottom", interactive: true, keepFocus: c => !c.isMobile, blur: c => c.isMobile,
      done: (c, mem, run) => !c.search.open && (run.searchedAway = true),   // a result was opened
      perform: api => api.act("search", false) },

    // ⑥ The map — how to get there (More on phones), a real marker, what it opens
    mapMore: { chapter: "map", when: c => c.isMobile,
      screen: { ok: notMap, go: () => "#/chronicle" }, ui: { search: false, more: false },
      target: $ => $(".cc-bottom button.cc-bn"), text: "mapMore", side: "top", interactive: true,
      done: c => c.moreOpen || c.route.section === "map",
      perform: api => api.act("more", true) },
    mapOpen: { chapter: "map",
      screen: { ok: notMap, go: () => "#/chronicle" }, ui: { search: false, more: c => !!c.isMobile },
      target: ($, c) => $(c.isMobile ? '.cc-sheet a[href="#/map"]' : '.cc-tabs a[href="#/map"]'),
      text: "mapOpen", side: c => (c.isMobile ? "top" : "bottom"), interactive: true,
      done: c => c.route.section === "map",
      perform: api => api.go("#/map") },
    marker: { chapter: "map",
      screen: { ok: mapVisible, go: toMap }, ui: { more: false, search: false, mapPanel: false, mapPopup: false },
      target: ($, c, env) => env.marker(c), settle: 3, timeout: 6000,     // after the lazy map has laid out and centred
      text: "marker", side: "bottom", interactive: true,
      fallback: { target: $ => $(".cc-vp"), text: "markerNone" },        // no marker in view (filters, empty map)
      remember: el => ({ pin: (el.getAttribute("data-ev") || "").split(" ").filter(Boolean) }),
      done: c => !!c.mapPopup,
      perform: api => api.act("mapPopup", true) },
    // A list (several events) can be used — choosing one shows its card; a card is read-only here, so
    // "Read entry" never takes the visitor off the map in the middle of the tour.
    popup: { chapter: "map",
      screen: { ok: mapVisible, go: toMap }, ui: { more: false, mapPanel: false, mapPopup: true },
      target: $ => $(".cc-vp [data-popup]"), settle: 3,
      text: c => (c.mapPopup === "list" ? "popupList" : "popup"), variants: ["popup", "popupList"], side: "bottom",
      interactive: c => c.mapPopup === "list" },
    cluster: { chapter: "map", optional: true,
      screen: { ok: mapVisible, go: toMap }, ui: { more: false, mapPanel: false, mapPopup: false },
      target: ($, c, env) => env.marker(c, { group: true }), settle: 3, timeout: 3000,
      text: "cluster", side: "bottom" },

    // ⑦ Party & journeys — the party filter and what the dashed lines are
    party: { chapter: "party",
      screen: { ok: mapVisible, go: toMap }, ui: { more: false, mapPanel: false, mapPopup: false },
      target: $ => $(".cc-mapbar .cc-mapbtn"), text: "party", side: "bottom", align: "start", interactive: true,
      done: c => c.mapPanelOpen,
      perform: api => api.act("mapPanel", true) },
    partyRows: { chapter: "party",
      screen: { ok: mapVisible, go: toMap }, ui: { more: false, mapPanel: true },
      target: ($, c, env) => env.compact($("[data-tour=party-rows]"), $(".cc-mappanel .cc-partyrow")),
      text: "partyRows", side: c => (c.isMobile ? "bottom" : "right"), interactive: true },
    zoom: { chapter: "zoom",
      screen: { ok: mapVisible, go: toMap }, ui: { more: false, mapPanel: false, mapPopup: false },
      target: $ => $(".cc-zoom"), text: "zoom", side: "top", align: "start", interactive: true },

    // Search tour: an opened entry and its connections ("Show in Chronicle" filters the story by it)
    entry: { chapter: "links",
      screen: { ok: c => !!c.route.kind && c.route.kind !== "recap" && c.route.kind !== "at",
        go: c => (c.example.personId ? `#/${c.route.section === "map" ? "chronicle" : c.route.section}/character/${enc(c.example.personId)}` : null) },
      ui: { search: false, more: false },
      target: $ => $(".cc-detail .cc-actrow") || $("[data-tour=event-people]") || $(".cc-detail .cc-byline"),
      text: (c, el) => (el && el.matches(".cc-actrow") ? "entry" : "links"), variants: ["entry", "links"],
      side: c => (c.isWide ? "left" : "bottom"), interactive: true,
      done: (c, mem) => c.hash !== mem.hash },

    // Endings
    doneMain:   { final: true, text: "doneMain", nextLabel: "finish", more: true, ui: { more: false, search: false, mapPanel: false } },
    doneMap:    { final: true, text: "doneMap", nextLabel: "finishMap", more: true, ui: { more: false, mapPanel: false } },
    doneSearch: { final: true, text: "doneSearch", nextLabel: "finish", more: true, ui: { more: false, search: false } },
  };
  Object.keys(STEPS).forEach(id => { STEPS[id].id = id; });

  const TOURS = {
    // About six ideas (seven with the map in two parts): welcome, recap, Chronicle, connections, search, map, party.
    main:   ["welcome", "recap", "recapView", "sessions", "card", "links", "search", "searchType", "searchResults", "mapMore", "mapOpen", "marker", "popup", "party", "partyRows", "doneMain"],
    map:    ["marker", "popup", "cluster", "party", "partyRows", "zoom", "doneMap"],
    search: ["search", "searchType", "searchResults", "entry", "doneSearch"],
  };

  function variant(el, byTour, other) { const k = el && el.getAttribute && el.getAttribute("data-tour"); return (k && byTour[k]) || other; }

  // The steps that apply in this context (phones add "More"; no recorded session → Sessions instead of the recap).
  function plan(tourId, c) { return (TOURS[tourId] || []).map(id => STEPS[id]).filter(s => !s.when || s.when(c)); }

  // Progress counts ideas, not popovers: the sub-steps of one idea share its number.
  function progress(steps, step) {
    if (!step || !step.chapter) return null;
    const chapters = [...new Set(steps.map(s => s.chapter).filter(Boolean))];
    return { n: chapters.indexOf(step.chapter) + 1, total: chapters.length };
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
    const keys = new Set(["tour.next", "tour.prev", "tour.close", "tour.progress", "tour.progressAria", "tour.skip", "tour.more", "tour.try"]);
    (tourId ? TOURS[tourId] : Object.keys(STEPS)).map(id => STEPS[id]).forEach(s => {
      const texts = s.variants || (typeof s.text === "string" ? [s.text] : []);
      if (s.fallback && s.fallback.text) texts.push(s.fallback.text);
      texts.forEach(k => { keys.add(`tour.${k}T`); keys.add(`tour.${k}D`); });
      if (s.nextLabel) keys.add(`tour.${s.nextLabel}`);
    });
    return [...keys];
  }

  const escapeHtml = s => String(s == null ? "" : s).replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);

  // ── Progress: which tours were completed, whether the invitation was dismissed ──
  // Three separate keys: the version they refer to, the completed tours, the invitation. A newer
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
      // Without storage the invitation never nags (it could not be dismissed for good).
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
    let drv = null, run = null, seq = 0, syncQueued = false, clampQueued = false, probe = null;
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
      // The whole block when it leaves room for the popover; else its first row.
      compact(block, row) { return block && block.getBoundingClientRect().height <= win.innerHeight * 0.45 ? block : (row || block); },
    };

    // Waits for the element to exist, be visible and keep still for a few frames (layout, centring
    // and lazy panels have settled). Condition-based; the timeout only ends a wait for an element
    // that never comes (→ the step's fallback).
    function waitFor(resolve, frames, timeout, token) {
      return new Promise(done => {
        let last = null, key = "", still = 0, over = false;
        const timer = win.setTimeout(() => finish(null), timeout);
        function finish(v) { if (over) return; over = true; win.clearTimeout(timer); done(v); }
        (function tick() {
          if (over) return;
          if (token !== seq) return finish(null);
          let el = null; try { el = resolve(); } catch (e) { el = null; }
          if (el) {
            const r = el.getBoundingClientRect(), k = [r.left, r.top, r.width, r.height].map(Math.round).join(",");
            if (el === last && k === key) { if (++still >= frames) return finish(el); } else { last = el; key = k; still = 0; }
          } else { last = null; still = 0; }
          raf(tick);
        })();
      });
    }

    function ensure() {
      if (drv) return drv;
      drv = makeDriver({
        animate: !reduced(), duration: 260, smoothScroll: false,
        allowClose: false, allowKeyboardControl: false,         // Esc and ← → are handled by the page (tour.next/prev/stop)
        overlayClickBehavior: () => nudge(),                    // a tap outside never ends the tour by accident
        overlayColor: "#070402", overlayOpacity: 0.7, stagePadding: 6, stageRadius: 12, popoverOffset: 12,
        popoverClass: "cc-tour",
      });
      return drv;
    }

    const uiValue = (c, k) => (k === "more" ? c.moreOpen : k === "search" ? c.search.open : k === "mapPanel" ? c.mapPanelOpen : k === "mapPopup" ? !!c.mapPopup : undefined);
    function satisfied(step, c) {
      if (step.screen && !step.screen.ok(c)) return false;
      return !step.ui || Object.keys(step.ui).every(k => uiValue(c, k) === val(step.ui[k], c));
    }
    // Brings the app to the step's screen and panels; false when that is impossible (skip the step).
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

    async function show(i, dir, o) {
      if (!run) return;
      const token = ++seq, follow = !!(o && o.follow);
      run.busy = true;
      doc.body.classList.add("cc-tour-busy");                 // the popover waits, hidden, for the next screen
      for (;;) {
        if (!run || token !== seq) return;
        const steps = plan(run.id, app.ctx());
        if (i < 0) i = 0;
        if (i >= steps.length) return stop("done");
        const step = steps[i];
        if (step.skip && step.skip(app.ctx(), run, dir)) { i += dir || 1; continue; }
        if (step.reset) step.reset(run);
        if (!establish(step)) { i += dir || 1; continue; }
        if (step.prepare) step.prepare(api, app.ctx());
        let el = null, fallback = false;
        if (step.target) {
          el = await waitFor(() => step.target($, app.ctx(), env), step.settle || 2, step.timeout || 4000, token);
          if (!run || token !== seq) return;
          if (!el && step.optional) { i += dir || 1; continue; }
          if (!el) { fallback = !!step.fallback; el = fallback && step.fallback.target ? step.fallback.target($, app.ctx(), env) : null; }
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
      const tx = textOf(fb ? { text: step.fallback.text } : step, c, el, t);
      const left = run.el;
      if (el && !run.saved.has(el)) run.saved.set(el, snapshotAria(el));
      run.step = step; run.el = el || null; run.fallback = !!fb;
      if (!o.follow) { run.mem = { hash: c.hash }; run.repairs = 0; }
      if (el && step.remember && !fb) Object.assign(run, step.remember(el));
      const keep = !!val(step.keepFocus, c), quiet = o.follow || keep;
      const buttons = ["next", "close"].concat(idx > 0 && !step.final ? ["previous"] : []);
      drv.highlight({
        element: el || undefined,
        disableActiveInteraction: !val(step.interactive, c) || !!fb,
        popover: {
          title: escapeHtml(tx.title), description: escapeHtml(tx.body),
          side: val(step.side, c) || "bottom", align: val(step.align, c) || "start",
          showButtons: buttons, showProgress: !!prog, progressText: prog ? escapeHtml(t("tour.progress", prog)) : "",
          nextBtnText: escapeHtml(t(`tour.${step.nextLabel || "next"}`)), prevBtnText: escapeHtml(t("tour.prev")),
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
      if (quiet && !o.follow) app.say([prog ? t("tour.progressAria", prog) : "", tx.title, tx.body].filter(Boolean).join(". "));
    }

    function button(parent, label, fn, first) {
      const b = doc.createElement("button");
      b.type = "button"; b.className = "driver-popover-footer-btn cc-tour-alt"; b.textContent = label;
      b.addEventListener("click", e => { e.preventDefault(); fn(); });
      if (first && parent.firstChild) parent.insertBefore(b, parent.firstChild); else parent.appendChild(b);
      return b;
    }
    function decorate(p, step, c, o) {
      const t = o.t, w = p.wrapper;
      w.setAttribute("lang", (t.meta && t.meta.htmlLang) || "");
      p.closeButton.textContent = "✕";
      p.closeButton.setAttribute("aria-label", t("tour.close")); p.closeButton.title = t("tour.close");
      w.appendChild(p.closeButton);                            // last in the tab order; still drawn top-right
      if (o.prog) p.progress.setAttribute("aria-label", t("tour.progressAria", o.prog));
      const name = step.tryName && step.tryName(c);
      if (name && !c.search.q.trim()) {
        const b = button(p.description, t("tour.try", { name }), () => { if (!run) return; app.act("searchQ", name, run); next(); });
        b.className = "cc-tour-try";
      }
      if (step.skipButton) button(p.footerButtons, t("tour.skip"), () => stop("close"), true);
      if (step.more) button(p.footerButtons, t("tour.more"), () => stop("more"), true);
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
      clampSoon();
    }

    // A tap on the dimmed page: the tour stays, the popover's main button is pointed out.
    function nudge() {
      const p = doc.querySelector(".driver-popover.cc-tour"); if (!p) return;
      const btn = p.querySelector(".driver-popover-next-btn"); if (btn) btn.focus({ preventScroll: true });
      if (reduced()) return;
      p.classList.remove("cc-tour-nudge"); void p.offsetWidth; p.classList.add("cc-tour-nudge");
    }

    // Keep the popover inside the visible area: safe areas (notches, home bar) and the part of the
    // screen the virtual keyboard leaves (visualViewport). Driver.js places it; this only nudges.
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
      const r = p.getBoundingClientRect(); if (!r.width) return;
      const s = insets(), vv = win.visualViewport;
      const W = win.innerWidth, H = vv ? Math.min(win.innerHeight, vv.offsetTop + vv.height) : win.innerHeight;
      const L = s.left + 8, R = W - s.right - 8, T = s.top + 8, B = H - s.bottom - 8;
      let dx = 0, dy = 0;
      if (r.right > R) dx = R - r.right;
      if (r.left + dx < L) dx = L - r.left;
      if (r.bottom > B) dy = B - r.bottom;
      if (r.top + dy < T) dy = T - r.top;
      if (dx || dy) p.style.translate = `${Math.round(dx)}px ${Math.round(dy)}px`;
    }
    function clampSoon() { if (clampQueued) return; clampQueued = true; raf(() => raf(clamp)); }

    function refresh() { if (run && !run.busy && drv) { drv.refresh(); clampSoon(); } }
    const onScroll = () => refresh();                         // the app scrolls inside its panes, not the window
    const onViewport = () => refresh();

    function start(tourId) {
      if (!TOURS[tourId] || typeof makeDriver !== "function") return false;
      if (run) stop("restart", { silent: true });
      run = { id: tourId, step: null, el: null, mem: {}, busy: false, pin: null, searchedAway: false, saved: new Map() };
      ensure();
      doc.addEventListener("scroll", onScroll, true);
      if (win.visualViewport) win.visualViewport.addEventListener("resize", onViewport);
      show(0, 1);
      return true;
    }
    function next() {
      if (!run || run.busy || !run.step) return;
      const step = run.step;
      if (step.final) return stop("done");
      if (step.perform && !run.fallback) step.perform(api, app.ctx(), run.el);
      go(1);
    }
    function prev() { if (run && !run.busy && run.step) go(-1); }
    function go(dir) {
      const steps = plan(run.id, app.ctx());
      let i = steps.indexOf(run.step);
      if (i < 0) i = afterIndex(steps, run.step) - (dir > 0 ? 1 : 0);
      show(i + dir, dir);
    }
    // Where a step that no longer applies (e.g. "More" after rotating to a tablet) would have been.
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
      // The screen changed under the step (rare: the highlighted element can only do the step's
      // own action): set it up again — a few times at most, never a loop.
      if (!satisfied(step, c) && (run.repairs = (run.repairs || 0) + 1) <= 6) return show(i, 1, { follow: true });
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
      run = null; seq++; syncQueued = false;
      doc.removeEventListener("scroll", onScroll, true);
      if (win.visualViewport) win.visualViewport.removeEventListener("resize", onViewport);
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
