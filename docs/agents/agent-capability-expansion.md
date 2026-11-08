# Everyday agent editing capabilities

Implemented and verified against the full accepted capability report, including
the stale tool-discovery bug. Review follows the user's later constraint: local
rendering/measurements and the existing agent's image context, with no added
review service or video-upload API.

## Completion checklist

- [x] Remove the retired style group from tool-discovery copy.
- [x] Everyday controls: reverse/restore, freeze, split across tracks, free-track
  speed, layer assignment/create/reorder/delete/state, link/unlink. Use existing
  reducer validation, lock protection, ownership, and request cancellation.
- [x] Audio finishing: agent access to existing noise reduction, compression,
  limiter, EQ and loudness controls; source-time volume automation; speech-driven
  ducking. Preview, export and audio-analysis timing/gain must agree.
- [x] Subject following: agent-selected source point after actual frame
  inspection; request-owned tracking and automatic portrait reframe; expose low
  confidence and preserve source-time paths through trims/speed.
- [x] Caption repairs: explicit per-word timeline timestamps with honest timing
  provenance, word-safe caption split/merge, subtitle import/export.
- [x] Local source ingestion: bounded file/folder media import with useful
  errors, cancellation, source probing and stable library IDs.
- [x] Export completion: explicit export options/destination, awaited result,
  cancellation, actual output path/metadata, and post-render inspection.
- [x] Rendered-section review: actual encoded audiovisual excerpt, motion and
  audio diagnostics, review evidence available through both agent transports,
  and truthful capability/status reporting. The user explicitly ruled out any
  added third-party review service or video-upload API. Review must use local
  encoded media diagnostics, existing frame inspection and timeline/audio data.
  Report limitations honestly: no claim to hear/understand continuous footage
  from image attachments. No separate audiovisual model API is authorized.

## Implementation ownership

- `src/features/agent/editingTools.js` extends guarded renderer tools; the shared
  catalog registers the same controls for API and native SDK agents.
- `electron/agents/editorMedia.cjs` provides request-owned reverse, frame and
  tracking jobs using existing engines. `agent:mediaJob` uses `withAgentJob`.
- `src/features/agent/tools.js` owns structural preflight, mutation results,
  stale-result rejection, media insertion, and tool registration.
- Existing manual UI behavior and saved project compatibility must remain.
  Layer guard/visibility toggles retain the manual UI's non-Undo semantics;
  actual clip changes participate in the agent transaction.
- Keep new renderer capabilities in feature modules rather than growing the
  central tool runner indefinitely. Privileged file/process work stays in
  Electron. No new runtime dependency is required for the first phase.

## Evidence so far

Everyday controls are implemented and verified through API, native Codex and
native Claude transports in the isolated Electron app. The model transports are
fixtures; media processing, guarded editor writes, preview images, completion
validation, cancellation and Undo are real. Evidence:
`/var/folders/_j/d8w7d_sn23348hmv9trrjm480000gn/T/clipcraft-agent-capabilities-ui-aEnl7J/result.json`.

`tests/unit/agents/test-editing-capabilities.mjs` covers layers, caption-aware
splits, free and linked speed, reverse/restore, and frame holds. Frame holds keep
the existing time interval and preserve the original audio; transition overlaps
remain exact. `test-agent-media-jobs.cjs` verifies actual reverse picture/audio,
frame extraction/cache and motion processing. The existing agent-tools, timeline
and native suites pass alongside them. Source-range reverse retains the existing
engine's 20-second bound; linked pairs must be unlinked before reversal/holds.

Local source/subtitle I/O and caption repair now pass their host/renderer suites
and the isolated API/Codex/Claude app check:
`/var/folders/_j/d8w7d_sn23348hmv9trrjm480000gn/T/clipcraft-agent-capabilities-ui-W6JPBV/result.json`.

Audio finishing is implemented in `audioTools.js`: existing audio effects,
source-time `volumeKeys`, and local activity-driven ducking of explicitly
selected sources. Preview gains, all export paths and analysis include the
envelope; reverse slices/mirrors its source window and freeze preserves sound.
Actual rendered audio and split/speed checks pass in `test-audio-finishing.mjs`;
the app transport check passes at
`/var/folders/_j/d8w7d_sn23348hmv9trrjm480000gn/T/clipcraft-agent-capabilities-ui-SwACeQ/result.json`.
Existing effects remain export/analysis-only and tools say so. A mono-input
loudnorm layout negotiation bug was reproduced and fixed. Late-result ownership,
Stop and manual-edit interruption are covered by `test-agent-job-ownership.mjs`.

Subject following is implemented in `trackingTools.js`. The host requires a raw
starting frame actually presented in this request and matching the source
fingerprint. Tracking reports time-weighted confidence, refuses weak paths by
default, and creates smoothed, source-time fill/pan keys. Pins now map the source
point through its crop/mirror/live transform before computing follower motion.
`test-subject-following.mjs` measures actual encoded portrait subject positions;
the app/API/Codex/Claude check passes at
`/var/folders/_j/d8w7d_sn23348hmv9trrjm480000gn/T/clipcraft-agent-capabilities-ui-FiXanU/result.json`.
Late tracking results are rejected after Stop, lost ownership or manual edits.

Exports now use the existing UI/ETA/render pipeline, await completion, return
actual measured file metadata and inspect the delivered file locally. The local
inspection covers the first 30 seconds and explicitly reports partial coverage
for longer files. A user cancellation ends API/native turns cleanly, without
retrying or publishing partial output. Default destinations are unique; explicit
overwrite is required and exclusive publication also protects against races.

`review_section` renders a bounded section to the application cache and exposes
a playable preview, numerical signals and sampled encoded images through the
existing API/native image paths. Signals include adjacent-frame changes,
black/still/timestamp candidates and stereo audio levels/clipping/silence.
Stereo energy is measured without mono phase cancellation. Embedded cover images
are excluded from video selection. Candidates may be intentional; no model is
claimed to have heard audio or understood every moment. Cached previews are
bounded and no project/export preference changes are made by review.

Integration checks exposed and fixed a real final-frame loss after trimmed
animated overlays and FPS conversion. Timed layers no longer terminate their
base; normal export follows the same exact frame grid as raw rendering. HDR
source inspection and frame holds now use the existing SDR conversion, with a
new derivative cache identity to avoid reusing older unconverted stills.

## Completion audit

Authoritative final app evidence:
`/var/folders/_j/d8w7d_sn23348hmv9trrjm480000gn/T/clipcraft-agent-capabilities-ui-pAHfvl/result.json`.
The isolated Electron check passes through API, Codex and Claude transports,
including playable section previews, actual encoded-image delivery, completed
file inspection, Undo, forged-evidence rejection and cancellation of encoding,
local review and media processing. Model responses are deterministic fixtures;
editor writes, FFmpeg processing, decoding, image transport and playback are real.
The preview layout was also visually inspected.

| Requirement | Focused evidence |
| --- | --- |
| Discovery + everyday editing/layers/links | `test-agent-tools.mjs`, `test-agent-context.mjs`, `test-editing-capabilities.mjs`, app check |
| Audio effects, volume automation and ducking | `test-audio-finishing.mjs`, `test-agent-audio.mjs`, `test-audiofx.cjs`, `test-editing-envelopes.mjs`, app check |
| Subject following, reframe, confidence and pins | `test-subject-following.mjs` measures actual encoded portrait target positions; app check validates inspected-frame provenance |
| Caption repair, split/merge and SRT | `test-caption-file-tools.mjs`, `test-agent-file-jobs.cjs`, app check with exact real SRT roundtrip |
| Local ingestion, library IDs, file/folder paging | `test-agent-file-jobs.cjs`, `test-caption-file-tools.mjs`, app check with real probing |
| Awaited configurable export + actual output | `test-agent-export.mjs`, `test-rendered-review.mjs`, app check with real files, frame counts and metadata |
| Local rendered review and truthful limits | `test-rendered-review.mjs` uses actual audio/video, cover/partial/stereo cases; API/native image handoff and player checked in app |
| Cancellation, ownership and Undo | `test-agent-job-ownership.mjs`, export loop cancellation tests, actual Stop/Cancel/Undo app checks |

The consolidated local evidence index is
`/tmp/clipcraft-agent-expansion-completion-audit.json`. It records the latest
passing result for each relevant regression suite, the final UI result, renderer
build and module-structure check. Two older tests were updated to follow the
current API/native transport split; the HTTP fallback fixture was rechecked
outside the sandbox because binding its local port was denied inside it.
These are targeted regression results, not a claim that the entire repository's
test battery or live model reasoning was exercised. No installer or push was run.

## Verification gates

For each capability: deterministic timing/validation tests; real local media
processing where applicable; isolated Electron UI plus API/native tool delivery;
cancel/stale/manual-edit interruption; meaningful export or rendered output
inspection. Keep output evidence in temporary smoke directories. Re-read result
files before reporting figures. Run the module-structure check and renderer
build. No installer packaging or Git push is authorized by this task.
