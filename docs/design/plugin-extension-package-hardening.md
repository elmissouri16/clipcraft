# Package admission and live-library followup

> Later creative intake, output frame-rate and macOS/Linux verification are
> recorded in the [platform followup](plugin-extension-platform-followup.md).

This followup continues the pre-v1 general Node extension plan. App 2.0.0,
SDK 0.8.0, host API 1 and example versions remain unchanged. The previous
[stabilization checkpoint](plugin-extension-stabilization.md) and its raw failures
remain historical evidence; this report records later changes.

## Portable Node payloads

The shared SDK/native validator rejects case-colliding file names and directory
spellings, file/directory conflicts, trailing-dot components and Windows reserved
device components. It checks implied directories in either input order, before
SDK publication, native install staging or development materialization. Consistent
mixed-case names remain valid; no path is silently renamed or normalized. These
restrictions follow the supported-filesystem goal and Microsoft's
[file/path naming rules](https://learn.microsoft.com/en-us/windows/win32/fileio/naming-a-file).

Node authoring buffers now enforce the same 4,096-file and 32 MiB per-file bounds
as native intake, alongside the existing manifest, creative asset and 128 MiB
total limits. Valid package fingerprints keep their existing algorithm.
Historical creative package bytes and fingerprint rules are unchanged. A Node
package with an ambiguous layout must be rebuilt before cross-platform sharing;
there is no silent same-version payload rewrite.

The regression builds original raw tar headers so a packaging library cannot
normalize the adversarial paths first. It covers case aliases in files and
implied directories, conflicting prefixes in either order, traversal, absolute
paths, backslashes, exact duplicates, links, reserved names, per-file/count bounds,
valid folder/archive fingerprint parity, clean SDK consumption and unchanged
inventory/staging after refusal. It also checks a golden historical fingerprint.

The native Settings workflow rejects an ambiguous archive visibly with no
installed row, activation or trust prompt, then completes the normal valid
install/trust/edit/Undo/stop workflow. The selected SDK/native regression passed
11 suites: `/var/folders/_j/d8w7d_sn23348hmv9trrjm480000gn/T/clipcraft-tests-Nhoa2u/results.json`. This precedes the later all-file bounded-read
change described below; the final candidate's full run covers that source.

## Bounded reads beyond the manifest

The descriptor reader now also bounds Node assets, historical content and the
compressed archive source. Regular-file, size and identity checks precede reads;
no package payload is read through an unbounded readFile call. It grows a scratch
buffer only up to the applicable bound plus one detection byte and retains only
the captured bytes. Folder totals count actual captured lengths, including growth
after metadata checks, and limit the next read by the remaining total budget.

Tests simulate an asset growing after descriptor stat and prove the reader stops
at 32 MiB plus one byte. A compressed source growing between lstat/open rejects
before decompression. Manifest admission still tests growth, strict UTF-8, links,
non-files and small retained buffers. These specific races are covered; this is
not a claim to sandbox arbitrary concurrent directory replacement or trusted
Node execution.

## Live library failure disposition

The live zero-music result was isolated with four bounded anonymous API requests.
Openverse returned HTTP 200 with zero matches for CC0 music named “happy,” both
with and without the category filter. Explicitly allowing CC BY returned
240 matches, with 20 records on the first page, all marked BY.
Raw query/response metadata: `/var/folders/_j/d8w7d_sn23348hmv9trrjm480000gn/T/clipcraft-live-music-diagnostic-4ynuyc/result.json`. The
[Openverse API schema](https://api.openverse.org/v1/schema/) documents the license,
source/category and attribution fields used here.

The app's selected-license behavior is unchanged. The live test now checks that
default results remain CC0, and uses an explicitly attribution-enabled request
for positive music acceptance. A deterministic test proves an empty CC0 query
never triggers a broader fallback and that only an explicit attribution choice
admits BY. The existing real UI also checks empty-filter explanation, deliberate
attribution opt-in, retained queries and preserved publication credits.

After that correction, the live workflow reached a real paging defect: current
MyInstants pages use an infinite-scroll loading sentinel without rel=next. The
parser now recognizes both formats when results are present, stops on empty/404
pages, and never advertises beyond its existing page-50 cap. Tests retain query,
distinct page results and the unknown-license label. Source pages were inspected
read-only; original minimal fixtures contain no copied page scripts/assets.

The complete live library/search/download workflow and both deterministic
library suites passed: `/var/folders/_j/d8w7d_sn23348hmv9trrjm480000gn/T/clipcraft-tests-evOMqT/results.json`. The real Audio UI passed three new pagination
checks within its full Openverse/import/credits workflow, using original local
page records at the network edge and the actual IPC/parser/UI:
`/var/folders/_j/d8w7d_sn23348hmv9trrjm480000gn/T/clipcraft-openverse-ui-c2b3xC/result.json`. It appends distinct results, preserves the query, retains unknown
rights and removes Load more at the terminal page. No third-party media is added
to the checkout and no license fallback or source host expansion was introduced.

## Candidate evidence and remaining gates

Final source hashes, whole-app results, focused/native results, version checks
and performance observations are recorded under
`plugin-validation.json.extensionHostPackageHardening`. Earlier failed runs stay
recorded rather than being relabeled successful.

The original sibling asset manifest and Windows caption platform prerequisites
remain unavailable locally. Windows/Linux and installed-release acceptance,
full archive/abuse acceptance, long-session memory/hardware budgets, manual UX
and release automation/distribution remain open. No installer, commit, push,
SDK publication or version bump follows from these checks.

## Final macOS full candidate

The frozen full application battery contains 332 suites: 329 raw PASS, 3 FAIL
and no timeouts. Two raw PASS entries are opt-in whole-suite skips, so classified
counts are 327 PASS / 3 FAIL / 2 SKIP. The optional Darija subcase remains absent;
its English caption control still ran. The raw full run is retained at
`/var/folders/_j/d8w7d_sn23348hmv9trrjm480000gn/T/clipcraft-tests-5CMUCN/results.json`.

Windows captions failed on the unavailable Windows APPDATA prerequisite, and the
asset suite failed on the missing original sibling manifest. The third failure
was native clipboard focus under inherited quiet/accessory activation. Its
suite now explicitly uses the required activatable-app profile; the entire
native workflow passes even when the outer runner requests quiet mode, with the
focus and clipboard assertions intact. That one test profile is the only source
delta after the full run; product source is unchanged. The successful focused
result is `/var/folders/_j/d8w7d_sn23348hmv9trrjm480000gn/T/clipcraft-tests-VDGccW/results.json`.

The same full candidate passed native ASAR worker launch, lifecycle/storage,
package intake and all plugin workflows. A fresh warm synthetic discovery run
with bounded payload reads recorded list 26.11 ms,
parallel catalogs 26.48 ms and target bundle 1.18 ms medians.
Raw evidence: `/var/folders/_j/d8w7d_sn23348hmv9trrjm480000gn/T/clipcraft-discovery-measurement-kIl9QY/result.json`. These are observations, not release budgets.
