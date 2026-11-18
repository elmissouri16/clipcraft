# Picked media and reviewed destination jobs

> Historical executable recipe design. Its runtime/SDK declarations are retired.
> Use the [general Node host](plugin-extension-host.md) and
> [migration rules](plugin-legacy-retirement.md). Creative pack and private edit
> validation contracts remain where referenced by the current host.


This pre-v1 contract keeps SDK 0.8.0, manifest/host API 1 and app 2.0.0.
Commands can stage one user-picked import or fixed processing job, or request a
reviewed upload of their own host-verified GIF. They receive no filesystem,
encoder, shell, arbitrary network, credential or source-byte API.

## Media jobs

`media.import` authorizes one picked source and one verified project-library item.
`media.process` additionally requires `media.import`. These permissions may be
combined with `project.read`, and cannot be combined with timeline writes, AI,
caption or export permissions. The initial contract deliberately adds to the
library; it does not insert clips or mutate existing media. Existing clip/resource
editing permissions retain their own contracts.

```ts
await context.media.import({kind: 'image'}); // also 'video' or 'audio'
await context.media.process({operation: 'resize-image', max_size: 640});
await context.media.process({operation: 'extract-audio', start_sec: 0, duration_sec: 4});
await context.media.process({operation: 'trim-video', start_sec: 1, duration_sec: 3});
```

Each example is a separate run; staging a second job fails the entire command.
Calls return `{staged: true}`. No picker, processing or project mutation starts
until the worker completes successfully. Failure after staging discards the job.
Run once consent precedes worker execution, then the host opens a native source
picker. Cancel, project/load changes, Stop or package revocation before adoption
leave the project unchanged. No source path or filename comes from plugin input.

The host accepts one regular source of at most 512 MiB from a fixed extension
allowlist. It resolves the chosen file, captures an owned copy, checks the source
fingerprint before/after capture, probes the captured container and rejects
unsupported types, excessive streams, dimensions over 8192 or duration over one
day. Images are PNG/JPEG/WebP/BMP; supported video containers are MOV/MP4,
Matroska/WebM and AVI; supported audio containers include WAV, MP3, AAC/M4A,
Ogg, FLAC and AIFF. File extension and actual media kind must agree with the job.
GIF import, playlists, remote sources and custom decoders are outside this contract.

- `import` preserves the picked file's bytes in managed storage.
- `resize-image` writes PNG with the longest edge capped at 320, 640 or 1280 px,
  preserves aspect ratio and does not enlarge a smaller source.
- `extract-audio` writes stereo 48 kHz PCM WAV from an audio-bearing source.
- `trim-video` writes H.264/AAC MP4 at 30 fps, bounded to a 720 px longest edge.

Source ranges are explicit, inside the captured source and 0.1–60 seconds long.
Processing uses fixed host arguments, two encoder threads, local file/pipe
protocols, disabled MOV external references, a two-minute processing deadline and
a 512 MiB output limit. The host probes every result and fully decodes processed
outputs before reporting success. It never overwrites or processes the original.
Unsupported formats or encoder failures return failure rather than fallback output.

The result is held behind an expiring, single-use native authorization tied to
run, package, owner window/frame and output fingerprint. The renderer obtains
only the native item, rechecks project/load/edit ownership and (for panels) final
action authorization, then commits `pluginMedia` as one guarded library-only Undo
step. Replayed IDs and stale documents cannot add media. Empty editor timelines
are supported specifically for media jobs; other commands keep their nonempty
project requirement. Settings, native actions, allowlisted panel commands and
CraftAI use the same path.

Project membership is undoable; managed source bytes remain for Redo, saved
projects and use after plugin removal. Failed unadopted jobs clean their temporary
storage. An uncertain adoption after a dispatch attempt retains the managed source
rather than risking a saved project's source. Authorized records expire from
memory; retained generated sources follow the application's managed-asset lifetime,
not an installed plugin's package/storage lifetime. This is not general asset GC.
Panel/CraftAI receipts report `media_added: 1`, not private paths or worker claims.

## Destination declarations and staging

`export.upload` requires `export.gif` and at least one declarative destination.
It cannot be combined with media imports, AI or timeline writes. Up to eight
same-package destinations have unique local IDs, plain names and canonical public
HTTPS origins on the default port. No path, query, userinfo, key or token belongs
in the declaration. The upload command retains the standard four GIF parameters.

```json
{
  "permissions": ["export.gif", "export.upload"],
  "contributes": {
    "exportDestinations": [{
      "id": "reviewed-put",
      "name": "My upload service",
      "origin": "https://uploads.example.com"
    }]
  }
}
```

The origin above is a placeholder; configure a server you control before use.
The complete package also needs an executable command and its standard GIF schema.

```ts
await context.exports.gif(input);
await context.exports.upload({destinationId: 'reviewed-put'});
```

Only one GIF and one upload may be staged. The worker cannot supply the source,
URL, headers, credential, filename or body. Successful worker completion first
runs the existing native destination picker and exclusive local GIF publication.
There is no upload until the verified local artifact exists and the user answers
a separate host review.

## Host upload review and transport

The host review identifies package/version/publisher, declared origin, artifact
name, geometry and byte count. The user supplies an exact HTTPS PUT URL at that
origin, optionally including a signed query, and an optional bearer token. These
values stay in the trusted host and are used for this invocation only. They are
not saved in plugin storage/settings, returned to plugin code or included in
receipts/logs. This initial protocol supports raw GIF PUT plus optional Bearer;
provider-specific OAuth, multipart forms, arbitrary headers, automatic retry,
background queues and stored credential profiles remain separate capabilities.

The host validates exact origin, HTTPS, URL/token bounds and header characters.
It resolves all addresses, rejects private/reserved destinations (including
IPv4-mapped/transition IPv6), and pins an approved public address for the request
while retaining normal TLS certificate/hostname checks. No redirects, cookies,
connection pooling or endpoint fallbacks are used. Response bodies and locations
are discarded, not treated as trusted artifact URLs.

The local GIF has a SHA-256 recorded during verified native publication. Before
opening an upload request the host captures a private bounded snapshot, verifies
that digest and streams only those bytes with fixed Content-Type and Content-Length.
A same-size replacement or symlink cannot substitute arbitrary source data.
Lookup and transfer have deadlines; transfer progress, package/panel verification
and AbortSignal cancellation remain host-owned. Only a complete stream and a 2xx
acknowledgment produce upload success. Acknowledgment is not proof of long-term
remote storage or a public download URL.

Stopping does not delete the already published local GIF. If any request started,
Stop/failure reports `may_have_uploaded: true`: the remote side may retain bytes.
No automatic retry can duplicate an uncertain remote action. Review refusal or a
failure before request start reports false. Local export success and upload status
remain distinct, including when a panel closes during review or transfer. The host
dock retains that completed artifact receipt after Stop closes the current panel;
another panel opening or project/load change clears its receipt ownership.

```ts
interface UploadReceipt {
  status: 'completed' | 'denied' | 'canceled' | 'failed';
  may_have_uploaded: boolean;
  bytes_sent?: number;
  http_status?: number;
}
```

The host shows this result alongside Open/Show in folder for the native artifact.
Panel results contain path-free `PanelGifArtifact` and optional `upload`; no URL,
token, response body, private digest or path is included. A native publication
record prevents renderer/page input from claiming a successful export/upload.

## Authoring and evidence

Original examples are `examples/plugins/media-library-jobs` and
`examples/plugins/reviewed-gif-upload`. Neither executes on installation. The
upload origin is explicitly an unconfigured placeholder, not a bundled service.

Evidence lives under `mediaAndDestinationJobs` in
[plugin-validation.json](plugin-validation.json). Contract/native-media tests use
actual FFmpeg outputs. A local TLS fixture checks exact bytes, fixed method/length,
certificate verification, redirect refusal, address filtering, changed-artifact
refusal and cancellation. The Electron fixture builds public SDK packages, installs
through Settings, uses actual source capture/processing, Undo, CraftAI, native GIF
rendering, host upload review and a fresh process. Its transport is stubbed so app
tests contact no external destination; real HTTPS transport is tested separately.

Selected macOS evidence does not certify arbitrary live upload services, native
OS focus, packaged runtime, other platforms, the complete release battery or
long-running performance. The remaining pre-v1 and release gates stay open.
