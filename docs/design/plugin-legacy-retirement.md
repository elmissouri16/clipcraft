# Historical executable retirement

The pre-v1 public execution model is the trusted general Node host described in
[host status](plugin-extension-host.md). App 2.0.0, SDK 0.8.0 and host API 1 remain
unchanged. The old executable contracts are no longer a second supported runtime.

## Public surface

- `main: "dist/extension.cjs"` selects the Node host. Commands, events, services,
  hooks, views, native UI and managed processes/jobs compose features.
- Speech, AI and upload behavior belongs in ordinary extension services and
  commands. There are no specialized executable manifest kinds.
- Data-only creative packs continue to use bounded contribution schemas for
  effects, transitions, export presets, sounds, fonts, text, LUT/color and motion.
- The SDK defaults to the Node template. `defineCommand`, `connectPanel`, command
  permissions and recipe templates are retired. Read-only `inspect` identifies
  historical packages; `validate`, `build` and `pack` reject their executable form.
- The old sandbox/panel processes, preloads, protocols, provider transport,
  specialized local-tool/GIF/upload services and corresponding editor IPC methods
  have been removed. Workbench views keep their isolated message-only renderer.

## Saved data and immutable packages

Private compatibility parsing validates historical bytes and strips executable
contributions from the live manifest. It does not import authored code. Existing
command/panel hash salts and byte ordering stay unchanged, preserving saved
creative dependencies. Historical scripts remain inert package bytes.

Executable-only historical packages are always unavailable for execution. Mixed
packages can expose their creative data. Settings identifies the migration and
allows explicit removal or saved preference cleanup. Intact historical preference
namespaces can be reviewed/copied as data, including when their executable is
disabled. Recovered/removing/corrupt packages cannot receive copied preferences.
The host never guesses conversions into a Node extension's configuration/secrets.

The same ID, publisher and version may have both an old historical payload and
its rebuilt Node replacement. They retain distinct immutable fingerprints; Node
trust never transfers from the historical package. The historical creative
contribution stays preferred unless the enabled Node replacement declares the
same kind/ID. Disabling/removing the Node replacement retains old dependencies.
Different Node bytes at the same Node version still reject atomically.

Saved `plugin-provider:` selections, labels, models and encrypted credential bytes
remain in settings. They are displayed as retired/unavailable and refuse before
transport, decryption or fallback. Ordinary Node AI service choices retain their
separate current integration.

## Native activity and export

General action registrations include `location: 'export'`, discovered through
`ui:export`. The GIF and reviewed-upload sources contribute this ordinary action;
the export sheet has no fixed GIF recipe selector. Completion is attributed to
the extension. Managed jobs have native progress/cancellation in Settings and a
global activity tray when another host surface does not already own their UI.
Cancel is scoped to the exact package generation and operation.

## Test transition

Old command/panel/provider recipe tests and smoke modes were removed with the
runtime they exclusively exercised. They are not skipped as successful tests.
Their historical source/evidence remains in repository history and earlier
validation checkpoints. Suite counts therefore cannot be compared to the old
79/6 or later candidate baselines without this change in scope.

| Retired executable path | Current coverage |
| --- | --- |
| Sandbox commands and provider-specific agent tools | `test-extension-runtime`, `test-extension-agent-tools`, `test-extension-agent-commands`, native `test-extension-agent-ui` |
| Permissioned panels and action catalog | `test-extension-views`, native views/host/development/shortcut/message suites, `test-extension-native-ui` |
| Panel-local data and version updates | Retained storage/preference-migration, inventory recovery and removal fault-injection suites; native recovery/removal/restart |
| Fixed GIF/export/upload worker recipes | Native extension output examples, general export/media/process/job/file suites and native retirement export action |
| Speech/model/local-tool recipes | Ordinary local-speech source and native output-example workflow |
| Specialized provider/AI chapters/translation | Extension AI/service/host-service/caption suites and native AI/caption examples |
| Old native edit recipe controls | Current extension commit/draft/inspection/hooks/agent UI; retained planner/property/automation/lifecycle/link/ripple regression suites |

Pure private edit-planning tests still use explicit historical metadata parsers
where they verify old declaration shapes. Those tests do not expose retired
manifest fields through the public SDK. Exact historical examples were moved
unchanged to `tests/fixtures/plugins/legacy` and are covered by
`test-plugin-legacy-retirement`. Current runnable sources live in
[examples/extensions](../../examples/extensions/README.md).

This implementation does not close the full regression, ASAR, abuse or
Windows/Linux release gates. See [release readiness](plugin-release-readiness.md)
and the current validation ledger for the source and evidence of each run.

## Final local verification

The completed frozen full run contains 326 suites: 314 raw PASS, 12 FAIL and no
timeouts. Two raw PASS entries are whole-suite opt-in skips. Raw results remain
unchanged. Focused followups corrected the migrated voice fixtures, the missing-key
status label and the mixed-pack GIF path. The clipboard test passed separately
with normal activation; its quiet full-run failure remains recorded.

The GIF correction also adds `workspace.read().export_duration_sec`, separate
from total document `duration_sec`, in live and preparation-draft reads. Both GIF
examples now choose ranges from the same renderable video extent as native export.
Actual mixed WAV/MP3/OGG and WOFF2/TTF/OTF content passed preview, Undo, dependency
recovery, native MP4/GIF output and restart checks. The encoded GIF font frame was
inspected, as were the migration notice and global job progress/cancellation UI.

Six full-run cases remain unresolved: two caption suites need platform/audio
prerequisites, the font suite needs Windows font fixtures, the asset suite needs
its sibling manifest, SRT needs its private fixture, and the live library search
returned zero music results. The last result is not waived as an environment-only
failure. Windows/Linux and full installed-app acceptance remain open.

The later [stabilization checkpoint](plugin-extension-stabilization.md) resolves
the local SRT, portable-font and POSIX caption prerequisites in separate runs.
It preserves this full run's original results. Windows captions, the missing
sibling asset manifest and the live zero-music result remain open, alongside
platform and installed-app acceptance.

Exact source snapshots, changed-file lists, full and focused results, versions,
archive-only runtime evidence and captured artifacts are linked from
`plugin-validation.json.extensionHostLegacyRetirement`. No app, SDK, host API or
example version was incremented. No commit, push or installer was made.
