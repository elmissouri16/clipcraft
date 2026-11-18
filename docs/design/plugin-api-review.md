# Plugin API review, 2026-11-18

App 2.0.0, SDK 0.8.0 and host API 1 remain unchanged. The maintainer asked for
the extension API to be checked for defects and for what stops an extension
from adding arbitrary features to the editor, then documented and tested. This
records what was found, what changed and what remains. The author-facing result
is the [Extension API guide](plugin-extension-api.md).

## Method

Four independent read-only passes covered the runtime core, the IO services,
UI and views, and the document edit contracts. Each reproduced its findings
with scripts against the real modules under plain Node. Separately, one
extension that calls every namespace was built with the SDK CLI and run in the
real editor. Fixes were then checked against the same reproductions and turned
into repository suites.

## Defects fixed

Lifecycle and runtime:

- Installing, enabling, removing or recovering any plugin stopped every
  extension and nothing restarted them, also when the user only cancelled the
  file picker. The extensions that were running now resume afterwards.
- One extension that failed to activate kept every later one from starting for
  that event (startup, a UI location, voice engines). All matches are now tried.
- A trusted extension without `activationEvents` did not run after a restart, so
  the toolbar action from the SDK quick-start disappeared. No declaration now
  means "start with the app"; a declared list, or `[]`, activates lazily.
- Cancelling a save or an assistant run while an extension was still starting
  marked it failed until manual activation.
- A handler that rejected with `undefined` or threw `null` crashed the worker's
  error path. A stray rejection in authored code ended the activation; it is
  now logged.
- Overlapping stops ran `deactivate()` twice; a start during a stop reported
  success for an activation that then ended.
- Waiting on a managed process, another extension or a message counted against
  the five-minute handler deadline, so the caller was killed instead of the
  slow party.
- A view's close callback still pending after five seconds killed the whole
  extension. Revealing a declared view from `activate()` while the user's own
  open had triggered that activation deadlocked until the deadline.
- Typed services rejected an optional property passed as `undefined`.
- `configuration.changed` reported user edits in the settings form as the
  extension's own. A service could list itself as a host service.

IO:

- `processes.spawn().result` never settled when a descendant kept the output
  pipes open, which also blocked Stop, restart and plugin management.
- `files.publish` always failed on FAT/exFAT volumes and left the file behind;
  the pack writer failed there too. Published files were always mode 0600.
- `media.import` reported unrotated sizes, unrounded frame rates and no HDR
  flag, unlike the editor's own probe. A picture that cannot be decoded was
  accepted, and the export encoder then retried it forever at full CPU; the
  editor's probe and the extension import now both refuse it.
- A package with an installed ID from another publisher was accepted as an
  update and could read the first publisher's stored secrets.
- On Windows the archive reader admitted backslash entry names (recorded in
  [remote acceptance](plugin-remote-acceptance.md)).

Editing:

- `editor.apply`, `captions.write` and `media.insert` went stale whenever the
  playhead or selection moved, which is constantly during playback.
- `captions.write` accepted overlapping cues and the layout pass then moved
  cues and existing titles onto other tracks, including locked ones.
- `media.insert` could land the new clip on a locked track or move an existing
  clip there. It also ignored a named track without `lane` and returned an ID
  that `editor.apply` could not use; it now also returns a handle.
- Splitting or trimming a main clip was rejected at random when a linked
  picture/audio pair came later on the track (a floating-point comparison).
- A frame-snapped trim start on a free track could be rejected as out of
  bounds. Effects-track edits rejected overlaps the editor allows.
  `set-effect` refused LUT filter layers; `attach-effect` accepted a filter look
  that never renders on a single clip.

UI:

- Erasing a typed secret and running any action deleted the stored secret;
  clearing a number field stored zero.
- The plugin page listed every action from every location and ran clip-context
  actions without their context.
- Declared setting defaults were shown in the form but `configuration.get`
  returned `undefined`.

## Added

- `context.editor.tools`: the editor's own editing tools (the set CraftAI
  uses) as one validated, atomic, single-Undo batch. This closes most of the
  editing gap: titles and their full styling, transitions, filters and colour,
  animation, compositing, audio effects, tracks, stock and sounds, voice-over
  and project settings were previously unreachable from an extension.
- View script errors, including blocked inline scripts, appear in the
  extension's log.
- Editor types are exported from `@clipcraft/plugin-sdk/extension`; confirmed
  limits are stated in the declarations.

## Behaviour changes authors will notice

- An extension without `activationEvents` starts at launch.
- Overlapping caption cues and occupied-track media insertions are refused
  instead of being rearranged.
- A same-ID package from another publisher is refused while the first is
  installed, and never inherits its settings or secrets.
- Two existing suites encoded the old behaviour and were adjusted:
  `test-extension-hook-runtime` appended duplicate overlapping cues, and
  `test-extension-shortcuts-ui` relied on the lazy default for a cold-start
  check and now declares `activationEvents: []`.

## Evidence

- `tests/unit/plugins/test-extension-reliability.cjs`: 11 checks on the real
  runtime and worker (`tests/fixtures/extensionRuntimeHarness.cjs`).
- `tests/unit/plugins/test-extension-edit-regressions.mjs`: 9 checks.
- `tests/unit/plugins/test-extension-api-ui.cjs`: 49 checks in the real editor
  with the fixture in `tests/fixtures/extensions/api-probe`.
- `tests/unit/media/test-probe-pictures.cjs`.
- Full macOS battery on the final tree, two workers, quiet profile: 357 PASS /
  2 FAIL of 359 suites. The failures are the Windows-only caption prerequisite
  and the absent sibling asset manifest (`audio/test-captions.cjs`, `library/test-assets.cjs`).
- FAT behaviour was confirmed once on a temporary exFAT image on macOS; it is
  not part of a suite and was not checked on Windows or Linux.
- The settings-form fixes were confirmed with the review's script against the
  real component under a minimal hook runtime, not in the rendered page.

## Known and not fixed

- A plugin-management action still stops extensions before its file picker
  opens. They resume, but an in-flight job is cancelled.
- Host calls started in a handler and not awaited are cut off when the handler
  returns. This is the scope rule, now documented.
- `hooks.register` and `ui.registerIntegration` accept any name; only the four
  document hooks and the two integration points are ever used, so a typo is
  silent.
- `events.on(..., {replay: true})` replays per activation, so a second listener
  re-delivers the retained event to the first.
- `configuration.update` stores non-JSON values in their serialized form
  without an error. Setting `step` is not enforced, and a select without a
  default shows its first option while nothing is stored.
- A view's `getInfo().theme` is the default theme until the first
  `onThemeChanged`; that callback also fires on every layout. View asset URLs
  cannot carry a query string. WebAssembly in views is probably blocked by the
  content policy; this was not verified.
- Copies of inserted media under `extension-media/owned` are never collected.
- `applied` in `editor.apply` and `markers.apply` counts submitted operations.
- `ClipTextStyle` offers five fonts and written captions use one fixed style;
  the editor tools cover the rest.
- The capability gaps listed in section 5 of the guide.
