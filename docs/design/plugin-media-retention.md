# Adopted media retention and startup cleanup

Host-generated extension media now has an ownership journal. New copies under
`extension-media/owned` are recorded before their path can be offered to the
editor. Untracked files from earlier versions remain untouched.

## Lifetime and collection

All newly adopted media stays available for its whole creating application
session, including after Undo, extension Stop/removal, failed insertion or an
uncertain callback acknowledgement. This protects history, clipboard, previews,
render work and late responses without trying to infer ownership from only the
currently visible timeline. The collector runs once at application startup,
before extension activation or persistence writes.

At startup it removes an earlier session's tracked file only when its original
file identity still matches and it has no durable pin or snapshot reference.
There is no active-session deletion API. Modified files, symlinks, malformed
ownership records and unknown files are preserved. An unreadable reference
journal or recovery/slot file stops collection before source deletion.

Saving a project through the application's native save/autosave-to-file paths
pins the source permanently. These are durable media files: deleting or moving
a project, removing a recent-project card, or disconnecting a drive cannot prove
that no copied project still uses them. Automatic cleanup therefore does not
reclaim sources that have been saved in a project file. Source files created
outside the host's managed adoption path are not candidates either.

## Recovery and autosaves

Each autosave slot and the latest recovery snapshot has its own replaceable
reference set. The old and proposed references are recorded together before IO.
Only a confirmed successful write replaces the set. Failed writes and lost
acknowledgements retain the conservative union; unchanged sets do not rewrite
the journal. Deleting a slot releases its set after the slot is confirmed absent.

Recovery now has an atomically written native copy at
`<userData>/project-recovery.json`. The renderer mirrors it in localStorage and
prefers the native copy on startup; localStorage is a fallback only when no
native file exists. A corrupt native copy does not cause restoration from a
possibly stale mirror. This prevents delayed Chromium storage flushing from
restoring an older snapshot whose references were already released.

The collector also reads the actual native recovery file and every autosave
slot, independently of the reference journals. Losing a journal therefore does
not make a still-saved snapshot's sources collectible. Files abandoned after
recovery replacement or slot deletion become collectible on a later app launch.

The old sources saved before tracking began cannot be retrospectively proven
unused; they are preserved. No filesystem-wide project search is performed.

## Implementation and verification

`electron/plugins/extensionMediaRetention.cjs` owns the serialized journal,
persistence guards, bounded reads and startup collector. Projects without a
tracked-source directory skip recovery/slot scanning. `extensionMedia.cjs`
records each newly adopted copy. Native project save, slot persistence and
recovery writes enter the guard before publishing disk state.

`test-extension-media-retention` covers current-session retention, restart
collection, permanent pins, failed-write unions, snapshot replacement/deletion,
missing journals, escaped JSON paths, modified/legacy/symlink sources and corrupt
records. The existing media Electron workflow now uses three real app launches:
Undo retains sources; a real project save pins its source; abandoned files are
collected; autosave-only and recovery-only sources survive; and discarding those
snapshots makes their sources collectible on the following launch. Saved audio
continues to decode after extension removal and every restart.

Exact selected-suite results and native receipts are under
`plugin-validation.json.extensionMediaRetention`. These local macOS checks do
not claim a full application battery or installed cross-platform certification.

Final selected verification passed 16 suites with no failures, including
13 ownership contract checks and 36 native media checks over 3 app launches.
Renderer compilation, structure/runtime dependency and whitespace checks passed.
