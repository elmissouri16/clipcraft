# Long source clip discovery

CraftAI can index a library video, retrieve possible clips, review their context,
and show ranked preview cards before adding selected ranges to the timeline.
Import the video into the library and ask, for example:

> Find five promising 20–45 second clips in this gameplay recording. Review the
> context, explain each choice, and show previews before adding anything.

The `discovery` group works through the shared API/native/external tool host.
The user's existing timeline does not need to contain the source.
Native coordinators can optionally use [analysis subagents](analysis-subagents.md)
to inspect separate source ranges and compare candidates before reviewing finalists.
The shared invariants are documented in [source analysis contracts](source-analysis-contract.md).

| Tool | Behavior |
| --- | --- |
| `get_video_analysis` | Read cached source capabilities, reusable index IDs, languages and missing evidence before processing more footage. |
| `index_video` | Resumable source indexing with local visual/audio measurements and optional local speech. |
| `read_video_transcript` | Page timestamped original dialogue, separately from timeline audio, generated narration and captions. |
| `find_video_moments` | Paged signal candidates, literal transcript search and quiet exploration samples. |
| `review_video_moment` | A local playable excerpt, transcript context, measurements and ordered source images for the agent. |
| `propose_video_clips` | Up to six reviewed picks in best-first order, with reasons, source times and agent confidence. |
| `add_video_clip` | Append a requested saved pick using its exact source range, with normal ownership checks and Undo. |

## Indexing and source time

The index is independent of the edit and lives under `source-index` in user data.
Index IDs remain compatible with earlier files: each ID identifies a configured
view of the source fingerprint, version, language, speech request and chunk size.
`sourceEvidence.cjs` pools validated evidence across compatible views. Changing
speech mode or chunk size does not hide existing dialogue or repeat completed
processing. `auto` selects one coherent cached language; an explicit language
never silently uses another. Visual measurements can be shared across languages.
Only missing intervals are processed. Replacing the source invalidates all views,
reviews and saved picks. Reads do not rewrite existing cache files.

Results separate visual coverage from speech-processing coverage, recognized text,
missing ranges and warnings. `complete` means the view's requested capabilities
are complete; `visual_complete` alone does not establish dialogue understanding.
Speech-disabled calls skip new recognition, never discard known transcript.
`get_video_analysis` discovers this state without running processing. Original
dialogue remains accessible after editing, muting source audio or adding narration.

Defaults are 120-second chunks and eight missing chunks per tool call. Repeat
with the same options until `complete` is true. `max_chunks` may be 1–32 and
`chunk_sec` 10–300. These bounds limit individual jobs; they do not cap source
duration. Results report coverage, indexed seconds and missing ranges. A source
that is only partly indexed must never be described as fully reviewed.

FFmpeg streams low-resolution visual samples and stereo audio measurements;
it does not retain decoded source video in RAM. A small overlap preserves cuts
at chunk boundaries. Speech uses the existing local caption engine with context
on both sides of chunk boundaries. Word midpoint ownership avoids storing the
same overlapping words twice. Missing speech, processed recognition with no text,
and a source with no audio have distinct states. Empty recognition does not prove
silence. Engine errors remain failures but preserve independent visual work for
retry. Malformed cached measurements and transcript timings are not counted as
valid capability coverage. Word-timed overlaps are deduplicated by ownership;
untimed crossing sentences retain an explicit timing-uncertainty warning.

All discovery times are **source seconds**. Existing timeline tools take timeline
seconds. `add_video_clip` checks the saved fingerprint and inserts only the
selected range, rather than inserting the entire recording and cutting it down.
It appends to the existing main track and preserves the canvas.

## What selection means

Local candidate signals include visual changes, shot boundaries, relative audio
energy/rises and speech passages. Stream/gameplay/talk profiles change retrieval
priorities. Quiet chronological exploration is returned separately to avoid
only looking at loud or fast passages. `query` searches transcript text
literally; it is not an embedding-based video search.

The agent must inspect the actual returned images and transcript, compare
candidates with the user's intent, preserve setup and payoff, refine boundaries
and provide its reasoning. Proposals require source evidence actually presented
in the current request, covering the beginning, middle and end of every clip.
Substantially overlapping picks are refused. After exploring many candidates,
re-review the finalists before proposing, because the existing bounded frame
store expires old handles.

Previews are encoded locally at reduced resolution and cached. They are for
human playback. The agent receives sampled stills, text and numerical signals,
not continuous audiovisual perception. High motion/audio energy does not prove
a game event, laughter, emotion, narrative importance or clip quality. Agent
confidence is an editorial judgment, not a measured probability. Brief actions
can be missed between samples; inspect additional raw frames when necessary.
Preview/review windows are limited to 90 seconds.

These tools provide the discovery workflow and evidence for the configured
agent to make editorial choices. Quality on arbitrary movies or games still
needs evaluation with representative real footage. They do not promise the
objectively best scenes or establish multi-hour 4K throughput.

## Validation

- `test-source-discovery.mjs`: real FFmpeg decoding/preview output, source-time
  speech mapping, restart/resume, Stop, cache repair, exact-boundary cuts,
  stereo phase handling, footage beyond 30 minutes, unscanned gaps, evidence
  ownership, source replacement, range insertion and Undo.
- `test-source-evidence.mjs`: cross-view reuse, missing-interval processing,
  language separation, independent capability repair, transcript paging, corrupt
  data, scoped text, overlap ownership and source invalidation; no UI or model.
- `test-source-discovery-ui.cjs`: isolated real Electron UI with API, Codex and
  Claude model fixtures; actual source processing, image delivery, preview
  playback, suggestion cards, Add to timeline, Undo and Stop/resume are real.
- Optional `SOURCE_DISCOVERY_WHISPER_MODEL=/absolute/path/ggml-base.bin` also
  exercises the actual local speech engine on original synthesized speech on
  macOS, using a temporary model link and the installed Whisper CLI.

The model transports in deterministic smoke checks are scripted. Passing them
proves plumbing and editor behavior, not autonomous highlight-selection quality.
