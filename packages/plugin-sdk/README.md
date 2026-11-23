# Build your first extension

Add **Plugins → Mark opening** to the editor. The command places a named marker at the start of the current timeline. When you finish, you can install the same archive in another copy of ClipCraft and remove the edit with a single Undo.

| Before you start | What you'll produce |
| --- | --- |
| A ClipCraft checkout with its dependencies installed, the SDK dependencies installed, and an editable project in the desktop app. | A typed Node extension, a validated installable archive and a marker you can verify in the timeline. |

This guide targets SDK **0.8.0** with ClipCraft **2.0.0**, host API **1**. The SDK is pre-alpha. Build it from the same checkout as the host. Root dependency installation requires Node 22.12 or later. The SDK itself supports Node 20.19 or later.

## Start an extension

Run these commands from the ClipCraft repository root. Choose an unused directory alongside the checkout. Keep this shell in the repository root for the rest of the tutorial.

```sh
npm ci --prefix packages/plugin-sdk --ignore-scripts
node scripts/build-plugin-sdk.cjs
node packages/plugin-sdk/dist/cli.cjs create ../opening-marker \
  --id studio.opening --name "Opening marker" --publisher Studio
```

The scaffold writes a manifest, TypeScript source and a local SDK dependency. Edit the two files below. The build step creates the installable directory.

**Using a packaged SDK?** In your own development workspace, run `npm install --save-dev /path/to/clipcraft-sdk.tgz` with the tarball supplied for your editor. Use `npx --no-install clipcraft-plugin` in place of `node packages/plugin-sdk/dist/cli.cjs` in each command, starting with `create`. The generated project references the SDK that created it. Point that dependency at the shared SDK distribution before handing the source to another developer.

## Declare the command

Replace `../opening-marker/plugin.json` with the following manifest. Its package ID identifies the author’s namespace. The local command ID must match the one registered in the source.

```json
{
  "id": "studio.opening",
  "name": "Opening marker",
  "publisher": "Studio",
  "version": "0.1.0",
  "apiVersion": 1,
  "main": "dist/extension.cjs",
  "contributes": {
    "commands": [{ "id": "mark-opening", "name": "Mark opening" }]
  }
}
```

## Implement the timeline edit

Replace `../opening-marker/src/extension.ts` with this file.

```ts
import type { ExtensionContext } from '@clipcraft/plugin-sdk/extension';

export async function activate(context: ExtensionContext) {
  await context.commands.register('mark-opening', async () => {
    const { documentId, projectRevision } = await context.workspace.inspect({
      section: 'markers',
      limit: 1
    });

    await context.markers.apply({
      documentId,
      projectRevision,
      operations: [{ type: 'add', time_sec: 0, label: 'Opening' }]
    });
    return { message: 'Added the opening marker.' };
  });

  await context.ui.registerAction({
    id: 'opening-action',
    title: 'Mark opening',
    location: 'toolbar',
    command: 'mark-opening'
  });
}
```

The inspection binds the write to the open document and its current revision. If either changes before the write, the host can reject it. Read again and reconsider the edit before retrying. Registering the action during activation puts the command in the editor’s **Plugins** menu. Other extensions can address it as `studio.opening.mark-opening`.

## Build and install

```sh
node packages/plugin-sdk/dist/cli.cjs check ../opening-marker
node packages/plugin-sdk/dist/cli.cjs build ../opening-marker
node packages/plugin-sdk/dist/cli.cjs validate ../opening-marker/dist
node packages/plugin-sdk/dist/cli.cjs pack ../opening-marker/dist ../opening-marker.tgz
node packages/plugin-sdk/dist/cli.cjs inspect ../opening-marker.tgz
```

In **Settings → Plugins → Installed**, install the archive. Confirm its identity and choose **Trust & activate**. Trust grants this exact package full Node access to your files, local programs and the network. Omit `activationEvents` for startup activation as in this example.

## Verify in the editor

1. Open a project with timeline content. Choose **Plugins → Mark opening** from the toolbar.
2. Look at the start of the timeline for the **Opening** marker. The playhead can be elsewhere when you run the command.
3. Use Undo once. The marker disappears and your clips stay in place.

| If you see this | What to check |
| --- | --- |
| The command is missing | Open Installed, verify the package is enabled and running, then check the extension log for activation or registration errors. |
| The installer rejects the folder | Select the archive or the compiled `dist` directory. The authoring workspace also contains development files. |
| Packing fails on a second run | Choose a new archive filename. For distribution, increment the package version when its contents change. |
| Your source change has no effect | Rebuild. To iterate with live reload, open a source-folder development session. Installed copies keep their own immutable payload. |

## Choose your next task

| Goal | Guide |
| --- | --- |
| Inspect clips, edit captions or submit an atomic edit | [Project and timeline APIs](../../docs/sdk/project-editing.md) |
| Add controls or a custom panel | [Actions, controls and views](../../docs/sdk/ui.md) |
| Create a package of presets or licensed assets | [Creative pack tutorial](../../docs/sdk/creative-packs.md) |
| Publish a package or diagnose a failed build | [CLI and packaging](../../docs/sdk/authoring.md) |
| Find a method or test a host capability | [Extension API reference](../../docs/design/plugin-extension-api.md) · [Capability keys](../../docs/design/plugin-sdk.md) |
| Start from working code | [Runnable extension examples](../../examples/extensions/README.md) |

<a id="online-media-sources"></a>

For online media providers, follow the [media source service contract](../../docs/sdk/services-hooks.md#online-media-sources).

<a id="creative-content-packs"></a>
<a id="creative-packs"></a>
<a id="authoring-commands"></a>
<a id="general-host-apis"></a>
<a id="historical-packages"></a>
<a id="verify-the-sdk-checkout"></a>

The [authoring reference](../../docs/sdk/authoring.md) includes the CLI, package constraints, historical package migration and SDK checkout verification.
