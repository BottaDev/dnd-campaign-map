<!-- Project presentation. Keep in sync with README.md (Spanish, the main README). Technical details live in docs/. -->

<div align="center">

[Español](README.md) · **English**

# Crónica de Exandria

**A narrative atlas to preserve, explore and relive the adventures of a Dungeons & Dragons campaign.**

[**Open the chronicle →**](https://bottadev.github.io/dnd-campaign-map/) · [Taller guide (ES)](docs/editor-guide.md) · [Documentation](#documentation)

![GitHub Pages: live](https://img.shields.io/badge/GitHub%20Pages-live-cfa650?logo=github&labelColor=1b1513)
![PWA: works offline](https://img.shields.io/badge/PWA-works%20offline-cfa650?labelColor=1b1513)
![Languages: Spanish and English](https://img.shields.io/badge/languages-Spanish%20%C2%B7%20English-cfa650?labelColor=1b1513)
![Architecture: static, no backend](https://img.shields.io/badge/architecture-static%2C%20no%20backend-cfa650?labelColor=1b1513)

HTML, CSS and JavaScript with no build step · React 18 (through dc-runtime) · Driver.js · Service Worker · IndexedDB · JSON data

</div>

![The Chronicle on desktop with the Grimorio design: the timeline on the left and the event “La forja de Tyr” open on the right, with the characters who took part](docs/images/chronicle-desktop.webp)

*The screenshots show the default Spanish interface; **ES / EN** in the top bar switches the interface and the campaign content to English (*Exandria Chronicle*).*

## What is Crónica de Exandria?

It is the archive of the adventures of *Bund Der Vier*, a group playing a Dungeons & Dragons campaign set in Exandria, the world of Critical Role. It gathers in one place what usually ends up scattered across notes, chats and memory: what happened in each session, which quests are still open, who is who and where everything took place.

It is made for two kinds of people:

- **Players**, to catch up before a session, recall a name or read a scene again.
- **Whoever keeps the chronicle** — usually the DM — to record each session through forms and place it on the map, without touching code.

Every event is linked to its session, its characters, its quests and its place, and places sit on the map of Exandria: story and geography are explored together. From a scene you jump to the map; from a marker, to the scene; from a character, to everything they lived through.

## Key features

<table>
<tr>
<td width="50%" valign="top">
<strong>Chronicle and Sessions</strong><br>
A timeline of every event, by campaign day or by session, with combinable filters. Each session has its log and a “Previously on…” to catch up.
</td>
<td width="50%" valign="top">
<strong>Quests and Characters</strong><br>
Quests by status, with their story session by session. The party, NPCs, deities and factions, with their relationships and appearances.
</td>
</tr>
<tr>
<td valign="top">
<strong>Interactive atlas</strong><br>
The map of Exandria with zoom: markers per event, groups that split as you zoom in, and each character's recorded journeys. A hierarchical index of places completes the geography.
</td>
<td valign="top">
<strong>Search and navigation</strong><br>
A universal search (<kbd>Ctrl</kbd>+<kbd>K</kbd>) in Spanish and English, accent-insensitive; each section's own search, shareable links and favourites.
</td>
</tr>
<tr>
<td valign="top">
<strong>Taller del Cronista</strong><br>
A visual editor for whoever keeps the chronicle: sessions, events, quests, characters and places as forms, with a preview and validation.
</td>
<td valign="top">
<strong>Map editor</strong><br>
Place and adjust markers on the real map with a click, by dragging or with the keyboard. Coordinates are computed for you, and positions are suggested from what is recorded.
</td>
</tr>
<tr>
<td valign="top">
<strong>PWA and offline use</strong><br>
After one visit online, the chronicle can be read offline and installed as an app. The full-resolution map still needs a connection.
</td>
<td valign="top">
<strong>Bilingual, guided, Grimorio</strong><br>
Interface and content in Spanish and English, guided tours on the real interface, and a single dark theme designed as a bound archive.
</td>
</tr>
</table>

The full reference of every section is in [docs/features.md](docs/features.md).

## Gallery

<table>
<tr>
<td width="50%" valign="top"><img src="docs/images/interactive-map.webp" width="100%" alt="Interactive map of Exandria with session markers, numbered groups as wax seals and the dotted route of the airship journey, with an event's card open"><br><sub><b>Interactive atlas</b> · markers, groups and the session 8 journey</sub></td>
<td width="50%" valign="top"><img src="docs/images/chronicle-workshop.webp" width="100%" alt="Taller del Cronista: an event's form on the left and its preview on the right"><br><sub><b>Taller del Cronista</b> · form and preview</sub></td>
</tr>
<tr>
<td valign="top"><img src="docs/images/map-editor.webp" width="100%" alt="Map editor with a marker moved and not yet confirmed, its coordinates, nudge arrows and the Cancel and Confirm buttons"><br><sub><b>Map editor</b> · a marker waiting for confirmation</sub></td>
<td valign="top"><img src="docs/images/mobile-view.webp" width="100%" alt="Three phone screens: the Chronicle, an event with its illuminated initial and the map"><br><sub><b>On a phone</b> · Chronicle, event and map</sub></td>
</tr>
</table>

## Taller del Cronista

The *Taller del Cronista* (the chronicler's workshop) is the desk where the chronicle is prepared before it is published. It opens from the help (**?** → last line) or at [`#/taller`](https://bottadev.github.io/dnd-campaign-map/#/taller), with nothing to install and no account.

- **Sessions and events** through forms: dates, places, characters, quests, open and closed threads, effects and “Previously on…”.
- **Quests, characters and places**: create and edit them, choosing everything from lists (ids are never typed).
- **A preview** of each page as it will be published, writing in Spanish or English.
- **The map editor** to place events and places on the map.
- **Local drafts**, saved automatically in the browser, with backups and a downloadable copy.
- **Validation and export**: the same rules as the repository's validator, conflicts detected field by field and a `.zip` package ready to incorporate.

> [!IMPORTANT]
> The Taller runs without a backend of its own: everything happens in your browser. **Exporting is not publishing.** The package is incorporated into the repository (with `tools/apply-draft.js` or on GitHub), and only then does GitHub Pages publish the new version. There is no automatic sync between devices and no direct publishing.

**From draft to published chronicle:** edit in the Taller → saved as a draft in the browser → validate → export the `.zip` → the repository maintainer incorporates it → GitHub Pages publishes.

### Map editor

- Opens the real map in edit mode: choose an event or a place and put it down with a click or a tap.
- Fine-tune by dragging, with the arrow keys (one screen pixel; <kbd>Shift</kbd>, ten) or by typing the coordinates. Nothing changes until **Confirm**, and confirming only saves to the draft.
- Positions are percentages of the map image, the same at any zoom or screen size; suggestions come only from recorded data.

Step-by-step guide for the DM (in Spanish, the language the DM uses — the Taller's interface itself is bilingual): **[docs/editor-guide.md](docs/editor-guide.md)** · Technical details: [docs/map-system.md](docs/map-system.md)

## Quick start

Requires Node.js (the project uses version 22) and an internet connection: React and the fonts load from CDNs.

```bash
git clone https://github.com/BottaDev/dnd-campaign-map.git
cd dnd-campaign-map
npm start            # http://localhost:5500 (npx serve)
```

There is no build step: edit a file and reload the page. The app must be served over HTTP; opening it through `file://` does not load the data.

```bash
npm test             # validator + unit tests
npm run validate     # only the data validator
npm install          # once, for the browser tests
npm run test:browser # real Edge (Windows: PowerShell or cmd)
```

Every command, incorporating a package from the Taller and troubleshooting: [docs/development.md](docs/development.md).

## Architecture

- **Static app:** `index.html` and scripts, no server code and no build; the interface is a React component served by dc-runtime (`support.js`).
- **JSON data:** `data/*.json` (English, the source) and `data/i18n/es-AR.json` (the translation), read in the browser by `js/chronicle-model.js`, which builds a model with every link.
- **GitHub Pages:** publishes the `main` branch as it is; routes use `#/…` and need no configuration.
- **No backend:** preferences, favourites and history stay in the browser; a service worker keeps a copy for offline reading.
- **Local drafts:** the Taller saves to IndexedDB and is only downloaded when opened.
- **Controlled export:** `tools/apply-draft.js` applies the package over the current data, detects conflicts and refuses drafts with errors.

More in [docs/architecture.md](docs/architecture.md).

## Documentation

| Document | Contents |
|---|---|
| [Taller del Cronista guide](docs/editor-guide.md) | For the DM, in Spanish: create sessions and events, link them, use the map editor, save, recover, validate, export and hand over. |
| [Features](docs/features.md) | Every section and tool: searches, keyboard shortcuts, filters, languages, links and offline use. |
| [Architecture](docs/architecture.md) | Structure, modules, routes, state, local persistence, service worker, the Taller's internals and static publishing. |
| [Data model](docs/data-model.md) | The JSON files, ids, links, translations and validation rules. |
| [Map system](docs/map-system.md) | Coordinates, markers, routes, zoom, the map editor and position suggestions. |
| [Grimorio design system](docs/design-system.md) | Concept, tokens, palette, typography, surfaces, states, icons and accessibility. |
| [Development](docs/development.md) | Requirements, commands, tests, validation, incorporating drafts, deployment and troubleshooting. |
| [CLAUDE.md](CLAUDE.md) | Working notes for Claude Code. |

## Project status

**In use and maintained alongside the campaign.** As of October 2026 it records 6 sessions (1, 2, 8, 10, 11 and 12), 33 events, 17 quests, 42 characters and 28 places; events, sessions, quests and lore summaries are translated into Spanish.

**Still to be written** — nothing is filled in by inference: sessions 3 to 7 and 9; the longer account of important events; editorial “Previously on…” summaries; places' own map positions. `node tools/validate-data.js` reports the current state.

**Limitations:**

- Taller drafts are local to each browser and device: there is no sync.
- There is no direct publishing from the Taller: it would need a backend or GitHub credentials stored in the browser.
- The map's journeys and the Lore of Exandria are edited by hand in the repository.
- The first visit needs a connection, and so does the full-resolution map.

**Scope:** this is the archive of one specific campaign, not a generic campaign manager or a virtual tabletop (no accounts, dice or character sheets). Its branding texts live in the interface dictionaries, so it can be adapted to another campaign.

## Credits and licences

- *Dungeons & Dragons* is a trademark of Wizards of the Coast. *Critical Role* and the world of *Exandria* belong to their respective owners. This is a fan project, with no affiliation or official endorsement.
- The map of Exandria (`assets/exandria-map*.jpeg`) and the portraits in `assets/` have no licence declared in this repository; their rights belong to their authors.
- The Lore of Exandria summaries are original texts linking to the [Critical Role Wiki](https://criticalrole.fandom.com/wiki/Critical_Role_Wiki), a community wiki whose text is published under CC BY-SA; no text or images are copied from it.
- [Driver.js](https://driverjs.com/) 1.8.0, © Kamran Ahmed, MIT licence, included unchanged in `vendor/driver.js/` with its licence. React 18 (MIT) loads from unpkg.
- Fonts Cormorant Garamond, Cormorant SC, Crimson Pro and Source Sans 3, served by Google Fonts under the SIL Open Font License.
- **Project licence:** the repository includes no licence file, so no explicit permission is granted to reuse its code or content.
