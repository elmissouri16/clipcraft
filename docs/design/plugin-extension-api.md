# Extension API reference

ClipCraft passes an `ExtensionContext` to your extension’s `activate` function. Use this index to choose a host operation, then follow the linked reference for signatures, examples, limits and failure behavior. For an installable project from scratch, start with [Build your first extension](../../packages/plugin-sdk/README.md).

<a id="3-the-context"></a>

## Context members

| Task | Context members | Reference |
| --- | --- | --- |
| Identify the host, access extension-owned paths and manage registration lifetimes | `host`, `extension`, `subscriptions`, `log` | [Lifecycle and diagnostics](../sdk/runtime.md) |
| Inspect a document, change clips, update custom tracks or Undo | `workspace`, `editor`, `timeline`, `projects` | [Project and timeline APIs](../sdk/project-editing.md) |
| Work with timed text and chapter marks | `captions`, `markers` | [Markers and captions](../sdk/project-editing.md#markers-and-captions) |
| Import an artifact, publish a file or render a range | `media`, `files`, `exports`, `rendering` | [Media, rendering and export](../sdk/media-export.md) |
| Place a control in the editor or open a panel | `ui` | [Actions, controls and views](../sdk/ui.md) |
| Expose an action, observe edits, validate a save or offer a service | `commands`, `events`, `hooks`, `services` | [Commands, services and hooks](../sdk/services-hooks.md) |
| Run background work or a local helper | `jobs`, `processes` | [Programs and long work](../sdk/runtime.md#programs-and-long-work) |
| Store a preference or a credential | `configuration`, `secrets` | [Configuration and secrets](../sdk/runtime.md#configuration-and-secrets) |

## Discover features

```ts
const { features } = await context.host.capabilities();
if (features['editor.tools']) {
  const tools = await context.editor.tools.list();
  await context.log(`Available editing tools: ${tools.length}`);
}
```

Feature keys have integer revisions. Use the [capability index](plugin-sdk.md#discover-what-a-running-editor-supports) to find the exact key for a host feature. The [TypeScript declarations](../../packages/plugin-sdk/src/extension.d.ts) are the full reference for parameters, return types, optional fields and cancellation signals.

<a id="2-lifecycle-rules"></a>
<a id="5-what-an-extension-cannot-do-yet"></a>

## Runtime and compatibility

A trusted Node extension runs in its own process. The editor validates its project changes. Read [activation, cancellation and runtime limits](../sdk/runtime.md) before building a long-running operation. For package admission, supported distributions and saved project dependencies, see [installation and updates](plugin-system.md) and [compatibility policy](plugin-sdk-compatibility.md).
