# Actions, controls and views

Put a command on an existing editor surface, bind native inspector controls to a selected clip, or give a workflow its own HTML view.

## Register an action

```ts
await context.ui.registerAction({
  id: 'run',
  title: 'Run it',
  location: 'toolbar',
  command: 'greet'
});
```

Set `location` to choose where the action appears.

| Location | Where editors find the action |
| --- | --- |
| `toolbar` | The **Plugins** menu in the toolbar |
| `inspector` or `context` | The inspector or a clip’s context menu |
| `export` | The export dialog |
| `settings.plugins` or `settings.voice` | Your extension’s settings or Voice settings |
| `menu.project` or `menu.timeline` | The project menu or the timeline menu |

## Collect input and report status

```ts
const label = await context.ui.showInput({
  title: 'Label',
  minLength: 2,
  maxLength: 80
});

const status = await context.ui.registerStatus({
  id: 'work',
  title: label ?? 'Ready',
  alignment: 'right'
});

await status.update({
  title: 'Finished',
  tooltip: 'The local task completed'
});
```

`showInput` returns the submitted string, or `undefined` when the user cancels, the prompt expires or the extension stops. You can set a default value, a placeholder, password mode and length limits.

Keep the registration returned by `registerStatus` to update the same item as work progresses. Status items support icons, ordering and an optional command. Stopping the extension removes its items.

## Settings

Use `registerSettings` to add a native form to your extension’s settings. Read ordinary field values through `configuration` and fields declared as `secret` through `secrets`.

```ts
await context.ui.registerSettings({
  id: 'main',
  title: 'My extension',
  location: 'settings.plugins',
  fields: [
    {
      key: 'count', label: 'Chapters', type: 'number',
      default: 5, min: 1, max: 20
    },
    {
      key: 'mode', label: 'Mode', type: 'select', default: 'fast',
      options: [
        { label: 'Fast', value: 'fast' },
        { label: 'Careful', value: 'careful' }
      ]
    },
    { key: 'apiKey', label: 'API key', type: 'secret' }
  ]
});

// Uses the default of 5 until the user changes it.
const count = await context.configuration.get<number>('count');
```

## Shortcuts, messages and dialogs

```ts
await context.ui.registerShortcut({
  id: 'run-key',
  title: 'Run it',
  command: 'greet',
  keys: ['Alt+Shift+G']
});

const choice = await context.ui.showMessage({
  message: 'Add markers?',
  actions: [{ id: 'yes', title: 'Add' }]
});

const files = await context.ui.showOpenDialog({
  title: 'Choose a clip',
  filters: [{ name: 'Video', extensions: ['mp4'] }]
});
```

A message is a non-blocking card: single-line text, at most three actions, 1
to 240 seconds; it resolves to the chosen action ID or `undefined`. One file
dialog is open at a time; `defaultPath` must be absolute.

## Open and move an HTML view

```ts
const view = await context.ui.registerView({
  id: 'panel',
  title: 'My panel',
  entry: 'assets/panel.html',
  placement: 'workbench'
});
view.onMessage(async message => {
  if (message === 'ready') {
    const project = await context.workspace.read();
    await view.postMessage({ project });
  }
});
await view.reveal();
```

```html
<!-- src/assets/panel.html -->
<!doctype html>
<meta charset="utf-8">
<body>
  <div id="out"></div>
  <script src="panel.js"></script>
</body>
```

```js
// src/assets/panel.js
window.clipcraftView.onMessage(value => {
  document.getElementById('out').textContent = JSON.stringify(value);
});
window.clipcraftView.postMessage('ready');
```

The default placement is `workbench`. Rail views receive a native navigation button; library views receive a tab beside Media.
Switching tabs hides the native view while keeping its page state. Registered
tabs appear while the extension is active; Stop removes them.

A view is an isolated page with no Node and no network. It talks to your
extension only through messages; do privileged work in the extension.
**Scripts must be files**: inline `<script>` and `eval` are blocked, and a
blocked or failing script is reported in your extension's log. Use the
`--cc-*` CSS variables and `onThemeChanged` for colours. Declare the view in the
manifest to let the user open it before your extension is running. Messages
sent while the page loads are delivered once it is ready. View state is not
kept after closing: store what matters in `configuration`.

Native actions also support custom vector icons, order and live availability;
`registerAction` returns an updatable registration. `ui.registerInspector`
registers native fields bound directly to the selected clip's properties, with
normal Undo and stale-target/lock checks. See [native controls](../design/plugin-extension-native-controls.md)
and the [source example](../../examples/extensions/native-properties/README.md).

Move the existing page without losing its local state:

```ts
await view.setPlacement({
  placement: 'floating', width: 640, height: 480
});
await view.setPlacement({
  placement: 'player-overlay',
  bounds: { x: 0.1, y: 0.1, width: 0.4, height: 0.3 }
});
await view.setPlacement({ placement: 'bottom' });
```

Destinations are `workbench` (right dock), `left-rail`, `library`, `bottom`,
`player-overlay`, `timeline-overlay`, `floating` and `modal`. Native selectors
also move pages; the workbench picker can bring floating/overlay views back.
Overlay geometry is normalized to the player stage or timeline viewport and must
fit inside it. Overlays are interactive editor UI; export content uses rendering
APIs. Floating/modal pixel dimensions apply only to those windows. Close releases
the page; Stop removes all windows. See the [destination contract](../design/plugin-open-extension-surfaces.md).

[Extension API index](../design/plugin-extension-api.md) · [Type declarations](../../packages/plugin-sdk/src/extension.d.ts)
