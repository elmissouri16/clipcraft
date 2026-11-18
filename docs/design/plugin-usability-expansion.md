# Plugin usability expansion before v1

Maintainer request: implement all four proposed additions. Keep SDK 0.8.0,
host API 1 and app 2.0.0. No push, publication or installer build.

- [x] Pack browser: installed content search, type/tag filtering, persistent
  favorites and actual previews before application for titles, transitions,
  motion presets and LUTs (plus other supported pack content).
- [x] Upgrade preferences: explicit reviewed migration between verified installed
  versions of the same plugin/panel, preserving the source, identifying conflicts,
  bounding JSON and refusing stale or revoked approvals. Provider credentials
  and grants are not transferred.
- [x] Live authoring: edit compiled effect/transition/LUT content and preview it
  immediately through watched developer snapshots without reinstalling; reject
  invalid reloads and keep temporary identities out of saved projects.
- [x] Storage cleanup: report storage use and review/removal of unused replayable
  cache content while protecting project-owned media, installed packages,
  active previews and unknown files. Separate preview buffers from durable media.

Acceptance requires bounded service/contract negative tests, clean SDK compatibility,
real Electron UI workflows (including measured previews, cancellation/reload,
restart/persistence and preservation of project/history), renderer/SDK builds,
structure/localization checks and a frozen combined regression with retained logs.
The platform/installed-release and performance gates remain separate release work.

## Using the features

Settings → Plugins → **Browse creative packs** lists enabled installed content.
Search combines content names, plugin names/IDs, publisher labels and derived
content tags; type and tag filters combine with Favorites only. Stable favorite
identities survive an installed version upgrade and a fresh process. The browser
shows a bounded page of results and renders only the explicitly selected sample.

Select an item to see the original sample scene through the existing text,
shader/transition, LUT/grading or motion engine. Play and scrub the preview;
effect/transition parameters change the actual rendered expression and are passed
to Apply. Sound previews use the normal local decoder. Preview failure prevents
Apply. No sample uses project media or adds history. Apply fetches the installed
contribution again, uses an appropriate explicitly selected timeline clip and
commits through ordinary Undo actions. New titles and sounds insert at the
playhead; caption styles apply without replacing measured words or timings.
Locked targets reject the entire update; text/font application strictly checks
font decoding and refuses if the project changes while waiting.

Select an enabled plugin version in Installed plugins to **Copy preferences from
another version**. Choose an intact installed source with matching plugin ID,
publisher label, panel ID and local-storage grant. Review names, byte counts and
conflicts for individual keys. Values remain host-owned until selected copying;
existing destination keys need an explicit replacement checkbox. Source bytes,
unselected keys, grants and provider credentials stay intact. Publisher labels
are unverified, as elsewhere in the manager; this is an intentional user-reviewed
copy, not automatic publisher trust or plugin access to another version's data.

A review is single-use and expires after five minutes. Re-read both packages and
source/destination preference state at confirmation. Changes, revocation, corrupt
JSON, symlink locations, invalid keys and combined destination quotas refuse the
operation. Selected bounded JSON is published atomically as one panel file. No
migration script runs. Source versions must still be installed when reviewed.

Developer mode → **Start session** also accepts compiled effect, transition,
LUT, color-look and motion packages. **Live rendering preview** uses an isolated
sample and never registers temporary render identities with the editor catalog.
**Watch compiled builds** reloads changed valid bytes automatically. Invalid
output revokes the old snapshot and removes its sample; correcting the output
recovers through the existing watcher. Reload/end/quit retire old keys. Project
history and installed inventory remain unchanged, and no Apply action exists for
these samples. Install a finished package before using it in a project. The editor
never invokes build scripts. Temporary provider/export-preset tests are separate
[development controls](plugin-development.md), with transient credentials and
detached short-export snapshots.

**Plugin storage → Review storage usage** reports installed package bytes, panel
preferences, protected sound-media copies and managed sound-preview cache bytes.
Replayable preview files now live in `.preview-cache`; Add still creates durable
`pack-sounds` media. Review lists active and unused previews. Remove reviewed unused
previews deletes only known regular, unleased preview files and invalidates a
stale/expired review. Unknown files and symlinks are excluded. Active browser/audio
library previews are protected; closing them makes the files eligible for a new
review. Renderer navigation/crash/closure releases orphan leases and prevents late
decoder completion from resurrecting them. Preview cache growth is capped at
512 MiB until explicit cleanup. Source audio is validated/probed before playback.

Project-owned sound copies, including legacy files previously used for previews,
are retained: external saved projects can still reference them. This feature does
not guess that a media file is orphaned by scanning only the current project. It
does not remove installed packages, panel data or projects. Such deletion stays
an explicit separate user action through the existing manager/project controls.

## Requirement audit

| Requirement | Implementation | Acceptance evidence |
| --- | --- | --- |
| Search, tags, favorites and previews | `shared/pluginBrowser.mjs`, `browserPreferences.cjs`, `PluginPackBrowser`, `PluginContentPreview` | Combined filtering, stable validated favorites, restart persistence, actual rendered samples for every creative kind, measured transition/motion endpoints and LUT tint, explicit application and Undo, locked targets and unchanged read-only project/history. |
| Upgrade preference preservation | `preferenceMigration.cjs`, `PluginPreferenceMigration`, existing `PanelStorage` | Selected JSON keys, conflict approval, source preservation, quota/corruption/path/stale/revocation refusals; actual upgraded panel loads copied values before and after a fresh process. |
| Live authoring previews | Existing `DevelopmentSessions`, `contentPreview.cjs`, `PluginAuthorPreview` | Watched effect and transition expressions and cube-asset edits change measured pixels; invalid reloads revoke old keys; corrections recover; no installed inventory or saved project/history changes. |
| Safe cache cleanup | `previewCache.cjs`, `PluginStorageCleanup`, browser/audio-library preview leases | Measured storage classes, active preview protection, stale/single-use review refusals, unknown/symlink retention, lifecycle/in-flight revocation; native cleanup preserves adopted timeline audio and subsequent MP4 export/restart. |

Host editor-only IPC checks and the existing panel/command IPC guard apply to all
new operations. The plugin SDK's panel storage API remains scoped to its exact
version; cross-version copying is exclusively a trusted host UI operation.


The combined compatibility pass exposed a pre-existing Audio library catalog-arrival
race: selecting Library before its asynchronous catalog loaded could leave a
placeholder collection in content state while the chooser displayed the first
real collection. The Audio tab now reconciles invalid collection selections when
catalog data arrives or changes. The original creative-pack workflow verifies the
real sound library, previews/Add, fonts/LUTs, export and restart; the editor-space
UI check covers its existing project-audio navigation.

The native usability workflow also measures effect parameter changes and confirms
Apply stores the exact previewed value in one Undo step. Test readiness waits target
actual loaded catalogs/storage reviews/current rendering generations. React warnings
remain failures; the migration component's duplicate sibling key was corrected
before the final candidate. Localization uses the repository's punctuation policy.


## Final verification — 2026-11-16

The frozen candidate contains 885 executable/test/config files; its source hashes
remained unchanged throughout the combined run. Results: **108 PASS / 2 FAIL
across 110 selected suites**, out of 314 discovered suites. The two failures
require unavailable Windows font fixtures and the absent sibling
`asset-pack/library-manifest.json`. All selected plugin, SDK, creative-pack,
editor-space, preview/font and localization suites passed. This selected regression
is not a complete green production-release battery.

The three new contract suites contain 51 grouped checks. The combined real Electron
workflow passed 53 initial-process and 6 fresh-process checks with no renderer
exceptions or visible windows. It measures parameter/effect changes, transition
and motion endpoints, LUT tint and watched effect/transition/cube changes; verifies
explicit application/Undo and locked targets; preserves read-only project/history;
loads migrated settings in the actual upgraded panel; persists favorites; protects
active previews and durable audio through cleanup, MP4 export and restart. The
original creative-pack workflow also passed 75 initial/restart checks, and the
existing editor-space UI suite passed.

Renderer/SDK builds, structure/import checks, localization and `git diff --check`
passed. The clean SDK consumer tests cover the existing author types/templates.
The earlier candidate retained its failures; its audio catalog-arrival and
localization-policy fixes are recorded in the evidence history.

Machine-readable evidence: `plugin-validation.json` → `usabilityExpansion`.
Local retained evidence: `/var/folders/_j/d8w7d_sn23348hmv9trrjm480000gn/T/clipcraft-plugin-usability-l_k551s1`.
SDK remains 0.8.0, host API 1 and application 2.0.0. No installer, commit, push or
publication was performed. The existing installed-release/ASAR, Windows/Linux,
native-focus/accessibility, live-service and performance/soak gates remain open.
