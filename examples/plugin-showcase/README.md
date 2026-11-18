# Plugins in action

From the ClipCraft checkout:

```sh
node scripts/create-plugin-showcase.cjs --open
```

The builder prepares installable archives, editable payloads, buildable Node
sources, original demo media and a labeled eight-stage project in a new temporary
directory outside the checkout. It opens the development app in a separate
Electron profile. Your regular inventory, projects, settings and credentials are
not used. No installer is built.

Play the project to see titles/lower thirds, an animated effect, transition,
LUT/color looks, motion, fonts and highlighted captions. Three original generated
signals demonstrate WAV, MP3 and OGG. Bundled Fontsource fonts retain their exact
bytes and licenses. This sample is a package demonstration, not a production
sound library.

To prepare without opening, omit `--open`. To choose a new output directory:

```sh
node scripts/create-plugin-showcase.cjs --output /tmp/my-clipcraft-plugin-demo
node scripts/launch-plugin-showcase.cjs --bundle /tmp/my-clipcraft-plugin-demo/showcase.json
```

Keep that directory in place because the project references its generated media.
Each launch gets a fresh profile. `START HERE.md` lists exact paths and
`LICENSES.md` includes the original font terms. Save your experiments explicitly.
All archives can also be installed through your regular app's Settings → Plugins.

## Try the creative packs

| Content | Example | In the app |
| --- | --- | --- |
| Titles, lower thirds, caption styles | `examples/plugins/title-caption-demo` | Play the first/last sections or apply a style to selected text. |
| Animated effect | `examples/plugins/color-pulse` | Play the effect section and change its amount/speed. |
| Transition | `examples/plugins/diagonal-reveal` | Play across the transition boundary and adjust the incoming clip. |
| Motion | `examples/plugins/motion-demo` | Preview push/drift or choose Animation → Motion packs. |
| Color looks | `examples/plugins/color-look-demo` | Preview and apply the warm, cool or monochrome look. |
| LUTs | `examples/plugins/lut-demo` | Preview cubes and their half-strength looks. |
| Sounds | Generated `payloads/sound-demo` | Preview/Add licensed WAV, MP3 and OGG from the pack browser or Audio library. |
| Fonts | Generated `payloads/font-demo` | Play the font section or select a pack family on a text clip. |
| Export presets | `examples/plugins/review-copy` | Choose the review-copy settings in native export. |

## Try the Node extensions

Offline Node examples are installed but activate only after explicit package
trust. They can access files, network and programs. Installation and inspection
never execute authored code. Their compiled payloads are in `payloads/`; copied,
buildable TypeScript projects are in `sources/`.

| Source under `examples/extensions` | In the app |
| --- | --- |
| `chapter-markers` | Add chapter markers, then Undo the atomic edit. |
| `project-dashboard` | Open a live project summary view, save a note and invoke its chapter command. |
| `preference-workbench` | Save configuration in a workbench view and reopen it. |
| `clip-controls-demo` | Select an unlinked picture; use its toolbar, inspector or clip-context action. |
| `media-library-jobs` | Choose local input, process it with managed FFmpeg, preview and adopt the result. |
| `gif-export` | Set range/size, then export a verified GIF from Plugins or the native export action. |
| `workbench` | Open independent views and exchange messages with the Node activation. |
| `local-ai-provider` | Opt in: configure your actual service/model, then choose the ordinary AI engine in Assistant settings. |
| `ai-chapter-markers` | Opt in: configure an AI connection, review caption sharing and anchored chapter proposals. |
| `caption-translation` | Opt in: review caption sharing/translation, then create a separate hidden track. |
| `reviewed-gif-upload` | Opt in: configure your destination, publish a GIF locally and review each HTTPS upload. |
| `local-speech` | Opt in: select a compatible CLI and exact model, transcribe picked audio and review/save SRT. |

The five service/tool examples are not installed automatically. All executable
features use the same general commands, services, events and UI APIs. Historical
command/panel recipes are retired. Existing historical packages can coexist with
same-version Node replacements; each Node fingerprint requires fresh trust.
Application 2.0.0, SDK 0.8.0 and host API 1 remain unchanged.

The optional VoiceStudio connector source is documented separately in
[general examples](../extensions/README.md); the showcase does not install it.

## Browse, author and clean up

- In Settings → Plugins → Pack content, search/filter, favorite items, play or
  scrub their samples, then Apply to a compatible clip. Undo restores the project.
- For creative authoring, start a development session on `payloads/color-pulse`
  or `payloads/lut-demo`, enable Watch, then edit the copied expression/cube.
  Temporary previews cannot become saved project dependencies.
- For Node authoring, build the copied source and start a development session on
  that source project. Session trust/settings are temporary.
- Preview a sound, review active cache usage, close the preview, then explicitly
  remove reviewed unused files. Project-owned media stays protected.
- Create a creative pack from current project styles/looks/motion and your own
  licensed asset files, then export and explicitly install its archive.

`recipes/` contains text-only sound/font builder inputs. Binary examples stay
outside Git. Verify the prepared packages and real app workflow with:

```sh
node tests/unit/plugins/test-plugin-showcase.cjs
```
