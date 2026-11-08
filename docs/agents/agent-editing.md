# Agent editing and analysis

CraftAI reads live project structure, analyses the selected audible sources, and inspects actual video samples before making content-based edits. Analysis data is separate from timeline history.

## Attach timeline context to a question

Right-click a clip and choose **Add clip to CraftAI**. If that clip is already part of a multi-selection, **Add selected clips to CraftAI** attaches the whole selection across tracks. **Add clip time range to CraftAI** instead references everything overlapping that clip's interval.

For an arbitrary interval, Shift-drag on the timeline ruler, then choose **Add selected range to CraftAI**. The timeline's range-selection button enables the same gesture without Shift. Right-click the ruler or empty timeline space to select, attach, or clear a range. Selecting or attaching context does not move clips, seek, or send a message.

The chat composer shows up to four removable attachments. Click an attachment to seek to its start, then type the question and send. Each chat keeps its own pending attachments in the saved project. Selected clips follow their stable IDs to their current positions at send time; a time range keeps its absolute bounds. A deleted clip, foreign project reference, or range beyond a shortened timeline blocks sending until the attachment is removed or replaced.

Context includes the current revision, timeline bounds, overlapping clip IDs, layers, source-time mappings through trims/speed, text excerpts and effect references. Summaries are bounded and report omitted details. They contain no image bytes or media paths. The agent uses existing project, frame, scene and transcription tools when it needs more detail or visual/audio evidence. API providers and the native Codex/Claude loops receive the same reference data alongside the user's question.

## Timeline edits

Agent `cut_range`, `keep_ranges`, and `remove_silences` use one timeline time map. Captions, overlays, audio, effects, and markers follow removed intervals. Detached picture/audio pairs are sliced together with distinct IDs and links. An affected locked layer blocks the whole range operation.

Agent speed changes use a piecewise timeline clock: captions/words, effects and markers retime; crossing media split into source-continuous pieces with adjusted rates; detached links and transitions follow the same clock. A boundary through an unrepresentable processed-audio, continuous-preset or fade envelope, or a required rate outside the supported range, fails before mutation. Ordinary manual speed controls retain their existing behavior.

Range endpoints align to output frames; the rounded end reported by the project reader remains usable on sped-up clips. Transition overlaps retain the exact remaining timeline overlap through preview, frame inspection, and export. Normal manual transition duration changes clear that derived overlap.

Failed operations retain distinct IDs. An unchanged retry can resolve its own failure; corrected parameters use `retry_of`. An unrelated successful call cannot hide an earlier failure.

Tools report `applied`, `unchanged`, or `blocked` from the resulting project and check requested fields, additions, deletions, and range duration. A model decision or asynchronous result cannot apply after an external document edit revokes the request. All owned edits form one Undo checkpoint even at history capacity. An old chat Undo button is hidden after newer document edits.

`get_project` distinguishes main-track export duration from total timeline extent. It exposes layers, locks/visibility/mute/solo, links, markers, source ranges, effects, and animation data. Use `clip_ids` or `details:true` for exact clip fields; keyframe `t` values are source seconds, while editing tools accept timeline seconds. Live playhead/selection are returned even for an unchanged document revision. Library insertion accepts exact `media_id`; ambiguous names are rejected.

## Speech and silence

Silence analysis defaults to the audible full mix, including detached and overlay audio. `remove_silences` only removes pauses inside the selected, audible clips (the host returns where they play, using the same rules as the analysis render): stretches where nothing selected plays — other clips, photos, silent b-roll, or pieces of a clip that earlier cuts split under new IDs — are never cut, and the result reports how much of the timeline was analysed. `source` can select `all`, `video`, `overlay`, or `audio`; `clip_ids` isolates particular sources without changing their absolute placement. A source with no audible clips fails rather than treating synthetic silence as removable footage. Background music can mask pauses, so select speech clips when that is the intended analysis.

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

After visual edits, completion requires structural validation and current-revision composed samples sent through another model step.

Overview checks send a **contact sheet**: the completion check and storyboards tile 2–6 captured frames into one numbered image (at most 1024 px, three cells per row for vertical video, two for horizontal) with each cell's time in the image label. Measured on the configured Codex model, six 576×1024 frames cost about 4,500 image tokens and one sheet about 1,100, with caption-sized text still read correctly. Cells keep their own frame IDs and times, so visual coverage is unchanged. A frame seen only in a sheet counts as evidence for scene notes but not for subject tracking, which needs the starting frame inspected on its own. Explicit `inspect_frames`, section reviews and export inspection keep separate full-size frames. If a sheet cannot be built, the separate frames are sent. Native Codex replies show the token usage the provider reports for that reply. Failed mutations or failed captures cannot become a successful final claim. Sampling is evidence about the selected moments, not continuous playback validation.

## Verification

Regression suites cover range identity/link safety, mutation contracts, audible-source analysis, transcript reuse/timing, scene mapping/cache/evidence, and every image transport. Isolated Electron smoke modes `agent-editing`, `agent-audio`, and `agent-scenes` drive the real chat/UI/IPC and FFmpeg. Speech inference is injected in the audio smoke; `agent-vision` also supports a bounded live Codex check using `FVE_CODEX_VISION_LIVE=1`.

No installer is required for these checks. Pushes require an explicit user instruction as stated in `AGENTS.md`.

## Edit and Agent workspaces

Use **Edit | Agent** in the top bar to switch workspaces for the same project.
Edit keeps the full editing layout and floating CraftAI assistant; **Expand** in
that assistant opens the same conversation in Agent mode.

Agent mode places the conversation beside the preview, with a compact timeline
below the preview. Drag the conversation and timeline borders to resize them;
**Expand timeline** enlarges the timeline; **Compact timeline** restores the smaller view. **Media** and **Properties**
open one docked tool panel at a time beside the preview. The preview resizes
to remain fully visible; the conversation stays accessible while using those tools.

Import footage from the empty-state action or Media drawer, then describe the
video. Suggestions in Agent mode fill the composer for review before sending.
For an existing edit, **Attach selected clips** and timeline ruler range
selection focus a request on particular material.

Edits apply live. Stop, activity details, completion receipts, and the current
request's Undo remain available. Changing workspaces preserves requests,
drafts, attachments, selection, playback position, and timeline view. Manual
document edits retain the interruption and continuation behavior described above.
The last workspace and separate panel dimensions are remembered on this PC;
they are not project edits.

## Conversation and message queue

While CraftAI is working, keep typing and press Enter or the queue button to
add another instruction. Shift+Enter inserts a new line. Messages run one at a
time in the order shown, each with its own reply and Undo checkpoint. A queued
message keeps the clips/range attached when it was added; those references are
refreshed against the live timeline when its turn starts.

The queue shows each pending instruction. Pause it, edit a message in place,
remove an attachment, or remove a message without changing the composer draft.
Editing a queued message pauses submission until **Resume queue** is selected.
Stop ends the current request and pauses remaining messages. Provider errors,
manual-edit interruptions, and unavailable attachments also pause the queue.
Completed edits remain available for review and Undo.

Queues belong to their chat and are included in project autosaves. Reopening a
project always restores queued instructions paused; it never submits saved
instructions automatically. Starting or selecting another chat keeps that
chat's queue separate.

The timeline displays **Agent working** while preparing/reading, **Agent editing**
after owned document changes, and a stopping/interrupted state when applicable.
The strip offers **View chat** and **Stop** and clears when the request ends.
Manual controls remain available and take priority over agent edits.

Activity expands during a request and collapses after successful replies in
Agent mode. Reading earlier messages stops automatic scrolling; **Latest activity**
returns to the current turn. The composer and its Send/Stop controls remain
visible while the conversation, queue, attachments, and long drafts scroll
within their own bounds.

`tests/unit/agents/test-agent-chat-ui.cjs` drives these paths through an isolated
Electron window with deterministic provider reasoning and real tools/history.

## Image attachments

Use the paperclip in the composer, drop images onto the chat, or paste an image
from the clipboard. Attach up to six images of 20 MB each. Thumbnails can be
removed before sending; each queued instruction keeps its own references.
Sending only images creates a request to review them. Attaching references does
not insert media into the project or change the timeline.

The chooser accepts PNG/JPEG, WebP, GIF/APNG, BMP, TIFF, AVIF, HEIC/HEIF, SVG,
ICO, Photoshop and additional camera/still-image formats. Decoding uses bundled
FFmpeg, an isolated Chromium image decoder, and macOS ImageIO where available.
An unavailable decoder or damaged file produces an attachment error. Animation
and multipage inputs use the first frame. SVGs are rasterized with scripts and
external resources blocked. The selected model still needs image understanding.

Originals remain in the application's local `chat-images` storage. Providers
receive bounded JPEG previews as actual image inputs: native Codex local images,
Claude image blocks, or the selected API provider's image transport. Image
attachments are reference material, separate from composed-timeline evidence.
Project files, drafts, queued instructions and messages save metadata/IDs rather
than image bytes. Reopening on the same computer retains those references;
moving a project to another computer requires attaching the images again.
Missing current attachments block sending until removed or reattached. Historical
images unavailable locally are identified as unavailable rather than presented
as visual evidence. A new native session receives recent available images from
its saved conversation.

`tests/unit/agents/test-chat-images.cjs` checks provider input schemas, persistent
references, bounds and missing-image handling. `test-chat-images-ui.cjs` exercises
real picking, decoding, clipboard/drop events, queued image messages, restored
drafts and responsive layout in Electron with deterministic provider reasoning.
