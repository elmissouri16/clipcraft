# Fresh-cache SDK verification

App 2.0.0, SDK 0.8.0 and host API 1 remain unchanged. This follows
[SDK validation](plugin-sdk-validation.md). It fixes a preparation gap exposed
by a fresh Linux dependency install and reconciles current author documentation.
SDK v1 and production acceptance remain open.

## Failure and correction

The initial nonroot Linux arm64 run installed root and SDK lockfile dependencies
into an empty npm cache. Both Node 20.19.0 and 24.22.2 then passed eight SDK suites
but failed the clean-consumer suite with `ENOTCACHED` for `@types/node` metadata.
Neither run produced an approved candidate archive. Their raw reports remain
unchanged.

`npm ci` can cache the archives named by a lockfile without fetching the registry
metadata needed by a new consumer's dependency resolution. The preexisting Mac
cache hid that prerequisite. The workflow's SDK lockfile install alone was
therefore insufficient preparation for `npm install --offline`.

`npm run sdk:cache` now explicitly builds and packs the SDK, then performs an
online install into a disposable consumer. This prepares registry metadata and
archives without changing checkout manifests/locks or publishing. Its temporary
directory retains install logs and a result receipt. CI runs it before switching
to the matrix Node runtime. The [SDK README](../../packages/plugin-sdk/README.md#verify-the-sdk-checkout)
includes the same preparation step.

The subsequent clean-consumer test still uses `--offline`. There is no automatic
online fallback, waived error or relaxed assertion in that test. Preparation
failure exits nonzero and prevents the CI validation step.

## Final verification

| Platform | Node | SDK suites | Clean-consumer checks |
| --- | --- | ---: | ---: |
| macOS arm64 | 20.19.0 | 9 PASS | 18 PASS |
| macOS arm64 | 24.22.2 | 9 PASS | 18 PASS |
| Linux arm64 | 20.19.0 | 9 PASS | 18 PASS |
| Linux arm64 | 24.22.2 | 9 PASS | 18 PASS |

All four runs used the same 1,034-file source manifest and reported no source
changes. Each candidate has 10 public files, measures 99,423 bytes and has SHA-256
`73e09aacd0a698d35d5a823c53bbb5f82d8a53108e1dd6e3763d56f69540af2e`.
This is an observed match for these inputs, not a general hermetic-build guarantee.
Structure, whitespace and actionlint checks passed.

Linux ran as UID 1000 in a disposable container using an existing pinned image,
with all capabilities dropped, no new privileges, no host mounts and no published
ports. Official Node archives were checksum-verified before use. The initial
stopped container was deliberately reused after preserving its failed reports;
the corrected run retained its own separate evidence directory. Existing downloaded
dependencies were reused; lockfile installation was repeated and the new cache
preparation completed before both corrected checks. The container was removed
after receipt/archive verification; its image and unrelated containers were left
alone. A cleanup-receipt case-sensitivity error and its verified correction are
retained. No Electron UI or installer was run in this SDK-only profile.

The author guide now separates current Node APIs from the historical recipe
design. The old remaining-capabilities document is labeled historical. Contributor
links point to current development sessions and ordinary Node examples. The jobs
guide now describes existing editor activity/cancellation and its visibility
conditions. These documentation changes add no runtime capability.

Evidence: `plugin-validation.json.extensionSdkFreshCache` and
`/tmp/clipcraft-linux-sdk-validation-uxy8zv6a/verification.json`.

## Remaining acceptance

These are local development checks on arm64, not GitHub-hosted matrix execution,
Windows or installed-release acceptance. No required-check setting, installer,
publication, version increment, commit or push was produced. The original sibling
asset manifest, Windows prerequisite, prior SFXMint HTTP 429, hardware/performance
budgets, remaining manual/assistive-technology and complete abuse/distribution
acceptance retain their open statuses. No new SFXMint request was made.
