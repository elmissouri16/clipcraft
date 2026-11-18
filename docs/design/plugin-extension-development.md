# Node extension development and diagnostics

Settings → Plugins → Create & develop → Enable developer tools → Start session
accepts a compiled extension directory or an SDK project with a built `dist`.
Run SDK build/watch outside the editor. Selecting a folder validates and captures
its bytes; it does not execute extension code or project tooling.

The Node activation runs from a separate, materialized generation directory.
Editing the build output cannot change that activation. Before activation or view
opening, the host checks the captured files against their original fingerprint.
Development keys identify temporary generations, not installed packages.
Snapshots never enter installed inventory or creative-pack dependency resolution.

## Trust and storage

Trust & activate opens a native warning identifying the resolved compiled folder.
Consent covers changed builds at that path with the same extension ID and
publisher for the current session. This includes automatic replacement of a
running activation when Watch compiled builds is enabled. Node access includes
files, network and programs; this is trusted code, not a Node security sandbox.

Folder symlinks, changed resolved paths and changed extension identities are
refused on reload. SDK atomic replacement of a regular `dist` at the same path is
supported. A changed identity requires a new explicit session and trust decision.
Trust is held in memory and is not written as an installed-package trust grant.
Ending the session or restarting the app removes it.

Settings, encrypted secrets and the extension's storagePath live in the temporary
session directory. They survive reload, including failed-build recovery, and are
separate from the same extension's installed storage. End session deletes them.
Imported media adopted into a project follows the normal durable media lifecycle.
An already running installed activation with the same ID must be stopped before
starting its development version. Command buttons bind to the selected package
key, so they cannot accidentally execute the other activation.

## Reload ordering

Reload retires the old catalog key before awaiting Stop. Stop cancels event scopes
and unclaimed edit reservations, drains reducer edits that have already claimed
their native lease, stops managed exports, deactivates the extension and removes
its registrations. Pending calls, views, streams and managed processes are
revoked. The old utility process exits before a running replacement is started.
Resource cleanup and queued settings writes finish before its snapshot is deleted.

The host validates and materializes the new generation after that boundary. A
previously running, trusted extension restarts. Invalid output leaves no executable
old generation; a corrected build can recover the running session. An explicit
Stop, crash or activation failure requires Activate, including after a new build.
Watch never bypasses that stop state. A failed activation retains its valid
snapshot for a manual retry and reports the error in runtime details.

Views close on reload; reopening creates a fresh isolated view instance. Commands,
services, shortcuts and native actions discover the current generation. Raw Node
child processes remain the extension author's responsibility; the host tracks
processes launched with context.processes.

## Workbench diagnostics

Installed and development extension controls show inactive, activating, running,
stopping, stopped or failed state. Runtime details retain the generation, bounded
logs, event queue/missed counts and the actual failure reason after a crash or
activation failure. At most 64 inactive package/generation records are retained
in memory, each with the last 50 log records. Active logs retain at most 100
records, with 4,000 characters per message. The diagnostics endpoint also exposes
the event bus's last 16 delivery failures to the trusted editor frame.

Development logs additionally use the existing 200-record / 128 KiB session log,
with 1,000 characters per record and 30 authored messages per second. Logs are
plain text; authored code can log its own data. There is no arbitrary evaluation UI. Trusted running Node development sessions
now expose an explicit local debugger attach control, with bundled TypeScript
source maps. Installed activations never enable it through these controls. See
[debugger contracts](plugin-sdk-general-contracts.md#development-debugger).

These are editor workbench controls, not new public extension kinds or a new SDK
version. App 2.0.0, SDK 0.8.0 and host API 1 remain unchanged. Native verification
is macOS development verification; distribution and other platforms retain their
separate release gates.
