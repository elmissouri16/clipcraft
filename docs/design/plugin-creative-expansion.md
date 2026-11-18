# Creative extension expansion before v1

Maintainer request: implement all six creator-facing additions. Keep SDK 0.8.0,
host API 1 and app 2.0.0; do not publish, push or build an installer.

This checklist records the full objective, not a reduced definition of success.
Each item requires its public schema/types, host validation, editor controls,
persistence/Undo where applicable, meaningful negative tests and native-app proof.

- [x] Title and caption style packs: complete reusable styles and existing text
  animations, lower thirds/headings, local bundled font references, title insertion
  and caption-style application without replacing words or timing.
- [x] LUT and color preset packs: declared .cube assets and reusable grading looks
  through the existing grading/preview/export pipelines.
- [x] Motion preset packs: bounded reusable clip zoom/pan/entrance/exit animations
  through the existing motion engine, with explicit replacement and Undo.
- [x] In-app pack creator: choose saved/current styles, looks, motion and assets;
  edit pack metadata/licenses; export a validated installable archive without JSON.
- [x] Project dependency recovery: one project-specific list of exact required
  pack versions, status, guided reinstall and explicit compatible replacements;
  preserve project references until an intentional Undoable action.
- [x] Additional asset formats: MP3/OGG sounds and TTF/OTF fonts, with extension and
  container checks, real decode/playback, packaging, persistence and export proof.

Existing manifest-only, command/panel, WAV/WOFF2 and effect/transition packages
must retain compatibility and fingerprints. Package assets remain declarative;
no install scripts, remote authored asset URLs or arbitrary reducer patches.
Use temporary generated audio and existing local fonts for verification; do not
add binary fixtures to the repository.

Final verification must inspect every checklist item against the actual code/UI,
then run the supported combined regression set against a fixed source candidate.
Unavailable platform/installer/live-service evidence remains an open release gate,
not an inferred pass. Prior selected runs do not certify this expanded candidate.


## Requirement audit

| Requirement | Implemented path | Acceptance evidence |
| --- | --- | --- |
| Title/caption styles | `pluginStyles.mjs`, manifest/SDK types, text library and inspector | Schema boundaries; bundled font binding; lower-third insertion; caption words/timing unchanged; Undo; save/restart. |
| LUT/color looks | `pluginColor.mjs`, declared cube buffers, filter/grade catalogs | Strict cube grid/domain checks; both LUT stages; exact dependency identities; measured MP4 tint; strict MP4/GIF preflight. |
| Motion | `pluginMotion.mjs`, Animation inspector, existing motion engine | Source-time/easing/base-pose boundaries; explicit replacement and Undo; saved curves; exported box movement and growth measured separately from text. |
| Native creator | `packCandidates.js`, `PluginPackBuilder`, native `packBuilder.cjs`/`packageWriter.cjs` | Private words/timing omitted; current/saved looks and static/animated poses; retained LUT intensity; native picks/licenses; exact copied assets; exclusive publication; explicit install; portable export after original removal/restart. |
| Project recovery | `pluginDependencies.mjs`, `PluginProjectDependencies` | Exact reinstall refuses wrong archives; retained/disabled/missing statuses; explicit typed all-use replacement; parameter clamping; locked targets; one-step Undo; no automatic project rebinding. |
| Extra formats | `pluginContent.mjs`, `contentAudio.cjs`, font/audio services | Container/size rejections; generated MP3/Vorbis/Opus decode checks; real MP3/OGG previews and insertion; native TTF/OTF/WOFF2 rendering in separate MP4 regions; save/restart. |

The authoring form packages reusable text/color/motion snapshots and sound/font/LUT
files. Custom effect/transition expressions retain the existing SDK authoring
workflow. System fonts remain availability-dependent unless the author picks a
licensed font file to bundle. Installed sound copies are independent of package
removal; automatic unused-copy cleanup remains separate work.

Verification is tied to the fixed executable/test source manifest below.
The macOS development matrix does not close installed-release, Windows/Linux,
native focus/accessibility, live-service or performance/soak release gates.


## Final verification — 2026-11-16

The frozen candidate contains 869 executable/test/config files;
all hashes remained unchanged during the final run. The selected regression
finished **103 PASS / 2 FAIL across 105 suites** from
310 discovered suites. The two failures require unavailable
Windows system-font fixtures and the absent sibling asset-pack manifest. All
selected plugin, SDK, creative-pack, rendering, localization and font-loading
suites passed. This is a selected regression, not a complete green release battery.

The six new contract suites contain 179 checks. The real Electron workflow passed
64 initial-process and 11 fresh-process checks without renderer exceptions or visible windows.
Measured exported motion grows the isolated box from 60 to 72 pixels wide and
moves its horizontal centroid from 65.00 to 92.64 pixels. All three font formats
render in separate MP4 regions. The native creator retains a partial LUT intensity,
bundles exact font/LUT bytes with source licenses, exports without its source pack
and exports again in a fresh process after that source is removed.

Renderer and SDK builds, structure checks, clean SDK consumer/types/templates and
`git diff --check` passed. The earlier integration candidate exposed a stale
source-text font assertion after catalog extraction; it now compares the public
font subset with the authoritative shared catalog. A previous LUT-intensity
snapshot defect was fixed before this final frozen run.

Machine-readable evidence: `plugin-validation.json` → `creativeExpansion`.
Local retained evidence: `/var/folders/_j/d8w7d_sn23348hmv9trrjm480000gn/T/clipcraft-creative-expansion-yi6f0aiw`.
SDK remains 0.8.0, host API 1 and application 2.0.0. No installer was built and
nothing was committed, pushed or published for this expansion.
