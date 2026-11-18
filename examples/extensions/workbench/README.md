# Workbench views example

This optional general Node extension opens two independent sandboxed views. The
views retain their drafts/counters while switching tabs, and inspect the current
project by messaging their Node extension. They have no direct Node or editor IPC
access. It is not bundled or automatically installed.

From the repository root:

```sh
node scripts/build-plugin-sdk.cjs
node packages/plugin-sdk/dist/cli.cjs check examples/extensions/workbench
node packages/plugin-sdk/dist/cli.cjs build examples/extensions/workbench
node packages/plugin-sdk/dist/cli.cjs pack examples/extensions/workbench/dist /tmp/clipcraft-workbench.tgz
```

Install the archive in Settings > Plugins and trust its Node access. Open its
views through the extension toolbar actions or the panel workbench. The complete
view/message/lifecycle contract is in `docs/design/plugin-extension-views.md`.
Run "Show a workspace message" from its Commands section to see host-rendered
feedback with an action that opens the session-notes view. Dismissal leaves the
workspace as it is; message lifecycle details are in
`docs/design/plugin-extension-messages.md`.

UI source is under `src/assets`, copied into the package's `assets` tree. Node
source is `src/extension.ts`. A UI framework can be compiled separately into the
same asset tree without adding another executable extension type.

The manifest declares lazy shortcuts for project overview (`Ctrl+Shift+U`) and
the message command (`Ctrl+Alt+N`, also on Home). Activation registers a session
notes shortcut (`Ctrl+Alt+J`). On macOS, Command also works for Ctrl. Remap these
under the Workbench views group in Shortcuts settings.

Run "Render the current project" from Commands with a project open to export an
MP4 to Downloads under a unique name. It uses the native export UI and the
project's current quality settings, runs export preparation hooks, reports managed
job progress and supports Cancel. The result contains the actual saved path.
The general API is documented in `docs/design/plugin-extension-exports.md`.

"Inspect the last project event" reports the latest observed document revision
and its source. It uses a typed `project.changed` listener with explicit initial
replay; the subscription belongs to the activation and is disposed on Stop.
