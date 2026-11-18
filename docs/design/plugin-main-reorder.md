# Main-track reorder transactions

SDK 0.5.0 keeps plugin API 1 and adds `timeline.reorder`, requiring `editor.read`.
It can be combined with `clips.write` for a mixed atomic batch; it cannot be
mixed with marker/caption/AI/export writes. Existing `clips.write` grants retain
their free-track scope. Native approval names main-track sequencing separately.

`editor.stage()` accepts an additional operation:

```ts
{
  type: 'reorder', clipId, beforeClipId, // null appends to the sequence
  gaps: 'preserve',
  transitions: 'reject' // or 'clear-boundaries'
}
```

Both handles must be returned main-track handles from the captured context.
Only real clips can move; a gap may be a destination anchor. A source cannot be
its own anchor. Operations run in order. Already-adjacent and already-last moves
are no-ops. The final batch commits once and has one Undo step.

Read-only main clips gain optional `main: {index, transition, overlap_sec}` and
the timeline gains `main_total`. Lists remain bounded and selection-first; use
the index rather than array order. `transition` is the presence of an incoming
transition record, including a dormant transition on the first clip. Actual
overlap is reported in seconds. No transition expressions, source IDs, paths or
media bytes are exposed. Older snapshot shapes still support free-track edits.

Gap preservation means every existing gap keeps its ID, duration and relative
order to other gaps. No gap is moved directly, created, dropped, merged or
normalized, even if reordering makes gaps adjacent or trailing. Main clips are
laid out sequentially in their new order; free-track timing and markers stay
absolute. This is sequence reordering, not an arbitrary timeline-time move.

Transition policy applies after each reorder to clips whose predecessor changed.
`reject` refuses a non-none transition on any such boundary. `clear-boundaries`
removes those incoming transition records and retains all others verbatim.
Source windows, speed, effects, keyframes and other clip fields are unchanged.
Clearing overlaps can lengthen the main sequence and shift later main clips;
the host recomputes actual timing. There is no free-track ripple or automatic
caption/audio relocation.

The host validates the entire project, including omitted clips. Changed order,
timing or transition records all count as affected clips, including gaps. A
transaction may affect at most 64 clips in total. A locked main track, affected
linked main clip, or affected motion-pin dependency rejects the complete batch.
Unchanged linked clips elsewhere are permitted. Invalid timing, missing/forged
handles, unsupported operations, or unexpected reducer collateral changes fail
without partial edits. Mixed free-track edits retain their captured-duration
limits and existing permission checks.

Implementation steps:

1. Add optional safe sequence metadata, canonical operation validation, SDK
   types and the explicit reorder permission/consent.
2. Plan the exact sequence permutation and transition changes against private
   bindings. Reuse the prepared transaction, native commit grant and receipt
   path; keep core batch evaluation pure and gap-preserving.
3. Share the transaction contract across Settings, registered actions, panels
   and CraftAI; enable appropriate main-track action availability.
4. Verify permutations, gaps, transitions, hidden collateral, mixed batches,
   locks/links/pins, scope and Undo/Redo in focused tests.
5. Compile a typed SDK fixture and run real command, menu, panel and agent
   transactions in hidden Electron, including cancellation and revocation.

SDK 0.6.0 adds [main-track split/trim](plugin-main-ranges.md) under `timeline.edit`.
SDK 0.7.0 adds [explicit linked split/trim](plugin-linked-edits.md), now including
shifted pairs. SDK 0.8.0 also supports [explicit linked reordering](plugin-linked-reorder.md)
with both sequencing and pair-management grants. Ordinary reordering retains the
boundaries above. Ripple and automatic reframing remain separate pre-v1 work. No installer or publication is
part of this work.

Validation outcome on macOS: 40 focused reorder contract checks and
19 native staging/permission checks passed. The SDK-built package passed
32 real-app checks through Settings, the Plugins menu, a panel and CraftAI,
including mixed batches, Undo/Redo, transitions, gaps, locks, collateral linked
clips, cancellation, stale documents, refusal and revocation. Real preview and
export both began with the reordered blue source. Window show events: 0.

All 21 focused plugin/state suites passed. Clean SDK distribution and authoring
passed 36 checks; existing free-edit and UI-action hidden regressions passed
25 and 46 checks respectively with no shown windows. Renderer compilation,
structure and whitespace checks passed. Native consent answers are scripted;
full-battery, packaged-runtime and other-platform checks remain outstanding.
Details and retained paths are in [plugin-validation.json](plugin-validation.json).
No installer, publication, commit or push was made.
