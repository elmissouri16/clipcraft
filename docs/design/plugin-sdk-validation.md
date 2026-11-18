# SDK development validation

> The subsequent [fresh-cache followup](plugin-sdk-cache-followup.md) adds the
> required online `sdk:cache` preparation after a clean Linux install exposed
> missing registry metadata. It records corrected Mac/Linux checks. Initial
> evidence below remains unchanged; SDK v1 and release remain on hold.

App 2.0.0, SDK 0.8.0 and host API 1 remain unchanged. This follows the
[full application regression](plugin-extension-full-regression.md). It adds a
repeatable local SDK check and a nonpublishing GitHub Actions workflow. SDK v1
and production release remain on hold.

## Local command

Run `npm run sdk:verify` after installing the root and SDK lockfile dependencies.
Root dependency installation uses Node >=22.12 for Electron's installer; the
SDK check itself supports Node >=20.19.0. The offline consumer check needs the
exact SDK dependencies in the npm cache. The
[SDK README](../../packages/plugin-sdk/README.md#verify-the-sdk-checkout) records
the preparation commands.

The runner saves logs and before/after source hashes in a fresh OS temporary
directory. `-- --output <new-directory-outside-checkout>` selects another new
directory with an existing parent. It refuses existing output and locations
inside the checkout, including aliases through a symlinked parent.

Nine suites run sequentially: public SDK contracts, Node authoring, native view
authoring, portable paths, resource admission, archive limits, exclusive archive
publication, the clean SDK consumer and the verifier's own refusal paths. The
consumer executes the real installed CLI and strict NodeNext compiler. npm is
invoked through its JavaScript entry using the selected Node runtime, avoiding
Windows command-shim shell execution.

A failed or timed-out suite, changed source, inconsistent built SDK version, or
invalid artifact layout fails verification. Only complete success produces a
candidate SDK tarball. The report records its exact bytes, checksum, public files,
app/SDK/API versions and runtime. On failure, the final candidate directory is
removed while logs and the failed report remain. Suite-owned disposable fixtures
can contain intermediate archives; they are not approved candidates.

The command never starts Electron, installs an extension into the user's profile,
publishes a package, builds an installer or certifies a release. Reports always
keep `releaseReady: false`.

## Workflow

`.github/workflows/plugin-sdk-validation.yml` runs the same command for pull
requests, pushes to main/release branches and manual dispatch. Its six jobs cover
Ubuntu, Windows and macOS with exact Node 20.19.0 and 24.22.2. Dependency setup
first uses the newer runtime, then switches to the matrix runtime for checks.
Each job retains reports/logs and any successful candidate for 14 days.

Actions are pinned to resolved full commit SHAs. Permissions are read-only,
checkout credentials are not retained, and there is no registry publish or
installer step. Matrix failures do not cancel sibling jobs. The aggregate
`SDK validation` job requires the entire matrix to succeed; a failed, skipped or
cancelled matrix cannot produce a successful aggregate. See GitHub's
[workflow contexts](https://docs.github.com/en/actions/reference/workflows-and-actions/contexts)
and [dependency pinning guidance](https://docs.github.com/en/actions/how-tos/secure-your-work/lock-workflow-dependencies).

The workflow is local and uncommitted. It has not been pushed, dispatched or
executed on GitHub. No branch-protection setting was changed. Its aggregate
check is available for a future maintainer decision about required checks;
this document does not claim that such protection is configured.

## Verification on 2026-11-17

| Runtime | Platform | SDK suites | Source changes |
| --- | --- | ---: | --- |
| Node 20.19.0 | macOS arm64 | 9 PASS | None |
| Node 24.22.2 | macOS arm64 | 9 PASS | None |

Both exact runtimes came from official Node archives verified against their
published SHA-256 lists. Both runs used the same 1,033-file SDK source snapshot,
including workflow, scripts, tests, manifests, SDK README and license. Each clean
consumer passed 18 checks. Their candidate archives contain the same 10 public
files, measure 99,265 bytes, and have SHA-256
`4139f9afd5211fbd04d8c4ee7186f1069d2942797bf93e6f700c9b1991437219`.
That observed match is not a general promise of hermetic third-party builds.

Real child-program refusal fixtures independently demonstrate that one failed
suite and a source mutation each withhold the candidate. Existing evidence is
preserved when output is reused. Workflow syntax/context validation passed with
actionlint 1.7.12; optional ShellCheck/Pyflakes integrations were disabled.
Structure and whitespace checks passed.

The initial sandboxed Node 24.16.0 run retained an npm cache permission failure
and no candidate. Repeating with the cache accessible passed all nine suites.
That earlier successful run preceded the SDK README instructions; the two exact
runtime runs above verify the final README as well. No cache ownership or global
tool installation was changed.

Raw reports and checksums are linked from
`plugin-validation.json.extensionSdkValidation` and
`/var/folders/_j/d8w7d_sn23348hmv9trrjm480000gn/T/clipcraft-extension-services-final-dvnykh61/verification.json`.
The root manifest adds only the `sdk:verify` script relative to the previous
checkpoint; SDK manifests and both lockfiles are unchanged. The new verifier
suite adds one discovered suite beyond the earlier whole-app inventory. The full
application battery was not rerun in this stage.

## Remaining acceptance

> The remote matrix has since run and passed, after two Windows-only failures
> were fixed; see [remote acceptance](plugin-remote-acceptance.md). The text
> below is the record as of 2026-11-17.

Remote matrix execution and any required-check configuration remain pending.
Installed Windows/Linux/macOS release artifacts, complete abuse/distribution
acceptance, hardware/performance budgets and remaining manual/assistive-technology
checks remain separate. The previous Windows caption prerequisite, original
sibling asset manifest and live SFXMint HTTP 429 failure retain their statuses.
No additional SFXMint request was made during this work. Release automation is
only partially addressed by this SDK workflow; publication and installer
automation remain open.
