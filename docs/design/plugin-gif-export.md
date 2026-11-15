# Stage 4a: bounded GIF jobs

An executable package may request `export.gif`, optionally with `project.read`.
Export cannot be combined with editor writes, caption reading or AI permissions.
The command declares the standard `start_sec`, `end_sec`, `max_size` and `fps`
parameters in `shared/pluginGif.mjs` and calls `context.exports.gif(input)` once.
This stages settings only. The sandbox cannot read the composition, file paths,
frames, output path or process handles. A failed command exports nothing.

The host validates the captured composition and resolves the range before native
per-run approval. The staged recipe must match those approved settings exactly.
After successful command completion the worker is stopped, then the host asks for
a **new** `.gif` destination. Existing files are never overwritten. Cancellation,
source changes, inventory changes, render/decode/encode failure and document edits
prevent publication. The temporary output is fully decoded and probed before an
exclusive atomic publication on the destination filesystem. Only host-produced
artifact metadata can report success. Export does not change project history.

The first slice is local only: 15 seconds, 300 frames, 960 pixels on the longest
edge without upscaling, 5/10/20 fps, looping forever, no audio, 8 MiB composition,
512 MiB temporary PNG frames, 256 MiB output and a ten-minute render deadline.
End 0 means `min(start + 5, video timeline end)`. End is exclusive. Samples occur
at `start + i/fps`; duration rounds up to a whole GIF frame. Frame rates divide
GIF's centisecond time base exactly. Dimensions preserve aspect to pixel rounding.

A persistent trusted offscreen preview renders the original timeline times with
visible layers, captions, effects and transitions. It uses original media, not
playback proxies. Source video formats must decode in Chromium; unsupported
originals fail rather than silently substituting a lower-quality proxy. Missing plugin dependencies fail the job. Live graphic drafts must finish rendering before export; they are rejected rather than captured incompletely. Frame IPC is limited
to the exact renderer main frame and monotonically increasing sequence numbers.
The exporter owns static FFmpeg arguments and bounded resource use. The Export
dialog, Settings and CraftAI reuse the same command path and permission checks.
CraftAI receives verified artifact metadata, never a plugin's file-success claim.

Later slices: more output formats and independent render adapters, richer job
queueing and explicit replacement policy. Arbitrary FFmpeg arguments, upload,
network and filesystem access remain outside this capability.
