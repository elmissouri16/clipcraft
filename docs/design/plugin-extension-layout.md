# Native view layout and modal focus

This follows the [view memory cleanup](plugin-extension-view-cleanup.md).
Application 2.0.0, SDK 0.8.0 and host API 1 remain unchanged.

## Verified focus defects

A native test delivered a late trusted Escape to a view already masked by
Settings. Its preload forwarded the focus request; the main process accepted it
and the workbench unconditionally focused its exit control behind Settings.
The failing baseline is retained.

The main process now rejects focus requests from hidden native views. The
renderer independently checks that a focus notification belongs to its selected
view and that the workbench is visible and unobscured. This also covers an event
already queued before the host dialog opened. Native acceptance verifies both
late keys and queued notifications against the real Settings surface, as well
as notifications from an unselected sibling view.

A separate unit baseline showed that layout accepted `visible: true` even when
clamping left no usable native area, focused the hidden child and consumed its
pending reveal. Layout now uses its actual computed visibility when transferring
focus. A native test reveals the view behind About, supplies a fully clipped
layout and measures that the host retains focus. Dismissing About restores the
real viewport and the view then receives its pending focus.

Explicit reveal currently closes Settings to open the workbench. An additional
test initially assumed otherwise and failed; its raw result is retained as an
incorrect test assumption. The final pending-reveal check uses About, which stays
open. This followup does not change that application behavior.

## Layout and title acceptance

The native child remains aligned with its measured renderer viewport at
1000×640 at 1×, 1200×768 at 1.2×, 1400×860 at 1×. The test requires stable alignment after resizing,
including twelve rapid native size changes. Long titles truncate visually while
retaining their complete text/title and close-control accessible name. Focusing
the close control scrolls it into the visible tab strip. Temporary views,
resizing and host dialogs preserve the original draft.

The normal renderer reports a device pixel ratio of 2 on this Mac.
The programmatic 1.2× host zoom exercises coordinate conversion; it does not
certify OS display scaling or add user-facing application zoom controls.

## Evidence and remaining gates

The focused selection passed **11 suites** against identical product source.
The final visible native followup passed **45 checks**, and the default-hidden
workflow passed separately after the two test-only additions. Renderer build,
structure and whitespace checks pass. The final 1,018-file snapshot stayed
unchanged through those native runs. Source deltas, exact versions, raw failures,
geometry/focus traces, captures and results are retained in
`plugin-validation.json.extensionHostNativeLayout`:
`/var/folders/_j/d8w7d_sn23348hmv9trrjm480000gn/T/clipcraft-extension-services-final-k6boi32f/verification.json`.

This is bounded macOS development acceptance. Windows/Linux, installed release,
physical display/scaling hardware, assistive technology and the remaining manual
UX matrix still need coverage. Full-battery prerequisites, representative hardware
and long-session performance/memory budgets, plus the earlier unexplained export
timeout, remain open. SDK v1 is not approved. No installer, SDK publication,
version increment, Git commit or push was produced.
