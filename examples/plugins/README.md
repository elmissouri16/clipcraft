# Creative pack examples

These folders contain declarative effects, transitions, export presets, title
and caption styles, LUT/color looks and motion presets. They contain no scripts
or Node entry. Developer bootstrap validates and installs these packs.

Runnable executable source projects live under
[examples/extensions](../extensions/README.md). Build their `dist` payloads with
the SDK and explicitly trust them in the app. Historical command/panel examples
were moved unchanged to `tests/fixtures/plugins/legacy` solely to verify saved
package compatibility; they are not runnable examples.

For generated licensed font/sound packs and an eight-stage timeline demo, run
`node scripts/create-plugin-showcase.cjs`. It writes archives, media and copied
sources outside the checkout and can open an isolated development profile.
