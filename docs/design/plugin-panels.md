# Stage 5a: isolated custom panels

> Historical executable recipe design. Its runtime/SDK declarations are retired.
> Use the [general Node host](plugin-extension-host.md) and
> [migration rules](plugin-legacy-retirement.md). Creative pack and private edit
> validation contracts remain where referenced by the current host.


The original Stage 5 slice preceded destination uploads. The current pre-v1
[picked media/destination job contract](plugin-media-jobs.md) now supports them
through the same explicit command allowlist.
A package can contribute one `panels` entry with `{id,name,entry:"panel.html",
script?:"panel.js",style?:"panel.css",permissions:[],commands?:[]}`.
Panel permissions allow `project.read` and `storage.local`; the extensions below
define command allowlists and storage. It contains only the declared root UTF-8
files plus any existing command entry.
HTML and JS are limited to 64 KiB each; CSS to 32 KiB. All assets participate in
the immutable fingerprint; legacy package fingerprints are unchanged.

The editor's Plugin panels button opens a dock in place of Properties. Opening
a selected panel requires native approval naming its unverified publisher,
version and read grant. Installation and project opening never execute panels.
Each opening creates a separate sandboxed WebContentsView, non-persistent session
and non-file custom origin. Panel content never executes inside the editor DOM.
Host-owned chrome identifies the package and owns close/reopen/error controls.

The initial SDK was read-only: `clipcraftPanel.getInfo()`,
`clipcraftPanel.project.read()`, `clipcraftPanel.project.onChanged(callback)` and
`clipcraftPanel.theme.onChanged(callback)`. Subscriptions return unsubscribe
functions. Metadata includes only name, geometry, duration, counts and bounded
marker times/titles. Paths, media bytes, captions, chat, credentials, reducer,
network, filesystem, shell, direct clipboard access, new windows and device permissions are
unavailable. Per-open consent ends on closure, project replacement or revocation.
The approved-actions extension below adds declared commands without direct mutation access.

The host maps its semantic theme to `--cc-background`, `--cc-surface`, `--cc-text`,
`--cc-muted`, `--cc-accent`, `--cc-border`. Panels use system fonts. Escape returns
to the editor and closes the panel. Tab/Shift-Tab at content boundaries return
focus to host controls; an explicit Focus panel button enters native content.
Panel dimensions follow its dock and are clipped to the editor content area.
Native content is hidden while editor dialogs/menus obscure the dock.

The panel session blocks network, file navigation, downloads, subframes, workers,
remote resources, inline scripts, eval, popups and legacy application IPC. Calls
are authenticated by exact WebContents/main-frame identity and private preload
tokens, with payload/rate/subscription limits. A private heartbeat detects a stuck
renderer and closes it without freezing the editor. Crash, load failure, plugin management actions, tampering, navigation and owner destruction dispose the view/session.
JavaScript dialogs are disabled and HTML fullscreen attempts close the panel.
No renderer is silently restarted or upgraded; reopening needs fresh approval.
The original example had session-only notes; version 1.2.0 adds explicitly saved
preferences as described below. Project state and
Undo remain unchanged after read-only panel operations.

The extensions below broker approved commands and local preferences. Later slices
can add richer panels and managed local jobs. They must retain edit ownership, consent and Undo;
the first slice grants no general-purpose editor or native-runtime access.


## Author workflow

Start with `examples/plugins/project-dashboard/`, which contains the complete
manifest and an original local interface. Install it through Settings → Plugins,
then click **Plugin panels** in the editor's top bar, select **Project dashboard**
and choose **Open panel**. The example shows statistics and markers, and provides
a note and chapter-count field. **Save preferences** keeps both after closing or
restarting (version 1.2.0); **Add chapter markers** asks for separate command approval.

The HTML uses a local external script and stylesheet. Inline scripts, event-handler
attributes, external imports, workers and remote fonts/images are blocked. Inline
SVG and canvas drawing can provide original icons and visuals. No downloaded SDK
is needed; the isolated preload provides `window.clipcraftPanel`.

```js
const panel = window.clipcraftPanel;
const info = await panel.getInfo();
if (info.permissions.includes('project.read')) {
  renderSummary(await panel.project.read());
  const unsubscribe = panel.project.onChanged(renderSummary);
  // Call unsubscribe() when this subscription is no longer needed.
}
panel.theme.onChanged(theme => {
  // CSS variables are updated automatically; this callback is optional.
});
```

`getInfo()` returns `apiVersion`, `panelId`, panel/package names, version,
permissions, declared command descriptors and initial theme. `project.read()` returns `name`, `duration_sec`, `fps`,
`width`, `height`, counts (`video`, `overlay`, `audio`, `text`, `effect`, `media`,
`markers`) and up to 1,000 `{time,label}` markers. Labels are bounded plain text.
The protocol accepts at most 128 KiB per payload and 60 SDK calls per minute;
private heartbeat traffic and host updates are separate. Each subscription kind
supports up to 16 callbacks. Unsupported calls and over-budget reads fail closed.
Read-only operations write no project data; panel layout/selection is not restored
by running code on startup.

For validation and packaging, use the existing `scripts/plugin-package.cjs`
helper. Declare every asset, keep it UTF-8 text and increment the package version
when any asset changes. Images, binaries, nested asset folders, dependencies and
install scripts are outside this first slice.

Electron references: [WebContentsView](https://www.electronjs.org/docs/latest/api/web-contents-view),
[View bounds and visibility](https://www.electronjs.org/docs/latest/api/view),
[WebContents lifetime](https://www.electronjs.org/docs/latest/api/web-contents).


## Approved panel actions (Stage 5a second slice)

A panel may declare `commands: ["add-chapter-markers"]`, with at most eight
unique IDs from its own package. Packages exposing panel actions may request
canonical command permissions, including [reviewed AI, caption and GIF actions](plugin-panel-reviewed-actions.md). Package permission combinations and per-run host approval remain authoritative. Existing read-only packages
retain their normalized manifests and fingerprints.

`getInfo().commands` describes only those declared commands and parameters.
`commands.run(id, input)` requires a fresh, single-use trusted click in the
isolated preload, then the existing native Run once prompt for every execution.
Denial blocks further action requests until the panel is reopened. `commands.cancel()`
cancels only that panel's action. `commands.onProgress(callback)` returns an
unsubscribe function and reports bounded phase/progress values, never editor data.

Main issues private action/run identifiers and the editor claims each action once.
The existing worker sandbox validates inputs, stages markers and returns proposals.
The trusted editor checks document identity, load generation and edit ownership;
main authorizes the final commit only while the panel/action are still active.
Successful mutation uses the existing atomic reducer and one Undo entry. The SDK
resolves with `{status, markers_added?}` only after the actual commit is verified;
worker messages and proposed counts are never treated as proof of an edit.

Closure, project replacement, revocation, crash and Stop cancel pending approval
and staged work, including late responses. Applying is an atomic boundary:
a commit already authorized can finish even if its view closes immediately after.
Cancellation is unavailable during that short phase. Panel lifecycle operations
never cancel unrelated manual commands. Local storage and
[reviewed AI/caption/GIF actions](plugin-panel-reviewed-actions.md) have separate
bounded contracts; direct network and arbitrary editor APIs remain unavailable.


Author a command button using the synchronous trusted click handler:

```js
button.addEventListener('click', async () => {
  const result = await window.clipcraftPanel.commands.run('add-chapter-markers', {
    count: 5,
  });
  if (result.status === 'completed') {
    status.textContent = `Added ${result.markers_added} markers.`;
  }
});
const unsubscribe = window.clipcraftPanel.commands.onProgress(({phase, progress}) => {
  // phase: permission, running, review, applying, completed, denied, canceled or failed.
  // progress is a number in [0, 1]. No plugin message or project data is included.
});
cancelButton.addEventListener('click', () => window.clipcraftPanel.commands.cancel());
```

A trusted click creates one permit, consumed by `run`, expiring after 1.5 seconds.
Do not await unrelated work before requesting the command. Synthetic events and
automatic calls reject before IPC or native approval. `run` resolves to a status
(`completed`, `denied`, `canceled`, `failed`). Completion carries actual marker/clip counts, or the caption/GIF receipt defined by the [reviewed actions contract](plugin-panel-reviewed-actions.md).
A denied panel must be reopened before another action. Invalid allowlists/inputs
and unsupported capabilities close the panel. Payload, rate and subscription
limits also apply to the action API. There is one action per panel and one command
in the host at a time. The editor must claim a new action within five seconds;
human approval has no automatic timeout after the editor claims it.

## Scoped persistent storage (Stage 5a third slice)

Panels may request `storage.local` alongside `project.read`. Per-open consent
names this grant. The isolated SDK provides async `storage.get(key)`, `set(key,
value)`, `remove(key)`, `keys()` and `clear()`. A missing key returns `null`.
Only JSON data is accepted, with finite numbers, at most 16 nesting levels,
2,048 value nodes, 16 KiB per value, 64 entries and 64 KiB total serialized data.
Keys are 1–64 letters, digits, dots, underscores or hyphens; reserved prototype
names are rejected. Quota, invalid value and disk failures report bounded errors
without replacing previously saved data or exposing host paths.

Main derives the namespace from the immutable package fingerprint and declared
panel ID, never from page input. Storage lives outside the immutable package and
project files. Different plugins, panels and package versions cannot read each
other's state, even when their IDs/publisher text match. Exact-version reopening,
project replacement and app restart retain the data; disabling retains it but
revokes access. New versions start empty until the user chooses the reviewed
[preference migration](plugin-usability-expansion.md) in Settings. Selected keys
copy between intact matching plugin/panel identities, with explicit conflict
approval, quota checks and stale-review rejection. Source data stays intact;
provider credentials and grants are separate and never transferred.
Removal deletes that version's data. Settings provides a confirmed Clear saved
data control that closes the version's open panel and clears its namespace.

Reads and writes recheck package integrity, active grant and panel lifetime.
Operations and management cleanup use the manager's serialization queue. Writes
use a private temporary file and atomic rename, rechecking lifetime immediately
before publication. Cancellation before publication leaves the old state;
already published writes remain saved. Malformed existing data fails closed;
clear can recover it. No storage operation changes the project or Undo history.
This is plain local preference storage, not a credential vault or an arbitrary
filesystem API. The dashboard opts in and explicitly saves its note and chapter
count, with visible saving/saved/error feedback.

E2E checks use hidden editor windows and isolated profiles where possible.
Focus-only assertions and foreground screenshots are skipped in quiet mode and
reported as such; functional storage, real preload/IPC and restart tests remain real.


```js
const storage = window.clipcraftPanel.storage;
const preferences = await storage.get('preferences');
await storage.set('preferences', {note: 'Next edit', count: 5});
const keys = await storage.keys();
await storage.remove('preferences');
await storage.clear(); // Clears this exact version and panel only.
```

Declare `storage.local` in the panel's permissions, not package-level command
permissions. Catch rejected operations and show their error to the user; the host
preserves the last committed state on validation/quota failure. Do not store keys,
passwords or large media in preferences. The dashboard uses a single record so its
note and chapter count publish together.

## Pre-v1 ripple command allowlists

Panels may allowlist commands using `timeline.ripple` with `editor.read` and the
explicit free-clip/pair grants required by their scope. Execution still needs a
trusted click and fresh native consent; panels receive no direct write API.
Stopping/closing the panel discards staged ripple. See [the contract](plugin-ripple.md).

The current pre-v1 extension also supports [bounded clip lifecycle and track
placement](plugin-lifecycle.md). `clips.manage` and `tracks.write` are distinct
grants requiring `editor.read`, with `clips.links` for explicit pair operations.
Panels still run only allowlisted commands through native consent and receive
verified clip/track counts; menu registration grants no implicit collateral edits.

The current pre-v1 [static property contract](plugin-properties.md) adds
`clips.properties`, with `clips.links` and both handles for linked targets.
Native consent, exact target scope, lock checks and verified clip receipts apply
to Settings, registered menus, allowlisted panel commands and CraftAI. It does
not grant arbitrary patches, speed, keyframe or effect-parameter writes.

[Source automation](plugin-automation.md) adds separate `clips.retime`,
`clips.automation` and `clips.effects` command grants, each requiring `editor.read`.
Linked targets also require both handles and `clips.links`. Settings, menus,
allowlisted panel commands and CraftAI share exact scope, native consent and
actual receipts; catalog changes invalidate prepared effect commits.


[Reviewed panel actions](plugin-panel-reviewed-actions.md) now extend the same
allowlist to chapter AI, translated captions and host GIF publication. Panel
progress includes `review`; caption receipts report actual count/track/language,
and native GIF receipts expose verified metadata without paths. Each run retains
native consent, mandatory review where applicable, exact lifetime checks and
cancellation. GIF files remain after publication and are not timeline Undo edits.


[Picked media and reviewed upload jobs](plugin-media-jobs.md) also run through
same-package command allowlists. Library imports report `media_added: 1`; GIF
uploads retain a native artifact and a separate bounded upload receipt without
paths, URLs, credentials or response bodies. Separate host source/destination
choices, final authorization, cancellation and native lifetime checks remain required.
