# Package size and bundled assets

Renderer dependencies are compiled into `dist`. Raw Lucide, React, React DOM and
supporting JavaScript copies are excluded from the installer; their licenses
remain packaged. Fontsource's unused source CSS/SCSS/types and raw font files
are excluded while its licenses remain available.

`build/font-formats.cjs` removes a WOFF source only when the same `@font-face`
already provides WOFF2. This runs before Vite emits assets, so unused WOFF files
never enter `dist`. Inline data URLs and Unicode ranges are preserved. WOFF-only
faces are left intact, and user-imported fonts continue using the existing
runtime FontFace loader rather than this build-time transform.

The primary FFprobe platform package remains bundled. The legacy fallback keeps
only the requested OS/CPU binary. Each macOS universal slice is filtered with
its own architecture before Electron Builder merges the two app bundles.

Platform-specific `files` rules must include a positive application allowlist.
With electron-builder 26.18.0, negative-only platform rules can introduce a
separate default `**/*` matcher and accidentally package source files, tests or
previous installers. `test-packaging-cleanup.cjs` exercises both the production
module filter and normalized main-file matchers to prevent that regression.

Validation includes CSS transform cases, architecture filters, license retention,
all registered font faces, Latin/Arabic text preview and export, and SDK/FFprobe
loading directly from the packaged app. Installer packaging and publishing
continue to follow `AGENTS.md`; local size comparisons do not authorize a push.
