# Visual tool activity and inline exports

Agent exports and section previews use the same export pipeline, exclusivity
guard, cancellation, foreground-work budget, Dock progress and cleanup as manual
exports. Their presentation is request-scoped: `runExportFlow` publishes display
progress to the owning tool rather than setting the manual export dialog state.
Manual exports retain the existing dialog and settings gate.

`createToolRunner` forwards pipeline progress through `onToolProgress`. Both
native and API loops associate it with the active export/review step. The chat
shows measured progress, stage, ETA and elapsed time; cancellation stops the
request so the agent cannot immediately retry against the user's intent. A
closed chat retains a background progress label. Completed, verified outputs
have a local video player and explicit open/reveal actions.

`activityEvidence.js` builds bounded visual context from editor snapshots:

- Insertions resolve the new clip/media IDs against the post-edit project.
  Streaming native image batches can show already inserted pictures.
- Cut, trim, split, delete and keep actions use the original timeline. Their
  range strip, duration and affected clip/track list distinguish requested work,
  applied changes and rejected operations. Overlapping keep ranges are merged
  for display. Thumbnails identify existing source media; they are not a claim
  of continuous footage review.
- Local source thumbnails and waveform images are reused. No additional image
  generation or remote footage-review service supplies these previews.

`toolTargets.js` adds `activity.targets` to every tool event for the timeline's spotlight and trail
(docs/agents/agent-editing.md): `{ clips: [{track,id}], ranges: [{start,end}], created: [{track,id}],
captions? }`, absent when empty. The running event derives them from the arguments and the project
before the call (clip ids resolved to their track, cut/keep/split/trim ranges, where a new clip will
land). The done event uses the reducer actions the call dispatched (`runner.lastActions()`, kept out
of the tool result the model reads), a content-and-length diff of the project that ignores clips which
only shifted after a cut, and the clip ids in the result. Caps: 40 clips, 12 ranges; the saved-chat
whitelist in `activityData.js` keeps the same bounds.

`activityData.js` normalizes saved display metadata separately from model
context. It bounds strings/arrays, rejects network/data/script URLs, and keeps
only typed local media references, edit summaries and output metadata. Older
chat entries retain their original labels when richer data was not recorded.
Missing local previews degrade to an unavailable message.

Historical rows are memoized. Live updates follow the bottom until the user
scrolls up; Latest activity resumes following. Opening/reopening or switching
chats still positions the list at its latest message.

Tool glyphs are original inline SVGs in `ToolCallIcon.jsx`, drawn on a shared
32-unit grid. Muted media shapes provide context and an accent identifies the
operation. Rounded strokes, subtle fills and square tiles are consistent across
families. Audio envelopes show a waveform and editable curve handles; volume
uses a speaker and fader. Sound search, stock search and local-media search have
separate symbols. No icon package, image download or network request is required.
The `tool-icons` isolated Electron smoke mode captures the complete set and the
audio tools in real saved chat rows, checking glyph bounds and fallback tools.

## Verification

The dedicated isolated-app scenario uses read-only source images and mocked
reasoning/image inference. Real editor cuts, effect rendering, encoding,
cancellation, metadata, local video playback and output actions are exercised:
`/var/folders/_j/d8w7d_sn23348hmv9trrjm480000gn/T/clipcraft-agent-capabilities-ui-8KXCeC/result.json`.

The capability scenario verifies API, Codex and Claude tool flows, local review,
actual export, cancellation and Undo with the new chat presentation:
`/var/folders/_j/d8w7d_sn23348hmv9trrjm480000gn/T/clipcraft-agent-capabilities-ui-bWCdIb/result.json`.

Manual export failure/retry and encoded output:
`/var/folders/_j/d8w7d_sn23348hmv9trrjm480000gn/T/clipcraft-agent-capabilities-ui-Y8Fvb4/result.json`.

Targeted regression results:
`/var/folders/_j/d8w7d_sn23348hmv9trrjm480000gn/T/clipcraft-tests-YA6AYG/results.json`.
