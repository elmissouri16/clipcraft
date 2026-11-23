# Document lifecycle hooks

Trusted Node extensions can validate and prepare a document before the user
leaves it, then observe completed document transitions. The host advertises
`hooks.lifecycle: 1`. Register through `context.hooks.register(name, handler,
{order?, timeoutMs?})`; lazy activation uses `hook:<name>` activation events.

| Hook | Context kind / phase | Behavior |
| --- | --- | --- |
| `project.validateClose` | `close` / `validate` | Read-only; return `{cancel: reason}` or throw to refuse leaving. |
| `project.willClose` | `close` / `prepare` | May stage document edits in a private draft. |
| `project.didOpen` | `opened` / `observe` | Read-only notification after loading a file, recent slot or recovery. |
| `project.didCreate` | `created` / `observe` | Read-only notification after creating a project or importing media from Home. |
| `project.didClose` | `closed` / `observe` | Read-only notification after leaving the previous document, or immediately before normal window destruction. |

`context.transition` contains a `reason`: `create`, `open`, `home`, `quit`,
`restore` or `import`. Its optional absolute `path` is the incoming file for
Open/restore, or the outgoing file for Home/quit. No file picker cancellation or
failed input load emits a completed-open notification.

## Ordering, snapshots and preservation

All validation finishes before preparation. Within a phase, lower integer
`order` runs first, with extension ID breaking ties. A successful switch runs
close validation, close preparation, persistence, the actual document switch,
`didClose`, then `didOpen` or `didCreate`. Creating/opening from Home has no
outgoing close phases. Returning Home has no incoming notification.

Preparation shares the save/export private-draft machinery, including custom
hook subscribers, operation-owned media, exact activation/registration guards,
read-after-write revisions and one native Undo transaction. Staged writes stay
invisible until every participant succeeds. Refusal, Cancel, stale document
changes or a stopped participant discard the uncommitted draft and keep the
current project open. Project lifecycle calls and Undo cannot run recursively
inside these callbacks.

Before switching, the editor flushes the file and forces a recovery slot even
for empty, marker-only or settings-only projects. Failed persistence refuses
the switch. Once a preparation has committed, a later file/slot failure leaves
that complete edit in the current document and history; one Undo restores it.
It never partly rolls back an already published edit or independent disk writes.
Open validates its input first, then reads the final file/slot again after
preservation. Reopening the current project therefore retains the edits just
saved by its close hooks instead of loading an earlier snapshot.

Observation uses an operation-scoped snapshot of the affected document.
`workspace.read`, editor/timeline/marker reads and project-configuration reads
refer to that snapshot. In `didClose` this is the outgoing document even when
Home or another document is already visible. `projects.status()` reports the
actual current editor state. An observation cannot mutate either document or
acquire a commit reservation. An error, invalid return or cancellation ends
that notification pass, is recorded in extension diagnostics, and cannot undo
the completed transition. Observers should return nothing; `{cancel: reason}`
cannot veto a completed transition. No notification adds an Undo entry.

## Normal quit and cancellation

A responsive editor acknowledges a native close request before running hooks,
so the frozen-renderer five-second fallback cannot interrupt active preparation.
Long callbacks show the native preparation card with Cancel. Refusal or Cancel
keeps the window open. A successful preparation is followed by the existing
Save/Don't save/Cancel question when needed. Canceling that question leaves an
already committed preparation available to Undo. Explicit Don't save retains
the existing native discard behavior. `didClose` with reason `quit` runs after
the final decision and before native window destruction. Restart from Settings
uses this same path and retains its pending relaunch through preparation.

The callback deadline defaults to 30 seconds and can be 1–300 seconds; each
operation is bounded to ten minutes and 128 callbacks. AbortSignal reaches
nested managed calls; a canceled handler has the existing five-second grace
before its activation is stopped. Stop/reload, callback timeout and editor
destruction release outstanding operations. OS force-kill, renderer crash and
power loss cannot promise lifecycle callbacks. Recovery remains authoritative
after an interrupted process.

```ts
await context.hooks.register('project.validateClose', async () => {
  const project = await context.workspace.read();
  if (!project.name.trim()) return {cancel: 'Name this project before closing.'};
});
await context.hooks.register('project.didClose', async ({transition}) => {
  const closed = await context.workspace.read();
  await context.log(`Closed ${closed.name} through ${transition?.reason}`);
});
```

The original [SDK workbench](../../examples/extensions/sdk-workbench) logs all
three completed transitions. Unit and real Electron lifecycle fixtures live in
`test-extension-document-hooks.cjs` and `test-extension-document-hooks-ui.cjs`.
Their exact receipts belong in [the validation ledger](plugin-validation.json).
These local development checks do not establish the installed Windows/Linux
release matrix.
