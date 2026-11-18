# Trusted extension save and export hooks

Explicit Save, Save as and native video export support validation and preparation
by trusted Node extensions. This includes explicit saves/exports requested by an
agent. Recovery autosaves, project loading and background cache writes do not run
these hooks. App 2.0.0, SDK 0.8.0 and host API 1 remain unchanged.

## Registration and order

Register through `context.hooks.register(name, handler, {timeoutMs?})`. Declare
`hook:<name>` in `activationEvents` for activation on demand. Installing or
inspecting a package never activates it; package trust is still required.

| Operation | Read-only validation | Preparation |
| --- | --- | --- |
| Save / Save as | `project.validateSave` | `project.willSave` |
| Export / section preview | `export.validate` | `export.willRender` |

Every validation hook finishes before preparation begins. Within each phase,
active participants run by extension ID. The document summary is refreshed before
each callback, so later hooks see earlier preparation edits. At most 128 callbacks
run in an operation. The default callback deadline is 30 seconds; `timeoutMs` can
be 1000–300000. The entire operation has a ten-minute deadline.

The handler receives `{operationId, kind, phase, document, destination?}` and a
second `{signal}` argument. `document` contains the document ID, dimensions, frame
rate, duration and an optional name. Names longer than 1000 characters are omitted
from this summary; complete workspace inspection remains available.
`destination.path` is the selected absolute output path; native Save supplies
`saveAs`, and native export supplies `review`. The destination is selected before
hooks run, so dismissing a file picker does not activate them.

Return nothing to continue, return `{cancel: 'Reason'}` to stop, or throw an error
to fail. Other return shapes are rejected. Do not perform document edits in a
validation hook.

```ts
import type {ExtensionContext} from '@clipcraft/plugin-sdk/extension';

export async function activate(context: ExtensionContext) {
  await context.hooks.register('project.willSave', async (_input, {signal}) => {
    if (signal.aborted) return;
    const editor = await context.editor.read();
    await context.captions.write({
      documentId: editor.documentId,
      revision: editor.revision,
      mode: 'append',
      cues: [{text: 'Prepared by an extension', start_sec: 0, end_sec: 1}],
    });
  });
}
```

## Private preparation and commit

Operation-scoped editor/workspace/caption reads inspect a private draft.
`editor.apply`, `captions.write` and `media.insert` use the normal validators and
reducer against that draft. Nothing appears on the timeline or in history until
all hooks succeed. Re-read the editor revision after a staged write before
submitting another revision-scoped transaction. At most 128 document edits may be
staged. Nested managed commands, services and service streams inherit the draft
and cancellation signal, including lazily activated participants.

Success publishes the entire preparation as one Undo transaction before Save or
export consumes that snapshot. An agent preparation joins its existing edit
transaction. Failure, validation refusal, cancellation or participant shutdown
discards the private edits. A failed managed mutation fails the operation even
when extension code catches that mutation's rejection. An unsuccessful nested
command/service that staged edits also fails the operation.

The host checks document identity, content, locks, gesture/agent ownership,
effect-registry changes and participant activation generations before committing.
Concurrent content changes cancel preparation. Chat progress, derived media visuals/proxies and cover
cache updates are carried forward without overwriting them. A reservation alone
cannot authorize an edit: the real reducer synchronously claims it immediately
before publication. Stop revokes unclaimed reservations and waits for a claimed
commit to finish. A replacement activation cannot reuse an old reservation.

Imported media uses operation-owned leases. `media.release` immediately consumes
the artifact handle, while retaining bytes needed by staged insertions until the
operation commits or rolls back. Rollback removes unused staged durable copies;
success preserves project media across Undo, stop, removal and restart. An
uncertain acknowledgement retains potentially adopted media.

## Cancellation and limits

Long preparations display a host status card with Cancel. Cancellation propagates
to the current callback, nested managed calls, scoped processes and messages.
Canceled scoped handlers have five seconds to settle before their activation is
stopped; this grace rule does not change ordinary view/command cancellation.
Callback timeouts stop the nonresponding activation. Jobs, process termination,
stream closure, media release and message dismissal remain available for cleanup
after a scope closes. Activation-owned background processes keep their independent
lifetime; awaiting one does not keep preparation activation pending.

Opening media previews and recursively starting exports inside these hooks is
rejected. Late document calls cannot reuse a completed hook's grant. Managed API
calls started by a callback are settled before its completion is accepted.

These are editor transaction guarantees. Trusted Node code can make independent
filesystem, network, configuration and other external changes; the host cannot
roll those back. After the complete editor preparation commits, a later file-write
or encoder failure leaves that whole preparation in history, available to Undo.
Canceling after that commit also cannot roll it back piecemeal.

The general [`context.exports.render` API](plugin-extension-exports.md) also runs
these hooks through the native export workflow. Full event coverage,
development reload, legacy executable migration and distribution validation are
still tracked in [the extension-host status](plugin-extension-host.md).

## Verification

Unit suites cover private drafts, revision/lock checks, metadata carry, commit
ordering and staged media leases. Real Electron utility-process checks cover
scoped activation, nested services/streams, denied validation writes, cancellation,
late calls and termination of an uncooperative canceled handler. The native app
workflow verifies picker refusal, invisible staged edits, rollback, Save output,
one Undo, destination metadata, an encoded caption frame and both sides of the
stop/commit ordering point. Retain exact results in `plugin-validation.json`;
these macOS development checks do not establish Windows/Linux release readiness.
