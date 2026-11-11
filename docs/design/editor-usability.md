# Editor usability

ClipCraft keeps its existing navy surfaces, violet accents, Inter typography and
editing model. The editor supports desktop windows from 1000 × 640 upward.
Edit and Agent share the project, preview, timeline, selection and history.

## Layout and controls

- Panel constraints account for the actual frame padding and deck gaps. Edit's
  timeline scales with window height; each workspace retains its own sizes.
- Playback controls adapt to the preview width in either workspace. Timeline
  tool clusters wrap together so editing and zoom controls remain reachable.
- Agent's Expand timeline / Compact timeline control changes only the layout.
  Media and Properties dock beside the preview, which stays fully visible.
- Narrow Media panels use a compact kind filter. The expanded tree remains
  available in wider panels and shares the same selection and counts.
- Library headers, caption actions, segmented choices and thumbnail grids reflow
  within the available panel width. Transition counts come from the live catalog.
- Inspector fields retain room for numeric values, units and keyframe controls.
  Video/text navigation and stabilization choices wrap rather than extending
  outside the panel. Selecting a different clip starts its inspector at the top.

## Scrolling and keyboard navigation

Scrollable panels contain wheel overscroll and reserve scrollbar space. Chat's
composer, inspector header and Settings navigation stay outside their respective
scrolling content. Settings retains its size across sections and opens each
section at the top, including when the active section is clicked again.

Settings receives keyboard focus, keeps Tab navigation inside the dialog, and
returns focus to its opener when closed. Editor keyboard shortcuts cannot change
the timeline behind a modal or override an already-handled control key.

Dropdowns reveal the keyboard-highlighted option without scrolling the surrounding
panel. Menus open above a field when that provides more room and respect the
viewport and scrolling ancestors. Escape closes the menu before its parent dialog.

## Desktop behaviour

On macOS the window buttons sit inside ClipCraft's top bar (one bar, no separate
title bar); the bar and a strip at the top of Home drag the window, while its
controls, dialogs, menus and popovers stay clickable. A native menu bar offers
About, Settings (⌘,), File (Home, Open, Save, Save As, Import, Export), Edit and
View; Save shows its shortcut but the editor's remappable keymap handles the key.
Windows and Linux keep the system frame without Electron's developer menu.

Everywhere: messages and confirmations use native dialogs, text fields and
selected text have a native right-click menu (cut, copy, paste, spelling), the
window opens at its last size and position, the interface does not zoom like a
web page, controls use the arrow cursor (a hand only on real links), presses
darken instead of moving, and images cannot be dragged out like web images.

## Settings organisation

Settings groups its pages in the rail: **General** (Performance, Shortcuts),
**AI** (Assistant, Voice, Tool servers) and **Services** (Media libraries). Each
page opens with a title and one line saying what it is for, followed by small
labelled groups; the Assistant page splits into Provider, Connection (a one-line
agent status with the path trimmed) and Model, with Test and Save in a footer
that stays visible while scrolling. Settings uses a compact desktop rail with
small inset keyboard focus, flat selection with a narrow accent marker, and
quiet section labels. Forms use restrained group borders and tighter spacing.

Settings stays a centred window (2026-11-11). A flush full-window version was
tried and rejected: it covered the top bar and the traffic lights and read as
out of place. Inside the window the rail group labels use the 10.5 px uppercase
section tier and page titles the 13 px tier with one quiet line under them, so
the pages read as desktop preferences. Home has the same Settings control in its
header as the editor's top bar. `tests/smoke/smoke-ui-review.cjs` screenshots
every page and records the computed styles of its building blocks.

## Keyboard shortcuts

Settings > Keyboard shortcuts lists every editor shortcut by group (Playback,
Editing, Tools, File) and lets each one be remapped: add a key with +, press the
keys (Esc cancels), remove a key with ×, reset one action or all of them. A key
belongs to one action; assigning it elsewhere moves it and says so. Changes save to
`settings.json` (only the differences from the defaults) and apply immediately.
On macOS, Cmd works as Ctrl. Toolbar and player tooltips show the current keys.
The definitions live in `src/app/keymap.js`; `tests/unit/editor/test-keymap.mjs`
and `test-shortcuts-ui.cjs` (real key presses) cover them.

## Export

Portrait covers retain their project aspect ratio within a bounded preview.
The ready-to-export sheet scrolls its settings body independently; Cancel and
Export remain visible. Controls use the same surface, border and accent tokens
as the editor rather than undefined legacy color variables.

## Regression evidence

The following are real Electron checks with isolated profiles and local fixtures:

| Check | Coverage |
| --- | --- |
| `tests/unit/editor/test-ux-layout-ui.cjs` | Both workspaces at 1000 × 640, 1400 × 860 and 1920 × 1080; all nine library tabs; minimum library width; forward/back native wheel scrolling; Settings alignment, scroll reset and keyboard isolation; export footer visibility. |
| `tests/unit/editor/test-ux-controls-ui.cjs` | Long conversation lists, keyboard menu scrolling and selection, dropdown placement and Escape, timeline expansion, all video/text/color tabs, and video/overlay/title/caption/audio/effect inspectors. |
| `tests/unit/agents/test-workspaces-ui.cjs` | Request ownership through mode switches, Stop, drafts, attachments, Undo, media import, and layout restoration. |
| `tests/unit/editor/test-editor-space-ui.cjs` | Track folding, selection, drag/drop, credits, clipboard actions and preview resizing. |
| `tests/unit/editor/test-home-projects-ui.cjs` | Home card alignment, search, responsive sizes, resume and removal. |
| `tests/unit/export/test-export-ux-ui.cjs` | Export actions and settings through the real sheet. |

Build the renderer before running the standalone UI checks: their shared runner
serves `dist/` in a temporary local server. `npm run test:structure` checks module
boundaries. `npm test` runs the complete standalone battery and writes individual
logs plus `results.json` to the temporary directory printed by the runner.

The existing `performance-contracts` smoke mode additionally exercises live
playback, frame stepping, pause/seek, production project loading, virtualized
tracks and bounded preview media pools against the dev server. It imports source
modules and therefore needs the dev server rather than Vite preview.

## Filters: selected clip or the whole video (2026-11-10)

A filter look belongs to one clip, and with nothing selected it goes to the main-track clip under
the playhead. In the common CraftAI layout the main track is a flat background with the pictures
and graphics on overlay tracks, so a look applied that way visibly did nothing. The Filters tab now
has a scope: **Selected clip** (one clip, or every selected clip) or **Whole video**, which puts the
look on the Effects track as a filter layer (`project.effectClips` with `fx: 'filter:<look>'`,
`src/features/effects/filters.js`). A filter layer acts on every picture under it — main track,
overlays and graphics — through the same pass builder the clip filter uses (`pixelPasses` in
`src/features/effects/apply.js`), so the player and the export agree; its strength is the intensity,
it takes a region like any effect layer, it can be trimmed or moved on the timeline, and a filter tile
dropped on the Effects lane creates one. The timeline and inspector label it "<Look> filter".
`tests/smoke/smoke-filters.cjs` (launched by `tests/unit/effects/test-filters-ui.cjs`) proves both
scopes in the real app with chroma measurements of the player and the export;
`tests/unit/effects/test-filter-layer.mjs` pins the pass builder.

## Effects are visible where they land (2026-11-10)

An effect applied to a clip is now a named badge on the clip itself (teal, after the filter's purple
badge), with × to remove it; clicking the badge selects that effect so the inspector opens on its
strength and region. The Effects lane keeps showing the same effect as "<name> · on clip", and a free
effect added with nothing selected still lands on the Effects track at the playhead, selected. The clip
label no longer says "N effects" — the badges name them. `tests/smoke/smoke-effects-ui.cjs` (launched by
`tests/unit/effects/test-effects-ui.cjs`) proves both paths in the real app.

## CraftAI spotlight and trail (2026-11-10)

The timeline shows what the agent is doing instead of only the status strip: the running tool's clips
and ranges are spotlit (violet ring, informational stripe, "CraftAI · <title>" chip; a band and ruler
chip for a time range), the scroller reveals an off-screen target without fighting the user, and each
finished change leaves a fading trail (1 px ring and ✓). Violet only, no glow, `--r-xs` chips, selection
ring stays outermost; reduced motion keeps the rings and drops the stripe animation. Details and the
ownership rules in docs/agents/agent-editing.md. `tests/unit/agents/test-agent-spotlight-ui.cjs` proves
it in the real app. An outside MCP agent (Claude Code, Codex) gets the same spotlight and trail, with its
name on the chip, so the user sees what it touches wherever the edit comes from.
