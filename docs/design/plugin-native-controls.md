# Native plugin toolbar and inspector controls

> Historical executable recipe design. Its runtime/SDK declarations are retired.
> Use the [general Node host](plugin-extension-host.md) and
> [migration rules](plugin-legacy-retirement.md). Creative pack and private edit
> validation contracts remain where referenced by the current host.


This pre-v1 extension keeps SDK 0.8.0, manifest/host API 1 and app 2.0.0.
`contributes.actions` accepts `toolbar` and `inspector` alongside `plugins-menu`
and `clip-menu`. An action can list all four once each. The existing limits of
32 actions per package and 256 verified catalog entries remain shared across
surfaces, with deterministic ordering and package/version attribution.
Registrations are inert data referencing an existing same-package command.

```json
{
  "id": "adjust-audio",
  "commandId": "adjust-audio",
  "label": "Adjust selected audio",
  "icon": "audio",
  "locations": ["toolbar", "inspector"],
  "when": {"selection": "single", "lanes": ["audio"]}
}
```

Toolbar actions use the eight existing host icons. At most two direct icon
buttons appear; an overflow menu contains every visible toolbar action, including
those direct buttons. At narrow header widths, only overflow remains. Its menu
escapes the header container and uses the existing scrolling, keyboard navigation
and focus handling. Titles and menu details identify the package/version and
mark development sessions. No plugin HTML, CSS, SVG, script or shortcuts are
accepted on these native surfaces.

Inspector registrations must explicitly declare `when.selection` as `none`,
`single` or `multiple`. `none` is a project inspector control; it cannot include
lane conditions. `any` and omitted cardinality are rejected for inspector actions.
All selected lanes must match, and host availability checks retain private locks,
linked topology and permission rules. Attached effect slices and unsupported gaps
are hidden. A registration does not authorize writes or promise a valid edit.

The inspector renders a card for each matching action with native command fields
and an explicit Apply button. Fields are **command input drafts**, not bindings to
current clip properties. Drafting does not run plugin code, preview a write or
create history. A project object, selection set or load-generation change resets
all drafts and uncommitted numeric text; returning to a prior selection does not
restore its old draft. Drafts are never saved in the project or panel storage.

Commands support up to eight mixed numeric, enum and boolean parameters. Numeric
and enum schemas retain their existing forms. Boolean parameters are exactly:

```json
{"id": "muted", "name": "Mute audio", "type": "boolean", "default": false}
```

The host renders a checkbox switch. Inputs require actual booleans: strings,
numbers, null and unknown schema fields fail validation. Settings, action dialogs,
inspector controls, SDK types, main-process validation and allowlisted panel
commands share this contract. CraftAI uses `{id, toggle: true}` alongside numeric
`{id, value: 0.5}` and enum `{id, choice: "fade"}` pairs. Each pair has exactly one
correctly typed value field; duplicate IDs and mixed alternatives are rejected.
Boolean support grants no additional panel AI/caption/GIF capabilities.

Apply captures the exact project, load generation, selection and input. The host
refreshes the verified catalog and validates availability and input before invoking
the existing command runner. Toolbar buttons use the same runner, with a native
configuration dialog for commands with parameters. Every execution retains fresh
native consent, sandbox staging, validation, exact commit authorization and one
Undo transaction. Progress/results identify the actual changed count; plugin
messages remain attributed, untrusted text. The inspector dialog displays the
captured values, not the reset drafts behind it.

Selection/document changes invalidate configuration and cancel pending work;
stale rendered Apply/menu callbacks cannot retarget a new selection. Closing,
collapsing or replacing the inspector cancels only an unfinished inspector-owned
run. Toolbar/menu work is unaffected by inspector closure. An authorized atomic
batch already applying cannot be canceled. Completed receipts remain visible.
Disable/removal, upgrades and development catalog revocation remove registrations
and invalidate pending work through the existing shared catalog lifecycle.

Verification evidence is retained under `nativeControls` in
[plugin-validation.json](plugin-validation.json). The real-app fixture installs a
package produced by the public SDK into a fresh hidden Electron profile and uses
native host controls, the actual worker, scripted native approval, Undo and a
second process. Hidden-window numeric blur/focusout and keyboard events are
explicitly driven by the fixture; this does not certify OS-level focus behavior.
Selected macOS verification does not satisfy packaged-runtime, cross-platform or
full release gates. Existing property/export regressions cover the shared edit
and render path; this native-surface fixture checks command dispatch and stored
values rather than adding another export benchmark.
