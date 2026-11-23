# Plugin SDK and authoring tools

This checkout pairs ClipCraft 2.0.0, SDK 0.8.0 and host API 1. The extension API
is pre-alpha. Use the SDK from the same checkout as the app you are testing.
A package's own version and minimum app version are separate manifest fields.
[Compatibility and stored data](plugin-sdk-compatibility.md)

## Choose an entry point

| Entry point | Use |
| --- | --- |
| `@clipcraft/plugin-sdk` (ES modules) | Manifest and creative types, `definePlugin`, extension and contract helpers, SDK and host version constants. |
| `@clipcraft/plugin-sdk/extension` (ES modules) | `ExtensionContext`, `defineExtension`, `defineServiceContract`, `defineHookContract` and the types for authoring trusted Node extensions. |
| `@clipcraft/plugin-sdk/authoring` (CommonJS) | Automate `createPlugin`, `checkPlugin`, `buildPlugin`, `validatePlugin`, `inspectPlugin` and `packPlugin`. |
| `clipcraft-plugin` | Scaffold, type-check, build, watch, validate, inspect or package a project from the command line. |

The SDK needs Node 20.19.0 or later. Build it from this repository, scaffold a
project, and edit its manifest and source. Validate the compiled `dist` folder
before installing it in **Settings → Plugins**. For a second machine, pack the
folder into a new `.tgz`. The quick start gives the exact commands and template
names. [SDK quick start](../../packages/plugin-sdk/README.md#start-an-extension) ·
[Programmatic authoring types](../../packages/plugin-sdk/src/authoring.d.cts)

## Discover what a running editor supports

Call `await context.host.capabilities()` during activation. Its `features`
object maps names to integer revisions. Check the specific features you use
before registering dependent controls. `host.read()` separately reports app
and API versions, platform, architecture and paths to the host media tools.
The feature names below are grouped by the task an extension performs.

| Task | Runtime feature keys | Author guide |
| --- | --- | --- |
| Register or compose extensible behavior | `commands`, `events`, `services`, `services.contracts` | [Commands, events and services](plugin-extension-api.md#3-the-context) |
| Participate in document operations | `hooks`, `hooks.lifecycle`, `hooks.order`, `hooks.custom`, `hooks.timelineDrafts` | [Document lifecycle](plugin-document-lifecycle-hooks.md), [custom hooks](plugin-custom-hooks.md) |
| Read and edit projects | `projects`, `workspace.inspection`, `editor.transactions`, `editor.tools`, `editor.undo`, `markers` | [Project inspection](plugin-project-inspection.md), [editor tools](plugin-extension-document-tools.md) |
| Work with media and captions | `captions`, `captions.styles`, `media`, `media.gif`, `media.sources` | [Media and source integrations](../../packages/plugin-sdk/README.md#online-media-sources), [caption examples](../../examples/extensions/README.md) |
| Add timeline and rendering definitions | `timeline.types`, `timeline.custom`, `ui.customProperties`, `rendering.glsl` | [Typed timelines](plugin-custom-timeline.md), [GLSL](plugin-glsl.md) |
| Render, publish and run helpers | `exports`, `exports.formats`, `files.publish`, `processes`, `processes.streaming`, `processes.servers`, `jobs` | [Native export](plugin-extension-exports.md), [managed jobs and files](plugin-extension-jobs-files.md), [streaming and servers](plugin-extension-expansion.md) |
| Store preferences and credentials | `configuration`, `configuration.project`, `secrets` | [Typed services and settings scopes](plugin-sdk-general-contracts.md) |
| Add native controls and menus | `ui.settings`, `ui.actions`, `ui.actions.state`, `ui.inspector`, `ui.inspector.automation`, `ui.inspector.effects`, `ui.shortcuts`, `ui.menus`, `ui.status` | [Native controls](plugin-extension-native-controls.md), [keyboard shortcuts](plugin-extension-shortcuts.md) |
| Prompt or open a view | `ui.messages`, `ui.input`, `ui.dialogs`, `ui.views`, `ui.overlays`, `ui.windows`, `ui.docking`, `ui.viewPlacements` | [View placement](plugin-open-extension-surfaces.md#view-destination-contract), [native prompts](plugin-extension-expansion.md) |

For method signatures, input and output types, callback lifetimes and limits,
use the [Extension API guide](plugin-extension-api.md) and
[public declarations](../../packages/plugin-sdk/src/extension.d.ts).
The [runtime capability registry](../../shared/extensionCapabilities.cjs) is
the source for the feature names.

## Run an example in the editor

Use **chapter-markers** for a first command. Open a project, run **Add chapter
markers**, inspect the result on the timeline and use Undo. Use **sdk-workbench**
for custom timeline types, views and native integrations, **native-properties**
for inspector controls, or **scene-reviewer** for a typed hook subscriber.
Each project has build instructions and lists any external service it needs.
[Runnable extension catalog](../../examples/extensions/README.md) ·
[Creative pack catalog](../../examples/plugin-showcase/README.md)

Use a temporary development session to reload changes and inspect diagnostics.
The SDK verification command checks the authoring and distribution contracts.
Recorded platform runs and release gates have separate evidence.
[Developer sessions](plugin-extension-development.md) ·
[SDK verification](plugin-sdk-validation.md) · [Platform acceptance](plugin-remote-acceptance.md)
