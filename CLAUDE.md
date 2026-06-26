# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Running the app

```
npx serve -p 5500 .
```

Open `http://localhost:5500/Chronicle.dc.html` in a browser. There is no build step for the app itself — all content is in the single `.dc.html` file. Just reload the browser after edits.

## Rebuilding support.js

`support.js` is a generated bundle — do **not** edit it directly. The source lives in a separate `dc-runtime` repo/directory (not present here). The comment at the top of `support.js` shows the rebuild command:

```
cd dc-runtime && bun run build
```

## Architecture

This is a single-file **Design Component** (`.dc.html`) application powered by the `dc-runtime`. The runtime is loaded via `support.js`, which in turn loads React 18 from unpkg before booting.

### dc-runtime concepts

- **`<x-dc>`** — wraps the entire template; the runtime strips it and mounts a React root in its place.
- **`{{ expr }}`** — template interpolation; `expr` resolves against the values returned by `renderVals()`.
- **`<sc-for list="{{ … }}" as="item">`** / **`<sc-if value="{{ … }}">`** — structural directives compiled into React elements.
- **`<helmet>`** — injects `<link>`, `<style>`, `<script>` tags into `<head>` at runtime.
- **`<script type="text/x-dc" data-dc-script>`** — the logic block; must define `class Component extends DCLogic`. The `data-props` attribute carries JSON metadata for the editor.
- **`style-hover="…"`** — pseudo-class helper that injects a scoped CSS rule via the pseudo sheet.
- **`DCLogic` / `StreamableLogic`** — base class for the component. Key methods: `renderVals()` (returns the values available to the template), `setState()`, `componentDidMount()`, `componentWillUnmount()`.

### Chronicle.dc.html structure

The file is a single-component D&D campaign chronicle with three panes:

| Pane | Content |
|------|---------|
| Left sidebar | Party member filters, date/text filters, chronological event timeline |
| Center | Pannable/zoomable Exandria map with character route SVG overlays and event pins |
| Right panel | Session log — opened when an event pin or timeline card is clicked |

**Data is hard-coded inside the `Component` constructor:**
- `this.characters` — the four PCs with portrait image paths and colors
- `this.routes` — arrays of `{xp, yp}` waypoints (% of map dimensions) per character
- `this.events` — individual campaign events, each with `{id, date, session, igLabel, title, summary, xp, yp, characterIds[]}`
- `this.sessions` — keyed by session number; each entry has the full session log (plots, NPCs, notes, effects)

**Key helper classes inside the script block:**
- `MapViewport` — handles wheel zoom, mouse-drag pan, clamping, and centering on a selected event
- `DocsStore` — `localStorage` persistence for any per-event title/body overrides
- `FILTER_PREDICATES` — array of filter functions (text search, date range) applied in `passes()`

**`renderVals()` builds all template bindings**, including `partyRows`, `timeline`, `pins`, `routesSvg`, `sel` (selected event popup), and `panel` (right session panel).

### Assets

- `assets/exandria-map.jpeg` — the base map image
- `assets/icon-{ayante,ereldra,mortis,sorfon}.jpeg` — circular PC portrait images used as map seals and sidebar avatars

### Adding a new session or event

1. Append objects to `this.events` in the constructor (follow the existing shape).
2. Add a matching entry to `this.sessions` keyed by session number.
3. Route waypoints go in `this.routes[characterId]` as `{xp, yp}` percentage coordinates on the map.
