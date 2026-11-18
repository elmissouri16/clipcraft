# Explicit linked main-track reordering

This pre-v1 extension keeps SDK 0.8.0, host API 1 and application 2.0.0.
A command needs `editor.read`, `timeline.reorder` **and** `clips.links`.
Neither sequencing nor pair management alone authorizes this operation.
`clips.linked` continues to authorize split/trim, not reordering.

```ts
{
  type: 'reorder-linked',
  clipId, partnerClipId,
  beforeClipId, // returned main handle; null appends
  companions: [{clipId: otherPicture, partnerClipId: otherSound}],
  gaps: 'preserve',
  transitions: 'reject' // or 'clear-boundaries'
}
```

The source must be one complete main-picture/audio pair. Either member can
initiate. The anchor is always a different returned main clip or gap handle.
Overlay pairs cannot be reordered on the main track. All handles belong to the
captured document/revision; raw IDs, new link IDs and arbitrary fields reject.

`companions` explicitly allows other complete main-picture/audio pairs to be
retimed or have their transition boundary changed by this operation. It is
required even when empty. Every affected linked main pair must be the source
or an explicit companion, including neighbours outside the bounded snapshot.
An omitted or incomplete pair rejects the entire transaction. Extra declared
pairs are checked for valid topology, timing, source bounds and partner locks,
but remain unchanged unless the permutation actually affects them.

The host removes the source picture and inserts it before the anchor, or at the
end. Existing gaps keep their IDs, lengths and relative order; there is no gap
merging, creation, overwrite or implicit normalization. Main clips follow the
resulting sequence. Only the explicitly named affected audio partners follow
their pictures, keeping their stored timeline offsets, source windows, speed,
source offsets, keyframes, fades and other fields. Partners stay on their layers.
Unrelated free tracks and markers retain absolute timing: this is not ripple.

Transition handling matches ordinary main reordering. After each operation,
`reject` refuses a changed predecessor boundary carrying an incoming transition,
including a dormant first-clip transition. `clear-boundaries` explicitly removes
those records and preserves all others. Clearing overlaps can lengthen the main
clock and retime linked neighbours beyond the immediate insertion span; those
pairs still need explicit companion declarations.

Moved audio must stay nonnegative and within the greater of the original
project duration and the explicitly resulting main clock. Its stored offset
cannot create an additional project extension beyond that bound. Other free
writes retain their original captured-duration limit; clearing an overlap does
not grant them extension rights. New collisions, source violations, invalid
speed/offsets, missing/ambiguous groups, locks and motion-pin dependencies reject
without partial changes or automatic relayering.

Ordinary `reorder` continues to reject a linked source. Prior explicit linked
reordering never gives a subsequent ordinary reorder permission to retime its
approved pairs. Existing ordinary atomic permutations around a linked neighbour
whose final record and timing stay unchanged remain supported. Each explicit
linked operation revalidates its own companion allowlist; an earlier declaration
is not blanket authority for later operations. Newly split pairs cannot become
unnamed collateral before their new handles are obtained on another read.

Limits and commit semantics:

- At most 31 companion pairs per operation, with no duplicate source/companion
  handles or repeated pairs, even if the handle order is reversed.
- The batch has a combined budget of 64 operations plus companion declarations.
  All changed main records (including gaps) and changed audio partners also
  share the existing 64-affected-clip limit.
- The private host planner scans the whole project and builds complete clip
  arrays. Preserved-link tokens prevent ordinary link synchronization from
  silently repairing source windows or moving unnamed partners.
- Native per-run consent names both existing capabilities. Package verification,
  single-use commit grants, owner/revision guards and actual receipts use the
  normal command path. A successful batch has one Undo step; no-ops have none.
- Settings, registered menus, allowlisted panel commands and CraftAI use the
  same operation. Stop, refusal, failure, stale edits or revocation discard
  staging before commit. No direct panel write API is introduced.

The SDK remains an unpublished development package. Older host builds can reject
this operation even if their SDK/API version numbers match; the pre-v1 capability
and release compatibility policy remains a separate required gate.

Verification and retained measurements are recorded below.
No installer, SDK publication, version increment, commit or push is part of this work.

## Verification outcome

On macOS arm64, the new contract suite passed 71 checks, including an
independent oracle covering 324 two-step permutations (233 accepted,
91 rejected). It checks exact project/source state, affected counts,
companion omissions, permission combinations, resource limits, locks, hidden
neighbours, collisions, transition policies, motion pins, no-ops and Undo.
The native transaction suite passed 56 checks; SDK helper checks passed
39, with public positive/negative TypeScript and clean authoring tests
also included in the 61/61 passing selected regression suites.

The expanded SDK-built main/linked reorder workflow passed 61 hidden real-app
checks through Settings, registered menus, a panel and CraftAI. Native approval
choices are scripted. Refusal, failure, stale revisions, Stop, partner locks and
revocation preserved edit state. A native save and fresh Electron process passed
11 further checks, including exact saved-project comparison and no replay
of the edit while the package remained disabled. Both phases showed zero test
windows and recorded zero renderer errors.

Preview and real exports retained the moving source frames. The maximum sampled
export/source mean absolute channel error was
2.880787 against a threshold of 12, and the explicit resulting clock was
7 seconds after clearing the changed overlap. The three exported tones identified
the source and both companions at their new stored offsets (770/330/550 Hz,
within the 20 Hz measurement tolerance). Active RMS exceeded .01; sampled
pre-onset and internal-gap RMS were below .002. Restart exports reproduced these
measurements. Frame comparisons precede the unrelated title, which remains at
its original absolute time. No image or audio threshold was relaxed.

SDK/renderer builds, structure and whitespace checks passed. All package and
lockfile version files were verified byte-for-byte unchanged. One standalone
unit suite was added; the repository now discovers 287 suites. That count
change does not represent a full-battery run: the previous release-gate failures,
installed/ASAR execution, physical native interaction and Windows/Linux acceptance
remain open. Documentation, SDK declaration comments and three added unit cases followed
the selected regression run. The strengthened contract suite passed separately,
covering shared audio-layer placement, offset collisions and mixed linked/free
Undo. Executable code and type shapes stayed unchanged.

The `linkedReorder` entry in [validation](plugin-validation.json) retains individual
suite outcomes, source hashes, build logs, app checks, exports and restart results.
No installer, SDK publication, version bump, commit or push was made.
