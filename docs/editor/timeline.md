# Timeline editing

The main picture follows a sequence. Overlays, audio, titles and effects have their own positions in timeline time. Choose the track according to what should happen when you move or shorten the underlying shot.

## Arrange and trim

Drag a clip body to move it and an edge to trim it. Select a clip and press **S** at an interior playhead position to split it. On the selected clip, **Q** removes the part left of the playhead and **W** the part right of it. The **B** key selects the razor and **V** returns to the selection tool.

For a precise cut, pause playback and use the arrow keys to step one frame at a time. A marker placed with **M** records a timeline position you can return to while adjusting neighboring cuts.

## Choose what moves with a cut

| Operation | Result |
| --- | --- |
| Split | Creates two editable pieces at the playhead and keeps the source file intact. |
| Close a main-track gap | Removes the selected gap and brings the following main footage forward. Right-click a gap for **Close gap**. |
| Ripple a range | Removes time and shifts the affected material. Review linked sound and independently timed overlays after the cut. |
| Copy a selection | Copies the selected clips and their media references. Pasting within another project can reuse the source without making another copy of the file. |
| Duplicate | Makes another editable instance. Right-click a clip for **Duplicate**, or use **⌘D** or **Ctrl+D**. |

## Layers and linked sound

Move a clip to another layer when two items need to occupy the same moment. The context menu offers **Move to layer** for layered tracks. A destination can be unavailable if it is locked or another clip occupies that interval. Lock a completed track to protect its edits. Use visibility for picture and mute or solo to audition sound.

Link the picture and its audio partner before editing them as a pair. Copying a linked selection preserves its relationship. Use separate audio when the sound should lead across a cut or continue under a different shot. [Audio and narration](audio.md)

## Freeze, reverse and retime

Use **Speed / Duration** on a picture or audio clip for a constant speed change. Freeze a frame to hold the visible moment, including its crop and sampled motion. Reverse uses a processed media version. Keep the original available to restore forward playback, especially after trimming a reversed clip.

Custom tracks can contain visual, audio or metadata clips defined by a package. Their inspector exposes the fields the author declared. A missing definition can prevent rendering while still preserving the saved clip data. [Custom track and clip types](../design/plugin-custom-timeline.md)

## Keyboard reference

**Space** plays or pauses. **← / →** step by a frame, **Shift + ← / →** by a second, **Home** goes to the start and **F** opens the full-screen player. Keyboard bindings can be changed in **Settings → Shortcuts**.
