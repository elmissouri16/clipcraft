# Trusted extension events

`context.events.on(name, handler, {replay?})` subscribes to a core event or another
extension's topic. `handler(value, event)` keeps the original value as its first
argument; the second argument supplies typed provenance, delivery metadata and an
AbortSignal. `subscription.ready` confirms host registration. `dispose()` removes
the listener and, after the last local listener is removed, its host subscription.
Subscriptions are also disposed on Stop. App 2.0.0, SDK 0.8.0 and host API 1 are
unchanged.

```ts
const subscription = context.events.on('project.changed', (document, event) => {
  console.log(document.documentId, document.projectRevision, event.source.kind);
  if (event.missed) console.log('Read current workspace state again.');
}, {replay: true});
await subscription.ready;
// Later:
await subscription.dispose();
```

## Core values

| Event | First callback argument |
| --- | --- |
| `project.opened` | Bounded `EditorSnapshot` for the newly opened document |
| `project.closed` | `null`; the closed document ID is in metadata when there was a document |
| `project.changed` | Document ID, complete-inspection `projectRevision`, and bounded editor `revision` |
| `editor.changed` | Bounded `EditorSnapshot`, including selection and playhead |
| `selection.changed` | Document ID, public `clipIds`, and total selected count |
| `playback.changed` | Document ID, actual `time_sec`, and `playing` |
| `configuration.changed` | Extension ID, key, `settings`/`secrets` scope and deletion flag; no value |
| `application.configurationChanged` | Changed public settings group names; no values or credentials |
| `export.changed` | Operation/document IDs, preparing/rendering/completed/canceled/failed status and bounded progress; completion includes the verified file and metadata |
| `extension.changed` | Extension ID, fingerprint, activation generation and lifecycle state |
| `media.previewClosed` | Extension ID and artifact handle |

Document/editor/playback/selection state is sampled at 100 ms. Document changes
exclude chat progress and derived visual caches. Cache-only updates can produce
`editor.changed` with reason `cache`. Project replacement closes the old document
before opening the new one. A closed document's editor/playback/selection state is
removed from the replay cache. Export remains a snapshot operation and can report
completion for a document that is no longer open.

Export events cover native and agent video exports as well as SDK exports. Their
source identifies the initiating workflow; it is retained when that workflow is
canceled from another surface. They
share their operation ID with preparation-hook edit provenance, have one terminal
event, and expose no project snapshot or temporary frame folder. Selecting no
destination does not start an export. Resetting a scoped configuration value to `undefined` reports deletion; unchanged
settings do not emit duplicate notifications. Application settings notifications include
known groups such as shortcuts, language, playback quality, performance, voice and
service configuration; window placement and first-run persistence are excluded.

## Provenance and consistency

Metadata includes a per-activation delivery `sequence`, host `publication` ID,
timestamp, `missed` count, optional document/revision/reason/change fields, and a
source. The source kind is `user`, `extension`, `agent`, `system` or `unknown`.
Validated extension writes carry the actual extension ID; preparation carries its
participant IDs and operation ID. Private reducer tokens and agent ownership
tokens are never published. Undo/Redo have their own reason. Cache changes retain
the prior content origin internally, so a cache update cannot hide a sampled
extension edit's provenance.

Observed playback/selection or settings changes whose initiating caller cannot
be established use `unknown`. The host does not infer a user or agent identity
from timing. Several document edits between samples report the final origin and
count skipped intermediate changes. Full revision-scoped content remains
available through [workspace inspection](plugin-project-inspection.md).

`replay` defaults to false. Explicit replay delivers the latest retained state
with `event.replay === true` only to the listener requesting it; it does not
re-deliver to existing listeners or reconstruct history. The cache has a
4 MiB bound. Per-activation delivery sequence remains ordered; publication IDs
identify the original host observation, so replay may refer to an older
publication. Consumers should check document IDs and use host reads when they need
current complete state.

## Ordering, limits and cancellation

The host sends one acknowledged event at a time to an activation. Async listeners
finish before the next event is delivered. Managed calls begun by a callback are
settled before that event is acknowledged. A callback error is logged without
preventing other listeners from running. Disposing a listener prevents subsequent
invocations; an already-running callback may finish. Metadata is frozen in the
worker. Different extensions receive independent copies and queues.

Plain event payloads and binary subviews are copied with a 1 MiB budget, bounded
nesting and dense arrays. The host ingress queue holds at most 128 events with a 4 MiB payload budget;
each activation holds at most 64 queued events with the same payload budget, plus
one in flight. Frequent
document/editor/playback/selection states and active export progress coalesce to
the latest observation, placed after intervening publications. Lifecycle and
terminal export events do not coalesce. Overflow skips queued state first; core notifications can also displace custom
traffic and, if necessary, older core notifications. Memory stays bounded and
missed delivery is reported. A custom publisher receives a queue
error when ingress cannot accept it; committed core operations do not fail merely
because an observer queue is full.

An activation may subscribe to 128 names with at most 32 local listeners per name.
Listener work has a 30-second deadline, followed by an abort signal and five-second
grace. An uncooperative activation is stopped without stopping other extensions.
Managed export waits suspend their actual callback/service chain's ordinary
deadline. A deadline is rearmed when the host event loop resumes more than 2.5 seconds late.

Cancellation propagates through nested managed calls. Document requests recheck
their callback execution at authorization and at the synchronous reducer claim;
a canceled callback cannot use a queued reply to edit later. Cleanup operations
remain available, including scoped settings/secrets cleanup, stream closure,
process termination, message dismissal and registration disposal. Completed
callbacks can schedule independent work for their activation; canceled callbacks
cannot resume document access. Ordinary managed subprocesses retain their
activation lifetime unless an explicit signal is supplied. Preparation-scoped
processes keep the save/export rules in [the hook contract](plugin-extension-hooks.md).

## Custom topics and activation

`await context.events.emit('render.ready', value)` publishes
`<extension-id>.render.ready` and returns its actual name/publication ID. It
acknowledges queue acceptance, not listener completion. Prefixing is performed by
the host, so an extension cannot forge `editor.changed` or another extension's
identity. Custom publishes allow a burst of 64 and refill at 32 per second.

Declare `event:<full-name>` in `activationEvents` for lazy activation. Discovery is
invalidated when package trust or the plugin catalog changes. An untrusted package
does not run, even if the topic was already observed. Stopped/crashed activations
keep the existing manual-restart latch. One failed activation does not prevent
other declared event participants from starting. Catalog changes hold delivery
while runtime teardown and package changes finish; application shutdown closes
the transport.

## Verification status

Transport/provenance suites, real utility processes and the native editor
workflow passed the focused frozen-source selection. Exact counts, source hashes,
initial failures and native evidence are recorded under
`plugin-validation.json.extensionHostEvents`. The optional
workbench example includes a typed last-project-event command. Complete event
support does not establish other host workflows. Later
[development](plugin-extension-development.md), [retirement](plugin-legacy-retirement.md),
[ASAR](plugin-extension-asar-views.md) and [remote acceptance](plugin-remote-acceptance.md)
records describe their own coverage; their earlier status is not a current gap list.
