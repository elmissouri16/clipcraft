# Piper voices on Windows, Linux and macOS

Piper voices are free, offline text-to-speech voices. In ClipCraft they are **optional downloads**,
managed in **Settings > Voice > Piper voices on this computer**: download the voice engine first,
then the voices you want. Each one can be removed again. One download runs at a time, with
progress and Cancel. Nothing downloads while speaking: Audio > Text to speech and CraftAI only
use what is downloaded, and point to Settings otherwise.

## One runtime per platform

| Platform | Engine | Voices |
|---|---|---|
| Windows x64 (and Arm, emulated) | Piper 2023.11.14-2, `piper_windows_amd64.zip` | `rhasspy/piper-voices` (`.onnx` + `.json`, about 63 MB each) |
| Linux x64 / arm64 | Piper 2023.11.14-2, `piper_linux_x86_64.tar.gz` / `piper_linux_aarch64.tar.gz` | same as Windows |
| macOS arm64 / x64 | sherpa-onnx 1.13.8, `osx-arm64-shared` / `osx-x64-shared` | the same voices as packaged by sherpa-onnx (`tts-models` release, about 67 MB each) |

- **Why not Piper on macOS:** Piper's macOS archives do not run. The arm64 archive contains an
  x86_64 binary, and both lack the libraries it links (espeak-ng, piper-phonemize, onnxruntime).
  The project is archived, so no fixed build is coming.
- **Why sherpa-onnx 1.13.8:** sherpa-onnx runs Piper's VITS voices with the same espeak-ng
  phonemizer built in. From 2.0 it no longer ships espeak-ng, so 2.x cannot speak these voices
  on its own.
- Only the TTS program and its libraries are kept from the sherpa-onnx archive: about 34 MB on
  disk instead of 64 MB.
- Windows keeps the layout it always had (`<userData>/tts/piper`, `<userData>/tts/voices`), so
  existing downloads stay valid.

## Safety and licences

- Every engine archive is checked against a pinned SHA-256 before it is unpacked or run
  (`RUNTIMES` in `electron/audio/tts.cjs`). A mismatch keeps nothing.
- Engines and voices are downloaded at the user's request, never bundled. Piper is MIT and
  sherpa-onnx Apache-2.0; both include espeak-ng (GPL-3.0) in the downloaded programs. Voice
  licences are listed per voice (CC0, public domain, CC BY 4.0; Arabic: not stated).

## Code and tests

- `electron/audio/tts.cjs`: `piperRuntime`, `piperStatus`, `piperDownload`, `piperRemove`,
  `piperSpeak`.
- `electron/main.cjs`: `tts:piperDownload`, `tts:piperCancel`, `tts:piperRemove`.
- `tests/unit/audio/test-tts.cjs`: the platform table, the checksum refusal and the missing-download
  errors offline; then a real download, speech and removal on this platform (unless `--offline`).
- `tests/unit/audio/test-piper-ui.cjs` (`FVE_SMOKE_MODE=tts`): the real app, downloading through
  Settings, Cancel, speaking onto the timeline, removal. Needs the network (about 90 MB).
- Verified on macOS arm64, macOS x64 (Rosetta), and Linux arm64 and x64 (Docker, Debian
  bookworm). Windows uses the unchanged Piper path and was not run here.
