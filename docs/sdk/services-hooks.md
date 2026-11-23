# Commands, services and hooks

Use commands for named actions, services for calls between extensions, events to observe changes and hooks to participate in a host operation.

## Commands

```ts
await context.commands.register('greet', async (input: {name?: string}, {signal}) => ({message: `Hello ${input.name ?? 'there'}`}));
const reply = await context.commands.execute('studio.other-extension.do-something', {value: 1});
```

Declare a command in the manifest to make it lazily activatable and visible to
CraftAI, which runs it only after the user reviews it. A command invoked from a
clip's context menu receives `{location: 'context', editor, clipId}`; from every
other place it receives `{}` or whatever the caller passed.

## Events and hooks

```ts
const sub = context.events.on('project.changed', async (value, {source}) => {
  if (source.kind === 'extension' && source.extensionId === context.extension.id) return;  // my own edit
});
await sub.ready;
context.subscriptions.push(sub);
await context.events.emit('finished', {count: 3});          // published as studio.my-extension.finished
```

Application events: `project.opened/closed/changed`, `editor.changed`,
`selection.changed`, `playback.changed`, `configuration.changed`,
`application.configurationChanged`, `export.changed`, `extension.changed`,
`media.previewClosed`. Events are delivered in order; under load, rapid ones
are coalesced and the listener's second argument reports how many were skipped
in `missed`. Explicit replay reaches only the listener requesting it.
`configuration.changed` has `source.kind` `'user'` for a change made in your
settings form and `'extension'` for your own write.

Hooks take part in save, export and document transitions:

```ts
await context.hooks.register('export.validate', async ({document}) => {
  if (document.duration_sec > 600) return {cancel: 'This workflow supports videos up to ten minutes.'};
});
await context.hooks.register('project.willSave', async () => { /* may edit: becomes part of the save, one Undo */ });
```

`project.validateSave`, `project.validateClose` and `export.validate` may only inspect and cancel.
`project.willSave`, `project.willClose` and `export.willRender` may also edit through `editor.apply`,
`markers.apply`, `captions.write`, `media.insert`, `timeline.apply` and project
configuration. `project.didOpen`, `project.didCreate` and `project.didClose` are
read-only notifications after a completed transition; failures are logged without
reversing it. Close preparation can veto or cancel a project switch or normal
quit. See [document lifecycle hooks](../design/plugin-document-lifecycle-hooks.md) for
snapshot, preservation and quit behavior. Unknown native names reject.
Extensions can also [define typed custom points](../design/plugin-custom-hooks.md)
through `hooks.define`, subscribe using `hooks.register(name, contract, handler,
options?)`, and discover current definitions with `hooks.list`.

## Services

```ts
import {defineServiceContract} from '@clipcraft/plugin-sdk/extension';
const contract = defineServiceContract({version: 1, methods: {
  translate: {input: {type: 'object', properties: {text: {type: 'string'}, to: {type: 'string'}}, required: ['text', 'to']}, output: {type: 'string'}},
}});
await context.services.registerTyped('translator', contract, {translate: async ({text, to}) => `${text} (${to})`});

const client = await context.services.connect('studio.my-extension.translator', contract);
const text = await client.call('translate', {text: 'Hello', to: 'fr'});
```

Use `services.register` for an ordinary service, or `registerTyped` and
`connect` to check a shared contract. Consumers can `list`, `describe`,
`call` or `stream` registered services. A streaming method returns an async
iterable. The app exposes its selected AI connection through the
`clipcraft.ai` service. [Application services](../design/plugin-extension-host-services.md)

To put a service into an editor workflow, register it and call
`ui.registerIntegration({id, title, point, service})` during activation.

| Integration point | Appears in | Implementation |
| --- | --- | --- |
| `voice.engines` | Voice settings, Text to speech and CraftAI voice tools | [VoiceStudio](../../examples/extensions/voicestudio/README.md) |
| `ai.engines` | Assistant settings and CraftAI's model and tool loop | [Local AI provider](../../examples/extensions/local-ai-provider/README.md) |
| `media.sources` | Online Media and Audio browsers and CraftAI media search | [Media source methods and bundled examples](#online-media-sources) |

## Online media sources

Declare `ui:media.sources` in the extension's `activationEvents`. Register a service
implementing `MediaSourceService` and expose it to Media, Audio and CraftAI:

```ts
await context.services.register('catalog', catalog);
await context.ui.registerIntegration({
  id: 'media', title: 'Studio library', point: 'media.sources', service: 'catalog',
});
```

`describe` returns supported kinds, category choices, filter support and connection
status. `search` returns a page with stable item IDs and license metadata. The host
passes the selected item back to its source for preview and download. A visual
item's `thumb` identifies its thumbnail. `preview` returns a local image or audio
file under `context.extension.storagePath/media-cache`. `download` uses
`context.media.import` and returns its verified artifact plus a credit record.
The editor stores the imported media independently of the extension. Implement
`source` and declare `sourceLinks` to resolve an original HTTPS attribution page.
Network requests should honor the service call's abort signal. Register native
secret settings for API keys. See the four [shipped media source packages](../../electron/bundled-media).


[Extension API index](../design/plugin-extension-api.md) · [Type declarations](../../packages/plugin-sdk/src/extension.d.ts)
