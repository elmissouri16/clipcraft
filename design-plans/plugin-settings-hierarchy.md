# Give Plugins settings a coherent task hierarchy

Written against: `331642623c32550de27d1c7075201f575177d63a`, with the current
uncommitted plugin worktree, 2026-11-16.

Status: accepted by the user, implemented and verified in the real app.
The original audit below is retained as the before-state evidence.
The user selected the Plugins settings hierarchy and design-system conformance
as the next issue. The task organization below is a recommendation for acceptance,
not an existing requirement invented on behalf of the design-system document.

## Design language

- Audited surface: Settings → Plugins, composed by
  `src/app/components/SettingsDialog.jsx:492` and
  `src/features/plugins/components/PluginSettings.jsx`.
- Design sources: the **applied v14** section of
  `docs/design/DESIGN-SYSTEM.md:3–61`, the resolved v14 stylesheet, and
  `src/app/components/SettingsLayout.jsx`. The older proposed component specs in
  the same document do not override v14. The existing media-browser plan's v13
  references do not govern this new work.
- Documented decisions: flat desktop surfaces; existing well/card/option/thumbnail
  families; section labels at 10.5px/700 with the existing tracking and casing;
  neutral segmented navigation; soft violet selected options; existing control
  heights, spacing and radius tokens.
- Governing owners and consumers: `SettingsDialog` owns the page shell;
  `SettingsPage` owns its title/body; `SettingsGroup` owns labelled content groups.
  `PluginSettings` composes inventory, browser, creation, dependencies, development
  and selected-plugin controls. `styles.css` resolves their presentation.
- Explicit exceptions: None documented for the Plugins settings surface.
- Evidence limit: this audit uses current source and the user's direct report
  that the hierarchy/design is incoherent. No new app session, tests or visual
  inspection were run during this audit. Runtime visual acceptance is outstanding.

## Findings

| # | Problem | Evidence | Proposed change | Scope | Confidence |
| --- | --- | --- | --- | --- | --- |
| 1 | New settings sections bypass the shared group hierarchy and spacing owner. | Contract: `SettingsLayout.jsx:3–4,14–23` specifies small labelled groups; v14 specifies two label tiers (`DESIGN-SYSTEM.md:53–56`). Runtime chain: `SettingsDialog.jsx:492` → `PluginSettings.jsx:28–53` → bare `h3` headings in `PluginPackBrowser.jsx:15`, `PluginStorageCleanup.jsx:7`, and `PluginProjectDependencies.jsx:28`. These headings inherit `.modal h3` at 17px (`styles.css:538`), exceeding the actual page heading's 15px (`styles.css:2463`). The outer `.plugin-settings` block also places all these children beneath the single direct child of the page body's flex/gap owner (`styles.css:2465`), without its own layout rhythm. | Compose the active view with `SettingsGroup` headings and an explicit column using the existing 10px page-body gap; remove competing bare subsection titles and reset margins through that owner. | Plugin settings composition and its local section headings. | High |
| 2 | Pack-content options define a separate box style and omit the documented selected-option presentation. | Contract: v14 requires new UI to join the four shared patterns and selectable text options to use `--primary-soft`/`--accent-text` without a visible border (`DESIGN-SYSTEM.md:34–38,45–52`; `styles.css:2707–2757`). Runtime: `PluginSettings.jsx:47` mounts `PluginPackBrowser`; its text rows (`PluginPackBrowser.jsx:19–21`) have their own bordered `.plugin-browser-item` style (`styles.css:3171–3173`). The preview button updates `aria-pressed` but receives no selected modifier or matching pressed-state rule. Existing `.lib-row.on` already has the required visual state. The text row is not a thumbnail exception. | Join pack-content rows to the existing standalone-option and selected-option families, deriving their selected modifier from the same preview identity as the existing pressed state; keep favorite state separate. | Pack-content row presentation and scoped v14 selectors. | High |

## Improve first

Correct finding 1 first. The same page currently stacks inventory, content
browsing, maintenance, creation, project dependencies and development before the
selected-plugin details (`PluginSettings.jsx:29–76`). Selecting a package then
scrolls to those remote details (`:21`). This order and the user's hierarchy
complaint justify reorganizing the surface before polishing individual controls.
The exact number/names of task views below are a design proposal, not a v14 rule.

## Evidence chain

- Surface: Settings → Plugins in the existing settings sheet, on both home and
  editor paths that render `SettingsDialog`.
- Problem: successive feature panels form one document with inconsistent heading
  ranks; selected-plugin controls occur after unrelated global sections.
- Design evidence: applied v14 plus the shared Settings page/group owners above.
- Owner: `PluginSettings.jsx`, retaining `SettingsDialog` and `SettingsLayout` as
  the shell owners. Backend plugin services remain the capability owners.
- Scope and affected surfaces: installed-package list/details, enabled-pack
  content browser/previews, native creative-pack authoring, developer sessions,
  project pack status and plugin maintenance within this settings sheet.
- Uncertainty: the proposed task organization requires acceptance. Rendered
  behavior at compact sizes and lifecycle behavior while switching views need
  real-app validation. Do not claim those checks passed from this plan.

## Design decision

Keep one Plugins settings page inside the current sheet, with one title and a
compact neutral view selector. Give each view one purpose:

| View | Purpose | Primary contents |
| --- | --- | --- |
| **Installed** (default) | Manage packages already on this computer | Inventory, Install package, selected-package details, contextual controls; compact current-project pack status. |
| **Pack content** | Find and preview content in enabled installed packs | Search, type/tag/favorite filters, results and the selected preview/Apply controls. This is not an online marketplace. |
| **Create & develop** | Author packs or test an SDK project | Native Create pack entry; a separate Developer mode disclosure for folder installation, development sessions, reload/watch, author previews and provider/export tests. |

Native pack creation stays available without enabling Developer mode. Developer
mode gates code-authoring tools only. Storage review and inventory recovery live
under a collapsed **Maintenance** disclosure in Installed. Do not put them in the
normal install action row or display their explanations before inventory.

Within Installed:

1. Use the installed group's existing `SettingsGroup.aside` slot for its
   **Install package** action. The shared page header stays unchanged.
2. Render compact package rows with name, version, short publisher metadata and
   status. Keep the selected package's details immediately after its row, using
   the inline-disclosure composition in `ServiceConnections.jsx:98–106` as the
   exemplar. Do not jump past global browser/developer sections to reach details.
3. Give those details distinct content groups: overview; applicable commands;
   local-tool/model setup when declared; advanced package data. Preserve package
   identity, publisher trust labels and permissions needed for meaningful consent.
4. Put full fingerprints, compatibility diagnostics, licence bodies, preference
   copying/reset and removal controls under appropriately labelled secondary
   disclosures. Existing error/removal/recovery states stay visibly summarized;
   they must not disappear inside an anonymous advanced drawer.
5. Show current-project dependency status compactly after inventory. Missing or
   invalid required packs remain visible without expanding the full replacement
   and exact-version recovery controls. Keep replacement scope and Undo behavior.

Within Pack content, retain the existing search-first flow and actual sample
previews. Use the shared heading hierarchy and v14 option styling. Preview
selection and favorites must remain distinguishable. Preserve filtering, tags,
pagination, declared preview parameters and compatibility-aware Apply behavior.

Within Create & develop, expose one clear native pack creation entry. Developer
sessions use compact labelled groups for session status/actions, the applicable
preview/test workbench, and a collapsed log disclosure. Keep active jobs and errors
visible. Model hashes/tool paths belong in technical details, while setup status,
model size and actions stay readable. Native permission dialogs must retain all
their existing exact destination, executable and integrity information.

## Reuse

- `SettingsPage`, `SettingsGroup`, `SettingsGroup.aside`, `.set2-group-label`,
  `.set2-group-hint`, `.set2-note` and the existing group/page rhythm.
- Existing `.seg-tabs` for view selection, with v14's neutral selected thumb.
- Existing `SearchBox` if search presentation is consolidated. Its current
  settings consumer is `ServiceConnections.jsx:94`.
- V14 well/card/option selectors and `.lib-row.on` as the selected-option exemplar.
- Existing native `<details>/<summary>` disclosure behavior; no new menu library.
- Existing controls, callback props, typed inputs, transient-key handling and
  native review flows in the plugin components.
- No new shared primitive is justified. Any small view-composition helpers stay
  local to `src/features/plugins/components/`.

## Changes

1. `src/features/plugins/components/PluginSettings.jsx`
   - Change: own the task view and existing developer flag; compose only the
     intended view visually. Move selected-package details beside their package
     row. Put maintenance in its own disclosure.
   - Preserve: inventory refresh, selected exact fingerprint, error diagnosis,
     enable/disable, removal confirmations/retries, recovery and settings props.
   - Verify: switching views never silently installs, enables, deletes, resets
     data, changes the project or substitutes a selected package version.

2. `PluginPackBrowser.jsx`, `PluginStorageCleanup.jsx`,
   `PluginProjectDependencies.jsx`, `PluginDevelopment.jsx`, `PluginLocalTools.jsx`
   and `PluginServiceAuthoring.jsx` in the same directory
   - Change: use the shared heading/group owners; render secondary diagnostics and
     maintenance/log information through the defined disclosures. Remove duplicate
     page-style headings and default heading/paragraph margin accumulation.
   - Preserve: all existing capability controls and ownership boundaries. This
     is a presentation change, not an SDK/runtime redesign.
   - Verify: populated/empty/error/retained/disabled/tampered/removing states;
     provider-only, preset-only and local-tool-only package/session content.

3. View and selection lifetime
   - Change: make visual navigation independent from the active host job lifetime.
   - Preserve: hiding a task view must not unmount an active workbench and
     accidentally cancel or reset it. `PluginServiceAuthoring` cancels its test on
     unmount, and `PluginCommands` cancels owned manual work on unmount; account
     for those actual cleanup paths. Keep a busy workspace mounted while hidden
     and display its running status in the task selector. Closing Settings still
     follows the existing explicit owner/cleanup semantics.
   - Verify: view changes during provider requests, preset rendering, local model
     setup, local transcription and command execution retain truthful progress
     and completion. Explicit Cancel and generation/package revocation still work.

4. `src/styles/styles.css`
   - Change: give the Plugins composition the existing 10px column rhythm; join
     new option/control-group classes to the v14 families. Scope local responsive
     layout to the plugin surface. Remove replaced one-off box/heading rules.
   - Preserve: the settings sheet, rail, font, surfaces, flat controls, token
     heights/radii, dialog/menu identity and other settings pages.
   - Verify: no text option uses a thumbnail border treatment; the selected preview
     is visibly violet-soft; headings and controls fit their containing group.

5. `shared/i18n/en.json`, `fr.json`, `es.json`
   - Change: add the accepted navigation and disclosure labels; shorten default
     guidance to the action at hand. Keep detailed approval explanations at the
     point where the relevant capability is used.
   - Preserve: accurate installed/enabled/retained/missing states and security
     consent wording. Do not imply an online catalogue exists.
   - Verify: all three dictionaries remain in sync and long labels wrap cleanly.

6. Existing `tests/smoke/smoke-plugin-*.cjs` workflows and corresponding UI runners
   - Change: navigate the accepted task views/disclosures before their actions.
     Assert that the intended action is visible, not merely findable in hidden DOM.
   - Preserve: behavioral assertions, native consent/refusal, actual render/media
     verification, failure diagnosis, revocation and saved-project/Undo checks.
     Do not weaken them merely because their previous selectors assumed one page.

## Scope

- Inherit: the Plugins settings page wherever `SettingsDialog` is opened.
- Verify: existing commands, panels, rendering author previews, temporary provider
  and preset tests, local models/tools, native pack creation, dependency recovery,
  preference copying and cache/inventory maintenance remain reachable and correct.
- Exclude: editor dock/layout redesign, unrelated settings pages, marketplace or
  download feeds, runtime/API contracts, permission changes, installer builds,
  publication, pushes and version changes.

## Validation

- Product: install → select → inspect/configure → enable/disable → remove; browse
  enabled content → preview → Apply/Undo; create a pack; start/reload/watch/end a
  developer session; run temporary provider/preset tests and a local speech job.
- Interface: zero packages; representative mixed packages; unavailable/tampered
  package; pending removal; missing project dependency; long names/versions/paths;
  compact and wide supported settings-sheet sizes; all three UI languages.
  Check the actual rendered page before claiming visual quality.
- System: confirm `SettingsPage`/`SettingsGroup`, existing navigation and v14
  option families own the new surface. No parallel typography/radius system,
  gratuitous cards or expanded technical dumps on the default page.
- Repository, after implementation:
  - `npm run test:structure` → imports and runtime structure pass.
  - `node tests/unit/system/test-i18n-coverage.cjs` and
    `node tests/unit/system/test-i18n.mjs` → both pass.
  - `FVE_SMOKE_QUIET=1 node scripts/test.cjs plugins/test-plugin-ui
    plugins/test-plugin-usability-ui plugins/test-plugin-development-ui
    plugins/test-plugin-content-packs-ui plugins/test-plugin-authoring-ui
    plugins/test-plugin-local-tools-ui plugins/test-plugin-recovery-ui
    plugins/test-plugin-removal-ui` → existing native flows pass through visible
    task navigation. Include updated pack-creation and dependency/preference paths
    in the usability workflow.
  - `node node_modules/vite/bin/vite.js build` → renderer compiles; no installer.
  - `git diff --check` → no whitespace errors.
  These are future executor checks, not audit results.

## Stop conditions

- Stop if the proposed task views are not accepted; choose the hierarchy before
  changing controls piecemeal. The verified group/option violations remain valid.
- Stop if navigation would require new backend state or change job/permission
  semantics rather than preserve the existing owners.
- Stop if an ongoing job would become inaccessible, falsely canceled or reported
  as completed solely because its view changed.
- Stop if a source change since this audit invalidates the cited owner or current
  uncommitted work; refresh the affected evidence first.

## Design documentation

After acceptance and real-app validation, record the Plugins task organization
and disclosure rules in `docs/design/plugin-system.md` and the v14 settings usage
guidance in `docs/design/DESIGN-SYSTEM.md`. Keep those decisions separate from SDK
feature completion and release certification. Do not edit those documents during
this audit.


## Implementation record — 2026-11-16

Implemented the accepted Installed / Pack content / Create & develop organization.
Selected-package controls now follow their own inventory row. Maintenance, licence
bodies, fingerprints, model checksums and development logs use secondary
disclosures. Shared Settings groups own section typography and spacing; pack rows
join the v14 selected-option family. Task navigation stays visible while scrolling.
Empty states omit unused filters and empty project-pack panels. Permanent compiled
folder installation is labelled separately from temporary development sessions.

Hidden task views remain mounted. The native tests hold actual provider requests,
model-setup consent and transcription reviews across view changes, verifying
progress and truthful completion; explicit revocation still prevents late output.

Final selected regression: 94 PASS / 0 FAIL, with unchanged implementation hashes.
The native design suite passed 20 checks in each of English, French and Spanish,
including actual 1440/1280/1000-pixel window widths, long metadata, heading hierarchy,
selected-option styles, creation and maintenance reachability. Captures were
inspected. Renderer build, localization, smoke syntax, structure and whitespace
checks passed. Earlier failed fixture assertions are retained with their fixes.

Evidence: `settingsHierarchy` in `docs/design/plugin-validation.json` and
`/tmp/clipcraft-settings-current/verification.json`. This is macOS development
verification; release/platform/native-focus/performance gates are separate.
Versions remain app 2.0.0 / SDK 0.8.0; no installer, commit, push or publication.

## Preview refinement — 2026-11-16

The follow-up replaces the old enlarged 320×180 block sample with adaptive,
original ClipCraft landscape artwork and a shared preview workspace. Results stay
beside the selected item; compact filters and an inline Apply action reduce the
vertical stack. Original/result comparison, transition A/B thumbnails, synchronized
transport, editable parameter readouts and Reset use the v14 control families.
Sound playback uses the shared transport. The developer workbench shares these
controls and pauses its sample when its task view is hidden.

Rendering resources are prepared independently of seeking, playback and parameter
updates. Paused previews draw on demand; playback limits automatic redraws to
24 fps and buffer size to 1280×720. Hidden views stop their sample work. Project
media, saved parameters, Apply/Undo, installed-package ownership and SDK versions
retain their existing contracts. Exact verification is recorded under
`previewWorkspace` in `docs/design/plugin-validation.json` after the frozen run.

Final preview regression: 94 PASS / 0 FAIL. The native preview workflow passed
67 checks plus 6 restart checks; the settings design suite passed 23 checks in
each of English, French and Spanish. Adaptive sample resources stayed unchanged
during parameter edits and seeks; hidden samples stopped, the transport retained
paused time, and native sound playback/seek/pause used the shared controls.
Captures were inspected. The 919 implementation/test inputs matched their frozen
hashes after the complete selected run. Renderer compilation, structure and
whitespace checks passed. See `previewWorkspace` for exact logs, measurements,
retained earlier failures, screenshots and platform limits. No version bump.
