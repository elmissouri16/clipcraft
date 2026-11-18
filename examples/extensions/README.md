# General Node extension examples

These source projects use the same trusted extension host. They define no
specialized speech, AI-provider or processing extension types: commands,
services, events, views and native settings compose the behavior.

From the repository root:

```sh
node scripts/build-plugin-sdk.cjs
node packages/plugin-sdk/dist/cli.cjs build examples/extensions/chapter-markers
```

Install that project's compiled `dist` directory, or start a development session
with the built project. Installation/inspection never executes authored code.
Trust & activate grants Node access to files, network and programs. Development
trust and settings last for that session. Example and SDK versions are unchanged.

| Source project | Try it in the app |
| --- | --- |
| `chapter-markers` | Set Chapter count in Plugins settings, then run Add chapter markers. Existing positions are preserved; changes use one Undo step. |
| `project-dashboard` | Open its workbench view for live statistics, chapter markers and a saved note. Gaps are excluded from picture counts. |
| `preference-workbench` | Open its view, save a label/accent/spacing, then close and reopen it. Configuration stays separate from the project. |
| `clip-controls-demo` | Select one unlinked picture clip, set opacity in Plugins settings and use its toolbar, inspector or clip-context action. |
| `media-library-jobs` | Choose an operation in Plugins settings, run the command and select a source. The extension runs managed FFmpeg, imports the verified result and opens the host preview. Add inserts it with Undo. |
| `gif-export` | Set a short range, frame rate and size. Export to a new GIF; the extension verifies frames before publishing it. |
| `reviewed-gif-upload` | Save a GIF locally, then separately review one optional HTTPS PUT. Upload cancellation can return an uncertain outcome while retaining the GIF. |
| `local-speech` | Choose a compatible CLI, import/download an exact pinned model, transcribe picked media locally and review a new SRT. |
| `local-ai-provider` | Configure an installed local model/connection in Plugins settings, then select the ordinary service in Assistant settings and use CraftAI's actual tool loop. |
| `ai-chapter-markers` | Review sharing of existing caption text, validate anchored chapter suggestions and explicitly add markers with Undo. |
| `caption-translation` | Choose a source track/language, review original and translated text, then create one separate hidden caption track with Undo. |
| `workbench` | Open two independent views, exchange messages, invoke commands and render the current project. |
| `voicestudio` | Configure the optional service in Voice settings. Its transport runs in the extension and its ordinary service connects through `voice.engines`. |

The first eleven sources replace historical sandbox recipes with the same IDs,
publishers and versions. The host retains the old immutable package beside its
Node replacement so pinned creative assets remain available. The new Node
fingerprint requires fresh trust. Changed Node-to-Node bytes still follow normal
immutable version rules.

After installing a replacement with the same package ID and publisher, Settings
labels the retained historical row **Replacement installed**. **Open replacement**
selects the Node package and its own trust/activation controls. Installation does
not transfer execution trust or convert old panel preferences into Node settings.
Disabled replacements remain installed; removing the replacement restores the
historical row's migration guidance. Missing, damaged, recovered or pending-removal
replacements do not count as an installed replacement in this UI.

Historical executable bytes live only under `tests/fixtures/plugins/legacy`.
Their runtime, SDK recipes and specialized integration declarations are retired.
CraftAI discovers the new declared commands with native review, actual receipts
and one agent Undo step. Creative packs remain supported under `examples/plugins`.
GIF examples also contribute an ordinary action to the native export dialog.
