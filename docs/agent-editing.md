# Agent editing and analysis

CraftAI reads live project structure, analyses the selected audible sources, and inspects actual video samples before making content-based edits. Analysis data is separate from timeline history.

## Timeline edits

Agent `cut_range`, `keep_ranges`, and `remove_silences` use one timeline time map. Captions, overlays, audio, effects, and markers follow removed intervals. Detached picture/audio pairs are sliced together with distinct IDs and links. An affected locked layer blocks the whole range operation.

Agent speed changes use a piecewise timeline clock: captions/words, effects and markers retime; crossing media split into source-continuous pieces with adjusted rates; detached links and transitions follow the same clock. A boundary through an unrepresentable processed-audio, continuous-preset or fade envelope, or a required rate outside the supported range, fails before mutation. Ordinary manual speed controls retain their existing behavior.

Range endpoints align to output frames; the rounded end reported by the project reader remains usable on sped-up clips. Transition overlaps retain the exact remaining timeline overlap through preview, frame inspection, and export. Normal manual transition duration changes clear that derived overlap.

Failed operations retain distinct IDs. An unchanged retry can resolve its own failure; corrected parameters use `retry_of`. An unrelated successful call cannot hide an earlier failure.

Tools report `applied`, `unchanged`, or `blocked` from the resulting project and check requested fields, additions, deletions, and range duration. A model decision or asynchronous result cannot apply after an external document edit revokes the request. All owned edits form one Undo checkpoint even at history capacity. An old chat Undo button is hidden after newer document edits.

`get_project` distinguishes main-track export duration from total timeline extent. It exposes layers, locks/visibility/mute/solo, links, markers, source ranges, effects, and animation data. Use `clip_ids` or `details:true` for exact clip fields; keyframe `t` values are source seconds, while editing tools accept timeline seconds. Live playhead/selection are returned even for an unchanged document revision. Library insertion accepts exact `media_id`; ambiguous names are rejected.

## Speech and silence

Silence analysis defaults to the audible full mix, including detached and overlay audio. `source` can select `all`, `video`, `overlay`, or `audio`; `clip_ids` isolates particular sources without changing their absolute placement. A source with no audible clips fails rather than treating synthetic silence as removable footage. Background music can mask pauses, so select speech clips when that is the intended analysis.

Transcription supports local or configured cloud engines, source selection, time bounds, search, and pagination. Word timings and their measured/estimated provenance survive retrieval and caption generation. Caption regrouping uses supplied word boundaries; inferred boundaries are labelled estimated. Creating captions reuses the transcript rather than running inference again.

A bounded local cache fingerprints audible edits, source files, and engine options. Title, crop, and color changes reuse speech work. Audio edits or replaced files invalidate it. Stop cancels decoding, inference, downloads, and cloud requests; incomplete results are not cached as success.

## Scenes and storyboard

1. Load the media tools and call `analyze_scenes`. Source shot IDs are cached by file fingerprint and detector options; timeline occurrences are projected fresh through trims, speed, transitions, and overlay layers.
2. Call `get_storyboard` or `inspect_frames`. `source:'media'` uses `media_id` and explicit `source_times_sec` to inspect library footage before insertion. `source:'clip'` shows raw footage at timeline times; `source:'timeline'` shows the composition.
3. Inspect the attached images before calling `annotate_scene`. Observations require raw frames from the same shot and file, presented to the configured model in the current request. Stored provenance includes sample times, image hashes, source fingerprint, and provider/model.
4. Search observed descriptions/tags or current transcript/caption excerpts with `analyze_scenes({query:...})`. Use the returned live clip IDs and timeline ranges for edits.

The detector finds visual shot candidates, not semantic events. Long shots have paged interval samples. Still frames cannot establish continuous motion or audio, and layer eligibility alone does not prove visibility through an overlay or mask.

## Image context and completion checks

At most six bounded JPEG frames are attached to a model step. Tool results and saved conversation contain handles and metadata, never image base64. Codex uses local image files; other adapters use transient typed image inputs, including Claude Agent SDK. Models without vision must surface an error; fallback preserves image evidence.

After visual edits, completion requires structural validation and current-revision composed samples sent through another model step. Failed mutations or failed captures cannot become a successful final claim. Sampling is evidence about the selected moments, not continuous playback validation.

## Verification

Regression suites cover range identity/link safety, mutation contracts, audible-source analysis, transcript reuse/timing, scene mapping/cache/evidence, and every image transport. Isolated Electron smoke modes `agent-editing`, `agent-audio`, and `agent-scenes` drive the real chat/UI/IPC and FFmpeg. Speech inference is injected in the audio smoke; `agent-vision` also supports a bounded live Codex check using `FVE_CODEX_VISION_LIVE=1`.

No installer is required for these checks. Pushes require an explicit user instruction as stated in `AGENTS.md`.
