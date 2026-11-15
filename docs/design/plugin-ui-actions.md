# Declarative plugin UI actions

SDK 0.4.0 keeps manifest API 1 and adds optional `contributes.actions`. Each package
may declare up to 32 actions with a unique local ID, existing same-package
`commandId`, plain-text label, host icon, locations and simple selection conditions.
Locations are `plugins-menu` and `clip-menu`. Conditions allow selection cardinality
(`any`, `none`, `single`, `multiple`) and allowed clip lanes. All selected clips
must match the lane condition. No arbitrary expressions, DOM, HTML, shortcuts,
styles or custom icons are accepted. UI metadata grants no permission.

The host renders a Plugins menu and a Plugins section in the existing clip menu.
Each entry identifies the package/version; development entries are marked.
Visibility is declarative, while the host controls disabled states for busy
editors, missing projects/targets, locked or unsupported clip-write selections.
The catalog is bounded to 256 actions with an explicit truncation notice;
all commands remain available in Settings. Existing packages opt in and retain
their fingerprints/contracts when actions are absent.

Choosing an action creates a scoped invocation in the existing command runner.
Parameter-free commands start from that click. Parameterized commands use host
numeric/enum controls with declared defaults and bounds. Progress, native consent,
reviews, artifacts, errors and actual results use the existing host contracts.
The host owns dialog layout, focus, Escape/Cancel and result rendering. A panel
cannot read this registry or use it to start commands without its own allowlist
and trusted click.

The invocation captures the project/load generation and selection at selection
time. The host refreshes the catalog before running, then rejects stale targets
or generations. Closing or canceling a running action cancels only its run ID. Cancel is
unavailable while an already authorized reducer batch is applying.
Configuration becomes stale after document/selection changes. Disabling/removing
or replacing packages clears stale registrations, and development reload/end
clears only development entries and their invocations. Catalog reads execute no
plugin code. Existing native permissions, commit grants, reducer checks and Undo
remain authoritative.

Implementation sequence:

1. Add canonical schema, SDK declarations and command-scaffold registration.
2. Expose bounded, integrity-checked installed/development action metadata.
3. Project selection/availability in the host and manage scoped invocations.
4. Render menus, fixed icon mapping and accessible parameter/progress dialogs.
5. Verify schema, lifecycle and type boundaries, then exercise real menu actions,
   native consent, parameters, selection, Undo, cancellation, cleanup and geometry
   in hidden Electron. No visible test windows or foreground capture fallback.

Ripple editing, shifted pairs, toolbar slots, inspector controls and arbitrary
plugin UI rendering remain separate contracts.


Validation uses a typed SDK fixture installed in an isolated hidden Electron
profile. Real UI menu/form events execute the actual sandbox worker and commit
through the same reducer/Undo path. Lifecycle coverage includes installed and
development registrations, live reload, End, upgrade/disable/removal and
preservation of unrelated installed work. Fixed menus escape the header layout
container, long submenus scroll inside the viewport, and native panel views are
masked behind menus/dialogs. Host captures were inspected at normal and smaller
window sizes.

Quiet mode does not test native OS focus. Keyboard assertions use DOM key events,
and a focusout fixture after programmatic NumBox blur because the hidden renderer
did not emit that event. Native approval choices are scripted. There is no
foreground fallback. AI/GIF-specific invocations through these new menus, other
platforms and packaged runtime were not separately verified. Full results and
retained evidence are in [plugin-validation.json](plugin-validation.json).

SDK 0.5.0 extends clip-action availability to main-track selections for packages
with `timeline.reorder`. Free move/trim still requires `clips.write`. Mixed
unsupported selections, gaps, linked or locked targets remain disabled; the
full-project transaction planner checks collateral dependencies at execution.

SDK 0.6.0 also enables main selections for `timeline.edit` split/trim actions.
It grants neither reorder nor free-track move/trim permissions.

SDK 0.7.0 enables `clips.linked` actions for aligned main/overlay picture and
audio pairs. Host availability checks complete topology, consistent source/time
offsets and both partner locks. Authors should admit expanded picture/audio
selections in their predicates. Existing permissions still reject linked targets.
