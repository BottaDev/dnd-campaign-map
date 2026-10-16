// The Places index — the atlas tree: story order, the Atlas and the other planes, folding (default, one
// branch, everything), opening a place without unfolding it, the contextual search (nested matches keep
// their ancestors, the folding comes back after it), places without parents, kinds or coordinates, and
// parentId loops. Plus the accessible wiring of the tree in index.html.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { Model, I18N, PCS, buildReal, readText } = require("./helpers");

// A small world: Continent › City › District › Site, a city with no parent, a plane holding a plane,
// a place recorded without a kind and one with a kind the model does not know.
const PLACES = [
  { id: "cont", name: "Westland", kind: "continent" },
  { id: "city", name: "Harbour Town", kind: "city", parentId: "cont" },
  { id: "dist", name: "Old Quarter", aliases: ["The quarter"], kind: "district", parentId: "city" },
  { id: "shop", name: "Gilmore's shop", kind: "site", parentId: "dist" },
  { id: "keep", name: "Grey Keep", kind: "site", parentId: "city" },
  { id: "lone", name: "Lone City", kind: "city" },
  { id: "plane", name: "The Shadow Plane", kind: "plane" },
  { id: "inner", name: "Mist Realm", kind: "plane", parentId: "plane" },
  { id: "bare", name: "Nameless Ruin" },
  { id: "odd", name: "Odd Spot", kind: "ruin" },
];
const EVENTS = [
  { id: "e1", session: 1, campaignDay: 3, title: "At the shop", summary: "", locationId: "shop", xp: 40, yp: 30 },
  { id: "e2", session: 1, campaignDay: 1, title: "Arrival", summary: "", locationId: "lone", xp: 10, yp: 10 },
  { id: "e3", session: 1, campaignDay: 2, title: "Beyond", summary: "", locationId: "plane", xp: 50, yp: 50 },
  { id: "e4", session: 1, campaignDay: 4, title: "At the keep", summary: "", locationId: "keep" },
];
const world = (locations, opts) => Model.build({ characters: PCS, npcs: [], locations: locations || PLACES, routes: {}, quests: [],
  sessions: { 1: { title: "One" } }, events: EVENTS }, opts);
const shown = view => { const out = []; const walk = ns => ns.forEach(n => { out.push(n.id); walk(n.children); }); view.groups.forEach(g => walk(g.nodes)); return out; };
const find = (view, id) => { let hit = null; const walk = ns => ns.forEach(n => { if (n.id === id) hit = n; walk(n.children); }); view.groups.forEach(g => walk(g.nodes)); return hit; };

test("1 · the Atlas and the other planes come from the recorded kind only; every place once, roots in story order", () => {
  const m = world(), idx = Model.placeIndex(m);
  assert.deepEqual(idx.groups.map(g => [g.key, g.rootIds, g.count]), [
    ["atlas", ["lone", "cont", "bare", "odd"], 8],              // first events: Lone City day 1, Westland (its shop) day 3; never visited: by name
    ["planes", ["plane"], 2],
  ]);
  assert.deepEqual(idx.childIds.get("city"), ["dist", "keep"], "the district's shop (day 3) before the keep (day 4)");
  const order = Model.placeOrder(m, idx);
  assert.equal(order.length, PLACES.length);
  assert.equal(new Set(order).size, PLACES.length, "no place twice");
  assert.deepEqual(order.slice(0, 6), ["lone", "cont", "city", "dist", "shop", "keep"], "a place, then what lies inside it");
  assert.deepEqual(idx.branchIds.sort(), ["cont", "city", "dist", "plane"].sort());
  // Only what is recorded: no plane, no place nested anywhere → a single Atlas group, all at the top level.
  const flat = Model.placeIndex(world([{ id: "a", name: "A", kind: "city" }, { id: "b", name: "B", kind: "site" }]));
  assert.deepEqual(flat.groups.map(g => [g.key, g.rootIds]), [["atlas", ["a", "b"]]]);
});

test("2 · order: a reading-language comparison only breaks ties; by default English names, the same in every language", () => {
  const es = buildReal("es-AR"), en = buildReal("en");
  assert.deepEqual(Model.placeOrder(es, Model.placeIndex(es)), Model.placeOrder(en, Model.placeIndex(en)));
  const byEs = Model.placeIndex(es, { cmp: (a, b) => a.name.localeCompare(b.name, "es") });
  const unvisited = byEs.groups[0].rootIds.filter(id => !es.placeById.get(id).allEventIds.length);
  assert.deepEqual(unvisited.map(id => es.placeById.get(id).name), unvisited.map(id => es.placeById.get(id).name).slice().sort((a, b) => a.localeCompare(b, "es")));
  // Visited places keep story order, whatever their names.
  const visited = byEs.groups[0].rootIds.filter(id => es.placeById.get(id).allEventIds.length);
  const firsts = visited.map(id => es.eventById.get(es.placeById.get(id).allEventIds[0]).chronoIndex);
  assert.deepEqual(firsts, firsts.slice().sort((a, b) => a - b));
});

test("3 · default folding: the top level open, everything below closed; childCount = the places directly inside", () => {
  const m = world(), idx = Model.placeIndex(m), v = Model.placeTreeView(m, idx, {});
  assert.deepEqual(shown(v), ["lone", "cont", "city", "bare", "odd", "plane", "inner"]);
  assert.equal(find(v, "cont").expanded, true);
  assert.deepEqual([find(v, "city").expanded, find(v, "city").childCount], [false, 2]);
  assert.equal(find(v, "lone").childCount, 0);
  assert.equal(Model.isPlaceOpen(m, {}, "lone"), false, "a place with nothing inside is never open");
  assert.deepEqual([v.allOpen, v.allClosed, v.searching, v.total], [false, false, false, PLACES.length]);
});

test("4 · expanding and collapsing one branch never touches another; everything open / everything closed", () => {
  const m = world(), idx = Model.placeIndex(m);
  const open = { city: true };
  const v = Model.placeTreeView(m, idx, { open });
  assert.deepEqual(shown(v), ["lone", "cont", "city", "dist", "keep", "bare", "odd", "plane", "inner"]);
  assert.equal(find(v, "dist").expanded, false, "opening the city does not open its district");
  const closedCont = Model.placeTreeView(m, idx, { open: { ...open, cont: false } });
  assert.deepEqual(shown(closedCont), ["lone", "cont", "bare", "odd", "plane", "inner"], "closing the continent hides what lies inside…");
  assert.deepEqual(shown(Model.placeTreeView(m, idx, { open: { ...open, cont: true } })), shown(v), "…and opening it again shows the city still open");
  const all = Object.fromEntries(idx.branchIds.map(id => [id, true])), none = Object.fromEntries(idx.branchIds.map(id => [id, false]));
  const vAll = Model.placeTreeView(m, idx, { open: all }), vNone = Model.placeTreeView(m, idx, { open: none });
  assert.equal(shown(vAll).length, PLACES.length);
  assert.deepEqual([vAll.allOpen, vAll.allClosed], [true, false]);
  assert.deepEqual(shown(vNone), ["lone", "cont", "bare", "odd", "plane"], "everything closed: the top level only");
  assert.deepEqual([vNone.allOpen, vNone.allClosed], [false, true]);
});

test("5 · opening a place unfolds its ancestors only — never the place itself, never closing anything", () => {
  const m = world(), idx = Model.placeIndex(m);
  const before = { keep: true, plane: false };
  const after = Model.revealPlace(m, before, "dist");
  assert.deepEqual(after, { keep: true, plane: false, city: true }, "the continent is already open by default; the city opens");
  assert.equal(Model.isPlaceOpen(m, after, "dist"), false, "the district itself stays folded");
  assert.notEqual(after, before, "a new object…");
  assert.deepEqual(before, { keep: true, plane: false }, "…the old one untouched");
  assert.equal(Model.revealPlace(m, after, "dist"), after, "nothing to change: the same object");
  assert.equal(Model.revealPlace(m, after, "lone"), after, "a top-level place has nothing to unfold");
  assert.equal(Model.revealPlace(m, after, "nowhere"), after, "an unknown id changes nothing");
  // A branch the visitor closed by hand opens again when a place inside it is opened.
  const reopened = Model.revealPlace(m, { cont: false }, "shop");
  assert.deepEqual(reopened, { cont: true, city: true, dist: true });
  assert.ok(shown(Model.placeTreeView(m, idx, { open: reopened })).includes("shop"));
});

test("6 · search: a nested place keeps its ancestors as context; case, accents, kinds and aliases; no match", () => {
  const m = world(), idx = Model.placeIndex(m);
  const v = Model.placeTreeView(m, idx, { query: "GILMORE" });
  assert.deepEqual(shown(v), ["cont", "city", "dist", "shop"], "the path down to the shop, nothing else");
  assert.deepEqual(["cont", "city", "dist"].map(id => find(v, id).context), [true, true, true]);
  assert.deepEqual([find(v, "shop").match, find(v, "shop").context], [true, false]);
  assert.ok(["cont", "city", "dist"].every(id => find(v, id).expanded), "every branch on the way open");
  assert.deepEqual([v.searching, v.matchCount, v.groups.map(g => g.matchCount)], [true, 1, [1]]);
  assert.deepEqual(shown(Model.placeTreeView(m, idx, { query: "gílmore's" })), shown(v), "accents and apostrophes ignored");
  assert.deepEqual(shown(Model.placeTreeView(m, idx, { query: "the quarter" })), ["cont", "city", "dist"], "aliases");
  // Kinds, in either language (the model's search texts hold both).
  const es = buildReal("es-AR"), ies = Model.placeIndex(es);
  const cities = Model.placeTreeView(es, ies, { query: "ciudad" }), citiesEn = Model.placeTreeView(es, ies, { query: "city" });
  const matched = view => shown(view).filter(id => find(view, id).match).sort();
  assert.deepEqual(matched(cities), es.places.filter(p => p.kind === "city").map(p => p.id).sort());
  assert.deepEqual(matched(citiesEn), matched(cities));
  assert.deepEqual(matched(Model.placeTreeView(es, ies, { query: "plano" })), ["far-realm", "ravenloft", "shadowfell"]);
  const none = Model.placeTreeView(m, idx, { query: "xyzzy" });
  assert.deepEqual([none.searching, none.matchCount, none.groups.length], [true, 0, 0]);
  assert.deepEqual(shown(Model.placeTreeView(m, idx, { query: "   " })), shown(Model.placeTreeView(m, idx, {})), "blank = no search");
});

test("7 · a search never changes the folding: clearing it brings the tree back exactly as it was", () => {
  const m = world(), idx = Model.placeIndex(m);
  const open = Object.freeze({ cont: false, plane: true, city: true });
  const before = JSON.stringify(Model.placeTreeView(m, idx, { open }));
  const during = Model.placeTreeView(m, idx, { open, query: "gilmore" });
  assert.deepEqual(shown(during), ["cont", "city", "dist", "shop"], "the closed continent is opened for the search only");
  assert.equal(JSON.stringify(Model.placeTreeView(m, idx, { open, query: "" })), before);
});

test("8 · places without a parent sit at the top level; an unknown parentId is reported and shown there too", () => {
  const m = world([...PLACES, { id: "stray", name: "Stray", kind: "site", parentId: "missing" }]);
  assert.ok(m.issues.some(i => i.level === "error" && /Place "stray": unknown parentId "missing"/.test(i.msg)));
  const idx = Model.placeIndex(m);
  assert.ok(idx.groups[0].rootIds.includes("stray"));
  assert.deepEqual(m.placeById.get("stray").ancestorIds, []);
});

test("9 · parentId loops are reported and broken at their first place; every place still appears once", () => {
  const loop = [
    { id: "a", name: "A", kind: "city", parentId: "c" }, { id: "b", name: "B", kind: "district", parentId: "a" },
    { id: "c", name: "C", kind: "site", parentId: "b" }, { id: "self", name: "Self", kind: "site", parentId: "self" },
    { id: "tail", name: "Tail", kind: "site", parentId: "b" },
  ];
  const m = world(loop), idx = Model.placeIndex(m);
  const errs = m.issues.filter(i => i.level === "error" && /parentId loop/.test(i.msg)).map(i => i.msg);
  assert.ok(errs.some(e => /Place "a": parentId loop \(a → c → b → a\)/.test(e)), errs.join("\n"));
  assert.ok(errs.some(e => /Place "self": parentId loop \(self → self\)/.test(e)));
  assert.equal(errs.length, 2, "one report per loop");
  assert.deepEqual([m.placeById.get("a").parentId, m.placeById.get("b").parentId, m.placeById.get("c").parentId], [null, "a", "b"]);
  assert.deepEqual(m.placeById.get("c").ancestorIds, ["b", "a"]);
  const order = Model.placeOrder(m, idx);
  assert.deepEqual(order.slice().sort(), loop.map(p => p.id).sort(), "no place lost or repeated");
  const all = Object.fromEntries(idx.branchIds.map(id => [id, true]));
  assert.equal(shown(Model.placeTreeView(m, idx, { open: all })).length, loop.length);
});

test("10 · kinds and coordinates are never assumed: no kind, unknown kind, no map position, other planes", () => {
  const m = world();
  const bare = m.placeById.get("bare"), odd = m.placeById.get("odd");
  assert.deepEqual([bare.kindKey, bare.kindLabel], ["place", "Place"], "no kind: a plain place");
  assert.deepEqual([odd.kindKey, odd.kindLabel], ["place", "Ruin"], "an unknown kind keeps its own word, with the plain icon");
  assert.ok(m.issues.some(i => i.level === "warn" && /Place "bare": no kind/.test(i.msg)));
  assert.ok(m.issues.some(i => i.level === "warn" && /Place "odd": unknown kind "ruin"/.test(i.msg)));
  const es = world(null, { locale: "es-AR", t: I18N.createTranslator("es-AR") });
  assert.equal(es.placeById.get("bare").kindLabel, "Lugar", "localized");
  assert.equal(m.placeById.get("keep").focusEventId, null, "its only event has no coordinates: no map focus, nothing invented");
  assert.equal(m.placeById.get("city").focusEventId, "e1", "a place's map focus is its first event with a position, here or inside");
  assert.equal(m.placeById.get("plane").focusEventId, null, "other planes are never on the map, even with a recorded pin");
  assert.equal(m.placeById.get("inner").isPlanar, true);
  assert.equal(world().placeById.get("city").kindKey, "city");
});

test("11 · the real campaign: every place once, the planes apart, the path to Gilmore's shop", () => {
  const m = buildReal("es-AR"), idx = Model.placeIndex(m);
  assert.equal(Model.placeOrder(m, idx).length, m.places.length);
  assert.deepEqual(idx.groups.map(g => g.key), ["atlas", "planes"]);
  assert.deepEqual(idx.groups[1].rootIds.slice().sort(), ["far-realm", "shadowfell"]);
  assert.ok(idx.groups[0].rootIds.every(id => !m.placeById.get(id).isPlanar));
  const v = Model.placeTreeView(m, idx, { query: "Gilmore" });
  assert.deepEqual(shown(v), ["taldorei", "emon", "academic-district", "gilmores-shop"]);
  assert.deepEqual(m.issues.filter(i => /Place "/.test(i.msg)), [], "no place issue in the real data");
});

// ── The tree in index.html: an accessible disclosure list ──────────────────
const html = readText("index.html");
const css = html.slice(html.indexOf("<style>\n"), html.indexOf("</style>\n</helmet>"));
const builder = html.slice(html.indexOf("_buildPlacesNow(selId){"), html.indexOf("\n  }\n", html.indexOf("_buildPlacesNow(selId){")));

test("12 · index.html: carets are buttons (aria-expanded, aria-controls → the nested list), names are links, lists stay lists", () => {
  assert.match(builder, /h\("button",\{type:"button",className:"cc-twisty","aria-expanded":n\.expanded\?"true":"false","aria-controls":listId,/);
  assert.match(builder, /onClick:\(\)=>this\.togglePlace\(n\.id\)/, "the caret folds, it never navigates");
  assert.match(builder, /h\("a",\{className:"cc-node-a",href:this\.href\("place",n\.id\),"aria-current":isSel\?"true":undefined,/, "the name opens the place");
  assert.match(builder, /h\("ul",\{className:"cc-tree-sub",id:listId,role:"list",hidden:!n\.expanded\}/, "a folded list stays in the DOM (hidden) for aria-controls");
  assert.match(builder, /h\("ul",\{className:"cc-tree",role:"list"\}/);
  assert.ok(!/role:"tree(item)?"|role="tree/.test(html), "no ARIA tree roles without a tree's keyboard model");
  assert.match(html, /<input class="cc-input" ref="\{\{ pll\.inputRef \}\}" type="search"[^>]*aria-label="\{\{ t\.places\.findAria \}\}"/);
  assert.match(html, /<span class="cc-results-t" id="cc-atlas-status" aria-live="polite">\{\{ pll\.status \}\}<\/span>/);
  assert.match(html, /disabled="\{\{ pll\.allOpen \}\}">\{\{ icons\.unfold \}\}\{\{ t\.places\.expandAll \}\}/);
  assert.match(html, /disabled="\{\{ pll\.allClosed \}\}">\{\{ icons\.fold \}\}\{\{ t\.places\.collapseAll \}\}/);
  // A place's page: the recorded path as a breadcrumb navigation, the place itself marked as the current location.
  assert.match(html, /<nav class="\{\{ pp\.crumbsCls \}\}" aria-label="\{\{ t\.place\.crumbsAria \}\}">/);
  assert.match(html, /<span class="cc-crumb is-here" aria-current="location">/);
});

test("13 · index.html: the open place is revealed on navigation; folding lives in memory only; touch targets", () => {
  assert.match(html, /placesOpen:this\._revealPlace\(s\.placesOpen,r\)/, "every route change reveals the open place");
  assert.match(html, /_revealPlace\(open,r\)\{ return this\.model&&r\.section==="places"&&r\.kind==="place"\?M\.revealPlace\(this\.model,open,r\.id\):open; \}/);
  assert.ok(!/chronicle-places|Prefs\.(set|setS)\("chronicle-places/.test(html), "nothing about the tree is stored");
  assert.match(css, /\.cc-twisty::after\{content:"";position:absolute;top:0;bottom:0;left:-8px;right:0;\}/, "the caret's target reaches into the indent");
  assert.match(css, /\.cc-node-map\{flex:none;display:inline-flex;align-items:center;justify-content:center;width:44px;height:42px;/);
  assert.match(css, /@media \(prefers-reduced-motion:reduce\)\{\*\{animation:none!important;transition:none!important;\}\}/, "the caret's turn respects reduced motion");
});
