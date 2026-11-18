# Author documentation and packaged extension workflow

ClipCraft remains pre-alpha. This pass reconciles author documentation with the
current Node SDK and verifies installing and using an extension in a packaged
application. It does not introduce a stable API or migration guarantee.

## Author documentation

The SDK README, API guide, examples index, host status and stored-data policy now
describe the current development contract. The original API review has a
disposition table instead of presenting fixed findings as open defects. Current
guidance links native action state/icons/ordering, bound inspector controls and
adopted-media cleanup. Historical recipe and verification reports retain their
original scope and link later evidence.

The guide distinguishes Install picker cancellation from catalog mutations,
native configuration fields from clip-property fields, and supported integration
point names from TypeScript type notation. Example instructions include checking,
building, validation and packaging into a fresh archive destination.

All fourteen Node example sources were copied outside the checkout, compiled
with the public SDK, packed and revalidated. Archive and directory fingerprints
matched for each source. Service-dependent examples were not sent to real
providers; this result verifies their authoring pipeline.

## Packaged application workflow

`scripts/verify-packaged-app.cjs` now prepares an original SDK-built test archive
outside the checkout and drives the existing production renderer bridge and
native host. `scripts/packaged-extension-acceptance.cjs` is its test controller;
neither scripts nor fixtures ship in the app.

The workflow checks archive installation without execution, untrusted command
refusal, declined and accepted Node trust, settings defaults and persistence,
feature discovery, enabled toolbar artwork, a command edit with Undo, a bound
property edit with Undo, and a sandboxed workbench view. The view loads external
JS/CSS through query-bearing asset URLs, compiles WebAssembly, exchanges messages
with the real utility worker and has neither Node nor the editor bridge. Native
process IDs and preferences verify renderer separation, sandboxing and context
isolation. The shipped archive must contain both worker and view preload files.

Stop removes registrations and prevents automatic command reactivation. An
explicit start works again. A second application process uses the same isolated
profile, checks startup activation and retained settings, reopens the view and
removes the extension. Existing native-media checks still probe and extract a
frame through the app and export actual picture and sound.

The controller supplies only queued archive-picker and trust-dialog answers over
the main-process debugger. Those native dialogs are not visually automated.
The actual installer IPC, archive reader, inventory, trust store, worker, view
protocol, renderer and Undo/commit paths are exercised. Both debugger connections
and the application are terminated at the end. Output directories must be new;
the script refuses to reuse a prior profile.

Run against an existing app directory or installed app with root dependencies
available and Node 24:

```sh
node scripts/verify-packaged-app.cjs --app /path/to/ClipCraft.app --output /tmp/new-packaged-evidence
```

The command does not build an application or installer. The existing packaged-app
CI workflow calls it on its installed platform builds and now retains the
extension archive and restart log. This workflow change has been linted locally;
it has not been pushed or run remotely in this pass.

## Verification and limits

The final local run passed 69 checks across two launches of a macOS arm64 app
directory prepared with the release payload configuration and `--dir`. It was
not copied into Applications and no installer was created. The app archive
excludes development sources/tests and the bundled content pack. The retained
editor screenshot was inspected; automated screenshot pixels are not asserted.

All nine SDK verification suites passed with no source changes during the run.
Renderer compilation, structure/runtime dependencies, workflow linting, local
documentation links and whitespace checks passed. App/SDK manifests and lockfiles
were not changed. Results, source hashes, archive checksums, logs and initial
failures are recorded under `plugin-validation.json.extensionAuthoringPackaged`.

Earlier failures remain retained: the first test fixture read a revision from
the workspace summary instead of paginated inspection; the first native
controller did not wrap async expressions; and a later assertion expected a
preload filename in runtime preferences that omit it. The final workflow checks
shipped preload presence plus its functioning bridge and native isolation.
The sandbox also refused the builder cache and npm-cache writes; running those
commands with cache access corrected the environment failures. No product
runtime defect or dependency change was needed in this pass.

This is current macOS packaged-directory evidence, not a new Windows/Linux or
installed OS matrix. Full application regression, native picker/trust UI,
save/reopen dialogs, system keychain, a clean user quit, hardware budgets and
manual/assistive-technology acceptance were not exercised here. The earlier
[remote acceptance](plugin-remote-acceptance.md) retains its narrower source
snapshot and scope. Nothing was committed, pushed or published.
