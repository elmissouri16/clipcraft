# Native extension-view keyboard followup

This is a bounded macOS followup to UX-01, after the
[resource-admission checkpoint](plugin-extension-resource-admission.md).
Application 2.0.0, SDK 0.8.0 and host API 1 remain unchanged.

## Verified defects and corrections

The view preload counted controls with negative `tabindex`, CSS-hidden controls
and inert descendants when deciding whether Tab had reached the view boundary.
Chromium skips those controls. Native Tab therefore wrapped from the final usable
button back to the textarea instead of returning focus to the workbench.

The boundary list now excludes nonsequential, disabled, invisible and inert
controls. Positive `tabindex` values precede ordinary controls in numerical
order, with DOM order retained for ties. Radio groups contribute their focused
or checked member, with directional fallback for unchecked groups. Editable
content is included without overriding an explicit negative `tabindex`.
A native radio-group regression independently reproduced the same wrapping
failure before that correction.

The visible acceptance driver sends trusted native key events without forcing
focus between steps. Enter includes the character event needed for default button
activation. The initial driver omitted it; that failed run is retained as a test
driver error, rather than a product defect. The launcher sets an isolated Electron
user-data directory before loading the application and verifies the actual path.

## Evidence

The fixed-product selection passed **10 suites, 0 failures**. It covers native
views, view authoring, runtime, shortcuts, messages and native UI. A separate
visible Electron run passed **35 checks**, including actual window/webContents
focus, keyboard-only re-entry using Tab and Enter, Escape, forward/reverse Tab,
negative indices, visibility, inert descendants, positive indices, radio groups
and editable content. The original draft survives these transfers. Existing
view isolation, modal masking, cancellation, crash and stop checks also pass.

The visible run uses an SDK-built workbench example and an isolated profile.
Host and view captures were inspected separately because the host capture does
not include the native child view. Independent OCR confirms the draft and controls
in the original PNGs; an initial apparent blank in the image viewer was not a
product rendering failure. The test now also asserts nonuniform child-view pixels
and avoids hiding/reopening the window between keyboard verification and capture.
These final changes affect two test files only; product source is identical to
the ten-suite selection. Both the final visible run and a separate default-hidden
UI followup pass. No renderer errors were recorded. Structure and whitespace
checks passed. The final snapshot covers 1,015 files and remained unchanged
through those final native UI runs.

Authoritative results, native key traces, source hashes, versions and retained
failures are recorded in `plugin-validation.json.extensionHostNativeKeyboard`.
The evidence root is
`/var/folders/_j/d8w7d_sn23348hmv9trrjm480000gn/T/clipcraft-extension-services-final-zgr43yyh/verification.json`.

## Remaining acceptance

This does not close UX-01 or authorize SDK v1. Native Windows/Linux and installed
release interaction remain unverified. Assistive technology, nested shadow DOM,
composite-widget focus variations, smaller windows, scaling and the remaining
manual UX acceptance still need coverage. The full-battery prerequisites,
representative hardware/performance, long-session memory and unexplained prior
export timeout also remain open. No installer, SDK publication, Git commit or
push was produced.
