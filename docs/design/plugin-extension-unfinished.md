# Unfinished extension acceptance

> Updated 2026-11-18: the remote SDK matrix, Windows SDK coverage and
> installed-app acceptance on Linux, Windows and both macOS architectures have
> since run and passed; see [remote acceptance](plugin-remote-acceptance.md).
> The table below is the earlier record, annotated with what changed.

The maintainer resumed work with the instruction to skip blocked items, leave
them unfinished in the report, and continue the rest. These items are excluded
from the current local implementation pass; they are not passed or waived.
App 2.0.0, SDK 0.8.0 and host API 1 remain unchanged. Production/SDK v1 readiness
is still unproven.

| Unfinished gate | Missing prerequisite or constraint |
| --- | --- |
| Original bundled-content fixture | The original sibling `asset-pack/library-manifest.json` is unavailable. No replacement is invented. |
| Windows and installed OS/architecture matrix | **Run 2026-11-18.** SDK matrix and installed-app acceptance pass on GitHub-hosted Linux x64, Windows x64, macOS arm64 and macOS x64. The native plugin UI suites still run only on the macOS development build. |
| Complete packaged application/ASAR and native-media release layout | **Run 2026-11-18.** Installed release-configuration builds pass 29 checks per platform, including packaged ffprobe/ffmpeg and a real export. Extension installation inside the installed app is not exercised. |
| Remote CI and required checks | **Run 2026-11-18** after the maintainer authorized the push. Branch-protection required checks are a repository setting and remain unset. |
| Installer/publication acceptance | Installers are built and verified in CI only and discarded. A gated draft-release workflow exists but has not run. Signing, notarization, SDK publication, version bump and public release remain unauthorized. |
| Live SFXMint retest | **Closed 2026-11-18.** The 429 was a policy change (keyless downloads ended), not throttling. SFXMint was withdrawn as a source at the maintainer's direction; the live library suite passes. |
| Hardware/performance acceptance | Maintainer-approved hardware, workloads/concurrency and latency/CPU/memory budgets are pending. Existing observations do not establish thresholds. |
| Remaining manual/assistive-technology and live-service acceptance | Scripted/native fixtures do not certify these interactions or real-provider quality. |
| Historical export timeout attribution | Its original trace is insufficient to prove the exact cause. The separately reproduced FIFO race is fixed; that does not identify the old timeout. |
| Complete cross-platform abuse/distribution acceptance | Local hardening and fault checks do not replace the unavailable installed/platform matrix. |

The unblocked local followup is complete for the concrete package/recovery
resource and native-media path findings identified during this resumed pass.
Failures remain retained alongside their corrections. The preceding
[self-contained archived worker/view check](plugin-extension-asar-views.md)
and [fresh-cache SDK checks](plugin-sdk-cache-followup.md) remain scoped evidence.

Local progress: [recovery enumeration bounds](plugin-extension-recovery-bounds.md)
fix two eager directory reads and retain standalone/native failure and success
evidence. [Native-media layout verification](plugin-extension-native-media-paths.md)
now fixes and verifies a reproduced archive-path rewrite bug.
[Preview/preference read bounds](plugin-extension-storage-bounds.md) also cover
cache accounting, retained panel data and favorites. The final frozen local
plugin selection passed 112 suites. All gates in the table above remain unfinished;
this local result is not production or SDK v1 approval.
