# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Running the app

No build step. Open [Chronicle.dc.html](Chronicle.dc.html) directly in a browser. The app is self-contained; `support.js` is the only dependency and is already bundled.

> `support.js` is generated — do **not** edit it manually. The comment at the top says to rebuild it from `dc-runtime/src/*.ts` with `cd dc-runtime && bun run build`, but that source directory is not present in this repo.

## Architecture

The entire application lives in one file: **`Chronicle.dc.html`**.

It uses a custom **DC (Document Component) runtime** (`support.js`) built on top of React (loaded globally as `window.React`). The DC runtime is not a published package — `support.js` is a bundled build of it.

### DC file format

A `.dc.html` file has three parts inside `<x-dc>`:

1. **HTML template** — Mustache-style `{{ variable }}` interpolation. Directives `<sc-for list="{{ … }}" as="item">` and `<sc-if value="{{ … }}">` handle loops and conditionals. Inline event handlers use `onClick="{{ handler }}"`.
2. **`<helmet>`** — injected into `<head>` (fonts, global styles).
3. **`<script type="text/x-dc" data-dc-script>`** — contains `class Component extends DCLogic { … }`. Props schema and preview size live in `data-props` on this element (JSON-encoded).

### Component lifecycle

- **`constructor(props)`** — define `this.characters`, `this.events`, `this.sessions`, `this.codex`, `this.routes`, and initial `this.state`.
- **`componentDidMount()` / `componentWillUnmount()`** — wire up wheel/mouse listeners for map pan & zoom; set up auto-centering retries.
- **`renderVals()`** — returns a flat object of every template variable. This is the only method the DC runtime calls for rendering. There is no `render()` or JSX.

### Data model (all hardcoded in the constructor)

| Field | Description |
|---|---|
| `this.characters` | Array of `{ id, name, role, color, seal }` — the party members |
| `this.events` | Array of campaign events with `{ id, date, session, igLabel, title, summary, xp, yp, tags, characterIds }` — `xp/yp` are `%` coordinates on the Exandria map |
| `this.routes` | Per-character arrays of `{ xp, yp }` waypoints drawn as SVG polylines on the map |
| `this.sessions` | Keyed by session number; each entry holds the session log: `startedHere`, `endedHere`, `ig` times, `effects`, `activePlots`, `completedPlots` |
| `this.codex` | Global reference data: `records` (stats), `allies`, `enemies` |

### Map & viewport

The map image is `assets/exandria-map.jpeg`. Coordinates (`xp`, `yp`) are percentages of the full image dimensions. The viewport supports mouse-drag panning and scroll-wheel zooming (`MIN=1`, `MAX=6`). `centerOn(ev, minScale)` computes the view transform to bring an event's pin to the center of the viewport.

### State

```js
this.state = {
  enabled: { sorfon, ayante, mortis, ereldra },   // character visibility toggles
  filters: { text, characterId, tag, from, to },   // timeline filter values
  selectedId: null,                                 // currently selected event id
  view: { scale, x, y },                           // map viewport
  collapsed: false,                                 // left sidebar collapsed
  rightCollapsed: false,                            // right story panel collapsed
  codexOpen: false,                                 // codex modal
  docs: {},                                         // overrides persisted to localStorage
}
```

`docs` lets the user override an event's `title` and `body` fields; overrides are persisted to `localStorage` under the key `"chronicle-docs"`.

### Layout

Three-column CSS Grid: `[left sidebar] [map] [right story panel]`. Column widths are computed by `renderVals()` as `gridCols` and driven by `collapsed` / `rightCollapsed` state, with a CSS `transition` for animation. The right panel opens when an event is selected on the timeline or map.

## Adding content

To add a new session or event:
1. Push new objects into `this.events` (in the constructor).
2. Add a matching key to `this.sessions` for the session log.
3. Update `this.routes` waypoints as needed.
4. Update `this.codex` records, allies, or enemies if the session changed them.
5. Reload the browser — no build required.
