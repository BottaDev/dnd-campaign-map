# Map system

How the interactive map of Exandria works: the coordinate system, how events and places become markers, how journeys are drawn, zoom and pan, and the map editor (*Editor cartográfico*) of the Taller del Cronista. Useful for anyone changing map code or map data, including Claude Code.

← [Back to the README](../README.md) · Related: [Data model](data-model.md) · [Architecture](architecture.md) · [Taller guide (ES)](editor-guide.md)

**Contents:** [Two layers](#two-layers-events-and-routes) · [Coordinate system](#coordinate-system) · [Events on the map](#events-on-the-map) · [Places and their positions](#places-and-their-positions) · [Markers and groups](#markers-and-groups) · [Routes](#routes) · [Zoom and pan](#zoom-and-pan) · [Map URLs](#map-urls) · [The map editor](#the-map-editor) · [How a click becomes coordinates](#how-a-click-becomes-coordinates) · [Position suggestions](#position-suggestions) · [Validation](#validation) · [Limitations](#limitations)

## Two layers: events and routes

Two concepts are kept apart on purpose (`js/chronicle-map.js`):

- **events** — points where something happened (`xp`/`yp` in `data/events.json`);
- **routes** — recorded journeys between places (`data/routes.json`), never derived from events.

Two events in different regions are therefore never connected unless the journey between them was recorded in `routes.json`. Places add a third, optional notion: a place's **own reference position**, used to show the place and to suggest positions — never to move events.

| Module | Role |
|---|---|
| `js/chronicle-map.js` | Pure geometry (no DOM): `routeLayers`, `groupSpots`, `clusterSpots`, `separationScale`, `clampShift`, `validPoint`. Tested in Node. |
| `js/chronicle-model.js` | Normalises coordinates (`ev.hasCoords`, `place.ref`, `place.mapPoint`, `routeById`) and validates them. |
| `index.html` | `MapViewport` (zoom/pan maths and gestures), `_mapEvents`, `_markers`, `_buildPins`, `_buildRoutesSvg`, popups, the map panel. |
| `js/chronicle-editor.js` | The map editor's data side: pointer ↔ percent, nudges, suggestions. |
| `js/chronicle-taller.js` | The map editor's panel and edit layer (loaded on demand). |

## Coordinate system

Positions are **percentages of the map image**, not pixels or latitudes:

- `assets/exandria-map.jpeg` — the full-resolution map, 8100×5400 px (~15 MB);
- `assets/exandria-map-preview.jpeg` — the same picture at 2400×1600, used for the first paint, the mini-maps and offline.

`xp` is the distance from the left edge as a percentage of the width (0–100); `yp` the distance from the top edge as a percentage of the height (0–100). Because both images are the same picture, a position is resolution-free: the same `{ "xp": 42.17, "yp": 37.5 }` lands on the same spot on the preview, the full map, a phone or a 4K screen.

- **Two decimals** are stored: 0.01 % is under one pixel of the full-resolution map.
- **Both or neither**: an event or place with only one of `xp`/`yp` has no position (validator warning; the Taller refuses it).
- The map's aspect ratio is fixed at 5400/8100 (`MAP_AR` in `js/chronicle-editor.js`, `aspectRatio` in `MapViewport`).

```json
{ "id": "s8_06", "locationId": "vasselheim", "xp": 30.4, "yp": 26.7 }
```

## Events on the map

- An event has a pin only when it has valid coordinates (`ev.hasCoords`). Events without them (a dream, a vision, another plane) appear normally in the Chronicle and simply have no pin.
- An event page with a position offers **View on map** and a small expandable map preview; the map is never opened automatically.
- The map shows the events that pass the shared filters (`_mapEvents`, memoised). The party-member filter is shared with the Chronicle; on the map it reads as visibility (every party row lit = no filter; switching a row off hides what is *only* theirs; everyone off shows nothing).

## Places and their positions

A place in `locations.json` may carry its **own position**: `xp`, `yp` and `mapPrecision`:

```json
{ "id": "example-town", "name": "Example Town", "kind": "city", "parentId": "taldorei", "xp": 48.1, "yp": 36.72, "mapPrecision": "exact" }
```

- `mapPrecision`: `"exact"` (placed on the place itself) or `"approximate"` (roughly there; the default when coordinates come without it).
- The model exposes it as `place.ref = { xp, yp, precision }`.
- `place.mapPoint` — where the map shows the place: its `ref` when recorded, else the first chronological event recorded there (or inside) that has coordinates (`place.focusEventId`).
- It is a **reference only**: *View on map*, the place's map preview and position suggestions use it. Setting or moving it never moves an event already placed.
- **Other planes** (a place of `kind: "plane"` and everything inside one) are never on the map: their coordinates are ignored (warning) and they get no map focus.
- Positions are set in the map editor when they are known — never inferred. No place has one yet.

## Markers and groups

1. **One spot per exact coordinate** (`groupSpots`): events at exactly the same `xp`/`yp` share one pin with a count badge; tapping it lists them, in chronological order.
2. **Zoom-dependent groups** (`clusterSpots`): spots closer than a tap target on screen merge, pair by pair (closest first), until no two markers would overlap. The threshold is **42 px on phones** (viewports under 720 px) and **32 px with a mouse**. A group is drawn at the centroid of its spots — display only, no coordinate is changed and every event ends up in exactly one marker.
3. Groups depend on the zoom only, not on panning, and the zoom is quantised to eighths of a doubling (`_markers`), so a pinch does not re-cluster on every frame. They are recomputed for the zoom level and the active filters.

How they look (see [Design system › Map marks](design-system.md#map-marks)): a pin is a leather drop with a gilt edge around the party member's portrait (or the party's shared seal), turning gold when its card is open; a group is a round crimson wax seal with its count — deliberately not a pin, so it never reads as one place. Pins are 38 px and groups 50 px on phones; 32 px and 42 px with a mouse. Captions (*Sesión 8*) are small capitals on a dark label, counter-scaled like the markers so they keep their size while zooming.

- Tapping a group lists every event with its day and session. **Zoom in to separate** (`separationScale`) zooms until the places split — or as far as the map goes when they are too close to ever split on that screen.
- In an event's popup, ‹ › step through the other events of the same pin or group and **See all** returns to the list; *Read entry* opens the event, *Session log* the session.
- Popups always stay on screen: shifted sideways near the edges (`clampShift`), opened on the side with room, kept below the map's top bar, and placed again once their real height is measured.

## Routes

`routeLayers(model, characterIds)` returns what to draw for the selected party members:

- **individual** — each character's own journey, one polyline per unbroken stretch;
- **shared** — a stretch travelled together, drawn once.

Rules (data side in [Data model › `routes.json`](data-model.md#routesjson)):

- A stretch is shared only when two or more **visible** characters carry the same `leg` id on consecutive waypoints — togetherness is never inferred from similar coordinates or shared events. The shared line uses the waypoints of its first visible member (party order); the others' copies are not drawn again.
- `break: true` starts a new stretch: no line between the previous waypoint and this one.
- Invalid waypoints (missing or out-of-range coordinates) are skipped and the route is broken there instead of bridged.
- Only the party-member selection decides which routes are drawn (`selectedCharacterIds(filters.pcs)`): quest, type, text or date filters never add, remove or join route lines.

Styling: each character has their own colour (`color` in `characters.json`) and one of four dash patterns (`8 4`, `2 4`, `11 4 2 4`, `5 3 1 3`, cycled in party order) over an ivory casing; a shared leg is a dotted line of dark sealing-wax red (`#5a1f24`, dash `2 7`). The map panel (*Party & filters*) shows the party rows with the legend, a *Show recorded routes* switch and the count of events on the map. The route SVG is memoised, so panning and zooming do not rebuild it.

## Zoom and pan

`MapViewport` (in `index.html`) holds the viewport maths and gestures:

- At zoom 1 the map is exactly as wide as the viewport; zoom ranges from 1 to **6** (`MIN`/`MAX`). The view is `{ scale, x, y }`: a CSS translate and scale of the world element.
- **Wheel**: ×1.18 per notch around the pointer. **Drag** with the mouse or one finger. **Pinch** with two fingers. Buttons: *Zoom in*, *Zoom out*, *Reset view*.
- `clamp()` keeps the map covering the viewport (no empty bands); on tall phone screens `_coverScale()` raises the minimum zoom so the map fills the height.
- `center(view, point, minScale)` centres a point; `_centerSoon` retries centring until the layout settles unless the visitor has already interacted.
- Touches and wheel events that start inside `[data-nopan]` (popups, the panel) are ignored so lists keep their own scrolling; touches on `[data-nodrag]` (the marker being placed in the editor) are ignored for panning while the wheel still zooms there.
- The map only mounts on the `map` route; `MapViewport` is attached through the `vpRef` callback ref.

**Full-resolution image.** The page first shows the 2400 px preview. The 15 MB map is fetched (with `new Image()`) only once the map is zoomed in far enough that the preview would look soft: `viewport width × scale × devicePixelRatio > 2600`. The service worker never stores it, so offline the map shows the preview.

## Map URLs

| Hash | What it shows |
|---|---|
| `#/map` | The map. |
| `#/map/event/<eventId>` | The map with the event's page beside it (wide screens). |
| `#/map/session/<n>` | The map with a session log beside it. |
| `#/map/place/<placeId>` | The map with a place's page beside it (wide screens). |
| `#/map/at/<eventId>` | Focuses and selects that event's pin without opening the reading pane (phones). |
| `#/map/near/<placeId>` | Centres a place's own position (phones; used when the place's `mapPoint` comes from its `ref`). |
| `#/map/edit` · `#/map/edit/<eventId>` · `#/map/editplace/<placeId>` | The map editor: its list, an event's position, a place's position. |

*View on map* uses `#/map/event/…` / `#/map/place/…` on wide screens and `#/map/at/…` / `#/map/near/…` on phones.

## The map editor

The map editor opens the **real map** — same picture, pins, journeys, zoom and pan — in edit mode. It is part of the Taller del Cronista: its scripts load only when it opens, and nothing it does is published (see [Architecture › The Taller del Cronista](architecture.md#the-taller-del-cronista)). The step-by-step guide for the DM is in [editor-guide.md](editor-guide.md#5-usar-el-editor-cartográfico).

**Opening it:** `#/map/edit`, *Cartografía* in the Taller, or *Place on the map* / *Adjust on the map* on an event or place form.

**Layout:** the panel sits beside the map from 1024 px (the reading pane), as a sheet over it below 1024 px; on phones the sheet turns compact once something is chosen (name, coordinates, *Suggestion*, *Cancel*, *Confirm*), so the map stays free to tap.

**Choosing what to place:** from the panel — *Events* or *Places*, a search, a session filter for events, *All / Not placed / Placed*, each row saying whether it has a position or a move not confirmed — or by tapping a marker on the map (a marker holding several events lists them). Every other event's marker stays on the map as a way to choose; there are no popups. Places on another plane cannot be placed.

**Placing and adjusting:**

| Action | Effect |
|---|---|
| Click / tap on the map | Puts the marker there. A press that moves more than 6 px is a pan, not a placement; clicks on markers and panels are ignored. |
| Drag the marker | Moves it (mouse or finger, with pointer capture: the map does not pan while the marker is held). |
| Arrow keys (marker focused) | One **screen** pixel per press at the current zoom (`pixelStep`, never under 0.01 %); **Shift** = ten. |
| On-screen arrows | One screen pixel per press. |
| X / Y fields | Type a percentage (`42.5` or `42,5`), clamped to 0–100, two decimals. |
| *Put it in the centre of the view* | Places the marker at the centre of what is visible. |
| *Centre the map* | Zooms (to at least 2.4×) and centres on the marker. |
| *Copy coordinates* | Copies `{"xp": 42.30, "yp": 39.51}`, valid JSON ready to paste. |
| *Reset* | Back to where the marker was before this edit. |
| Precision (places) | *Exact* / *Approximate*; a click sets *Exact*, a suggestion keeps its own precision. |

**Preview:** the marker is drawn on the real map where it will be published; its previous position stays as a dashed ring joined to it by a thread, and a suggestion appears as a dotted ring captioned *Suggestion*.

**Confirm or cancel:** nothing changes until **Confirm** (or **Ctrl/⌘+Enter** with the marker focused), which writes `xp`/`yp` — and `mapPrecision` for a place — into the **draft** in this browser, never the published data. **Cancel** or **Esc** discards the move. Opened from a form, either returns to it; otherwise to the editor's list. Each record's pending move is separate, so a mistake on one never moves another; the Taller's status line counts moves not confirmed, and closing the page with one pending asks first.

The forms' *Position on the map* block offers the same actions without the map: *Place on the map* / *Adjust on the map*, *Copy coordinates*, *Back to the published position* (when the draft changed it), *Remove the position* (with confirmation), the precision of a place, and the suggestion with *Use the suggestion* / *Use this position*.

## How a click becomes coordinates

The pointer is converted through the on-screen box of the element the markers are positioned in — `[data-world]`'s `getBoundingClientRect()` — which already includes every CSS translate and scale applied for zoom and pan (`ChronicleEditor.clientToPercent`):

```
xp = (clientX − box.left) / box.width × 100
yp = (clientY − box.top)  / (box.width × 5400/8100) × 100
```

Both are clamped to 0–100 and rounded to two decimals. The height comes from the aspect ratio, not from the image, so it works while the picture is still loading. The result is the same at any zoom, pan, window or container size and device pixel ratio, with mouse or touch. `percentToClient` is the inverse and `viewToPercent` does the same from the viewport's own state; `npm test` checks the three against each other, and the browser suite (`tests/browser/taller.mjs`) clicks known points at several zooms and pans.

## Position suggestions

For an event without a position, the editor and the event form propose one from what is recorded — never invented — and always say where it comes from (`ChronicleEditor.suggestPosition`):

| Order | Source | Precision |
|---|---|---|
| 1 | the place's **own recorded position** (`ref`) | as recorded (exact or approximate) |
| 2 | the point most used by earlier events at that place (reusing it keeps those events on one pin; ties go to the most recent) | approximate |
| 3 | the point most used by events at places inside it | approximate |
| 4 | the position — or the events' most used point — of the nearest place it lies in | approximate |
| — | nothing known, no place chosen, or a place on another plane: the editor says so and the marker is placed by hand | — |

An event never suggests its own position. For a place, its own position is not offered as a suggestion (it *is* the value being edited); the other sources are. A suggestion is applied only with *Use the suggestion* and is then adjusted and confirmed like any other position.

> [!NOTE]
> Suggestions come from recorded data only. Recognising place labels on the map image (OCR, or an AI vision model) could propose positions for places never placed before; it would need an external API and is deliberately not implemented. Any such suggestion would have to be shown as approximate and confirmed by hand, like every other.

## Validation

`node tools/validate-data.js` (and the Taller, for the records a draft touches) checks:

| Check | Validator | Taller |
|---|---|---|
| Event or place coordinates outside 0–100 | error | error |
| Only one of `xp`/`yp` | warning (no position) | error |
| Coordinates on a place on another plane | warning (ignored) | error |
| Unknown `mapPrecision` | warning (counted as approximate) | error |
| Waypoint without numeric `xp`/`yp`, or outside 0–100 | error | — (routes are not edited there) |
| Malformed `leg` / `break` / `session` on a waypoint | error | — |
| A `leg` used by a single character | warning | — |
| Unknown character or `locationId` in `routes.json` | warning | — |

## Limitations

- **One flat map.** Every position is a percentage of this particular image of Exandria. Replacing the map with a different crop or projection would misplace every event, place and waypoint; if the image is ever replaced, it must keep the same geometry, and the preview must be regenerated at the same aspect ratio.
- **Other planes are not on the map.** Events there may have no position at all.
- **Routes are recorded by hand** in `routes.json`; the Taller does not edit them, and nothing draws a journey that was not recorded.
- **Groups are visual.** A group's position is the centroid of its spots; very close places may only separate at maximum zoom, or never on a small screen (the list stays the way in).
- **No geographic measures.** There are no distances, scales or coordinates in world units.
- **Offline**, the map shows the 2400 px preview: the full-resolution image needs a connection.
- Places' own positions are optional and none is recorded yet; until they are, the map focus of a place comes from its first located event.
