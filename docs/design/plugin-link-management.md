# Explicit link management and pair movement

SDK 0.8.0 keeps API 1 and adds command permission `clips.links`, requiring
`editor.read`. It can combine with existing bounded clip-edit grants, but never
with marker/caption writes, AI or exports. The existing `clips.linked` grant
authorizes aligned and shifted split/trim with picture-relative public times.

```ts
{type: 'link', clipId, partnerClipId}
{type: 'unlink', clipId, partnerClipId}
{type: 'move-linked', clipId, partnerClipId, start_sec,
 gaps: 'preserve-time', transitions: 'reject'}
```

Both returned opaque handles explicitly identify a main/overlay picture and audio
clip. Either handle can initiate; `start_sec` always means the picture start.
Link requires two unlinked clips with equal positive speed and equal duration.
The host allocates the link ID and captures existing timeline/source offsets.
Nonzero timeline offsets are supported and preserved by movement. Unlink removes
only this complete pair's link metadata, retaining timing, source windows, fades,
animations and media. No raw IDs, source offsets or paths enter the public SDK.

Move translates both starts while preserving source windows and stored offsets.
Overlay movement stays on the original layers and cannot collide with other clips.
Main movement replaces the old picture with a gap and inserts it into explicit
empty main time (including contiguous gaps or its vacated interval). Main duration,
other picture times, free clips and markers remain fixed. Incoming/outgoing source
transitions and destination transition boundaries reject movement. Both members
must remain inside the original project duration; there is no implicit extension,
ripple, overwrite, transition clearing, linked reorder or layer reassignment.

Link, move and unlink may run in order on the same two original handles. Newly
allocated groups become publicly visible on the next editor read. Ordinary
free writes cannot share managed members in the same transaction. Split/trim
continues to require its separate permission and complete-pair timing/source rules.

Host planning checks complete membership across the whole document, both locks,
source bounds, timing/offset consistency, motion-pin dependencies, collisions,
unique host IDs and the shared 64-operation/affected-clip budget. Consumed gaps
also count as affected clips. No-op movement creates no history entry. Native
per-run approval, single-use commit authorization, package revocation, stale
document/owner guards, immutable receipts and one-step Undo cover all operations.
Settings, registered menus, panels and CraftAI share the existing command path.

Verification must include SDK-generated packages in hidden real Electron,
native consent labels/refusal, ordered edits, main/overlay pairs, shifted audio,
Undo/Redo, permissions, locks, stale edits, Stop, package revocation and
preview/export picture and audio parity. Other platforms and packaged runtime
must be reported separately. No installer or SDK publication is included.

Sequence reordering uses the separate [linked reorder operation](plugin-linked-reorder.md)
with both `timeline.reorder` and `clips.links`, and explicit companion pairs.
The `move-linked` placement rules above remain unchanged.
