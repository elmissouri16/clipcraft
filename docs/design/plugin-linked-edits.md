# Linked-clip split and trim transactions

SDK 0.7.0 keeps host API 1 and adds command permission `clips.linked`, requiring
`editor.read`. It may combine with the other bounded clip-edit permissions and
`project.read`. Older grants retain their existing rejection of linked writes.

Read-only clip metadata gains optional
`link: {groupId, partnerId, members_total}`. Group and partner IDs are opaque,
scoped to the loaded document and stable across Undo. `partnerId` is null when
an exact supported partner is not returned. Counts include unsupported members and members omitted from the snapshot,
so incomplete groups cannot look complete. Selected clips' partners
have priority within the existing bounded snapshot. No raw link IDs, source
paths, source offsets or media IDs are shared.

```ts
{type: 'split-linked', clipId, partnerClipId, at_sec,
 gaps: 'preserve-time', transitions: 'reject'}
{type: 'trim-linked', clipId, partnerClipId, start_sec, end_sec,
 gaps: 'preserve-time', transitions: 'preserve-overlap'}
```

Both handles must explicitly identify one complete pair: a main/overlay picture
clip and an audio clip. Either member can initiate. The current pre-v1 extension
accepts equal-duration pairs with equal positive speed and consistent stored
timeline/source offsets, including audio that starts before or after the picture.
All public split/trim times refer to the picture. The audio is sliced at the
same relative position, translated by its stored timeline offset. Source in-points
may differ. Missing, ambiguous, unsupported, locked or inconsistent pairs reject
the whole batch. SDK 0.8.0, host API 1 and application 2.0.0 stay unchanged.

Splits retain the original IDs and link on the left. Host-created IDs and a new
host-created link join the right halves. Each piece retains at least 0.1 seconds.
New handles become available on the next read. Trims crop both current windows
and cannot extend sources. Full-range trims are no-ops. Operations run in order.
Source-time keyframes and fades remain continuous; exterior animations follow the
existing range contract. The main clock is preserved with explicit gaps beyond
discarded overlap. The picture starts at the requested retained start; audio keeps its stored offset.
Free tracks do not ripple. Existing gaps, markers and unrelated clips stay put.

Main transition handling follows the existing split/trim contract. Any affected
linked neighbor outside the explicit pair rejects the batch. Motion-pin
dependencies and final overlaps are checked across the whole project, including
clips omitted from the SDK snapshot. Changed originals, new pieces/gaps and
transition updates all count toward the shared 64-affected-clip limit.

Private preparation replaces the validated clip arrays together, so the reducer's
normal link synchronization cannot re-slice or retime the approved complete pairs. It cannot repair a
partial plugin proposal or silently modify another member. Native per-run consent,
package verification, single-use authorization, immutable receipts, stale/owner
guards and one-step Undo are shared with the existing transaction path.

Implementation steps:

1. Add safe group metadata, explicit operations, permission labels and SDK types.
2. Resolve both private bindings and validate complete pair timing/source invariants.
3. Plan synchronized source slices and host-owned right pairs, then validate the
   final whole project and apply one private prepared batch without collateral edits.
4. Enable appropriate registered actions and verify schemas, permissions, scope,
   dependencies, collisions, gaps, source offsets, speed, fades and Undo/Redo.
5. Compile the public SDK fixture and exercise Settings, menus, panels, CraftAI,
   cancellation, revocation and preview/export in hidden Electron.

Shifted-pair split/trim now uses the existing operations and `clips.linked` grant.
[Linked reordering](plugin-linked-reorder.md) uses the separate combination of
`timeline.reorder` and `clips.links`. [Ripple interval removal](plugin-ripple.md)
uses the separate `timeline.ripple` permission and explicit clip/pair scope.
[Link management and pair movement](plugin-link-management.md) use the separate
`clips.links` permission, including existing nonzero timeline offsets.
No installer, publication, commit or push is included.

Validation outcome on macOS: 57 linked contract checks and
26 native staging/permission checks passed, plus all 21 focused plugin/state
suites. Clean SDK distribution, public types and authoring passed 36 checks.
The SDK-built package passed 44 hidden real-app checks through Settings, menus,
a panel and CraftAI, including actual main/overlay pair operations, one-step
Undo/Redo, mixed batches, gaps, overlap, missing/locked partners, refusal, stale
edits, Stop and revocation. Window show events: 0.

Preview and export agree on retained picture slices and black trim intervals.
Exported audio RMS was 0.124945 / 0.124940 in retained slices
(minimum .01) and 0.000000 / 0.000000 in internal/trailing gaps
(maximum .002). The trailing-gap export retained 12.75 seconds with audio.

Existing main-range, free-edit and UI-action hidden regressions passed
39, 25 and 46 checks respectively, all with no shown windows. Compilation,
structure and whitespace passed. Native consent answers are scripted; the test's
document comparison ignores only derived `media.wave` updates. Full-battery,
packaged-runtime and other-platform checks remain outstanding.
[Retained evidence](plugin-validation.json) includes results and paths.
No installer, publication, commit or push was made.

## Shifted-pair pre-v1 verification

This extension retains SDK 0.8.0, API 1 and application 2.0.0; package and lockfile
version files were verified byte-for-byte unchanged. Both positive and negative
audio offsets now work through the existing `split-linked` / `trim-linked`
operations and `clips.linked` grant. Audio-initiated calls still use picture times.
The private planner slices each source on the same relative clock, retains the
stored offsets and prevents implicit link synchronization from changing them.

Current macOS evidence: 91 linked contract checks, 49 native staging/authorization
checks and 39 SDK helper checks passed. All 60 selected plugin and related
project/history suites passed. The SDK-built package passed 62 hidden real-app
checks through Settings, menus, panels and CraftAI, including shifted main/overlay
pairs, both offset signs, one-step Undo, source windows, refusal, Stop and revocation.

Both shifted main exports retained 13.75 seconds. Measured retained audio RMS
exceeded .01, while the measured pre-onset and internal silent intervals were
below .002. A mixed transaction with moving video and a speed-1.5 shifted overlay
passed 18 checks, then 12 checks after a real process restart, including native
project save/reopen, source-time preview and exported shifted audio slices.
No test window was shown and no renderer errors were recorded.

Renderer compilation, module/packaged-source structure and whitespace checks
passed. This is selected macOS development acceptance, not a new full-battery,
installer/ASAR, Windows/Linux or physical native-focus certification. The prior
release-gate failures and the remaining pre-v1 capability checklist stay open.
No installer, SDK publication, commit, push or version increment was made.
The `shiftedLinkedEdits` entry in [validation](plugin-validation.json) retains
individual suite outcomes, source metrics, export measurements and evidence paths.
