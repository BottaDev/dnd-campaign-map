# Campaign Chronicle

An archive of the adventures of a D&D party: a narrative chronicle of every event in the campaign, linked to the sessions, quests, characters and places it touches — with the interactive campaign map as a companion for geography. It is a single static page (no backend, no build step) that works on desktop, tablet and phone, in **Spanish (Argentina, the default) and English**: interface *and* narrative content.

The party name, world name, and other branding text live in the interface dictionaries (`locales/*.js`) — edit them there if you reuse this for a different campaign.

Live version: served via GitHub Pages from this repo (see [Deploying](#deploying-github-pages)).

## Using the page

The app has six sections. On desktop and tablet they are tabs in the top bar; on a phone, **Chronicle**, **Sessions** and **Quests** sit in the bottom bar and **Characters**, **Places** and **Map** are under **More**.

| Section | What it shows |
|---|---|
| **Chronicle** (home) | Every event as a narrative timeline grouped by campaign day (or by session), **latest first** by default (one tap switches to oldest first; inside a day the events keep their recorded order). Each card shows the event's type as an icon, colour and label. Free-text search (in both languages, ignoring accents and case) plus filters for party member, NPC/deity/faction, quest, session, event type, place, in-world period (campaign days) and real-world play date — all combinable. Typing a search also lists matching people, quests, places and sessions. |
| **Sessions** | The sessions played, **oldest first** by default (or latest first), in numeric order with gaps for sessions that were never written up. Each session page has the real date it was played, the in-world days it covered, where it started and ended, its events, the quests in play, the people and places involved, active effects and unresolved threads. |
| **Quests** | Every quest by status. A quest page shows where it stands now and *the story so far*: session by session, the events that advanced it and the session-log snapshot of the thread. |
| **Characters** | The party and every NPC, deity and faction recorded in the session logs: relationships (both directions), factions/members, appearances, quests, places, and everything the session logs noted about them. |
| **Places** | The places of the campaign as a tree (continent › city › district › site, plus other planes), with what happened in each. |
| **Map** | The full interactive map — pan, zoom (wheel, buttons, pinch), event pins captioned by session, nearby pins gathered into numbered seals that split as you zoom in, each character's recorded journeys as dashed lines, party toggles. Tapping a pin shows the event (**Read entry** opens it, **Session log** opens that session); tapping a group lists its events. |

Opening anything (an event, session, quest, person or place) shows its full page: beside the list on wide screens, full-screen with a **Back** button on phones. Everything links to everything else, and **Back** (the app button, the browser button or Android's back gesture) returns to where you were, with filters and scroll position kept. An event with a location offers **View on map** and a small expandable map preview; the map is never opened automatically. Characters and places that also exist in Critical Role's Exandria end with a folded **Lore of Exandria** section — a short, spoiler-free summary and a link to the source article (see [`lore.json`](#lorejson--lore-of-exandria)); our own story always comes first.

Keyboard: `/` jumps to the search box, `Esc` closes the open page. `?` reopens the guide (also shown on the first visit; under **More** on a phone). The app has a single dark theme. The Chronicle and Sessions orders are remembered separately, but only once you change them — until then each opens on its default. **ES / EN** in the top bar (on every screen size) switches the language in place — same page, filters and map view — and is remembered for the next visit.

Every page has a shareable URL (the language is a personal preference, never part of the link, so the same URL works for everyone), e.g. `#/chronicle/event/s8_04`, `#/sessions/session/12`, `#/quests/quest/cassandra`, `#/characters/character/locus`, `#/places/place/vasselheim`, `#/map/at/s11_06`.

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
- `tests/design.test.js` — every event type has its own icon and a colour family with a token, every quest status an icon and a tone; one dark theme only (no light tokens, toggle or theme strings; an old preference is discarded; dark before the app boots).
- `tests/lore.test.js` — Lore of Exandria: one, several or no references, invalid/unsafe URLs, new-tab `rel`, summaries with and without translation, facts, unsourced lore rejected, the real `lore.json` (sourced, https, bilingual, reviewed), and campaign data identical with and without lore.
- `tests/browser/smoke.mjs` — drives the real page with `playwright-core` (no browser download): the language switch keeps the route, no English left in the Spanish UI, map filters/routes/clusters, phone taps, pinch and pan, every popup on a 320×640 screen, no horizontal scroll at 320/360/390/430/768/1280 px; the lore section (collapsed by default, folds again on the next entry, opens the article in a new tab without `window.opener` — Fandom is stubbed, never contacted —, ES ↔ EN, Chronicle → entry → Back, tap targets and readability at 320/360/390/430 px); dark-only theme (an old light preference is removed, no light flash, map controls and panels dark); default orders and their toggles (kept per section, across reloads and languages, with filters); every event card with its type icon, label and family colour, title larger than metadata, compact height. Screenshots go to `test-results/`. Set `BROWSER_CHANNEL=chrome` to drive Chrome instead of Edge. On Windows run it from PowerShell or cmd (Git Bash breaks Playwright's browser pipe).

`node_modules/` and `test-results/` are git-ignored; GitHub Pages never needs them.

## Deploying (GitHub Pages)

GitHub Pages serves the repo exactly like `npx serve`. All paths are relative and navigation uses hash URLs (`#/…`), so it works from a project sub-path (`https://<user>.github.io/<repo>/`) with no server configuration. Commit everything (including `data/`, `js/` and `assets/`), then enable Pages (Settings → Pages → deploy from the `main` branch).

## Project layout

```
index.html               the app: template, styles and UI logic (dc-runtime Design Component)
js/chronicle-model.js    data layer: normalizes data/*.json, applies content translations, relationship indexes, filters, search, routes
js/chronicle-map.js      map geometry: which route lines to draw, pins per coordinate, zoom-dependent clusters
js/i18n.js               translation function t(), plural forms, language preference
locales/en.js, es-AR.js  interface strings, one dictionary per language (same keys)
tests/                   unit tests (node --test) and browser checks (tests/browser/)
support.js               generated dc-runtime bundle (do not edit; loads React)
tools/validate-data.js   data validator — run it before committing
data/                    campaign content (below)
assets/                  map images and portraits
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

- `kind` — `continent`, `region`, `sea`, `city`, `district`, `site` or `plane`.
- `parentId` nests places; filtering or opening a place includes everything inside it.
- Places have no coordinates of their own: **View on map** centres on the first event recorded there that has a map position. Planes (and places inside them) are never shown on the map.
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

There is **one dark theme** (no light mode, no toggle): ink-brown surfaces, parchment text and gold for what you can press. The page is painted dark before any script runs (`color-scheme: dark`, `theme-color`, an inline style in `<head>`); an old `chronicle-theme` preference from earlier versions is ignored and deleted. All colours are CSS custom properties on `.cc-app` in `index.html` — use the tokens, never a raw colour in a component.

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

**Lore of Exandria** — background from Critical Role's world — is set apart from the campaign by a cool slate tone (`--lore`) on its heading, icon and source links.

**Type.** *Cinzel* only for headings (brand, section titles, page titles, day headers); *EB Garamond* for everything you read — titles of cards and rows, summaries, prose; the system UI face for data and controls (dates, types, filters, buttons, navigation, status chips). No forced capitals or wide letter-spacing on small text; small text is never below 12.5 px.

**Cards** read in three levels: ① kind — icon + type (+ the day or session only when the group header does not already say it), ② title and a two-line summary, ③ a quiet chevron. People, places and quests of an event are on its page, not on the card.

## The party-member filter

One filter, shared by the Chronicle and the Map:

- **No one selected** (the default) = every event, including events with no party member at all.
- **Some selected** = events where **any** selected member took part (OR). An event of Ayante and Sorfon shows when either is selected, once when both are, and the order inside `characterIds` never matters.
- Events without party members are hidden while a selection is active; when the campaign has any, a discreet **No party member** chip (Chronicle) / row (Map) includes them on purpose. They are never assigned to a character to make them show.
- On the Map the same filter reads as visibility: every party row lit = no filter; switching a row off hides what is *only* theirs. Switching everyone off shows nothing.
- It combines with the other filters with AND (e.g. Sorfon *and* quest X), and it alone decides which routes are drawn. Pins are one per coordinate, so an event with four party members is still one pin.

## Map pins and groups

- Events at **exactly** the same coordinates share one pin (with a count badge); tapping it lists them.
- Pins with **different but close** coordinates gather, depending on the zoom, into a round numbered seal (deliberately not a pin, so it never reads as one place). Tapping it lists every event with its day and session; **Zoom in to separate** zooms until the places split (or as far as the map goes, when they are too close to ever split on that screen). Groups are recomputed for the zoom level and the active filters; no coordinate is changed and no event is dropped.
- In an event's popup, ‹ › step through the other events of the same pin or group and **See all** returns to the list. Popups always stay on screen (shifted sideways near the edges, opened on the side with room, kept below the map's top bar).

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

  Arrays (effects, plots, plot npcs, notes, objectives, consequences, aliases, relations) are **positional**: same length and order as the English source. Ids, coordinates, dates (`playedOn`, in-world `igDate`), `questId`s and links are never translated. Session-log names keep linking by their English spelling even when a translated `name` is shown.
- **Fallback** — any missing or empty translated value, or a positional array whose length differs from the source, shows the English text (the validator warns). Nothing ever shows a key or an empty label.
- **Search** — each entry is indexed in every loaded language, folded to lower case without accents: `revelación`, `revelacion` and `revelation` find the same events whatever the interface language. Translated categories (event types, quest status, place kinds) are searchable too.
- **Dates** — real play dates are formatted per language (`25 jun 2026` / `25 Jun 2026`); in-world dates (`29 Horisal 867`) are proper names and stay verbatim. Ordering never depends on the language.
- **Adding a bilingual event** — add it to `events.json` in English as usual, then add `"<id>": { "title", "summary", "igLabel" }` (plus `description`/`consequences` if present) under `events` in `data/i18n/es-AR.json`. Same for a new session (under `sessions`, keyed by its number), quest, person or place. Until then the new entry simply appears in English in the Spanish interface. `node tools/validate-data.js` prints the translation coverage.

## Adding content

1. **New session:** add its entry to `sessions.json` (with `title` and `playedOn`), then one object per beat to `events.json` (`session`, `campaignDay`, `type`, …).
2. **People and places:** add new NPCs to `npcs.json` and places to `locations.json` *before* referencing them from events (`npcIds`, `locationId`). Add an `aliases` entry when the session log names someone differently.
3. **Quests:** link events with `questIds` and plots with `questId`; update the quest's `summary`, `status` and `sessions[]` in `quests.json`.
4. **Movement:** if the party travelled, append the waypoints to each traveller's array in `routes.json` — with a shared `leg` id if they went together, and `"break": true` on the first point after an unrecorded jump.
5. **Translation:** add the Spanish text for the new events, session or quest to `data/i18n/es-AR.json` (see [Languages](#languages-i18n)).
6. **Lore (optional):** if a new NPC or place is a known part of Exandria, add a verified reference and a spoiler-free summary to `lore.json` (see [the checklist](#lorejson--lore-of-exandria)).
7. **Validate** before committing:

   ```bash
   node tools/validate-data.js
   ```

   It checks JSON syntax, duplicate ids, every reference (characters, NPCs, quests, places, related events, plot quests, giver, factions, relations), coordinates, route waypoints and shared legs, asset paths, the lore layer (https-only links, every summary sourced), and the content translations (unknown ids, array lengths, coverage). It exits with an error if anything would break the page, and warns about softer inconsistencies (for example, an event linking a quest whose `sessions[]` does not list that session).

## Compatibility

Older records keep working: events with only `date`/`igLabel`/`xp`/`yp`, sessions with only `dateLabel`, quests without `giverId`, or no `npcs.json`/`locations.json`/`lore.json` at all. Missing fields are derived where possible (day from `igLabel`, title and play date from `dateLabel`) and otherwise hidden — the page never shows empty sections or placeholder data.

## Assets

- `assets/exandria-map.jpeg` — the full-resolution map (~15 MB). Loaded only on the Map, once it is zoomed in far enough to need it.
- `assets/exandria-map-preview.jpeg` — a 2400 px copy used for the first paint of the map and for the event mini-maps. If you replace the map, regenerate it at the same aspect ratio.
- `assets/icon-*.jpeg` — round PC portraits; `assets/icon-bund-der-vier.png` — the shared seal for events involving several party members.
