# Trusted extension workbench views

A general Node extension can contribute several sandboxed views. View declarations
let the workbench list a tool without executing its Node entry:

```json
{"main":"dist/extension.cjs","contributes":{"views":[{"id":"overview","name":"Project overview"}]}}
```

Opening a declared view activates its trusted package lazily. Refusing package
trust executes no Node code; the user can grant that trust in Plugins. Opening a
view does not add per-action approval. Runtime-created views are also supported.

```ts
const view = await context.ui.registerView({
  id: 'overview', title: 'Project overview', entry: 'assets/view.html'
});
view.onMessage(async (value, {signal}) => {
  // Validate the application's message shape here. This is an ordinary Node handler.
  if (value && typeof value === 'object' && 'inspect' in value) {
    const project = await context.workspace.read();
    if (!signal.aborted) await view.postMessage({project});
  }
});
await view.reveal();
```

The returned `ExtensionView` is a Disposable with `reveal`, `postMessage`,
`onMessage` and `onDidClose`. Listener registrations are Disposables too. Disposal
is idempotent. A disposed handle cannot control a later registration with the same
ID. Removing a registration or stopping its extension closes the owned views.
Extension shutdown need not deliver view callbacks; use `deactivate` for cleanup
that must run during shutdown.

## Authoring assets

The SDK bundles `src/extension.ts` as the Node entry and recursively copies regular
files from `src/assets/` into the installed `assets/` tree. UI JavaScript/CSS/HTML
and supported portable images, media, fonts and data are included in the package
fingerprint. UI files are not executed during checking, building or inspection.
Bundle a UI framework separately into `src/assets` if required; use relative
asset URLs so it can load beneath its packaged entry path. The asset collector
rejects links, unsupported native addons/executables and resource-limit overflow.
The host validates the complete package again before opening its view. A live
view serves its validated in-memory snapshot, not arbitrary filesystem URLs.

## Renderer bridge

Each live view has a separate sandboxed renderer, exclusively leased ephemeral session, unique
origin and sender-bound preload. It has no Node globals or application IPC bridge.
Only the validated package's `dist/` and `assets/` files can be requested. Network,
file URLs, nested frames, cross-document navigation, popups, downloads and permission
requests are denied. Scripts load from package files; inline scripts and eval are
not permitted. Browser workers may load package scripts or blob URLs and have no
Node or host bridge. WebGL is enabled for richer tools; blob media/image/font data
can be displayed without granting filesystem access. Styles can use local files or inline CSS. The Node extension retains
the full access the user trusted and handles privileged work through messages.

In a view script, use `window.clipcraftView` (typed as `ExtensionViewClient`):

```js
const info = await window.clipcraftView.getInfo();
window.clipcraftView.onMessage(value => {
  document.querySelector('output').textContent = JSON.stringify(value);
});
await window.clipcraftView.postMessage({inspect: true});
```

`getInfo` returns API version 1, view ID/title, extension ID and theme colors. It
never exposes the internal IPC token. `onMessage` and `onThemeChanged` return
unsubscribe functions. Host colors are also applied as `--cc-background`,
`--cc-surface`, `--cc-text`, `--cc-muted`, `--cc-accent` and `--cc-border` CSS variables.

Messages must be finite, acyclic JSON data with a 256 KiB structural budget,
maximum depth 64 and dense arrays of at most 16,384 entries. Structural overhead
counts toward that budget. Binary output should use media artifacts or the other
Node APIs. Each direction permits at most 6,000 messages and 64 MiB of serialized
data per minute per view, with at most eight requests/deliveries in flight.

A renderer's `postMessage` resolves after its Node handlers complete. A Node
view handle's `postMessage` resolves after the renderer bridge acknowledges
delivery, not after asynchronous UI work finishes; awaiting it provides
backpressure. It returns false when that view is not open. Missing delivery after
five seconds closes that unresponsive view. Closing aborts pending handler signals
and rejects pending deliveries. A heartbeat separately closes an unresponsive
renderer without terminating its sibling views or Node extension. Host event-loop
stalls do not count as view unresponsiveness.

## Workbench lifecycle and controls

The editor panel workbench can keep multiple views open in tabs. Explicit reveal
switches from Settings to the workbench. On Home or behind other host dialogs,
native focus remains pending until the workbench can be shown. Switching tabs or hiding
the workbench preserves each renderer's state. Closing a tab destroys its renderer
and starts native state cleanup. A host creates at most sixteen private sessions;
a slot can be leased again only after renderer destruction and successful cleanup
of connections, storage, cache, authentication and code caches. Every opening uses
a fresh origin and bridge token. Cleanup failure or timeout permanently excludes
that slot until app restart. Concurrent live views never share a session.
The registration remains available to reopen. Views are
hidden while host dialogs, settings or menus obscure them. Resizing, theme changes
and focus transfer are handled by the host. Escape returns focus to workbench
controls; Tab can leave the view at its first/last sequential control. The
[native keyboard followup](plugin-extension-keyboard.md) records the macOS
acceptance, corrected form-control boundaries and remaining UX coverage.

Closing clears the captured package asset map and retains request denial while
the renderer shuts down. The [cleanup followup](plugin-extension-view-cleanup.md)
records the native buffer-retention failure, its correction and the remaining
long-session memory acceptance.

Hidden views cannot request host focus. Queued focus notifications also require
the selected, unobscured workbench, and a layout clipped to no usable native area
preserves pending reveal. The [layout followup](plugin-extension-layout.md)
records these native focus checks, minimum-window bounds and long-label coverage.

Stateless native denial callbacks live outside the opening view's closure scope
so closed jobs and native wrappers can be collected. The [normal-session followup](plugin-extension-normal-session.md)
records this correction and the original lifetime session-cache finding. The
[session reuse followup](plugin-extension-session-reuse.md) records the subsequent
bounded pool and native storage-isolation checks. These bounds do not establish a
production memory budget.

There are at most eight registered views per extension and sixteen open views in
the workbench. Toolbar contributions show two compact icon actions plus an
overflow menu; long labels stay in accessible names/tooltips/menu rows. Native
command feedback accepts bounded strings and safely falls back when a command
returns a malformed message shape.

The optional source example is `examples/extensions/workbench`. No app, SDK or
host API version was increased for this pre-v1 work.
