# Explicit plugin development sessions

> Historical executable recipe design. Its runtime/SDK declarations are retired.
> Use the [general Node host](plugin-extension-host.md) and
> [migration rules](plugin-legacy-retirement.md). Creative pack and private edit
> validation contracts remain where referenced by the current host.


For trusted Node extensions, see [Node development and diagnostics](plugin-extension-development.md).
Native folder/session trust allows running generations to restart after reload;
temporary settings and secrets survive within that session. The sandbox workflow
below retains its per-execution approval rules.

This stage adds a developer workflow, without adding scenario features or changing
installed-package identity rules. Settings → Plugins → Create & develop → Developer mode can start
one session from a user-chosen compiled payload folder (or an SDK source project
with a built `dist`). The editor never compiles or evaluates source project tooling.

## Isolation and lifetime

A session captures normal validated package bytes in memory. Each reload
gets a new session/generation runtime key, separate from the real content fingerprint
and every installed key. Its commands and panels can run through the existing
sandbox, per-run/open consent, staging and commit guard. Effects, transitions, LUTs, color looks and motion presets also have isolated
sample previews. Watched valid edits refresh those samples without packaging or
installation. They never join project render registries, expose an Apply action
or become saved project pins. Providers and export presets can be tested using
the temporary service controls without joining installed registries.
Installed inventory/activation, packages and production preferences never change.

Provider tests send only an entered prompt to a declared model at the exact
OpenAI-compatible endpoint after fresh native consent. The manually entered key
is transient and cleared from the input; saved provider credentials, images,
conversation and project contents are not shared. Requests have a 45-second
deadline, no redirects, a 64 KiB response limit and at most 256 requested tokens.
Reload/end, cancellation and editor loss abort tests and discard late responses.

Export-preset tests render a section of the open project (at most 15 seconds) to
a native save destination. The test uses a detached settings snapshot, preserves
the project and Undo history, and verifies the current development generation
again at native output publication. Same-version manifest edits can be reloaded
and tested without installing a permanent version. Tests never add a temporary
preset ID to project settings. Canceling after publication retains the completed
test file. Local tool recipes also run in development sessions; setup still needs
the separate [local tool/model](plugin-local-tools.md) approvals.

Reload first revokes the old key, closes its panel and cancels only its pending
command. It validates a fresh snapshot, then publishes it without executing it.
Invalid or identity-changing output leaves the session failed and non-runnable;
a later explicit reload can recover. Plugin ID and publisher cannot change during
a session; start another session for a different identity. Changes to permissions
require the usual fresh execution/open consent. No panel automatically reopens. Completed manual development commands also need
a single-use current-generation commit authorization from main; queued old results
cannot apply after reload.
A commit already past the existing atomic apply boundary may complete; no false
rollback is reported. Project replacement still ends panel grants as before.

Session state is not restored at startup. End/quit revokes its key, closes watchers
and removes temporary session preferences. Preferences can survive reloads inside
the same session but are never read from or written to installed-plugin storage.
Only the main process owns source paths, snapshot bytes and session identifiers.
Management IPC is restricted to the trusted editor main frame; plugin sandboxes
cannot start/reload sessions or retrieve developer logs/source locations.

## Workflow

1. Run SDK build or watch outside the editor.
2. Start a session by choosing the compiled folder or built source project.
3. Use its command controls in Settings, select its clearly marked development
   panel from Plugin panels, or select a creative item in Live rendering preview.
   Samples use the normal renderer on original scenes; project media/history stay
   unchanged. No plugin code executes on attach or reload.
4. Choose Reload after a build. Optional Watch builds watches only that chosen
   compiled directory and its replacement in the parent directory; it handles the
   SDK's atomic dist replacement and never runs npm/compiler scripts. A bounded
   one-second byte-fingerprint poll covers missed native filesystem notifications;
   unchanged bytes do not revoke a working snapshot.
5. Inspect in-memory lifecycle, command, console and error records, or clear them. Console errors are diagnostics; use
   Reload to recover a faulting interface.
6. End the session before starting another. Installed versions remain usable.

## Diagnostics and limits

The log is untrusted plain text, with a generation, source, severity and host time.
Keep at most 200 records / 128 KiB, 1,000 characters per message and 30 incoming
records per second; over-budget messages are dropped and counted. Notifications are
batched. Commands forward at most 32 console messages through authenticated runtime
IPC, only for development snapshots. Panel console events come from its exact native
WebContents; failures/watchdog/crashes and host command outcomes are recorded too.
Worker-result records describe staging/execution, while the command UI reports
the actual verified applied result. No credentials, full snapshots or provider
responses are automatically logged.
Authored code can log its own approved data; this log stays in memory for the editor
session and is cleared on a new development session. There is no remote inspector,
arbitrary console evaluator, source map server or external reload endpoint.

## Implementation and verification

- Add a snapshot/session service with generation revocation, optional watcher,
  bounded logs and isolated temporary preferences.
- Route development runtime keys and read-only sample requests through that service. Keep normal
  inventory and installation paths unchanged.
- Add editor-only session/log IPC and localized Settings controls. Mark development
  panel options and consent; keep selection across generations without opening code.
- Capture worker/panel diagnostics with exact sender/token checks and size limits.
- Test immutable installed packages/preferences, failed reload recovery, scoped
  cancellation, permission changes, watcher replacement, log floods and forbidden IPC.
- Use SDK-generated payloads in hidden real Electron tests, including actual worker
  console output, panel errors, same-version reload, late approval, project changes
  and cleanup. No foreground test windows or installer builds are required.

Creative rendering acceptance and measured effect/transition/LUT reloads are
recorded in [the usability expansion audit](plugin-usability-expansion.md).
