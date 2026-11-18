# Trusted extension project inspection

Node extensions can inspect the complete document without relying on the bounded
256-clip editor summary. The APIs below belong to the general extension context;
they do not add a new extension type or change app, SDK or host API versions.

## Pages and consistency

`context.workspace.inspect({section, cursor?, limit?, documentId?,
projectRevision?, lane?, trackId?, ids?})` returns:

```ts
{ documentId, projectRevision, section, total, next, items }
```

Start without a cursor or with cursor zero. Follow `next` until it is null, passing
the returned `documentId` and `projectRevision` on every continuation. A nonzero
cursor without that anchor rejects. Edits to document content, settings, tracks,
media or markers invalidate the anchor. Reopening/switching the document also
invalidates it. Playback, selection and chat-only changes leave document pages
valid. This `projectRevision` is distinct from the edit snapshot's `revision`.

Each page contains at most 200 records (default 100). Order is the host document's
order within each lane, not an ordering by time. Filtering applies before paging.
`lane` filters clips or tracks; `trackId` filters clips; `ids` filters clips, media
or markers by at most 200 distinct public handles. Unknown handles return no
matching records. Malformed handles, scopes, filters and cursors reject.

For cross-surface references, clip and media pages also accept `sourceIds`: up to
200 distinct saved clip/media IDs, each at most 1024 characters. These are the IDs
CraftAI receives from `get_project`; the lookup returns ordinary document-scoped
inspection handles and properties. It does not expose saved identity fields or
change edit targets. Use either `ids` or `sourceIds`, not both. Unknown saved IDs
return no matches, and the normal revision anchor still rejects stale reads.

| Section | Records |
| --- | --- |
| `project` | One document record with a reference to its properties |
| `tracks` | Every supported lane/layer, public track ID, lane, layer, name and lock/visibility/mute/solo state |
| `clips` | Every valid timeline clip, public ID, track/lane, start/end seconds, gap, public media ID, main-sequence index/overlap, link group/partner, and properties reference |
| `media` | Every media item with a public ID and properties reference |
| `markers` | Every marker with a public ID, time, label and properties reference |

Public clip handles are shared with `editor.read` and `editor.apply`. Media and
marker handles are document scoped too. Root document IDs and the clip/media/link
identity fields are replaced with public relations. Project properties include
all remaining document fields except chat and the collections listed separately.
Clip properties include text, typography, transforms, curves, effects, source
windows and other saved fields, except the remapped identity/relation fields.
Media properties include source paths, probe metadata, credits and saved graphics
or other render data. This is read-only saved-format data; it does not authorize
raw reducer actions. Arbitrary nested strings remain data, including strings in
custom properties that happen to resemble internal identifiers. The retired
sticker collection is not a live timeline lane.

## Nested values and large data

Properties arrive as `{ref, type, size}` instead of a potentially unbounded JSON
object. Values that fit inline are strings up to 2048 UTF-16 code units, finite
numbers, booleans and null. Objects, arrays and larger strings use references.
Read them with:

```ts
await context.workspace.readValue({
  documentId, projectRevision, ref, path?, cursor?, limit?
});
```

The returned discriminated union has the same consistency anchor:

| `kind` | Value |
| --- | --- |
| `object` | `entries: [{key, value}], total, next` |
| `array` | `items: [value], total, next` |
| `string` | `text, total, next` |
| `scalar` | `value` |

Object/array pages contain at most 200 entries (default 100). String pages contain
at most 65,536 UTF-16 code units (default 16,384). Concatenate string chunks before
processing Unicode code points; a chunk boundary can separate a surrogate pair.
Large object keys also arrive as string references, so long custom property names
can be read completely. Sparse/undefined array entries become null, matching
saved JSON. Unsupported non-JSON objects reject instead of being silently omitted.

`path` is an optional convenience for following own properties or array indices:
at most 64 segments, with string segments at most 512 code units. A missing or
inherited property rejects. Use the returned nested value reference when a key
exceeds the path limit. References are opaque, are never reused within the document,
and expire on document change. At most 100,000 references exist in one document
revision; exceeding that resource budget rejects explicitly. All record/value
reads are paged; no large nested value is automatically expanded across IPC.

## Editing a clip discovered on a later page

Request a fresh edit snapshot for specific public handles. At most 128 unique
handles may be requested; the result retains the ordinary 256-clip/128-track edit
limits and rejects if those targets cannot fit. Linked partners receive priority.
It preserves the actual selection and shares the base edit revision, so inspecting
another context does not itself make a transaction stale.

```ts
const page = await context.workspace.inspect({section: 'clips', lane: 'text'});
// Follow page.next with its document anchor to discover later records.
const clip = page.items[0];
if (clip) {
  const snapshot = await context.editor.read({clipIds: [clip.id]});
  await context.editor.apply({
    documentId: snapshot.documentId,
    revision: snapshot.revision,
    operations: [{
      type: 'set-text', clipId: clip.id, partnerClipId: null,
      text: 'Updated caption', measuredWords: 'invalidate'
    }]
  });
}
```

The host rebuilds the bounded validation context from the transaction's explicit
public targets. It does not depend on whichever extension command last requested
a focused read. Operation/declaration budgets, canonical validation, real private
pair membership, stale-state checks, busy/lock checks and Undo still apply.
Content-only document edits now also advance the editor revision, preventing an
old text/property edit from overwriting a newer one unnoticed.
