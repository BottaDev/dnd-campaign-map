# Campaign Chronicle

An archive of the adventures of a D&D party: a narrative chronicle of every event in the campaign, linked to the sessions, quests, characters and places it touches — with the interactive campaign map as a companion for geography. It is a single static page (no backend, no build step) that works on desktop, tablet and phone, in **Spanish (Argentina, the default) and English**: interface *and* narrative content.

The party name, world name, and other branding text live in the interface dictionaries (`locales/*.js`) — edit them there if you reuse this for a different campaign.

Live version: served via GitHub Pages from this repo (see [Deploying](#deploying-github-pages)).

## Using the page

The app has six sections. On desktop and tablet they are tabs in the top bar; on a phone, **Chronicle**, **Sessions** and **Quests** sit in the bottom bar and **Characters**, **Places** and **Map** are under **More**.

| Section | What it shows |
|---|---|
| **Chronicle** (home) | Every event as a narrative timeline grouped by campaign day (or by session), **latest first** by default (one tap switches to oldest first; inside a day the events keep their recorded order). Each card shows the event's type as an icon, colour and label. Free-text search (in both languages, ignoring accents and case) plus filters for party member, NPC/deity/faction, quest, session, event type, place, in-world period (campaign days) and real-world play date — all combinable. Typing a search also lists matching people, quests, places and sessions. |
| **Sessions** | The sessions played, **oldest first** by default (or latest first), in numeric order with gaps for sessions that were never written up. A search above the order finds a session by its **number** (`12`, `s12`, `Sesión 12`, `Session 12` — that session only, never stray digits), its **title**, what its log and its events recorded (opening and closing lines, events, plots and their notes, effects, in-world dates) and who and where it involved (people, places — a place counts with the places it lies in —, quests): either language, no accents or capitals needed, results as you type in the chosen order, a count (*3 of 6 sessions*), and on each card the words marked and, when they were not in the title, a short line saying where they were found. Each session page has the real date it was played, the in-world days it covered, where it started and ended, its events, the quests in play, the people and places involved, active effects and unresolved threads. |
| **Quests** | Every quest by status. A search above the status filter finds quests by name, summary, objectives, giver, the session notes of their thread, the events that moved them and the people and places linked to them; it combines with the status (*In progress* + `Cassandra` = the quests in progress that mention Cassandra), neither clears the other, the count reads *4 of 17 quests*, matches hidden by the status are one tap away (*See 2 in other statuses*), and *no results* names both criteria. A quest page shows where it stands now and *the story so far*: session by session, the events that advanced it and the session-log snapshot of the thread. |
| **Characters** | The party and every NPC, deity and faction recorded in the session logs, with a search above them (name, alias, kind or role, either language): a count (*3 of 42 characters*), the names marked and, when the name does not hold the words, the row's quiet line saying why (*Alias · …*, or the kind or role it already shows, marked). A character's page lists their relationships (both directions), factions/members, appearances, quests, places, and everything the session logs noted about them. |
| **Places** | An atlas index: the places as a tree of what lies inside what (continent › city › district › site), the *Atlas of Exandria* apart from the *other planes*. Each row has the kind's icon, the name, the kind, how many events were recorded there or inside, and the map one tap away. Branches fold and unfold with their caret — the main places and their first level start open, *Expand all* / *Collapse all* sit above the tree, and opening a place unfolds the branches above it — and a filter finds a place by name, alias or kind (either language, no accents needed) while keeping where it lies in view. A place's page starts with its location (each step a link one level up), a small map preview, then what happened there and what lies inside. |
| **Map** | The full interactive map — pan, zoom (wheel, buttons, pinch), event pins captioned by session, nearby pins gathered into numbered seals that split as you zoom in, each character's recorded journeys as dashed lines, party toggles. Tapping a pin shows the event (**Read entry** opens it, **Session log** opens that session); tapping a group lists its events. |

Tools available from every section — they never add a tab or a permanent bar:

| Tool | Where | What it does |
|---|---|---|
| **Search** (magnifier) | top bar on every screen (also on phones); `Ctrl+K` / `⌘K` | One search over **everything**: characters, NPCs, deities, factions, events, quests, places and sessions, grouped by kind with an icon, the name and one context line. Direct name matches come first (one relevance scale for every kind); a person also finds the events, quests and sessions linked to them. Works in Spanish and English whichever the interface is in, ignores case and accents (`revelacion` finds *Revelación*), understands `12` / `s12` / `sesión 12`. `↑ ↓ Enter Esc` on a keyboard; on a phone it opens as its own screen with the field at the top (results stay above the keyboard). Nothing typed yet → your recently viewed entries. Many events → *See all in the Chronicle* applies the same text as a Chronicle filter. |
| **Previously on Bund Der Vier…** | one line under the Chronicle and Sessions headings | A recap of the **latest session** (the highest session number with a log): where the party was left, the recorded events (or the editor's highlights), decisions, threads still open, quests in play, effects at the session's end, and links to the full log and to its events in the Chronicle. Built only from the data — see [`recap`](#sessionsjson). |
| **Saved** (star) | top bar on desktop; **More → Saved** on phones | Favourites (tap ☆ in any entry's top bar) and the last five entries you opened. Kept in this browser only (`localStorage`): no account, no sync. |
| **Guided tours** | the first-visit welcome on the Chronicle; **Help**; the map's **How does it work?** | Interactive walk-throughs on the real page ([Driver.js](https://driverjs.com/)): a popover points at a real control and explains it; where it is safe the visitor can use it (tap a marker, filter the quests) and the tour follows, and *Next* moves on across screens. The main tour has **8 steps**, one idea each: the sections (the bottom bar and *More* on phones), the Chronicle, Sessions, Quests, the map (a real marker, then the card it opens), the search, and — last — where the help and the tours live (the **?** button; *More → Help* on phones). Two specific ones go further: *Using the map* and *Finding information*. *Step N of M*, *Skip tour* on every step, repeatable from the help; see [Onboarding and guided tours](#onboarding-and-guided-tours). |
| **Help** (`?`) | top bar; **More → Help** on phones; *How does it work?* next to the Chronicle's quick actions | *How the Chronicle works*: the three tours (with a *Done* mark), what each section holds, six short answers to frequent questions. |
| **Icons & colours** | second tab of the help; **More → Icons & colours** | The glossary: every event type with its icon and colour family, the quest statuses, the map's pins, seals and route lines. |

The Chronicle opens with two quick actions — **Catch up** (the latest session's *Previously on…*) and **Find something** (the search) — and a quiet *How does it work?* link to the help. On a first visit, once the chronicle has loaded, a **welcome** card appears by itself on the Chronicle's home — floating in a corner (above the bottom bar on phones), not a modal: the page stays usable — saying what the Chronicle is and offering the guided tour (*Start the tour* / *Not now*). A link straight to an entry or another section is never interrupted: the welcome waits until the visitor reaches the Chronicle's home, and once answered (or the tour finished or left) it does not come back by itself. Small hints appear only where a control is not obvious: how the Chronicle's filters combine, where *Previously on…* comes from, and that the Lore of Exandria is outside information that may contain spoilers. Each tab's tooltip says in one line what the section holds.

Opening anything (an event, session, quest, person or place) shows its full page: beside the list on wide screens, full-screen with a **Back** button on phones. Everything links to everything else, and **Back** (the app button, the browser button or Android's back gesture) returns to where you were, with filters and scroll position kept. An event with a location offers **View on map** and a small expandable map preview; the map is never opened automatically. Characters and places that also exist in Critical Role's Exandria end with a folded **Lore of Exandria** section — a short, spoiler-free summary and a link to the source article (see [`lore.json`](#lorejson--lore-of-exandria)); our own story always comes first.

Each section's own search (Sessions, Quests, Characters, Places) behaves the same: ✕ or `Esc` clears it and keeps you in the field, and what you typed stays while you open an entry and come back, visit another section or switch language — until the next visit, so an old search never leaves a section looking empty. Keyboard: `Ctrl+K` / `⌘K` opens the search from anywhere, `/` jumps to the Chronicle's filter box, `Esc` closes the search, the help or the open page; during a tour `→` / `←` move between steps (unless you are typing), `Tab` stays inside the tour and `Esc` leaves it; in the first-visit welcome `Esc` means *Not now*. Dialogs keep the keyboard focus inside and give it back when they close; Back (including Android's gesture) closes an open search or help — or ends a running tour where it started — instead of leaving the page. The app has a single dark theme. The Chronicle and Sessions orders are remembered separately, but only once you change them — until then each opens on its default. **ES / EN** in the top bar (on every screen size) switches the language in place — same page, filters and map view — and is remembered for the next visit.

Every page has a shareable URL (the language is a personal preference, never part of the link, so the same URL works for everyone), e.g. `#/chronicle/event/s8_04`, `#/sessions/session/12`, `#/quests/quest/cassandra`, `#/characters/character/locus`, `#/places/place/vasselheim`, `#/map/at/s11_06`, `#/chronicle/recap/12` (Previously on…, session 12). `#/saved` opens your own favourites and history (they live in your browser, so that link shows each reader their own).

After one visit the chronicle is also readable **offline** and can be **installed** like an app from browsers that offer it (see [Offline and installing](#offline-and-installing-pwa)).

## Running locally

The page fetches its data with `fetch()`, so it must be served over HTTP (opening `index.html` via `file://` fails to load the data):

```bash
npx serve -p 5500 .
```

Then open `http://localhost:5500/`. There is no build step — edit files and reload.

## Tests

```bash
npm test              # data validator + unit tests (node --test, no dependencies)
npm run test:browser  # real-browser checks (run npm install once; drives the installed Edge)
```

- `tests/filters.test.js` — party-member filter (OR for shared events, order of `characterIds`, events without party members, combined filters, no duplicate pins).
- `tests/routes.test.js` — routes: order and revisits, independent and shared legs, breaks, incomplete data, filters that must not create connections, the real `routes.json` untouched.
- `tests/markers.test.js` — one pin per exact coordinate, zoom-dependent clusters, no event lost, invalid coordinates, popups kept on screen.
- `tests/i18n.test.js` — default language, persistence, every key used by `index.html` exists in both dictionaries, content translation and fallback, bilingual accent-insensitive search, localized dates, identical ids/relations in both languages.
- `tests/order.test.js` — default orders (Chronicle latest first, Sessions oldest first), explicit choices kept per section, legacy preferences migrated, numeric session order with gaps, stable same-day order, undated events last, independent of language and filters.
- `tests/design.test.js` — every event type has its own icon and a colour family with a token, every kind of place its own icon, every quest status an icon and a tone (and every quest card its status badge); one dark theme only (no light tokens, toggle or theme strings; an old preference is discarded; dark before the app boots); the Grimorio textures are small precached WebP files, dropped when saving data, never on controls or cards, leather only on the bars and map controls; the crimson ribbon only on states (open, current, saved); the illuminated initial keeps the paragraph whole for screen readers.
- `tests/lore.test.js` — Lore of Exandria: one, several or no references, invalid/unsafe URLs, new-tab `rel`, summaries with and without translation, facts, unsourced lore rejected, the real `lore.json` (sourced, https, bilingual, reviewed), and campaign data identical with and without lore.
- `tests/search.test.js` — universal search: every kind of entry, grouping and relevance (names first), entries linked to a person, bilingual, accents/case, aliases and name prefixes, session numbers and campaign days, empty and no-result queries, highlighting, same ranking in both languages, the Chronicle's own search unchanged (and *See all in the Chronicle* showing exactly the same events).
- `tests/find.test.js` — the Sessions, Quests and Characters searches (Characters: exactly the same people as its filter always found, now with the reason — an alias, the kind, the role —, translated aliases that do not line up still found, numbers read as words); a session number means that session only (never stray digits, an unchronicled number finds nothing), titles partly typed, what was recorded (opening/closing lines, plots and notes, effects, events and their kind), people, places (with the places they lie in) and quests linked explicitly — never through links of links —, quests by title, summary, objectives, giver, session notes, events, people, places and session number, both languages/accents/case, no results and nothing typed, the Sessions order kept, status AND words for Quests, the excerpt that says why an entry appeared, a label for every place a word can be found; the `index.html` wiring (one field behaviour, header → search → order/status → list, nothing stored, the count said once typing pauses, the tour setting the searches aside and giving them back).
- `tests/recap.test.js` — Previously on…: latest session by number (gaps, stubs, out-of-order keys), sessions without summary/events, several events, editorial highlights (validated, order kept), pending threads and events' open questions, nothing invented (every text traced to the data), translation and fallback.
- `tests/narrative.test.js` — optional `description` / `consequences` / `unresolved`: present, absent, malformed, translated (positional lists by length, fallback per field), searchable, relations untouched.
- `tests/places.test.js` — the Places index: story order, the Atlas and the other planes split by the recorded kind only, default folding (top level open), one branch / everything open or closed, opening a place unfolds its ancestors only (never the place itself, never closing another branch), the contextual search (nested matches with their ancestors as context, kinds and aliases in both languages, case and accents, no results) and the folding back as it was after it, places without parent, kind or map position, unknown parents and `parentId` loops (reported, broken, no place lost); the accessible wiring in `index.html` (carets are buttons with `aria-expanded`/`aria-controls` on a nested list, names are links with `aria-current`, the breadcrumb navigation, nothing stored).
- `tests/library.test.js` — favourites and history: add/remove/toggle, persistence, newest first, no consecutive duplicates, 5 shown / 20 kept, stale references pruned, corrupt or old-format storage, storage blocked or full (in-memory fallback), other tabs.
- `tests/guide.test.js` — the help centre: three tours, one-line section descriptions, six short answers in both languages; the first-visit welcome (by itself on the Chronicle's home only, a non-modal labelled dialog, *Comenzar recorrido* / *Ahora no* and `Esc`, the focus taken once, above the bottom bar on phones; the old inline introduction gone); the help reachable from `?`, the Chronicle, More and the map; contextual hints (filters, recap source, lore); the glossary covering every event type, family and status; no images; the old three-card tutorial gone.
- `tests/tour.test.js` — the guided tours: the main tour's eight steps (sections, Chronicle, Sessions, Quests, map marker and card, search, help last) and *Step N of 8* on every screen size; Sessions always explained and every step adapting to what the campaign holds (no sessions, quests, events or located events — 7 steps then) instead of disappearing; a fallback for every step that depends on an element or an example (none skipped in silence); help as the real `?` or *More → Help* on phones; the map/search tours reusing the same step logic; the action that moves each step on; the screen and panels each step needs; every text in both languages (short, parameters filled) and consistent controls (*Siguiente*, *Anterior*, *Finalizar*, *Omitir tutorial*); the versioned onboarding keys (version 3, completion ≠ dismissed welcome, re-offered on a new version, other data untouched, storage blocked); real examples; the runtime against a stand-in Driver.js and DOM (the eight steps on the real elements, buttons per step, the spotlight closing before a screen change, the visitor's tap moving on, *Siguiente* waiting for its popover, fallbacks without markers, events or sessions, the phone's More → Help); and the `index.html` wiring (one history entry, Back/Esc/arrows, context restored, leaving early dismisses the welcome, Driver.js vendored and precached).
- `tests/pwa.test.js` — manifest (relative scope, dark colours, icons with real sizes, maskable), `index.html` wiring, every precached file exists and every startup file is precached, the 15 MB map never stored, versioned caches and network-first updates, user data kept out of the caches.
- `tests/browser/smoke.mjs` — drives the real page with `playwright-core` (no browser download): the language switch keeps the route, no English left in the Spanish UI, map filters/routes/clusters, phone taps, pinch and pan, every popup on a 320×640 screen, no horizontal scroll at 320/360/390/430/768/1280 px; the lore section (collapsed by default, folds again on the next entry, opens the article in a new tab without `window.opener` — Fandom is stubbed, never contacted —, ES ↔ EN, Chronicle → entry → Back, tap targets and readability at 320/360/390/430 px); dark-only theme (an old light preference is removed, no light flash, map controls and panels dark); default orders and their toggles (kept per section, across reloads and languages, with filters); every event card with its type icon, label and family colour, title larger than metadata, compact height; every quest card with its status badge beside the title (under it on a 320 px phone, the cards inside their list, the open card's ribbon clear of the badge) and the people chips with the role, kind or part played under the name (ES/EN, only the longest role cut on a phone); the onboarding (the first-visit welcome appearing by itself once loaded — a non-modal card, the page usable under it, the focus taken once, gone over an open entry and back on the home; the main tour's eight steps by real clicks and *Siguiente* across five screens — sections, a day of the Chronicle, a session, the quests' filter used, a real marker tapped and its card, the magnifier, the `?` — with *Paso N de 8*, *Anterior*, *Finalizar*, *Omitir tutorial* and *Ver más tutoriales*; at 320/360/390/430/768/1280 px the welcome fits and every popover is on screen, off its control (under 10 %), the control still tappable; *Ahora no*, `Esc` in the welcome and leaving the tour early all keep the welcome away (reloads included) and leaving early restores route, scroll and filters; the help centre restarting the tour from step 1, Back and *Omitir tutorial* restoring the start, the map tutorial restoring filters and panels; a direct link or another section never interrupted, the welcome waiting for the home; the phone path with the welcome above the bottom bar and help shown in *Más → Ayuda*; keyboard, labelled dialog, visible names, the highlight ring, focus return and reduced motion; a first visit in English and a language change mid-tour; a campaign without sessions or events — seven steps, every section explained on its heading; the map tutorial waiting for the lazy map and the map working after; the search tutorial; the help centre on a 320 px phone with the glossary); the search (`Ctrl+K`, groups with the name first, keyboard to a result, one Back to return, bilingual/no accents, empty and no-result states, from Quests and the Map, hand-off to the Chronicle filter, full screen on a phone with 44 px rows and Back closing it); the recap (session 12 by number, real events, ES/EN, from Sessions, 320 px); the Places index (the main places and their first level open, carets by mouse/`Enter`/`Space` that never open the place, *Expand all* / *Collapse all*, a deep link unfolding the branches above it, the breadcrumb going up, the search keeping its matches' ancestors as context, highlighted, *no results* handing over to the universal search, the folding back as it was; the row's map action and the page's map preview, nothing for other planes, a note for places without a position; everything expanded at 320 and 375 px without sideways scroll and with comfortable targets, Back keeping the folding; ES ↔ EN keeping the filter and the folding); the Sessions and Quests searches (a number, a title, a word from the logs with the reason line and the mark, the count, the order, accents and case, no results with its way out, ✕ / `Esc` keeping the focus, the count said once typing pauses; status AND words, either kept when the other changes, *See N in other statuses*; kept after opening an entry and coming back — beside the list and with Back on a phone, scroll included — and across sections, gone after a reload; the Characters search with its count, the reason on a row's quiet line (alias, kind, role), marked names, no results, `Esc` and ES ↔ EN; the three fields and their hints at 320/360/390/720/768/1024/1440 px without sideways scroll; ES ↔ EN; the main tour showing the real list and giving the searches back); favourites and history (star, order, reload, remove, clear, stale references, storage blocked); offline (installability, reload with the server gone, favourites kept, the full map not stored, new content shown once back online and becoming the new offline copy); and no horizontal scroll inside the search or the help at every width. Screenshots go to `test-results/`. Set `BROWSER_CHANNEL=chrome` to drive Chrome instead of Edge. On Windows run it from PowerShell or cmd (Git Bash breaks Playwright's browser pipe).

`node_modules/` and `test-results/` are git-ignored; GitHub Pages never needs them.

## Deploying (GitHub Pages)

GitHub Pages serves the repo exactly like `npx serve`. All paths are relative and navigation uses hash URLs (`#/…`), so it works from a project sub-path (`https://<user>.github.io/<repo>/`) with no server configuration. Commit everything (including `data/`, `js/` and `assets/`), then enable Pages (Settings → Pages → deploy from the `main` branch). `sw.js` and `manifest.webmanifest` must stay at the root, next to `index.html` (the service worker's scope is its own folder).

## Project layout

```
index.html               the app: template, styles and UI logic (dc-runtime Design Component)
js/chronicle-model.js    data layer: normalizes data/*.json, applies content translations, relationship indexes, filters, search, recap, routes
js/chronicle-map.js      map geometry: which route lines to draw, pins per coordinate, zoom-dependent clusters
js/chronicle-library.js  favourites + recently viewed (localStorage, per browser)
js/chronicle-tour.js     guided tours: step definitions, onboarding flags (versioned), the runtime driving Driver.js
vendor/driver.js/        Driver.js 1.8.0 (MIT), copied unchanged from the npm package — the tours' highlight + popover
js/i18n.js               translation function t(), plural forms, language preference
locales/en.js, es-AR.js  interface strings, one dictionary per language (same keys)
sw.js                    service worker: offline copy (network first; see Offline and installing)
manifest.webmanifest     web app manifest (name, icons, dark colours)
tests/                   unit tests (node --test) and browser checks (tests/browser/)
support.js               generated dc-runtime bundle (do not edit; loads React)
tools/validate-data.js   data validator — run it before committing
tools/make-icons.mjs     renders assets/app-icon.svg into the PNG app icons (dev only)
tools/make-textures.mjs  converts the design's PNG texture layers into assets/textures/*.webp (dev only)
data/                    campaign content (below)
assets/                  map images, portraits, app icons and the page textures (assets/textures/)
```

## The data

All campaign content lives in JSON files under `data/`, loaded at runtime. Rules for every file: valid JSON only — double-quoted keys and strings, no trailing commas, no comments.

```
data/
  characters.json   the party (PCs)
  npcs.json         NPCs, deities, creatures and factions            (optional file)
  locations.json    places, as a hierarchy                           (optional file)
  events.json       individual campaign events — the core of the chronicle
  sessions.json     the full log of each session
  quests.json       the campaign quest log
  routes.json       each character's recorded journeys on the map
  lore.json         Lore of Exandria: curated summaries + external references (optional file)
  i18n/es-AR.json   Spanish translations of the content above        (optional file)
```

### How things link

Every entity has a stable `id`, and each link is stored **once**, on one side; the app derives the reverse direction.

```
event ──characterIds──▶ PC            event ──questIds──▶ quest       event ──relatedEventIds──▶ event
event ──npcIds───────▶ NPC / deity    event ──locationId─▶ place      event ──session──────────▶ session
quest ──giverId──────▶ NPC            quest ──sessions[]─▶ sessions   session plot ──questId───▶ quest
NPC   ──factionIds───▶ faction        NPC/PC ──relations──▶ person    place ──parentId─────────▶ place
```

So a person's appearances, a quest's events and places, a place's events and visitors, a session's quests and characters are all computed — never typed twice. Session-log NPC entries (`activePlots[].npcs`) are attached to a person or place **only** when their `name` exactly matches that entity's `name` or one of its `aliases` (case-insensitive); nothing is linked on partial or fuzzy name matches.

### Dates: at the table vs. in the world

| Field | Where | Meaning |
|---|---|---|
| `playedOn` | session | Real-world date the session was played (`YYYY-MM-DD`). Falls back to the date inside `dateLabel` (`"Recorded 25 Feb 2026 · …"`). |
| `campaignDay` | event | In-world day number — the chronicle is ordered and grouped by it. Falls back to the `Day N` in `igLabel`. |
| `igDate` | event | In-world calendar date as text, e.g. `"26 Horisal 867"`. Optional. |
| `igLabel` | event | Narrative label, `"Day 26 · Gilmore's shop, Emon"` — the part after `·` is shown as the scene. |
| `order` | event | Optional number to fix the order of events on the same day and session (otherwise file order). |
| `date` | event | **Legacy** sort date from the original app. Kept for compatibility; it is *not* the real play date (use the session's `playedOn`). |

Nothing requires an exact date: an event with no day inherits the day of its neighbours in the same session (shown as “About Day N”), and one with no dating at all is listed as *Undated*.

### `events.json`

```json
{
  "id": "s1_02",
  "session": 1,
  "campaignDay": 26,
  "igDate": "26 Horisal 867",
  "igLabel": "Day 26 · Gilmore's shop, Emon",
  "type": "encounter",
  "title": "The Meeting at Gilmore's",
  "summary": "In Emon's academic district, Ayante finds Gilmore's shop…",
  "description": "Optional longer text, shown on the event page.",
  "consequences": ["Optional list of consequences."],
  "locationId": "gilmores-shop",
  "xp": 42.3,
  "yp": 39.51,
  "characterIds": ["ayante", "sorfon"],
  "npcIds": ["gilmore"],
  "questIds": ["gilmore-pact", "temple-sarenrae"],
  "relatedEventIds": ["s1_01"]
}
```

- Required: `id` (unique; convention `s<session>_<nn>`), `session`, `title`, `summary`. Everything else is optional.
- `type` — one of `encounter`, `conversation`, `revelation`, `vision` (divine vision), `dream`, `decision`, `discovery`, `combat`, `quest` (quest milestone), `travel`, `planar` (another plane), `downtime` (rest & rites). Each has its own icon and colour (see [Visual language](#visual-language-icons-colours-and-type)). Missing or unknown types show as a generic “Event”.
- `xp` / `yp` — map position as a **percentage** of the map image (0–100). **Optional**: leave both out for events that have no place on the map (a dream, a vision, another plane). Such events appear normally in the chronicle and never create a pin.
- `characterIds` are party members only; NPCs, deities and factions go in `npcIds`.
- `relatedEventIds` — list a connection once (usually on the later event); it shows on both events.

#### Narrative depth: `description`, `consequences`, `unresolved` (all optional)

Most events need only a `title` and a one- or two-sentence `summary` — that is what the Chronicle card shows. The moments that matter (a revelation, a betrayal, a decision that changes the campaign) can carry more, shown **only on the event's page**, in this order: title → day and session → the summary as a lead and the `description` → *What changed* → *Still unresolved* → people, quests, connected events, where & when. Empty fields are simply not shown.

| Field | Shown as | Write |
|---|---|---|
| `description` | the full account, under the summary | What happened, in prose. Blank lines separate paragraphs. |
| `consequences` | **What changed** | A list of sentences: what is different now **in our campaign**, as verified at the table. |
| `unresolved` | **Still unresolved** | A list of sentences: questions, conflicts and objectives that remain open after this event. They also appear in the *Previously on…* recap of its session. |

Record only what happened or was established at the table — never guesses written as facts. If something is a theory of the players, say so (“The party suspects…”) or leave it out.

A simple event (a short journey) — nothing more than the essentials:

```json
{
  "id": "s99_01", "session": 99, "campaignDay": 120, "igLabel": "Day 120 · The coast road",
  "type": "travel", "title": "Down the Coast Road",
  "summary": "Two quiet days on the road south; nothing stops the party.",
  "characterIds": ["ayante", "ereldra", "mortis", "sorfon"]
}
```

An important event — with the three optional fields (a made-up example to show the shape, not campaign canon):

```json
{
  "id": "s99_02", "session": 99, "campaignDay": 121, "igLabel": "Day 121 · The drowned shrine",
  "type": "revelation", "title": "The Name Under the Water",
  "summary": "In the drowned shrine the party learns who sealed it — and why.",
  "description": "A longer account of the scene.\n\nA second paragraph if it needs one.",
  "consequences": ["The shrine's keeper now knows the party's names.", "The way back through the shrine is closed."],
  "unresolved": ["Who broke the seal before the party arrived?", "Will the keeper keep the secret?"],
  "characterIds": ["mortis", "sorfon"], "questIds": ["some-quest"]
}
```

Their Spanish goes in `data/i18n/es-AR.json` under the same event id — `description` as text, `consequences` and `unresolved` as lists **with the same number of entries, in the same order** as the English (a list of a different length is ignored and the English one is shown; the validator warns):

```json
{ "events": { "s99_02": {
  "title": "El nombre bajo el agua",
  "summary": "En el santuario sumergido el grupo descubre quién lo selló y por qué.",
  "description": "Un relato más largo de la escena.\n\nUn segundo párrafo si hace falta.",
  "consequences": ["El guardián del santuario ya conoce los nombres del grupo.", "El camino de regreso por el santuario quedó cerrado."],
  "unresolved": ["¿Quién rompió el sello antes de que llegara el grupo?", "¿Guardará el secreto el guardián?"]
} } }
```

### `sessions.json`

An object keyed by session number (as a string). Each entry is the session log.

```json
{
  "12": {
    "dateLabel": "Recorded 27 Aug 2026 · Councils Before the Hunt",
    "title": "Councils Before the Hunt",
    "playedOn": "2026-08-27",
    "startedHere": "The inn in the small hours — …",
    "endedHere": "Pelor's chapel in the High Pass the next morning — …",
    "ig": { "start": "39 Horisal 867 — ~4:00 AM, at the inn", "end": "40 Horisal 867 — morning", "rest": "39 Horisal 867 — that night" },
    "effects": ["Ongoing consequences at the session's end."],
    "activePlots": [
      {
        "name": "Plot A — Bringing Cassandra Back",
        "questId": "cassandra",
        "qt": "Where this thread stood at the end of the session.",
        "npcs": [{ "name": "Pike Trickfoot", "race": "gnome", "role": "the cleric who can cast the resurrection", "region": "Vasselheim" }],
        "notes": ["Loose ends and details."]
      }
    ],
    "completedPlots": []
  }
}
```

- `activePlots` are the threads still open at the end of the session (shown as *Unresolved threads*); `completedPlots` closed this session (add `"closed": "Closed this session"`).
- `questId` links a plot to its quest, so the quest page can show this session's snapshot.
- Plot `npcs` entries need a `name`; `race`, `role`, `region` are optional. They are shown in the session log and, when the name matches a person or place, in that entity's *From the session logs*.

#### `recap` — Previously on… (optional)

The recap of a session is built from what is already recorded: `endedHere` (*where the party was left*), the session's events, its `activePlots` (*still open*), `completedPlots`, `effects`, its quests, and the `unresolved` items of its events. Nothing is ranked or summarised automatically — without a `recap` entry, **every** recorded event is listed in order under *What was recorded*. To curate it, add:

```json
"12": {
  "title": "Councils Before the Hunt",
  "recap": {
    "summary": "Two or three sentences to read aloud before the next session.",
    "highlights": ["s12_03", "s12_05", "s12_06"]
  }
}
```

- `highlights` — 3 to 5 event ids **of that session**, in the order to show them (others are ignored with a warning; more than five is a warning). Decisions that are not highlighted are then listed apart, so none is lost.
- `summary` — optional; translate it in `data/i18n/es-AR.json` as `sessions["12"].recap.summary` (shown in English, with a note, until translated). A translation without an English summary is never shown.
- The *latest* session is the highest session number that has an entry here — never the order of labels or of the Sessions list.

### `quests.json`

```json
{
  "id": "cassandra",
  "title": "Bringing Cassandra Back",
  "status": "active",
  "giver": "Percival de Rolo",
  "giverId": "percy",
  "summary": "Where the quest stands now.",
  "objectives": ["Optional list of pending objectives."],
  "sessions": [8, 10, 11, 12],
  "characterIds": ["sorfon", "ayante", "mortis", "ereldra"]
}
```

- `status` — `active` (In progress), `pending`, `completed` or `failed`; any other value is shown as written.
- `giver` is display text (`"—"` or omit to hide); `giverId` links it to a person.
- The quest's events, places and NPCs come from events whose `questIds` include it.

> **Quests vs. session plots — two deliberate views.** `quests.json` is the campaign-level, current state (one entry per quest). Each session's `activePlots`/`completedPlots` is the *snapshot* of those threads at that session (evolving text). They overlap in narrative on purpose; when a quest opens, advances or closes, update **both** the session's plot (history, with its `questId`) and the quest entry (current state, adding the session to `sessions[]`).

### `characters.json` (party) and `npcs.json`

```json
{ "id": "mortis", "name": "Mortis", "role": "Wizard · …", "color": "#858590", "sealImg": "assets/icon-mortis.jpeg", "aliases": ["Morgas"] }
```

```json
{
  "id": "locus",
  "name": "Locus",
  "aliases": [],
  "category": "person",
  "race": "dampir",
  "factionIds": [],
  "relations": [
    { "id": "sorfon", "label": "Paid his bounty to redeem him", "reverseLabel": "Claimed from La Toma's bounty" }
  ]
}
```

- PCs: `color` draws the pin and party toggle, `sealImg` is the round portrait (relative path).
- NPCs: `category` is `person`, `deity`, `creature` or `faction`. Optional `sealImg` / `role`; without a portrait a monogram is shown.
- `aliases` — other recorded names (also used for the exact-match linking of session-log notes and for search).
- `factionIds` — factions (entries with `category: "faction"`) the person belongs to; the faction lists its members automatically.
- `relations` — written once, on either person. `label` describes the *other* person as seen from this one (shown on this person's page); `reverseLabel` describes this person as seen from the other (shown on the other's page; defaults to `label`). Ids in `characters.json` and `npcs.json` must not collide.

### `locations.json`

```json
{ "id": "chapel-of-pelor", "name": "Chapel of Pelor, High Pass", "aliases": ["Pelor's chapel"], "kind": "site", "parentId": "high-pass" }
```

- `kind` — `continent`, `region`, `sea`, `city`, `district`, `site` or `plane`; each has its own icon (see [Visual language](#visual-language-icons-colours-and-type)). A missing or unknown kind is shown as a plain place (a map-marker icon; an unknown kind keeps its own word as the label) and the validator warns.
- `parentId` nests places; filtering or opening a place includes everything inside it. Only recorded links make the tree: a place without `parentId` is a top-level place (nothing is inferred from names or from the lore). An unknown `parentId` or a loop (`a → b → a`, a place inside itself) is a validator error; the page then shows the first place of the loop at the top level.
- The Places index lists siblings in story order (the first event recorded there or inside), then by name; places never visited come last. Top-level places of `kind: "plane"` (with everything inside them) form the *Other planes* group; every other top-level place is in the *Atlas of Exandria*.
- Places have no coordinates of their own: **View on map** and the place's map preview use the first event recorded there (or inside) that has a map position. Planes (and places inside them) are never shown on the map.
- **Adding a place without breaking the map:** add it here (with `parentId` if it sits inside another place), reference it from events with `locationId`, and give those events `xp`/`yp` only if the place is on the Exandria map (both values, 0–100). A place with no positioned event simply has no **View on map**; nearby places are grouped visually at low zoom but keep their own coordinates. Add its Spanish name under `places` in `data/i18n/es-AR.json` when it has translatable words ("Temple of …"); bare proper names need nothing.

### `routes.json`

The dashed lines on the map come **only** from this file. Events are where something happened; routes are how someone got from one place to another. A line is never derived from events, so two events in different regions are not connected unless the journey between them was recorded here.

```json
{
  "mortis": [
    { "xp": 45.0, "yp": 33.6, "leg": "s8-airship", "session": 8, "locationId": "kraghammer" },
    { "xp": 42.3, "yp": 32.3, "leg": "s8-airship", "session": 8 },
    { "xp": 30.2, "yp": 27.2, "leg": "s8-airship", "session": 8, "locationId": "vasselheim" },
    { "xp": 29.9, "yp": 26.0, "break": true }
  ]
}
```

- One key per party member, an **ordered** array of waypoints (`xp`/`yp` = percent of the map image). The order is the order travelled: revisits (A → B → A → C) are kept; only an accidental repeat of the same point twice in a row is ignored.
- `break: true` — do not connect this waypoint to the previous one: the journey in between was not recorded. Use it whenever a character reappears somewhere else without a known route.
- `leg` — an id for a journey travelled **together**. When two or more visible characters carry the same `leg` id on consecutive waypoints, that stretch is drawn once as a shared line (dark ink) instead of one line per person. Togetherness comes only from this id — never from similar coordinates or shared events. Each character keeps their own waypoints for the leg; the shared line uses the first visible member's (party order).
- `session`, `locationId` — optional notes for whoever maintains the file (validated, not drawn).
- The old format (bare `{ "xp", "yp" }` arrays) is still valid: it is drawn as each character's own continuous route.
- On the map each character has their own colour (`color` in `characters.json`) and dash pattern; shared legs are dark ink; the map panel shows the legend. Only the party-member selection decides which routes are shown — quest, type, text or date filters never add, remove or join route lines.
- Invalid waypoints (missing or out-of-range coordinates) are skipped and the route is broken there instead of bridged; the validator reports them.

The current file records the session 8 airship crossing Kraghammer → Vasselheim, taken by the whole party (the session 8 log ends "after the airship crossing" and all four arrive in event `s8_06`). The journey from Emon to Kraghammer (sessions 3–7, never chronicled) is deliberately *not* drawn. The four arrays' coordinates are the original ones.

### `lore.json` — Lore of Exandria

Background on the **wider world** (Critical Role's Exandria), kept apart from what happened at our table. It never changes campaign data: names, aliases, relations, events, search and filters are built exactly as if the file did not exist (a unit test compares both). Entities only *read* it, as an extra folded section at the end of their page.

```json
{
  "sources": {
    "cr-wiki": { "label": "Critical Role Wiki", "url": "https://criticalrole.fandom.com/wiki/Critical_Role_Wiki", "community": true, "spoilers": true }
  },
  "entries": {
    "pelor": {
      "summary": "One of the Prime Deities and among Exandria's creator gods: …",
      "facts": { "alsoKnownAs": "The Dawnfather · The Lord of the Sun", "domains": "Life, Light, Nature", "symbol": "A bright, eight-pointed star" },
      "references": [ { "source": "cr-wiki", "title": "The Dawnfather", "url": "https://criticalrole.fandom.com/wiki/The_Dawnfather" } ],
      "basedOn": ["cr-wiki"],
      "lastReviewed": "2026-10-14"
    }
  }
}
```

- `entries` is keyed by an **existing** person or place id (`npcs.json`, `characters.json`, `locations.json`) — never a new entity, never a renamed id. An entity without an entry simply has no lore section.
- `sources` — one per website: `label` (shown on links and in the attribution), optional home `url`, `community: true` for fan-run sites (shown as "community wiki, not official"), `spoilers` (default `true`: show the spoiler warning under its links). Add the official site, D&D Beyond, etc. here when needed.
- `references` — one or more links: `source` (a key of `sources`), `url`, `title` (the article name). **Only absolute `https://` URLs** are accepted (no `javascript:`, `data:`, `http:`, relative or credential URLs); invalid links are dropped and reported, duplicates are ignored. Links open in a new tab with `rel="noopener noreferrer"`.
- `summary` (optional) — a short **original** text, about 40–80 words. A link without a summary is fine.
- `facts` (optional) — a few labelled values, from a fixed vocabulary: `alsoKnownAs`, `continent`, `region`, `government`, `portfolio`, `domains`, `symbol`, `worshippers`, `temples`, `base`, `purpose`, `patron`, `affiliation`, `role`. Unknown keys are ignored (warning). Don't repeat what the summary already says.
- `basedOn` (optional) — source ids the summary was written from (default: the sources of its references). `lastReviewed` (optional, `YYYY-MM-DD`) — when it was last checked.
- A `summary` or `facts` **without at least one valid reference is rejected** (validator error, not shown): nothing unsourced reaches the page.
- Spanish: `data/i18n/es-AR.json` → `"lore": { "<id>": { "summary": "…", "facts": { "domains": "Vida, Luz" } } }` (and `"loreSources": { "<sourceId>": { "label": "…" } }` if a source name needs translating). Per-field English fallback; a summary shown in English in the Spanish UI says so. Proper names stay as in the source.

**How it looks.** On a character or place page, after every campaign section, a single collapsed row **Lore of Exandria** (*background from the wider world, kept apart from our campaign*). It starts folded on every page (it stays open if you only switch language). Opened, it shows the summary, the facts, one link card per reference (source, article, ↗), the spoiler warning *"The external article may contain spoilers from the Critical Role universe."* and a one-line attribution (*summary written for this chronicle from … · reviewed … · what happened at our table takes precedence*). Nothing is fetched from the external site — no scraping, no embeds, no images: the text is curated, stored locally and rendered as plain text.

**Adding lore for an entity — checklist**

1. Make sure the entity really *is* the canon one (same person/place, not just a similar name). The DM's own NPCs get nothing unless that link is confirmed.
2. Find the article and check that it exists under that exact title (the wiki's API is handy: `https://criticalrole.fandom.com/api.php?action=query&format=json&redirects=1&titles=<Title>` — use the final title of any redirect, e.g. Pelor → *The Dawnfather*).
3. Write the summary in your own words from verifiable facts, **spoiler-free**: no secret identities, betrayals, deaths, plot twists, or late-campaign developments. General background only; when in doubt, leave it out — the link is there for the rest. Never copy article text or images (Fandom text is CC BY-SA; images have their own terms).
4. Add the Spanish version under `lore` in `data/i18n/es-AR.json`, then run `npm test`.

Current coverage (reviewed 2026-10-14, all from the Critical Role Wiki): places Tal'Dorei, Emon, Greyskull Keep, Gilmore's shop (*Gilmore's Glorious Goods*), Kraghammer, the Ozmit Sea, Whitestone, Vasselheim, the Shadowfell, the Far Realm; deities Pelor, Sarenrae, the Raven Queen, Bahamut, Torog; factions La Toma (*Slayer's Take*) and the shadar-kai; people Gilmore, Pike Trickfoot, Allura Vysoren, Cassandra and Percival de Rolo, Vax'ildan. Without a wiki article (left without lore on purpose): Strahd, Ashardalon, Baba Yaga, Ravenloft/Barovia, the Monster Jägers, Haftifaflmorhen, Cromulus, Ilión, Damali, and every DM-original NPC and place.

## Visual language: icons, colours and type

There is **one dark theme** (no light mode, no toggle), the *Grimorio*: a bound archive. Warm-black pages with a thin gilt fillet lie on a darker desk; leather appears only on the "covers" (the top bar, the phones' bottom bar and the controls floating over the map); gold marks what you can press (actions, the current tab, page fillets, the illuminated initial); a **crimson reading ribbon** marks what is open (the entry beside the list, the current section on phones, the selected map popup) or saved (favourites) — never decoration, always next to a label or an icon; map markers are seals (leather pins, crimson wax for groups). The page is painted dark before any script runs (`color-scheme: dark`, `theme-color`, an inline style in `<head>`); an old `chronicle-theme` preference from earlier versions is ignored and deleted. All colours are CSS custom properties on `.cc-app` in `index.html` — use the tokens, never a raw colour in a component.

**Surfaces and textures.** Texture on large, still surfaces only; flat colour on everything you touch (buttons, inputs, chips, cards, rows). `--page-bg` / `--panel-bg` / `--popup-bg` lay `assets/textures/paper.webp` under a 50 % veil (`--page-veil`) for the pages, popups and dialogs; `--bar-bg` / `--float-bg` lay `assets/textures/leather.webp` under the bars and the map controls. Both are original texture layers (≤ 13 % opaque) that work over any colour; when the browser asks to save data (`prefers-reduced-data`) and on screens under 360 px the tokens become `none` and the same colours show flat. `npm test` checks that no control or card ever uses a textured token and that leather stays on the covers.

**Layout.** On phones the list (or the open entry) is one full-bleed page. From 720 px the list is a single page centred on the desk (840 px wide at most, 6 px corners, the fillet on all four sides). From 1024 px an open entry turns it into an **open book**: the list on the left page, the entry on the right one (a shade lighter), the gutter drawn by inner shadows, each fillet open on the gutter side. The fillets are background layers (`--hair`), so they stay put while a page scrolls; sticky bars stop inside them. The map is a plate in a dark mount (gilt lines, a diamond at each corner; a 4 px mount on phones) drawn *around* the viewport, so the frame never covers a marker.

**Corners and states.** 4 px corners on buttons, cards, inputs, popups and panels (`--r-sm`); pills only for people. Cards rest on `--card-bg` with a hairline border; hover lifts them (`--card-bg-hover`, a dim gilt border, a deeper shadow, a gold chevron); the open one is raised (`--elev`), gilt-edged and carries the ribbon; focus is a 2 px gold outline (ivory over the map). A completed quest steps back to a darker plate with quieter text. The current option of a segmented control is raised (`--elev`), not solid gold — solid gold is reserved for the one primary button of a view.

**Contrast.** Every text colour is at least 4.5:1 on `#2d2823`, the lightest surface (WCAG ratios there: `--title` 12.1, `--body2` 9.5, `--body` 7.5, `--muted` 4.8, `--accent`/`--gilt` 6.4, `--link` 9.3, `--ribbon-text` 5.6; higher on the cards and pages). `--ribbon` (3.2:1 on a page) is a non-text indicator and never carries text; when the ribbon's colour must be text it is `--ribbon-text`, e.g. "la última" next to the latest session's day.

The same vocabulary is explained inside the app — Help → **Icons & colours** — built from these very tables, so a new type or status appears there by itself.

**Kinds of event.** Every event type has one icon, one label and a colour *family*. The colour says which kind of moment it is, the icon says exactly which type, and the label is always written beside it — colour is never the only cue. Colour only tints the icon and the card's left edge; cards stay neutral so the title stays the strongest thing on them.

| Family (token) | Colour | Types → icon |
|---|---|---|
| `conflict` (`--ev-conflict`) | terracotta | combat → crossed swords |
| `social` (`--ev-social`) | blue | encounter → a figure and "!" · conversation → speech bubbles |
| `arcane` (`--ev-arcane`) | violet | revelation → sparkles · planar (other plane) → a doorway holding a star |
| `vision` (`--ev-vision`) | soft violet | vision (divine vision) → radiant eye · dream → moon and star |
| `discovery` (`--ev-discovery`) | teal | discovery → compass |
| `journey` (`--ev-journey`) | sage | travel (journey) → signpost · downtime (rest & rites) → campfire |
| `turning` (`--ev-turning`) | amber | decision → scales · quest (quest milestone) → the quest flag |
| `neutral` (`--ev-neutral`) | parchment grey | other / unknown type → plain lozenge |

The family lives in `EVENT_TYPES` (`js/chronicle-model.js`, `ev.typeFamily`); the icons in `EVENT_ICON_SHAPES` (`index.html`, 24 px stroke paths in the same style as the navigation icons). **A new event type** needs: an entry in `EVENT_TYPES` with its `family` (reuse a family — add a new colour only for a genuinely new kind of moment), an icon in `EVENT_ICON_SHAPES`, and its label in both `locales/*.js` under `eventType`. `npm test` fails if a type has no icon, a family has no token, or two types share a drawing.

**Quest status** uses its own tokens, always with an icon and the status text: in progress `--st-active` (gold, half-filled circle), completed `--st-done` (green, check), pending `--st-pending` (amber, hourglass), failed `--st-failed` (red, cross). Open session-log threads are ruled in the active colour, closed ones in the done colour.

**Kinds of place** each have one icon in the same 24 px stroke style, gilt — other planes in the arcane violet of *other plane* events (`--ev-arcane`): continent → a globe and its lands · region → mountains · sea → waves · city → castle walls and gate · district → houses side by side · site → one building · plane → a spiral · no or unknown kind → a map marker. The icon always sits beside the name or the kind's label (index rows, place chips, search results and favourites, the place's page and its breadcrumb). The icons live in `PLACE_ICON_SHAPES` (`index.html`); a new kind needs an entry in `PLACE_KINDS` (`js/chronicle-model.js`), an icon, and its label in both `locales/*.js` under `placeKind` — `npm test` fails if a kind has no icon or two kinds share a drawing.

**The atlas index** (Places) is rows, not cards: the fold caret, the kind's icon, the name — heavier at the top of a branch, quieter for the deepest places —, the kind in quiet text (*· 3 lugares* while a branch is folded: the places directly inside) and, like an index's page references, dotted leaders to the number of events recorded there or inside (the Chronicle's open book; on phones under 360 px the count stays on the place's page). Hairline guides in a faint gilt (`--gilt-hair`) run from each open caret down to its places' elbows; the way down to the open place is drawn in `--gilt-dim`. The open place is raised and gilt-edged and hangs the ribbon over its map action. On phones the kind goes under the name, the indent narrows and the leaders go.

**Lore of Exandria** — background from Critical Role's world — is set apart from the campaign by a cool slate tone (`--lore`) on its heading, icon and source links.

**Type.** *Cormorant Garamond* (700) for titles only — the brand, section titles (56 px, a chapter opening with a small-capitals kicker, an italic subtitle and a gilt ornament), entry titles (40 px), day headers, popup and help titles, the illuminated initial; it is never used in paragraphs or under 21 px (except single letters in a seal). *Cormorant SC* (700) for labels in small capitals: kickers, block headings (with a gilt ✦ and a rule), day subtitles, map captions. *Crimson Pro* (400–600) for everything you read — titles of cards and rows, summaries, prose. *Source Sans 3* for the interface: tabs, buttons, navigation, metadata, inputs. Fallbacks are Georgia/serif and the system UI face, so the page stays usable without the web fonts; only the weights in use are loaded (variable ranges where the family has one). Reading and interface text is never below 12.5 px; only small-capital labels go smaller (the brand's kicker 9–10 px, day subtitles 11–12 px, map captions 11 px).

**The illuminated initial.** An event's summary opens with a gilt-framed capital. It is drawn by CSS from `data-initial` with empty alternative text, and the paragraph's own first letter is only made invisible, so the text stays whole for screen readers, search and copying; the box appears only when the text starts with a letter. Browsers without alternative text for generated content get a plain gilt drop cap instead.

**Cards** read in three levels: ① kind — icon + type (+ the day or session only when the group header does not already say it), ② title and a two-line summary, ③ a quiet chevron. People, places and quests of an event are on its page, not on the card. A **quest card** carries its status badge (icon + label, as on the group heading) on the right of its title — under the title on phones narrower than 360 px — so the status never rests on the edge colour alone; the open quest's ribbon hangs over the chevron, clear of the badge.

**People chips** stack the name over a quieter line: what the person did there when the page says so (*gave the quest*), else their role (for a party member, class and subclass), else what they are (*Deity*, *Creature*…, `personCategoryOne` in the locales). A role too long for the chip ends in an ellipsis; a long name wraps instead.

## The party-member filter

One filter, shared by the Chronicle and the Map:

- **No one selected** (the default) = every event, including events with no party member at all.
- **Some selected** = events where **any** selected member took part (OR). An event of Ayante and Sorfon shows when either is selected, once when both are, and the order inside `characterIds` never matters.
- Events without party members are hidden while a selection is active; when the campaign has any, a discreet **No party member** chip (Chronicle) / row (Map) includes them on purpose. They are never assigned to a character to make them show.
- On the Map the same filter reads as visibility: every party row lit = no filter; switching a row off hides what is *only* theirs. Switching everyone off shows nothing.
- It combines with the other filters with AND (e.g. Sorfon *and* quest X), and it alone decides which routes are drawn. Pins are one per coordinate, so an event with four party members is still one pin.

## Map pins and groups

- Markers are seals: a pin is a leather drop with a gilt edge around the party member's portrait (or the party's seal), turning gold when its card is open; a group is a crimson wax seal with its count. They are 38/50 px on phones (where markers merge below 42 px apart) and 32/42 px with a mouse (32 px), so neighbours never overlap beyond their halos. Captions (*Sesión 8*) are small capitals on a dark label, counter-scaled like the markers. Routes keep their geometry, colours and dashes; the casing is ivory and journeys travelled together are a dotted line of sealing wax.
- Events at **exactly** the same coordinates share one pin (with a count badge); tapping it lists them.
- Pins with **different but close** coordinates gather, depending on the zoom, into a round numbered seal (deliberately not a pin, so it never reads as one place). Tapping it lists every event with its day and session; **Zoom in to separate** zooms until the places split (or as far as the map goes, when they are too close to ever split on that screen). Groups are recomputed for the zoom level and the active filters; no coordinate is changed and no event is dropped.
- In an event's popup, ‹ › step through the other events of the same pin or group and **See all** returns to the list. Popups always stay on screen (shifted sideways near the edges, opened on the side with room, kept below the map's top bar).

## Onboarding and guided tours

The tours teach by pointing at the app's own controls, not by describing them. [Driver.js](https://driverjs.com/) (1.8.0, MIT, copied unchanged into `vendor/driver.js/` — no CDN, so it works offline and on GitHub Pages) dims the page, cuts a hole around one real element and shows a popover; `js/chronicle-tour.js` decides what to show and when.

**First visit.** Once the chronicle has loaded, a welcome card appears by itself on the Chronicle's home: what the Chronicle is, what the tour shows, how many steps it has and that it stays in the help, with two answers — *Comenzar recorrido* / *Ahora no*. It is not a modal (no backdrop; the page stays usable), floats in a corner (above the bottom bar on phones, more compact on the smallest ones, its buttons always in view on low screens) and takes the keyboard focus once, only if nothing else has it. It never appears over a direct link to an entry or another section, an open entry, the Chronicle's filters, the search, the help, the More sheet or a running tour (it steps aside while they are open): on a deep link it waits until the visitor reaches the home. *Ahora no* (or `Esc` inside it), finishing the tour or leaving it early all mean it does not come back by itself — the tours stay one tap away in the help.

**The main tour: eight steps, one idea each.** ① the sections and the bar that moves between them (the bottom bar and *Más* on phones); ② the Chronicle — a real day of the story or its first card; ③ Sessions — always explained: a real session as the example, or the section's heading while none is recorded; ④ Quests — the status filter, which can be used; ⑤ the map — a real marker near the centre (tap it, or *Siguiente* opens it); ⑥ the card it opens, and that the map has its own tour under *¿Cómo funciona?*; ⑦ the search; ⑧ last, so it is what stays: where the help and the tours live — the **?** button in the top bar, or *Más → Ayuda* on phones (the More sheet opens and its *Ayuda* is highlighted). The specific tours go further: *Cómo usar el mapa* (markers, grouped markers, the party filter and the dashed journeys, moving around) and *Cómo buscar información* (typing, results, an entry and its connections).

**Steps are data.** Each step in `STEPS` says *where* it needs to be (`screen.ok` / `screen.go` → a hash), *which panels* must be open or closed (`ui`: the More sheet, the search, the map's party panel, a map popup), *what* to highlight (`target`, only elements really on screen — the first one already visible where it scrolls, so the tour does not move the page), its texts (`tour.<step>T` / `tour.<step>D` in `locales/*.js`, with variants picked by what was found), *what action moves it on* (`done`: a marker tapped, the search opened, a result opened, a link followed, the panel opened), *what Next does* for the visitor (`perform`), a *fallback* when the screen cannot be reached or the element never appears, and `none` when the screen says the element cannot come (no marker at all) so the fallback shows at once. A step is never skipped in silence and never points at something that is not there: no marker in view → the whole map with words for it; no located event → the map explained and no "what a marker opens" step (`when`, decided before the tour starts, so *Paso N de M* stays true: 7 steps then); no session or quest → the section's heading with a "nothing recorded yet" text. `TOURS` lists the steps of each tour; the main and map tours share the marker and card logic.

**Across screens.** The runtime brings the app to each step's screen, waits until the element exists, is visible and has stopped moving for a few frames (route render, the lazy map laying out and centring), then calls Driver.js's `highlight()`. When the next step is on another screen, the spotlight first closes over the whole page (no popover) and only then does the app change screen, so the cut-out never shows the old place over the new screen and the change is never a jump. *Siguiente* and *Anterior* act only once the step's popover is there. After every render the app calls `tour.sync()`: the action a step waits for moves the tour on; a re-rendered element is highlighted again; otherwise the highlight follows the layout (map panning, panes opening, scrolling, a resize, fonts loading — a `ResizeObserver` watches the element and the popover); a refresh waits until Driver.js has finished moving the spotlight. Nothing depends on fixed delays; the timeouts only end a wait for an element that never comes (→ fallback).

**The popover.** *Paso 3 de 8* with a thin bar on top, *Omitir tutorial* on its right (every step but the last), the title and one or two sentences, then *Anterior* · *Siguiente* (*Finalizar* on the last step, with *Ver más tutoriales*, which opens the help). The highlighted control gets a gold ring. Placed by Driver.js, then kept inside the safe area and the part of the screen the virtual keyboard leaves; when no side has room (a low screen, a tall card) it is moved to the larger free band above or below the element — its text shortened, scrolling, faded at the edge — or beside it, narrower, on a phone held sideways. While typing in the search the focus stays in the field; a highlighted control always stays tappable (the tests check its centre point at 320–1280 px).

**History and leaving.** A tour owns one history entry; every navigation during it replaces that entry, so the tour adds no history and **Back** (browser or Android gesture) ends it where it started. Leaving early — *Omitir tutorial*, `Esc`, Back — restores the starting route, list and pane scroll, map view, open panels, filters and the quests' status filter. Reaching the last step marks the tour completed and leaves the visitor where it ended (the main tour ends on the Chronicle's home, the focus on its *¿Cómo funciona?*). A tap on the dimmed page never ends a tour by accident. Starting a tour again from the help always starts from its first step.

**Remembered** (separate `localStorage` keys, never touching other data): `chronicle-tour-version` (the onboarding version the flags refer to), `chronicle-tour-completed` (`["main","map","search"]`), `chronicle-tour-invite` (`dismissed`). Bump `VERSION` in `js/chronicle-tour.js` when the tours change enough to be offered again — older flags then count as unseen (version 3 is the eight-step tour with the welcome). The previous guide's `chronicle-tutorial-seen` is removed on load.

**Adding a step:** add it to `STEPS` (screen, ui, target, text, done/perform, fallback), list it in `TOURS`, add `tour.<step>T` / `tour.<step>D` to both locale files (short: a title and one or two sentences), and give the element a stable hook if needed (`data-tour="…"`; today `help`, `event-people` and `party-rows`). `tests/tour.test.js` checks that every text exists in both languages and is short, that steps depending on an element or an example have a fallback, and runs the runtime against a stand-in Driver.js.

## Languages (i18n)

Spanish of Argentina (`es-AR`) is the default; English (`en`) is the original language of the data. The choice is stored in `localStorage` (`chronicle-lang`).

- **Interface** — every visible string, aria-label and tooltip comes from `locales/es-AR.js` / `locales/en.js` through `t("section.key", params)` (`js/i18n.js`). Both files have the same semantic keys; `{name}` placeholders are filled from params and `{ "one": …, "other": … }` objects are plural forms. They are plain scripts (not JSON) so even the first loading/error message is translated. To add a string: add the key to **both** files and use `{{ t.section.key }}` in the template or `this.t("section.key")` in code — `npm test` fails if a key is missing in either language. To add a language: a new `locales/<code>.js`, an entry in `LOCALES` in `js/i18n.js`, a script tag in `index.html`, and optionally `data/i18n/<code>.json`.
- **Content** — the English `data/*.json` files stay the source of truth and are never rewritten. Translations live in `data/i18n/es-AR.json`, keyed by stable ids:

  ```json
  {
    "events":   { "s1_02": { "title": "El encuentro en lo de Gilmore", "summary": "…", "igLabel": "Día 26 · La tienda de Gilmore, Emon" } },
    "sessions": { "8": { "title": "…", "startedHere": "…", "ig": { "start": "…" }, "effects": ["…"],
                         "activePlots": [ { "name": "…", "qt": "…", "npcs": [ { "role": "…" } ], "notes": ["…"] } ] } },
    "quests":   { "cassandra": { "title": "…", "summary": "…", "objectives": ["…"] } },
    "people":   { "sorfons-mother": { "name": "La madre de Sorfon", "race": "humana", "relations": [ { "label": "…", "reverseLabel": "…" } ] } },
    "places":   { "gilmores-shop": { "name": "La tienda de Gilmore" } },
    "lore":     { "pelor": { "summary": "…", "facts": { "domains": "Vida, Luz, Naturaleza" } } }
  }
  ```

  An event's `description`, `consequences` and `unresolved` and a session's `recap.summary` are translated the same way (see [Narrative depth](#narrative-depth-description-consequences-unresolved-all-optional) and [`recap`](#recap--previously-on-optional)). Arrays (effects, plots, plot npcs, notes, objectives, consequences, unresolved, aliases, relations) are **positional**: same length and order as the English source. Ids, coordinates, dates (`playedOn`, in-world `igDate`), `questId`s and links are never translated. Session-log names keep linking by their English spelling even when a translated `name` is shown.
- **Fallback** — any missing or empty translated value, or a positional array whose length differs from the source, shows the English text (the validator warns). Nothing ever shows a key or an empty label.
- **Search** — each entry is indexed in every loaded language, folded to lower case without accents: `revelación`, `revelacion` and `revelation` find the same events whatever the interface language. Translated categories (event types, quest status, place kinds) are searchable too. The universal search (`ChronicleModel.searchAll`) ranks every kind on one scale — whole name, name prefix, word prefix, all words in the name, all words in the entry's own text, all words in its linked people/places/events — with ties broken by the English names, so results come in the same order in both languages.
- **Dates** — real play dates are formatted per language (`25 jun 2026` / `25 Jun 2026`); in-world dates (`29 Horisal 867`) are proper names and stay verbatim. Ordering never depends on the language.
- **Adding a bilingual event** — add it to `events.json` in English as usual, then add `"<id>": { "title", "summary", "igLabel" }` (plus `description`/`consequences` if present) under `events` in `data/i18n/es-AR.json`. Same for a new session (under `sessions`, keyed by its number), quest, person or place. Until then the new entry simply appears in English in the Spanish interface. `node tools/validate-data.js` prints the translation coverage.

## Adding content

1. **New session:** add its entry to `sessions.json` (with `title` and `playedOn`), then one object per beat to `events.json` (`session`, `campaignDay`, `type`, …).
2. **People and places:** add new NPCs to `npcs.json` and places to `locations.json` *before* referencing them from events (`npcIds`, `locationId`). Add an `aliases` entry when the session log names someone differently.
3. **Quests:** link events with `questIds` and plots with `questId`; update the quest's `summary`, `status` and `sessions[]` in `quests.json`.
4. **Movement:** if the party travelled, append the waypoints to each traveller's array in `routes.json` — with a shared `leg` id if they went together, and `"break": true` on the first point after an unrecorded jump.
5. **Narrative depth (optional):** for the session's important moments, add `description`, `consequences` and `unresolved` to those events (see [Narrative depth](#narrative-depth-description-consequences-unresolved-all-optional)); leave ordinary events short.
6. **Recap (optional):** to curate *Previously on…*, give the session a `recap` with 3–5 `highlights` and/or a `summary` (see [`recap`](#recap--previously-on-optional)). Without it the recap lists every recorded event.
7. **Translation:** add the Spanish text for the new events, session or quest to `data/i18n/es-AR.json` (see [Languages](#languages-i18n)).
8. **Lore (optional):** if a new NPC or place is a known part of Exandria, add a verified reference and a spoiler-free summary to `lore.json` (see [the checklist](#lorejson--lore-of-exandria)).
9. **Offline copy:** only if you added a *new file* the page loads at start (a new `data/*.json`, script or portrait), list it in `PRECACHE` in `sw.js` and bump `VERSION`. New content in existing files needs nothing — the offline copy refreshes itself.
10. **Validate** before committing:

   ```bash
   node tools/validate-data.js
   ```

   It checks JSON syntax, duplicate ids, every reference (characters, NPCs, quests, places, related events, plot quests, giver, factions, relations), coordinates, route waypoints and shared legs, asset paths, the lore layer (https-only links, every summary sourced), the content translations (unknown ids, array lengths, coverage), recap highlights and narrative fields, and that every file `sw.js` precaches exists. It exits with an error if anything would break the page, and warns about softer inconsistencies (for example, an event linking a quest whose `sessions[]` does not list that session). Its last lines report what is **still to be written** — see [Pending content](#pending-content).

## Pending content

Nothing in the chronicle is filled in automatically, and nothing was invented to complete the new fields. As of this version (the validator prints the current state):

- **Sessions 3–7 and 9 have not been chronicled** (no log, no events) — the Sessions list shows them as gaps. They should be written from the table's notes, not reconstructed.
- **No event has `description`, `consequences` or `unresolved` yet** (0 of 33). The event pages show those sections as soon as they are written.
- **No session has an editorial `recap`** (0 of 6), so *Previously on…* lists every recorded event of the latest session, neutrally. Adding `recap.highlights` (and optionally a `summary`) to session 12 is the quickest improvement.
- **Seven places of the Atlas have no `parentId`** (Ilión, Damali, Kraghammer, the Ozmit Sea, Whitestone, Vasselheim, the high peak of the Calamity), so they sit at the top level of the Places index beside Tal'Dorei. Some have hints outside the campaign's links — Vasselheim's lore names the continent Issylra (not a recorded place), Whitestone's the Parchwood Timberlands, and the session 1 log calls Ilión "the far continent" while `locations.json` records it as a `region` — but nothing is nested or re-kinded from hints: add `parentId` / `kind` when the table confirms it.

## Offline and installing (PWA)

After one visit with a connection, the chronicle opens without one: Chronicle, Sessions, Quests, Characters, Places, every entry page, both languages, search, favourites, the help and the guided tours (Driver.js is part of the offline copy). Browsers that support it offer to **install** it (Chrome/Edge: the install icon in the address bar; Android: *Add to home screen*; iOS Safari: *Share → Add to Home Screen*), and it then opens in its own dark window.

How it works (`sw.js`, registered from `index.html` on `http(s)` only):

- **Network first.** Online, every page, script and data file is fetched from the server first (revalidated past the HTTP cache), exactly as without a service worker — a newly published session appears on the next load. Each successful response also refreshes the offline copy. Players never stay on old sessions while they are online.
- **Offline fallback.** With no connection (or one that does not answer within 6 s), the last saved copy is served, and a small note says *Offline — you are reading the last copy saved on this device*.
- **What is stored:** the app shell, `data/*.json`, the Spanish content, React (from unpkg, same bytes so its integrity check passes), the portraits, icons and the two page textures (~1 MB); the 2400 px map preview and the fonts once they are first used. **The 15 MB full-resolution map is never stored** — offline, the Map shows the preview.
- **Updates and versions:** caches are named `chronicle-shell-<VERSION>` / `chronicle-runtime-<VERSION>`; a new `sw.js` installs at once and deletes the old caches. Bump `VERSION` when you add a file to `PRECACHE` (new content in existing files needs no bump).
- **Your data is separate:** favourites, history, the language and the onboarding flags (completed tours, dismissed invitation) live in `localStorage`, which the service worker never touches — updates and cache clean-ups never lose them. Favourites are never pruned against an offline copy (which may be older than the entry).

Limitations: the first visit must be online; offline you see the last version you loaded; the full-resolution map needs a connection; favourites are per browser and device (no sync). To reset everything, clear the site's data in the browser.

## Compatibility

Older records keep working: events with only `date`/`igLabel`/`xp`/`yp`, sessions with only `dateLabel`, quests without `giverId`, or no `npcs.json`/`locations.json`/`lore.json` at all. Missing fields are derived where possible (day from `igLabel`, title and play date from `dateLabel`) and otherwise hidden — the page never shows empty sections or placeholder data.

## Assets

- `assets/exandria-map.jpeg` — the full-resolution map (~15 MB). Loaded only on the Map, once it is zoomed in far enough to need it.
- `assets/exandria-map-preview.jpeg` — a 2400 px copy used for the first paint of the map and for the event mini-maps. If you replace the map, regenerate it at the same aspect ratio.
- `assets/icon-*.jpeg` — round PC portraits; `assets/icon-bund-der-vier.png` — the shared seal for events involving several party members.
- `assets/app-icon.svg` — the app icon (also the favicon); `app-icon-180/192/512.png` and `app-icon-maskable-512.png` are rendered from it with `node tools/make-icons.mjs` (PowerShell/cmd on Windows, after `npm install`).
- `assets/textures/paper.webp` (126 KB) and `leather.webp` (97 KB) — original 512 px tiles of light and dark specks at most ~13 % opaque, laid over the page and bar colours (see [Visual language](#visual-language-icons-colours-and-type)). They come from the design handoff's PNG layers (506 KB / 445 KB), converted with `node tools/make-textures.mjs "<folder with a-paper.png and c-leather.png>"`: lossless WebP (lossy WebP is larger for this kind of noise) after rounding each alpha to a multiple of 4, which moves no rendered pixel by more than 2/255.
