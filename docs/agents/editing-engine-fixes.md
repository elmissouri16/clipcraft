# Editing engine fixes

Requested scope: revalidate, fix and test every finding from the editing-engine audit.
Keep changes local; do not push or package an installer.

## TODO

- [x] Animated opacity: reproduce invisible exports, fix the animation path, compare exported pixels with preview opacity.
- [x] Linked duplication: duplicate picture/audio as a fresh pair; preflight reducer mutations and reject newly invalid results before writing.
- [x] Audio split: preserve the original fade envelope without introducing fades at the cut; verify exported audio.
- [x] Export bounds: prevent successful completion for newly truncated content; make insertions intentionally cover the output timeline.
- [x] Transition timing: coordinate free-track timing with changed main-track overlap and return the applied time map.
- [x] Caption timing: maintain valid word timestamps across trims and wording changes; validate caption timing integrity.
- [x] Visual verification: retain checked coverage when visuals are unchanged; ignore unused media and audio-only edits.
- [x] Overlay tools: expose volume, fades, filters and effects consistently for supported overlay media.
- [x] Run focused regressions, broader tests, renderer build and isolated real-app editing/export checks.

## Evidence

Initial read-only reproductions are in `/tmp/clipcraft-edit-audit-evidence.json`,
`/tmp/clipcraft-opacity-audit.json` and `/tmp/clipcraft-audio-split-audit.json`.
Final consolidated evidence: `/tmp/clipcraft-editing-fixes-evidence.json`.

## Resulting behavior

- The bundled FFmpeg reports `Function not implemented` for runtime alpha
  commands. Animated opacity now evaluates alpha on each frame, multiplying the
  existing source alpha. The curve is cached per row to avoid evaluating every
  curve segment on every pixel. Fade-in/out and partial source alpha are measured
  in rendered exports.
- Duplicating either member of a detached pair copies both clips with a fresh
  link and aligned offsets. Locked partner layers reject the operation. Undo
  restores both members together. Tool dispatch simulates the actual reducer
  and checks for newly introduced structural issues before writing.
- Split fade envelopes use optional `fadeInOffset`/`fadeOutOffset` fields in
  timeline seconds. These preserve the original ramp, including a split inside
  a fade. Preview, export, analysis audio and analysis fingerprints include the
  offsets. Editing a fade explicitly resets its offset.
- Agent insertions/moves that extend free-track content create a background
  coverage tail on the main track. It follows the final content end, including
  a subsequent trim after importing a long file. User-authored gaps remain
  distinct. Newly introduced export overruns are structural errors, rather
  than warnings that completion can silently accept. A locked main track
  prevents an insertion requiring additional coverage.
- Agent transitions preserve every speech source sample by compressing or
  expanding the free-track clock between the preceding scene's start and the
  old incoming-scene anchor, then shifting downstream cues together. This can
  change narration playback speed in that interval. Captions, word timestamps,
  overlays, effects and markers share the same map. Detached main audio follows
  its picture instead. Removing a transition (`type: "none"`) applies the inverse
  map. Unsupported playback rates, locked affected layers, and unrepresentable
  processed-audio/continuous-animation boundaries fail with an explicit error.
- Caption trims crop/rebase word timings. Text replacements invalidate prior
  word timing; duration stretches mark recalculated timing as estimated. Invalid
  ranges/order block new edits. Legacy human-corrected wording is retained with
  an alignment warning rather than discarded on load or unrelated edits.
- Both agent loops preserve coverage for unchanged visual intervals. Unused
  library media and audio-only edits do not trigger new composition captures;
  changes to a source actually used on the timeline still invalidate coverage.
- Volume, fades, filters and effects support overlay media, and project reads
  expose the corresponding sound settings and fade offsets.

## Verification

| Requirement | Persistent regression / actual-app evidence |
| --- | --- |
| Opacity export parity | `tests/unit/effects/test-anim.cjs`, `tests/unit/export/test-editing-envelopes.mjs`; real UI animation/export and decoded pixels |
| Detached duplication and locks | `tests/unit/agents/test-editing-engine.mjs`; real UI pair duplication and single Undo |
| Splits inside/outside fades | Same engine suite plus rendered before/after audio comparison in the envelope suite |
| No lost output-tail content | Engine/host completion regression; actual renderer text export and visible late-title pixels |
| Transition time map | Engine suite, existing speed-sync suite and real UI narration/caption clock check |
| Caption word timing | Engine suite and real UI measured-word trim |
| Efficient visual verification | Engine suite checks unused media, audio edits, changed sources and native-host capture reuse |
| Overlay tool coverage | Engine suite, real UI tool calls and exported overlay audio envelope |

Measured final results:

- Full battery: **95 PASS / 18 FAIL / 113 suites**. Results:
  `/var/folders/_j/d8w7d_sn23348hmv9trrjm480000gn/T/clipcraft-tests-KVLU8y/results.json`.
- Final focused follow-up after the last renderer changes: **7 PASS / 0 FAIL**.
  `/var/folders/_j/d8w7d_sn23348hmv9trrjm480000gn/T/clipcraft-tests-GIqo4d/results.json`.
- Isolated Electron editor smoke: **25 checks passed**, no renderer exceptions.
  `/tmp/clipcraft-editing-engine-ui-final/result.json`; `opacity-ui-export.mp4`
  and `ui-export.mp4` contain the measured opacity and late-title results.
- Native Codex protocol fixture through real Electron: **7 checks passed**,
  including completion, conversation reuse, Undo and cancellation.
  `/tmp/clipcraft-editing-native-ui/result.json`.
- Renderer compilation, structure check and whitespace check passed. No
  installer was packaged and nothing was pushed.

Compared with the prior recorded layout baseline, the existing animation export
suite changes from FAIL to PASS and both new suites pass. Seventeen failures
remain from that baseline. The additional failing prior suite is
`test-library.cjs`: live search no longer consistently returns both requested
upstream providers. Its online failure was reproduced separately and its offline
checks pass. Library integration source was not changed in this work.

The remaining battery failures include existing agent fixture expectations,
missing assets/fixtures, Windows paths, unavailable Electron paths in old export
tests, telemetry configuration, and unrelated audio/effect export assertions.
They are not all environment-only. This task does not claim a green full battery
or a repair of those unrelated failures. Live Codex/Claude model sessions were
not exercised; the shared native host and provider protocol fixtures were tested.
