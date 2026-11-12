> **Built on the work of Hamza Abika.** This fork is based on his original
> [ClipCraft repository](https://github.com/hamzaabika/clipcraft), with thanks for
> the editor and foundation he created. It is developed independently and is
> taking a different direction, focused on agent-assisted video creation,
> editable motion graphics, and closer integration with local tools.
>
> **Support the original author:** [Donate to Hamza Abika](https://paypal.me/hamzaAbika).
> Donations through this link go to the original author.

# ClipCraft · Independent fork

**A desktop video editor where you can edit by hand, work with an AI agent, or move between both.**

Build a video on the timeline, ask CraftAI to help shape it, generate scenes and
motion graphics, and review the changes in the same editor. This fork builds on
ClipCraft's editing foundation with a focus on agents that understand the
project, make visible changes, and leave the result editable.

[What this fork adds](#what-this-fork-adds) ·
[Editing tools](#editing-tools) ·
[Getting started](#getting-started) ·
[Documentation](#documentation) ·
[License and attribution](#license-and-attribution)

## What this fork adds

### Work with agents inside or outside the editor

- **Native Codex, Claude, and OpenCode integration.** Use an installed agent and
  its existing sign-in. Settings can download a supported native runtime when
  needed, with progress, cancellation, and integrity checks.
- **Your choice of provider.** CraftAI also supports API providers, local Ollama,
  and custom compatible endpoints. Choose models and supported thinking levels
  from the chat header.
- **External agents over MCP.** Connect an agent running outside ClipCraft to the
  open app. Enable it in Settings, approve the connection, then let it open
  projects and use the editor's tools. One agent holds the editor at a time.
- **Edit and Agent workspaces.** Switch between hands-on editing and a layout
  centered on the conversation, preview, and timeline.

Native agents use their own accounts and model access. Cloud models and online
media services still require a connection; local editing does not require an AI
provider.

### Give the agent context and review its work

Attach selected clips, timeline ranges, images, or reference videos to a request.
CraftAI can inspect source and composed frames, analyse speech, and use the
current timeline instead of guessing what is in the project.

For larger edits, it can propose a plan for approval, identify highlights,
remove confirmed fillers and retakes, arrange scenes, add captions, and critique
the result. Motion tools include continuous keyframes and paths, with checks for
abrupt stops, jerks, and rotation changes.

Tool activity shows what is running and what changed. A spotlight identifies the
clips or ranges being edited, and a short trail marks completed changes. Agent
edits are grouped for Undo, and completion checks report unresolved operations
and visual issues. Frame inspection samples still images; it does not watch
continuous playback or listen to audio.

### Create motion graphics you can keep editing

Ask for an original animated chart, counter, callout, lower third, diagram, or
photo card. Graphics become transparent overlays on the timeline, with editable
fields in the Graphic inspector.

Change text, colours, numbers, data, duration, or library pictures and see valid
changes preview live. Full-quality renders prepare in the background, and export
waits for the current render. The component source stays with the project so a
graphic can be redrawn later.

### Generate scenes and narration

- **Codex image generation.** Create scene images using the native agent's image
  capability, reuse character references, and generate independent scenes in
  parallel. Imported images remain ordinary editable project media.
- **Canvas-aware placement.** Generated images and AI-added footage fill the
  current video format, with framing controls for an off-centre subject or an
  explicit whole-source view.
- **Speech generation.** Add narration with Gemini or another configured speech
  service. An optional VoiceStudio connector uses voices from a separately
  installed local app; it is off by default.
- **Web research.** Supported native agents can research requested topics and
  show sources in chat when Web research is enabled for that agent.

Image generation requires a compatible Codex runtime, account, and model.
Speech services use their own configuration, credentials, and usage limits.

### Keep projects and everyday editing manageable

| Area | Changes in this fork |
| --- | --- |
| Conversations | Saved chat sessions, drafts, context attachments, and tool activity per project. Chat history lives in a separate file beside the timeline document. |
| Timeline | Work on gestures, snapping, transitions, and locked layers; applied effect names appear on clips. |
| Looks | Apply a filter to the whole video through the Effects track. |
| Preview and export | Work on playback scheduling, GPU effects, render reuse, and export progress and cancellation. Covers use the composed frame; untagged SDR sources use BT.709. |
| Interface | Settings from Home, desktop navigation labels, preview volume controls, and English, French, and Spanish interfaces. |
| App maintenance | Updated Electron runtime, settings and keychain handling, and removal of the in-app updater and promotional surfaces. |

## Editing tools

The underlying editor remains central to this fork:

- Multi-track video, audio, text, overlays, and effects.
- Trimming, splitting, cropping, transforms, keyframes, masks, and chroma key.
- Transitions, filters, colour grading, curves, HSL controls, and LUTs.
- Animated text, word styling, RTL/Arabic text, captions, and SRT import.
- On-device Whisper captions, optional cloud transcription, stock media, and
  screen recording.
- Video and audio export with control over resolution, frame rate, codecs, and
  quality.

Project files and imported media stay on your computer. Online AI, stock search,
cloud transcription, and speech generation contact the services you choose to
use. The app has no in-app updater.

## Getting started

From a checkout of this fork, install dependencies and start the desktop app:

```sh
npm install
npm run dev
```

Use `npm run dev:renderer` when you only need the renderer for an existing
Electron development session.

Development startup attempts to restore missing preview photos into
`public/preview/`. They are cached locally; drawn previews are used when the
photos are unavailable offline.

To configure an assistant, open **Settings → AI assistant**, select a provider
or native agent, test the connection, and save. External agent access is a
separate opt-in under **Settings → External agents**.

Keep `<name>.clipcraft.json` and `<name>.clipcraft.chat.json` together when moving
a saved project if you want to retain its conversations. Older project files
with embedded chat are still supported. Media files must also remain accessible.

## Documentation

- [Documentation index](docs/README.md)
- [Native agents and shared editing tools](docs/agents/native-agent-tools.md)
- [Connecting external agents over MCP](docs/agents/external-mcp.md)
- [Editorial planning and transcript-driven edits](docs/agents/editorial-agent.md)
- [Timeline context, motion tools, and graphics](docs/agents/agent-editing.md)
- [Motion graphics runtime and live input editing](docs/design/motion-graphics.md)
- [VoiceStudio connector](docs/media/voicestudio.md)
- [Project files and chat history](docs/architecture/project-file.md)
- [Export behaviour](docs/architecture/export-experience.md)
- [Project structure and contributor commands](docs/architecture/project-structure.md)

For contributors, the app uses Electron, React, Vite, and FFmpeg. Renderer
features live in `src/features/`, privileged services in `electron/`, and shared
contracts and data in `shared/`. Read [AGENTS.md](AGENTS.md) before contributing.

```sh
npm run test:structure   # Check imports and folder boundaries
npm test -- --list      # List available suites
npm test -- agents      # Run agent-focused suites
```

## License and attribution

The original ClipCraft application was created by **Hamza Abika**. This
repository is an independently maintained fork built on his work, with its own
changes and development direction.

The code is distributed under the [MIT License](LICENSE). Preserve the original
copyright and license notices when using or redistributing it. Third-party
components and assets retain their own terms; see
[Third-party notices](THIRD-PARTY-NOTICES.md).

The ClipCraft name and logo remain the original author's brand and are not
covered by the MIT license grant.
