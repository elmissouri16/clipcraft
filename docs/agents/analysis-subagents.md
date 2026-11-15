# Native analysis subagents

Settings → AI assistant → **Subagents** enables delegated source analysis for
the selected native provider. Save the setting before starting the next request.
It is off by default and saved independently for Codex, Claude and OpenCode.
Other provider settings and credentials retain their existing values.

The composer also has a people icon with an Off/count badge. Open it to enable
or disable subagents and choose **Agents at once** from one to six. Composer
changes save automatically to the same per-provider preferences as Settings and
apply to the next message. The composer control is disabled while a request is running;
use Stop to cancel current work. Narrow composer updates retain models, credentials,
endpoints and other preferences.

When enabled, the native coordinator receives `delegate_video_analysis`. It can
assign separate indexed source ranges to analysts, then ask a reviewer to compare
candidates and challenge their context, payoff or duplication. Children inherit
the selected provider, model and reasoning setting. They make extra model requests.
Small jobs should still use direct inspection.

An explicit request to use subagents takes priority over that small-job guidance.
The coordinator must delegate useful source analysis before proposing its plan or
editing. With subagents enabled, completion is held until at least one child has
completed, or `complete_edit.subagent_skip` records a concrete `not_applicable`
or `unavailable` explanation. This also applies to unchanged timelines and
plan-only replies. Failed, canceled and empty batches do not count as completed
analysis; a completed child with no findings does. A recorded skip explanation is
included in the final chat reply even if the model omits it. This avoids silent
solo fallbacks without forcing source analysts to perform unsupported editing
tasks. Updated coordinator instructions start a fresh native session with the
existing chat history; unchanged instructions retain ordinary session reuse.

This is ClipCraft-managed delegation through independent native sessions. Provider
built-in shell, filesystem, delegation and unrelated tools retain their existing
restrictions. Each native session uses the existing adapter and tool transport;
the application owns child access, cancellation and concurrency across providers.

## Access and lifecycle

- Children receive only `read_video_transcript`, `find_video_moments`, `review_video_moment`,
  `inspect_frames` and `submit_analysis`.
- `evidence_mode` defaults to `audiovisual`: every assigned range on an audio-bearing
  source needs completed speech processing. Compatible cached transcripts are
  reused automatically. `visual_only` requires a concrete `visual_only_reason`;
  when speech coverage is missing this limitation is included in the final reply.
  No source genre or project name changes these rules. Processed recognition with
  no text is disclosed separately from an unprocessed range or a source with no audio.
- The shared guard limits every inspection to the assigned source, index and
  source-time range. The renderer runs a read-only snapshot; its dispatch rejects
  writes. The main host checks the same scope before invoking any renderer tool.
  Review context and transcript pages cannot leak dialogue outside the assigned
  range. Crossing sentences without usable word timings are omitted with a note.
- The default is two concurrent child sessions. The user can select one to six
  per coordinator request; the application also caps total concurrent children
  across windows at six. Each batch accepts up to six tasks, with eighteen tasks
  per coordinator request. Additional tasks wait for capacity. A child has
  a budget of 24 inspection calls and a five-minute deadline including queue time.
- Each running child has a bounded frame scope holding up to 24 source images.
  Concurrent children cannot evict one another's evidence. Completing or stopping
  a task removes its scoped images. Ordinary editor inspection keeps its existing
  separate 48-frame cache. Evidence handles still expire within each scope, so
  re-review finalists after extensive exploration.
- Stop, window closure and interrupted ownership cancel children and request-owned
  media jobs. Child sessions are discarded after a task instead of being retained
  as ordinary user chats. Late callbacks cannot mutate the project.
- Turning the setting off removes delegation from the next native request. The
  changed tool set starts a fresh native session; the host also refuses disabled
  delegation, including attempts from stale clients.

The coordinator's editor queue waits on a delegation batch. Child reads use
independent queues, so they cannot deadlock behind that wait. Every child still
counts against the native request's aggregate tool budget.

## Findings and review evidence

`submit_analysis` accepts a short summary and up to three distinct findings. Each
finding must name a preview generated in that child request and source images
actually presented to that child, spanning the beginning, middle and end.
Even an empty submission requires a passage review with source images actually
presented to that child. An unexamined empty submission cannot fulfill delegation.
Submissions return source ranges, observations, confidence and frame provenance.
Results separately list assigned ranges, actual reviewed ranges and transcript
ranges delivered in page/review responses. None of those establishes continuous
watching or complete comprehension. Failed or timed-out children produce explicit
partial results. Run reports store enabled settings and task/evidence-mode counts,
never dialogue, tasks, titles or source paths.

Child findings are data for the coordinator to compare. They do not authorize
edits and their frame handles are not valid coordinator review proof. The
coordinator must inspect finalists itself before `propose_video_clips`, and only
the coordinator may add selected clips or make other timeline edits. The original
edit and its Undo history remain unchanged during child analysis.

The existing limitations of sampled imagery, transcript timing and local activity
signals still apply. Parallel analysis improves available coverage; it does not
prove continuous action/audio understanding or objectively best scene selection.

## Validation

`test-subagent-completion.mjs` exercises silent solo replies, plan-only completion,
the native retry loop, successful and failed batches, concrete skip reporting and
disabled settings without launching Electron or a live model. All native provider
completion hosts enforce the same decision. `test-agent-limits.mjs` also verifies
instruction refresh in reused conversations.

`test-analysis-delegation.mjs` exercises actual FFmpeg source reviews and image
transport, independent native-session callbacks, concurrency and queueing, scope
and write restrictions, evidence ownership, disabled settings, task limits,
timeouts and cancellation. It also holds three reviewed findings per child across
six concurrent sessions, validates all evidence and verifies cleanup. The native
reasoning loop in that test is scripted.

`test-analysis-delegation-ui.cjs` drives the real Electron UI with native model
fixtures for Codex, Claude and OpenCode: toggle/save/reopen/off, parallel analysts,
a separate reviewer, coordinator inspection, preview cards, unchanged timeline and
Undo, and Stop cancellation. Composer checks cover on/off, selected concurrency,
Settings synchronization and narrow saves. `test-settings.cjs` covers per-provider
persistence, invalid limits, failed writes and preservation of credentials/unrelated settings. The existing native runtime
and adapter parity checks cover the shared underlying native transports.

Runtime references: [Codex App Server](https://developers.openai.com/codex/app-server/)
and [Claude Agent SDK subagents](https://code.claude.com/docs/en/agent-sdk/subagents).
