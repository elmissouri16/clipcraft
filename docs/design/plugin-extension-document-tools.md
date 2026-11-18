# General document edits, file pickers and host tools

These APIs support ordinary Node extensions and their commands/services/views.
They do not add specialized integration or executable extension types. App 2.0.0,
SDK 0.8.0 and host API 1 remain unchanged.

## Marker transactions

Read markers with `workspace.inspect({section:'markers'})`. Continue larger reads
with the returned documentId/projectRevision and cursor. IDs are opaque `k-…`
inspection handles; raw project IDs are never accepted as edit targets.

```ts
const page = await context.workspace.inspect({section: 'markers', limit: 200});
await context.markers.apply({
  documentId: page.documentId,
  projectRevision: page.projectRevision,
  operations: [{type: 'add', time_sec: 2, label: 'Opening'}],
});
```

Operations are `add` with time_sec and optional label, `update` with an id and
time_sec and/or label, or `remove` with an id. A transaction accepts at most 128
operations; the same existing marker cannot be targeted twice. Unknown or
ambiguous targets reject the whole transaction. Time is finite, nonnegative and
at most 1e9 seconds. It may lie beyond the current timeline. Labels are plain
text, at most 1,000 characters each and 64,000 across the transaction. Growth
beyond 10,000 project markers is refused; oversized imported collections can
still be reduced. New private IDs are reserved against existing entity IDs.

The consistency anchor is the content-only inspection revision, so playback or
selection alone does not invalidate it. Stale content, project replacement,
editor contention and stopped/canceled activations reject publication. Untouched
markers and existing metadata survive updates. Empty and identical transactions
add no Undo entry. An actual transaction commits one atomic Undo through the
existing native lease and reducer, with normal extension provenance events.

Marker edits participate in private Save/export preparation drafts. Validation
hooks cannot write them. Failed/canceled preparations discard them; successful
preparations save/render the draft and publish all preparation edits as one Undo.

## Native file pickers

`ui.showOpenDialog(options?, {signal?})` returns selected absolute paths, or
undefined for native cancellation. Options include kind (`file` or `directory`),
multiple, title, buttonLabel, absolute defaultPath and filters. A filter contains
a plain name and an array of extensions without dots; `*` is accepted.
`ui.showSaveDialog(options?, {signal?})` returns one absolute destination or
undefined, with the same text/path/filter fields. It selects a destination; it
does not write a file or grant overwrite permission to host exporters.

Native titles retain the actual extension's name. Bounds are 16 filters, 32
extensions/filter, 128 returned paths and 1 MiB of combined path bytes. One
extension picker can occupy the native dialog slot at a time. There is no queue.
Calls are authenticated to the activation and callback; dialogs pause the parent
callback's managed wait deadline, while the global preparation deadline remains.

AbortSignal or Stop revokes the SDK reply immediately. Electron's asynchronous
open/save pickers expose no per-dialog close handle in this integration: an
already open OS picker remains until dismissed by the user. Its late result is
discarded, and another extension picker is refused until it actually closes.
Cancellation before the native call prevents it opening. The API never pretends
that canceling a Promise closed the operating-system dialog.

These are trusted Node APIs, not sandbox file-access grants. Authored code can
already use Node filesystem/network APIs. Authors remain responsible for
protecting original files and handling cancellation around their own writes.

## Host-owned executable paths

`host.read()` returns appVersion, apiVersion, platform, arch and tools containing
the actual bundled FFmpeg and FFprobe paths. Use `processes.spawn({file,args,…})`
to run them with the existing managed process lifecycle. Arguments are literal
arrays and never shell commands. Existing timeout, stdout/stderr and process-tree
cleanup rules apply. This is executable discovery, not a set of host processing
recipes: the extension chooses filters, codecs, protocols and business logic.

The [Node examples](../../examples/extensions/README.md) demonstrate marker
transactions, native settings/actions, sandboxed views and real media processing.
The legacy runtime and the remaining specialized integrations still require
migration before the accepted extension-host plan is complete.
