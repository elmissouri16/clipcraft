# Self-contained archived worker and native view

App 2.0.0, SDK 0.8.0 and host API 1 remain unchanged. This extends the existing
Node-worker ASAR check after [fresh-cache SDK validation](plugin-sdk-cache-followup.md).
It closes a specific local archive-runtime evidence gap; production acceptance
and SDK v1 remain open.

## Coverage gap and test changes

The earlier test archived Electron/shared source but linked the checkout's entire
`node_modules` beside the archive and set `NODE_PATH`. It proved worker launch,
trust and settings, but could borrow checkout dependencies. It never loaded the
computed native view preload path.

The test now captures the installed `tar` dependency closure inside the archive,
preserving nested dependency resolution. It creates no checkout dependency link,
clears `NODE_PATH`/`NODE_OPTIONS` for the child and launches from a separate
temporary working directory/profile. A test-only resolver guard rejects CJS
application dependencies outside the archive. TypeScript, esbuild, Vite and React
must be unavailable to the archived application context.

The real archived manager installs an original Node fixture; trust refusal must
precede worker launch. After trust, the actual utility process runs from the
archive, registers commands and a view, exchanges host settings and replies to
view messages. The actual sandboxed WebContentsView loads its preload from the
archive and serves the extension's captured HTML, external JS and CSS through
the production protocol. Its page has no Node or editor bridge, uses a different
renderer process, returns the expected message and computed CSS, and refuses an
undeclared resource. Stop releases its view/session/registrations. Restart
preserves settings and reopens the bridge.

A separate archive deliberately omits `extensionViewPreload.cjs`. Its worker
still activates, but opening the view must reject with a real native preload
error, retain no active view and release the private session. This negative
control proves the test detects the computed-resource gap that the old test did
not exercise. A negative-control PASS means successful refusal, not successful
view operation.

The fixture uses isolated explicit user-data directories and no `--no-sandbox`.
Trust is granted by the harness; native consent-dialog interaction and physical
keyboard/focus acceptance are not exercised.
It never packages an installer. It uses a minimal runtime closure, not the
complete electron-builder dependency-pruning/release layout. Electron documents
[ASAR filesystem behavior](https://github.com/electron/electron/blob/main/lib/node/asar-fs-wrapper.ts)
and the [sandboxed preload environment](https://github.com/electron/electron/blob/main/shell/renderer/preload_environment.cc).

## Verification

The final complete archive passed seven native checks; the missing-preload
archive passed four refusal checks. Both ended with no leased or cleaning private
sessions. Four related suites also passed: runtime payload imports, view protocol
and IPC contracts, session leases, and real native session state isolation/reuse.
Structure and whitespace checks passed. Executable source remained unchanged
through the final five-suite selection.

The first harness attempt rejected macOS's canonical `/private/var` spelling
when comparing it with a `/var` temporary path. That startup assertion led to the
test's deadline termination and remains recorded as a failure. Temporary paths
are now canonicalized; startup errors write a failure receipt and exit promptly.
The corrected native workflow and final deadline-cleanup refinement both passed.
No product runtime correction followed from that fixture failure.

Exact archive hashes, dependency versions, native module paths, preload errors,
profiles, source hashes and logs are retained in
`plugin-validation.json.extensionAsarNativeViews` and
`/var/folders/_j/d8w7d_sn23348hmv9trrjm480000gn/T/clipcraft-extension-services-final-djhg2njv/verification.json`.

## Remaining acceptance

Only the ASAR test and its fixture changed; application/SDK implementation,
manifests and lockfiles retain their preceding bytes. Existing SDK consumer
results remain separate evidence. No full application battery or remote CI was
rerun. These macOS arm64 native checks do not establish installed release or
Windows/Linux acceptance, complete application-ASAR/native-media behavior,
representative hardware/performance budgets, complete abuse/distribution review
or remaining manual/assistive-technology acceptance. The original asset manifest,
Windows prerequisite and live SFXMint HTTP 429 failure remain unresolved; no new
SFXMint request was made. No version bump, publication, installer, commit or push
was produced.
