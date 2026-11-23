# CLI and packaging

Use the CLI from a built checkout as `node packages/plugin-sdk/dist/cli.cjs`, or use `clipcraft-plugin` from a project that has the packaged SDK installed. Run commands against the source workspace while developing. Switch to its compiled `dist` directory for installation and distribution.

| Command | Input | Result |
| --- | --- | --- |
| `create` | New directory, package ID, display name, publisher and optional template | A source workspace with a manifest and the selected starter. |
| `check` | Source workspace | Diagnostics for manifest, source and declared assets. |
| `build` or `watch` | Source workspace | Validated content in `dist`. Watch rebuilds when files change. |
| `validate` | Built folder or archive | Admission checks using the host’s package rules. |
| `pack` | Built folder and an unused archive path | An installable `.tgz`. |
| `inspect` | Built folder or archive | Identity, fingerprint, contributions and migration status. |

The [first extension](../../packages/plugin-sdk/README.md) and [creative pack](creative-packs.md) tutorials show both workflows from start to finish.

## Directory layout

| Path | Role |
| --- | --- |
| `plugin.json` | Identity, contribution IDs, compatibility and optional entry point. |
| `src/extension.ts` | Node activation and registration. Data-only packs omit this entry. |
| `src/assets/` | Source assets. Declare packaged assets using their `assets/…` paths. |
| `dist/` | Installable package produced by a successful build. |

## Command syntax

```text
clipcraft-plugin create <new-directory> --id <id> --name <name> --publisher <author>
clipcraft-plugin check <source-project>
clipcraft-plugin build <source-project>
clipcraft-plugin watch <source-project>
clipcraft-plugin validate <dist-folder|archive.tgz>
clipcraft-plugin inspect <dist-folder|archive.tgz>
clipcraft-plugin pack <dist-folder> <new-archive.tgz>
```

`--template`, `--app-version`, `--json`, `--help` and `--version` are available.
Strict Node type checks use the SDK's compiler configuration without rewriting
the author's configuration. A failed build preserves the prior validated output.
Build ownership protects externally modified output. Packing uses captured
validated bytes, enforces the app's 64 MiB compressed-archive limit and publishes
only the complete archive. Existing output is never overwritten, including when
another writer creates the destination while compression is running. Failed
compression removes private staging without publishing a partial destination.
Watch rebuilds local output and warns when changed bytes reuse a version; it
never installs, trusts or activates code. Source-folder development sessions have
separate temporary trust/settings, captured builds and ordered reload.

Node builds resolve the canonical project directory and bundle from its relative
`src/extension.ts` entry. Moving an unchanged project with the same local dependency
layout, or invoking the CLI from another working directory, preserves its payload
bytes and fingerprint. Compiler or input changes can still change the payload;
archive timestamps are not normalized. Existing immutable installed packages are
not rewritten by this authoring change.


## Package files and limits

Node payload paths must be portable across supported filesystems. Use consistent
letter case for every file and directory, avoid Windows device names and trailing
dots, and never use the same path as both a file and a directory. The SDK and
native installer reject ambiguous packages before writing their payload. Node
packages are limited to 4,096 files and 32 MiB per file, with the existing smaller
manifest/declared-creative-asset limits and 128 MiB total limit still applying.
The combined set of files and implied directories is limited to 8,192 path nodes.
Archives have a separate 8 MiB plus 1 KiB allowance for tar headers, padding and
metadata; these bytes do not consume the 128 MiB payload budget. The reader
accepts one gzip layer, rejects unsupported/skipped entries and oversized
metadata, and keeps the 64 MiB compressed limit. SDK-generated long paths use
ordinary PAX metadata within that allowance.
Folder scans also count empty directories, reject nonportable or overlong
directory prefixes, and keep one directory handle open at a time. SDK source
JSON and asset capture use bounded descriptor reads, including when a file grows
after its initial size check. Node assets declared as creative content reuse the
same captured bytes for validation and output.

New creative-pack builds, installs and development snapshots apply the same
portable-name checks to their declared assets. `check` rejects ambiguous asset
declarations before reading files. Read-only `inspect` can still identify an
existing creative payload and its exact fingerprint; run `validate` before
trying to install or redistribute it.
Supported pack formats include WAV/MP3/OGG, WOFF2/TTF/OTF and CUBE. Effect and
transition definitions use bounded expressions or GLSL ES 3 fragment functions.
Saved project references pin exact asset and package fingerprints. Use
`rendering.list` to discover installed definitions and `rendering.validate` to
check parameters and compile on the host GPU. [GLSL contract](../design/plugin-glsl.md)

The app's creative browser previews, favorites and applies these contributions.
Temporary author previews cannot become saved project dependencies. The separate
creative preset test uses the real native export pipeline.


## Historical packages

The `entry: "commands.js"` runtime, `defineCommand`, `connectPanel`, command
permissions and specialized `panels`, `aiProviders`, `localTools`, `actions` and
`exportDestinations` declarations are retired. They cannot be authored, packed
or executed through this SDK. `inspect` can identify historical packages and
report `migrationRequired` without running them.

Historical package bytes, creative assets, fingerprints, saved preference data
and saved provider choices remain readable. The app labels old executable
packages as requiring migration. Their scripts and providers do not run; an old
selected provider stays unavailable until the user chooses a supported engine.
Old preference namespaces may be reviewed/copied between intact historical
versions or explicitly cleared; they are never guessed into Node settings.

A rebuilt Node replacement with the same ID, publisher and version can coexist
with the historical immutable package. It receives its own fingerprint and fresh
trust. Retained creative dependencies stay available. Changed Node bytes at an
already-installed Node version still require a normal author version change;
this migration exception does not permit replacing immutable payloads.

## Runnable sources

See [general Node examples](../../examples/extensions/README.md) for commands,
views, settings, file/media jobs, GIF export/upload, local speech, AI chapters,
caption translation and the optional VoiceStudio connector. Creative packs live
under [examples/plugins](../../examples/plugins). Historical executable fixtures
live only under `tests/fixtures/plugins/legacy`.

The repository's `docs/design/plugin-extension-*.md` documents describe each
host contract and its evidence. Older recipe design documents are historical.

See [compatibility, storage and distribution policy](../design/plugin-sdk-compatibility.md)
for exact update, rollback, uninstall, recovery and trust behavior.

## Verify the SDK checkout

Install the root and SDK lockfile dependencies before verification. Root dependency
installation needs Node >=22.12 for Electron's installer; SDK checks can then run
on Node >=20.19.0. Keep the npm cache available for the offline consumer check.

```sh
npm ci --no-audit --no-fund
npm ci --prefix packages/plugin-sdk --ignore-scripts --no-audit --no-fund
npm run sdk:cache
npm run sdk:verify
```

The command runs the SDK contract, authoring, admission, archive, publication and
clean-consumer suites sequentially. It saves logs and source hashes in a new OS
temporary directory. Only a complete pass with unchanged source produces a
candidate SDK tarball and checksum. To select the evidence location, pass
`-- --output <new-directory-outside-checkout>`; its parent must exist and existing
output is never reused. Leave source unchanged while the command runs.

`sdk:cache` is an online preparation step: it builds/packs the SDK and installs
it into a disposable consumer so npm caches registry metadata as well as package
archives. Lockfile-only installs may leave that metadata uncached. It does not
publish or modify checkout manifests/lockfiles. The later clean-consumer test
still uses `--offline` and fails if required cache entries are unavailable.

This checks development artifacts. It does not launch Electron, publish to npm,
build an installer or approve a release. The repository's SDK validation workflow
runs the same command across its declared OS/Node matrix and retains evidence.
See [SDK validation and its remaining gates](../design/plugin-sdk-validation.md).


## Extension and pack icons

Set an optional top-level `icon` in `plugin.json`, for example
`"icon": "assets/identity.png"`. Place the source image at
`src/assets/identity.png`; the SDK includes it in the built package. Directly
packaged creative payloads use `assets/identity.png` beside their manifest.

Use a static PNG, ideally a square 128×128 or 256×256 image with transparent
padding. The maximum is 256 KiB and 1024 pixels on either axis. Paths must be
flat under `assets/`; remote URLs, SVG and animated PNG are not accepted.
Artwork is part of the package fingerprint. Packages without an icon continue to
work and receive a stable monogram in ClipCraft's plugin manager. The icon grants
no execution rights and can be shown before an extension is trusted or active.
