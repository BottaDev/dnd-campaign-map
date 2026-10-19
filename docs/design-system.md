# Design system — Grimorio

The visual language of Crónica de Exandria: one dark theme, the *Grimorio*, designed as a bound archive. This guide is for keeping new screens consistent with the existing ones; the source of truth is the stylesheet in `index.html` (inside `<helmet>`), and `tests/design.test.js` guards the rules marked ✓ below.

← [Back to the README](../README.md) · Related: [Architecture](architecture.md) · [Map system](map-system.md)

**Contents:** [Concept](#concept) · [Tokens](#tokens) · [Colour](#colour) · [Typography](#typography) · [Surfaces and textures](#surfaces-and-textures) · [Layout and responsive behaviour](#layout-and-responsive-behaviour) · [Navigation](#navigation) · [Cards, rows and chips](#cards-rows-and-chips) · [Interactive states](#interactive-states) · [Icons](#icons) · [Kinds of event](#kinds-of-event) · [Map marks](#map-marks) · [Accessibility](#accessibility)

![The Chronicle as an open book: the list on the left page, an event on the right one](images/chronicle-desktop.webp)

## Concept

- **One dark theme**, no light mode and no toggle ✓. Warm-black pages with a thin gilt fillet lie on a darker desk.
- **Leather only on the covers**: the top bar, the phones' bottom bar and the controls floating over the map ✓.
- **Gold marks what you can press**: actions, the current tab, page fillets, the illuminated initial.
- **A crimson reading ribbon marks state**, never decoration: what is open (the entry beside the list, the current section on phones, the selected map popup) or saved (favourites) ✓ — always next to a label or an icon.
- **Map markers are seals**: leather pins, crimson wax for groups.
- The page is painted dark before any script runs (`color-scheme: dark`, `theme-color`, an inline style in `<head>`); an old `chronicle-theme` preference from earlier versions is ignored and deleted ✓.

## Tokens

All colours, surfaces and fonts are CSS custom properties on `.cc-app,.cc-tour` (the tours' popover shares them). **Use the tokens, never a raw colour in a component.**

| Group | Tokens | Use |
|---|---|---|
| Text | `--title` / `--h1` / `--text` `#f1e9da`, `--body2` `#d9cfbe`, `--body` `#c4b9a6`, `--muted` `#9d9281`, `--link` `#e6cc92` | strongest → quietest |
| Interaction | `--accent` = `--gilt` `#cfa650`, `--gilt-dim` `#6e5a33`, `--gilt-hair`, `--on-accent` `#16110a`, `--btn-*` | what you can press; one solid-gold primary per view |
| Raised / current | `--elev` `#2d2823` | the open card, the current option |
| Lines | `--line` `#34302a`, `--control-border` `#4a3f33`, `--hair` | hairlines, control borders, page fillets |
| Surfaces | `--app-bg` (the desk), `--page` `#1d1a17`, `--page-r` `#1f1c19`, `--page-bg`, `--panel-bg`, `--popup-bg`, `--bar-bg`, `--float-bg`, `--card-bg` `#25211d`, `--input-bg` `#141210` | see [Surfaces](#surfaces-and-textures) |
| Ribbon | `--ribbon` `#b8404c`, `--ribbon-text` `#e5848c` | state only; `--ribbon-text` when it must be text |
| Map | `--pin-bg` `#1b1513`, `--wax` (crimson gradient), `--wax-ink` `#f7eedc`, `--map-filter` | seals and the map picture |
| Event families | `--ev-<family>`, applied by `.ev-<family>` (sets `--ev`) | [Kinds of event](#kinds-of-event) |
| Quest status | `--st-active`, `--st-pending`, `--st-done`, `--st-failed`, applied by `.tone-<tone>` (sets `--tone`) | status badges and plot rules |
| Lore | `--lore` `#97b4c6` | the Lore of Exandria section |
| Shape | `--r-sm` 4 px, `--r-page` 6 px | corners |
| Fonts | `--font-display`, `--font-head`, `--font-read`, `--font-ui` | [Typography](#typography) |

## Colour

**Contrast.** Every text colour is at least 4.5:1 on `#2d2823`, the lightest surface — WCAG ratios there: `--title` 12.1, `--body2` 9.5, `--body` 7.5, `--muted` 4.8, `--accent`/`--gilt` 6.4, `--link` 9.3, `--ribbon-text` 5.6; higher on cards and pages. `--ribbon` (3.2:1 on a page) is a non-text indicator and never carries text; when the ribbon's colour must be text it is `--ribbon-text`, e.g. "la última" next to the latest session's day.

**Quest status** uses its own tokens, always with an icon and the status text ✓:

| Status | Token | Colour | Icon |
|---|---|---|---|
| In progress | `--st-active` | `#e2b85f` gold | half-filled circle |
| Pending | `--st-pending` | `#e09a5b` amber | hourglass |
| Completed | `--st-done` | `#9dbe8a` green | check |
| Failed | `--st-failed` | `#e3837a` red | cross |

Open session-log threads are ruled in the active colour, closed ones in the done colour. **Lore of Exandria** — background from Critical Role's world — is set apart from the campaign by the cool slate `--lore` on its heading, icon and source links.

## Typography

| Token | Family | Role |
|---|---|---|
| `--font-display` | *Cormorant Garamond* 700 | Titles only: the brand, section titles (56 px, a chapter opening with a small-capitals kicker, an italic subtitle and a gilt ornament), entry titles (40 px), day headers, popup and help titles, the illuminated initial. Never in paragraphs or under 21 px (except single letters in a seal). |
| `--font-head` | *Cormorant SC* 700 | Labels in small capitals: kickers, block headings (with a gilt ✦ and a rule), day subtitles, map captions. |
| `--font-read` | *Crimson Pro* 400–600 | Everything you read: titles of cards and rows, summaries, prose. |
| `--font-ui` | *Source Sans 3* | The interface: tabs, buttons, navigation, metadata, inputs. |

Fallbacks are Georgia/serif and the system UI face, so the page stays usable without the web fonts; only the weights in use are loaded from Google Fonts (variable ranges where the family has one). Reading and interface text is never below 12.5 px; only small-capital labels go smaller (the brand's kicker 9–10 px, day subtitles 11–12 px, map captions 11 px).

**The illuminated initial.** An event's summary opens with a gilt-framed capital, drawn by CSS (`.cc-lead.drop::before`, `content: attr(data-initial) / ""`) with empty alternative text; the paragraph's own first letter is only made invisible, so the text stays whole for screen readers, search and copying ✓. The box appears only when the text starts with a letter; browsers without alternative text for generated content get a plain gilt drop cap.

## Surfaces and textures

Texture on large, still surfaces only; flat colour on everything you touch (buttons, inputs, chips, cards, rows) ✓.

| Token | What it lays | Where |
|---|---|---|
| `--page-bg`, `--panel-bg`, `--popup-bg` | `assets/textures/paper.webp` under a 50 % veil (`--page-veil`) | pages, the reading page, popups and dialogs |
| `--bar-bg`, `--float-bg` | `assets/textures/leather.webp` over `#1b1513` | the top and bottom bars, the controls over the map |

Both textures are original tiles of light and dark specks (at most ~13 % opaque) that work over any colour, small precached WebP files ✓ (rebuilt with `tools/make-textures.mjs`, see [Development](development.md#regenerating-assets)). When the browser asks to save data (`prefers-reduced-data`) and on screens under 360 px, `--paper` and `--leather` become `none` and the same colours show flat. The page fillets are background layers (`--hair`), so they stay put while a page scrolls; sticky bars stop inside them.

## Layout and responsive behaviour

| Width | Layout |
|---|---|
| < 720 px (phones) | The list — or the open entry, full screen with a **Back** button — is one full-bleed page. The top tabs become a bottom bar. |
| ≥ 720 px | The list is a single page centred on the desk (`.cc-page`, 840 px wide at most, 6 px corners, the fillet on all four sides); an open entry below 1024 px is a page of its own (`.cc-doc`). |
| ≥ 1024 px with an entry open | **The open book** (`.cc-body.has-detail:not(.is-map)`): the list on the left page (`.cc-main`), the entry on the right one (`.cc-detail`, a shade lighter), the gutter drawn by inner shadows, each fillet open on the gutter side. |
| Map | A plate in a dark mount (gilt lines, a diamond at each corner; a 4 px mount on phones) drawn *around* the viewport, so the frame never covers a marker. `.is-map` keeps the plate full size beside an open entry. |
| < 360 px | Textures off; the atlas index hides its event counts (they stay on the place's page) and the quest badge moves under the title. |

Nothing scrolls sideways at 320, 360, 390, 430, 768 or 1280 px (checked by `tests/browser/smoke.mjs`).

## Navigation

- **Desktop and tablet:** the six sections are tabs in the top bar (Chronicle, Sessions, Quests, Characters, Places, Map); the current tab is underlined with a double gilt fillet. The search (magnifier), **ES / EN**, the favourites star and **?** sit on the right.
- **Phones (< 720 px):** a bottom bar with **Chronicle**, **Sessions**, **Quests** and **More**; *More* opens a sheet with Characters, Places, Map, Saved, Help and the glossary. The current section carries the ribbon; when it is one of *More*'s, it takes the fourth slot.
- Each tab's tooltip says in one line what the section holds.

## Cards, rows and chips

- **Event cards** read in three levels: ① kind — icon + type (+ the day or session only when the group header does not already say it); ② title and a two-line summary; ③ a quiet chevron. People, places and quests of an event are on its page, not on the card. Colour only tints the icon and the card's left edge; cards stay neutral so the title stays the strongest thing on them.
- **Quest cards** carry their status badge (icon + label, as on the group heading) on the right of the title — under the title on phones narrower than 360 px — so the status never rests on the edge colour alone ✓; the open quest's ribbon hangs over the chevron, clear of the badge.
- **People chips** stack the name over a quieter line: what the person did there when the page says so (*gave the quest*), else their role (for a party member, class and subclass), else what they are (*Deity*, *Creature*…, `personCategoryOne` in the locales). A role too long for the chip ends in an ellipsis; a long name wraps instead. Pills are reserved for people.
- **The atlas index** (Places) is rows, not cards: the fold caret, the kind's icon, the name — heavier at the top of a branch, quieter for the deepest places —, the kind in quiet text (*· 3 lugares* while a branch is folded) and, like an index's page references, dotted leaders to the number of events recorded there or inside. Hairline guides in a faint gilt (`--gilt-hair`) run from each open caret down to its places' elbows; the way down to the open place is drawn in `--gilt-dim`. The open place is raised, gilt-edged, and hangs the ribbon over its map action. On phones the kind goes under the name, the indent narrows and the leaders go.

## Interactive states

| State | Treatment |
|---|---|
| Rest | `--card-bg` with a hairline border; 4 px corners on buttons, cards, inputs, popups and panels (`--r-sm`). |
| Hover | Lifted: `--card-bg-hover`, a dim gilt border, a deeper shadow, a gold chevron. |
| Open / selected | Raised (`--elev`), gilt-edged, with the ribbon. |
| Current option | The current option of a segmented control is raised (`--elev`), not solid gold — solid gold is reserved for the one primary button of a view. |
| Focus | A 2 px gold outline (`--accent`); ivory over the map (markers, and 3 px on the marker being placed). |
| Completed quest | Steps back to a darker plate with quieter text. |

## Icons

Four inline-SVG sets in `index.html`, 24 px stroke paths in one style, `aria-hidden`, always next to a text label:

| Set | Covers |
|---|---|
| `ICON_SHAPES` | the interface (navigation, actions) |
| `EVENT_ICON_SHAPES` | one per event type ✓ |
| `STATUS_ICON_SHAPES` | one per quest tone ✓ |
| `PLACE_ICON_SHAPES` | one per kind of place + `place` for none/unknown, through `placeIcon()` ✓ |

**Kinds of place** (gilt; other planes in the arcane violet `--ev-arcane`): continent → a globe and its lands · region → mountains · sea → waves · city → castle walls and gate · district → houses side by side · site → one building · plane → a spiral · no or unknown kind → a map marker. The icon sits beside the name or the kind's label everywhere (index rows, place chips, search results and favourites, the place's page and its breadcrumb).

**A new kind of place** needs an entry in `PLACE_KINDS` (`js/chronicle-model.js`), an icon in `PLACE_ICON_SHAPES` and its label in both `locales/*.js` under `placeKind` — `npm test` fails if a kind has no icon or two kinds share a drawing.

## Kinds of event

Every event type has one icon, one label and a colour *family*. The colour says which kind of moment it is, the icon says exactly which type, and the label is always written beside it — colour is never the only cue.

| Family (token) | Colour | Types → icon |
|---|---|---|
| `conflict` (`--ev-conflict`) | `#cc8273` terracotta | combat → crossed swords |
| `social` (`--ev-social`) | `#82a6cd` blue | encounter → a figure and "!" · conversation → speech bubbles |
| `arcane` (`--ev-arcane`) | `#a993d4` violet | revelation → sparkles · planar (other plane) → a doorway holding a star |
| `vision` (`--ev-vision`) | `#c3b3e0` soft violet | vision (divine vision) → radiant eye · dream → moon and star |
| `discovery` (`--ev-discovery`) | `#6fb3a4` teal | discovery → compass |
| `journey` (`--ev-journey`) | `#98b072` sage | travel (journey) → signpost · downtime (rest & rites) → campfire |
| `turning` (`--ev-turning`) | `#d2ae64` amber | decision → scales · quest (quest milestone) → the quest flag |
| `neutral` (`--ev-neutral`) | `#a68d6b` parchment grey | other / unknown type → plain lozenge |

The family lives in `EVENT_TYPES` (`js/chronicle-model.js`, exposed as `ev.typeFamily`); the icons in `EVENT_ICON_SHAPES`. **A new event type** needs an entry in `EVENT_TYPES` with its `family` (reuse a family — add a new colour only for a genuinely new kind of moment), an icon, and its label in both `locales/*.js` under `eventType`. `npm test` fails if a type has no icon, a family has no token, or two types share a drawing.

The same vocabulary is explained inside the app — Help → **Icons & colours** — built from these very tables, so a new type or status appears there by itself.

## Map marks

- **Pins** are leather drops (`--pin-bg`) with a gilt edge around the party member's portrait — or the party's shared seal (`assets/icon-bund-der-vier.png`) for events of several members — turning gold when their card is open. **Groups** are round crimson wax seals (`--wax`, `--wax-ink`) with their count. Sizes: 38/50 px on phones, 32/42 px with a mouse.
- **Captions** (*Sesión 8*) are small capitals on a dark label, counter-scaled like the markers.
- **Routes** keep each character's colour and dash pattern over an ivory casing; journeys travelled together are a dotted line of dark sealing wax. The map picture is slightly toned by `--map-filter`.
- In the map editor, the marker being placed is a crimson pin with a gilt ring; its previous position a dashed ring joined by a thread; a suggestion a dotted ring captioned *Suggestion*.

Details of the geometry in [Map system](map-system.md#markers-and-groups).

## Accessibility

- **Colour is never the only cue**: every event type, status and kind of place has an icon and a written label; the ribbon always sits next to a label or an icon.
- **Contrast** of every text token ≥ 4.5:1 (see [Colour](#colour)).
- **Focus**: visible on every control; dialogs (search, help, the Taller's confirmations) keep the keyboard focus inside and give it back when they close; opening an entry from an overlay focuses its heading.
- **Screen readers**: icons are `aria-hidden` next to text; counts of section searches are announced once typing pauses; the illuminated initial keeps the paragraph whole; the Places tree uses disclosure buttons (`aria-expanded`, `aria-controls`) and links with `aria-current`, not ARIA tree roles without a tree's keyboard model.
- **Motion**: `prefers-reduced-motion` turns animations and transitions off.
- **Touch**: comfortable tap targets on phones (search rows are 44 px tall; the browser suite checks targets at 320–430 px).
- **Language**: `<html lang>` follows the chosen language; the Taller's text fields carry the `lang` of the language being written, and the other language's text shown under each field carries its own.
