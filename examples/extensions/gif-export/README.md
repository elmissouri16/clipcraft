# GIF export

Build this source with the repository's SDK CLI and install its compiled package.
Set the range, frame rate and longest edge in Plugins settings, then run **Export
GIF**. Zero End uses the next five seconds or the project end. Choose a new `.gif`
filename; existing files are preserved.

This ordinary Node extension renders a private MP4 through `exports.render`, runs
bundled FFmpeg through `processes.spawn`, and probes the encoded GIF before
`files.publish`. Limits: fifteen seconds, 300 frames and 256 MiB. The native job
in this extension's Settings details shows progress and Cancel. No specialized GIF
extension declaration is used. The intermediate MP4 has native render progress
but suppresses its completion dialog because it is temporary.

The command returns actual published bytes, SHA-256, frame count and geometry.
`atomic` describes publication visibility: unsupported hard-link filesystems use
an exclusive cancellable copy and return `false`. A completed file survives later
cancellation or temporary cleanup failure. A returned `warning` concerns cleanup.

The ID and version match the historical example. The host retains its immutable
bytes alongside this Node replacement, with a separate fingerprint and fresh
trust. Existing exports are preserved. The command is also available through its
general action in the native export dialog.
