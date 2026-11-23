# Extension lifecycle and diagnostics

Activation sets up registrations. Stop, failure and reload release them. Use managed jobs for long work and the extension log to investigate a failed handler.

## Identity and registrations

Use `context.extension.id` for your package namespace, `path` for the installed payload and `storagePath` for extension-owned files. `generation` identifies this activation. Keep disposable registrations in `context.subscriptions` when their lifetime should end at Stop. Use `await context.log(message, level)` to report diagnostics in the extension log.

## Activation and cancellation


- **Explicit Stop is final** until the user activates again. A crash or a timeout
  also needs a manual Activate. A request the user cancels (a save, an assistant
  run) while your extension is still starting does not count as a failure.
- **Plugin management restarts you.** Installing, enabling, removing or
  recovering any plugin stops all extensions briefly; the ones that were running
  start again. In-flight work is canceled, so keep long work resumable.
  Opening or canceling an Install picker does not stop running work; the restart
  begins only after a package is selected for installation.
- **A handler has five minutes.** Commands, service methods, hooks and event
  listeners are stopped, and the extension with them, if they run longer. Time
  spent waiting in `jobs.run`, `processes.spawn().result`, a dialog, a message,
  `exports.render`, `files.publish`, another extension's command or service, or
  `editor.tools.run` does not count. Put long work in `jobs.run`.
- **Calls belong to the handler that made them.** A host call started inside a
  handler must finish before the handler returns. Work you start without
  awaiting it is cut off when the handler ends; an error it raises is written to
  your log. For work that outlives a handler, start it from `activate` or from a
  timer, or run it as a job.
- **Signals.** Every handler gets `{signal}`. It aborts when the caller cancels,
  when the extension stops, and also once the handler has finished.
- **Errors.** Throw an `Error`. The message reaches the caller; the stack goes to
  your log (Settings → Plugins → your extension, or `context.log`).

## Programs and long work

```ts
const host = await context.host.read();                    // host.tools.ffmpeg, host.tools.ffprobe
const run = await context.processes.spawn({file: host.tools.ffmpeg, args: ['-version'], timeoutMs: 30000});
const {code, stdout} = await run.result;

await context.jobs.run('Transcribing', async job => {
  await job.progress(0.25, 'Loading model');
  if (job.signal.aborted) return;
});
```

A managed process gets a minimal environment plus your `env`, is killed with
its process group on timeout, cancel or stop, and returns once the program
itself exits. Captured output is text by default; `encoding: 'bytes'` returns
`Uint8Array` for stdout/stderr and stdin also accepts bytes. `output: 'stream'`
provides one pull consumer through `run.output`; chunks carry their stream name
and exact bytes. `output: 'both'` also keeps captured results. Capture and unread
queues are each bounded by `maxOutputBytes` (1 MiB default, 8 MiB maximum).
Overflow terminates the child instead of silently dropping data. See the
[streaming/server contract](../design/plugin-extension-expansion.md#managed-processes). A job shows in the activity list with your title and
progress and can be canceled there. Processes you start with Node's own
`child_process` are yours to clean up.

## Configuration and secrets

```ts
await context.configuration.update({key: 'mode', value: 'careful'});                      // global
const {documentId} = await context.workspace.read();
await context.configuration.update({scope: 'project', documentId, key: 'notes', value: {done: true}}); // saved in the project, undoable
await context.secrets.store({key: 'apiKey', value: 'sk-…'});
```

Values are finite, acyclic JSON, 64 KiB each. Dates, byte arrays, nonfinite
numbers, sparse arrays and nested undefined values reject; top-level
`value: undefined` deletes the key. Secrets are encrypted by the operating system
and only your extension reads them back. Both survive uninstalling.

## Runtime limits

| Thing | Limit |
| --- | --- |
| Handler run time | 5 minutes, eligible waits excluded |
| Activation / deactivation | 15 s / 5 s |
| `jobs.run` | 1 s to 30 min |
| Managed process | 30 min; 8 MiB output; 1 MiB stdin; 64 at once |
| `editor.tools.run` | 64 calls; 512 KiB per result |
| `editor.apply` | 64 operations; 64 affected clips |
| `captions.write` | 10,000 cues; 4,000 characters each |
| `files.publish` | 512 MiB; two at once per extension |
| Message | 3 actions; 240 s; 3 waiting |
| Events | 64 emits in a burst, about 32 per second after |
| Package | 4,096 files; 32 MiB per file; 128 MiB total; 64 MiB archive |

## Host boundaries

Known gaps, so you can plan around them:

- **Additional property bindings.** Native controls now bind to static picture,
  audio/text properties, source-time curves, speed and effect controls through
  `ui.registerInspector`. Arbitrary saved project fields do not have writable
  native bindings.
- **Arbitrary timeline item HTML.** [Custom clip/track types](../design/plugin-custom-timeline.md)
  support typed saved data, native timeline rows and inspector forms, shader or
  media rendering, metadata tracks and atomic `timeline` edits. Their timeline
  controls are rendered by the host.

## Diagnose and test

- `clipcraft-plugin check` type-checks against these declarations.
- A development session reloads your build in the real editor and shows your
  log, including view script errors.
- The repository's own proof is a good template: the fixture in
  `tests/fixtures/extensions/api-probe` calls every namespace and
  `tests/unit/plugins/test-extension-api-ui.cjs` runs it in the real app.

[Extension API index](../design/plugin-extension-api.md) · [Type declarations](../../packages/plugin-sdk/src/extension.d.ts)
