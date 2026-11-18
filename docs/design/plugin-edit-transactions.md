# Clip edit transactions

The initial SDK 0.3.0 contract below covers free-track edits. SDK 0.5.0 adds
[main-track reordering](plugin-main-reorder.md) under the separate
`timeline.reorder` permission, with mixed batches and the same commit/Undo path.
SDK 0.6.0 adds [main-track split/trim](plugin-main-ranges.md) under `timeline.edit`.

SDK 0.3.0 keeps host API 1 and adds command `clips.write`, which requires
`editor.read`. `context.editor.stage({documentId, revision, operations})` stages
one transaction of 1–64 move/trim operations against that command's captured
snapshot. Nothing changes until successful command completion and host commit.
Permissions may include project.read, but cannot mix clip edits with marker,
caption, AI or export operations in this slice.

Move uses `{type:'move', clipId, start_sec}`. Trim uses
`{type:'trim', clipId, start_sec, end_sec}`. Operations run in order, permitting
move/trim composition. Final collision checks permit swaps without requiring
intermediate space. Targets must be returned opaque handles from the same
document/revision. Playback and selection changes after capture do not invalidate
that frozen context; any document edit does.

The first slice supports overlay, audio, text and effect clips on their existing
tracks, without ripple or source extension. All ranges stay within the captured
project duration and retain at least 0.1 seconds. Main-track edits, linked clips,
new tracks, overlap, media/source access and arbitrary patches are unsupported.
This avoids implicit layer creation, linked-partner writes and main-track ripple.
Trims retain source-time keyframes and slice audio fades and measured text timing.
Trimmed entrance/exit animations follow the editor's existing range-cut behavior.

The worker sees only public metadata. The trusted renderer captures a private
handle-to-project mapping before approval. Native staging validates scope,
permissions, targets, locks and range limits. The renderer validates again
against the entire current project, including clips outside the bounded SDK
snapshot, before preparing any reducer action. New overlaps are rejected.
The normal reducer validates the prepared batch; any unexpected normalization or
collateral change rejects the transaction. Nothing is partially applied.

Native completion supplies a short-lived single-use commit authorization bound
to run, package, proposal and editor frame. Stop, package changes, developer
reload/end, stale documents and closed panel actions prevent unauthorized commits.
Catalog revocation also cancels completed proposals whose native authorization
reply is still queued. Waiting for authorization is cancelable; guarded reducer
dispatch starts the committing phase. The combined permission matrix and
supported/rejected mixtures are recorded in the
[transaction review](plugin-transaction-review.md).
The reducer accepts only a private prepared token with the original base and
correct manual/agent owner. Preflight and speculative reducer evaluations do not
consume tokens or acknowledge a write. Commit receipts belong to the actual
history state, survive Undo for replay protection and reset on document load.
They are bounded and never saved in the project. The host reports actual changed
clips only after committing.
One batch is one Undo step (or one step within CraftAI's existing edit owner).
Panel actions invoke the same approved command; panels have no direct write API.

Implementation sequence:

1. Canonical operation schema, permissions and strict SDK types.
2. Private snapshot target capture and full-project atomic edit planning.
3. Native staging and single-use commit authorization.
4. Manual, panel and CraftAI adapters with actual reducer acknowledgements.
5. Adversarial contract tests and typed fixture tests in hidden Electron,
   including atomic failures, real trim/move timing, Undo/Redo and cancellation.

Validation passed on macOS: the typed SDK fixture performed real move/trim batches
through Settings, an isolated panel and CraftAI. The same tests verified source
timing/fades, whole-batch Undo/Redo, no-op counts, native refusal, locks/links,
invalid scope, collision rollback, worker failure, Stop, concurrent user edits,
panel closure and package disable. All tests stayed hidden. Evidence is recorded
in [plugin-validation.json](plugin-validation.json), including unrelated
caption-suite environment failures. No foreground visual or packaged-runtime
claim is made for this API stage.
