# Trusted extension host — implementation status

The accepted direction replaces fixed executable recipes with long-lived trusted
Node extensions. Application 2.0.0, SDK 0.8.0 and host API 1 remain unchanged.
This document records the implemented contract and remaining release acceptance.

## Implemented foundation

- A `main: "dist/extension.cjs"` package entry, activation declarations and
  extension-only manifests. Creative contributions remain accepted in the same
  package and their asset bytes are validated.
- Recursive regular-file packaging under `dist/` and `assets/`, bounded package
  sizes, canonical fingerprints, and rejection of links and traversal paths.
- One Electron utility process per active extension, lazy command/event/service
  activation, package-fingerprint trust, minimal inherited environment, activation
  and shutdown deadlines, explicit stop and registration cleanup. Concurrent
  activation requests share one process; stopped, crashed and timed-out packages
  cannot be restarted by automatic discovery until explicitly started again in
  that app session. Stopping during preparation prevents a late process launch.
- Persistent commands, events, services and hook registrations; serialized scoped
  configuration and encrypted secrets; managed progress and cancellation signals.
- Node authoring/bundling and an experimental `@clipcraft/plugin-sdk/extension`
  type/helper entry. Strict checks use the pinned TypeScript CLI and Node types
  through a temporary configuration; author configuration is never rewritten.
  An explicit `extension` template creates a typed activation entry.
- Native Plugins settings trust/activate/stop controls and extension command UI.
- Public editor/workspace reads and validated editing through the real reducer
  with Undo, busy/stale-state guards and an activation check before commit.
- Typed project/editor/selection/playback, configuration, export and activation
  events with actual edit provenance, explicit replay, registration readiness,
  acknowledged async ordering, bounded queues/rate and observable coalescing.
  Custom topics use the real publisher's namespace. Cancellation is checked at
  native document authorization and synchronous commit, while scoped cleanup and
  activation-owned background processes remain available. See
  [extension events](plugin-extension-events.md).
- Each activation has a unique generation token, so a stopped activation cannot
  borrow a later grant.
- Complete revision-scoped project/track/clip/media/marker inspection pages and
  lazy nested value/string reads. Focused edit contexts include clips beyond the
  bounded summary without changing selection or depending on shared last-read
  state. Content-only changes invalidate edit revisions. See
  [project inspection](plugin-project-inspection.md) for the full contract.
- Generated media imports copy and inspect regular files or supplied bytes before
  returning opaque handles. Audio, images and video preview through the existing
  media controls and insert through one atomic Undo transaction. Adopted files
  remain outside the package and survive release, uninstall and app restart.
- Caption reads support pages; append/replace validates document revision and
  locks, commits one Undo transaction and preserves extension tracks during
  automatic-caption regeneration. Empty append is a no-op.
- Pull-based cross-extension service streams preserve order, bound chunks to
  1 MiB of plain data with finite numbers or bytes, copy binary subviews without oversized backing
  buffers and cancel provider iteration when a consumer stops or closes a stream.
- Managed subprocess helpers use literal argument arrays, bounded stdout/stderr,
  explicit input/environment, timeouts, cancellation and tracked process-tree
  cleanup. Raw Node subprocesses remain the extension's own responsibility.
- A general native UI registry for settings, actions and service integrations.
  Settings use host controls with typed values, custom validation, masked encrypted
  secrets and draft flushing before actions. Toolbar, inspector and clip-context
  action locations are connected; contributions disappear with their activation.
- Multiple sandboxed workbench views with lazy declarations, isolated sessions,
  message-only preloads, bounded acknowledged messaging, retained hidden state,
  focus/theme/layout integration and independent renderer cleanup. Recursive
  author assets are packaged and fingerprinted. Toolbar overflow and malformed
  command result rendering are bounded. See [extension views](plugin-extension-views.md).
- Host-rendered messages with extension attribution, plain text, action IDs,
  cancellation, expiry, bounded queues/rate and stop/window cleanup. They work
  on Home and above Settings; native views cannot cover overlapping cards. See
  [extension messages](plugin-extension-messages.md).
- Lazy declared and live registered command shortcuts, integrated with the
  shared keymap and native Shortcuts settings. Core/default conflict ordering,
  explicit remaps, inactive preference retention, cold-start activation and
  authenticated key forwarding from sandboxed views are supported. See
  [extension shortcuts](plugin-extension-shortcuts.md).
- Native Save/Save as and export validation/preparation hooks with private staged
  edits, nested command/service scope, cancellation, durable media leases and one
  Undo transaction. Recovery autosaves remain independent. Synchronous reducer
  claims serialize stop against publication; unclaimed reservations are revoked
  and already-claimed edits finish before stop. See [save/export hooks](plugin-extension-hooks.md).
- General video export through `context.exports.render`, using the native
  pipeline, preparation hooks, snapshot quality/range options, progress, AbortSignal,
  attributed native UI and verified output metadata. Existing/source files are
  protected and stop/restart is checked immediately before atomic publication.
  See [extension export](plugin-extension-exports.md).
- Optional VoiceStudio source package in `examples/extensions/voicestudio`.
  Its transport, voice discovery and generation run in the Node extension. The
  core consumes ordinary services through `voice.engines`; it contains no vendor
  protocol or dispatch branch. The extension contributes native Voice settings,
  Text to speech choices and CraftAI voices. Old address/enabled/default-voice
  preferences are adopted once without overwriting extension settings. An
  explicit missing or disabled engine remains selected and reports why it cannot
  speak. The package is installed separately and is not bundled with examples.
- Source-folder Node development with native session-scoped trust, captured build
  directories, temporary settings/secrets, ordered reload and compiled watch.
  Stop/crash state survives new generations; stopped and failed activations retain
  bounded workbench diagnostics. See [extension development](plugin-extension-development.md).
- General marker transactions, native file pickers and discovery of bundled tool
  paths. Marker writes use content revisions, native commit/Undo and private
  Save/export drafts. File-picker replies revoke on abort/stop while the OS dialog
  remains until dismissed. Five Node replacement examples cover chapters,
  dashboard/preferences, clip controls and local media processing. See
  [document/tool APIs](plugin-extension-document-tools.md) and
  [example migration status](../../examples/extensions/README.md).
- Bounded native jobs with scoped cancellation, generation-checked Settings
  controls, nested-call propagation and deadlines independent of ordinary callback
  timeouts. Managed file publication returns actual bytes, checksum and atomic
  visibility information while protecting existing files and completed receipts.
  Three further ordinary Node replacements cover GIF export, reviewed HTTPS
  upload and local speech model/tool/transcript management. See
  [managed jobs and files](plugin-extension-jobs-files.md).
- Core CraftAI consumes ordinary services at the general `ai.engines` integration
  point, with native model choice, tool validation, cancellation and explicit
  missing-engine retention. The local AI replacement owns its transport and
  encrypted credentials. See [AI services](plugin-extension-ai.md).
- General application services share `services.list/call` with ordinary extension
  services. The selected native AI connection is available as `clipcraft.ai`, with
  private credentials, connection proofs and cancellation. Atomic caption-track
  creation preserves source captions and measured timing. All eleven executable
  example sources now have ordinary Node replacements, including reviewed AI
  chapters and translation. See [application services](plugin-extension-host-services.md).
- CraftAI discovers ordinary declared Node commands from installed packages and
  the current development snapshot. Bounded JSON arguments, native approval,
  nested execution ownership, actual document/file receipts, managed-job progress,
  cancellation and native export preparation preserve the existing validated
  agent edit and its single Undo. See [agent commands](plugin-extension-agent-commands.md).

## Implemented runtime retirement

The public SDK now has one executable model: trusted Node extensions. Historical
package parsing retains immutable creative fingerprints and saved preferences
without any executable declarations. Command/panel runtimes, protocols and
specialized service execution were removed. Same-version cross-format migration
retains both immutable payloads with fresh Node trust. General native export
actions and globally visible managed jobs replace the remaining fixed controls.
See [retirement and verification scope](plugin-legacy-retirement.md). The completed full run and focused corrections are recorded in the
validation ledger; unresolved prerequisites and release gates remain explicit.

## Remaining accepted plan

The current resumed pass skips blocked prerequisites while retaining them as
[unfinished acceptance](plugin-extension-unfinished.md), per the maintainer's
instruction. The [completed local followup](plugin-extension-storage-bounds.md)
records package/recovery, preference/cache and native-media path corrections and
the final plugin selection. None of the skipped gates becomes a release pass.

- Resolve the remaining full-battery prerequisites and finish
  the archive/abuse and installed-app matrix. The Node worker now has a native
  ASAR check; its [self-contained native view followup](plugin-extension-asar-views.md)
  adds archived dependencies/preload/protocol and a missing-preload control.
  Complete Windows/Linux and installed-release acceptance remain open.
- Finish representative hardware/performance, long-session memory and manual UX
  acceptance. [Stabilization](plugin-extension-stabilization.md) records the
  current bounded measurements and native lifecycle/storage checks.

Lifetime native-session creation is now bounded, with exclusive leases that wait
for renderer shutdown and successful native state cleanup before reuse. SDK
builds also use canonical workspace-relative source labels. The
[session reuse followup](plugin-extension-session-reuse.md) records these fixes,
their verification scope and the still-open performance-budget decision. The
[normal-session observations](plugin-extension-normal-session.md) retain the
original findings and closed-job retention correction.

Current verification: 107 plugin suites passed before the final pending-owner
guard, then all seven affected suites passed after it. The ten-minute normal-GC
native workload completed 121 cycles using two private sessions throughout and
released all leases and tracked owners at Stop. A final native regression also
verified fresh origins/tokens over eight uses of one cleaned session. Exact source
snapshots and retained failures are in
`plugin-validation.json.extensionHostSessionReuse`. This is development
verification; the remaining acceptance bullets above still apply.

SDK and repository packaging now share the native writer's compressed-byte cap
and exclusive publication of captured bytes. Seven package/SDK suites and the
native creative-pack workflow with cold restart passed on frozen source. The
[package publication followup](plugin-extension-package-publication.md) records
the reproduced oversized SDK output, corrected cleanup error, publication races
and verification limits. This closes those concrete distribution defects while
the broader archive/abuse and release acceptance remain open.

The reader now separates payload from tar format overhead and refuses nested
compression, ignored entry types and oversized metadata. A generated package at
the file, path and payload limits round-trips through the SDK and installs/removes
in real Settings without execution. See the
[archive boundary followup](plugin-extension-archive-limits.md) for the exact
limits, native checks and remaining acceptance.

The native frame writer also fences reader disappearance during FIFO handoff.
The [encoder handoff followup](plugin-extension-fifo-handoff.md) records a
reproduced main-thread deadlock, its small production correction, exact decoded
frame checks and a real app export that survives injected encoder termination.
This fixes that demonstrated race; the old timeout's exact cause remains
unattributed because its original trace is incomplete.

The [package/library followup](plugin-extension-package-hardening.md) records
portable path validation, bounded payload reads and the resolved music-query and
sound-pagination failures, with current whole-app evidence in the validation ledger.

The combined [full application regression](plugin-extension-full-regression.md)
records 336 classified PASS, 3 FAIL and 2 opt-in SKIP across 341
suites on the final frozen candidate. Its five followup file changes are test
drivers only. The current failures require the Windows caption prerequisite,
original sibling asset manifest and live SFXMint access (observed HTTP 429 with a
server Retry-After window). All three raw full runs and diagnosed fixture
failures remain in the ledger. Release automation and the other acceptance
bullets above remain open. The subsequent
[SDK verification command and local CI workflow](plugin-sdk-validation.md)
add repeatable development validation; their remote matrix and release acceptance
remain pending. [Fresh-cache verification](plugin-sdk-cache-followup.md) adds the
explicit metadata preparation and corrected local Mac/Linux SDK evidence.

Use the exported `ExtensionContext` declarations for the implemented API. The
worker binds those operations to runtime services, native IPC and the editor
bridge; the fallback rejection is for calls outside that contract. Earlier plan
tables and historical recipe documents do not add supported operations. Full Node
access is trust, not a security sandbox. Installing or inspecting a package never
runs it. Release acceptance remains separate from implementation coverage.

## Verification

Native Electron suites `test-extension-runtime.cjs` and
`test-extension-host-ui.cjs` exercise actual utility processes and the app's real
Settings surface. The UI suite verifies refusal, activation, an optional connector
command, a real project edit with one Undo, and process stop. Retain test output
and source snapshots when recording further verification; do not infer release
readiness from these focused checks.

Focused foundation verification: 10 suites passed, 0 failed. Native runtime and UI results, source hashes and logs: `/var/folders/_j/d8w7d_sn23348hmv9trrjm480000gn/T/clipcraft-node-foundation-04vj9fei/verification.json`. This is macOS development verification; the full accepted plan remains incomplete.

Final trust-once and service/event checks: 10 selected suites passed, 0 failed, against unchanged source hashes. Evidence: `/var/folders/_j/d8w7d_sn23348hmv9trrjm480000gn/T/clipcraft-node-foundation-o_fc0seu/verification.json`. Earlier trust-dialog fixture failure used the owner window as the dialog options argument; the corrected native mock and complete focused selection passed.

## Generated media and service API details

`context.media.import({path, name?})` accepts a regular local file up to 512 MiB.
The alternative `{bytes, name}` accepts a Uint8Array up to 32 MiB. The host copies
and inspects the result, then returns metadata and an opaque `id`, not its path.
At most eight imports run concurrently. An artifact belongs to one activation.
`media.preview({id, autoplay?})` opens a host preview without changing the project;
autoplay defaults to false. Closing it publishes `media.previewClosed`.
`media.insert({id, lane?, trackId?, start_sec?, index?, documentId?})` adopts a
durable copy and inserts it through normal editor placement/lock checks. Main
video uses an insertion index; audio/overlay use start time. `release({id})`
removes the pending copy but never deletes media already offered to a project.
An uncertain reply after insertion must not erase a potentially committed file.

`captions.read({trackId?,cursor?,limit?})` returns at most 1000 cues per page,
including document/revision. Cue handles outside the bounded editor projection
are null. `captions.write` requires the matching document/revision, explicit
`append` or `replace`, and validated text/start/end cues. It operates on caption
cues on the selected text track and leaves unrelated titles intact.

`services.stream(id, method, input?, {signal?})` is an AsyncIterable. Implementing
methods return an AsyncIterable and receive a cancellation signal as their second
argument; ordinary service methods receive it too. No output is pulled until the
consumer requests the next chunk. Returning from iteration cancels the provider.

`processes.spawn({file,args,cwd?,env?,stdin?,timeoutMs?,maxOutputBytes?,signal?})`
returns `{id,pid,result,kill}`. The result contains the actual exit code, signal,
stdout and stderr. Nonzero exit is data; spawn failures, cancellation, deadlines
and output overflow reject. Defaults are five minutes and 1 MiB output, with an
8 MiB maximum; an explicit process deadline can be up to thirty minutes. Write larger output to a file and import it as media. The SDK never
runs an implicit shell. Only managed processes are tracked for shutdown.

## Media, streams, processes and authoring verification

All seven extension suites passed in native/Node checks. The broader plugin and localization selection passed 100 suites and failed one legacy watched-preview measurement. That fixture could observe the new header before the new rendered fingerprint; its wait now requires the current fingerprint and its pixel sampler uses the active task view. No application code or pixel threshold changed for this correction. The complete native usability workflow and restart then passed. Exact initial results, the test-only source delta, rerun results and inspected generated-preview captures are retained under `extensionHostServices` in `docs/design/plugin-validation.json` and `/var/folders/_j/d8w7d_sn23348hmv9trrjm480000gn/T/clipcraft-extension-services-final-4kao_xws/verification.json`. The full accepted goal is still active.


## Native UI and optional voice integration

`context.ui.registerSettings` accepts host-rendered string, number, boolean,
select and encrypted-secret fields at `settings.plugins` or `settings.voice`.
The optional validation command returns `{value}` to normalize a proposed value;
throwing rejects it without overwriting the stored value. Secret reads in the
native UI return only `{saved: boolean}`; extension code uses `context.secrets`.
Native actions wait for edited settings to finish saving before invoking their
command. `registerAction` connects commands to toolbar, inspector, clip context
and either settings location. Context actions receive `{location: 'context',
editor, clipId}` with the canonical bounded editor snapshot and public clip
handle. Stale commits remain subject to the existing editor transaction checks.

`registerIntegration({id,title,point,service,order,aliases})` associates an ordinary
service with an application integration point. `voice.engines` currently consumes
`status(input, {signal})` and `generate(input, {signal})`. Status returns
`{enabled,running,voices,supportsStyle,supportsSpeed,error}`; voices contain
`{id,name,language?,styleRequired?,description?}`. Generate returns a verified
`context.media.import` artifact owned by that service activation. The app adopts
and probes the audio before returning it to Text to speech or CraftAI. The stable
engine ID is `extension:<full-service-id>`. Aliases are supplied by the extension;
there is no vendor alias table in dispatch. Cancelling a native service request
aborts its worker handler's signal. No speech-provider manifest type was added.


## Native UI and voice cutover verification

The final focused selection passed 16 suites with 0 failures. Native Electron workflows cover toolbar/context commands with Undo, trust refusal, optional installation, migrated preferences, validated settings/actions, Text to speech generation, CraftAI discovery/generation/Undo, disabling/removal and a cold restart with preserved audio and the explicit missing engine choice. Runtime checks cover simultaneous activation, stop during preparation, and keeping stopped/crashed/timed-out extensions from automatic restart. Strict extension typechecking, the renderer build and structure checks passed. Source fingerprints, logs and results are recorded in `plugin-validation.json.extensionHostNativeUiVoice` and `/var/folders/_j/d8w7d_sn23348hmv9trrjm480000gn/T/clipcraft-extension-services-final-s5_zh2dr/verification.json`. This verifies the completed native UI/voice stage on macOS; the accepted migration still has the remaining work listed above.

Native settings validation feedback is kept concise; internal exception stacks stay in extension diagnostics. The final native UI suite verifies this and waits for the corrected normalized field before capturing the settings layout.


## Complete document inspection verification

The frozen production tree passed 108 suites in the full plugin/localization/speech selection; 2 existing UI timing fixtures failed. The transition fixture exported the previous project before its short load committed; the showcase attempted audio playback before the current decoder was ready. Both full workflows passed after test-only waits were corrected, with their thresholds and assertions intact. The inspection fixture was additionally tightened to check the visible native Text inspector; its complete native workflow passed after correcting test syntax. No production source changed after the broad selection. New inspection unit checks, strict positive/negative SDK compiler checks, the renderer build and structure check passed. Native verification paged 650 clips, round-tripped large metadata, edited the 649-second clip despite interleaved focused reads, verified Undo/locks/stale scopes, and visibly inspected the result. Full results and exact source/test deltas are in `plugin-validation.json.extensionHostProjectInspection` and `/var/folders/_j/d8w7d_sn23348hmv9trrjm480000gn/T/clipcraft-extension-services-final-dpmdj8oe/verification.json`. The accepted goal remains active.


## Workbench views verification

The final focused selection passed 25 suites with 0 failures on a frozen 977-file source snapshot. The initial broader selection passed 111 suites and failed two new test fixtures: an incomplete native-view mock and an assertion that ran before native visibility settled. Both complete workflows passed after their fixtures were corrected. Subsequent package-path, worker/WebGL, focus and picker refinements passed the final focused selection; the entire broader selection was not rerun after those refinements. Native Electron checks verified isolated views, retained state, directed messages, blocked file/network access, worker isolation, WebGL, actual view bounds, modal masking, cancellation, independent crash cleanup, replacement handles and real Escape focus handoff. An isolated window was briefly shown for visual captures, then hidden. Renderer/SDK builds and structure checks passed. Exact results, source deltas and evidence are in `plugin-validation.json.extensionHostWorkbenchViews` and `/var/folders/_j/d8w7d_sn23348hmv9trrjm480000gn/T/clipcraft-extension-services-final-34r5vcee/verification.json`. App 2.0.0, SDK 0.8.0 and host API 1 remain unchanged; the accepted goal remains active.


## Native message verification

The frozen 982-file source snapshot passed 27 focused extension/SDK/localization/voice suites and both legacy native-panel suites, with 0 failures in either selection. Native Electron verification passed 20 message checks: Home without focus theft, literal text/extension attribution, validated actions, real Escape, AbortSignal, expiry, malformed input, queue bounds, stop/restart isolation, messages above Settings, and measured overlapping/non-overlapping view behavior. Three earlier native fixture attempts wrongly expected a card below a viewport to hide it; measured rectangles corrected the fixture to test both actual geometries. The final complete workflow passed twice, including in the focused selection. The captured Home card was visually inspected; the isolated app remained hidden. Renderer/SDK builds and structure checks passed. Exact source hashes, logs, initial failures and native results are recorded in `plugin-validation.json.extensionHostNativeMessages` and `/var/folders/_j/d8w7d_sn23348hmv9trrjm480000gn/T/clipcraft-extension-services-final-g0cs5ly1/verification.json`. Versions remain application 2.0.0, SDK 0.8.0 and host API 1. The accepted goal remains active.


## Extension shortcut verification

The final frozen 988-file source snapshot passed all 33 suites in the focused extension/SDK/voice/localization/core-keyboard/native-panel selection. Native extension checks passed 21 initial-session and 7 cold-restart checks, including real Control and Command key input, typing protection in sandboxed views, explicit conflict remapping, live view updates, runtime disposal, stop/disable/removal, retained absent preferences, lazy trusted activation and Reset all. The existing core shortcut workflow also passed. The captured Settings layout was inspected. An initial 30-pass/3-failure selection exposed a real Vite dev CommonJS import bug; a private application module mapping plus explicit dependency prebundling corrected it. Both the three complete affected dev workflows and the entire final selection passed after that fix. Renderer/SDK builds and structure checks passed. Exact initial failures, rechecks, final hashes (including Vite configuration), native results and logs are in `plugin-validation.json.extensionHostShortcuts` and `/var/folders/_j/d8w7d_sn23348hmv9trrjm480000gn/T/clipcraft-extension-services-final-ynyonhr6/verification.json`. Versions remain application 2.0.0, SDK 0.8.0 and host API 1. The accepted goal remains active.


## Save/export preparation verification

The frozen 999-file source snapshot passed all 44 suites in the focused extension/SDK/localization/voice/keyboard/native-panel and core save/export/agent selection. The native hook workflow passed 19 checks, including invisible staged captions/audio, recovery autosave independence, picker cancellation, rollback, destination metadata, Save output, one Undo, an encoded caption frame and both sides of stop/commit ordering. Utility-process checks also verified nested command/service/stream scope, late-call refusal and stopping an uncooperative canceled handler. Initial native failures exposed a real synchronous IPC reply-order bug and unsuitable fixed caption sizing; both were corrected before the final complete workflow and selection passed. Renderer/SDK builds, strict author checks, structure and diff checks passed. Exact failures, source hashes, logs and native artifacts are in `plugin-validation.json.extensionHostSaveExportHooks` and `/var/folders/_j/d8w7d_sn23348hmv9trrjm480000gn/T/clipcraft-extension-services-final-9rbpvegy/verification.json`. Application 2.0.0, SDK 0.8.0 and host API 1 remain unchanged. This is focused macOS development verification; generic export APIs and the remaining accepted migration are still open.


## General video export verification

The final frozen 1004-file source snapshot passed all 48 suites in the focused extension/SDK/localization/voice/keyboard/native-panel and core save/export/agent selection. Native generic export passed 26 checks, including actual caption pixels and section frames, probed output metadata, preference preservation, native attribution, import/preview, source/destination protection, SDK/native cancellation, Stop during encoding, restart, frame-folder cleanup and the optional workbench command through Settings. Initial native failures exposed a real preparation guard issue with background media visuals; the host now carries derived caches without treating them as content edits or adding a no-op Undo step. The initial selection passed 47 suites and failed the new fixture's premature Install click. Its readiness/modal helpers were corrected; the complete final selection passed, with no production-source changes after the initial selection. The completion UI and encoded caption were inspected. Builds, strict SDK author checks, structure and diff checks passed. Exact failures, hashes, logs and native artifacts are in `plugin-validation.json.extensionHostVideoExports` and `/var/folders/_j/d8w7d_sn23348hmv9trrjm480000gn/T/clipcraft-extension-services-final-xxnif2_3/verification.json`. App 2.0.0, SDK 0.8.0 and host API 1 remain unchanged. The accepted migration remains active; full events, development reload, executable migration and release/platform validation are still open.


## Event and callback verification

The final frozen 1011-file source snapshot passed all 58 suites in the focused extension/SDK/localization/voice/keyboard/native-panel and core history/settings/save/export/agent selection. Actual utility processes passed 18 event checks; the native editor passed 19, including real input, timeline Undo/Redo, playback, privacy-safe configuration, actual export lifecycle/correlation and a delayed edit canceled while its activation remained running. Completed view and stream callbacks retain independent background access. Initial checks exposed a real startup-order error in the settings hook and an overly strict service-cleanup guard; both were fixed before final verification. Subsequent configuration-reset, Promise and callback-lifetime refinements also passed the complete final selection. The native completion capture was inspected. Renderer/SDK builds, strict author checks, structure and diff checks passed. Exact initial failures, intermediate selections, final hashes, native artifacts and limitations are in `plugin-validation.json.extensionHostEvents` and `/var/folders/_j/d8w7d_sn23348hmv9trrjm480000gn/T/clipcraft-extension-services-final-9yawj2bf/verification.json`. Versions remain app 2.0.0, SDK 0.8.0 and host API 1. Development trust/reload, legacy executable migration and the release/platform gates remain open; the accepted goal is still active.

## Development verification checkpoint

The final unchanged 1015-file source snapshot passed all 65 suites in the focused selection. The native developer workflow passed 23 checks, including folder trust refusal/approval, immutable snapshot execution, temporary settings/secrets, managed process and view replacement, revoked edit reservations and late callbacks, real timeline Undo, failed-build recovery, explicit stop/crash inheritance, source identity/link refusal, compiled watch and session cleanup. A separate ordering test holds a reducer commit open and verifies that crash/reload waits without reactivating it. The final Settings capture was inspected. Renderer/SDK builds, strict author checks, structure and whitespace checks passed. Earlier fixture failures and an edit-triggered Vite interruption are retained alongside the clean final run in `plugin-validation.json.extensionHostDevelopment` and `/var/folders/_j/d8w7d_sn23348hmv9trrjm480000gn/T/clipcraft-extension-services-final-65rlaaqb/verification.json`. App 2.0.0, SDK 0.8.0 and host API 1 are unchanged; both package manifests and lockfiles retain their prior bytes. Legacy executable migration and release/platform gates remain open.

## Document/tool and example migration checkpoint

The final unchanged 1044-file snapshot passed all 68 selected suites. The new native example suite passed 21 checks through actual Node utility processes, sandboxed views, marker and opacity Undo, real Save preparation/validation, picker cancellation, bundled FFmpeg processing and verified media insertion. It makes legacy command/panel execution throw, proving these replacements do not invoke that runtime. The source-development suite also passed its 23 checks. Initial regression exposed a real premature End status; cleanup now finishes before completion is reported and a deterministic held-cleanup assertion covers it. Initial fixture readiness/capture failures and their resolutions are retained in `plugin-validation.json.extensionHostDocumentTools` and `/var/folders/_j/d8w7d_sn23348hmv9trrjm480000gn/T/clipcraft-extension-services-final-nqhzc3jh/verification.json`. Native view captures were inspected, including correct exclusion of gaps from picture counts. Structure, whitespace, renderer and strict SDK checks passed. Version manifests and lockfiles remain byte-for-byte unchanged. The remaining executable examples, SDK/runtime retirement and release/platform gates remain open.


## Managed jobs, publication and output example checkpoint

The frozen 1066-file checkpoint passed 73 selected suites with 0 failures. The final source change was confined to progress-bar styling in `src/styles/styles.css`; 4 affected native UI suites then passed with 0 failures against the final unchanged snapshot. The output example workflow passed 26 native checks: real MP4-to-GIF encoding/probing/publication, existing-file preservation, native job cancellation and late-edit refusal, a real local verified HTTPS PUT, redirect refusal, uncertain cancellation receipts, executable/model selection and verification, real FFmpeg plus fixture CLI transcription, reviewed SRT saving, malformed-cue refusal and model removal. The source test verifies download redirect, hash, size, cancellation and local-copy bounds without fetching public model binaries. Native job controls were visually inspected and the intermediate MP4 no longer leaves a stale completion dialog.

The new replacements are `gif-export`, `reviewed-gif-upload` and `local-speech`; their IDs/versions are preserved. Native job deadlines/cancellation and `files.publish` remain general APIs. Application/SDK manifests and lockfiles are unchanged. Source hashes, initial failures and corrections, build/structure/whitespace checks and exact limits are in `plugin-validation.json.extensionHostJobsFilesOutputExamples` and `/var/folders/_j/d8w7d_sn23348hmv9trrjm480000gn/T/clipcraft-extension-services-final-sjat68g6/verification.json`. AI chapter markers, caption translation and the local AI integration remain to migrate before legacy runtime retirement. Real model inference, ASAR, full regression and Windows/Linux release gates are still open.


## Ordinary AI service integration checkpoint

The frozen 1073-file checkpoint passed 89 selected suites with 0 failures, including native AI/model/capability behavior, existing provider and chapter/translation workflows, extension/SDK, voice, keyboard, save/export and editor checks. The only subsequent source delta was a fixture wait for completed model-refresh/save UI state; its complete native initial/restart workflow then passed 19 checks. The service bridge unit suite passed 14 boundary checks. The actual utility-process extension performs HTTP tool calling, receives matched tool results and edits through CraftAI's real loop with Undo. Unknown tool calls, truncated answers, cancellation, stopped/removed engines and explicit missing selection after restart are covered. Native model refresh performs no transport request, endpoints/credentials remain in extension settings, and stable native captures were inspected.

A legacy UI timing failure was resolved by waiting for the actual discovered provider option; compatibility coverage and the final complete selection passed. Legacy chapter requests also accept ordinary AI services without requiring a core endpoint. Exact initial driver failures, fixes, native results, unchanged source fingerprints, renderer/strict author build and structure/whitespace checks are recorded in `plugin-validation.json.extensionHostAiServiceIntegration` and `/var/folders/_j/d8w7d_sn23348hmv9trrjm480000gn/T/clipcraft-extension-services-final-2p9hnfry/verification.json`. App/SDK manifests and lockfiles plus example ID/version are unchanged. AI chapter/caption Node source migrations, general native AI access for extensions, legacy runtime/SDK retirement and release/platform gates remain open.


## Application services and caption example checkpoint

The final frozen 1092-file source snapshot passed all 93 selected suites with 0 failures. The new native initial/restart workflow passed 35 checks, including credential-free connection discovery, reviewed sharing, anchored chapters, complete translation review, one Undo/Redo, exact caption timing, native Save, visible encoded captions, uninstall/reopen persistence, native settings invalidation, nested ordinary AI services, consumer cancellation, cold-start discovery and listener/process cleanup. Strict builds of the three involved source examples, renderer/SDK builds, structure and whitespace checks passed. The compact review was visually inspected.

The initial selection passed 91 suites and failed two UI fixtures: the developer workflow assumed Settings stayed open after an explicit view reveal, and caption review measured geometry before layout settled. Corrected native navigation/readiness and nonblocking failure diagnostics passed both complete workflows and the final entire selection; product source did not change after the initial selection. Exact failures, fingerprints, build logs and native artifacts are in `plugin-validation.json.extensionHostServicesCaptionExamples` and `/var/folders/_j/d8w7d_sn23348hmv9trrjm480000gn/T/clipcraft-extension-services-final-qr0fonjh/verification.json`. All eleven executable example identities, versions and host API declarations are preserved, as are app/SDK manifests and lockfiles. CraftAI Node command discovery/execution, legacy SDK/runtime retirement and the release/platform checks remain open; the accepted goal remains active.


## Ordinary CraftAI command checkpoint

The final frozen 1098-file snapshot passed all 102 selected suites with 0 failures, including native Node and legacy command workflows, linked edits/reorder, save/export, voice and localization. The new native workflow passed 66 checks: real discovery/JSON arguments through three native backends and the API loop, nested commands/services/streams, caption and media insertion, native review, generated-audio coverage, actual encoded video and file receipts, export preparation, progress attribution, one Undo/Redo, cancellation during work and permission review, ignored-cancellation termination, explicit reactivation and empty-timeline reads. Provider/model replies are fixtures; editor and native operations are real.

Initial fixtures used a wrong typed message field and an obsolete composer reference after empty-project load. An export-coverage refinement also introduced a real reducer scope error; it was corrected and the final complete selection passed. Visual inspection rejected an earlier fixture result that claimed success while its completion gate still required image review. The fixture now consumes real returned images, checks the native completion gate and asserts the successful UI; the final capture was inspected. Exact failures, source fingerprints, builds and native artifacts are in `plugin-validation.json.extensionHostAgentCommands` and `/var/folders/_j/d8w7d_sn23348hmv9trrjm480000gn/T/clipcraft-extension-services-final-lflgj6eg/verification.json`. Renderer/SDK builds, strict fixture builds, structure and whitespace checks passed. App/SDK manifests and lockfiles, all Node example manifests and host API remain unchanged. Legacy SDK/runtime retirement and release/platform gates remain open; the accepted goal remains active.

## Runtime retirement verification

The legacy runtime and public SDK recipes are retired. Historical creative bytes,
fingerprints and saved preferences remain data-only. Native migration, global
cancellation, general export actions, mixed-pack GIF output and independent
archive-only Node worker launch are verified. The full candidate run and exact
post-run corrections are recorded under
`plugin-validation.json.extensionHostLegacyRetirement`; see
[retirement scope and remaining gates](plugin-legacy-retirement.md).

## Platform followup

Creative intake portability, explicit output frame rates, native Undo and caption
event ordering are implemented. The [platform followup](plugin-extension-platform-followup.md)
records macOS and sandboxed Linux development results, raw failures and remaining
release gates. SDK v1 is still on hold.

The later [reliability followup](plugin-extension-reliability-followup.md) records
the 334-suite macOS battery, retained-heap diagnostic, export-timeout evidence
and corrected lower-third example. It retains the unresolved release gates.

The [resource-admission followup](plugin-extension-resource-admission.md) records
bounded directory traversal, captured SDK asset reads, native refusal before
trust, and Node 20/24 Linux compatibility. Release acceptance remains open.

The [native keyboard followup](plugin-extension-keyboard.md) records real macOS
focus transfers, corrected sequential/form-control boundaries and isolated
visible acceptance. It closes those defects while retaining the broader UX and
platform gates.

The [view cleanup followup](plugin-extension-view-cleanup.md) reproduces and fixes
package buffers retained by closed views' session callbacks. Native buffer
reachability and the visible app workflow pass; normal long-session memory and
representative performance acceptance remain open.

The [native layout followup](plugin-extension-layout.md) records minimum-window,
scaled-coordinate and long-title acceptance. Hidden or queued view events no
longer move focus behind host dialogs, and clipped views preserve pending reveal
until their visible layout returns. Broader UX and platform acceptance remain open.
