# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Running the app

```
npx serve -p 5500 .
```

Open `http://localhost:5500/` in a browser. There is no build step — reload the browser after edits.

Campaign data is fetched at runtime from `data/*.json` (see below), so the app must be served over HTTP — opening `index.html` directly via `file://` will fail to load data due to browser fetch/CORS restrictions.

## Validating data (the project's "test")

```
node tools/validate-data.js
```

Runs the same model the page uses (`js/chronicle-model.js`) over `data/*.json`: JSON syntax, duplicate ids, every cross-reference, coordinates, route waypoints/shared legs, asset paths, and `data/i18n/*.json` (unknown ids, positional array lengths, coverage). Exit code 1 on errors. Run it after any data or model change.

## Tests

```
npm test              # validator + node --test tests/*.test.js (no dependencies)
npm run test:browser  # tests/browser/smoke.mjs — playwright-core driving the installed Edge
```

Unit tests cover the party filter, routes, markers/clusters and i18n (incl. that every `t` key used in `index.html` exists in both locales). The browser suite needs `npm install` once and must run from PowerShell/cmd on Windows — under Git Bash Playwright's `--remote-debugging-pipe` fails and Edge exits immediately. It writes screenshots to `test-results/` (git-ignored).

## Rebuilding support.js

`support.js` is a generated bundle — do **not** edit it directly. The source lives in a separate `dc-runtime` repo/directory (not present here). The comment at the top of `support.js` shows the rebuild command:

```
cd dc-runtime && bun run build
```

## Architecture

A single **Design Component** (`index.html`, a `.dc.html`-style template) powered by the `dc-runtime` (`support.js`, which loads React 18 from unpkg before booting), plus a plain data-layer script:

- `js/chronicle-model.js` — loaded by a normal `<script>` before `support.js`; exposes `window.ChronicleModel` (and `module.exports` for Node). Pure data: `build(raw, { locale, t, translations, searchTs })` normalizes the JSON files (including legacy records), overlays the content translation for `locale` (English fallback per field; positional arrays only when lengths match) and builds the linked model (`events`, `sessions`, `quests`, `people`, `places` + `…ById` maps, reverse indexes, `routeById`, `issues`); `filterEvents`, `FILTER_PREDICATES`, `matchesCharacters`, `toggleVisibleCharacter`, `selectedCharacterIds`, `search`, `fold` (accent-insensitive), `checkTranslations`, `normalizeLore` (attaches `person.lore`/`place.lore` from `data/lore.json`, read-only), `safeExternalUrl` (https-only gate for every external link), vocabularies (`EVENT_TYPES`, `QUEST_STATUS`, `PERSON_CATEGORIES`, `PLACE_KINDS`, `LORE_FACTS`). No DOM. Relationship logic belongs here, not in `index.html`.
- `js/chronicle-map.js` — `window.ChronicleMap`: pure map geometry. `routeLayers(model, ids)` (individual polylines + shared legs drawn once), `groupSpots` (one spot per exact coordinate), `clusterSpots` (agglomerative, zoom-dependent, markers never overlap), `separationScale`, `clampShift`.
- `js/i18n.js` + `locales/en.js`, `locales/es-AR.js` — `window.ChronicleI18n`: `createTranslator(code)` → `t(key, params)` with `{param}` interpolation, `{one,other}` plurals, English fallback; `t.dict` is the merged nested dictionary passed to the template as `t`. Locale files are scripts (not JSON) so the first paint is already translated. Default `es-AR`, preference in `localStorage` `chronicle-lang`.
- `index.html` — template + CSS (in `<helmet>`) + the `Component` logic: routing, view-model builders, map viewport. **No visible text is hard-coded**: template strings are `{{ t.section.key }}`, JS strings `this.t("section.key", params)`; add every new key to both locale files.

### dc-runtime concepts

- **`<x-dc>`** — wraps the entire template; the runtime strips it and mounts a React root in its place.
- **`{{ expr }}`** — template interpolation; `expr` resolves against the values returned by `renderVals()`. Keep expressions to plain paths.
- **`<sc-for list="{{ … }}" as="item">`** / **`<sc-if value="{{ … }}">`** — structural directives compiled into React elements.
- **`<helmet>`** — injects `<link>`, `<style>`, `<script>` tags into `<head>` at runtime.
- **`<script type="text/x-dc" data-dc-script>`** — the logic block; must define `class Component extends DCLogic`. The `data-props` attribute carries JSON metadata for the editor.
- **`style-hover="…"`** — pseudo-class helper that injects a scoped CSS rule via the pseudo sheet.
- **`DCLogic` / `StreamableLogic`** — base class. Key methods: `renderVals()`, `setState(update, cb)` (state is applied synchronously; `cb` runs after commit), `componentDidMount()`, `componentDidUpdate()`, `componentWillUnmount()`.
- Returning the *same* React element object from `renderVals` lets React skip that subtree — the map's route SVG, pins and the detail pane are memoized (`this._memo`) so panning/zooming doesn't rebuild them.

**Runtime gotchas (learned the hard way):**
- The browser parses the `<x-dc>` markup as real (hidden) DOM before the runtime runs. Template `<img>` tags therefore download unless they have `loading="lazy"`, and inline-handler attributes that fire on their own (`onLoad`) throw. Load images from JS (`new Image()`) when you need a load callback.
- `{{ }}` text interpolation wraps strings in a `<span>`, so `<option>` lists are built in JS as React elements (see `options()`), and rendered as `{{ c.opt.quest }}` inside `<select>`.
- Base element rules must use `:where(.cc-app) button` style selectors; a plain `.cc-app button` outranks component classes like `.cc-btn`.
- `class` → `className`; camelCase attributes (`onClick`, `tabIndex`, `autoComplete`, `enterKeyHint`) are passed through as React props.

### index.html structure

Six sections, switched by hash routes `#/<section>[/<kind>/<id>]` (works on GitHub Pages):

| Section | Content |
|---------|---------|
| `chronicle` (home) | Narrative timeline grouped by campaign day or session, sticky search + combinable filters, cross-entity quick results |
| `sessions` | Session list with gaps for unrecorded sessions |
| `quests` | Quests by status |
| `characters` | Party + NPCs/deities/creatures/factions |
| `places` | Place hierarchy |
| `map` | The original pannable/zoomable map: pins grouped per coordinate (click cycles), counter-scaled `Session N` captions, dashed route, popup, party toggles |

Detail kinds (`event`, `session`, `quest`, `character`, `place`) open the reading pane (`.cc-detail`): beside the list at ≥1024px, full-screen below. The section stays in the URL, so links inside a detail keep you in the current section (e.g. `#/map/session/8` = map + session log beside it, like the original right panel). `#/map/at/<eventId>` focuses/selects a pin without opening the pane (used on phones). Below 720px the top tabs become a bottom nav (Chronicle, Sessions, Quests, More).

Key pieces of `Component`:
- Routing: `parseHash`, `navigate(hash,{replace})`, `_routeChanged` (keeps `_stack` to know whether in-app Back can use `history.back()`), `_afterRoute` (restores per-section list scroll and per-route detail scroll, keeps the open card visible, syncs the map).
- View-model builders: `_buildChronicle`, `_buildSessions`, `_buildQuests`, `_buildPeople`, `_buildPlaces`, `_buildDetail` → `_eventVm` / `_sessionVm` / `_questVm` / `_personVm` / `_placeVm`, `_loreVm` (the one "Lore of Exandria" block shared by character and place pages, `d.lore` → `lo`), `_buildMap` (+ `_buildPins`, `_buildRoutesSvg`). `renderVals()` only builds the visible section.
- `MapViewport` — wheel/drag/pinch, clamping, centering; attached through the `vpRef` callback ref because the map only mounts on the `map` route. Touches/wheel starting inside `[data-nopan]` (popups, panel) are ignored so lists can scroll. `_centerSoon` retries centering until layout settles unless the user interacted; `_coverScale` keeps the map filling tall phone screens.
- Map: `_mapEvents` (shared filters, memoized) → `_markers` (`ChronicleMap` clusters at a quantized zoom) → `_buildPins`; `_buildRoutesSvg` draws `routeLayers` for `selectedCharacterIds(filters.pcs)` only — narrative filters never touch routes. A marker with several events opens a list popup (`state.mapList` = event ids); `_popupFrame` keeps popups on screen and is corrected once with the measured height (`data-popup` + `componentDidUpdate`).
- Language: `setLang(code)` swaps `this.t` and `this.model` (one cached model per language via `_modelFor`), updates `<html lang>`/title and re-renders in place — route, filters, scroll and map view are kept. The language is never in the URL.
- Party filter: one `filters.pcs` shared by the Chronicle chips (selection: none = all) and the map's party rows (visibility via `toggleVisibleCharacter`; all lit = `[]`, all off = `[NO_ONE]`). Matching is OR over `characterIds`; events without PCs show only with no filter or when `NO_CHARACTER` is selected.
- `DocsStore` — `localStorage` per-event title overrides (`chronicle-docs`), applied through `title(ev)`.
- Persistence: filters in `sessionStorage` (`chronicle-filters`); grouping/sort prefs (`chronicle-prefs`), theme (`chronicle-theme`), language (`chronicle-lang`) and the first-visit guide flag (`chronicle-tutorial-seen`) in `localStorage`.
- Theming: CSS custom properties on `.cc-app.theme-dark` / `.theme-light` (values carried over from the original `THEMES`).

### Data

`componentDidMount()` fetches `characters`, `routes`, `events`, `sessions`, `quests` (required), `npcs`, `locations`, `lore` (optional; 404 = none) and `data/i18n/es-AR.json` (optional content translation, always loaded so search is bilingual), then `this.model = this._modelFor(lang)`. Data-quality issues are logged to the console as warnings. The full schema is documented in `README.md`; in short:

- `events.json` — the core entity. `{id, session, title, summary}` required; optional `campaignDay`, `igDate`, `igLabel`, `order`, `type`, `description`, `consequences[]`, `locationId`, `xp`/`yp` (both or neither — events without coordinates have no pin), `characterIds[]` (PCs only), `npcIds[]`, `questIds[]`, `relatedEventIds[]`. `date` is a legacy sort key, **not** the real play date.
- `sessions.json` — keyed by session number; `title`, `playedOn` (real date), `dateLabel`, `ig{start,end,rest}`, `effects[]`, `activePlots[]`/`completedPlots[]` (each plot may carry `questId`).
- `quests.json` — `{id, title, status, giver, giverId?, summary, objectives?[], sessions[], characterIds[]}`.
- `characters.json` (PCs) / `npcs.json` (`category`: person|deity|creature|faction, `aliases[]`, `race`, `factionIds[]`, `relations[{id,label,reverseLabel}]`) — ids must be unique across both files.
- `locations.json` — `{id, name, aliases[], kind, parentId}`; no coordinates (map focus comes from the place's first event with `xp`/`yp`; planes never get one).
- `routes.json` — `{ pcId: [{xp, yp, leg?, break?, session?, locationId?}] }`. The **only** source of dashed lines (never derived from events). Order kept (revisits stay); `break: true` = unrecorded gap, no line; same `leg` id on ≥2 visible characters = one shared line. Never edit coordinates for presentation.
- `lore.json` — Lore of Exandria (Critical Role canon), a layer *beside* the campaign: `{ sources: {id:{label,url?,community?,spoilers?}}, entries: { <personOrPlaceId>: { references:[{source,url,title}], summary?, facts?:{<LORE_FACTS key>:text}, basedOn?, lastReviewed? } } }`. Never alters campaign fields, relations or search (a test compares builds with/without it). Summaries/facts without a valid https reference are rejected. Rendered as a collapsed `<details key=…>` at the end of the page (folds again per entity), links `target=_blank rel="noopener noreferrer"`. Curated, original, spoiler-free text only — no fetching/scraping Fandom at runtime, no images; DM-original NPCs get no lore. Spanish under `lore` (and `loreSources`) in `data/i18n/es-AR.json`.
- `data/i18n/es-AR.json` — Spanish content keyed by id (`events`, `sessions` by number with positional `activePlots`/`completedPlots`/`npcs`/`notes`/`effects`, `quests`, `people`, `places`). English `data/*.json` stays the source of truth; never translate ids, dates, coordinates or `questId`s. Session-log name matching always uses the English `name` (`nameEn`).

Links are stored once and reversed in the model. Session-log `npcs[].name` entries attach to a person/place only on an exact (case-insensitive) match with a `name` or `alias` — never fuzzy matching.

> **Quests vs. session plots — intentional two-view split (do not "de-duplicate").** `quests.json` is the current campaign-level rollup (one row per quest, with `status`). The `activePlots`/`completedPlots` inside `sessions.json` are the *per-session snapshots* of those threads (evolving text). They deliberately overlap in narrative; plots point at their quest with `questId`, and quests list their sessions in `sessions[]`. Maintaining a quest means updating **both**: the session's plot (history) and the quest entry (current state).

### Assets

- `assets/exandria-map.jpeg` — full-resolution map (~15 MB, 8100×5400); preloaded from JS only when the zoomed map needs it.
- `assets/exandria-map-preview.jpeg` — 2400×1600 copy for the map's first paint and the event mini-maps.
- `assets/icon-{ayante,ereldra,mortis,sorfon}.jpeg` — circular PC portraits; `assets/icon-bund-der-vier.png` — shared multi-character seal.

### Adding a new session or event

1. Add the session to `data/sessions.json` (keyed by number, with `title` and `playedOn`).
2. Append events to `data/events.json` (`session`, `campaignDay`, `igLabel`, `type`, links). Add any new NPCs/places to `npcs.json`/`locations.json` first.
3. Route waypoints go in `data/routes.json[characterId]` as `{xp, yp}` percentages, if the party moved — shared `leg` id when they travelled together, `"break": true` after an unrecorded jump. Don't invent journeys that weren't played.
4. Update `data/quests.json` (status, summary, `sessions[]`) and give the session's plots their `questId`.
5. If a new NPC/place is a verified canon entity, optionally add its reference + spoiler-free summary to `data/lore.json` (README checklist).
6. Add the Spanish text to `data/i18n/es-AR.json` (events `title`/`summary`/`igLabel`; the session log; changed quests). Missing entries fall back to English.
7. Run `npm test` (or at least `node tools/validate-data.js`). All `data/*.json` files must stay valid JSON — no comments, no trailing commas, all keys quoted.
