# Openverse media

Stock Photos defaults to Openverse, with Pixabay available under Filters > Provider.
Pixabay supplies videos. The four bundled Node extensions register at `media.sources`. Enable or disable each source and configure its API key in Settings → Plugins. Audio separates installed Library collections
from Online music, effects and memes; provider and copyright options are under
Filters. Queries and filter choices are retained during the mounted editor session. Music and Sound FX use the same Openverse service
as photos. SFXMint results were withdrawn on 2026-11-18 after that service ended keyless
downloads; sounds already kept on disk stay usable.

Openverse searches default to No credit required (CC0). The explicit
Include credit-required media option (`licenses: attribution`) adds
CC BY. Public Domain Mark, NC, ND and SA records are excluded. A search result's
licence label is discovery metadata, not independent verification of rights;
the UI links to the original source and says to check before publishing.

`electron/bundled-media/openverse/dist/client.cjs` handles bounded anonymous API searches, a small
five-minute search cache, 429 cooldowns, supported download hosts, manually
validated redirects, content types and streamed size limits. No API secret is
distributed. Only supported HTTPS media hosts are imported; the integration
does not mirror the whole catalogue. Imports re-read the API record by UUID
instead of accepting URLs or licence claims from the renderer or saved favorites.
Downloaded audio uses the file made available by Openverse, which may be a
provider's preview rendition rather than its full-quality original.

Imported media retains title, creator and link, licence and version/link, source,
Openverse ID, attribution and an explicit `sourceVerified: false`. Saved legacy
Freesound/Jamendo favorites are migrated when used. Existing saved project media
is preserved. CC BY imports expose `publication_credit` to agent tools; project
media reads expose the credit again. Credits for timeline images and audio are
deduplicated in Audio > Credits and offered for copying in the video export dialog.
Credits are not automatically burned into the video; the publisher must include
them in the video or its description and review the adaptation statement.

The Openverse acknowledgement and independence statement are displayed in its
search UI. Primary references:

- [API schema](https://api.openverse.org/v1/schema/)
- [API terms](https://docs.openverse.org/terms_of_service)
- [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)
- [CC0](https://creativecommons.org/publicdomain/zero/1.0/)

Checks: `node tests/unit/library/test-openverse.cjs` and
`node tests/unit/library/test-openverse-ui.cjs`. The latter starts a real Electron
instance with isolated user data and local image/audio/API fixtures; it exercises
photo searches, licence selection, timeline placement, agent audio imports and
copying combined credits from export. Fixture URL overrides require `FVE_SMOKE`.
