# Localization: one dictionary per language, every UI string through t()

ClipCraft's interface is available in English, French and Spanish. The user picks the language in
Settings > General > Language (System language, English, Français, Español); the choice is saved in
settings and applies when ClipCraft restarts, because the language is settled once before anything
renders and never changes while the app runs.

## Where the text lives

- `shared/i18n/en.json`, `fr.json`, `es.json`: flat objects, key to text. English is the source;
  the other two carry every key English has. A missing key falls back to English, then to the key.
- `src/i18n/index.js` (renderer) and `electron/system/i18n.cjs` (main process) read the same
  files. `src/i18n/boot.js` is the first import of `src/main.jsx`, so module-level tables may call
  `t()` directly.

## Conventions

- **Keys** are `<area>.<slug>`: a short area per surface (`home`, `settings`, `timeline`,
  `inspector`, `pilot`, `export`, `main` …) and a lower-case snake slug of the English text,
  at most ~40 characters. Reuse an existing key when the English text is identical.
- **Placeholders** are `{name}`: `t('home.version', { version })` with `"Version {version}"`. Never
  build a sentence by concatenating translated fragments; put the whole sentence in one key.
- **Plurals** use `tn(key, count)` with an object value: `"library.items": { "one": "{count} item",
  "other": "{count} items" }`. French and Spanish use the same forms; Intl.PluralRules picks.
- **Inline markup** uses `rich(key, params, tags)` with `<b>`, `<i>`, `<code>`, `<kbd>`, `<br/>`
  or a custom tag mapped to a function: `rich('x.y', {}, { a: (s) => <button …>{s}</button> })`.
- **Dates and numbers** go through `formatDate`, `formatDateTime`, `formatNumber` so they follow
  the language.
- **Not translated:** brand and product names (ClipCraft, CraftAI, Gemini, Codex …), model ids,
  URLs, file names and extensions, CSS classes, data attributes, keyboard key names, anything sent
  to a model (tool names, descriptions, prompts, tool results) and developer-only console text.
- **Wording:** plain, short, sentence case, active voice. No em dashes anywhere, in any language:
  use a period, a comma, a colon or parentheses instead. The ellipsis character (…) is fine.
  Short labels (buttons, aria labels, menu items, titles) keep their established English text;
  polish only sentences and hints.
- **Catalog names** (filters, effects, transitions, text templates, animations, blend modes, mask
  shapes, crop ratios, LUTs, playback quality, collections) are data the agent tools match on and
  projects persist, so the tables keep their English names and the UI shows
  `catalogName(kind, item)` / `catalogLabel(kind, text)` from `src/i18n/catalog.js`, which look up
  `catalog.<kind>.<slug>` and fall back to the English name. `node scripts/i18n-catalog-keys.cjs`
  regenerates those keys from the tables.
- **Main-process messages** that the UI shows (dialog titles and buttons, save/open/export errors)
  use `electron/system/i18n.cjs`'s `t()` with `main.*` keys. Messages that an agent tool also
  reads stay English, since they are data for the model.

## Tooling

- `node scripts/i18n-wrap.cjs [--apply] [--report file] [files]` wraps the unambiguous plain strings
  of JSX files (a text node alone in its element, and title / aria-label / placeholder / alt /
  aria-description / label attributes) and lists everything else for a hand pass. With `--check`
  it exits non-zero while plain strings remain. It appends new keys to `en.json`.
- `tests/unit/system/test-i18n.mjs` checks the layer and the dictionaries: every language has every
  key, placeholders match across languages, no em dashes, plural objects are complete, and the
  translations are not copies.
- `tests/unit/system/test-i18n-coverage.cjs` runs the extraction script in `--check` mode: no plain
  UI string may sit outside `t()` in the renderer's JSX.
- `tests/unit/system/test-language-ui.cjs` launches the real app with `language: 'fr'` (or
  `FVE_UI_LANGUAGE=es`) and checks Home, the Settings rail, the Language page and About render in
  that language with no English left on the controls it inspects.
- `scripts/i18n-merge-parts.cjs` folds `shared/i18n/parts/*.en.json` (keys a hand pass added) into
  `en.json`.
