# Agent loop reliability

The loop now rejects malformed, truncated, incorrectly typed or incomplete tool
batches before executing them. The shared boundary checks argument objects,
required fields, nested values, enums and common schema constraints. Individual
tools continue to validate live IDs, ranges, locks and editor-specific rules.

Visual verification records affected timeline intervals. A frame at an unrelated
time no longer satisfies the check. Animated clips require samples in each third
of the affected interval; longer lists of edits are verified in batches. These
are sampled checks, not a guarantee of continuous playback or visual quality.

Model requests, retry waits, speech, library/stock fetches and MCP calls receive
request-owned cancellation. Piper receives process/stream cancellation; cloud
requests are aborted locally. Remote services determine whether work already
accepted on their servers can be stopped. MCP cancellation uses the original
request ID; initialization remains shared and is not canceled on the wire.

Unexpected loop errors retain completed-edit state. Recovery checkpoints keep an
operation outcome list and require reading live project state before continuing.
The chat Undo control uses the owned edit transaction rather than relying on a
provider success flag. Incomplete call/result pairs are not replayed after errors
or cancellation. Reaching the step limit reports an incomplete request.

MCP clients reconnect after an exited process. Mixed results preserve structured
content and resource metadata alongside text. Supported image blocks are decoded,
converted to bounded JPEG attachments and represented by host-owned frame handles
in saved context; image bytes are not saved in the tool-result transcript.

Conversation preparation budgets the complete conversation as well as tool
results. It archives whole exchanges with recoverable `turn:N` references, keeps
the latest instruction and newest exchanges intact, and leaves saved history
unchanged. The conservative character budget is an estimate rather than an exact
provider token count; individual oversized instructions/exchanges fail explicitly.

## Validation

Focused regression:

```sh
node tests/unit/agents/test-agent-loop-safety.mjs
```

Actual Electron renderer/main-process regression, using synthetic media, mocked
AI/speech and a real local stdio MCP fixture (no paid provider calls):

```sh
FVE_SMOKE=/tmp/clipcraft-agent-loop-check \
FVE_SMOKE_MODE=agent-loop \
VITE_DEV_SERVER_URL=http://localhost:5173 \
node node_modules/electron/cli.js .
```

Start the existing renderer dev server first. `FVE_SMOKE` isolates application
settings, autosaves and browser storage. Use a new directory for each run. If the
GUI process cannot find Node, set `FVE_SMOKE_NODE` to the Node executable path.

Validated alongside runner, tool, context, edit-contract, audio, frame, scene,
range-edit, speed-sync, chat-session, vision-transport, installed-agent, MCP,
AI-adapter, thinking, Gemini TTS and offline TTS tests, plus a
renderer production build. The native Windows Piper executable was not exercised
on macOS. Full battery results from the earlier editing work
are documented separately in `agent-editing-validation.md`; they were not
reclassified as passing by this change.

Electron main-process/preload changes require restarting the development app.
No installer packaging or push is part of this change.

## False interruption during generated media (2026-11-06)

The history reducer revoked an agent's transaction for every untagged action
before checking whether the action changed the document. Equal-value blur
commits, unmatched gesture-end callbacks, empty imports and rejected/locked
updates could therefore end ownership and make a later voice-over fail with
"project changed outside this request" despite no effective manual edit.

Ownership now ends after a validated action actually changes the document.
Explicit Undo/Redo, project load and manual gesture starts still revoke it
immediately. Real manual edits remain separate Undo checkpoints, and late agent
writes remain blocked. Interruption diagnostics retain action/field names,
without patch values; saved chat omits the private request token.

The error UI distinguishes an edit interruption from a connection failure and
offers Continue from current timeline instead of sending the user to Settings.
Recovery uses the existing completed-operation checkpoint and re-reads live
project state.

`test-agent-edit-contract.mjs` covers no-op, unknown, empty, rejected and real
manual actions; `test-chat-sessions.mjs` covers safe diagnostic persistence.
The isolated `agent-ownership` smoke exercises real native tool callbacks,
streaming image insertion, voice-file probing and preview capture with mocked
inference. Narration → image batch → narration succeeds while background/no-op
callbacks arrive. A real separate edit still blocks stale speech insertion;
the recovery button then resumes from the retained timeline. Evidence:
`/var/folders/_j/d8w7d_sn23348hmv9trrjm480000gn/T/clipcraft-agent-capabilities-ui-CrNROV/result.json`.
Targeted reducer/ownership/native/parallel-image/chat regressions, the renderer
build and module-structure checks pass. This reproduces a confirmed false-stop
mechanism; the original screenshot alone cannot identify which action fired in
that earlier request. No push or installer build was performed.

## Caption timing and native completion interruptions

The saved failing run confirmed repeated `add_captions` rejections before final
validation. Whisper accepted collapsed token offsets as measured words;
regrouping also accepted zero-length words, and caption insertion clamped
negative offsets to zero without checking the resulting intervals. Validation
correctly refused those captions. Whisper now rejects invalid measurements and
uses its labelled estimate. Regrouping checks ordering, positive duration and
cue bounds. Caption insertion also protects against older cached bad words:
it preserves cue text/timing, drops invalid word measurements and labels the
existing renderer highlight fallback estimated. Valid measurements survive.
Project validation remains strict; user autosaves are not rewritten.

The native request also had an unconditional deadline measured from request
start. A long, progressing edit could therefore stop during final verification.
The deadline now resets on tool dispatch and result. Genuine inactivity and
tool-call exhaustion retain explicit failure codes and a Continue action;
provider cleanup no longer broadcasts a user Stop. Visual verification reports
checked/total regions. The original saved Stop contains no cancellation reason,
so its exact trigger cannot be established retrospectively.

`test-agent-completion-ui.cjs` drives an isolated Electron profile through
caption generation, actual offscreen frame inspection, native completion,
active/idle lifetime handling, provider cleanup, call exhaustion and explicit
Stop. Reasoning and transcription inference are fixtures; the timeout clock is
shortened in the test only. Evidence:
`/var/folders/_j/d8w7d_sn23348hmv9trrjm480000gn/T/clipcraft-agent-capabilities-ui-9yz8f6/result.json`.
Targeted regression results:
`/var/folders/_j/d8w7d_sn23348hmv9trrjm480000gn/T/clipcraft-tests-WUskWh/results.json`.
The separate legacy `test-srt.mjs` suite cannot run on this machine because its
hard-coded `/home/hatch/workspace/user/files/captions.srt` fixture is missing;
caption-file tool tests cover SRT handling locally. Renderer build and structure
checks pass. No installer was built and nothing was pushed.
