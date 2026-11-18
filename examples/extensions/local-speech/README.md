# Local speech transcript

This general Node extension manages its own executable selection, pinned model
cache, transcription and reviewed SRT output. It defines ordinary commands and
native settings, with no speech-provider declaration. Build and install it using
the repository's SDK CLI.

1. Run **Choose local speech executable**, select a separately installed compatible
   `whisper-cli`, and review its canonical path and SHA-256. A managed help probe
   checks compatibility. The extension never installs an executable for you.
2. Select a pinned model in Plugins settings. **Import selected speech model**
   checks a chosen local file; **Download selected speech model** asks for review
   before fetching the selected pin from approved Hugging Face HTTPS hosts.
   Neither activation nor installation downloads anything.
3. Set language, start and duration (up to 120 seconds). Run **Transcribe picked
   audio**, choose local audio/video and review the run. Bundled FFmpeg captures
   mono 16 kHz PCM audio and the selected CLI runs on this computer.
4. Review the transcript preview and choose **Save SRT** or **Discard**. Choose a
   new `.srt` filename. The saved cues are relative to the chosen audio range.
   The open project and its Undo history are unchanged.

The native job in this extension's Settings details shows progress and Cancel.
Model downloads/imports have a thirty-minute job budget; transcription has ten
minutes. Downloads have a thirty-second stall limit and at most five approved
redirects. Model size and SHA-256 must match the catalog in `src/models.ts`, copied
from the app's existing local transcription catalog. Output is bounded to 2 MiB,
1000 cues and 64000 characters. No audio or transcript is uploaded.

Tool/model identities are checked before execution and monitored during it.
These checks detect changes; they are not an OS executable sandbox. Node trust
already grants this extension access to files, programs and the network.

Only this extension's cache is removed by **Remove selected speech model** after
review. The app's core models and old plugin-local cache remain untouched. You can
explicitly import an existing matching model. The status command's `present`
means matching file size; transcription still rechecks the full checksum.

The historical ID/version is retained. The host keeps its immutable old payload
beside this Node replacement and requires fresh trust. No model or executable
binary is bundled. Native verification uses a tiny test-only model pin and
fixture CLI with real FFmpeg; real inference and Windows/Linux remain release checks.
