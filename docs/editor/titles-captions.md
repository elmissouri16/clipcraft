# Titles and captions

Use a title for text you place and time yourself. Use captions for a sequence of cues aligned to speech. Both can be styled and animated in the editor.

## Add and style a title

Open **Text**, choose a style and add it at the playhead. Select the text clip, edit its words in the inspector and drag its edges to set its duration. Adjust font, size, line height, letter spacing and width while looking at the project’s final aspect ratio.

Use a stroke, shadow or background when the text crosses a busy shot. Check both light and dark frames. Choose an entrance, exit or word animation, then play the full title to see whether it can still be read before it disappears. [Caption animation sample](../media/sample-caption-animation.mp4)

## Generate captions from speech

1. Open **Captions** and choose a transcription engine and language. Local Whisper needs its model available on the machine. A cloud engine needs its configured service connection.
2. Choose **Generate captions**. Review the timed cues on the text track. Play through a phrase to check both the spelling and where the words change.
3. Select a cue to correct it. Choose a caption style and apply it to the intended set. **Regenerate** is useful after changing the source speech. Save reviewed work before replacing a generated set.

If no cues appear, play the source and check that it contains audible speech. Then check the engine, model and language before repeating transcription.

## Import an SRT file

Use **Captions → Import SRT file** to bring in existing cue text and time ranges. Check the first and last cue against the audio, particularly when the subtitle file came from a longer source or an earlier cut. SRT cue timing does not provide individual word timings.

The editor can display RTL and Arabic text and use bundled, installed or imported fonts. When moving a project, make the same chosen fonts or font packs available on the destination machine. [Font loading and export](../media/fonts.md)

## Translate or restyle

The optional caption translation extension reads a source track and lets you review the original and translation before making a separate caption track. Check which track is visible before exporting. [Caption translation example](../../examples/extensions/caption-translation/README.md)
