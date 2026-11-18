# Plugin permission and transaction review

Reviewed 2026-11-15 for TXN-01. This is a bounded source review and deterministic
test record for the current manual, menu, panel and CraftAI edit paths. It does
not certify an installed release, every operation sequence, other operating
systems, or arbitrary hostile native code. Feature scope and API versions are
unchanged. Exact results, reproduction and artifact paths are retained under
`transactionReview` in [plugin-validation.json](plugin-validation.json).

## Permission matrix

All five edit grants require `editor.read` at manifest validation. They may be
combined with each other and `project.read`; marker, caption, AI and export grants
cannot accompany them. Each operation still checks its own grant. Combining
older grants does not imply `clips.links` or `clips.linked`.

| Grant | Operations | Authorized scope and policies | Excluded authority |
| --- | --- | --- | --- |
| `editor.read` | `editor.read()` | Captured public document/revision, opaque handles, bounded timeline and selection | Staging, raw media paths, source model or reducer actions |
| `project.read` | `project.read()` | Bounded project summary | Any editor mutation |
| `clips.write` | `move`, `trim` | Returned unlinked overlay/audio/text/effect clips on their existing layers; original duration, minimum range, source bounds, locks, full-project collision checks | Main edits, linked partners, arbitrary patches, new tracks or ripple |
| `timeline.reorder` | `reorder` | Returned unlinked main clip and explicit anchor; preserve gaps, reject transitions or explicitly clear changed boundaries | Linked clip reorder, implicit linked retiming or split/trim |
| `timeline.edit` | `split`, `trim-main` | Returned main clip; preserve absolute time with host-owned halves/gaps; reject transitions or explicitly preserve/clamp overlap | Hidden linked partner edits, source extension or ripple |
| `clips.linked` | `split-linked`, `trim-linked` | Both returned original handles of a complete aligned picture/audio pair; equal speed, bounded sources, explicit gap/transition policy | Shifted-pair split/trim, link creation/removal, general pair movement |
| `clips.links` | `link`, `unlink`, `move-linked` | Both returned picture/audio handles; complete topology, equal speed/duration, host-owned link identity; movement preserves exact source windows and stored offsets; main movement consumes explicit empty time | Linked split/trim, main linked reorder, arbitrary topology fields or ripple |

The projection is bounded, not the safety check. Private planning uses the whole
project to detect collisions, missing/extra pair members, locks, source bounds,
motion-pin dependencies and affected-clip limits outside returned rows. One
transaction stages at most 64 operations and affects at most 64 clips; split
halves, created/consumed gaps and changed transition records count. New identifiers
are allocated by the host and are not available as extra worker handles inside
the same captured transaction.

## End-to-end trace and asynchronous boundary

1. [Manifest validation](../../shared/pluginManifest.mjs) constrains the grant
   combinations. [Editor context](../../src/features/plugins/editorContext.js)
   captures the document epoch/revision and private handle bindings before
   execution. The worker receives a validated public projection only.
2. The [native broker](../../electron/plugins/commandRuntime.cjs) authenticates
   runtime, sender frame and token, accepts one staged transaction per run, and
   runs [the canonical schema](../../shared/pluginEdits.mjs) with the package's
   permissions. Native approval defaults to Cancel. Integrity/activation is
   rechecked after approval and after successful worker completion. Staging is
   not a write.
3. Completion mints an expiring single-use authorization bound to run, package,
   exact serialized proposal, editor owner and main frame. Concurrent requests
   reserve it once. Final authorization, requested after renderer planning,
   checks package integrity/activation and rechecks cancellation, expiry and
   owner after its asynchronous verification.
4. The [private planner](../../src/state/store.js) validates original handles and
   runs the ordered operations on private arrays. It validates the complete final
   project and rejects unsupported normalization/collateral changes. A failure
   returns no action and changes none of the original project objects.
5. [Manual/menu/panel execution](../../src/features/plugins/usePluginCommands.js)
   and [CraftAI](../../src/features/agent/pluginTools.js) check current document,
   request/agent owner and cancellation after native authorization. Panels require
   their separate, live [action authorization](../../electron/plugins/panelActions.cjs).
   Management catalog notifications now revoke completed-but-unapplied proposals
   too; developer catalog changes revoke manual development commands.
6. Immediately before dispatch the renderer marks the operation committing. The
   reducer checks the private plan token, captured base, gesture/agent ownership
   and history receipt against queued edits. Successful work produces one Undo
   step, or one step within the existing CraftAI owner. Counts come from the
   validated plan after an actual history receipt, not worker text.

The cancellation boundary is reducer dispatch, rather than worker completion or
receipt of a native permission decision. Waiting for a development commit reply
also stays cancelable. Once the renderer has dispatched the guarded action,
cancellation must not falsely describe an applied edit as rolled back. Panel
broker settlement likewise preserves the actual result of an authorized commit.
Integrity checks have explicit decision points; this is not an atomic filesystem
lock against arbitrary external disk tampering after final native verification.

## Verified defect and fix

The real Settings workflow reproduced a package-disable race: a worker completed,
native authorization succeeded, its response was held in transit, then the editor
received plugin revocation before receiving that response. The command hook
watched document identity but did not watch catalog revocation. It subsequently
applied the disabled plugin's edit and displayed a successful count. CraftAI's
equivalent queued-authorization test also failed.

Both renderer paths now subscribe to plugin catalog changes for the lifetime of
unapplied work and cancel the exact run. The command hook also handles developer
catalog changes and no longer marks a pending development authorization as an
already dispatched commit. Subscriptions are disposed on completion/unmount.
CraftAI reports explicit cancellation if revocation wins before dispatch. Native
grants, planning authority, supported operations and the reducer remain unchanged.

## Ordered mixtures and private pair preservation

| Mixture using original captured handles | Behavior |
| --- | --- |
| Link → move-linked → unlink, either main or overlay | Supported as one transaction under `clips.links`; offsets and source windows remain exact |
| Several complete pairs plus unrelated free edits | Supported with all required grants; final-state collision checks apply to the whole result |
| Split-linked → trim-linked on the retained original pair | Supported for aligned pairs; right halves receive host-owned complete link identities |
| Split-linked → unlink retained original pair, plus unrelated main/free edits | Supported with separate grants; generated right partners remain complete |
| Unlink original main pair → main range edit/reorder | Permitted only with the separate main grant and remaining final-project safeguards |
| Link previously unlinked members → split-linked | Rejected: the captured linked operation needs an originally exposed complete pair; refresh context in a later command |
| Unlink → split-linked/move-linked without relinking | Rejected: no current complete pair |
| Pair management plus ordinary free edit on the same members | Rejected in either ordering; ordinary edits cannot overwrite pair-managed state |
| Linked main reorder or shifted linked split/trim | Rejected; these contracts remain deferred |

The link-synchronization exception is a local Set inside a private WeakMap entry,
keyed by a host-minted array token. It is used only for the exact one-operation
prepared batch, original base and exact expected array identities. Complete pairs
are checked before and after planning; only explicitly managed pairs enter the
Set. The returned action exposes a different opaque plan token, not that Set or
the private batch arrays. The final equality check rejects incidental reducer
repairs. JSON fields such as `preservedLinks`, `shiftedLinks`, `preparedAction`,
`agentToken` or `base` cannot request the exception. Unrelated reducer paths retain
normal link synchronization.

Reducer evaluation remains pure: React may evaluate the same prepared action
against the same uncommitted state twice. Acknowledgment belongs to the resulting
history state. Receipts are bounded, survive Undo and are not saved as project
data; native authorization is consumed separately. WeakMap entries have no global
strong registry and live only while their private tokens remain reachable.

## Evidence and limits

The new generated suite exhausts length-three combinations of a fixed two-pair
topology/placement vocabulary, then checks seeded fractional/speed sequences. Its
independent oracle compares exact source/clip fields, intended placement/topology,
unchanged project fields, rejection without mutation, one-step Undo/Redo and
private action replay guards. A separate permission sweep checks every subset of
the five edit grants against each operation. This is bounded generated coverage,
not exhaustive model checking of every main-track or transition composition.

Existing focused suites cover main-range/reorder policies, omitted snapshot
members, transitions, locks, motion pins, source bounds and affected-clip limits.
Native/panel boundary checks cover late/refused approval, Stop, revoked packages,
expiry, owner replacement/navigation/destruction and concurrent authorization.
The real app holds positive native authorization replies in transit, then
exercises Stop, package revocation, document replacement and owner changes before
letting replies reach Settings/CraftAI.
The development workflow also holds a positive marker-commit reply while the
snapshot reloads, verifying that the old generation cannot apply its markers.

The mixed-media workflow uses actual moving H.264 source and audio, all five edit
grants in one command, native save, a fresh Electron process, preview sampling and
real exports before/after restart. Pixel samples use identical native-resolution
locations in both decoders. Source-time matches, motion between samples, the
original main clock, shifted audio onset and vacated silence/black are measured.
Complete document comparisons exclude only separately derived audio waveforms;
fast-sprite/full-sprite/poster generation is settled first and those fields remain
in comparisons. The comparison rules were not broadened to conceal failures.

macOS development Electron, hidden windows and scripted native decisions remain
the test environment. Native focus/user approval interaction, installed/ASAR
payloads, supported Windows/Linux releases, long-session load and the full test
battery remain separate release gates. No SDK/API bump, installer, publication,
commit or push is authorized by this review.
