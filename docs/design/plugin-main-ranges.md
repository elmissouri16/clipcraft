# Main-track split and trim transactions

SDK 0.6.0 keeps plugin API 1. New command permission `timeline.edit` requires
`editor.read`; it may combine with `clips.write`, `timeline.reorder` and
`project.read`. Older edit grants retain their scopes. Commands, registered
menu actions, panels and CraftAI use the same staging and atomic commit path.

```ts
{type: 'split', clipId, at_sec, gaps: 'preserve-time', transitions: 'reject'}
{type: 'trim-main', clipId, start_sec, end_sec,
 gaps: 'preserve-time', transitions: 'preserve-overlap'}
```

Times are absolute timeline seconds evaluated in operation order. Targets must
be returned non-gap main handles. A split retains the original ID on its left
half and creates a private host ID on the right. Each half retains at least
0.1 seconds. A trim crops the current window and cannot extend it or remove
its final 0.1 seconds. A full-range trim is a no-op. New pieces receive opaque
handles on the next editor read; this batch cannot name host-created IDs.

Both operations preserve the main timeline clock, regardless of magnet settings.
Trimmed time beyond an overlap becomes explicit leading/trailing gaps, including
at the end of the sequence. Existing gaps retain their IDs, duration and order;
they are not normalized or merged. Free clips and markers stay at absolute times.
Source windows scale with speed. Source-time keyframes, effects, transforms and
media references are retained. Audio fade offsets preserve the original envelope.
Split halves keep the entry/exit animation on the corresponding outer half;
trimming an animated edge removes that edge animation.

`transitions: 'reject'` refuses a non-no-op range edit touching any non-none
incoming or outgoing transition record, including a dormant first transition.
`'preserve-overlap'` preserves the overlap that remains within the retained range.
For a trim, overlap is reduced by discarded head/tail time and exhausted records
are removed. Any remainder is pinned with the existing `timelineOverlap` field
so duration caps cannot move other clips. Splits preserve both exterior overlaps
and have no internal transition. An edited piece must be long enough to contain
its retained overlap; a cut inside that overlap is refused. A dormant transition
is removed if a leading gap would otherwise activate it. All unaffected timing
and transition settings are retained. No plugin transition code is executed.

The host validates every original and new clip. Changed source records, new
pieces/gaps, transition updates, reordered originals and collateral timing changes
count toward the 64-affected-clip limit. Index shifts caused only by inserting
pieces/gaps do not make an otherwise unchanged later clip an edit. Locked main
tracks, affected linked clips or motion-pin dependencies reject the entire batch.
No implicit partner, ripple, source extension or arbitrary patch operation exists.

Implementation steps:

1. Add strict canonical operations, the separate permission, consent labels and
   SDK types, retaining existing permission boundaries.
2. Plan range slices privately, allocating collision-checked host IDs. Preserve
   clock, gaps, fades and animation semantics; validate all neighbor times.
3. Reuse native single-use authorization, pure prepared reducer actions,
   immutable receipts, results and one-step Undo across every invocation surface.
4. Verify ordered/mixed batches, transitions, speed, fades, gaps, hidden clips,
   dependencies, scope, limits, cancellation and replay in focused tests.
5. Compile a typed author fixture and execute real split/trim transactions,
   preview/export and Undo in hidden Electron without foreground windows.

SDK 0.7.0 adds [explicit linked pair editing](plugin-linked-edits.md) under
`clips.linked`. Ripple editing remains a later stage. No installer,
publication, commit or push is part of this work.

Validation outcome on macOS: 49 range contract checks and
23 native staging/permission checks passed. The typed SDK-built package
passed 39 hidden real-app checks through Settings, the Plugins menu, a panel
and CraftAI. These cover ordered split/trim, mixed free edits, explicit overlap
handling, gaps, locks, links, refusal, stale edits, Stop, revocation and one-step
Undo/Redo. Preview and export agree on retained source footage, internal trim
gaps and a trailing black interval. The trailing-gap export retained exactly
12.75 seconds. Window show events: 0.

All 20 focused plugin/state suites passed; clean SDK distribution and authoring
passed 36 checks. Existing main reorder and free-edit hidden regressions passed
32 and 25 checks, also with no shown windows. Renderer compilation, structure
and whitespace checks passed. Native consent answers are scripted fixtures.
Full-battery, packaged-runtime and other-platform checks remain outstanding.
[Retained evidence](plugin-validation.json) includes results and paths.
No installer, publication, commit or push was made.
