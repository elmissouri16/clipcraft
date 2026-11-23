# Typed extension hook points

Trusted Node extensions can define named hook points, subscribe from another
extension and await ordered, typed results. This is a pre-alpha API; it has no
compatibility guarantee. [Document lifecycle hooks](plugin-document-lifecycle-hooks.md)
have a separate native contract.

## Definition and subscription

```ts
import {defineHookContract} from '@clipcraft/plugin-sdk/extension';

const contract = defineHookContract({
  version: 1,
  input: {type: 'string', maxLength: 160},
  output: {type: 'boolean'},
});
const point = await context.hooks.define('review', contract);
const result = await point.run('Opening card', {signal});
for (const response of result.results) {
  console.log(response.extensionId, response.value);
}
await point.dispose();
```

If the defining package is `studio.cards`, its point is `studio.cards.review`.
Only that exact defining activation and handle can invoke or remove it. Defining
another package's point or invoking a public catalog entry is not supported.
An old handle cannot operate a same-ID replacement.

Another extension registers its participant with the same versioned contract:

```ts
await context.hooks.register('studio.cards.review', contract,
  async (label, {signal, runId, hookId, ownerId}) => {
    if (signal.aborted) return false;
    return label.trim().length > 0;
  }, {order: 10, timeoutMs: 30000});
```

Subscriptions may precede definition. Declare
`activationEvents: ['hook:studio.cards.review']` for lazy subscriber activation.
Trust is still required; installing or inspecting a package never executes it.
`hooks.list({cursor?, limit?, extensionId?})` lists currently defined points and
their normalized contracts. It does not activate owners. Source examples can
also use `as const satisfies HookContract` without a runtime SDK import.

Schemas use the existing portable service schema, including bounded JSON and
bytes. The host validates input, every participant's exact contract and each
actual callback result. All participant contracts are checked before any
callback executes. An empty participant set returns an empty result list.

## Ordering, lifetime and cancellation

Lower `order` runs first; ties use extension ID. The default order is 100, bounded
to integer values from -10000 to 10000. A package has one participant per point.
The result is `{runId, results: [{extensionId, value}]}` in callback order.
Callbacks run sequentially; later callbacks are not started after a failure.
Changing a pending participant, disposing the definition or stopping a participant
cancels the invocation. Native save/export hooks also accept `order` and verify
their registration instances through the commit point.

Each invocation has a default 30-second deadline. `point.run` and participant
options can set `timeoutMs` from 1000 to 300000. AbortSignal, owner loss, disposal
and Stop abort pending callbacks. Invocation cancellation releases the caller
without waiting for independent subscriber activation; activation remains owned
by the subscriber. Inside a document operation it also inherits that operation's
activation and cancellation guards. A canceled callback has the existing grace
period to finish before its nonresponding activation is stopped. Completed custom
callbacks cannot make detached editor calls. Recursive point invocation is refused
through nested hook, command and service chains.

Definition and participant handles dispose once. Old handles cannot unregister a
replacement. Stop and disable remove definitions, subscriptions and pending
invocations owned by that activation. Re-enabling creates fresh instances.

## Native document drafts

Calling a custom point inside `project.willSave` or `export.willRender` propagates
the same private draft, participant ownership and cancellation to its callbacks,
nested commands and services. `timeline.read/apply` now joins the existing draft
APIs: custom clip/track changes stay invisible until the complete preparation
commits as one Undo step. Custom type registry changes invalidate that draft.
Read-only validation hooks cannot write custom timeline data. A failed managed
write, or a failed custom callback after staging edits, fails preparation even
when authored code catches its rejection. Disposed participating definitions or
subscriptions cannot publish through a previously reserved commit.

Ordinary custom point invocations use ordinary editor transactions; they do not
create a new multi-callback rollback boundary. Previously committed editor edits
and independent Node filesystem/network work retain their existing semantics.

## Bounds and examples

- 32 definitions per activation, 256 in the host.
- 64 hook subscriptions per activation.
- 16 concurrent invocations per owner, 64 in the host.
- 128 participants per invocation; save/export preparation also bounds combined
  native and custom hook callbacks to 128.
- Service-schema validation limits and 1 MiB input/result transport bounds,
  including the aggregate results of an invocation.
- Catalog pages of at most 64 points and 256 KiB.

Capability discovery advertises `hooks.custom`, `hooks.order` and
`hooks.timelineDrafts`. The original [SDK workbench](../../examples/extensions/sdk-workbench/README.md)
defines a scene-review point. Its optional [scene reviewer](../../examples/extensions/scene-reviewer/README.md)
companion approves or refuses real scene creation through native plugin settings.

Receipts belong under `extensionCustomHooks` in the
[validation ledger](plugin-validation.json). The remaining native document
lifecycle hooks are tracked separately in the scope tracker.

## Local verification

The real editor workflow passed 12 checks plus 2 cold-restart checks,
including ordered cross-extension callbacks, actual scene refusal, private custom
timeline writes, native Save/Undo, caught output-contract failure, validation
write refusal, native Cancel and disposed-handle rejection. Its live-project
screenshot was inspected while the additional draft row remained invisible.

The final worker suite passed 12 checks, including cancellation during
activation, stale handles, contract mismatch before dispatch, recursion, late
editor calls, nonresponding callback termination and quota overflow cleanup.
The plugin/core selection passed all 146 suites. The final quota hardening
was separately verified after that run began. All 9 SDK verification suites
passed without source changes; source still matches its receipt. The built SDK's
public helper exports were also executed. Renderer, structure and whitespace
checks passed. The subsequent native lifecycle expansion is documented
[separately](plugin-document-lifecycle-hooks.md).
