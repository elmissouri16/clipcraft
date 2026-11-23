# VoiceStudio in ClipCraft

The optional VoiceStudio extension connects a separately running VoiceStudio
service to the editor. After setup, its voices appear in the default voice
selector, Text to speech and CraftAI. Voice models and profiles are managed in
the VoiceStudio app. The default service address is `http://127.0.0.1:3900`.

1. Install and start VoiceStudio separately. Check the address of its speech service.
2. Build the extension from this checkout using the commands in the
   [VoiceStudio extension README](../../examples/extensions/voicestudio/README.md).
3. In **Settings → Plugins**, install the compiled folder or archive, inspect the
   package and choose **Trust & activate**. This grants the extension Node access.
4. In **Settings → Voice**, enable VoiceStudio, enter the service address and test
   the connection. Choose a voice in Text to speech to generate narration.

CraftAI can list voices, add a voiceover, clone a reference voice and edit a saved
profile's reference transcript. For cloning, supply a timeline clip, library
item or external audio file and the exact words spoken in that reference. The
extension can use the resulting voice to add new narration at a chosen time.
Undo removes the timeline edit. The saved voice profile remains in VoiceStudio.
Check the voice and model licenses and obtain the speaker's consent before cloning.

The extension README documents command arguments, audio formats, source windows,
service requirements and connection troubleshooting. Its source is also a
working example of registering an ordinary service at `voice.engines`.
[VoiceStudio extension and source](../../examples/extensions/voicestudio)
