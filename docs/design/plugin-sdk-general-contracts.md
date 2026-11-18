# General SDK contracts and debugging

App 2.0.0, SDK 0.8.0 and host API 1 remain unchanged. These additions preserve
existing untyped services and global configuration calls.

## Capability discovery

`context.host.capabilities()` returns `{apiVersion: 1, features}`. Each feature
value is its contract revision. Test `(features[name] ?? 0) >= revision`; an absent
name is unsupported. These revisions describe host APIs, not installation of an
external service, a working network connection, package trust or current document
availability. Service discovery remains `services.list/describe`. The canonical
catalogue is `shared/extensionCapabilities.cjs`.

## Typed services

`defineServiceContract` validates a portable contract while preserving TypeScript
literal inference. A contract has a positive integer `version` and named methods,
each with an `input` schema, `output` schema and optional `stream: true`.
`services.registerTyped` checks that the implementation supplies exactly the
contracted methods. `services.connect` discovers/lazily activates a service and
requires its canonical contract to match. Its client has typed `call` and `stream`
methods. Every subsequent call rechecks compatibility, including after provider
replacement. It does not retain the provider or authorize activation after Stop.

Schemas support null, boolean, finite number, safe integer, string, bytes, array
and closed objects with explicit required properties. Numeric/length/item bounds
and string enums are supported. There are no executable validators, references,
regular expressions, coercion or implicit defaults. Contracts are bounded by
method/property counts, depth, node count and bytes. Payload transport bounds
still apply. The host validates inputs before dispatch and outputs/chunks before
delivery, even when a caller uses ordinary `services.call/stream`. An invalid
stream chunk closes the stream. Contracted native application services use the
same validation for unary calls. Native service streaming remains unsupported.

Existing service registrations are unaffected until they opt into a contract.
`describe(id)` returns identity/metadata and the optional contract; metadata
cannot replace native owner fields.

## Project configuration

Global `configuration.get(key)` and `update({key,value})` retain their existing
storage. Explicit `scope: 'global'` is equivalent. Project operations require
`scope: 'project'` and a `documentId` from the current workspace. Reads have no
implicit global fallback. Secrets remain in encrypted global storage.

Project values live in `project.extensionSettings[extensionId][key]`, persist in
ordinary saves/autosaves and travel with a copied project. The extension ID is
supplied by the host. A stale document, stopped/cancelled callback, busy editor
or revoked commit cannot write. Writes are ordinary Undoable document edits;
save/export preparation writes stay in the private draft and validation hooks
cannot write. Uninstall does not erase settings from saved projects. Reinstall
or a trusted new version with the same ID reads that namespace.

Values must be finite JSON, at most 64 KiB, with bounded nesting/items. A project
admits at most 128 extension namespaces, 256 keys per namespace and 1 MiB total.
`value: undefined` deletes a key. No-op writes create no history entry. Global
configuration and development-session secrets/settings retain their current
isolation. Project changes, including Undo/Redo, emit `configuration.changed`
with `scope: 'project'` and `documentId`; events remain bounded, so subscribers
must resynchronize from reads when delivery reports missed events.

## Development debugger

Start and trust a Node development session, activate it, then choose **Start
debugger**. Attach a Node-compatible debugger to the displayed WebSocket address
(for example Chrome's inspect tools or an IDE with Node attach support). The
inspector binds `127.0.0.1` on an OS-selected port. It is never enabled for an
installed package through these controls and never starts automatically.

SDK bundles contain inline source maps and original source content for authored
TypeScript/dependencies. Set breakpoints, step, inspect locals and resume using
the attached debugger. Regular managed-operation deadlines/cancellation still
apply; this is not a way to extend agent or export deadlines. Inspector access
controls the trusted extension process and should stay local to the developer.
Close the debugger connection before choosing **Stop debugger**. Node's
`inspector.close` waits for active clients to disconnect. Stop, reload and End
session terminate the old process and listener; a replacement has debugging off.

The implementation follows Node's
[inspector API](https://github.com/nodejs/node/blob/v24.22.2/doc/api/inspector.md).
This work does not certify Windows, installed releases, performance budgets or
publication. The broader [unfinished gates](plugin-extension-unfinished.md)
retain their statuses.

## Verification

The frozen final source passed all 117 plugin suites, all 9 SDK verification
suites and 3 project-file checks. The native additions workflow passed 23 checks,
including cross-extension rejection, real save/Undo/Redo and hook isolation,
inspector breakpoint/step/local inspection/resume and listener shutdown on reload
and session end. Build and structure checks passed. Source hashes were unchanged
during the final run; app/SDK manifests and lockfiles match the task baseline.

The initial plugin selection retained 111 passes and 6 failures. Corrections
covered complete icon assets in fixtures, a controlled offline VoiceStudio
endpoint, honest corrupt-inventory messaging, preserving previews across identical
catalog refreshes and measuring preview backing size from the CSS content box.
No visual/export tolerance was relaxed. Raw failures and final reports are in
`plugin-validation.json.extensionSdkGeneralContracts`; later success does not
rewrite the earlier run.
