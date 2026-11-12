# Find stock images and audio in a compact, search-first browser

Written against: `f77af95`, plus the existing uncommitted Openverse integration.
Status: implemented and verified in the real app; changes remain uncommitted.

## Evidence chain

- Surface: Media > Stock and Audio in the existing editor side panel.
- User evidence: the user reported poor UX in both menus, had just asked why music
  appeared to disappear, and accepted a compact-panel direction with search first,
  distinct local/online sections and secondary filters.
- Current owners:
  - `src/features/library/components/LeftPanel.jsx`, `MediaTab`: source switch,
    media-kind switch and category chips precede the stock browser.
  - `src/features/library/components/StockLibrary.jsx`: provider, copyright licence,
    provider guidance, heading and orientation precede its search and results.
  - `LeftPanel.jsx`, `AudioTab`: Music, Sound FX, Soundza, Trolls, Your audio,
    Favorites, Text to speech and Credits share one navigation row. Pack collections
    and online genre searches share another row under Music and Sound FX.
  - `src/features/audio/components/AudioLibrary.jsx`, `OnlineSearch`: an initially
    CC0-only licence selector precedes search; empty results say only that nothing
    was found. `PackMusic.jsx` owns browsing the installed audio collections.
- Governing design evidence: the applied v13 section at the start of
  `docs/design/DESIGN-SYSTEM.md` and the final v13 layer of `src/styles/styles.css`;
  `docs/design/editor-usability.md` requires library controls to fit the available
  width in Edit and Agent. Older proposed portions of the design-system document
  do not override the applied rules.
- Scope: renderer browser presentation, navigation and query/filter state needed
  to preserve the selected view; existing import, preview and attribution flows.
- Initial uncertainty: the audit was source-based. Subsequent Electron validation
  covered populated and absent packs, responsive browser states and minimum-width
  controls; see the implementation record below.

## Design language

- Keep ClipCraft's navy surfaces, violet accents and Inter typography.
- Reuse the applied control-height and radius tokens. View selectors use the
  raised neutral `.seg-tabs` state; removable filter chips use `.chip` styling.
- Governing owners and consumers: `LeftPanel.jsx` composes the stock and audio
  browsers; their local components render inside that panel in Edit and Agent.
- Explicit exceptions: preserved Home, About, welcome, logo and CraftAI launcher
  brand surfaces, as documented in v13; none applies to the browser redesign.

## Design decision

Keep browsing in the existing side panel. Order the relevant controls as:

1. Panel title and primary source/view navigation.
2. Search beside a Filters button.
3. Compact kind/collection selection where the selected view needs it.
4. A short active-filter summary, followed immediately by results.
5. One compact provider acknowledgement with required independence wording.

Provider, category/genre, copyright licence and image orientation belong in a
collapsed Filters region. Local collections are navigation destinations, not
online-search genres. Keep result actions in predictable places. A larger modal
browser is deferred; do not build a second browsing surface in this change.

## Reuse

- `src/components/ui/SearchBox.jsx`: existing panel search, clear button and focus
  treatment. Wrap it in the existing form submission flow for online requests.
- `src/components/ui/Dropdown.jsx`: existing in-app provider/filter selects.
- `.seg-tabs`, `.btn`, `.icon-btn`, `.chip`, `.lib-list`, `.lib-row`, `.stock-grid`
  and existing tokens in `src/styles/styles.css`.
- `PackMusic.jsx`: installed audio browsing, playback, search and placement.
- `AudioLibrary.jsx`: shared preview player, audio rows and provider-specific views.
- `StockLibrary.jsx` and `MediaFavorites.jsx`: thumbnails, favorites and stock
  placement controls.
- `OpenverseNotice.jsx`, `MediaCredits.jsx` and `credits.js`: acknowledgement and
  publication credits, without duplicating their ownership.
- Exemplar: `PackMusic.jsx` already uses `SearchBox` above its result list;
  `LeftPanel.jsx`'s Media source selector demonstrates the existing view treatment.
- A browser-local filter disclosure may be added under
  `src/features/library/components/` if the existing controls cannot compose it
  cleanly. Share it only between these browser consumers; do not introduce a
  general application-wide menu framework or a dependency.

## Changes

### 1. Media > Stock

Owner: `src/features/library/components/LeftPanel.jsx` and `StockLibrary.jsx`.

- Retain This project / Favorites / Stock as the Media source selector.
- In Stock, show the search/Filters row directly after that selector. Keep Videos
  / Photos as a compact kind switch immediately below search. Remove the always
  expanded category-chip row from `MediaTab`; show those categories in Filters.
- Filters contains Provider, Category, and supported Orientation/Copyright
  attribution choices. Hide controls unsupported by the selected provider/kind.
- Preserve the existing Openverse photo default and Pixabay video provider.
  The provider selector remains available even when the selected provider needs
  a key; users must be able to leave its setup state.
- Use contextual placeholders: Search stock photos / Search stock videos.
- Show the selected provider and active filter summary outside the disclosure,
  without repeating a second title and a long guidance paragraph above results.
- Consolidate duplicate Openverse notices into one compact visible acknowledgement
  near the results. Preserve the independence statement and source-check guidance.
- Verify: users can search photos, switch to videos, change provider and add media
  to either main or overlay without navigating through stacked configuration rows.

### 2. Audio navigation and local music discovery

Owner: `LeftPanel.jsx`, `AudioLibrary.jsx` and `PackMusic.jsx`.

- Replace the mixed source row with Library / Online / This project / Favorites.
  These are destinations, not content types or service brands.
- Library contains the installed Music and Sound effects collections. Give those
  content types a compact selector and display the existing collection names
  separately from the search field. Do not mix collection names with online genres.
- Online has a content-kind selector: Music / Sound effects / Memes. Present
  Soundza as a provider within online Sound effects, rather than a parallel kind.
  Label the existing combined SFXMint/Openverse source clearly; do not add a new
  provider aggregation operation or silently require a Soundza key.
- This project continues to show imported and generated audio, with import and
  recording actions. Do not invent music/SFX classifications for imported files.
- Keep Text to speech and Credits as named header actions outside the browsing
  source selector. Both remain directly reachable; neither becomes a media source.
- On first entry, open Library when an installed Music collection exists; otherwise
  open Online Music. Retain the chosen destination during the mounted editor
  session. An asynchronous pack load must not redirect a user who already made
  a choice. Loading, missing-pack and empty-collection states must be distinct.
- Preserve every existing collection, original name, file, favorite and action.
  Keep a mapping from existing section IDs such as `music:pack:Library`,
  `sfx:pack:<collection>`, `music:Vlog`, `soundza:Whoosh`, `trolls:Trending`, `tts`
  and `credits`; do not break callers by renaming stored identifiers blindly.
- Verify: installed music is visible under Library without changing an online
  licence filter; online music, effects, memes, Soundza, speech and credits remain
  discoverable as separate destinations or controls.

### 3. Search, filters and licence wording

Owner: `StockLibrary.jsx` and `AudioLibrary.jsx`, including SoundzaSearch.

- Reuse SearchBox and the same Filters disclosure arrangement for online stock
  and audio. Keep existing explicit search submission; do not introduce requests
  on every keystroke as part of this presentation change.
- Use Copyright attribution as the Openverse filter label, with:
  - No credit required (CC0) -> existing `licenses: 'cc0'`.
  - Include credit-required media (CC BY) -> existing `licenses: 'attribution'`.
- Explain that the second option includes CC0 and CC BY. Keep CC0 as the initial
  Openverse policy; do not silently opt users into attribution-required content.
- These labels describe copyright attribution, not independent clearance of all
  rights. Preserve the source-check and licence details on imported results.
- Active filters remain visible when Filters is closed. Support an explicit reset
  to the current provider's defaults. A restrictive copyright filter stays visible
  in the summary, including when it is the default.
- When a successful search is empty, name the current source and active filters.
  For a CC0-only Openverse search, offer Include credit-required media as an
  explicit action that changes the filter and reruns the same query.
- Preserve the typed query when changing filters. Keep separate browsing state for
  relevant kinds/providers so returning to a view does not unexpectedly reset it.
  Continue rejecting stale responses and retain pagination/retry behavior.
- Verify: a filtered empty list does not imply that the local music collection or
  all online music has disappeared. Search text, filter summary and visible results
  must describe the same request.

### 4. Result presentation

Owners: stock tiles, `MediaFavorites.jsx`, audio Row and `PackMusic.jsx`.

- Preserve the photo/video grid and compact audio list. Do not force audio into
  image cards or copy another editor's layout, assets or wording.
- Photo/video cards expose title, source/licence details, favorite and a consistent
  add action. Keep main/overlay placement discoverable in the same location across
  stock and stock favorites. Licence/source badges must not obscure these actions.
- Audio rows retain left-side Play/Stop, a readable title and duration, attribution
  status, Favorite when supported and a stable right-side Add action. Apply the
  same placement treatment to library and online rows without inventing favorites
  support for a source that does not currently have it.
- Use human-readable Credit required / No credit required badges where supported;
  retain the precise licence and source link in details. Unknown meme licences
  must remain visibly unknown, not inherit a CC0 badge.
- Preserve download progress, per-item add errors, playback and all existing
  placement semantics. Keep media provenance and publication credits unchanged.

## Scope

- Inherit: Media Stock and stock Favorites result actions; Audio Library, Online,
  This project and Favorites navigation; both Edit and Agent library panels.
- Verify: text-to-speech and recording entry points, installed-pack refresh, source
  links, favorites, agent imports and video export credit copying.
- Exclude: backend search policy, credentials, provider contracts, download security,
  generated graphics, timeline behavior, project formats, installers and publishing.
- Preserve the existing uncommitted Openverse work. Do not revert or commit it
  implicitly while implementing this plan. No push or installer build is authorized.

## Validation

- Product tasks: find installed music; search online music with CC0 and optional
  CC BY; find a whoosh; switch to Soundza without a key and return; browse memes;
  search and place an Openverse photo on main/overlay; switch back to Pixabay;
  find favorites, speech generation, recording and combined publication credits.
- Interface: real Electron at 1000x640, 1400x860 and 1920x1080, minimum side-panel
  width in Edit and Agent, installed/missing/loading packs, long collection and
  result titles, open/closed Filters, supported-provider switches, empty/loading/
  retry/download-failure states, pagination and rapid query/filter changes.
- Confirm search and useful results appear without scrolling past an expanded
  filter form. Confirm collection names and action labels do not clip or disappear.
- Extend the existing Openverse smoke to assert the new user-facing flow rather
  than preserving old native-select selectors. Use local image/audio/API fixtures
  for repeatable checks and capture screenshots of stock and audio browsing.
- Verify the shared SearchBox, Dropdown, view states and v13 tokens are reused.
  New presentation must not create a parallel application-wide design system.
- Run the following checks after implementation, retaining failures as failures:
  - `node tests/unit/library/test-openverse.cjs`
  - `node tests/unit/library/test-stock.cjs`
  - `node tests/unit/library/test-library.cjs --offline`
  - `node tests/unit/library/test-favorites.cjs`
  - `node tests/unit/library/test-soundza.cjs`
  - `node tests/unit/agents/test-agent-tools.mjs`
  - `node tests/unit/library/test-openverse-ui.cjs`
  - `node tests/unit/editor/test-ux-layout-ui.cjs`
  - `npm run test:structure`
- Localhost/Electron tests may need the existing outside-sandbox execution path.
  Passing focused checks is not a claim that the whole test battery passes.

## Stop conditions

- Reassess the implementation boundary if UI navigation cannot be changed without
  a backend/provider contract or saved-project migration. Do not silently widen scope.
- Do not discard a supported provider, installed collection, credit requirement or
  existing action merely to shorten the navigation.
- If the compact panel cannot keep controls and results usable at the supported
  window sizes, record the actual geometry and request a revised layout decision
  before introducing the deferred expanded browser.

## Design documentation

After implementation and real-app validation, update
`docs/design/editor-usability.md` with the source/view hierarchy and collapsed-filter
behavior, and `docs/architecture/openverse-media.md` with the new navigation and
plain-language attribution labels. Do not rewrite the global v13 design language.

## Implementation record

Implemented the search-first side-panel design, retained the local collections and
existing providers, and added compact source/content menus at the smallest width.
Queries, copyright filters and the chosen effects provider survive navigation.
Empty-result actions and error messages wrap within narrow panels.

- Browser flow: 37 checks passed, no renderer errors. Evidence: `clipcraft-openverse-ui-Tpi7wo/result.json` under the system temporary directory.
- Missing pack: 14 checks passed, no renderer errors. Evidence: `clipcraft-openverse-ui-qBXabS/result.json` under the system temporary directory.
- Edit/Agent layout regression: 306 checks passed, no renderer errors. Evidence: `clipcraft-agent-capabilities-ui-45eFI7/result.json` under the system temporary directory.

Focused Openverse, stock, offline library, favorites, Soundza and agent-tool checks
passed, as did structure validation and the renderer compilation. The full unit
battery was not rerun. No installer was packaged and nothing was pushed. The
window manager capped the tallest browser case; layout evidence records actual
window sizes rather than assuming requested dimensions were applied.
