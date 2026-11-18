# Managed extension jobs and files

These are general trusted Node extension APIs. They add no speech, AI, upload or
GIF extension kinds. Raw Node access remains available; the host can manage only
operations issued through its API. App 2.0.0, SDK 0.8.0 and host API 1 are unchanged.

## Jobs

`context.jobs.run(title, async ({signal, progress}) => result, options?)` scopes a
bounded job. `options.timeoutMs` defaults to ten minutes and accepts one second
through thirty minutes; an optional AbortSignal joins the invoking scope.
`progress(fraction, message?)` accepts 0–1 and plain bounded text. Native updates
are coalesced. Selected extension details in Settings display title, progress,
message and Cancel. Active jobs also appear in the editor's extension activity
area, including cancellation outside Settings. It shows up to three jobs;
the remaining-jobs control opens plugin management. These views share the same
activation/generation-scoped native jobs rather than creating new jobs.
The editor hides these job cards while Settings, export or CraftAI execution is
active; Settings continues to provide its selected extension's job controls.

Jobs pause the ordinary invoking command/service timeout, including nested calls.
They do not extend Save/export's global deadline. Sixteen jobs per activation and
64 overall are allowed. Each job has its own native cancellation controller;
Cancel checks both package identity and activation generation. Cancellation
propagates through nested service calls/streams, managed processes, file pickers,
file publication, exports and native document authorization. A delayed unclaimed
edit cannot borrow authority after cancellation. Already-applying native commits
finish under the existing atomic commit lease.

Callbacks should stop on `signal` and await their managed work. The host allows
five seconds for cancellation cleanup, then stops an uncooperative activation.
Cancellation revokes new document/transport work but permits scoped cleanup,
configuration/secrets and diagnostic calls. A callback may handle cancellation
and return a truthful receipt for an already-completed or uncertain external
effect. Managed work it starts without awaiting still drains before job completion;
failed work cannot become a successful completion merely by being detached.

Successful jobs can start activation-owned background subprocesses. Failure or
cancellation terminates the job's managed processes; explicit activation stop
cleans remaining process trees. `processes.spawn` still defaults to five minutes,
with a maximum thirty-minute process deadline and bounded output. Job and process
deadlines are separate; use an appropriate value for both.

Native file-picker cancellation revokes the reply; it does not individually close
an already-open OS picker. The dialog slot remains occupied until dismissal.

## File publication

`context.files.publish({path, destination, overwrite?}, {signal?}?)` copies a
regular nonempty local file up to 512 MiB to an absolute destination and returns
`{path, bytes, sha256, atomic, warning?}`. The paths are selected by the trusted
extension; publication itself does not open a picker. Four copies overall, two
per activation, and a five-minute publication deadline bound the managed work.

The host captures source identity, copies/hashes to staging beside the destination,
checks source identity again and syncs the staged file. Default publication
refuses an existing destination. It rejects links, directories and replacing the
source itself, including hard-link aliases. Activation, callback and job authority
are checked immediately before publication. Completed output survives a later
cancel or staging cleanup failure; the latter returns a warning.

On hard-link filesystems default publication uses a synchronous exclusive link
and returns `atomic:true`. On filesystems that reject hard links it falls back to
an exclusive bounded copy, syncs it, checks authority and destination identity,
and returns `atomic:false`. The fallback file is visible while copying. On error
or cancellation it removes only its own incomplete inode; an independently
replaced destination is preserved. Explicit `overwrite:true` uses a checked
rename of staging and returns `atomic:true`. Atomic visibility is not a promise
of directory fsync or crash-proof storage on every filesystem.

Authors should retain returned publication receipts even if later cleanup or
progress reporting is canceled. For an already-saved file, catch a final progress
rejection rather than turning successful publication into an alleged failure.

## Output examples

`examples/extensions/gif-export` renders a temporary MP4, encodes/probes a GIF and
publishes it. `exports.render({showCompletion:false, ...})` preserves native
attributed render progress while closing the completion dialog for intermediate
output; the default is unchanged.

`reviewed-gif-upload` implements its own reviewed HTTPS PUT and records confirmed,
not-sent or uncertain outcomes. `local-speech` owns pinned model download/import,
explicit executable selection, local transcription and reviewed SRT publication.
The core provides generic commands, settings, messages, pickers, jobs, tool paths,
processes and files. Their old executable bytes are now private compatibility fixtures; the
recipe runtime is retired. Creative data packs remain supported.
