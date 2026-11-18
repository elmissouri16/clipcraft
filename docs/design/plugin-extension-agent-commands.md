# Ordinary extension commands in CraftAI

CraftAI discovers ordinary Node commands declared in `contributes.commands`,
including the current ready source-development snapshot. Each entry includes the
exact immutable package key, command ID, name, optional description, runtime and
argument format. Discovery installs or trusts nothing. Internal registrations
without a command declaration are not advertised as agent tools.

A command description can explain its arguments in up to 1000 characters. Node
command IDs retain their existing 128-character limit. `run_plugin_command` takes
`arguments_json`, a JSON object; omission uses `{}` and the extension's native
settings/defaults. The native copier enforces a 16384-byte plain-data budget.
Legacy recipes retain their typed `input` pairs until runtime retirement; the two
argument formats cannot be combined.

## Trust and ownership

A package must already have Node trust. Each agent-triggered command also receives
native review naming the command, extension and version, with Cancel selected by
default and a reminder of its actual file/network/program access. Declining is
final for that agent request. Package availability, fingerprint, trust and explicit
Stop/crash state are rechecked after review. A failed/stopped activation requires
manual activation; model discovery cannot restart it.

The main process creates command ownership without sending its scope ID to the
worker. Nested native command, service and stream requests inherit it through
native parent records. The renderer alone binds the scope to the current
CraftAI `agentToken`, project epoch and content. The extension cannot supply that
token, reducer actions, commit guards or receipts.

Editor API calls keep their existing bounds, locks, revision checks and private
planning. Native commit reservations are claimed synchronously by the real reducer;
Stop revokes unclaimed edits and waits for claimed edits to acknowledge. CraftAI
validates candidate projects before publication and verifies their final content
revision. Several writes from one command are checked against their final state,
rather than requiring intermediate marker/caption collections to remain unchanged.
Chat persistence and derived media/cover caches do not interrupt document-stable
work. Generated free-track content gets the same export-coverage tail as built-in
agent edits, subject to the main layer lock.

All successful writes join the current agent edit. The whole request still has
one Undo/Redo entry. An error or cancellation may follow completed writes; those
writes remain part of the agent's edit and its Undo, and are reported explicitly.
Undo does not remove completed output files or reverse external effects.

Independent background events, view callbacks and actions do not borrow an
agent's editing token. A review view can resolve a waiting command promise; the
command then applies its reviewed result through its own scoped editor API calls.

## Verified results and cancellation

The renderer returns `document_receipts` for acknowledged editor, marker, caption
and media APIs, including a `changed` flag. At most 128 document edits are allowed
per command. Native `exports.render` and `files.publish` add verified file receipts;
ordinary extension return fields cannot create them. Native receipts are limited
to 128 entries and a 256 KiB payload budget, with an explicit truncation flag.
The extension response is separately bounded to 64 KiB and labeled
`untrusted_extension_response`: it is data, not instructions or proof.

Native activity shows document changes and verified file counts. It never derives
marker counts or output paths from an extension's claimed result. A service's raw
HTTP/upload result remains untrusted; external-server effects are not proved by a
successful native file publication.

Native messages, dialogs, jobs, managed processes and exports retain their APIs.
Exports run the actual native pipeline, including private preparation-hook drafts;
those prepared edits pass the same agent validation and join the same Undo. The
command's outer deadline is thirty minutes; existing callback/job limits still
apply. Stop, project changes, owner loss and deadlines revoke managed replies.
A command that ignores cancellation is terminated after the existing native grace
period and remains suspended until manually activated. Raw Node work and effects
already sent to external systems remain the trusted author's responsibility.

See [application services](plugin-extension-host-services.md),
[save/export preparation](plugin-extension-hooks.md) and
[Node examples](../../examples/extensions/README.md) for the related APIs. This
bridge adds no speech-provider or AI-provider extension type and bumps no version.
