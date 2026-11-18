# ClipCraft plugin SDK

SDK **0.8.0**, application **2.0.0**, host API **1**. These versions stay unchanged
while the pre-v1 extension work is completed. The release/platform gates remain
open; this is a development SDK.

Executable plugins are trusted, persistent **Node extensions**. Use commands,
events, services, hooks, managed work and native UI registrations to compose a
feature. Speech, AI, media tools and uploads use those same APIs. Creative packs
remain declarative data and licensed assets.

## Start an extension

From a ClipCraft checkout:

```sh
node scripts/build-plugin-sdk.cjs
node packages/plugin-sdk/dist/cli.cjs create /tmp/my-extension \
  --id studio.my-extension --name "My extension" --publisher "Studio"
node packages/plugin-sdk/dist/cli.cjs check /tmp/my-extension
node packages/plugin-sdk/dist/cli.cjs build /tmp/my-extension
node packages/plugin-sdk/dist/cli.cjs pack /tmp/my-extension/dist /tmp/my-extension.tgz
```

The default template is `extension`. Install the compiled `dist` folder or the
archive in Settings → Plugins. Source workspaces are not installable payloads.
For a shared SDK tarball, install it with `npm install --save-dev <sdk.tgz>` and
use its `clipcraft-plugin` command. Generated projects initially reference the
SDK installation that created them; replace that local dependency when sharing.

```json
{
  "id": "studio.my-extension",
  "name": "My extension",
  "publisher": "Studio",
  "version": "0.1.0",
  "apiVersion": 1,
  "main": "dist/extension.cjs",
  "contributes": {
    "commands": [{"id": "hello", "name": "Say hello"}]
  }
}
```

```ts
import type {ExtensionContext} from '@clipcraft/plugin-sdk/extension';

export async function activate(context: ExtensionContext) {
  await context.commands.register('hello', async () => {
    await context.ui.showMessage({message: 'Hello from Studio.'});
    return {message: 'Hello completed.'};
  });
  await context.ui.registerAction({
    id: 'hello-button', title: 'Say hello', location: 'toolbar', command: 'hello'
  });
}
```

Registered IDs are scoped to the package. The public command above is
`studio.my-extension.hello`. Declared commands support lazy activation; optional
`activationEvents` use `startup`, `command:<id>`, `event:<topic>`,
`service:<id>`, `hook:<id>`, `view:<id>` or `ui:<location>`. Register actions for
`export` with `ui:export` when they should be discovered from the export dialog.

Installation, validation and inspection do not evaluate authored code. Trust &
activate authorizes full Node access to files, programs and the network. This
is a trust boundary, not a Node security sandbox. Package trust is tied to its
exact fingerprint. Stop removes registrations and managed work. Explicit start
is required after a stop, crash or timeout in the current app session.

## General host APIs

The published declarations are the API reference:
[`extension.d.ts`](src/extension.d.ts) and [`index.d.ts`](src/index.d.ts).
Every call is checked against the activation that issued it.

| API | Purpose |
| --- | --- |
| `commands.register/execute` | Register and compose commands; declared commands can be offered to CraftAI with native review. |
| `events.on/emit` | Ordered application events and namespaced custom topics, cancellation, replay and bounded queues. |
| `services.register/list/call/stream` | Ordinary cross-extension and application services; streams pull bounded values or bytes. |
| `hooks.register` | Save/export validation and private preparation drafts with cancellation and one Undo. |
| `workspace.read/inspect/readValue` | Document summary, complete paginated inspection and lazy nested values. |
| `editor.read/apply` | Public editor handles and validated atomic edit transactions. |
| `markers.apply` | Add, update or remove document markers through revision-scoped transactions. |
| `captions.read/write` | Read cue pages; append, replace or create a separate caption track. |
| `media.import/preview/insert/release` | Inspect local files/bytes, preview them and adopt durable timeline media with Undo. |
| `exports.render` | Native video pipeline, preparation hooks, range/quality controls, progress and verified output metadata. |
| `files.publish` | Protected file publication with checksum, byte count and atomicity receipt. |
| `processes.spawn` | Literal executable arguments, bounded output, deadlines, cancellation and tracked cleanup. |
| `jobs.run` | Managed long work with native progress and cancellation from Settings or global activity. |
| `configuration` / `secrets` | Global or project settings and encrypted global secret storage. |
| `ui` | Native settings, actions, shortcuts, messages, file dialogs and isolated workbench views. |
| `host.read/capabilities` / `log` | Host/tool information, versioned feature discovery and bounded attributed diagnostics. |

Use the returned document/revision and public clip handles when applying edits.
`workspace.read().duration_sec` includes all timeline tracks;
`export_duration_sec` is the native video output extent. Use the latter when
choosing video/GIF ranges, including when audio or titles extend past the picture.
The host rechecks the real project, tracks, locks, dependencies and cancellation
before commit. Inspect the full document when a bounded editor summary does not
contain the target. A failed or stale transaction does not partly edit the project.
Managed processes have explicit bounds; subprocesses created through raw Node
remain the author's responsibility.

Workbench HTML receives a message-only bridge in an isolated renderer. Privileged
operations belong in the Node activation. Native settings support strings,
numbers, booleans, choices and masked secrets. Actions can appear in the toolbar,
inspector, clip context, export dialog or supported settings locations.

Core integrations consume ordinary service registrations at `voice.engines` and
`ai.engines`. The selected core AI connection is also available through the
application service `clipcraft.ai`; the core keeps its credentials private.
These integration points do not introduce new executable manifest kinds.

## Feature discovery, service contracts and project settings

For versioned feature discovery, typed service contracts, project settings and
development debugger usage, see [general SDK contracts](../../docs/design/plugin-sdk-general-contracts.md).

```ts
import {defineServiceContract} from '@clipcraft/plugin-sdk/extension';

const contract = defineServiceContract({version: 1, methods: {
  length: {input: {type: 'string', maxLength: 1000}, output: {type: 'integer'}}
}});
// In activate(context):
// await context.services.registerTyped('text', contract, {length: text => text.length});
// const client = await context.services.connect('studio.example.text', contract);
// const length = await client.call('length', 'Hello'); // inferred number
// const {documentId} = await context.workspace.read();
// await context.configuration.update({scope: 'project', documentId, key: 'mode', value: 'draft'});
```

## Creative packs

Available templates:
`extension`, `effect`, `transition`, `export-preset`, `content-pack`,
`text-style-pack`, `color-pack`, `motion-pack`.

Creative contributions include `effects`, `transitions`, `exportPresets`,
`sounds`, `fonts`, `textStyles`, `luts`, `colorPresets` and `motionPresets`.
A Node extension can declare creative contributions in the same manifest.
A data-only pack omits `main` and has no executable entry.

Put source assets under `src/assets` and declare their final `assets/...` names
in `plugin.json`. The builder copies declared creative assets; Node packages can
also package supported recursive view/assets files. Include actual licenses.

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
transition expressions use ClipCraft's bounded expression contract, not arbitrary
JavaScript. Saved project references pin exact asset/package fingerprints.

The app's creative browser previews, favorites and applies these contributions.
Temporary author previews cannot become saved project dependencies. The separate
creative preset test uses the real native export pipeline.

## Authoring commands

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

See [compatibility, storage and distribution policy](../../docs/design/plugin-sdk-compatibility.md)
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
See [SDK validation and its remaining gates](../../docs/design/plugin-sdk-validation.md).


### Extension and pack icons

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
