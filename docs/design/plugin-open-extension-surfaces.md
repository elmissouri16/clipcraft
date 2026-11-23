# Open extension surfaces and rendering

This pre-alpha implementation covers the complete requested scope:

- [x] Interactive player and timeline overlays using isolated packaged views.
- [x] Floating and modal native windows, activation cleanup and editor lifetime ownership.
- [x] User and SDK controlled docking across workbench, left rail, library and a resizable bottom dock, preserving page state.
- [x] Custom shader source, validated parameters and matching preview/export rendering, with compile errors reported.
- [x] Registered custom clip and track types with native timeline items, saved typed data, editable properties, Undo and deterministic rendering/export behavior.
- [x] Broader native property bindings, including effects, curves and custom type properties.
- [x] Host export formats beyond MP4, selected through the SDK and verified on actual output bytes.
- [x] Extension-defined typed hook points with cancellation, ordering, private draft inheritance and cleanup.
- [x] Additional native document lifecycle hooks with cancellation and cleanup.
- [x] Public types, capability discovery, author documentation and an original runnable example.
- [x] Real editor workflows plus focused and regression verification, with retained evidence.

The existing uncommitted UI/process/project expansion remains part of the working
tree. This document tracks the new scope separately. Breaking API changes are
allowed during pre-alpha; compatibility guarantees are not a prerequisite.

Each item remains open until its implementation and appropriate verification are
retained. Registration alone does not establish timeline/render/export support.

## View destination contract

`ui.registerView` and `view.setPlacement` accept `workbench`, `left-rail`,
`library`, `bottom`, `player-overlay`, `timeline-overlay`, `floating` and `modal`.
Moving reparents the same sandboxed native page; drafts and local state survive.
Native placement selectors move docked pages. The workbench picker can bring an
open external view back into the right dock. The bottom dock has pointer and
keyboard resize controls.

Overlay `bounds` are normalized `{x,y,width,height}` inside the actual player
stage or visible timeline viewport. Bounds must fit inside `[0,1]`; omitted
bounds cover the surface. The native background supports transparency; authors
control their own page background and interactive region. Host menus, settings,
other application modals and layout drags mask the native overlay. These are
interactive editor controls, not automatically composited export content.

Floating/modal windows accept optional integer `width` and `height` from 160 to
4096 pixels, defaulting to 640 by 480. They use a native parented window and the
same restricted page/protocol/preload. Modal Escape closes the view; Tab cycles
within native window controls. Closing a native window releases its page;
revealing the registered view later opens a new page. Stop, disable/reload,
editor destruction/navigation and normal application shutdown remove windows.
OS process termination remains outside graceful-cleanup guarantees.

Native page-lifetime layout IDs prevent a former dock's late layout/cleanup from
hiding or moving a page that has changed destination. Registration IDs separately
protect old SDK handles from affecting replacement registrations.

## Progress and evidence

The view destination, [GLSL shader](plugin-glsl.md) and
[custom clip/track](plugin-custom-timeline.md) slices are implemented, as are
[effect/curve property bindings](plugin-extension-native-controls.md) and
[native MOV/Matroska/WebM export](plugin-extension-exports.md) and
[typed custom hooks](plugin-custom-hooks.md). The final
[document lifecycle](plugin-document-lifecycle-hooks.md) slice adds close
validation/preparation and read-only open/create/close observations across native,
SDK and agent project entry points. Failed preservation refuses leaving;
reopening the current file reads the snapshot saved by close preparation.
This completes the requested implementation for local macOS development.
Exact current receipts and a requirement-by-requirement audit are recorded under
`extensionGoalCompletion` in [the validation ledger](plugin-validation.json).

Local view-slice verification passed 15 native checks, 15 focused
regression suites and 9 SDK suites. SDK verification recorded no source
changes. Renderer build, structure and localization checks passed. Quiet runs
verify native content, bounds and interaction, not visible window screenshots
or operating-system focus traversal.

The final plugin/core selection passed 149 suites. The two affected native
autosave/recovery suites passed separately in quiet mode. The lifecycle workflow
passed 21 checks plus 2 cold-restart checks, including cancellation, veto,
private drafts, one Undo, failed file/slot preservation, read-only observations,
Stop and normal quit beyond the frozen-renderer fallback deadline.
All 9 final SDK contract/authoring/distribution suites passed with no source
changes; current source hashes match that receipt.
Installed Windows/Linux execution, release packaging, representative hardware
and manual operating-system focus acceptance remain separate release gates.
No installer, publication or push was performed.
