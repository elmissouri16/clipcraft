# Install and manage plugins

Use a **creative pack** for presets, looks, fonts and sounds. Install a **Node extension** for commands, panels, automation or a service such as an online media source.

## Install a package

1. Open **Settings → Plugins → Installed** and choose the install action. Select the package’s `.tgz` archive.
2. Review the publisher, version and contributions. A publisher name is self-declared. For a third-party Node extension, choose **Trust & activate** only when you trust the source. The code runs with your account’s access to local files, programs and the network.
3. For a pack, open **Pack content**. Select a contribution to preview it, then apply it to a compatible clip or project. For an extension, open the location its author registered. Toolbar commands appear in **Plugins**.

## Find installed features

| Installed item | Where to use it |
| --- | --- |
| Export preset | Open **Export** and choose it from the quality menu. |
| Sound, font, effect, transition or look | Browse **Pack content**. Use its preview and apply controls or the corresponding editor library. |
| Command or view | Look in the toolbar’s **Plugins** menu, an inspector, the export dialog, or the dock specified by the author. |
| Media, speech or AI service | Configure the service under Settings. It appears in the editor picker for its integration point. |

## Try a package during development

Enable developer tools under **Create & develop** to install a compiled folder or start a source-folder development session. Temporary builds have their own trust, settings and secrets. Use an installed build when you want a saved project to depend on a contribution. [Development sessions and logs](plugin-extension-development.md)

## Manifest v1

Use a lowercase `publisher.name` ID, a display `name`, `publisher`, a stable
three-part `version`, `apiVersion: 1` and a `contributes` object. Optional fields
include `minClipcraftVersion`, `description` and a packaged PNG `icon`. The SDK
checks these declarations and the files they reference before packaging.
[Manifest types](../../packages/plugin-sdk/src/index.d.ts)

| Contribution keys | What the editor provides |
| --- | --- |
| `exportPresets` | Named encoder settings in the quality menu. Applying one copies its settings into the project. |
| `effects`, `transitions` | Parameterized expressions or GLSL fragment functions with native controls and a shared preview/export renderer. [Shader authoring](plugin-glsl.md) |
| `sounds`, `fonts` | Audio library assets (WAV, MP3, OGG) and typefaces (WOFF2, TTF, OTF) with license metadata. [Content packs](plugin-content-packs.md) |
| `textStyles`, `luts`, `colorPresets`, `motionPresets` | Title and caption styles, CUBE LUTs, grading and source-time motion presets. [Creative examples](../../examples/plugin-showcase/README.md) |
| `trackTypes`, `clipTypes` | Saved custom visual, audio and metadata rows, typed property forms and shader, media or metadata-only rendering. [Custom timeline types](plugin-custom-timeline.md) |
| `commands`, `views`, `shortcuts` | Named entry points, views and key bindings for a Node extension. Its activation registers the implementation. [Extension API guide](plugin-extension-api.md) |

A creative pack omits `main`. A Node extension sets `main` to
`dist/extension.cjs` and exports `activate(context)`, with an optional
`deactivate()`. Omitting `activationEvents` selects startup. An explicit list
can activate on a command, event, service, hook, view or UI request. Authors
can build voice engines, AI engines and online media sources by registering a
service and its integration point. [SDK and examples](plugin-sdk.md)

## Updates, saved projects and removal

New package bytes normally require a new version. The host keeps immutable
versions and allows one preferred version of an ID. Trust belongs to an exact
fingerprint. An updated third-party Node payload needs its own trust decision.
Stopping a running extension releases managed jobs, processes, registrations
and views. Global extension settings and secrets can survive uninstall and
reinstall. [Compatibility and stored data](plugin-sdk-compatibility.md)

Projects record the exact definitions they use. Retained versions can satisfy
older project references while the package is enabled. A missing effect,
transition or custom type is reported in the editor and can block export.
Restore the exact package or review the applicable replacement or bypass in
the project. Opening a project never installs a dependency. An applied export
preset is a snapshot, so its saved settings remain usable if the pack is removed.
[Project dependencies](plugin-creative-expansion.md) ·
[Custom type recovery](plugin-custom-timeline.md#native-controls-and-persistence)

## Troubleshoot an installation

| Symptom | Action |
| --- | --- |
| Archive or folder rejected | Inspect the compatibility message. For a source workspace, build it and select its compiled `dist` directory. |
| Installed command is absent | Verify the extension is enabled, trusted and running. Check the activation log and whether its action requires a selection or an open project. |
| A reopened project reports a missing effect or clip type | Restore the exact package fingerprint requested by the project, or use its supported replacement or bypass flow. |
| A changed build is rejected at an existing version | Give the new payload its own version and install it again. Third-party executable changes need fresh trust. |
| Several installed versions have vanished | Review the [inventory recovery procedure](../contributors/plugin-recovery.md#inventory-recovery) before changing installed files. |

## Author an extension or pack

Follow [Build your first extension](../../packages/plugin-sdk/README.md) or [Create a creative pack](../sdk/creative-packs.md). The [example library](../../examples/extensions/README.md) includes editing, export and service implementations.

<a id="components-and-ownership"></a>
<a id="inventory-recovery"></a>

For storage ownership and recovery, see [plugin inventory internals](../contributors/plugin-recovery.md). Older executable formats have a separate [migration guide](plugin-legacy-retirement.md).
