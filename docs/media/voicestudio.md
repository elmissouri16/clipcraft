# VoiceStudio as a local voice engine

[VoiceStudio](https://github.com/debpalash/VoiceStudio) is a free, open-source voice app (AGPL-3.0) that
runs on the user's computer: text to speech with several engines, voice cloning from a short clip, many
languages. ClipCraft does not bundle, download or start it. The user installs VoiceStudio themselves, and
ClipCraft talks to the OpenAI-style speech API it serves on a local address, through an **optional
connector** in **Settings > Voice > VoiceStudio on this computer**.

## The connector

- **Off by default.** With the switch off, ClipCraft never contacts the address. Audio > Text to speech
  shows a "VoiceStudio is off" card pointing to Settings, and CraftAI's `list_voices` says the connector is
  off.
- **Address.** `127.0.0.1:3900` unless changed (VoiceStudio's default, `OMNIVOICE_PORT`). `host:port`,
  with or without `http://`, a trailing slash or `/v1`, is accepted. The loopback address needs no key;
  ClipCraft sends none.
- **Test connection** tries the address typed in the field without saving it. The address itself is saved
  on blur or Enter.
- **Status** comes from VoiceStudio each time `tts:status` runs: version, the active engine (chosen in
  VoiceStudio, shown for information) and the voices it lists.

## What ClipCraft asks VoiceStudio (`electron/audio/tts.cjs`)

| Request | Why |
|---|---|
| `GET /.well-known/voicestudio-speech` | Is this VoiceStudio? Its `service` must be `VoiceStudio`; `service_version` is shown. 4 s limit. |
| `GET /v1/audio/voices` | The voices. Profiles and presets keep their id and name; the OpenAI alias names VoiceStudio accepts collapse into one **Default voice** (the active engine's own voice), listed first so a VoiceStudio with no profile still speaks. A 404 means a VoiceStudio too old for the speech API. Each entry ClipCraft offers carries `wire` (the voice id sent) and `engine` ('' for the active engine), so one Voice list is the whole choice. |
| `GET /engines/tts` and `GET /models` | The engines, best effort: the active one (named next to "Default voice") and the voice-design ones (an installed model labelled "voice design", such as Qwen3-TTS VoiceDesign), which become one **Describe a voice** entry each in the voice list. Without these two calls the list still has the default voice and the profiles. |
| `POST /v1/audio/speech` | `{ model: 'tts-1', input, voice, response_format: 'wav', speed, instruct? }`. `tts-1` means VoiceStudio's active engine. WAV at the engine's rate (24 kHz mono with OmniVoice). No time limit: the first request after VoiceStudio starts loads its model and can take minutes; cancellation comes from the request's signal. |

Rules that matter:

- **The voice must be one VoiceStudio listed.** VoiceStudio speaks with its default voice for an id it does
  not know instead of refusing, so `tts:speak` re-reads the list and refuses unknown ids first (and CraftAI's
  `add_voiceover` refuses before calling).
- **4096 characters per request** (VoiceStudio's limit). Longer text is refused with that number.
- **Speed** 0.5 to 2 (VoiceStudio accepts 0.25 to 4). `style` goes to `instruct`; what it takes depends on the
  engine. OmniVoice (the default) accepts voice-design tags only (gender, age, pitch, English accent, whisper)
  and refuses emotion words. Qwen3-TTS VoiceDesign (through MLX-Audio on Apple Silicon) takes a free-text
  description including emotion and pace, and requires one unless the voice is a designed profile. IndexTTS 2.5
  reports emotion support. The panel shows the matching hint under the Engine select.
- **Engine per voice entry.** A "Describe a voice" entry sends `model: <engine id>` with the default voice alias
  and the style text as `instruct`; VoiceStudio speaks with that engine without changing its own active engine
  (verified on 0.5.5). Such an entry refuses to speak without a style, in the panel and in `add_voiceover`, and
  is not offered as the default voice in Settings. Every other entry speaks through the active engine.
- Output is cached per address, voice, speed, style and text in `<userData>/voiceovers`, like the other
  engines. The media item's credit is `{ license: 'voicestudio', providerName: 'VoiceStudio', creator:
  <voice name> }`.

## Default voice and CraftAI

`src/features/audio/voiceDefault.js` treats VoiceStudio as usable when the connector is on, the app answers
and lists at least one voice. The automatic order is Gemini, then VoiceStudio, then ElevenLabs. CraftAI
names the engine `voicestudio` in `add_voiceover`; `list_voices` returns `{ engine, voices }` when it can
speak (`active_engine` and `voices[]`, where a design entry says `style_required` and the default voice on
OmniVoice says what style tags it takes) and a sentence saying why not otherwise (off, not running, no voice).
`add_narration` stays Gemini only.

## Licences and consent

The app is AGPL-3.0; ClipCraft (MIT) only talks to it over HTTP as a separately installed program and
ships none of its code. VoiceStudio's models and voices carry their own licences, shown in its Model
Manager, and a cloned voice needs its speaker's consent. ClipCraft cannot check either, so Settings says so
next to the connector.

## Tests

- `tests/unit/audio/test-tts.cjs`: the connector against a stand-in shaped like VoiceStudio 0.5.5
  (discovery, voices, engine, speech, its errors, cancellation); `--real` also speaks through the
  VoiceStudio running on this computer, if any.
- `tests/unit/audio/test-voicestudio-ui.cjs` (`FVE_SMOKE_MODE=tts`,
  `tests/smoke/smoke-voicestudio-settings.cjs`): the real app against a stand-in served by the test: the
  panel while the connector is off, turning it on and testing the address, VoiceStudio as the default voice,
  speaking onto the timeline with its credit, and the app stopping. No install or network needed.
- `tests/unit/agents/test-agent-tools.mjs`: `list_voices`, `add_voiceover` and `add_narration` with the
  connector off, the app closed, and running.

## History

Until November 2026 ClipCraft downloaded Piper voices (and sherpa-onnx on macOS) into `<userData>/tts`.
That engine is gone; the folder, if present from an older install, is no longer read and can be deleted.
Media items whose credit says `piper` still show as speech in the library.
