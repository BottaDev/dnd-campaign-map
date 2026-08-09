# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Running the app

```
npx serve -p 5500 .
```

Open `http://localhost:5500/index.html` in a browser. There is no build step for the app itself — all content is in the single `index.html` file. Just reload the browser after edits.

Campaign data is fetched at runtime from `data/*.json` (see below), so the app must be served over HTTP — opening `index.html` directly via `file://` will fail to load data due to browser fetch/CORS restrictions.

## Rebuilding support.js

`support.js` is a generated bundle — do **not** edit it directly. The source lives in a separate `dc-runtime` repo/directory (not present here). The comment at the top of `support.js` shows the rebuild command:

```
cd dc-runtime && bun run build
```

## Architecture

This is a single-file **Design Component** (`index.html`, a `.dc.html`-style template) application powered by the `dc-runtime`. The runtime is loaded via `support.js`, which in turn loads React 18 from unpkg before booting.

### dc-runtime concepts

- **`<x-dc>`** — wraps the entire template; the runtime strips it and mounts a React root in its place.
- **`{{ expr }}`** — template interpolation; `expr` resolves against the values returned by `renderVals()`.
- **`<sc-for list="{{ … }}" as="item">`** / **`<sc-if value="{{ … }}">`** — structural directives compiled into React elements.
- **`<helmet>`** — injects `<link>`, `<style>`, `<script>` tags into `<head>` at runtime.
- **`<script type="text/x-dc" data-dc-script>`** — the logic block; must define `class Component extends DCLogic`. The `data-props` attribute carries JSON metadata for the editor.
- **`style-hover="…"`** — pseudo-class helper that injects a scoped CSS rule via the pseudo sheet.
- **`DCLogic` / `StreamableLogic`** — base class for the component. Key methods: `renderVals()` (returns the values available to the template), `setState()`, `componentDidMount()`, `componentWillUnmount()`.

### index.html structure

The file is a single-component D&D campaign chronicle with three panes:

| Pane | Content |
|------|---------|
| Left sidebar | A `Chronicle` / `Quests` toggle switches its lower half (`state.viewMode`). Chronicle = party filters, date/text filters, chronological event timeline. Quests = campaign quest log (in-progress + completed). A `?` button opens the first-visit tutorial overlay. |
| Center | Pannable/zoomable Exandria map with character route SVG overlays and event pins; each pin carries a counter-scaled `Session N` caption beneath it |
| Right panel | Session log — opened when an event pin, timeline card, or quest card is clicked |

**Data lives in `data/*.json` and is fetched in `componentDidMount()`**, then assigned onto the instance (`this.characters`, `this.routes`, `this.events`, `this.sessions`, `this.quests`) before a `setState({})` forces the first data-driven render:
- `data/characters.json` — the four PCs with portrait image paths and colors
- `data/routes.json` — arrays of `{xp, yp}` waypoints (% of map dimensions) per character
- `data/events.json` — individual campaign events, each with `{id, date, session, igLabel, title, summary, xp, yp, characterIds[]}`
- `data/sessions.json` — keyed by session number (as a JSON string key); each entry has the full session log (plots, NPCs, notes, effects)
- `data/quests.json` — campaign-wide quest log (an array), each `{id, title, status:"active"|"completed", giver, summary, sessions[], characterIds[]}`; drives the sidebar's Quests view

> **Quests vs. session plots — intentional two-view split (do not "de-duplicate").** `quests.json` is the current campaign-level rollup (one row per quest, deduped, with `status`). The `activePlots`/`completedPlots` inside `sessions.json` are the *per-session snapshots* of those same threads (a quest can appear in several sessions with evolving text). They deliberately overlap in narrative; the only formal link is the session numbers in a quest's `sessions[]`. Maintaining a quest means updating **both**: the session's plot (history) and the quest entry (current state). This was a deliberate choice over deriving quests from plots at runtime.

**Key helper classes inside the script block:**
- `MapViewport` — handles wheel zoom, mouse-drag pan, clamping, and centering on a selected event
- `DocsStore` — `localStorage` persistence for any per-event title/body overrides
- `FILTER_PREDICATES` — array of filter functions (text search, date range) applied in `passes()`

**`renderVals()` builds all template bindings**, including `partyRows`, `timeline`, `pins`, `routesSvg`, `sel` (selected event popup), `panel` (right session panel), and `quests` (built by `_buildQuests`). The left pane switches between the timeline and the quest log via `state.viewMode` (`"chronicle"` | `"quests"`) — note this is distinct from `state.view`, which is the map viewport transform `{scale, x, y}`. A first-visit tutorial overlay is gated by `state.showTutorial` and a `chronicle-tutorial-seen` `localStorage` flag.

### Assets

- `assets/exandria-map.jpeg` — the base map image
- `assets/icon-{ayante,ereldra,mortis,sorfon}.jpeg` — circular PC portrait images used as map seals and sidebar avatars

### Adding a new session or event

1. Append objects to `data/events.json` (follow the existing shape).
2. Add a matching entry to `data/sessions.json`, keyed by session number.
3. Route waypoints go in `data/routes.json[characterId]` as `{xp, yp}` percentage coordinates on the map, if the party moved this session.
4. Update `data/quests.json` if the session opens, advances, or closes a campaign quest (flip `status` to `"completed"` and add the session number to `sessions[]`).
5. All `data/*.json` files must stay valid JSON — no comments, no trailing commas, all keys quoted.
