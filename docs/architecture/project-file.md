# The project file and its chat sidecar

A project is saved as two files next to each other:

| File | Holds | Written when |
|---|---|---|
| `<name>.clipcraft.json` | the document: name, format, media list, every track and clip, markers, layer state, export settings | the timeline or settings change |
| `<name>.clipcraft.chat.json` | the CraftAI conversations (`project.craftAI`): sessions, messages, tool activity and the saved model context | the chat changes |

The per-project autosave slots under `<userData>/autosave/` follow the same split:
`<id>.json` is the document and `chat/<id>.json` its chat. The recovery snapshot at
`<userData>/project-recovery.json` holds the document only; the slot carries the
chat. The renderer mirrors recovery in localStorage and prefers the atomic native
copy at startup (falling back to legacy localStorage only when the native file is
absent). [Adopted-media retention](../design/plugin-media-retention.md) guards
project/slot/recovery writes before publication so source cleanup cannot remove
a file that a persisted snapshot still references.

## Why

Measured on real projects, the chat log is 83 to 94 percent of a saved project and it changes on
every agent step, while the document is tens of kilobytes. Kept in one file, every autosave rewrote
megabytes of history to record a small timeline edit, and anything that opened the file directly
(an outside agent with its own file tools, a text editor, a diff) waded through the chat first.
Apart, a chat change writes only the sidecar, a timeline edit writes only the document, and the
document stays the small readable thing it should be. Motion graphics stay in the document: their
source is a few kilobytes each and is what lets them redraw themselves on another machine.

## How it behaves

- **Change detection** (`src/state/projectFile.js`): `sameDoc` compares every top-level field but
  `craftAI` by identity, which the reducers keep for untouched fields, so it is exact and costs
  nothing. App's autosave effect takes the document path, the chat path, or both.
- **Writes** go through the one persistence worker (`electron/project/persistence.cjs`), each
  file atomically (temp file and rename), the chat before its document. `project:autosave` takes
  the document, the chat, or both; `project:save` and the agent's `project:saveAgent` always write
  both so a Save or Save as never leaves a stale sidecar; a project with no conversations removes
  the sidecar. `App` remembers the chat last written to the file and to the slot (`fileChat`,
  `slotChat`), so a document write carries the chat only when it is stale.
- **Reads** (`electron/project/sidecar.cjs`, `autosave.cjs` `readSlot`) merge the sidecar into
  `craftAI`. The sidecar wins over a chat still embedded in the document. A sidecar that is not
  JSON is moved aside as `<name>.clipcraft.chat.json.bad` (never deleted) and the project opens
  with the document's own chat, if any. A sidecar another program holds (a sync client, a scanner)
  is retried, then the open fails with a message: opening with an empty chat would let the next
  save replace the real one.
- **Older files** that embed `craftAI` open unchanged. A load counts as a change of both parts, so
  the first write after opening such a file moves the chat into its sidecar and the document is
  saved without it.
- **Moving a project**: keep the two files together. A document without its sidecar opens with an
  empty chat; the timeline is complete.
- **Slot hygiene**: deleting a slot or evicting it past the cap removes its chat file too; the
  index rebuild ignores the `chat/` folder.

## Safety

- Neither file can be torn: every write goes to a temp name and is renamed into place. The chat is
  written first: the first save of an older file strips the chat it embeds from the document, so a
  crash between the two writes leaves the chat in its sidecar and the document one step behind,
  never a chat that exists nowhere.
- Writes to one project never interleave: one promise chain in the renderer, one ordered worker
  in the main process, the chat before its document.
- Change detection is conservative (`classifyChange`): only a change that swaps the chat and
  leaves every other field identical skips the document. A fresh project object with no differing
  field, which only an in-place mutation could produce, still writes the document as the
  single-file autosave did.
- Downgrade and back: an older ClipCraft saves the chat inside the document. An embedded chat
  with content in a document (or slot) newer than its sidecar wins on open, so nothing written by
  the older version is lost; the next save moves it into the sidecar again. The older app writes
  `craftAI` even when its chat is empty, so an empty embedded chat never outranks the sidecar.
- A sidecar that fails to parse is ignored, and whatever loads passes the chat normalizer, so a
  bad sidecar cannot poison the project.
- Picking the `.chat.json` in the Open dialog opens its document.

## Tests

- `tests/unit/editor/test-project-file.mjs`: the split, change detection, merge rules, sidecar
  path, atomic write and removal.
- `tests/unit/editor/test-autosave.cjs`: the chat beside a slot (write, keep, replace, remove,
  legacy, delete, eviction, index rebuild).
- `tests/smoke/smoke-chat-sessions.cjs` (`FVE_SMOKE_MODE=chat-sessions`, two stages): in the
  real app, Save writes the document without a chat and the sidecar with it, a chat-only change
  leaves the document's bytes untouched, reopening restores the draft, and closing flushes the
  latest chat to both the file and the slot.
