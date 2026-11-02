# AGENTS.md — working on ClipCraft

Guidance for AI coding agents (and humans) contributing to this repository.

## The originality rule

**Never copy another application's code, assets, icons, wording, or layout.**
Concept-level inspiration from other editors is allowed; every implementation,
asset, and text must be original work created for ClipCraft. If a change would
not be defensible as written-from-scratch, do not ship it.

The ClipCraft name and logo are the author's brand — they are not covered by
the MIT license grant and may not be used to brand another product.

## Working conventions

- **Push after every completed, verified feature.** This repo is synced with
  text-only snapshot pushes (binaries travel by other routes — ask before
  adding any binary file).
- **Never build/package an installer** (`.deb` / `.exe` / `.dmg`) unless Hamza
  explicitly says "build". Public releases are built by GitHub Actions from
  the `release/vX.Y.Z` branch; local packaging is for development checks only.
  Release builds exclude the bundled content pack — that difference lives in
  `scripts/prepare-release-config.cjs`, never edit the dev default in
  `package.json` to remove the pack.
- **Verify in the real app before claiming a feature works.** Drive the actual
  UI (the dev instance exposes a test harness), measure the result, and
  report failures as failures — with the reason, not a softened summary.
- **Test battery baseline:** 79 PASS / 6 FAIL of 85 suite files; the 6 failures
  are environment-only (Windows-only suites, a telemetry endpoint, network and
  fixture availability in the sandbox). A change that moves this number needs
  an explanation in the commit message.
- **One editor on the tree at a time.** Perf, crop and UI workstreams do not
  edit the tree concurrently; coordinate through the maintainer.
- **Numbers come from disk.** Any benchmark or verification figure you cite
  must be re-read from its evidence file in the same step that cites it.

## Layout

- `src/` — React renderer (store + dispatch, panels, timeline, preview).
- `electron/` — main process: export engine (`ffmpeg.cjs`, `layers.cjs`),
  captions, templates, pack and update feeds (host-gated, renderer never
  supplies URLs).
- `shared/` — LUTs and shared data. `bundled-templates/` — generated template
  packages (regenerate with `scripts/make-bundled-templates.cjs`, never
  hand-edit the media).
