# Full application regression after extension hardening

App 2.0.0, SDK 0.8.0 and host API 1 remain unchanged. This follows the
[encoder handoff correction](plugin-extension-fifo-handoff.md) and checks the
combined archive, private-session and export changes against the whole discovered
application battery. Release and SDK v1 remain on hold.

The later [SDK validation followup](plugin-sdk-validation.md) adds the local
verification command and a nonpublishing workflow. Its results do not rewrite
the raw whole-application runs or the workflow-absence observation below.

## Diagnosed fixture failures

The first frozen full run exposed two failures beyond the known external
prerequisites. A second full run exposed a language-driver failure. All raw runs,
source manifests and failures are retained; focused followups do not rewrite
their statuses. Product source stayed unchanged throughout this followup.

### Endpoint restart

The endpoint check expected HTTP 404 from an old SDK client immediately after
server restart, but received a transport-level closed-socket error. That request
did not prove whether the new server rejected the old session. The fixture now
captures the real initialized session ID and tests its 404 refusal on a fresh
HTTP connection, then checks a newly initialized SDK client can call tools.
The stopped old client's call must still fail. No production request retries or
tool-call replay were added. Node documents the
[one-time HTTP agent](https://github.com/nodejs/node/blob/v24.22.2/doc/api/http.md)
used for the explicit routing assertion.

### Filter capture

A concurrent reproduction captured a colour frame with chroma 253 while the
actual renderer canvas was already grayscale with chroma 0. The window was
visible but the page's visibility state was `hidden`. This established a stale
native capture in that reproduction, rather than a wrong filter expression.

The fixture now disables background throttling and uses hidden/awake capture
options. It retains the original colour/intensity/export thresholds and records
renderer pixels, page visibility and window state beside each native capture.
Additional checks deliberately hide the window, change to full strength and then
half strength, and require newly captured pixels to match each state. Electron's
[page visibility and capture documentation](https://github.com/electron/electron/blob/main/docs/api/browser-window.md)
describes macOS occlusion and these options. No rendering implementation or image
threshold changed.

### Language readiness

The language driver ignored a failed five-second readiness wait and clicked a
missing Settings control. A controlled 6.5-second Settings response reproduced
the same null-element failure. The driver now enforces readiness before each
navigation and reports a deadline failure at the actual missing step. French
and Spanish both pass with that delayed response; the ordinary full-battery
profile has no artificial delay. The localization values and absence of English
fallback labels remain asserted, and renderer errors now fail the check.

Both affected UI launchers use explicit temporary user-data directories and no
`--no-sandbox` flag, with those conditions verified in the native result. The
diagnostic delay exists only in the smoke driver, never in product settings.

## Frozen full-run results

| Candidate | Raw PASS / FAIL | Classified PASS / FAIL / SKIP |
| --- | ---: | ---: |
| Initial | 337 / 4 | 335 / 4 / 2 |
| Capture/endpoint corrections | 338 / 3 | 336 / 3 / 2 |
| Readiness corrections | 338 / 3 | 336 / 3 / 2 |

The inventory includes seven added suites since the earlier 334-suite full run,
covering resource admission, view cleanup/session leases, package publication,
archive boundaries and the FIFO race. Exact additions are recorded in the ledger.

Every run discovered 341 suites, had no suite timeouts and kept
its executable source frozen. The five files changed between the first and last
candidates are test drivers only. The final filter workflow passed 15 checks,
including its background captures; canvas/WebGL readback warnings were also
recorded and remain in the evidence. This is not performance acceptance. Ordinary
French localization, both delayed French/Spanish workflows, the clean SDK
consumer's 18 checks and the native extension export workflow's
29 checks passed. Structure and whitespace checks passed.

The final third failure is live SFXMint throttling. Its error path corresponds
to HTTP 429, and one bounded diagnostic confirmed that status with
`Retry-After: 43430`. No further requests were made after
that header was observed. This remains failed live acceptance; earlier passing
runs do not waive it. The other failures are the Windows caption and original
asset-manifest prerequisites below. The two whole-suite skips are explicit live
native-runtime download and OpenCode opt-ins. Reported optional subcase skips
are retained separately in the ledger.

Source manifests, raw results, native state/pixel diagnostics, failures and local
renderer/SDK/tarball hashes are recorded in
`plugin-validation.json.extensionHostFullRegression` and
`/var/folders/_j/d8w7d_sn23348hmv9trrjm480000gn/T/clipcraft-extension-services-final-1oaatvik/verification.json`. These are loose development artifacts, not
installed release or installer evidence.

## Remaining release work

The Windows caption prerequisite and original sibling
`asset-pack/library-manifest.json` remain unavailable in this macOS checkout.
They remain failed coverage rather than waived platform/content acceptance.
The asset manifest was also searched for under the current open-source workspace;
no replacement was found or invented.

Read-only GitHub checks found no workflow directory on the fork's default branch
and zero registered Actions workflows. No workflow was dispatched or changed.
Release automation, installed Windows/Linux acceptance, declared minimum
hardware/workloads and performance budgets, remaining manual UX/assistive
technology, complete abuse/distribution acceptance and the exact attribution of
the old export timeout remain open. No installer, publication, version bump,
commit or push is produced by this stage.
