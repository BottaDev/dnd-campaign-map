// Interactive tours (js/chronicle-tour.js, on top of Driver.js): what each tour teaches and in which
// order, "Paso N de M", which action moves each step on, which screen each step needs, how steps adapt
// to what the campaign holds (never skipped in silence), the texts in both languages, the versioned
// onboarding keys, the runtime against a stand-in Driver.js, and how index.html wires it all.
// The live behaviour (real clicks, the lazy map, phones) is in tests/browser/smoke.mjs.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { Model, I18N, ROOT, buildReal, readText } = require("./helpers");
const Tour = require("../js/chronicle-tour.js");

const html = readText("index.html");
const ids = steps => steps.map(s => s.id);
const memStorage = init => {
  const s = { ...(init || {}) };
  return { getItem: k => (k in s ? s[k] : null), setItem: (k, v) => { s[k] = String(v); }, removeItem: k => { delete s[k]; }, _s: s };
};
// The context index.html builds for the steps (Component._tourCtx).
const ctx = over => ({
  route: { section: "chronicle", kind: null, id: null }, hash: "#/chronicle", isMobile: false, isWide: true,
  moreOpen: false, mapPanelOpen: false, mapPopup: null, search: { open: false, q: "" }, latest: 12,
  hasEvents: true, hasSessions: true, hasQuests: true, mapHasMarkers: true,
  example: { eventId: "s12_07", personId: "sorfon", personName: "Sorfon", mapEventId: "s12_07" },
  labels: { app: "Crónica de Exandria", party: "Bund Der Vier", partyFilters: "Grupo y filtros", inChronicle: "Ver en la Crónica", keys: "Ctrl+K" },
  ...over,
});
const at = (hash, over) => {
  const [section, kind = null, id = null] = hash.replace(/^#\//, "").split("/");
  return ctx({ route: { section, kind, id }, hash, ...over });
};
const PHONE = { isMobile: true, isWide: false };
const MAIN = ["sections", "chronicle", "sessions", "quests", "map", "mapCard", "find", "help"];

test("1 · main tour: eight steps, one idea each — sections, Chronicle, Sessions, Quests, the map (marker + card), search, help last", () => {
  for (const c of [ctx(), ctx(PHONE), ctx({ isMobile: false, isWide: false })]) {
    const steps = Tour.plan("main", c);
    assert.deepEqual(ids(steps), MAIN, "the same eight steps on every screen size");
    steps.forEach((s, i) => assert.deepEqual(Tour.progress(steps, s), { n: i + 1, total: 8 }, `${s.id}: Paso ${i + 1} de 8`));
    assert.equal(steps[steps.length - 1].final, true, "help is the last thing the visitor sees");
    assert.equal(steps.filter(s => s.final).length, 1);
  }
  assert.equal(Tour.progress(Tour.plan("main", ctx()), Tour.STEPS.marker), null, "a step outside the plan has no number");
  assert.equal(Tour.VERSION, 3, "the new tour is offered again to visitors of the previous one");
});

test("2 · Sessions is always explained; every step adapts to what the campaign holds instead of disappearing", () => {
  const S = Tour.STEPS, el = sel => ({ matches: s => s.split(",").map(x => x.trim()).includes(sel) });
  // The old tour showed Sessions only when no session existed: now it is in every plan.
  for (const c of [ctx(), ctx({ latest: null, hasSessions: false }), ctx({ hasEvents: false, hasSessions: false, hasQuests: false })])
    assert.ok(ids(Tour.plan("main", c)).includes("sessions"));
  assert.equal(S.sessions.text(ctx(), el(".cc-scard")), "sessions", "a real session as the example");
  assert.equal(S.sessions.text(ctx({ hasSessions: false }), el(".cc-sechead")), "sessionsNone", "the section explained, nothing invented");
  assert.equal(S.chronicle.text(ctx(), el(".cc-group")), "chronicle");
  assert.equal(S.chronicle.text(ctx(), el(".cc-card")), "chronicle");
  assert.equal(S.chronicle.text(ctx({ hasEvents: false }), el(".cc-empty")), "chronicleNone");
  assert.equal(S.quests.text(ctx(), el(".cc-statusbar")), "quests");
  assert.equal(S.quests.text(ctx({ hasQuests: false }), el(".cc-sechead")), "questsNone");
  assert.equal(S.quests.interactive(ctx()), true, "the status filter can be used");
  assert.equal(S.quests.interactive(ctx({ hasQuests: false })), false);
  // No located event: no "what a marker opens" — decided before the tour, so the count stays true.
  const noMap = Tour.plan("main", ctx({ mapHasMarkers: false }));
  assert.deepEqual(ids(noMap), MAIN.filter(id => id !== "mapCard"));
  assert.deepEqual(Tour.progress(noMap, S.map), { n: 5, total: 7 });
  assert.equal(S.map.fallback.text(ctx({ mapHasMarkers: false })), "mapEmpty");
  assert.equal(S.map.fallback.text(ctx()), "mapNone", "markers exist but none is in view");
});

test("3 · never skipped in silence: every step that depends on an element or an example has a fallback", () => {
  for (const [id, s] of Object.entries(Tour.STEPS)) {
    assert.ok(!("optional" in s), `${id}: no optional steps (they vanished without a word)`);
    const usesExample = s.screen && /example/.test(String(s.screen.go));
    const opens = s.ui && "mapPopup" in s.ui && s.ui.mapPopup === true;
    const mapTarget = /marker|data-popup/.test(String(s.target));
    if (usesExample || opens || mapTarget) assert.ok(s.fallback, `${id} has a fallback`);
    if (s.fallback && s.fallback.text) {
      const texts = s.fallback.variants || [s.fallback.text];
      assert.ok(texts.every(k => typeof k === "string"), `${id}: fallback texts listed`);
    }
  }
  // Structural steps target what is always on screen, ending in the section's own heading.
  assert.match(String(Tour.STEPS.chronicle.target), /\.cc-chead/);
  assert.match(String(Tour.STEPS.sessions.target), /\.cc-sechead/);
  assert.match(String(Tour.STEPS.quests.target), /\.cc-sechead/);
});

test("4 · help is the last step: the real “?” in the top bar; on phones More → Help (the sheet opens), never a hidden button", () => {
  const H = Tour.STEPS.help, seen = [], $ = sel => { seen.push(sel); return null; };
  H.target($, ctx()); H.target($, ctx(PHONE));
  assert.deepEqual(seen, [".cc-top [data-tour=help]", ".cc-sheet [data-tour=help]"]);
  assert.equal(H.ui.more(ctx()), false);
  assert.equal(H.ui.more(ctx(PHONE)), true, "phones: the More sheet open, its Help highlighted");
  assert.equal(H.text(ctx()), "help");
  assert.equal(H.text(ctx(PHONE)), "helpPhone");
  assert.equal(H.more, true, "“Ver más tutoriales” goes straight to the help centre");
  // The first step also adapts: the top tabs, or the bottom bar with “Más”.
  const S = Tour.STEPS.sections, s2 = [];
  S.target(sel => { s2.push(sel); return null; }, ctx()); S.target(sel => { s2.push(sel); return null; }, ctx(PHONE));
  assert.deepEqual(s2, [".cc-tabs", ".cc-bottom"]);
  assert.equal(S.text(ctx(PHONE)), "sectionsPhone");
});

test("5 · map and search tours reuse the same step logic; every tour counts every step and ends on a final one", () => {
  const S = Tour.STEPS;
  assert.deepEqual(Tour.TOURS.map, ["marker", "popup", "cluster", "party", "partyRows", "zoom", "doneMap"]);
  assert.deepEqual(Tour.TOURS.search, ["search", "searchType", "searchResults", "entry", "doneSearch"]);
  ["target", "done", "perform", "remember", "screen", "ui"].forEach(k => assert.equal(S.map[k], S.marker[k], `map/marker share ${k}`));
  ["target", "screen", "ui", "interactive", "when"].forEach(k => assert.equal(S.mapCard[k], S.popup[k], `mapCard/popup share ${k}`));
  const mapSteps = Tour.plan("map", at("#/map"));
  assert.deepEqual(Tour.progress(mapSteps, mapSteps[0]), { n: 1, total: 7 });
  assert.deepEqual(Tour.progress(Tour.plan("search", ctx()), S.entry), { n: 4, total: 5 });
  for (const id of Object.keys(Tour.TOURS)) assert.ok(S[Tour.TOURS[id].slice(-1)[0]].final, `${id} ends on a final step`);
  assert.equal(S.cluster.fallback.text, "clusterNone", "no group in view: explained, not skipped");
});

test("6 · each step moves on when the visitor does the real thing", () => {
  const S = Tour.STEPS, mem = { hash: "#/chronicle/character/sorfon" }, run = {};
  assert.equal(S.map.done(at("#/map")), false);
  assert.equal(S.map.done(at("#/map", { mapPopup: "sel" })), true, "a marker was tapped");
  assert.equal(S.marker.done(at("#/map", { mapPopup: "list" })), true);
  assert.equal(S.party.done(at("#/map", { mapPanelOpen: true })), true, "the party panel opened");
  assert.equal(S.search.done(ctx({ search: { open: true, q: "" } })), true, "the search opened");
  assert.equal(S.searchResults.done(ctx({ search: { open: true, q: "Mortis" } }), mem, run), false);
  assert.equal(S.searchResults.done(ctx({ search: { open: false, q: "Mortis" } }), mem, run), true, "a result was opened");
  assert.equal(run.searchedAway, true);
  assert.equal(S.searchResults.skip(ctx(), run, 1), true, "Enter on a result skips the results step");
  assert.equal(S.searchResults.skip(ctx(), run, -1), false, "but Anterior still reaches it");
  assert.equal(S.entry.done(at("#/chronicle/character/mortis"), mem), true, "a link was followed");
  // Look-and-learn steps have no action to wait for: “Siguiente” moves on (and the tour navigates).
  ["sections", "chronicle", "sessions", "quests", "find", "help"].forEach(id => assert.equal(S[id].done, undefined, id));
});

test("7 · each step brings its own screen (route + panels), so Siguiente/Anterior work from anywhere", () => {
  const S = Tour.STEPS;
  for (const id of ["sections", "chronicle", "find", "help"]) {
    assert.equal(S[id].screen.ok(at("#/chronicle")), true, `${id} on the Chronicle's home`);
    assert.equal(S[id].screen.ok(at("#/chronicle/event/s12_07")), false, `${id}: not over an open entry`);
    assert.equal(S[id].screen.go(ctx()), "#/chronicle");
  }
  assert.equal(S.sessions.screen.go(ctx()), "#/sessions");
  assert.equal(S.quests.screen.go(ctx()), "#/quests");
  assert.equal(S.map.screen.go(ctx()), "#/map");
  assert.equal(S.map.screen.ok(at("#/map/event/s12_07", { isWide: true })), true, "the map stays beside the entry on wide screens");
  assert.equal(S.map.screen.ok(at("#/map/event/s12_07", { isWide: false })), false, "an entry covers the map below 1024px");
  assert.equal(S.map.screen.ok(at("#/map/at/s12_07", { isWide: false })), true);
  assert.deepEqual(S.map.ui, { more: false, search: false, mapPanel: false, mapPopup: false });
  assert.equal(S.mapCard.ui.mapPopup, true);
  assert.deepEqual(S.find.ui, { search: false, more: false });
  assert.equal(S.partyRows.ui.mapPanel, true);
  assert.equal(S.entry.screen.go(at("#/map")), "#/chronicle/character/sorfon");
  assert.equal(S.entry.screen.go(ctx({ example: { personId: null } })), null, "no example → its fallback, not a fake page");
  assert.equal(S.mapCard.interactive(ctx({ mapPopup: "sel" })), false, "“Leer entrada” does not leave the map mid-tour");
  assert.equal(S.mapCard.interactive(ctx({ mapPopup: "list" })), true, "a list can be used to pick an event");
  assert.ok(S.map.settle >= 3 && S.map.timeout >= 3000, "waits for the map to settle");
  assert.equal(typeof S.map.none, "function", "…but not for a marker that cannot come (every event filtered out)");
  const vp = markers => ({ querySelectorAll: () => markers.map(ev => ({ getAttribute: () => ev })) });
  assert.equal(S.map.none(() => vp([])), true);
  assert.equal(S.map.none(() => vp(["a"])), false);
  assert.equal(S.map.none(() => null), false, "no map yet: keep waiting");
  assert.equal(S.cluster.none(() => vp(["a", "b"])), true, "no marker holds several events");
  assert.equal(S.cluster.none(() => vp(["a", "b c"])), false);
  assert.deepEqual(S.map.remember({ getAttribute: () => "a b" }), { pin: ["a", "b"] });
});

test("8 · every text a tour shows exists in both languages, short, with every {param} filled; consistent controls", () => {
  const keys = Tour.textKeys();
  assert.ok(keys.length > 70);
  for (const code of ["es-AR", "en"]) {
    const t = I18N.createTranslator(code);
    for (const k of keys) {
      const raw = I18N.get(I18N.dicts[code], k);
      assert.equal(typeof raw, "string", `${code} ${k}`);
      const v = t(k, { ...ctx().labels, name: "Sorfon", n: 3, total: 8 });
      assert.ok(!/\{\w+\}/.test(v), `${code} ${k}: unfilled parameter in "${v}"`);
      if (/T$/.test(k)) assert.ok(v.length <= 40, `${code} ${k}: title too long (${v.length})`);
      else if (/D$/.test(k)) assert.ok(v.length <= 190, `${code} ${k}: ${v.length} chars — keep it to one or two sentences`);
      else assert.ok(v.length <= 26, `${code} ${k}: button/label too long`);
    }
    // Proper names are never translated; the main tour names the real controls.
    assert.ok(t("tour.sectionsD", ctx().labels).includes("Bund Der Vier"));
  }
  const es = I18N.createTranslator("es-AR"), en = I18N.createTranslator("en");
  assert.deepEqual(["next", "prev", "finish", "skip", "more"].map(k => es(`tour.${k}`)), ["Siguiente", "Anterior", "Finalizar", "Omitir tutorial", "Ver más tutoriales"]);
  assert.deepEqual(["next", "prev", "finish", "skip", "more"].map(k => en(`tour.${k}`)), ["Next", "Previous", "Finish", "Skip tour", "More tutorials"]);
  assert.equal(es("tour.progress", { n: 3, total: 8 }), "Paso 3 de 8");
  assert.equal(en("tour.progress", { n: 3, total: 8 }), "Step 3 of 8");
  assert.equal(es("tour.helpT"), "¿Necesitás ayuda otra vez?");
  assert.match(es("tour.helpD"), /botón de ayuda \(\?\)/);
  assert.match(es("tour.helpPhoneD"), /«Más» → «Ayuda»/);
  assert.match(es("tour.helpD"), /mapa y de la búsqueda/, "the specific tours are mentioned");
  assert.match(es("tour.mapCardD"), /¿Cómo funciona\?/, "the map's own tour is pointed out");
  assert.match(es("tour.sectionsPhoneD"), /«Más»/);
  // The old, longer tour's steps are gone.
  for (const gone of ["welcome", "recap", "recapView", "card", "mapMore", "mapOpen", "doneMain"]) assert.equal(Tour.STEPS[gone], undefined, gone);
  for (const gone of ["start", "finishMap", "close", "progressAria", "welcomeT", "doneMainT"]) assert.equal(I18N.get(I18N.dicts["es-AR"].tour, gone), undefined, `tour.${gone}`);
});

test("9 · onboarding progress: separate versioned keys; completion ≠ dismissed welcome; a new version offers it again", () => {
  const st = memStorage({ "chronicle-lang": "en", "chronicle-favorites": "{\"v\":1,\"items\":[]}", "chronicle-tutorial-seen": "done" });
  const p = Tour.createProgress(st);
  assert.equal(p.showInvite(), true, "first visit");
  p.migrate();
  assert.equal(st._s["chronicle-tutorial-seen"], undefined, "the old guide's flag is superseded");
  p.complete("map");
  assert.equal(p.showInvite(), true, "another tour does not hide the main welcome");
  p.complete("main");
  assert.equal(p.showInvite(), false);
  assert.deepEqual(JSON.parse(st._s[Tour.KEYS.completed]), ["map", "main"]);
  assert.equal(st._s[Tour.KEYS.version], String(Tour.VERSION));
  assert.equal(st._s[Tour.KEYS.invite], undefined, "the welcome is its own key");
  assert.equal(st._s["chronicle-lang"], "en", "other preferences untouched");
  assert.ok(st._s["chronicle-favorites"], "favourites untouched");

  const q = Tour.createProgress(memStorage());
  q.dismissInvite();
  assert.equal(q.showInvite(), false, "“Ahora no” is remembered");
  assert.equal(q.isCompleted("main"), false, "…and is not a completion");

  const old = Tour.createProgress(memStorage({ [Tour.KEYS.version]: String(Tour.VERSION - 1), [Tour.KEYS.completed]: "[\"main\"]", [Tour.KEYS.invite]: "dismissed" }));
  assert.equal(old.showInvite(), true, "a newer onboarding is offered again");
  assert.equal(old.isCompleted("main"), false);

  const blocked = Tour.createProgress({ getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); }, removeItem() {} });
  assert.equal(blocked.showInvite(), false, "no storage: never nags");
  assert.doesNotThrow(() => { blocked.complete("main"); blocked.dismissInvite(); blocked.migrate(); });
  assert.equal(blocked.isCompleted("main"), true, "remembered for the visit");
});

test("10 · the examples come from the campaign itself", () => {
  const m = buildReal("es-AR"), ex = Model.guideExamples(m), last = Model.latestSession(m);
  assert.ok(last && last.no >= 1, "a recorded session");
  assert.ok(m.eventById.get(ex.event.id) && ex.event.characterIds.length && ex.event.questIds.length, "a well-connected event");
  assert.equal(ex.person.kind, "pc", "a party member to search for");
  assert.ok(Model.searchAll(m, ex.person.name).groups.length >= 3, "…whose name finds several kinds of entry");
  assert.ok(ex.mapEvent.hasCoords, "an event with a marker (the card shown when no marker is in view)");
  assert.equal(Tour.escapeHtml("<b>&\"'"), "&lt;b&gt;&amp;&quot;&#39;", "texts reach Driver.js's innerHTML escaped");
});

// ── The runtime against a stand-in Driver.js and DOM ──────────────────────────
// Elements are plain objects with a rect; the "page" is what each screen shows. The stand-in driver
// logs every highlight (a park = no element, no popover) and renders the popover on a later tick.
class El {
  constructor(name, { rect = [40, 200, 300, 60], is = [], attrs = {}, q = {} } = {}) {
    Object.assign(this, { name, rect, is, attrs: { ...attrs }, q, kids: [], isConnected: true, style: {}, disabled: false, hidden: false, textContent: "" });
    this._cls = new Set();
  }
  get classList() { const c = this._cls; return { add: (...a) => a.forEach(x => c.add(x)), remove: (...a) => a.forEach(x => c.delete(x)), contains: x => c.has(x) }; }
  set className(v) { this._cls = new Set(String(v).split(/\s+/).filter(Boolean)); }
  get className() { return [...this._cls].join(" "); }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  removeAttribute(k) { delete this.attrs[k]; }
  getBoundingClientRect() { const [left, top, width, height] = this.rect; return { left, top, width, height, right: left + width, bottom: top + height }; }
  matches(sel) { return sel.split(",").some(s => this.is.includes(s.trim())); }
  closest() { return null; }
  appendChild(c) { this.kids = this.kids.filter(x => x !== c).concat(c); return c; }
  insertBefore(c, ref) { this.kids = this.kids.filter(x => x !== c); const i = this.kids.indexOf(ref); this.kids.splice(i < 0 ? this.kids.length : i, 0, c); return c; }
  get firstChild() { return this.kids[0] || null; }
  querySelectorAll(sel) { return sel === "button" ? this.kids.flatMap(k => [k, ...k.kids]).filter(k => k.name === "button") : (this.q[sel] || []); }
  addEventListener() {}
  focus() {}
}
function harness({ isMobile = false, events = true, sessions = true, quests = true, markers = true, mapHasMarkers = true, deferPopover = false } = {}) {
  const s = { hash: "#/chronicle", more: false, search: false, mapPanel: false, popup: null };
  const log = [], pending = [];
  const E = {
    tabs: new El("tabs"), bottom: new El("bottom"), group: new El("group", { is: [".cc-group"] }), card: new El("card", { is: [".cc-card"] }),
    empty: new El("empty", { is: [".cc-empty"] }), chead: new El("chead"), scard: new El("scard", { is: [".cc-scard"] }),
    sechead: new El("sechead", { is: [".cc-sechead"] }), statusbar: new El("statusbar", { is: [".cc-statusbar"] }),
    searchbtn: new El("searchbtn"), helpBtn: new El("help?"), sheetHelp: new El("More→Help"),
    marker: new El("marker", { rect: [630, 400, 26, 26], attrs: { "data-ev": "s12_07", "data-kind": "pin" } }),
    mapbar: new El("mapbar", { rect: [0, 60, 1280, 50] }), zoom: new El("zoom", { rect: [1200, 700, 60, 90] }), popupEl: new El("popup", { rect: [560, 430, 300, 160] }),
  };
  E.vp = new El("map", { rect: [0, 60, 1280, 740] });
  const page = () => {
    const sec = s.hash.split("/")[1], home = s.hash === "#/chronicle", onMap = sec === "map";
    E.vp.q = { ".cc-marker": markers ? [E.marker] : [] };
    return {
      ".cc-tabs": isMobile ? [] : [E.tabs], ".cc-bottom": isMobile ? [E.bottom] : [],
      ".cc-top .cc-searchbtn": [E.searchbtn], ".cc-searchbtn": [E.searchbtn],
      ".cc-top [data-tour=help]": isMobile ? [] : [E.helpBtn], ".cc-sheet [data-tour=help]": isMobile && s.more ? [E.sheetHelp] : [],
      ...(home ? { ".cc-group": events ? [E.group] : [], ".cc-evlist .cc-card": events ? [E.card] : [], ".cc-empty": events ? [] : [E.empty], ".cc-chead": [E.chead] } : {}),
      ...(sec === "sessions" ? { ".cc-list .cc-scard": sessions ? [E.scard] : [], ".cc-sechead": [E.sechead] } : {}),
      ...(sec === "quests" ? { ".cc-statusbar": [E.statusbar], ".cc-sechead": [E.sechead] } : {}),
      ...(onMap ? { ".cc-vp": [E.vp], ".cc-mapbar": [E.mapbar], ".cc-zoom": [E.zoom], ".cc-vp [data-popup]": s.popup ? [E.popupEl] : [] } : {}),
    };
  };
  const doc = {
    querySelectorAll: sel => page()[sel] || [], querySelector: sel => (page()[sel] || [])[0] || null,
    body: new El("body"), createElement: tag => new El(tag), addEventListener() {}, removeEventListener() {}, activeElement: null,
  };
  const win = { document: doc, requestAnimationFrame: cb => setTimeout(cb, 0), setTimeout, clearTimeout, matchMedia: () => ({ matches: true }),
    innerWidth: isMobile ? 375 : 1280, innerHeight: isMobile ? 812 : 820, addEventListener() {}, removeEventListener() {}, getComputedStyle: () => ({}) };
  const driver = () => {
    let active = false;
    return {
      highlight(step) {
        active = true;
        const p = step.popover;
        log.push(p ? { el: step.element ? step.element.name : null, title: p.title, text: p.description, progress: p.progressText, buttons: p.showButtons, next: p.nextBtnText, inert: !!step.disableActiveInteraction } : { park: true });
        const render = () => {
          if (p) {
            const pop = { wrapper: new El("div"), title: new El("header"), description: new El("div"), footer: new El("footer"), footerButtons: new El("span"),
              progress: new El("span"), nextButton: new El("button"), previousButton: new El("button"), closeButton: new El("button") };
            pop.wrapper.kids = [pop.closeButton, pop.title, pop.description, pop.footer]; pop.footer.kids = [pop.progress, pop.footerButtons];
            p.onPopoverRender(pop);
            log[log.length - 1].skip = pop.closeButton.textContent;
          }
          if (step.onHighlighted) step.onHighlighted();
        };
        if (deferPopover && p) pending.push(render); else setTimeout(render, 0);
      },
      isActive: () => active, refresh() {}, destroy() { active = false; },
    };
  };
  const T = I18N.createTranslator("es-AR"), ended = [];
  const app = {
    t: () => T,
    ctx: () => at(s.hash, { isMobile, isWide: !isMobile, moreOpen: s.more, mapPanelOpen: s.mapPanel, mapPopup: s.hash.startsWith("#/map") ? s.popup : null,
      search: { open: s.search, q: "" }, hasEvents: events, hasSessions: sessions, hasQuests: quests, mapHasMarkers }),
    go: hash => { log.push({ go: hash }); s.hash = hash; },
    act: (name, value) => {
      log.push({ act: name, value });
      if (name === "more") s.more = value; else if (name === "search") s.search = value; else if (name === "mapPanel") s.mapPanel = value;
      else if (name === "mapPopup") { if (value && !mapHasMarkers) return false; s.popup = value ? "sel" : null; }
      return true;
    },
    say() {}, ended: info => ended.push(info),
  };
  const runner = Tour.createRunner({ driver, app, window: win });
  const shown = () => log.filter(x => x.title);
  const until = async (fn, what) => { for (let i = 0; i < 400; i++) { if (fn()) return; await new Promise(r => setTimeout(r, 2)); } throw new Error(`timed out waiting for ${what}`); };
  // Waits for the next step's popover to be shown and its buttons usable.
  const next = async () => { const n = shown().length; runner.next(); await until(() => shown().length > n && log[log.length - 1].skip !== undefined, "the next popover"); return shown().slice(-1)[0]; };
  return { runner, log, s, E, shown, until, next, ended, pending, start: async id => { runner.start(id || "main"); await until(() => shown().length && log[log.length - 1].skip !== undefined, "the first popover"); return shown()[0]; } };
}

test("11 · runtime: “Siguiente” walks the eight steps on the real elements, “Paso N de 8”, consistent buttons, the end completes it", async () => {
  const h = harness();
  const steps = [await h.start()], n0 = h.log.length;
  h.runner.prev();                                                     // ← on the first step
  await new Promise(r => setTimeout(r, 20));
  assert.equal(h.log.length, n0, "nothing before the first step: nothing happens");
  for (let i = 1; i < 8; i++) steps.push(await h.next());
  assert.deepEqual(steps.map(x => x.el), ["tabs", "group", "scard", "statusbar", "marker", "popup", "searchbtn", "help?"]);
  assert.deepEqual(steps.map(x => x.progress), [1, 2, 3, 4, 5, 6, 7, 8].map(n => `Paso ${n} de 8`));
  assert.deepEqual(steps[0].buttons, ["next", "close"], "no Anterior on the first step");
  assert.deepEqual(steps[3].buttons, ["next", "close", "previous"]);
  assert.deepEqual(steps[7].buttons, ["next", "previous"], "no “Omitir tutorial” on the last step");
  assert.deepEqual(steps.map(x => x.next), [...Array(7).fill("Siguiente"), "Finalizar"]);
  assert.ok(steps.slice(0, 7).every(x => x.skip === "Omitir tutorial"), "“Omitir tutorial” on every other step");
  assert.equal(steps[7].title, "¿Necesitás ayuda otra vez?");
  assert.equal(steps[2].text, I18N.createTranslator("es-AR")("tour.sessionsD"), "Sessions explained with a real session");
  assert.equal(steps[1].inert, true, "look-and-learn steps keep the page still");
  assert.equal(steps[3].inert, false, "the quests' status filter can be used");
  h.runner.next();
  await h.until(() => h.ended.length, "the end");
  assert.deepEqual(h.ended[0], { id: "main", completed: true, reason: "done", step: "help" });
});

test("12 · runtime: between screens the spotlight closes before the page changes; the visitor's own tap moves on without it", async () => {
  const h = harness();
  await h.start();
  await h.next();                                                      // the Chronicle: same screen as the sections
  await h.next();                                                      // → Sessions
  const i = h.log.findIndex(x => x.go === "#/sessions");
  assert.ok(i > 0 && h.log[i - 1].park, "parked (whole page dimmed, no popover), then navigated");
  const iTabs = h.log.findIndex(x => x.el === "tabs"), iGroup = h.log.findIndex(x => x.el === "group");
  assert.ok(!h.log.slice(iTabs, iGroup).some(x => x.park || x.go), "same screen: straight from one element to the next");
  await h.next(); await h.next();                                      // Quests → the map (a marker)
  const before = h.log.length;
  h.s.popup = "sel"; h.runner.sync();                                  // the visitor taps the marker
  await h.until(() => { const l = h.shown().slice(-1)[0]; return l.el === "popup" && l.skip !== undefined; }, "the card step");
  assert.ok(!h.log.slice(before).some(x => x.park || x.go), "followed the tap: no park, no navigation");
  const card = h.shown().slice(-1)[0];
  assert.equal(card.progress, "Paso 6 de 8");
  // Anterior from the card: the card closes and the marker is highlighted again.
  const n = h.shown().length; h.runner.prev();
  await h.until(() => h.shown().length > n, "the map step again");
  assert.equal(h.shown().slice(-1)[0].el, "marker");
  assert.ok(h.log.some(x => x.act === "mapPopup" && x.value === false), "the card was closed for it");
  h.runner.stop("close");
  assert.deepEqual(h.ended[0], { id: "main", completed: false, reason: "close", step: "map" });
});

test("13 · runtime: “Siguiente” does nothing until the step's popover is there (no flying through steps)", async () => {
  const h = harness({ deferPopover: true });
  h.runner.start("main");
  await h.until(() => h.pending.length === 1, "the first highlight");
  h.runner.next(); h.runner.next();
  await new Promise(r => setTimeout(r, 20));
  assert.equal(h.log.filter(x => x.title).length, 1, "still the first step");
  assert.ok(!h.log.some(x => x.go), "no navigation either");
  h.pending.shift()();                                                // the popover appears
  h.runner.next();
  await h.until(() => h.pending.length === 1, "the second highlight");
  assert.equal(h.log.filter(x => x.title)[1].el, "group");
  h.runner.stop("close");
});

test("14 · runtime: content-dependent steps — no markers in view, no located events, no sessions, a phone", async () => {
  // Markers exist but none is in view: the whole map with words for it, and “Siguiente” still opens a real card.
  let h = harness({ markers: false });
  await h.start(); for (let i = 0; i < 4; i++) await h.next();
  let step = h.shown().slice(-1)[0];
  assert.deepEqual([step.el, step.title, step.inert], ["map", "El mapa", true]);
  assert.equal(step.text, I18N.createTranslator("es-AR")("tour.mapNoneD"));
  step = await h.next();
  assert.deepEqual([step.el, step.progress], ["popup", "Paso 6 de 8"], "the card of the campaign's example event");
  h.runner.stop("close");
  // No located event at all: seven steps, the map explained, the search right after.
  h = harness({ markers: false, mapHasMarkers: false });
  await h.start(); for (let i = 0; i < 4; i++) await h.next();
  step = h.shown().slice(-1)[0];
  assert.deepEqual([step.el, step.progress, step.text], ["map", "Paso 5 de 7", I18N.createTranslator("es-AR")("tour.mapEmptyD")]);
  assert.equal((await h.next()).el, "searchbtn");
  h.runner.stop("close");
  // No session and no event: the Chronicle and Sessions are still explained, on their headings.
  h = harness({ events: false, sessions: false });
  await h.start();
  step = await h.next();
  assert.deepEqual([step.el, step.text], ["empty", I18N.createTranslator("es-AR")("tour.chronicleNoneD")]);
  step = await h.next();
  assert.deepEqual([step.el, step.title, step.progress], ["sechead", "Sesiones", "Paso 3 de 8"]);
  assert.equal(step.text, I18N.createTranslator("es-AR")("tour.sessionsNoneD"));
  h.runner.stop("close");
  // A phone: the bottom bar with “Más” first; help last, in the opened More sheet.
  h = harness({ isMobile: true });
  const first = await h.start();
  assert.deepEqual([first.el, first.text], ["bottom", I18N.createTranslator("es-AR")("tour.sectionsPhoneD", { app: "Crónica de Exandria", party: "Bund Der Vier" })]);
  for (let i = 0; i < 7; i++) await h.next();
  step = h.shown().slice(-1)[0];
  assert.equal(step.el, "More→Help");
  assert.ok(h.log.some(x => x.act === "more" && x.value === true), "the More sheet was opened for it");
  assert.match(step.text, /«Más» → «Ayuda»/);
  h.runner.stop("close");
});

test("15 · index.html: tours are optional, own one history entry, keep the visitor's history and context", () => {
  const mount = html.slice(html.indexOf("componentDidMount(){"), html.indexOf("componentDidUpdate(){"));
  assert.ok(!/startTour\(|\.start\(/.test(mount), "never started by itself (the welcome only offers it)");
  assert.match(html, /history\.pushState\(\{ccTour:id\},"",location\.href\)/, "one history entry per tour");
  assert.match(html, /navigate\(hash,\{replace=false\}=\{\}\)\{\s*if\(this\.state\.tourOn\) replace=true;/, "navigation replaces it during a tour");
  assert.match(html, /if\(this\.state\.tourOn&&!\(history\.state&&history\.state\.ccTour\)\)\{ if\(this\.tour\) this\.tour\.stop\("back"\)/, "Back leaves the tour");
  assert.match(html, /if\(e\.key==="Escape"\)\{ e\.preventDefault\(\); return this\.tour\.stop\("close"\); \}/, "Esc closes it");
  assert.match(html, /this\.tour\.next\(\):this\.tour\.prev\(\)/, "← → move between steps");
  assert.match(html, /if\(this\.state\.tourOn&&this\.tour\) this\.tour\.sync\(\);/, "the tour follows every render");
  // Leaving early restores where it started: route, scroll, map view, panels, filters, the quests' status.
  const ended = html.slice(html.indexOf("_tourEnded({"), html.indexOf("// ── Universal search"));
  ["filters:snap.filters", "view:snap.view", "mapPanelOpen:snap.mapPanelOpen", "questStatus:snap.questStatus", "this._scroll={...snap.scroll}", "this._stack=snap.stack.slice()"].forEach(s => assert.ok(ended.includes(s), s));
  assert.match(ended, /if\(completed\) this\.onboarding\.complete\(id\);/, "completion only at the end");
  assert.match(ended, /else if\(id==="main"\) this\.onboarding\.dismissInvite\(\);/, "leaving the main tour early = the welcome does not come back by itself");
  // The context says what the campaign holds; a marker's card falls back to the campaign's example.
  assert.match(html, /hasSessions:!!m&&m\.sessions\.length>0/);
  assert.match(html, /mapHasMarkers:!!ex\.mapEvent/);
  assert.match(html, /const ids=run&&run\.pin&&run\.pin\.length\?run\.pin:ex\?\[ex\.id\]:null;/);
  // The help step's real targets: the "?" in the top bar and More → Help.
  assert.match(html, /class="cc-iconbtn" onClick="\{\{ onOpenHelp \}\}"[^>]*data-tour="help">\?<\/button>/);
  assert.match(html, /class="cc-sheet-item" onClick="\{\{ onOpenHelp \}\}" aria-haspopup="dialog" data-tour="help">/);
  // The map's own tour button stays in view during the main tour (which points to it).
  assert.match(html, /canTour:!!this\.tour, onTour:\(\)=>this\.startTour\("map"\)/);
  // Driver.js is vendored (no CDN), loaded before the app boots, and kept for offline use.
  const sw = fs.readFileSync(path.join(ROOT, "sw.js"), "utf8");
  for (const f of ["vendor/driver.js/driver.js.iife.js", "vendor/driver.js/driver.css", "js/chronicle-tour.js"]) {
    assert.ok(fs.existsSync(path.join(ROOT, f)), f);
    assert.ok(sw.includes(`"${f}"`), `${f} precached`);
  }
  assert.ok(html.indexOf("vendor/driver.js/driver.js.iife.js") < html.indexOf("support.js"));
  assert.ok(fs.existsSync(path.join(ROOT, "vendor/driver.js/LICENSE")), "MIT licence kept with the copy");
  assert.match(fs.readFileSync(path.join(ROOT, "vendor/driver.js/driver.js.iife.js"), "utf8"), /this\.driver\.js=/, "the IIFE build (window.driver.js.driver)");
  // The tour's popover: progress on top with a bar, "Omitir tutorial" beside it, a ring on the highlighted control.
  assert.match(html, /\.driver-popover\.cc-tour \.cc-tour-head\{/);
  assert.match(html, /\.driver-popover\.cc-tour \.cc-tour-skip\{/);
  assert.match(html, /\.driver-active \.driver-active-element:not\(\.cc-marker\):not\(#driver-dummy-element\)\{outline:2px solid/);
});
