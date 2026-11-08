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
that stays visible while scrolling.

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
