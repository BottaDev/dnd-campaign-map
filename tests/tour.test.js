// Interactive tours (js/chronicle-tour.js, on top of Driver.js): what each tour teaches and in which
// order, how progress is counted, which action moves each step on, which screen each step needs,
// the texts in both languages, the versioned onboarding keys, and how index.html wires it all.
// The live behaviour (real clicks, waiting for the map, phones) is in tests/browser/smoke.mjs.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { Model, I18N, ROOT, buildReal } = require("./helpers");
const Tour = require("../js/chronicle-tour.js");

const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const ids = steps => steps.map(s => s.id);
const memStorage = init => {
  const s = { ...(init || {}) };
  return { getItem: k => (k in s ? s[k] : null), setItem: (k, v) => { s[k] = String(v); }, removeItem: k => { delete s[k]; }, _s: s };
};
// The context index.html builds for the steps (Component._tourCtx).
const ctx = over => ({
  route: { section: "chronicle", kind: null, id: null }, hash: "#/chronicle", isMobile: false, isWide: true,
  moreOpen: false, mapPanelOpen: false, mapPopup: null, search: { open: false, q: "" }, latest: 12,
  example: { eventId: "s12_07", personId: "sorfon", personName: "Sorfon", mapEventId: "s12_07" },
  labels: { app: "Crónica de Exandria", party: "Bund Der Vier", partyFilters: "Grupo y filtros", inChronicle: "Ver en la Crónica", keys: "Ctrl+K" },
  ...over,
});
const at = (hash, over) => {
  const [section, kind = null, id = null] = hash.replace(/^#\//, "").split("/");
  return ctx({ route: { section, kind, id }, hash, ...over });
};

test("1 · main tour: welcome, recap, Chronicle, connections, search, the map and the party — map included, ~6 ideas", () => {
  const desk = Tour.plan("main", ctx());
  assert.deepEqual(ids(desk), ["welcome", "recap", "recapView", "card", "links", "search", "searchType", "searchResults", "mapOpen", "marker", "popup", "party", "partyRows", "doneMain"]);
  // Phones reach the map through "More" (bottom nav): one more popover, same idea.
  assert.deepEqual(ids(Tour.plan("main", ctx({ isMobile: true, isWide: false }))).slice(8, 11), ["mapMore", "mapOpen", "marker"]);
  // Progress counts ideas, not popovers.
  for (const c of [ctx(), ctx({ isMobile: true, isWide: false })]) {
    const steps = Tour.plan("main", c), n = id => Tour.progress(steps, steps.find(s => s.id === id));
    assert.deepEqual(n("welcome"), { n: 1, total: 7 });
    assert.deepEqual(n("recapView"), { n: 2, total: 7 });
    assert.deepEqual(n("card"), { n: 3, total: 7 });
    assert.deepEqual(n("links"), { n: 4, total: 7 });
    assert.deepEqual(n("searchResults"), { n: 5, total: 7 });
    assert.deepEqual(n("marker"), { n: 6, total: 7 }, "Map A: markers");
    assert.deepEqual(n("partyRows"), { n: 7, total: 7 }, "Map B: party filter and dashed journeys");
    assert.equal(n("doneMain"), null, "the ending has no number");
  }
});

test("2 · no recorded session yet: the real Sessions section stands in for the recap (nothing invented)", () => {
  const steps = Tour.plan("main", ctx({ latest: null }));
  assert.ok(!ids(steps).includes("recap") && !ids(steps).includes("recapView"));
  assert.equal(ids(steps)[1], "sessions");
  assert.equal(Tour.progress(steps, steps[steps.length - 2]).total, 7);
});

test("3 · map and search tours reuse the same step definitions (no duplicated tour logic)", () => {
  assert.deepEqual(Tour.TOURS.map, ["marker", "popup", "cluster", "party", "partyRows", "zoom", "doneMap"]);
  assert.deepEqual(Tour.TOURS.search, ["search", "searchType", "searchResults", "entry", "doneSearch"]);
  const mainSteps = Tour.plan("main", ctx()), mapSteps = Tour.plan("map", at("#/map"));
  ["marker", "popup", "party", "partyRows"].forEach(id => assert.equal(mapSteps.find(s => s.id === id), mainSteps.find(s => s.id === id), id));
  assert.deepEqual(Tour.progress(mapSteps, mapSteps[0]), { n: 1, total: 3 });
  for (const id of Object.keys(Tour.TOURS)) assert.ok(Tour.STEPS[Tour.TOURS[id].slice(-1)[0]].final, `${id} ends on a final step`);
});

test("4 · each step moves on when the visitor does the real thing", () => {
  const S = Tour.STEPS, mem = { hash: "#/chronicle/event/s12_07" }, run = {};
  assert.equal(S.recap.done(at("#/chronicle")), false);
  assert.equal(S.recap.done(at("#/chronicle/recap/12")), true, "the recap opened");
  assert.equal(S.card.done(at("#/chronicle/event/s11_04")), true, "any card opened");
  assert.equal(S.links.done(at("#/chronicle/event/s12_07"), mem), false);
  assert.equal(S.links.done(at("#/chronicle/character/mortis"), mem), true, "a link was followed");
  assert.equal(S.search.done(ctx({ search: { open: true, q: "" } })), true, "the search opened");
  assert.equal(S.searchResults.done(ctx({ search: { open: true, q: "Mortis" } }), mem, run), false);
  assert.equal(S.searchResults.done(ctx({ search: { open: false, q: "Mortis" } }), mem, run), true, "a result was opened");
  assert.equal(run.searchedAway, true);
  assert.equal(S.searchResults.skip(ctx(), run, 1), true, "Enter on a result skips the results step");
  assert.equal(S.searchResults.skip(ctx(), run, -1), false, "but Back still reaches it");
  assert.equal(S.mapMore.done(ctx({ isMobile: true, moreOpen: true })), true);
  assert.equal(S.mapOpen.done(at("#/map")), true);
  assert.equal(S.marker.done(at("#/map", { mapPopup: "sel" })), true, "a marker was tapped");
  assert.equal(S.party.done(at("#/map", { mapPanelOpen: true })), true, "the party panel opened");
});

test("5 · each step brings its own screen (route + panels), so Next/Back work from anywhere", () => {
  const S = Tour.STEPS;
  assert.equal(S.recap.screen.ok(at("#/chronicle/event/s12_07")), false, "the recap entry is on the list");
  assert.equal(S.recapView.screen.go(ctx()), "#/chronicle/recap/12");
  assert.equal(S.links.screen.go(ctx()), "#/chronicle/event/s12_07", "the well-connected example");
  assert.equal(S.marker.screen.go(ctx()), "#/map");
  assert.equal(S.marker.screen.ok(at("#/map/event/s12_07", { isWide: true })), true, "the map stays beside the entry on wide screens");
  assert.equal(S.marker.screen.ok(at("#/map/event/s12_07", { isWide: false })), false, "an entry covers the map below 1024px");
  assert.equal(S.marker.screen.ok(at("#/map/at/s12_07", { isWide: false })), true);
  assert.equal(S.mapOpen.ui.more(ctx({ isMobile: true })), true, "phones: the More sheet open");
  assert.equal(S.mapOpen.ui.more(ctx()), false);
  assert.deepEqual(S.marker.ui, { more: false, search: false, mapPanel: false, mapPopup: false });
  assert.equal(S.partyRows.ui.mapPanel, true);
  assert.equal(S.links.screen.go(ctx({ example: { eventId: null } })), null, "no example → the step is skipped, not faked");
  assert.equal(S.entry.screen.go(at("#/map")), "#/chronicle/character/sorfon");
});

test("6 · the map never depends on one marker: a fallback for an empty map, optional groups, read-only cards", () => {
  const S = Tour.STEPS;
  assert.equal(S.marker.fallback.text, "markerNone");
  assert.equal(S.cluster.optional, true);
  assert.equal(S.popup.interactive(ctx({ mapPopup: "sel" })), false, "“Read entry” does not leave the map mid-tour");
  assert.equal(S.popup.interactive(ctx({ mapPopup: "list" })), true, "a list can be used to pick an event");
  assert.ok(S.marker.settle >= 3 && S.marker.timeout >= 5000, "waits for the map to settle");
  assert.deepEqual(S.marker.remember({ getAttribute: () => "a b" }), { pin: ["a", "b"] });
});

test("7 · every text a tour shows exists in both languages, short, with every {param} filled", () => {
  const keys = Tour.textKeys();
  assert.ok(keys.length > 50);
  for (const code of ["es-AR", "en"]) {
    const t = I18N.createTranslator(code);
    for (const k of keys) {
      const raw = I18N.get(I18N.dicts[code], k);
      assert.equal(typeof raw, "string", `${code} ${k}`);
      const p = { ...ctx().labels, name: "Sorfon", n: 12, total: 7 };
      const v = t(k, p);
      assert.ok(!/\{\w+\}/.test(v), `${code} ${k}: unfilled parameter in "${v}"`);
      if (/T$/.test(k)) assert.ok(v.length <= 40, `${code} ${k}: title too long (${v.length})`);
      else if (/D$/.test(k)) assert.ok(v.length <= 190, `${code} ${k}: ${v.length} chars — keep it to one or two sentences`);
      else assert.ok(v.length <= 26, `${code} ${k}: button/label too long`);
    }
    // Proper names are never translated.
    assert.ok(t("tour.welcomeD", { party: "Bund Der Vier" }).includes("Bund Der Vier"));
  }
  assert.equal(I18N.createTranslator("es-AR")("tour.inviteH"), "¿Primera vez por acá?");
  assert.equal(I18N.createTranslator("es-AR")("tour.finish"), "Empezar a explorar");
  assert.equal(I18N.createTranslator("es-AR")("tour.more"), "Ver más tutoriales");
});

test("8 · onboarding progress: separate versioned keys; completion ≠ invitation; a new version offers it again", () => {
  const st = memStorage({ "chronicle-lang": "en", "chronicle-favorites": "{\"v\":1,\"items\":[]}", "chronicle-tutorial-seen": "done" });
  const p = Tour.createProgress(st);
  assert.equal(p.showInvite(), true, "first visit");
  p.migrate();
  assert.equal(st._s["chronicle-tutorial-seen"], undefined, "the old guide's flag is superseded");
  p.complete("map");
  assert.equal(p.showInvite(), true, "another tour does not hide the main invitation");
  p.complete("main");
  assert.equal(p.showInvite(), false);
  assert.deepEqual(JSON.parse(st._s[Tour.KEYS.completed]), ["map", "main"]);
  assert.equal(st._s[Tour.KEYS.version], String(Tour.VERSION));
  assert.equal(st._s[Tour.KEYS.invite], undefined, "the invitation is its own key");
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

test("9 · the examples come from the campaign itself", () => {
  const m = buildReal("es-AR"), ex = Model.guideExamples(m), last = Model.latestSession(m);
  assert.ok(last && last.no >= 1, "a recorded session for the recap step");
  assert.ok(m.eventById.get(ex.event.id) && ex.event.characterIds.length && ex.event.questIds.length, "the card/links example has people and quests");
  assert.equal(ex.person.kind, "pc", "a party member to search for");
  assert.ok(Model.searchAll(m, ex.person.name).groups.length >= 3, "…whose name finds several kinds of entry");
  assert.ok(ex.mapEvent.hasCoords, "an event with a marker");
  assert.equal(Tour.escapeHtml("<b>&\"'"), "&lt;b&gt;&amp;&quot;&#39;", "texts reach Driver.js's innerHTML escaped");
});

test("10 · index.html: tours are optional, own one history entry, keep the visitor's history and context", () => {
  const mount = html.slice(html.indexOf("componentDidMount(){"), html.indexOf("componentDidUpdate(){"));
  assert.ok(!/startTour\(|\.start\(/.test(mount), "never started by itself");
  assert.match(html, /history\.pushState\(\{ccTour:id\},"",location\.href\)/, "one history entry per tour");
  assert.match(html, /navigate\(hash,\{replace=false\}=\{\}\)\{\s*if\(this\.state\.tourOn\) replace=true;/, "navigation replaces it during a tour");
  assert.match(html, /if\(this\.state\.tourOn&&!\(history\.state&&history\.state\.ccTour\)\)\{ if\(this\.tour\) this\.tour\.stop\("back"\)/, "Back leaves the tour");
  assert.match(html, /if\(e\.key==="Escape"\)\{ e\.preventDefault\(\); return this\.tour\.stop\("close"\); \}/, "Esc closes it");
  assert.match(html, /this\.tour\.next\(\):this\.tour\.prev\(\)/, "← → move between steps");
  assert.match(html, /if\(this\.state\.tourOn&&this\.tour\) this\.tour\.sync\(\);/, "the tour follows every render");
  // Leaving early restores where it started: route, scroll, map view, panels and filters.
  const ended = html.slice(html.indexOf("_tourEnded({"), html.indexOf("// ── Universal search"));
  ["filters:snap.filters", "view:snap.view", "mapPanelOpen:snap.mapPanelOpen", "this._scroll={...snap.scroll}", "this._stack=snap.stack.slice()"].forEach(s => assert.ok(ended.includes(s), s));
  assert.match(ended, /if\(completed\) this\.onboarding\.complete\(id\);/, "completion only at the end");
  // Driver.js is vendored (no CDN), loaded before the app boots, and kept for offline use.
  const sw = fs.readFileSync(path.join(ROOT, "sw.js"), "utf8");
  for (const f of ["vendor/driver.js/driver.js.iife.js", "vendor/driver.js/driver.css", "js/chronicle-tour.js"]) {
    assert.ok(fs.existsSync(path.join(ROOT, f)), f);
    assert.ok(sw.includes(`"${f}"`), `${f} precached`);
  }
  assert.ok(html.indexOf("vendor/driver.js/driver.js.iife.js") < html.indexOf("support.js"));
  assert.ok(fs.existsSync(path.join(ROOT, "vendor/driver.js/LICENSE")), "MIT licence kept with the copy");
  assert.match(fs.readFileSync(path.join(ROOT, "vendor/driver.js/driver.js.iife.js"), "utf8"), /this\.driver\.js=/, "the IIFE build (window.driver.js.driver)");
});
