# Editorial agent

CraftAI edits like an editor, not only like a tool runner: it logs the footage,
decides the story, proposes a plan, executes in a sensible order and critiques
its own result before finishing. The editing tools stay the same guarded
reducer actions as before, so every request remains one Undo step.

## Workflow

For a full edit, restructure, new short or "make it better" request the system
prompt directs the agent to:

1. Load the **editorial** tool group and read `edit_guide` (`workflow` plus the
   matching genre: `tiktok`, `youtube`, `podcast`, `tutorial`, `vlog`, `ad`,
   and `principles`).
2. Call `log_footage`: one cached transcription split into timed sentences,
   linked to visual shots, with filler, false-start and hook-candidate flags.
3. Decide the story and call `propose_edit_plan`. The chat shows an **Edit
   plan** card (goal, hook, timed story, cuts, visuals, audio, captions,
   questions) with **Approve plan** and **Change…**. The agent ends its turn and
   waits. Small, specific requests and already-approved plans skip this step.
4. Execute in order: format → `remove_retakes` (dry run first) →
   `remove_fillers` → `remove_silences` → story cuts → speed/zooms → b-roll →
   captions → titles → music (`get_beats` for music-driven cuts) → audio
   finishing and ducking.
5. Call `critique_edit`, fix high/medium issues (or explain why they are
   intentional), inspect frames, then finish.

Approving sends a normal chat message ("Approved. Carry out this edit plan…"),
so the queue, history and Undo behave as for any other request. Change… fills
the composer with "Change the plan: ". Only the latest reply's plan is
actionable, and only when nothing is running or queued.

## Tools

| Tool | Group | Edits | What it does |
| --- | --- | --- | --- |
| `edit_guide` | editorial | no | Workflow and genre recipes (`editGuide.js`). |
| `log_footage` | editorial | no | Sentences, shots, fillers, retakes, hook candidates, words per minute. |
| `remove_fillers` | editorial | yes | Cuts hesitations on word boundaries; `discourse` also removes "you know", "يعني"… |
| `remove_retakes` | editorial | yes | Removes false starts, restart cues and stutters; keeps the later take. |
| `find_highlights` | editorial | no | Ranks hook/short candidates; `clip_length_sec` returns ready `keep_ranges` windows. |
| `propose_edit_plan` | editorial | no | Shows the plan card and waits for approval. |
| `critique_edit` | editorial | no | Score 0–100 and issues with time and fix. |
| `get_beats` | audio | no | BPM, beats, estimated downbeats and accents in timeline seconds. |

### Transcript-driven cuts

Whisper's word times drift by roughly ±0.3 s between runs, so a cut placed
from the transcript alone can clip the neighbouring word and leave the filler.
Cuts are therefore checked against the audio (`electron/audio/speechCuts.cjs`,
IPC `agent:refineCuts`) on the speech tracks only (main/overlay clips and
generated narration; a music bed would fill the pauses):

- **Single-word fillers**: the short sounds between pauses within ±0.7 s of the
  transcript time are each recognized on their own (one batched whisper-cli
  run). Only a sound heard as a hesitation ("um", "uh", "ah", "امم"…) is cut,
  from inside the pause before it to inside the pause after it (biased late to
  include the decay). `[BLANK_AUDIO]` is not accepted as proof: Whisper also
  returns it for word fragments.
- **Retakes** (multi-word spans): each edge snaps to a real pause; the end edge
  takes the longest pause shortly before the redo, since a restart follows a
  noticeable pause.
- A span that cannot be confirmed — no pause around it, spoken together with a
  word, or not heard as a hesitation — is **skipped and reported** with its
  time and reason. Precision comes first: an unconfirmed filler stays.

Without the host (for example in unit tests) the tools fall back to transcript
boundaries and report `boundaries: "transcript"`.

All tracks ripple, as with `remove_silences`. After its own cuts the agent
remaps the transcript words through the cuts instead of transcribing again;
any other audible change invalidates them. After ripple cuts the original clip
IDs name only one piece of the split clip; `remove_silences` limits itself to
the selected clips, so a stale ID cannot remove the other pieces, but select
speech by track (`source`) to cover all of them.

Words with estimated timing are skipped unless `allow_estimated` is passed.
Default fillers are hesitation sounds only. Ambiguous words are excluded on
purpose: Darija "آه"/"ايه" mean "yes", "ام" means "mother", and Spanish "em"
is a Portuguese word, so auto-detected speech uses the unambiguous English,
French and Arabic lists. Discourse markers need `discourse: true`.

Retakes are detected three ways: a repeated three-word run within a few
seconds ("the best way is — the best way is to cut"), a sentence redone by the
next one, and an explicit restart cue ("sorry, let me start again", "من جديد").
Stutters ("I I think") drop the first repeat. The model is told to dry-run and
apply only real retakes by ID.

### Verbatim speech and word timing

Whisper tends to clean hesitations out of transcripts. Editorial tools request
a **verbatim** local transcript: whisper-cli receives a disfluent initial
prompt that biases decoding toward keeping "um"/"uh". The option is part of the
transcript cache key only when set, so existing caption transcripts keep their
cache entries; captions continue to use the clean transcript. Cloud engines
ignore the option.

Whisper sometimes reports a zero-length token. The transcript reader now gives
only that word a short span and marks it `estimated`; the other words of the
segment keep their measured timing (previously the whole segment became
estimated, spreading every word by length).

### Critique

`critique_edit` (`editorial.js`) checks:

- uncovered black gaps on the main track (an empty stretch under a title or
  overlay is a title card, not a gap);
- pacing: the longest stretch without a cut, zoom, overlay, title or effect
  (more than 6 s on vertical video, 12 s otherwise);
- the hook: something must change in the first 3 seconds;
- remaining fillers, retakes, late first words and pauses over 2 s (when a
  transcript for the current audio is known; `speech: "transcribe"` refreshes it);
- caption reading speed (over 22 characters/s), overlaps and safe area;
- title reading time and safe area;
- music above 40 % under speech without ducking;
- integrated loudness (−18 to −10 LUFS accepted) and true peak above −1 dBTP,
  measured with FFmpeg `ebur128` on the rendered analysis mix;
- long or overused transitions, and the target duration.

### Completion gate

Both the API loop and native `complete_edit` run one editorial pass before
finishing. Only structural issues **introduced by this request** count (gaps,
caption speed/safe area/overlap, title readability, music level, hook,
transition length; high or medium severity). The agent is asked once to fix
them or to explain why they are intentional; the next completion on the same
revision proceeds. Pre-existing problems and speech issues never widen the
user's requested scope.

A native turn that changed nothing — an answer or a proposed plan — no longer
needs `complete_edit`; any edit still requires a current, successful
completion.

### Beat grid

`electron/audio/rhythm.cjs` renders the selected sources (absolute placement
kept), decodes 11 kHz mono, computes a log-spectral-flux onset envelope,
estimates tempo by autocorrelation (biased toward common tempos), and places
beats with dynamic programming. Downbeats are the strongest 4-beat phase and
are labelled estimated. Calibration on synthetic click tracks: mean beat error
under 3 ms, worst under 10 ms. Call it before ripple cuts that slice the music.

## Verification

- `tests/unit/agents/test-editorial.mjs` — fillers (including the Arabic
  exclusions), retakes, word-boundary cuts, remapping, hooks, all tools against
  the real reducer, plan sanitizing, critique, the completion gate inputs,
  verbatim requests and cache keys, evaluation scoring.
- `tests/unit/audio/test-speech-cuts.cjs` — drifted transcript times still cut
  the verified filler; unconfirmed and glued fillers are skipped; no cut on
  timing alone; real FFmpeg decode.
- `tests/unit/agents/test-silence-scope.mjs` — `remove_silences` never cuts
  outside the selected audible clips (split pieces, photos, silent b-roll,
  narration-only selections); real FFmpeg.
- `tests/unit/audio/test-whisper-words.cjs` — zero-length tokens repaired per
  word, using a token pattern from a real whisper-cli run.
- `tests/unit/audio/test-rhythm.cjs` — tempo and beat alignment at 90/120/140
  BPM, downbeats, refusal of silence, the real FFmpeg decode and `ebur128` path,
  abort.
- `tests/unit/agents/test-agent-editorial-ui.cjs` — the real app: plan card,
  approval as the next message, footage log, retake/filler/silence cuts, beat
  grid on a 120 BPM bed, real loudness, completion and one-step Undo. Model and
  speech recognizer are fixtures by default. With `FVE_EDITORIAL_MEDIA` (a
  speech video) and `FVE_WHISPER_MODEL` (a local `ggml-base.bin`) it runs real
  Whisper, re-transcribes the delivered edit and checks that no more fillers
  are heard and content words survive; with `FVE_EDITORIAL_TRUTH` (known word
  positions) it checks every cut against ground truth.

Measured on 2026-11-07 (macOS, whisper base):

| Sample | Fillers cut | Words damaged |
| --- | --- | --- |
| Ground truth: phrases spoken separately with known gaps, 5 fillers, plus a music bed | 5 / 5, each covering 100 % of the filler | 0 (0 ms overlap with any word) |
| Continuous synthetic voice, 5 fillers run into neighbouring words | 1 / 5 (4 skipped with reasons) | 0 |

The second row is the honest limit: when a hesitation is spoken together with
the next word there is no pause to cut at, and the tool leaves it.

Measure editorial quality with real models using the
[agent evaluation harness](agent-eval.md).
