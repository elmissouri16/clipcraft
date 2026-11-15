# Fonts

Fontsource CSS imports in `src/features/text/fonts.js` declare the bundled catalog.
Vite emits local WOFF2 assets or inline font data. Packaging keeps the built assets
and font licenses while excluding redundant raw dependency fonts. No online font
service is needed.

The font picker labels bundled, system and imported fonts. System families must
exist on the current computer; they are checked with a local `FontFace` load,
because `document.fonts.check()` also returns true for nonexistent families.
Unavailable choices remain visible, and saved font IDs are never rewritten.

`fontsReady(clips)` loads only the requested faces, weights and character subsets.
It uses the same style defaults, legacy IDs and uppercase transformation as text
drawing. Requests share pending work and retain a bounded cache. Picker rows and
template thumbnails load their fonts when visible. Imported font metadata is read
separately from font bytes, so an unused imported font is not decoded at startup.

Preview reports unavailable project fonts while displaying substitutes. Text and
GIF exports require the requested fonts and report an error rather than silently
exporting a replacement. Install/import a missing font and select it in the picker,
or choose an available font. Project files reference imported fonts; they do not
embed the font files for another computer.

Motion graphics receive the actual bundled font data, including inline subsets.
Inline data is decoded locally to preserve the production Content Security Policy.
A failed subset makes the requested graphics family unavailable instead of being
hidden by another subset that loaded successfully. Font availability does not
guarantee that a family contains every Unicode glyph; normal browser glyph fallback
still applies.

Validation: `test-font-loading.mjs`, `test-agent-graphics.mjs`,
`test-font-formats.cjs`, `test-font-packaging.cjs` and the built-renderer
`test-font-packaging-ui.cjs`. The UI suite covers loading, picker availability,
Latin/Arabic preview and export, imported-font export, missing-font refusal and
an inline-only font rendered by the real graphics service.
