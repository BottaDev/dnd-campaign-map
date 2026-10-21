# Data model

All campaign content lives in JSON files under `data/`, fetched by the page at runtime and normalised by `js/chronicle-model.js` (`ChronicleModel.build`). This document describes every file, how records link to each other, the translation overlay and the rules the validator enforces.

← [Back to the README](../README.md) · Related: [Map system](map-system.md) · [Architecture](architecture.md) · [Taller guide (ES)](editor-guide.md)

**Contents:** [Files](#files) · [Identifiers and links](#identifiers-and-links) · [Dates](#dates-at-the-table-vs-in-the-world) · [`events.json`](#eventsjson) · [`sessions.json`](#sessionsjson) · [`quests.json`](#questsjson) · [`characters.json` and `npcs.json`](#charactersjson-and-npcsjson) · [`locations.json`](#locationsjson) · [`routes.json`](#routesjson) · [`lore.json`](#lorejson--canon-lore) · [Translations](#translations-datai18nes-arjson) · [Validation](#validation-and-integrity-rules) · [Legacy records](#legacy-records) · [Current data status](#current-data-status)

## Files

```
data/
  characters.json   the party (PCs)                                   required · array
  events.json       individual campaign events — the core            required · array
  sessions.json     the log of each session, keyed by number         required · object
  quests.json       the campaign quest log                           required · array
  routes.json       each party member's recorded journeys            required · object
  npcs.json         NPCs, deities, creatures and factions             optional · array
  locations.json    places, as a hierarchy                            optional · array
  lore.json         canon lore: curated summaries + references        optional · object
  i18n/es-AR.json   Spanish translation of the content above         optional · object
```

A missing required file is a validator error and the page cannot load; a missing optional file simply means "none" (the page treats a 404 as empty).

**Rules for every file:** valid JSON only — double-quoted keys and strings, no trailing commas, no comments.

**Each file keeps its own layout.** The files are not all formatted the same way, and the Taller del Cronista and `tools/apply-draft.js` write them back in exactly that layout so a change only touches the lines of the records that changed:

| Layout | Files | Shape |
|---|---|---|
| pretty | `events`, `sessions`, `characters`, `routes`, `i18n/es-AR` | `JSON.stringify(value, null, 2)` + final newline |
| compact | `quests`, `npcs` | records expanded; lists of plain values and small flat objects on one line |
| rows | `locations` | one record per line |

> [!IMPORTANT]
> `npm test` checks that every data file is byte-for-byte what `ChronicleEditor.serialize` would write (`tests/editor.test.js`, *export · every data file is written back byte for byte*). When editing by hand, follow the layout of the file you are editing — the easiest way is to copy a neighbouring record. Line endings do not matter (the tests read files with CRLF turned into LF).

## Identifiers and links

Every entity has a stable `id`, and each link is stored **once**, on one side; the model derives the reverse direction.

```
event ──characterIds──▶ PC            event ──questIds──▶ quest       event ──relatedEventIds──▶ event
event ──npcIds───────▶ NPC / deity    event ──locationId─▶ place      event ──session──────────▶ session
quest ──giverId──────▶ NPC            quest ──sessions[]─▶ sessions   session plot ──questId───▶ quest
NPC   ──factionIds───▶ faction        NPC/PC ──relations──▶ person    place ──parentId─────────▶ place
```

So a person's appearances, a quest's events and places, a place's events and visitors, a session's quests and characters are all computed — never typed twice.

| Record | Id convention | Notes |
|---|---|---|
| Event | `s<session>_<nn>` (`s12_03`) | the Taller generates the next number of that session |
| Session | its number, as the object key (`"12"`) | sessions are keyed, not listed |
| Quest, place, person | a slug of the name (`cassandra`, `chapel-of-pelor`, `sorfons-mother`) | lower-case letters and digits separated by `-` or `_` |

- Ids in `characters.json` and `npcs.json` share one namespace and must not collide; a person and a place must not share an id either.
- Ids are never translated and never renamed once published: other files and shared links point at them.
- Session-log entries (`activePlots[].npcs[].name`) attach to a person or place **only** when the name exactly matches that entity's English `name` or one of its `aliases` (case-insensitive). Nothing is linked on partial or fuzzy matches.

## Dates: at the table vs. in the world

| Field | Where | Meaning |
|---|---|---|
| `playedOn` | session | Real-world date the session was played (`YYYY-MM-DD`). Falls back to the date inside `dateLabel` (`"Recorded 25 Feb 2026 · …"`). |
| `campaignDay` | event | In-world day number — the Chronicle is ordered and grouped by it. Falls back to the `Day N` in `igLabel`. |
| `igDate` | event | In-world calendar date as text, e.g. `"26 Horisal 867"`. Optional. |
| `igLabel` | event | Narrative label, `"Day 26 · Gilmore's shop, Emon"` — the part after `·` is shown as the scene. |
| `order` | event | Optional number that fixes the order of events on the same day and session (otherwise file order). |
| `date` | event | **Legacy** sort date from the original app, kept for compatibility. It is *not* the real play date (use the session's `playedOn`). |

Nothing requires an exact date: an event with no day inherits the day of its neighbours in the same session (shown as "About Day N"), and one with no dating at all is listed as *Undated*. Ordering never depends on the interface language.

## `events.json`

A real record:

```json
{
  "id": "s1_02",
  "date": "2026-02-25",
  "session": 1,
  "campaignDay": 26,
  "igDate": "26 Horisal 867",
  "igLabel": "Day 26 · Gilmore's shop, Emon",
  "type": "encounter",
  "title": "The Meeting at Gilmore's",
  "summary": "In Emon's academic district, Ayante finds Gilmore's shop wreathed in magical fireworks. …",
  "locationId": "gilmores-shop",
  "xp": 42.17,
  "yp": 37.5,
  "characterIds": ["ayante", "sorfon"],
  "npcIds": ["gilmore"],
  "questIds": ["gilmore-pact", "temple-sarenrae"]
}
```

| Field | Notes |
|---|---|
| `id`, `session` | Required (validator error without them). `session` must have an entry in `sessions.json` (warning otherwise; the Taller refuses it). |
| `title`, `summary` | Expected on every event — they are what the Chronicle card shows. The Taller requires both. |
| `type` | One of `encounter`, `conversation`, `revelation`, `vision` (divine vision), `dream`, `decision`, `discovery`, `combat`, `quest` (quest milestone), `travel`, `planar` (another plane), `downtime` (rest & rites). Each has its own icon and colour family ([design system](design-system.md#kinds-of-event)). Missing or unknown types show as a generic "Event" (unknown = warning). |
| `xp` / `yp` | Map position in **percent** of the map image (0–100), both or neither ([map system](map-system.md#coordinate-system)). Leave both out for events with no place on the map (a dream, a vision, another plane): they appear in the Chronicle and never create a pin. |
| `locationId` | The most precise known place (`locations.json`). Filtering by a place includes everything inside it. |
| `characterIds` | Party members only; NPCs, deities and factions go in `npcIds`. An NPC id in `characterIds` is a validator warning and a Taller error. |
| `relatedEventIds` | List a connection once (usually on the later event); it shows on both. |
| `order` | See [Dates](#dates-at-the-table-vs-in-the-world). |
| `description`, `consequences`, `unresolved` | Optional narrative depth (below). |

### Narrative depth: `description`, `consequences`, `unresolved`

Most events need only a `title` and a one- or two-sentence `summary`. The moments that matter (a revelation, a betrayal, a decision that changes the campaign) can carry more, shown **only on the event's page**, in this order: title → day and session → the summary as a lead and the `description` → *What changed* → *Still unresolved* → people, quests, connected events, where & when. Empty fields are not shown.

| Field | Shown as | Write |
|---|---|---|
| `description` | the full account, under the summary | What happened, in prose. Blank lines separate paragraphs. |
| `consequences` | **What changed** | A list of sentences: what is different now **in our campaign**, as verified at the table. |
| `unresolved` | **Still unresolved** | A list of sentences: questions, conflicts and objectives still open after this event. They also appear in the *Previously on…* recap of its session. |

Record only what happened or was established at the table — never guesses written as facts. If something is a theory of the players, say so ("The party suspects…") or leave it out.

A simple event (illustrative ids, not campaign canon):

```json
{
  "id": "s99_01", "session": 99, "campaignDay": 120, "igLabel": "Day 120 · The coast road",
  "type": "travel", "title": "Down the Coast Road",
  "summary": "Two quiet days on the road south; nothing stops the party.",
  "characterIds": ["ayante", "ereldra", "mortis", "sorfon"]
}
```

An important event with the three optional fields (illustrative, to show the shape):

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

## `sessions.json`

An object keyed by session number (as a string). Each entry is the session log:

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
    "completedPlots": [
      { "name": "The Forge of Tyr", "questId": "tyr-forge", "closed": "Closed this session", "qt": "…" }
    ]
  }
}
```

- Keys must be session numbers (any other key is a validator error). The Sessions list is numeric, with gaps for numbers that have no entry.
- `activePlots` are the threads still open at the end of the session (shown as *Unresolved threads*); `completedPlots` closed during it (with `"closed": "Closed this session"`).
- `questId` links a plot to its quest, so the quest page can show this session's snapshot (warning if the quest's `sessions[]` does not list the session; error if the quest does not exist).
- Plot `npcs` entries need a `name`; `race`, `role`, `region` are optional. They are shown in the session log and, when the name matches a person or place exactly, in that entity's *From the session logs*.

### `recap` — Previously on… (optional)

The recap of a session is built from what is already recorded: `endedHere` (*where the party was left*), the session's events, its `activePlots` (*still open*), `completedPlots`, `effects`, its quests, and the `unresolved` items of its events. Nothing is ranked or summarised automatically — without a `recap` entry, **every** recorded event is listed in order under *What was recorded*. To curate it:

```json
"12": {
  "title": "Councils Before the Hunt",
  "recap": {
    "summary": "Two or three sentences to read aloud before the next session.",
    "highlights": ["s12_03", "s12_05", "s12_06"]
  }
}
```

- `highlights` — 3 to 5 event ids **of that session**, in the order to show them (events of other sessions are ignored with a warning; more than five is a warning; an unknown id is an error). Decisions that are not highlighted are listed apart, so none is lost.
- `summary` — optional; translate it as `sessions["12"].recap.summary` in `data/i18n/es-AR.json` (shown in English, with a note, until translated). A translation without an English summary is never shown.
- The *latest* session is the highest session number that has an entry here — never the order of labels or of the Sessions list.

## `quests.json`

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

- `status` — `active` (In progress), `pending`, `completed` or `failed`. The page shows any other value as written; the Taller only offers the four.
- `giver` is display text (`"—"` or omit to hide); `giverId` links it to a person.
- `sessions` — the sessions where the quest moved on. The quest's events, places and NPCs come from events whose `questIds` include it.

> [!NOTE]
> **Quests vs. session plots — two deliberate views.** `quests.json` is the campaign-level, current state (one entry per quest). Each session's `activePlots`/`completedPlots` is the *snapshot* of those threads at that session (evolving text). They overlap in narrative on purpose; when a quest opens, advances or closes, update **both** the session's plot (history, with its `questId`) and the quest entry (current state, adding the session to `sessions[]`). Do not "de-duplicate" them.

## `characters.json` and `npcs.json`

A party member (`characters.json`):

```json
{ "id": "mortis", "name": "Mortis", "role": "Wizard · School of Necromancy / Cleric · Death Domain", "color": "#858590", "sealImg": "assets/icon-mortis.jpeg", "aliases": ["Morgas"] }
```

An NPC (`npcs.json`):

```json
{
  "id": "diomedes",
  "name": "Diomedes",
  "category": "person",
  "race": "human",
  "relations": [{ "id": "ayante", "label": "His student", "reverseLabel": "His master" }]
}
```

- PCs: `color` (`#RRGGBB`) draws the pin, the party toggle and the journey line; `sealImg` is the round portrait (a relative path to a file in `assets/`, checked by the validator).
- NPCs: `category` is `person`, `deity`, `creature` or `faction`. Optional `sealImg` / `role`; without a portrait a monogram is shown.
- `aliases` — other recorded names, used for the exact-match linking of session-log notes and for search.
- `factionIds` — factions (entries with `category: "faction"`) the person belongs to; the faction lists its members automatically.
- `relations` — written once, on either person. `label` describes the *other* person as seen from this one (shown on this person's page); `reverseLabel` describes this person as seen from the other (shown on the other's page; defaults to `label`).

## `locations.json`

One record per line:

```json
{ "id": "emon", "name": "Emon", "kind": "city", "parentId": "taldorei" }
{ "id": "example-town", "name": "Example Town", "kind": "city", "parentId": "taldorei", "xp": 48.1, "yp": 36.72, "mapPrecision": "exact" }
```

(The second line is illustrative: no place has its own position yet.)

- `kind` — `continent`, `region`, `sea`, `city`, `district`, `site` or `plane`; each has its own icon. A missing or unknown kind is shown as a plain place (a map-marker icon; an unknown kind keeps its own word as the label) and the validator warns.
- `parentId` nests places; filtering or opening a place includes everything inside it. Only recorded links make the tree: a place without `parentId` is top level — nothing is inferred from names or from the lore. An unknown `parentId` or a loop (`a → b → a`) is a validator error; the page then shows the first place of the loop at the top level.
- The Places index lists siblings in story order (the first event recorded there or inside), then by name; places never visited come last. Top-level places of `kind: "plane"` (with everything inside them) form the *Other planes* group; every other top-level place is in the *Atlas of Exandria*.
- `xp` / `yp` / `mapPrecision` (all optional) — the place's **own map position**, a reference used by *View on map*, the place's map preview and position suggestions. It never moves an event already placed and planes never have one. Details in [Map system › Places and their positions](map-system.md#places-and-their-positions).

**Adding a place without breaking the map:** add it here (with `parentId` if it sits inside another place), reference it from events with `locationId`, and give those events `xp`/`yp` only if the place is on the Exandria map. A place with no positioned event simply has no **View on map**. Add its Spanish name under `places` in `data/i18n/es-AR.json` when it has translatable words ("Temple of …"); bare proper names need nothing.

## `routes.json`

The dashed lines on the map come **only** from this file. Events are where something happened; routes are how someone got from one place to another. A line is never derived from events. One key per party member, an **ordered** array of waypoints:

```json
{
  "mortis": [
    { "xp": 45.61, "yp": 32.36, "leg": "s8-airship", "session": 8, "locationId": "kraghammer" },
    { "xp": 42.3, "yp": 32.3, "leg": "s8-airship", "session": 8 },
    { "xp": 30.2, "yp": 27.2, "leg": "s8-airship", "session": 8, "locationId": "vasselheim" },
    { "xp": 29.9, "yp": 26.0, "break": true }
  ]
}
```

(Abridged and with an illustrative `break` point; the real file records the session 8 airship crossing.)

| Field | Meaning |
|---|---|
| `xp`, `yp` | Required numbers, 0–100 (error otherwise). |
| `leg` | Id of a journey travelled **together**: when two or more visible party members carry the same `leg` on consecutive waypoints, that stretch is drawn once as a shared line. A `leg` used by one character only is a warning. |
| `break` | `true` = do not connect this waypoint to the previous one: the journey in between was not recorded. |
| `session`, `locationId` | Notes for whoever maintains the file (validated, not drawn). |

The order is the order travelled: revisits (A → B → A → C) are kept; only an accidental repeat of the same point twice in a row is ignored. The old format (bare `{ "xp", "yp" }` arrays) is still valid. How routes are drawn is described in [Map system › Routes](map-system.md#routes).

The current file records the session 8 airship crossing Kraghammer → Vasselheim, taken by the whole party (the session 8 log ends "after the airship crossing" and all four arrive in event `s8_06`). The journey from Emon to Kraghammer (sessions 3–7, never chronicled) is deliberately *not* drawn. Never edit coordinates for presentation.

## `lore.json` — Canon lore

Background from **published canon** — Critical Role's Exandria, and the wider Dungeons & Dragons multiverse the campaign borrows from (Strahd, Ashardalon) — kept apart from what happened at the table. It never changes campaign data: names, aliases, relations, events, search and filters are built exactly as if the file did not exist (a unit test compares both). Entities only *read* it, as a folded section at the end of their page.

```json
{
  "sources": {
    "cr-wiki": { "label": "Critical Role Wiki", "url": "https://criticalrole.fandom.com/wiki/Critical_Role_Wiki", "community": true, "spoilers": true },
    "fr-wiki": { "label": "Forgotten Realms Wiki", "url": "https://forgottenrealms.fandom.com/wiki/Main_Page", "community": true, "spoilers": true }
  },
  "entries": {
    "pelor": {
      "summary": "One of the Prime Deities and among Exandria's creator gods: …",
      "facts": { "alsoKnownAs": "The Dawnfather · The Lord of the Sun", "domains": "Life, Light, Nature", "symbol": "A bright, eight-pointed star" },
      "references": [{ "source": "cr-wiki", "title": "The Dawnfather", "url": "https://criticalrole.fandom.com/wiki/The_Dawnfather" }],
      "basedOn": ["cr-wiki"],
      "lastReviewed": "2026-10-14"
    }
  }
}
```

- `entries` is keyed by an **existing** person or place id (`npcs.json`, `characters.json`, `locations.json`) — never a new entity, never a renamed id. An entity without an entry has no lore section. (Lore on a party member is allowed but warned about.)
- `sources` — one per website: `label` (required, shown on links, in the folded row and in the attribution), optional home `url`, `community: true` for fan-run sites (shown as "community wiki, not official"), `spoilers` (default `true`: show the spoiler warning under its links). There are two, both Fandom community wikis whose text is CC BY-SA: `cr-wiki`, the [Critical Role Wiki](https://criticalrole.fandom.com/wiki/Critical_Role_Wiki), for Exandria's own people, places and gods; and `fr-wiki`, the [Forgotten Realms Wiki](https://forgottenrealms.fandom.com/wiki/Main_Page), for D&D entities from other settings that the campaign brings in (Strahd, Ashardalon).
- `references` — one or more links: `source` (a key of `sources`), `url`, `title` (the article name). **Only absolute `https://` URLs** are accepted (no `javascript:`, `data:`, `http:`, relative or credential URLs); invalid links are dropped and reported, duplicates are ignored. Links open in a new tab with `rel="noopener noreferrer"`.
- `summary` (optional) — a short **original** text, about 40–80 words (over 120 words is a warning).
- `facts` (optional) — a few labelled values from a fixed vocabulary: `alsoKnownAs`, `continent`, `region`, `government`, `portfolio`, `domains`, `symbol`, `worshippers`, `temples`, `base`, `purpose`, `patron`, `affiliation`, `role`. Unknown keys are ignored (warning).
- `basedOn` (optional) — source ids the summary was written from (default: the sources of its references). `lastReviewed` (optional, `YYYY-MM-DD`).
- A `summary` or `facts` **without at least one valid reference is rejected** (validator error, not shown): nothing unsourced reaches the page.
- Spanish: `data/i18n/es-AR.json` → `"lore": { "<id>": { "summary": "…", "facts": { "domains": "Vida, Luz" } } }` (and `"loreSources": { "<sourceId>": { "label": "…" } }` if a source name needs translating). Per-field English fallback; a summary shown in English in the Spanish interface says so. Proper names stay as in the source.

**On the page:** a single collapsed row **Canon lore** after every campaign section, folded again on every page; its hint names the entry's own sources (*Outside information (Forgotten Realms Wiki) · may contain spoilers*). Opened, it shows the summary, the facts, one link card per reference, the spoiler warning and a one-line attribution (*summary written for this chronicle from … · reviewed … · what happened at our table takes precedence*). Nothing is fetched from the external site — no scraping, no embeds, no images.

### Adding lore for an entity — checklist

1. Make sure the entity really *is* the canon one (same person/place, not just a similar name). The DM's own NPCs get nothing unless that link is confirmed.
2. Pick the wiki — the Critical Role Wiki for Exandria's own canon, the Forgotten Realms Wiki for a D&D entity from another setting — then find the article and check that it exists under that exact title. Each wiki's API is handy: `https://<wiki>.fandom.com/api.php?action=query&format=json&redirects=1&titles=<Title>` with `<wiki>` = `criticalrole` or `forgottenrealms`; use the final title of any redirect (e.g. Pelor → *The Dawnfather*). When the article page refuses automated readers, `action=parse&format=json&prop=wikitext&page=<Title>` returns its text.
3. Write the summary in your own words from verifiable facts, **spoiler-free**: no secret identities, betrayals, deaths, plot twists or late-campaign developments. When in doubt, leave it out — the link is there for the rest. Never copy article text or images (Fandom text is CC BY-SA; images have their own terms).
4. Add the Spanish version under `lore` in `data/i18n/es-AR.json`, then run `npm test`.

**Current coverage.** From the Critical Role Wiki (reviewed 2026-10-14): places Tal'Dorei, Emon, Greyskull Keep, Gilmore's shop (*Gilmore's Glorious Goods*), Kraghammer, the Ozmit Sea, Whitestone, Vasselheim, the Shadowfell, the Far Realm; deities Pelor, Sarenrae, the Raven Queen, Bahamut, Torog; factions La Toma (*Slayer's Take*) and the shadar-kai; people Gilmore, Pike Trickfoot, Allura Vysoren, Cassandra and Percival de Rolo, Vax'ildan. From the Forgotten Realms Wiki (reviewed 2026-10-20): the creatures Ashardalon and Strahd von Zarovich. Not covered yet, although the Forgotten Realms Wiki has articles for them: Baba Yaga (*Baba Yaga*) and Ravenloft/Barovia (*Barovia*). Without an article in either wiki (left without lore on purpose): the Monster Jägers, Haftifaflmorhen, Cromulus, Ilión, Damali, and every DM-original NPC and place.

## Translations (`data/i18n/es-AR.json`)

Spanish of Argentina (`es-AR`) is the interface's default language; English is the **source language of the data**. The English `data/*.json` files stay the source of truth; the Spanish overlay is keyed by stable ids:

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

- **Positional arrays.** Effects, plots, plot `npcs`, notes, objectives, consequences, unresolved, aliases and relations are matched by position: same length and order as the English source. A list of another length is ignored (English shown, validator warning).
- **Never translated:** ids, coordinates, dates (`playedOn`, `igDate`), `questId`s and links. Session-log names keep linking by their English spelling even when a translated `name` is shown.
- **Fallback.** Any missing or empty translated value shows the English text, field by field. Nothing ever shows a key or an empty label. A translated text without an English source (an event `description`, a recap `summary`, a lore fact) is never shown — the validator warns.
- **Adding a bilingual record:** add it to the English file as usual, then add `"<id>": { "title", "summary", "igLabel" }` (plus any narrative fields) under `events`; the same for a session (under `sessions`, keyed by its number), quest, person or place. Until then the record appears in English in the Spanish interface. `node tools/validate-data.js` prints the translation coverage.

How interface strings (not content) are translated is described in [Architecture › Internationalisation](architecture.md#internationalisation).

## Validation and integrity rules

`node tools/validate-data.js` (also the first half of `npm test`) runs the page's own model over the files. Its file-system-free rules are `ChronicleModel.validateData(raw, { translations })`, which the Taller del Cronista runs in the browser too; the tool adds the file checks.

**Errors** (exit code 1 — the page would break or show wrong links):

- invalid JSON, a required file missing, a file of the wrong shape (array vs. object);
- an entry without `id`, a duplicate id (events, quests, people, places), an id used by both a person and a place, a session key that is not a number, an event without `session`;
- a link to something that does not exist: an event's character, NPC, quest, place or related event; a quest's character or `giverId`; a plot's `questId`; a person's faction or relation; a place's `parentId`; a recap highlight that is not an event;
- a `parentId` loop;
- coordinates outside 0–100 (events, places, route waypoints), a waypoint without numeric `xp`/`yp`, a malformed `leg`, `break` or `session` on a waypoint;
- a `recap` that is not an object;
- lore: a source without label, a non-https URL, an entry for an unknown entity, a summary or facts without a valid reference;
- a portrait path (`sealImg`) that does not exist; a file listed in `sw.js`'s `PRECACHE` that does not exist.

**Warnings** (softer inconsistencies, they do not fail):

- unknown event type; incomplete coordinates (only `xp` or only `yp`); a planar place with coordinates (ignored); an unknown `mapPrecision`;
- an NPC id in `characterIds`; an event whose session has no log; an event or plot linking a quest whose `sessions[]` does not list that session; a quest listing a session without a log;
- recap highlights of another session or more than five;
- a `leg` used by one character only; an unknown character or `locationId` in `routes.json`; an invalid waypoint (skipped, the route is broken there);
- translations: unknown ids, positional lists of the wrong length, translated texts without an English source; missing `data/i18n/es-AR.json`;
- lore: unknown source, duplicate link, unknown or empty fact, long summary, bad `lastReviewed`, lore on a party member;
- a name declared by two entities; a data file not listed in `PRECACHE`.

Its last lines are informational: counts, translation coverage, what is **still to be written** (unchronicled sessions, events without narrative depth, sessions without an editorial recap), session-log entries that did not match any entity, and top-level places of the Atlas without `parentId`.

`--data <folder>` checks a package exported from the Taller before copying it in: `<folder>/<name>.json` (and `<folder>/i18n/es-AR.json`) take precedence over the repository's files. See [Development › Validating data](development.md#validating-data).

The Taller adds **form checks** for the records a draft touches (required title/summary/name, real `YYYY-MM-DD` dates, session numbers, id format and collisions, an event's session must exist, the four quest statuses, `#RRGGBB` colours, portraits that exist in `assets/`, no place inside itself, highlights of the same session, nothing deleted while something still mentions it). Only problems the draft introduced are reported; errors block the export.

## Legacy records

Older records keep working: events with only `date`/`igLabel`/`xp`/`yp`, sessions with only `dateLabel`, quests without `giverId`, or no `npcs.json`/`locations.json`/`lore.json` at all. Missing fields are derived where possible (day from `igLabel`, title and play date from `dateLabel`) and otherwise hidden — the page never shows empty sections or placeholder data.

## Current data status

Nothing in the chronicle is filled in automatically, and nothing is invented to complete optional fields. As of 2026-10-20 (`node tools/validate-data.js` prints the current state):

- 8 sessions (1, 2, 8, 10–14), 52 events (all with a map position), 19 quests, 4 party members, 44 NPCs/deities/creatures/factions, 33 places, lore for 25 entities; every event, session, quest and lore summary has its Spanish translation (people and places only need one when their name has translatable words).
- **Sessions 3–7 and 9 have not been chronicled** (no log, no events): the Sessions list shows them as gaps. They should be written from the table's notes, not reconstructed.
- **No event has `description`, `consequences` or `unresolved` yet** (0 of 52), and **no session has an editorial `recap`** (0 of 8), so *Previously on…* lists every recorded event of the latest session.
- **No place has its own map position yet**; they are added in the map editor when known, never inferred.
- **Eight places of the Atlas have no `parentId`** (Ilión, Damali, Kraghammer, the Ozmit Sea, Whitestone, Vasselheim, the high peak of the Calamity, the mountain above Vasselheim — the table only says it overlooks the city), so they sit at the top level of the Places index beside Tal'Dorei. Some have hints outside the campaign's links — Vasselheim's lore names the continent Issylra (not a recorded place), Whitestone's the Parchwood Timberlands, and the session 1 log calls Ilión "the far continent" while `locations.json` records it as a `region` — but nothing is nested or re-kinded from hints: add `parentId` / `kind` when the table confirms it.
