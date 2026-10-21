# Development

Everything needed to run, test, change and publish Crónica de Exandria: requirements, commands, the test suites, data validation, how a package exported from the Taller is incorporated, GitHub Pages, and fixes for frequent problems.

← [Back to the README](../README.md) · Related: [Architecture](architecture.md) · [Data model](data-model.md) · [`CLAUDE.md`](../CLAUDE.md)

**Contents:** [Requirements](#requirements) · [Running locally](#running-locally) · [Commands](#commands) · [Tests](#tests) · [Validating data](#validating-data) · [Incorporating the DM's changes](#incorporating-the-dms-changes) · [Adding content by hand](#adding-content-by-hand) · [Deploying (GitHub Pages)](#deploying-github-pages) · [Regenerating assets](#regenerating-assets) · [Updating the screenshots](#updating-the-screenshots) · [Troubleshooting](#troubleshooting)

## Requirements

| Need | For |
|---|---|
| A static HTTP server | Running the app (it is plain files; `npm start` uses `npx serve`). |
| Node.js + npm | The validator, the unit tests and the tools. The project is developed and tested with Node.js 22. |
| An internet connection | The page loads React from unpkg and the fonts from Google Fonts; `npx serve` downloads `serve` on first use. |
| Microsoft Edge (or Chrome) | The browser suite and the asset tools drive the installed browser through `playwright-core` — nothing is downloaded. |

The unit tests and the validator have **no dependencies**. `npm install` is only needed once, for `playwright-core` (the browser suite, `make-icons`, `make-textures`).

## Running locally

```bash
git clone https://github.com/BottaDev/dnd-campaign-map.git
cd dnd-campaign-map
npm start
```

`npm start` runs `npx serve -p 5500 .`; open `http://localhost:5500/`. Any static server works the same way — the app has no server-side logic. There is **no build step**: edit a file and reload the page.

> [!WARNING]
> Opening `index.html` directly (`file://…`) does not work: the page fetches `data/*.json` at runtime and browsers block `fetch` from `file://`. Always serve the folder over HTTP.

Claude Code's preview uses the same server, defined in `.claude/launch.json` (`chronicle`: `npx serve -p 5500 .`).

## Commands

| Command | What it does |
|---|---|
| `npm start` | Local server: `npx serve -p 5500 .`. |
| `npm run validate` | `node tools/validate-data.js` — the data validator. |
| `npm test` | The validator, then `node --test tests/*.test.js` (unit tests, no dependencies). |
| `npm run test:browser` | `tests/browser/smoke.mjs` then `tests/browser/taller.mjs`: the real page in the installed Edge (run `npm install` once). |
| `npm run test:taller` | Only `tests/browser/taller.mjs` (the Taller and the map editor). |
| `npm run apply-draft -- <file> [flags]` | `node tools/apply-draft.js`: incorporates a draft exported from the Taller. Note the `--` before the arguments. |
| `node tools/validate-data.js --data <folder>` | Validates with the files of `<folder>` taking precedence over the repository's (an unzipped package). |
| `node tools/apply-draft.js <cambios.json \| package.zip> [--check] [--force] [--data <folder>]` | See [Incorporating the DM's changes](#incorporating-the-dms-changes). |
| `node tools/make-icons.mjs` | Renders `assets/app-icon.svg` into the PNG app icons. |
| `node tools/make-textures.mjs "<folder>"` | Converts the design's texture layers into `assets/textures/*.webp`. |

| Environment variable | Effect |
|---|---|
| `BROWSER_CHANNEL=chrome` | Drive Chrome instead of Edge (browser suite, `make-icons`, `make-textures`). |
| `TALLER_ONLY=<regex>` | Run only the matching checks of `tests/browser/taller.mjs`. |

## Tests

```bash
npm test              # validator + node --test tests/*.test.js (no dependencies)
npm install           # once, for the browser suite
npm run test:browser  # tests/browser/smoke.mjs, then tests/browser/taller.mjs
npm run test:taller   # tests/browser/taller.mjs only (TALLER_ONLY=<regex> for a subset)
```

- **On Windows, run the browser suite from PowerShell or cmd.** Under Git Bash, Playwright's `--remote-debugging-pipe` fails and Edge exits immediately.
- The browser suite writes screenshots to `test-results/` (git-ignored). Its offline check starts its own server and stops it to simulate no connection. `tests/browser/taller.mjs` works on test data in a throw-away browser profile — it never writes to `data/`. The full suite takes several minutes.
- Tests read sources with `readText` (`tests/helpers.js`), which turns CRLF into LF: a checkout with `core.autocrlf=true` (files CRLF on disk) passes the same tests.

| Suite | Covers |
|---|---|
| `tests/filters.test.js` | The party-member filter. |
| `tests/routes.test.js` | Recorded routes: order, revisits, shared legs, breaks, filters never connecting routes. |
| `tests/markers.test.js` | One pin per coordinate, zoom-dependent groups, popups kept on screen. |
| `tests/i18n.test.js` | Languages: defaults, keys present in both dictionaries, content translation and fallback, bilingual search, dates. |
| `tests/order.test.js` | Default orders and explicit preferences. |
| `tests/design.test.js` | Visual contracts: icons, colour tokens, the single dark theme, textures, the ribbon, the illuminated initial. |
| `tests/lore.test.js` | The canon lore layer. |
| `tests/search.test.js` | The universal search. |
| `tests/find.test.js` | The Sessions, Quests and Characters searches. |
| `tests/recap.test.js` | *Previously on…*. |
| `tests/narrative.test.js` | Optional narrative fields. |
| `tests/places.test.js` | The Places index. |
| `tests/library.test.js` | Favourites and history. |
| `tests/guide.test.js` | Help centre, first-visit welcome, hints, glossary. |
| `tests/tour.test.js` | Guided tours. |
| `tests/editor.test.js` | The Taller's data core, down to `tools/validate-data.js --data` and `tools/apply-draft.js`. |
| `tests/taller.test.js` | The Taller as wired into the page. |
| `tests/pwa.test.js` | Manifest, service worker, precache. |
| `tests/browser/smoke.mjs` | The real page in Edge: languages, map, onboarding, searches, recap, Places, favourites, offline, responsive widths. |
| `tests/browser/taller.mjs` | The Taller and the map editor in Edge, end to end. |

<details>
<summary><strong>Full coverage of each suite</strong></summary>

- `tests/filters.test.js` — party-member filter (OR for shared events, order of `characterIds`, events without party members, combined filters, no duplicate pins).
- `tests/routes.test.js` — routes: order and revisits, independent and shared legs, breaks, incomplete data, filters that must not create connections, the real `routes.json` untouched.
- `tests/markers.test.js` — one pin per exact coordinate, zoom-dependent clusters, no event lost, invalid coordinates, popups kept on screen.
- `tests/i18n.test.js` — default language, persistence, every key used by `index.html` exists in both dictionaries, content translation and fallback, bilingual accent-insensitive search, localized dates, identical ids/relations in both languages.
- `tests/order.test.js` — default orders (Chronicle latest first, Sessions oldest first), explicit choices kept per section, legacy preferences migrated, numeric session order with gaps, stable same-day order, undated events last, independent of language and filters.
- `tests/design.test.js` — every event type has its own icon and a colour family with a token, every kind of place its own icon, every quest status an icon and a tone (and every quest card its status badge); one dark theme only (no light tokens, toggle or theme strings; an old preference is discarded; dark before the app boots); the Grimorio textures are small precached WebP files, dropped when saving data, never on controls or cards, leather only on the bars and map controls; the crimson ribbon only on states (open, current, saved); the illuminated initial keeps the paragraph whole for screen readers.
- `tests/lore.test.js` — canon lore: one, several or no references, invalid/unsafe URLs, new-tab `rel`, summaries with and without translation, facts, unsourced lore rejected, the real `lore.json` (sourced, https, bilingual, reviewed, each link on its own source's wiki — Critical Role Wiki or Forgotten Realms Wiki), texts that name no single world, and campaign data identical with and without lore.
- `tests/search.test.js` — universal search: every kind of entry, grouping and relevance (names first), entries linked to a person, bilingual, accents/case, aliases and name prefixes, session numbers and campaign days, empty and no-result queries, highlighting, same ranking in both languages, the Chronicle's own search unchanged (and *See all in the Chronicle* showing exactly the same events).
- `tests/find.test.js` — the Sessions, Quests and Characters searches (Characters: exactly the same people as its filter always found, now with the reason — an alias, the kind, the role —, translated aliases that do not line up still found, numbers read as words); a session number means that session only (never stray digits, an unchronicled number finds nothing), titles partly typed, what was recorded (opening/closing lines, plots and notes, effects, events and their kind), people, places (with the places they lie in) and quests linked explicitly — never through links of links —, quests by title, summary, objectives, giver, session notes, events, people, places and session number, both languages/accents/case, no results and nothing typed, the Sessions order kept, status AND words for Quests, the excerpt that says why an entry appeared, a label for every place a word can be found; the `index.html` wiring (one field behaviour, header → search → order/status → list, nothing stored, the count said once typing pauses, the tour setting the searches aside and giving them back).
- `tests/recap.test.js` — Previously on…: latest session by number (gaps, stubs, out-of-order keys), sessions without summary/events, several events, editorial highlights (validated, order kept), pending threads and events' open questions, nothing invented (every text traced to the data), translation and fallback.
- `tests/narrative.test.js` — optional `description` / `consequences` / `unresolved`: present, absent, malformed, translated (positional lists by length, fallback per field), searchable, relations untouched.
- `tests/places.test.js` — the Places index: story order, the Atlas and the other planes split by the recorded kind only, default folding (top level open), one branch / everything open or closed, opening a place unfolds its ancestors only (never the place itself, never closing another branch), the contextual search (nested matches with their ancestors as context, kinds and aliases in both languages, case and accents, no results) and the folding back as it was after it, places without parent, kind or map position, unknown parents and `parentId` loops (reported, broken, no place lost); the accessible wiring in `index.html` (carets are buttons with `aria-expanded`/`aria-controls` on a nested list, names are links with `aria-current`, the breadcrumb navigation, nothing stored).
- `tests/library.test.js` — favourites and history: add/remove/toggle, persistence, newest first, no consecutive duplicates, 5 shown / 20 kept, stale references pruned, corrupt or old-format storage, storage blocked or full (in-memory fallback), other tabs.
- `tests/guide.test.js` — the help centre: three tours, one-line section descriptions, six short answers in both languages; the first-visit welcome (by itself on the Chronicle's home only, a non-modal labelled dialog, *Comenzar recorrido* / *Ahora no* and `Esc`, the focus taken once, above the bottom bar on phones; the old inline introduction gone); the help reachable from `?`, the Chronicle, More and the map; contextual hints (filters, recap source, lore); the glossary covering every event type, family and status; no images; the old three-card tutorial gone.
- `tests/tour.test.js` — the guided tours: the main tour's eight steps (sections, Chronicle, Sessions, Quests, map marker and card, search, help last) and *Step N of 8* on every screen size; Sessions always explained and every step adapting to what the campaign holds (no sessions, quests, events or located events — 7 steps then) instead of disappearing; a fallback for every step that depends on an element or an example (none skipped in silence); help as the real `?` or *More → Help* on phones; the map/search tours reusing the same step logic; the action that moves each step on; the screen and panels each step needs; every text in both languages (short, parameters filled) and consistent controls (*Siguiente*, *Anterior*, *Finalizar*, *Omitir tutorial*); the versioned onboarding keys (version 3, completion ≠ dismissed welcome, re-offered on a new version, other data untouched, storage blocked); real examples; the runtime against a stand-in Driver.js and DOM (the eight steps on the real elements, buttons per step, the spotlight closing before a screen change, the visitor's tap moving on, *Siguiente* waiting for its popover, fallbacks without markers, events or sessions, the phone's More → Help); and the `index.html` wiring (one history entry, Back/Esc/arrows, context restored, leaving early dismisses the welcome, Driver.js vendored and precached).
- `tests/editor.test.js` — the Taller's data core (`js/chronicle-editor.js`): pointer ↔ map percent through the map's on-screen box, the same point at any zoom and pan (against the viewport's own arithmetic), clamping, two decimals, one-pixel steps, the text to copy; places' own positions in the model (exact/approximate, never on other planes, never moving an event) and `ChronicleModel.validateData` (the validator's rules, the real data clean); suggestions (the place's own position, then earlier events, places inside, places around; never from the event itself; nothing invented); drafts (published version kept per change, back-to-published leaves the draft, tidy records keeping the published key order, new/modified/deleted/reverted); both languages' lists kept aligned; applying a draft (untouched records exactly as published, new events after their session, Spanish-only texts also English, empty items dropped in both languages); every data file written back byte for byte, only changed files and lines exported; conflicts (detected, field by field, combine/keep mine/take theirs, ids taken, records removed); validation codes per record and field, only what the draft introduced; ids after the repository's conventions and renames that carry their links; the ZIP (read back, CRC, Windows' `tar` opens it); draft files (round trip, malformed entries skipped, no prototype pollution); imports (merge, data files as changes, never deletions); storage revisions and backups; and the whole path in Node down to `tools/validate-data.js --data` and `tools/apply-draft.js` (which stops on a conflict).
- `tests/taller.test.js` — the Taller as wired into the page: its strings complete and aligned in both languages (and the keys `index.html` keeps), every string and issue code it uses translated, the new routes (`#/taller/…`, `#/map/edit…`, `#/map/near/…`) never opening the public reading pane, history or favourites, the lazy loading (no `<script>` tag, not precached, kept offline after first use), isolation (IndexedDB only, no HTML from data, no external host, no credentials), the preview built by the public view-models on the draft's model with inert links, the map editor reading the pointer through `[data-world]`.
- `tests/pwa.test.js` — manifest (relative scope, dark colours, icons with real sizes, maskable), `index.html` wiring, every precached file exists and every startup file is precached, the 15 MB map never stored, versioned caches and network-first updates, user data kept out of the caches.
- `tests/browser/smoke.mjs` — drives the real page with `playwright-core` (no browser download): the language switch keeps the route, no English left in the Spanish UI, map filters/routes/clusters, phone taps, pinch and pan, every popup on a 320×640 screen, no horizontal scroll at 320/360/390/430/768/1280 px; the lore section (collapsed by default, folds again on the next entry, opens the article in a new tab without `window.opener` — Fandom is stubbed, never contacted —, ES ↔ EN, Chronicle → entry → Back, tap targets and readability at 320/360/390/430 px); dark-only theme (an old light preference is removed, no light flash, map controls and panels dark); default orders and their toggles (kept per section, across reloads and languages, with filters); every event card with its type icon, label and family colour, title larger than metadata, compact height; every quest card with its status badge beside the title (under it on a 320 px phone, the cards inside their list, the open card's ribbon clear of the badge) and the people chips with the role, kind or part played under the name (ES/EN, only the longest role cut on a phone); the onboarding (the first-visit welcome appearing by itself once loaded — a non-modal card, the page usable under it, the focus taken once, gone over an open entry and back on the home; the main tour's eight steps by real clicks and *Siguiente* across five screens — sections, a day of the Chronicle, a session, the quests' filter used, a real marker tapped and its card, the magnifier, the `?` — with *Paso N de 8*, *Anterior*, *Finalizar*, *Omitir tutorial* and *Ver más tutoriales*; at 320/360/390/430/768/1280 px the welcome fits and every popover is on screen, off its control (under 10 %), the control still tappable; *Ahora no*, `Esc` in the welcome and leaving the tour early all keep the welcome away (reloads included) and leaving early restores route, scroll and filters; the help centre restarting the tour from step 1, Back and *Omitir tutorial* restoring the start, the map tutorial restoring filters and panels; a direct link or another section never interrupted, the welcome waiting for the home; the phone path with the welcome above the bottom bar and help shown in *Más → Ayuda*; keyboard, labelled dialog, visible names, the highlight ring, focus return and reduced motion; a first visit in English and a language change mid-tour; a campaign without sessions or events — seven steps, every section explained on its heading; the map tutorial waiting for the lazy map and the map working after; the search tutorial; the help centre on a 320 px phone with the glossary); the search (`Ctrl+K`, groups with the name first, keyboard to a result, one Back to return, bilingual/no accents, empty and no-result states, from Quests and the Map, hand-off to the Chronicle filter, full screen on a phone with 44 px rows and Back closing it); the recap (session 12 by number, real events, ES/EN, from Sessions, 320 px); the Places index (the main places and their first level open, carets by mouse/`Enter`/`Space` that never open the place, *Expand all* / *Collapse all*, a deep link unfolding the branches above it, the breadcrumb going up, the search keeping its matches' ancestors as context, highlighted, *no results* handing over to the universal search, the folding back as it was; the row's map action and the page's map preview, nothing for other planes, a note for places without a position; everything expanded at 320 and 375 px without sideways scroll and with comfortable targets, Back keeping the folding; ES ↔ EN keeping the filter and the folding); the Sessions and Quests searches (a number, a title, a word from the logs with the reason line and the mark, the count, the order, accents and case, no results with its way out, ✕ / `Esc` keeping the focus, the count said once typing pauses; status AND words, either kept when the other changes, *See N in other statuses*; kept after opening an entry and coming back — beside the list and with Back on a phone, scroll included — and across sections, gone after a reload; the Characters search with its count, the reason on a row's quiet line (alias, kind, role), marked names, no results, `Esc` and ES ↔ EN; the three fields and their hints at 320/360/390/720/768/1024/1440 px without sideways scroll; ES ↔ EN; the main tour showing the real list and giving the searches back); favourites and history (star, order, reload, remove, clear, stale references, storage blocked); offline (installability, reload with the server gone, favourites kept, the full map not stored, new content shown once back online and becoming the new offline copy); and no horizontal scroll inside the search or the help at every width. Set `BROWSER_CHANNEL=chrome` to drive Chrome instead of Edge.
- `tests/browser/taller.mjs` — the Taller and the map editor in the real page, on test data in a throw-away browser profile (nothing is written to `data/`): a click lands on the exact map percent; the same map point keeps its coordinates at zoom 1, zoomed with the wheel, after panning and with the buttons; dragging the marker (the map does not move), arrow keys (one screen pixel, Shift ten), typed values and clicks off the picture clamped to the map; *Cancel* stores nothing, *Confirm* stores only that event, and the public map, its 33 pins and the journeys stay as published; choosing by marker, a place's own position with its precision, a phone placing by tap with the compact sheet (no map movement, no sideways scroll); the whole path — a test session 99 with two events, a party member, a quest (and the fix listing the session), a position through the map editor and back to the form, saved, reloaded, absent from the public Sessions, exported, the package's files accepted by `tools/validate-data.js --data` and reproduced exactly by `tools/apply-draft.js`, discarded and imported back; invalid data blocking the export until fixed; newer published data shown as a conflict, combined, and kept in the export; two tabs never overwriting each other; preview links inert, every form control labelled, English interface, no sideways scroll on a phone; a new quest, place and character from their dialogs (ids from their names) and a place that can never be put inside itself or what it holds; deleting an event mentioned elsewhere (the mentions removed with it); discarding everything and restoring the backup; closing the page with a move not confirmed asks first; a place's own position on its page, on the map beside it and through `#/map/near/…` on a phone; typing measured per key on the real data; no console errors or missing strings. Chrome delivers whole-pixel pointer coordinates, so those checks click whole pixels; a click on a marker chooses it (it never re-places the marker being dragged).

</details>

## Validating data

```bash
node tools/validate-data.js                  # or: npm run validate
node tools/validate-data.js --data <folder>  # an unzipped package's data/ folder takes precedence
```

It runs the page's own model (`js/chronicle-model.js`) over `data/*.json` and `data/i18n/*.json`: JSON syntax, duplicate ids, every cross-reference, coordinates, route waypoints and shared legs, asset paths, the lore layer and the translations (unknown ids, positional array lengths, coverage), plus the file-system checks (portraits exist, every file in `sw.js`'s `PRECACHE` exists). Errors exit with code 1; warnings do not fail. The full list of rules is in [Data model › Validation](data-model.md#validation-and-integrity-rules).

Its last lines report counts, translation coverage and what is still to be written, for example:

```text
52 events (0 without map position) · 8 sessions · 19 quests · 4 PCs · 44 NPCs/factions · 33 places (0 with their own map position) · lore for 25 entities (25 links)
Translated es-AR: events 52/52 · sessions 8/8 · quests 19/19 · lore summaries 25/25
Pending to write: sessions not chronicled 3–7, 9 · events with description/consequences/unresolved 0/52 · sessions with an editorial recap 0/8
```

Run it after any change to `data/`, and before committing.

## Incorporating the DM's changes

The DM prepares content in the Taller del Cronista and exports a package — `cronica-cambios-YYYY-MM-DD-HHMM.zip` with `LEEME.txt`, `cambios.json` and the changed `data/*.json` files. **Nothing is published until the maintainer incorporates it and pushes.** The DM's side is described in the [Taller guide](editor-guide.md).

**Recommended: `tools/apply-draft.js`** (Claude Code or a terminal in the repository):

```bash
node tools/apply-draft.js cronica-cambios-2026-10-19-2130.zip --check   # report only, writes nothing
node tools/apply-draft.js cronica-cambios-2026-10-19-2130.zip           # apply
npm test
git diff data/
```

The input can be the exported `.zip` or its `cambios.json`. What it does:

- applies **only the draft's changes** to the **current** `data/` files, so anything committed after the export is kept, in each file's own layout;
- skips changes the data already holds (running it twice on the same package is harmless);
- **stops with a list of conflicts** when a record changed in the repository after the DM started editing it — resolve them in the Taller (import the draft, then *Borrador* → conflicts) and export again, or re-run with `--force` to let the draft win, after reading the list;
- **refuses drafts with validation errors** (fix them in the Taller and export again);
- `--data <folder>` updates another folder instead of `data/`.

| Exit code | Meaning |
|---|---|
| 0 | Applied, or nothing to change (the data already holds the draft). With `--check`: report printed, nothing written. |
| 1 | Bad usage, not a Taller draft, a ZIP without `cambios.json`, or validation errors — nothing written. |
| 2 | Conflicts — nothing written (use `--force` only after reading the report). |

Then run `npm test`, review `git diff data/`, commit and push; GitHub Pages publishes the new version. The next time the DM opens the Taller, the changes that are now published leave the draft by themselves.

**Without a terminal (GitHub's web upload):** replace the files in `data/` with the package's — only if nobody changed those files since the export date written in `LEEME.txt` (otherwise newer work would be overwritten). To check an unzipped package first: `node tools/validate-data.js --data <unzipped folder>/data`.

## Adding content by hand

The Taller del Cronista does steps 1–7 through forms and exports a package (then `node tools/apply-draft.js <package>` writes it into `data/`). By hand:

1. **New session:** add its entry to `sessions.json` (with `title` and `playedOn`), then one object per beat to `events.json` (`session`, `campaignDay`, `igLabel`, `type`, links).
2. **People and places:** add new NPCs to `npcs.json` and places to `locations.json` *before* referencing them from events (`npcIds`, `locationId`). Add an `aliases` entry when the session log names someone differently.
3. **Quests:** link events with `questIds` and plots with `questId`; update the quest's `summary`, `status` and `sessions[]` in `quests.json` (both views — see [quests vs. plots](data-model.md#questsjson)).
4. **Movement:** if the party travelled, append the waypoints to each traveller's array in `routes.json` — with a shared `leg` id if they went together, and `"break": true` on the first point after an unrecorded jump. Don't invent journeys that were not played.
5. **Narrative depth (optional):** for the session's important moments, add `description`, `consequences` and `unresolved` — only with what happened at the table.
6. **Recap (optional):** give the session a `recap` with 3–5 `highlights` and/or a `summary`.
7. **Translation:** add the Spanish text for the new events, session or quest to `data/i18n/es-AR.json`.
8. **Lore (optional):** if a new NPC or place is a verified canon entity (Exandria's, from the Critical Role Wiki, or another D&D setting's, from the Forgotten Realms Wiki), add a reference and a spoiler-free summary to `lore.json` ([checklist](data-model.md#adding-lore-for-an-entity--checklist)).
9. **Offline copy:** only if you added a *new file* the page loads at start (a new `data/*.json`, script or portrait), list it in `PRECACHE` in `sw.js` and bump `VERSION`. New content in existing files needs nothing.
10. **Validate and test:** `npm test` (or at least `node tools/validate-data.js`).

> [!IMPORTANT]
> Keep each file's own JSON layout ([data model › Files](data-model.md#files)): `npm test` fails when a data file is not exactly what the Taller would write. Copy the shape of a neighbouring record.

## Deploying (GitHub Pages)

The published app is <https://bottadev.github.io/dnd-campaign-map/>, served by GitHub Pages straight from the repository:

1. Commit everything the page needs (`index.html`, `support.js`, `js/`, `locales/`, `vendor/`, `data/`, `assets/`, `sw.js`, `manifest.webmanifest`).
2. In the repository's **Settings → Pages**, deploy from the `main` branch (root folder).
3. Every push to `main` publishes a new version; there is no build or CI step to maintain.

All paths are relative and navigation uses hash URLs, so the app works from the project sub-path with no server configuration. `sw.js` and `manifest.webmanifest` must stay at the root, next to `index.html`. Visitors get new content on their next load (the service worker is network-first); bump `VERSION` in `sw.js` only when `PRECACHE` changes.

## Regenerating assets

- **App icons** — after changing `assets/app-icon.svg`: `node tools/make-icons.mjs` renders `app-icon-180.png`, `app-icon-192.png`, `app-icon-512.png` and `app-icon-maskable-512.png` (PowerShell/cmd on Windows, after `npm install`).
- **Textures** — `node tools/make-textures.mjs "<folder with a-paper.png and c-leather.png>"` converts the design handoff's PNG layers (506 KB / 445 KB) into `assets/textures/paper.webp` (126 KB) and `leather.webp` (97 KB): lossless WebP (lossy WebP is larger for this kind of noise) after rounding each alpha to a multiple of 4, which moves no rendered pixel by more than 2/255.
- **Map preview** — if the map is ever replaced, regenerate `assets/exandria-map-preview.jpeg` at the same aspect ratio (2400×1600 for an 8100×5400 map); positions are percentages of the picture, so the geometry must not change ([map system › Limitations](map-system.md#limitations)). There is no tool for this in the repository.
- **`support.js`** — a generated bundle; the source lives in a separate `dc-runtime` repository (`cd dc-runtime && bun run build`). Never edit it by hand.

## Updating the screenshots

The screenshots in `docs/images/` are real captures of the app (Spanish interface, Microsoft Edge headless), saved as WebP (quality 0.8):

| Image | Route | Viewport |
|---|---|---|
| `chronicle-desktop.webp` | `#/chronicle/event/s12_06` | 1440×900, scale 1.25 |
| `interactive-map.webp` | `#/map/at/s8_06` | 1440×900, scale 1.25 |
| `chronicle-workshop.webp` | `#/taller/event/s11_06` | 1440×900, scale 1.25 |
| `map-editor.webp` | `#/map/edit/s8_06`, marker moved with Shift+→ ×4 and Shift+↑ ×3, not confirmed | 1440×900, scale 1.25 |
| `map-editor-suggestion.webp` | `#/map/editplace/kraghammer` | 1440×900, scale 1.25 |
| `workshop-home.webp` | `#/taller`, scrolled to the local-draft warning | 1440×900, scale 1.25 |
| `workshop-draft.webp` | a position confirmed in the map editor (Ctrl+Enter), then `#/taller/tab/draft` | 1440×900, scale 1.25 |
| `mobile-view.webp` | `#/chronicle`, `#/chronicle/event/s11_06` and `#/map` at 390×844 (scale 3), side by side in a 1440×900 frame | 1440×900, scale 1.25 |

Each capture used a fresh browser profile with reduced motion, the service worker blocked and the onboarding flags set (`chronicle-tour-version` = `3`, `chronicle-tour-invite` = `dismissed`), so the first-visit welcome does not cover the screen. Retake them after visible interface changes, keeping the same 16:10 frame so the README gallery stays even.

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| The page says the chronicle could not be loaded, with a hint about serving the folder | It was opened through `file://`. Serve it over HTTP (`npm start`). |
| On a first visit without connection the page never finishes loading (or shows Georgia instead of the Grimorio fonts) | React and the fonts come from CDNs. After one visit online they are kept for offline use. |
| Port 5500 is busy | Use another port: `npx serve -p 5501 .`. |
| Edits do not show up | The service worker is network-first, so a reload is normally enough; if a stale copy persists, unregister it or enable *Update on reload* in the browser's developer tools (Application → Service workers). |
| `npm test` fails on *export · every data file is written back byte for byte* | A hand edit changed a data file's layout. Format the record like its neighbours ([layouts](data-model.md#files)). |
| The validator reports *sw.js precaches "…", which does not exist* | A file listed in `PRECACHE` was renamed or removed: fix the list and bump `VERSION`. |
| `npm test` cannot find `tests/*.test.js` on Windows | `npm` runs scripts through `cmd`, which does not expand the pattern; recent Node versions expand it themselves. Use Node.js 22. |
| The browser suite fails at once, Edge exits immediately | It was run from Git Bash. Run it from PowerShell or cmd. |
| The browser suite cannot find a browser | Install Microsoft Edge, or set `BROWSER_CHANNEL=chrome` to use Chrome. |
| `apply-draft` exits with code 2 | Conflicts: records changed in the repository after the DM started editing. Resolve them in the Taller and export again, or use `--force` after reading the list. |
| `apply-draft` says *Not a Taller draft* | Pass the exported `.zip` or its `cambios.json` — a data file such as `events.json` is not a draft. |
| `apply-draft` reports errors and writes nothing | The draft has validation errors: fix them in the Taller (*Borrador* → *Validación*) and export again. |
