# Audio and narration

Keep sound attached to picture while assembling shots. Move it to an audio layer when you need to trim it independently, overlap dialogue across a cut or mix it with music.

## Separate a clip’s sound

Right-click an unmuted video clip that contains audio. Choose how the sound should behave after separation.

| Command | What the editor creates | When to use it |
| --- | --- | --- |
| **Extract audio** | An independent clip referencing the same media, with the original timing, speed and mix. The picture is muted. | Let dialogue continue under the next shot, or move a sound independently of its picture. |
| **Detach audio** | A separate audio file and a linked picture/audio pair. The picture is muted and the detached clip carries its mix settings. | Keep the sound in sync while trimming or moving the picture, with a separate file available for audio work. |

Play the join and solo the audio layer to check you have one copy of the signal. To move one member of a linked pair independently, unlink it first. [Timeline editing](timeline.md#layers-and-linked-sound)

## Shape the mix

| Control | Use it to |
| --- | --- |
| Clip volume and volume keyframes | Set the overall level, lower music under a line or bring it back between phrases. |
| Fade in and fade out | Smooth the start and end of an individual clip. Recheck the fade after shortening the clip. |
| EQ | Change the low, mid and high bands of a source. |
| Compression, noise reduction and loudness normalization | Control peaks, reduce background noise or balance uneven source levels. Audition the result against the unprocessed clip. |
| Track mute and solo | Isolate a problem before changing any clip settings. |
| Player volume | Adjust listening level. To change the delivered mix, adjust clip and track settings. |

## Add narration

Record a voiceover with a microphone, import a recorded take or open **Audio → Text to speech**. Choose a configured engine and voice, enter the narration and generate the audio. Play the resulting clip against picture and adjust its placement and level.

A separately installed VoiceStudio service can supply local voices through its extension. Install and trust the extension, enable the engine in Voice settings and test its address before generating narration. [VoiceStudio setup](../media/voicestudio.md)

## Deliver sound on its own

Use the arrow beside **Export** and choose **MP3**, **WAV** or **M4A**. Play a section with dialogue and music together before exporting. If a source is missing, restore access to the file and retry. [Export and delivery](export.md)
