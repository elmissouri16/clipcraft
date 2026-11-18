# Sandboxed commands and AI chapter workflows

> Historical executable recipe design. Its runtime/SDK declarations are retired.
> Use the [general Node host](plugin-extension-host.md) and
> [migration rules](plugin-legacy-retirement.md). Creative pack and private edit
> validation contracts remain where referenced by the current host.


Stage 3a added user-invoked commands; Stage 3c connected them to CraftAI, and the first Stage 3b slice adds caption-based AI chapter suggestions. The first example adds chapter markers. Commands never edit the project directly: they read a bounded summary and stage marker proposals, which the editor validates and commits once after successful completion.

## Package and SDK

Manifest API 1 gains optional `entry: "commands.js"` and `contributes.commands`. A command declares `id`, `name`, optional `description`, and up to eight typed `parameters`: legacy numeric fields (`id`, `name`, `min`, `max`, `step`, `default`, optional `integer`) or enum fields (`id`, `name`, `type: "enum"`, `options: [{value,label}]`, `default`) or boolean fields (`id`, `name`, `type: "boolean"`, strict boolean `default`). IDs are unique within commands. There are at most 100 commands per package. Unknown properties, parameter keys and nonfinite/out-of-range inputs are rejected. Entry is required exactly when commands are present; source is a UTF-8 ES module of at most 64 KiB. No dependency installation or additional resources are supported.

The package contains exactly `plugin.json`, plus `commands.js` when declared. The code and raw manifest both participate in an immutable content fingerprint. Existing data-only fingerprints remain unchanged. An installed package whose code changes fails integrity validation. Updating executable bytes requires a version increment. Dev startup installs examples without executing them or approving permissions.

A module exports `async function run(context, input)`. Input contains validated parameter values. Context exposes:

- `command.id`: this command's local ID.
- `project.read()`: a promise for `{duration_sec, fps, markers:[{time,label}], markers_total}`; only the first 1,000 existing markers are included. No paths, media bytes, provider credentials, chat, or full project object.
- `markers.add([{time,label}])`: stages up to 500 proposals for the current run. This does not mutate the editor.
- `transcript.read()` and `ai.chapters({count})`: caption-only AI capabilities with separate grants; see the [AI workflow contract](plugin-ai-workflows.md).
- `local.run(recipe)`: stage a curated local speech recipe with the separate `local.run` grant and declared `localTools`; [setup, native execution and reviewed SRT output](plugin-local-tools.md) belong to the host.
- `progress(fraction, message)`: progress from 0 through 1, with at most 80 characters of plain text.

`context.ai.translateCaptions({language})` and `context.captions.addTranslation({language,translations})` provide the reviewed caption-track path described in the [caption translation contract](plugin-caption-translation.md).

A command may return `{message}` (up to 1,000 characters), displayed as an attributed plugin response below the editor’s actual applied-marker count. Promise rejection or thrown errors fail the run. Proposed marker times must be finite and within the captured timeline duration; labels are plain text up to 80 characters. The host generates IDs and skips existing/duplicate frame positions at commit. All accepted markers form one existing reducer batch and one Undo step. Results are normal project markers and do not need the plugin afterward.

## Permissions and execution

Current grants are `editor.read`, `project.read`, `markers.write`, `captions.read`, `ai.chapters`, `captions.write`, `ai.translateCaptions`, `clips.write`, `timeline.reorder`, `timeline.edit`, `clips.linked`, `clips.links`, `timeline.ripple`, `clips.manage`, `tracks.write`, `clips.properties`, `clips.retime`, `clips.automation`, `clips.effects` and `export.gif`. Clip writes, marker/caption/AI workflows and GIF jobs use distinct validated permission combinations; the canonical manifest validator remains authoritative. `clips.linked` supports aligned and shifted pairs with picture-relative split/trim times. `timeline.ripple` stages one [bounded interval removal](plugin-ripple.md), with additional `clips.write`/`clips.links` grants for explicitly named free clips/pairs. Caption-writing packages are separate from marker-writing packages in this slice. AI chapter calls require caption reading, marker writing, explicit sharing consent and host-owned review. Native host confirmation names the unverified publisher, exact package version, command, and requested capabilities for each run. Cancel is the default. Installation, enablement, previous approval and dev mode confer no execution grants. Grants belong to one run and its exact fingerprint. Updates, disablement and removal cancel outstanding work. Direct files/network, shell, arbitrary editor mutations and scoped storage remain unsupported. The model services are fixed host-brokered chapter and caption translation operations.

Launches with `--no-sandbox` are refused, and the trusted preload must attest that its renderer is sandboxed before the host hands it any code. Each run uses a hidden sandboxed Electron window with context isolation, no Node, a unique nonpersistent session, and a dedicated module Worker for plugin code. The trusted page uses `clipcraft-command://runtime`, registered before application readiness and served from a session-specific two-resource allowlist with CSP headers. It never uses a file origin: adversarial testing showed that a file-origin worker could import local modules despite request filters. The custom origin closes that route, and a regression fixture verifies both file fetch and module import are blocked. The trusted page/preload expose only a one-shot job handoff and authenticated command protocol. Session request/permission handlers and CSP deny other files, network, frames, navigation, popups and downloads. Workers cannot access the editor DOM or its bridge. Neither `node:vm` nor a normal Node subprocess is a sandbox.

Install an IPC backstop before other application handlers: command windows may access only their runtime protocol; all existing privileged invoke and event channels are denied for these senders. Runtime handlers additionally check exact window/main-frame ownership and a per-run token. Unknown callers cannot fetch jobs, impersonate a run or submit results. This is supplemental to the worker/preload boundary, not a reason to expose raw IPC.

Host limits: one run at a time, 64 broker requests, 256 KiB per protocol payload and 500 staged markers for ordinary commands, with a 15 s execution/startup deadline and Cancel. AI-capable runs are limited to 20 staged markers, one chapter request, a 60 s model deadline and a fixed 90 s execution deadline; the stopped-worker review phase waits for user choice. The watchdog lives in the main process; unresponsive code runs in a separate worker and cannot block editor execution. Runtime cleanup destroys the window, terminates worker execution and discards staged work. This does not promise an arbitrary native-code sandbox or a hard OS memory quota.

The renderer captures its exact project/history identity before invoking the command. Completion is refused after project changes, reloads, concurrent agent edits or gestures. A final reducer guard checks the base object again against queued edits. No partial edits are applied on cancellation, denial, runtime failure, timeout, invalid proposals or stale state. Closing/navigating away from the command UI cancels an active run. Completed edits are reported from editor state, not plugin claims.

## Product surface and acceptance

Settings → Plugins → select an enabled plugin → Commands. Native numeric/dropdown/toggle controls collect input; Run opens the host permission dialog. Progress, Cancel, completion/error and actual applied marker counts are visible there. Commands require an open nonempty project and wait for agent/gesture/export activity to finish.

Acceptance: real-app runs create correctly timed markers with one Undo/Redo step; repeated runs skip duplicate frame positions. Permission denial, cancellation, infinite loops, malformed requests, forbidden capabilities, package disable/removal, stale project state and runtime crashes preserve the document. Adversarial fixtures check Node/DOM absence, blocked network/files, sender impersonation and privileged IPC. Existing preset/effect/transition flows must still pass. Evidence and platform limitations are recorded in the plugin roadmap.

Electron references: [sandbox](https://github.com/electron/electron/blob/main/docs/tutorial/sandbox.md), [security](https://github.com/electron/electron/blob/main/docs/tutorial/security.md), [custom protocols](https://github.com/electron/electron/blob/main/docs/api/protocol.md). The [AI workflow contract](plugin-ai-workflows.md) defines the first Stage 3b brokered service. Stage 3c supplies CraftAI discovery/invocation.

## Stage 3c: CraftAI command tools

CraftAI discovers enabled, validated installed commands with `list_plugin_commands` (core, read-only). Results are paginated (`query`, `offset`, `limit`, at most 50 per page), include exact immutable package keys, unverified publisher labels, permissions and typed parameter definitions, and contain no executable bytes or installation paths. Discovery never runs code. Only returned commands are callable in that request. There is no dynamic installation, package upgrade or automatic tool per plugin. This avoids name collisions and keeps one portable schema across providers.

`run_plugin_command` belongs to the `plugins` tool group (native agents receive it directly). It takes `key`, `command_id` and optional `input: [{id, value}]` for numbers or `[{id, choice}]` for enum IDs or `[{id, toggle}]` for booleans; exactly one correctly typed value field per unique ID. Omitted inputs use declared defaults. Inputs are checked against the discovered command and the live package is checked again before native per-run approval. The original sandbox and main-process broker enforce permissions and staging. Plugin descriptions, progress and `untrusted_plugin_response` remain untrusted text; only the host's `markers_added` and generated `marker_ids` establish actual changes. A permission refusal is final for plugin execution within that agent request and is not an unresolved edit failure. An explicit later user request can ask again.

Execution requires CraftAI's exact active edit token, a nonempty project, and no export or gesture. Calls use the serialized agent tool runner; accepted proposals pass its validation and the reducer's exact base/token guards. The batch participates in the agent request's single Undo transaction and its normal completion verification. Runtime failures remain normal failed operations. Stop, project changes, ownership loss and package revocation cancel the sandbox and discard its staged proposals. Progress is shown in CraftAI activity. Manual Settings commands still refuse execution while any agent owns the edit.

External MCP clients and analysis subagents are excluded from discovery and execution in this stage. A future explicit external-client policy is required before exposing commands there. CraftAI uses the same host-owned sharing consent and mandatory marker review for AI-capable commands. The caption translation slice adds one constrained caption-writing operation; further AI/model services and editing capabilities remain future work.


## Stage 4a: GIF export jobs

`export.gif` grants only the bounded `context.exports.gif(input)` staging method.
The package declares the standard range, size and frame-rate controls. The host
keeps the composition and output path private, stops the worker on completion,
selects a new destination and verifies the complete rendered file before reporting
an artifact. Export cannot be mixed with editing, caption or AI capabilities.
Settings, Export → Export type → GIF export and CraftAI share the same command path.
CraftAI reports the verified `artifact` and `changed:false`; there is no timeline
mutation or Undo entry. See [the limits and lifecycle](plugin-gif-export.md).
