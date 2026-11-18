# Bounded plugin ripple removal

This pre-v1 extension keeps SDK 0.8.0, host API 1 and ClipCraft 2.0.0.
It adds one command operation and a dedicated `timeline.ripple` permission,
requiring `editor.read`. Other edit grants do not gain ripple authority.

```ts
import type {RippleRemoveEdit} from '@clipcraft/plugin-sdk';

const operation: RippleRemoveEdit = {
  type: 'ripple-remove', start_sec: 6, end_sec: 7,
  clipIds: [freeClipHandle],
  linkedPairs: [{clipId: pictureHandle, partnerClipId: soundHandle}],
  gaps: 'preserve-pieces', transitions: 'reject', markers: 'preserve',
};
await context.editor.stage({documentId: snapshot.documentId,
  revision: snapshot.revision, operations: [operation]});
```

All policies and both scope arrays are required, including when empty. Handles
come from the captured `editor.read()` result. Raw IDs, unknown fields, repeated
handles/pairs, foreign documents and stale revisions reject. Either linked
member may be supplied first. Ripple must be the transaction's only operation.

## Clock and explicit scope

The positive absolute interval `[start_sec, end_sec)` must lie inside the actual
main sequence. The host maps retained time `t` to
`t - max(0, min(t, end_sec) - start_sec)`. Main clips and gaps follow this clock;
clips inside the interval disappear, crossing clips retain source slices on
each side, and later clips move earlier. There is no automatic clip merging,
gap normalization, relayering, track creation or source extension.

Every affected linked main-picture/audio pair must be explicitly named in
`linkedPairs`, including neighbours outside the bounded snapshot. Missing,
ambiguous, incomplete or inconsistent private groups reject the whole operation.
Even a main clip whose record is unchanged but whose actual position/index
changes is checked. The host scans the whole project, rather than trusting
bounded public metadata as the complete dependency graph.

Named pairs additionally require `clips.links`. Pictures may be on the main or
an overlay track. Each sound retains the same relative source slices as its
picture, at the stored positive or negative timeline offset. Stored source
offsets, equal duration, positive equal speed and complete two-member topology
must remain consistent. A shifted sound is not independently cut by its own
absolute timeline intersection. New right pieces receive a host-owned shared
link ID and independent host-owned clip IDs.

`clipIds` additionally requires `clips.write`. It names only unlinked overlay,
audio, text and effect clips that should follow the same clock. No selected
clip or active layer is implicitly included. Unlisted free clips and overlay
pairs retain their absolute positions and source windows, even if this leaves
the project's total duration longer than its shortened main sequence. Markers
also retain absolute time; marker shifting has no policy in this contract.

A main-only unlinked cut can use empty scope arrays with `timeline.ripple` and
`editor.read` alone. Empty pair scope fails if an affected main clip is linked.
Existing free move/trim and main split/trim operations keep their prior behavior.

## Retained data, gaps and transitions

The first surviving piece retains the original clip ID, including when only the
right slice survives. A second piece gets a fresh host ID reserved against clip,
media, marker, sticker and link IDs. Source windows respect speed; source-time
keyframes remain in source time. Fades are sliced continuously. Entry/exit
animations survive only at retained original edges. Caption words use existing
crop logic, including rejection of a measured caption piece with no words.

`gaps:'preserve-pieces'` keeps surviving gap fragments, with the original ID on
the first piece and a new ID on a second. Whole gaps can disappear; surviving
gaps are not merged or dropped at sequence end. A partial retained piece must
be at least 0.1 seconds. A whole short gap may be removed without creating a
short partial fragment.

`transitions:'reject'` requires existing boundaries and their retained overlap
to survive exactly. A cut cannot remove/crop an incoming transition head, remove
its predecessor tail, activate a dormant first transition or change overlap by
triggering duration clamping. Unaffected overlap may remain and move with the
sequence. A newly created internal split join has no transition. No policy
silently clears a transition or repairs its duration.

Both pair locks, changed main/free track locks, full-project collisions, original
project bounds for free tracks, source limits and motion-pin dependencies are
checked. A negative shifted onset or collision rejects; nothing is relayered.
Untouched linked groups are protected from incidental source-window repairs by
the existing private prepared-array path.

## Limits, ownership and product surfaces

- Exactly one ripple operation. Its operation plus free-target/pair declarations
  share a 64-item budget, with at most 63 free targets and 32 pairs.
- All changed, deleted and new clip records share the 64-affected-clip limit.
  Main retiming/index changes count, including gap changes. A pair declaration
  counts once toward the scope budget, but both affected records count toward
  the affected-clip limit. Records are counted once each.
- Native confirmation names `timeline.ripple` and all other requested grants,
  with Cancel as default. Per-run package fingerprint, owner/revision guards,
  one-use authorization and actual `clips_changed` receipts remain authoritative.
- Successful preparation/commit produces one Undo step. Redo retains generated
  identities. Refusal, Stop, worker failure, stale edits, panel closure and
  package revocation discard staging without partial application.
- Settings, registered menus, allowlisted same-package panel commands and
  CraftAI share the same host path. Ripple menus may target main gaps. Existing
  packages without ripple keep their prior gap-selection restrictions. Menu
  availability does not bypass dependency validation or add collateral scope.
- Saved edits are ordinary project data. Reopening/exporting them does not
  require the command package to remain enabled or replay any plugin code.

## Verification outcome

Retained results are appended under `rippleEditing` in
[plugin-validation.json](plugin-validation.json). The standalone suite covers an
independent interval oracle, permission combinations, explicit/hidden groups,
source/fade/caption slicing, gaps, transitions, locks, dependencies, collisions,
limits and private-token/Undo safeguards. Native runtime and public TypeScript
fixtures cover staging and exact grants.

A public SDK author project is built, packaged and installed in isolated hidden
Electron. Settings, menus (including a gap), a panel and CraftAI run the actual
worker. Moving source footage and distinct tones verify preview/export source
slices, shifted sound continuity and explicit free-audio movement. Native save
is reopened in a second Electron process with the package disabled, and export
is checked again. Only known derived waveform/poster fields are excluded from
the saved-data equality assertion; timing, IDs, sources and link fields remain
in that assertion.

The first UI attempt passed the edit/export checks, then exposed a fixture
assertion that assumed overlay-array order. Native loading sorts those clips by
layer; the assertion was corrected to find the original ID. No product behavior,
source-timing expectation or export threshold was relaxed.

These are macOS development checks with scripted native approval and hidden
windows. They do not certify foreground keyboard/focus behavior, installed
release artifacts, Windows/Linux, live providers, large-project performance or
v1 readiness. SDK support negotiation and the remaining pre-v1 capabilities are
still open. No installer, version bump, publication, commit or push is included.


The final selected run passed 66 suites. The contract suite passed 102 checks
including 600 generated oracle cuts, native edit runtime passed 64 checks and SDK
helpers passed 39 checks. The actual SDK-built app fixture passed 34 checks and
its fresh-process phase passed 11, with zero shown test windows and zero recorded
renderer exceptions in each. The 9-second export retained the left/right source
frames with mean absolute channel errors 2.880787 and 2.826389 against a threshold
of 12. Sampled active audio RMS exceeded .01 at both slices and the collapsed
join; measured source/free tones were 766.67/326.67 Hz (expected 770/330, tolerance
20 Hz), while the pre-onset sample had zero RMS. The restart export reproduced
the measurements. SDK/renderer builds and structure/whitespace checks passed.
