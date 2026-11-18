# SDK compatibility and stored data

This records current development behavior for trusted Node extensions and
creative packs. ClipCraft is pre-alpha: breaking API changes are allowed and
stable compatibility, migration guarantees and a v1 freeze are not required.
App 2.0.0, SDK 0.8.0 and host API 1 are the current version numbers, not a promise
that every development snapshot is interchangeable. Stored-data protections
below describe the implementation; they do not impose a stable API policy.

## Contract authority

Use the SDK's exported declarations, current manifest/package validators and
`plugin-extension-*.md` contracts. Historical command/panel recipe documents do
not extend the current API. The SDK has one executable model: `main` selects the
trusted Node host; commands, events, services, hooks and UI registrations compose
features. Creative contributions remain declarative.

`apiVersion` selects the host contract. `minClipcraftVersion` rejects older app
versions, while the SDK package version identifies authoring tools/types. They
are separate numbers. Use authoring types and the app from the same development
snapshot. Feature discovery describes what that running host supports; it does
not promise compatibility with earlier snapshots. Unsupported calls reject
explicitly. A future stable release policy will be decided when needed.

## Immutable updates and trust

Installed payloads are immutable. Different Node bytes under an installed
ID/version reject instead of replacing files. A normal author update uses a new
package version. During this migration only, a historical payload and rebuilt
Node payload with the same ID/publisher/version can coexist; their fingerprints
remain different and Node trust is fresh.

Trust belongs to exact package bytes. It is retained for an exact reinstall;
trust in an older or historical package does not authorize changed Node bytes.
Stop ends the activation and its managed work, but does not erase trust or stored
data. Automatic discovery cannot restart a stopped/crashed/timed-out activation
in the same app session until it is explicitly started. Full Node trust permits
file, network and process access; the host API is not an OS sandbox.

Node packages must have portable, unambiguous file/directory paths. Case aliases,
file/directory conflicts, trailing dots and Windows reserved device components
reject before installation or development materialization. The SDK uses the same
validator. Valid package fingerprints retain their existing algorithm; historical
creative-pack validation/fingerprints are unchanged. A previously accepted Node
package with a nonportable layout must be rebuilt with renamed assets before
distribution across platforms.

Node payloads admit at most 4,096 files and 8,192 distinct path nodes, counting
both files and their implied directories. Folder scans also count empty
directories toward the traversal budget and validate directory prefixes before
descending. The relative path bound remains 240 characters. Scans retain one
directory handle at a time. A Node layout beyond these resource limits must be
rebuilt before admission; accepted payloads retain their existing fingerprints.
SDK manifest and asset capture use the same bounded descriptor reader as native
intake, count actual captured bytes, and reject growth past the relevant limit.

New creative-pack materialization also rejects nonportable asset names. Existing
creative payloads keep their read-only validation/fingerprints and retained
dependency access, including on filesystems that already hold those bytes.
Inspection is read-only and does not certify that an old layout can be newly
installed. Rebuilding, installing or starting a development snapshot applies the
current intake policy before payload writes; SDK checks reject bad asset
declarations before opening their files.

## Settings, secrets and author migrations

Global installed Node configuration and secrets are scoped by extension ID, independently
of its version/fingerprint. Only one version of that ID can be active at a time.
Updates and rollbacks share that stored state after their own trust checks.
Configuration updates are serialized and atomically replace the settings file;
one value is bounded to 64 KiB. Secret values are encrypted through native
storage; unavailable encryption rejects rather than saving plaintext.

The host does not invent an author's schema migration. Keep schema/version and
related settings together in one configuration value when they need one atomic
update. Preserve unknown values unless deliberately migrating them. An older
extension should refuse a newer unsupported schema with an actionable error,
without resetting it. Use `configuration.update({key, value: undefined})` or
`secrets.delete(key)` for deliberate author-controlled deletion. Native secret
fields expose only saved/not-saved status.

Uninstall removes package bytes/inventory and its historical panel namespace;
Node settings/secrets remain for a later reinstall. This is current retained-data
behavior, not an automatic clean-data guarantee. Recovery reconstructs package
rows disabled and preserves Node data. It creates no trust grants. Subsequent
explicit activation can use an existing grant only for the same exact fingerprint.
Source development sessions use temporary settings/secrets and session trust;
ending one does not migrate them into installed storage.

Historical panel preferences and provider choices retain their existing data
formats. The old executable stays unavailable. Explicit reviewed historical
preference copying does not convert values into Node configuration or credentials.
See [retirement rules](plugin-legacy-retirement.md).

Project-scoped configuration is stored inside the project and uses document
anchors, bounded JSON and Undo. Global calls retain their storage behavior.
See [project configuration](plugin-sdk-general-contracts.md#project-configuration).

## SDK distribution and release checks

`npm run sdk:verify` runs the SDK development suites and prepares a candidate
only after successful checks with unchanged source. The
[validation report](plugin-sdk-validation.md) records development runs.
[Remote acceptance](plugin-remote-acceptance.md) records the later SDK matrix
and installed-app runs. Those runs predate the current native-control additions;
the [current packaged extension followup](plugin-authoring-packaged-followup.md)
adds local macOS app-directory evidence without certifying the other platforms.

The SDK authoring tools declare Node >=20.19.0. Targeted admission/authoring
checks passed on Linux arm64 under the exact 20.19.0 floor and Node 24.16.0.
This tool-runtime floor is separate from the Electron host/API compatibility
contract and does not certify the installed-platform matrix.

The supported development route is a built SDK tarball or local installation,
with the pinned compiler/dependencies and actual ESM/NodeNext type checks.
Generated projects initially reference their creating SDK installation; authors
must replace that local dependency with a shared tarball/path or an available
published SDK before sharing source. Build/check/inspect do not run authored code.
Install the compiled payload or archive, not a source workspace.

SDK packing and the in-app pack creator share the bounded archive writer. The
64 MiB compressed limit applies to actual emitted bytes, independently of the
128 MiB uncompressed payload and per-file limits. Publication is exclusive and
occurs only after compression completes. A failure leaves the requested output
absent; a destination created by another writer is preserved. The repository
`scripts/plugin-package.cjs` helper delegates to the current SDK, including its
refusal to author retired executable packages.

The archive reader budgets format overhead separately: at most 8 MiB plus 1 KiB
for headers, padding and metadata, with the original 128 MiB payload limit.
Inflation is bounded to their sum and the parser may not decompress another
layer. Unknown/skipped entry types and metadata beyond the per-entry cap reject
rather than disappearing from inspection. Valid PAX long paths remain supported;
regular package bytes and fingerprint algorithms are unchanged.

Node bundling uses the canonical project root and a relative entry path so an
unchanged source/dependency layout has the same payload fingerprint after moving
the project or changing the caller's working directory. This is not a promise of
identical archive timestamps or hermetic builds with arbitrary external/symlinked
dependencies. Compiler and input changes still require authors to review changed
bytes; installed payloads and their fingerprint algorithm are not rewritten.

A stable SDK release must ship matching helper, declaration, CLI, README and
license artifacts, pass the clean-consumer and native app checks, and record its
app/host compatibility. Publishing, pushing or creating an installer requires
separate explicit authorization. No publication or version increment follows
merely from successful development checks.

The native `test-extension-storage-lifecycle` suite checks actual encrypted data
through update, author migration, rollback refusal, uninstall/reinstall and
inventory reconstruction. `test-plugin-sdk-cli` checks an offline clean consumer
and archive/native fingerprint parity. These checks do not substitute for a
current Windows/Linux and installed-release matrix.
