# Campaign Chronicle Map

An interactive campaign map & session log for a D&D party. It shows character routes on a map, a filterable event timeline, and a full session log panel — all in a single static HTML page, no backend or build step required.

The party name, world name, and other branding text you see on the page are hardcoded strings in `index.html` itself (not data-driven) — edit them there if you want to reuse this for a different campaign.

Live version: served via GitHub Pages from this repo (see [Deploying](#deploying-github-pages) below).

## Using the page

Open the site and you'll see three areas:

- **Left sidebar**
  - **Party section** — toggle party members on/off. Disabling a character hides their route line and dims their pins/timeline entries.
  - **Timeline filters** — free-text search (matches event title/summary) and a date range (`From` / `To`). `RESET` clears all filters. The counter shows how many events match out of the total.
  - **Event timeline** — the full event list, grouped by session, sorted chronologically. Click a session header to collapse/expand it. Click any event card to select it.
  - `‹` collapses the sidebar; `☀`/`🌙` toggles light/dark theme.
- **Center — the map**
  - Scroll to zoom, click-drag to pan, use the `+`/`–`/reset controls in the corner.
  - Colored route lines show each active character's path across the map.
  - Diamond-shaped pins mark events; multi-character events show a shared seal. Click a pin to select that event (same effect as clicking it in the timeline).
- **Right panel — session log**
  - Opens automatically when you select an event. Shows that session's start/end location, in-game day markers, ongoing effects, all events logged that session, and the full write-up of active/completed plots (with NPCs and notes).
  - Minimize with the collapse icon, or close with `✕`.

Everything except the theme toggle is read-only browsing — there's no in-page editor. New content is added by editing the JSON data files described below.

## Running locally

The app is a single static page (`index.html`) plus a `support.js` runtime and JSON data files. It needs to be served over HTTP — opening `index.html` directly by double-clicking it (`file://…`) will fail to load the data (`fetch()` of local files is blocked by the browser under `file://`).

```bash
npx serve -p 5500 .
```

Then open `http://localhost:5500/` in a browser. There's no build step — just edit files and reload.

## Deploying (GitHub Pages)

GitHub Pages serves the repo over HTTPS, so it works exactly like `npx serve` — no extra configuration needed. Just make sure everything, including the `data/` folder, is committed and pushed, then enable Pages on the repo (Settings → Pages → deploy from the `main` branch).

## Configuring the campaign data

All campaign content lives in four JSON files under `data/` and is loaded at runtime — you never need to touch `index.html` to add a session.

```
data/
  characters.json   — the party members
  routes.json        — each character's path across the map
  events.json        — individual timeline events / map pins
  sessions.json      — the full session log shown in the right panel
```

Rules for all four files: valid JSON only — double-quoted keys/strings, no trailing commas, no comments.

Map coordinates (`xp`, `yp`) are **percentages of the map image's width/height** (0–100), not pixels. To place something, estimate roughly where it falls on the map image as a percentage from the top-left.

### `characters.json`

One entry per PC. `id` is the key used everywhere else (`routes`, `events.characterIds`) to reference this character.

```json
[
  {
    "id": "thalon",
    "name": "Thalon",
    "role": "Ranger · Gloom Stalker",
    "color": "#4A6B5C",
    "sealImg": "assets/icon-thalon.jpeg"
  }
]
```

- `color` — used for the route line and the sidebar toggle dot.
- `sealImg` — circular portrait shown as the map pin/seal and sidebar avatar (path relative to the site root).

### `routes.json`

One key per character `id`, an ordered array of waypoints. The line is drawn through them in array order.

```json
{
  "thalon": [
    { "xp": 20.0, "yp": 55.0 },
    { "xp": 24.5, "yp": 51.0 },
    { "xp": 29.0, "yp": 47.5 }
  ]
}
```

### `events.json`

A flat array of every pin/timeline entry, across all sessions.

```json
{
  "id": "s1_01",
  "date": "2026-01-10",
  "session": 1,
  "igLabel": "Day 1 · Millbrook",
  "title": "The Merchant's Warning",
  "summary": "A traveling merchant pulls Thalon aside outside the tavern, warning that the road north has gone quiet — no caravans in three days.",
  "xp": 21.4,
  "yp": 54.2,
  "characterIds": ["thalon"]
}
```

- `id` — unique string, convention is `s<session>_<sequence>` (e.g. `s1_01`, `s1_02`, `s2_01`...).
- `date` — real-world/recording date, `YYYY-MM-DD`, used for the date-range filter and default sort order.
- `session` — links this event to a `sessions.json` entry.
- `igLabel` — the in-game date/place label shown instead of `date` where more flavorful context helps (optional; falls back to a formatted `date` if omitted).
- `xp` / `yp` — where the pin appears on the map.
- `characterIds` — which party members were involved; more than one shows a shared "multi" seal on the map.

### `sessions.json`

An object keyed by session number (as a JSON string, e.g. `"1"`). Each entry is the full write-up shown in the right panel when any of that session's events is selected.

```json
{
  "1": {
    "dateLabel": "Recorded 10 Jan 2026 · The Road to Millbrook",
    "startedHere": "Millbrook, outside the Rusted Kettle tavern — the party gathers after a merchant's warning about the northern road.",
    "endedHere": "Camped at the forest's edge, a day's walk north of Millbrook.",
    "ig": {
      "start": "Day 1 — Millbrook",
      "end": "Day 1 — evening, forest edge",
      "rest": "Day 1 — end of this session"
    },
    "effects": [
      "The party knows caravans have gone missing on the northern road for the past three days."
    ],
    "activePlots": [
      {
        "name": "The Silence on the North Road",
        "qt": "Three caravans have vanished on the road between Millbrook and Ashford over the last week. A local merchant asked the party to investigate before a fourth goes missing.",
        "npcs": [
          { "name": "Old Maren", "race": "human", "role": "merchant in Millbrook — first to raise the alarm" }
        ],
        "notes": [
          "No bodies or wreckage have been found — caravans simply stop arriving."
        ]
      }
    ],
    "completedPlots": []
  }
}
```

- `effects` — short bullet list of ongoing consequences, shown at the top of the panel.
- `activePlots` / `completedPlots` — same shape; move a plot object from `activePlots` to `completedPlots` (and add a `"closed": "…"` string to it) once it wraps up.
- Each plot's `npcs` entries support `name` (required), and optional `race`/`role`/`region`.

### Adding a new session

1. Append one object per beat to `data/events.json` (new `id`s, same `session` number).
2. Add the matching entry to `data/sessions.json`, keyed by that session number.
3. If the party moved, extend each character's array in `data/routes.json` with the new waypoints.
4. Validate the JSON (e.g. paste into a linter, or run `node -e "JSON.parse(require('fs').readFileSync('data/events.json'))"`) before committing — a syntax error will make the page load with no data.

## Assets

- `assets/exandria-map.jpeg` — the base map image.
- `assets/icon-*.jpeg` — circular PC portraits, one per entry in `characters.json`.
- `assets/icon-bund-der-vier.png` — shared seal used for pins/events involving multiple characters.
