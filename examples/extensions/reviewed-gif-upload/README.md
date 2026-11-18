# Reviewed GIF upload

Build and install this source, then set the GIF range and optional HTTPS PUT
address in Plugins settings. An optional bearer token is stored as an encrypted
secret. Run **Export GIF and review upload** and choose a new local filename.
The GIF is saved first. With no upload address, the command finishes locally.

Before upload the extension captures and checks the exact published GIF again.
A native attributed review displays the destination origin/path, filename, byte
count and SHA-256. Address queries and the authorization token are hidden. Choose
**Keep local only** to send nothing. Upload uses one verified HTTPS PUT, no pooling,
no redirects, no retry, a thirty-second deadline and a 64 KiB response limit. The
extension owns this transport; the SDK adds no upload protocol or provider type.

The result includes the local file and an upload receipt:

- `confirmed`: the exact body finished sending and a complete 2xx response arrived.
- `not-sent`: review was declined or preflight/TLS setup did not reach sending.
- `uncertain`: sending started without a complete success acknowledgment. A service
  can retain bytes after cancellation or an error. Check it before retrying.

The receipt's byte count measures locally streamed body bytes, not confirmed remote
storage. A success response acknowledges HTTP processing; it cannot prove a
service's long-term retention. Server response text and credentials are excluded
from results. The local GIF is retained for every upload outcome.

The historical identity/version is retained. The host keeps the old immutable
payload beside this Node replacement and requires fresh Node trust. No version
is bumped. The command also contributes a general native export action.
