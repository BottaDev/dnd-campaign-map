# Feature reference

Everything the public chronicle does, section by section: what each screen shows, the tools available everywhere, searches, keyboard shortcuts, filters, languages, links and the offline copy. For the DM's editor see the [Taller guide (Spanish)](editor-guide.md); for how it is built, [Architecture](architecture.md).

← [Back to the README](../README.md)

**Contents:** [Sections](#sections) · [Tools available everywhere](#tools-available-everywhere) · [The Chronicle's home](#the-chronicles-home) · [Reading an entry](#reading-an-entry) · [Section searches](#section-searches) · [Keyboard](#keyboard) · [The party-member filter](#the-party-member-filter) · [Guided tours and help](#guided-tours-and-help) · [Languages](#languages) · [Shareable links](#shareable-links) · [Offline and installing](#offline-and-installing)

## Sections

The app has six sections. On desktop and tablet they are tabs in the top bar; on a phone, **Chronicle**, **Sessions** and **Quests** sit in the bottom bar and **Characters**, **Places** and **Map** are under **More**.

| Section | What it shows |
|---|---|
| **Chronicle** (home) | Every event as a narrative timeline grouped by campaign day (or by session), **latest first** by default (one tap switches to oldest first; inside a day the events keep their recorded order). Each card shows the event's type as an icon, colour and label. Free-text search (in both languages, ignoring accents and case) plus filters for party member, NPC/deity/faction, quest, session, event type, place, in-world period (campaign days) and real-world play date — all combinable. Typing a search also lists matching people, quests, places and sessions. |
| **Sessions** | The sessions played, **oldest first** by default (or latest first), in numeric order with gaps for sessions that were never written up. A search above the order finds a session by its **number** (`12`, `s12`, `Sesión 12`, `Session 12` — that session only, never stray digits), its **title**, what its log and its events recorded (opening and closing lines, events, plots and their notes, effects, in-world dates) and who and where it involved (people, places — a place counts with the places it lies in —, quests). Each session page has the real date it was played, the in-world days it covered, where it started and ended, its events, the quests in play, the people and places involved, active effects and unresolved threads. |
| **Quests** | Every quest by status. A search above the status filter finds quests by name, summary, objectives, giver, the session notes of their thread, the events that moved them and the people and places linked to them; it combines with the status (*In progress* + `Cassandra` = the quests in progress that mention Cassandra), neither clears the other, the count reads *4 of 17 quests*, matches hidden by the status are one tap away (*See 2 in other statuses*), and *no results* names both criteria. A quest page shows where it stands now and *the story so far*: session by session, the events that advanced it and the session-log snapshot of the thread. |
| **Characters** | The party and every NPC, deity, creature and faction recorded in the session logs, with a search above them (name, alias, kind or role, either language): a count (*3 of 42 characters*), the names marked and, when the name does not hold the words, the row's quiet line saying why (*Alias · …*, or the kind or role it already shows, marked). A character's page lists their relationships (both directions), factions/members, appearances, quests, places, and everything the session logs noted about them. |
| **Places** | An atlas index: the places as a tree of what lies inside what (continent › city › district › site), the *Atlas of Exandria* apart from the *other planes*. Each row has the kind's icon, the name, the kind, how many events were recorded there or inside, and the map one tap away. Branches fold and unfold with their caret — the main places and their first level start open, *Expand all* / *Collapse all* sit above the tree, and opening a place unfolds the branches above it — and a filter finds a place by name, alias or kind (either language, no accents needed) while keeping where it lies in view. A place's page starts with its location (each step a link one level up), a small map preview, then what happened there and what lies inside. |
| **Map** | The full interactive map — pan, zoom (wheel, buttons, pinch), event pins captioned by session, nearby pins gathered into numbered seals that split as you zoom in, each character's recorded journeys as dashed lines, party toggles. Tapping a pin shows the event (**Read entry** opens it, **Session log** opens that session); tapping a group lists its events. Details in [Map system](map-system.md). |

Two more screens are never tabs: **Saved** (favourites and history, `#/saved`) and the **Taller del Cronista** (`#/taller`).

## Tools available everywhere

They never add a tab or a permanent bar.

| Tool | Where | What it does |
|---|---|---|
| **Search** (magnifier) | top bar on every screen (also on phones); `Ctrl+K` / `⌘K` | One search over **everything**: characters, NPCs, deities, factions, events, quests, places and sessions, grouped by kind with an icon, the name and one context line. Direct name matches come first (one relevance scale for every kind); a person also finds the events, quests and sessions linked to them. Works in Spanish and English whichever the interface is in, ignores case and accents (`revelacion` finds *Revelación*), understands `12` / `s12` / `sesión 12`. `↑ ↓ Enter Esc` on a keyboard; on a phone it opens as its own screen with the field at the top (results stay above the keyboard). Nothing typed yet → your recently viewed entries. Many events → *See all N in the Chronicle* applies the same text as a Chronicle filter. |
| **Previously on Bund Der Vier…** | one line under the Chronicle and Sessions headings | A recap of the **latest session** (the highest session number with a log): where the party was left, the recorded events (or the editor's highlights), decisions, threads still open, quests in play, effects at the session's end, and links to the full log and to its events in the Chronicle. Built only from the data ([`recap`](data-model.md#recap--previously-on-optional)). |
| **Saved** (star) | top bar on desktop; **More → Saved** on phones | Favourites (tap ☆ in any entry's top bar) and the last five entries you opened. Kept in this browser only (`localStorage`): no account, no sync. |
| **Guided tours** | the first-visit welcome on the Chronicle; **Help**; the map's **How does it work?** | Interactive walk-throughs on the real page (see [below](#guided-tours-and-help)). |
| **Help** (`?`) | top bar; **More → Help** on phones; *How does it work?* next to the Chronicle's quick actions | *How the Chronicle works*: the three tours (with a *Done* mark), what each section holds, six short answers to frequent questions. |
| **Icons & colours** | second tab of the help; **More → Icons & colours** | The glossary: every event type with its icon and colour family, the quest statuses, the map's pins, seals and route lines. |
| **Taller del Cronista** | the last line of the help (**?**); its address `#/taller` — never a tab | For whoever keeps the chronicle: sessions, events, quests, characters and places as forms, and the map editor — kept as a local draft and exported for the repository. Visitors never download it. See the [Taller guide](editor-guide.md). |

## The Chronicle's home

- Two quick actions — **Catch up** (the latest session's *Previously on…*) and **Find something** (the search) — and a quiet *How does it work?* link to the help.
- On a first visit, once the chronicle has loaded, a **welcome** card appears by itself on the Chronicle's home — floating in a corner (above the bottom bar on phones), not a modal: the page stays usable — saying what the Chronicle is and offering the guided tour (*Start the tour* / *Not now*). A link straight to an entry or another section is never interrupted: the welcome waits until the visitor reaches the Chronicle's home, and once answered (or the tour finished or left) it does not come back by itself.
- Small hints appear only where a control is not obvious: how the Chronicle's filters combine, where *Previously on…* comes from, and that the canon lore is outside information — naming the wiki it comes from — that may contain spoilers.
- The Chronicle and Sessions orders are remembered separately, but only once you change them — until then each opens on its default.

## Reading an entry

- Opening anything (an event, session, quest, person or place) shows its full page: beside the list on wide screens (the "open book"), full screen with a **Back** button on phones.
- Everything links to everything else, and **Back** (the app button, the browser button or Android's back gesture) returns to where you were, with filters and scroll position kept.
- An event with a location offers **View on map** and a small expandable map preview; the map is never opened automatically.
- An important event can carry a longer account, *What changed* and *Still unresolved* ([narrative depth](data-model.md#narrative-depth-description-consequences-unresolved)).
- Characters and places that also exist in published canon — Critical Role's Exandria, or another Dungeons & Dragons setting the campaign brings in, like Strahd's — end with a folded **Canon lore** section: a short, spoiler-free summary and a link to the source article on the Critical Role Wiki or the Forgotten Realms Wiki ([`lore.json`](data-model.md#lorejson--canon-lore)); our own story always comes first. It starts folded on every page.

## Section searches

Each section's own search (Sessions, Quests, Characters, Places) behaves the same:

- results as you type, in either language, without accents or capitals;
- the words marked, and — when they were not in the title or name — a short line saying where they were found;
- a count (*3 of 6 sessions*), announced to screen readers once typing pauses;
- ✕ or `Esc` clears it and keeps you in the field;
- what you typed stays while you open an entry and come back, visit another section or switch language — until the next visit, so an old search never leaves a section looking empty.

## Keyboard

| Keys | Where | Action |
|---|---|---|
| `Ctrl+K` / `⌘K` | anywhere | Open (or close) the search. |
| `/` | Chronicle | Jump to the Chronicle's filter box. |
| `↑` `↓` `Enter` | search | Move through results and open one. |
| `Esc` | search, help, an open page | Close it. |
| `Esc` | first-visit welcome | *Not now*. |
| `→` / `←` | during a tour | Next / previous step (unless you are typing). |
| `Tab` | during a tour, in dialogs | Stays inside the tour or dialog. |
| `Esc` | during a tour | Leave it (restores where it started). |
| `Enter` / `Space` | Places carets | Fold or unfold a branch (never opens the place). |

Dialogs keep the keyboard focus inside and give it back when they close; Back (including Android's gesture) closes an open search or help — or ends a running tour where it started — instead of leaving the page. Keys of the map editor are in [Map system › The map editor](map-system.md#the-map-editor).

## The party-member filter

One filter, shared by the Chronicle and the Map:

- **No one selected** (the default) = every event, including events with no party member at all.
- **Some selected** = events where **any** selected member took part (OR). An event of Ayante and Sorfon shows when either is selected, once when both are, and the order inside `characterIds` never matters.
- Events without party members are hidden while a selection is active; when the campaign has any, a discreet **No party member** chip (Chronicle) / row (Map) includes them on purpose. They are never assigned to a character to make them show.
- On the Map the same filter reads as visibility: every party row lit = no filter; switching a row off hides what is *only* theirs. Switching everyone off shows nothing.
- It combines with the other filters with AND (e.g. Sorfon *and* quest X), and it alone decides which routes are drawn. Pins are one per coordinate, so an event with four party members is still one pin.

## Guided tours and help

The tours point at the app's own controls: a popover explains a real control and, where it is safe, the visitor can use it (tap a marker, filter the quests) and the tour follows; *Next* moves on across screens.

- **The main tour has 8 steps**, one idea each: ① the sections (the bottom bar and *More* on phones); ② the Chronicle — a real day of the story or its first card; ③ Sessions — a real session, or the section's heading while none is recorded; ④ Quests — the status filter, which can be used; ⑤ the map — a real marker near the centre; ⑥ the card it opens, and the map's own tour; ⑦ the search; ⑧ last, where the help and the tours live (the **?** button; *More → Help* on phones).
- Two specific tours go further: *Using the map* (markers, grouped markers, the party filter and the dashed journeys, moving around) and *Finding information* (typing, results, an entry and its connections).
- Steps adapt to what the campaign holds: with no located events the map is explained without a marker (7 steps then); with no sessions or quests the section's heading is shown with a "nothing recorded yet" text. No step is ever skipped in silence.
- The popover shows *Step N of M* with a thin bar, *Skip tour* (every step but the last), the title and one or two sentences, then *Previous* · *Next* (*Finish* on the last step, with *More tutorials*, which opens the help). The highlighted control gets a gold ring and stays tappable.
- A tour adds no history: **Back** ends it where it started. Leaving early — *Skip tour*, `Esc`, Back — restores the starting route, scroll, map view, panels, filters and searches; finishing leaves the visitor where it ended. A tap on the dimmed page never ends a tour by accident. Tours can be repeated from the help, always from their first step.

How tours are built is in [Architecture › Guided tours](architecture.md#guided-tours).

## Languages

- **ES / EN** in the top bar (on every screen size) switches the language in place — same page, filters and map view — and is remembered for the next visit. Spanish of Argentina is the default.
- Both the **interface** and the **campaign content** are translated. A text not translated yet appears in English.
- Search works in both languages whatever the interface is in.
- Real play dates are formatted per language (`25 jun 2026` / `25 Jun 2026`); in-world dates (`29 Horisal 867`) are proper names and stay as written.

## Shareable links

Every page has a shareable URL. The language is a personal preference, never part of the link, so the same URL works for everyone:

| Link | Opens |
|---|---|
| `#/chronicle/event/s8_04` | An event (in the Chronicle). |
| `#/sessions/session/12` | Session 12's log. |
| `#/quests/quest/cassandra` | A quest. |
| `#/characters/character/locus` | A character. |
| `#/places/place/vasselheim` | A place. |
| `#/map/at/s11_06` | The map, focused on an event's pin. |
| `#/chronicle/recap/12` | *Previously on…*, session 12. |
| `#/saved` | Your own favourites and history (they live in your browser, so this link shows each reader their own). |

## Offline and installing

After one visit with a connection, the chronicle is readable **offline**: Chronicle, Sessions, Quests, Characters, Places, every entry page, both languages, search, favourites, the help and the guided tours. When it is showing a saved copy, a small note says *Offline — you are reading the last copy saved on this device*.

Browsers that support it offer to **install** it (Chrome/Edge: the install icon in the address bar; Android: *Add to home screen*; iOS Safari: *Share → Add to Home Screen*), and it then opens in its own dark window.

Limitations: the first visit must be online; offline you see the last version you loaded; the full-resolution map needs a connection (offline the map shows its preview); favourites are per browser and device (no sync). To reset everything, clear the site's data in the browser. How it works: [Architecture › Service worker and offline](architecture.md#service-worker-and-offline).
