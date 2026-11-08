# Structure reorganization validation

Recorded 2026-11-06 against the current working tree, including earlier pending agent and UI changes.

## Standalone suite comparison

| Checkout layout | Passed | Failed | Timed out |
| --- | ---: | ---: | ---: |
| Before moving files | 93 | 18 | 0 |
| Reorganized layout | 93 | 18 | 0 |

The same 111 suites ran before and after the move. No suite changed status. The historical battery count in AGENTS.md describes an earlier checkout; this report records the directly measured baseline for this reorganization.

These existing failures remain failures. They include unavailable platform tools, fixture dependencies and test/behavior failures; they are not all classified as environment-only:

- [test-agent-frames.mjs](../../tests/unit/agents/test-agent-frames.mjs)
- [test-codex-web-search.mjs](../../tests/unit/agents/test-codex-web-search.mjs)
- [test-audiofx.cjs](../../tests/unit/audio/test-audiofx.cjs)
- [test-captions-linux.cjs](../../tests/unit/audio/test-captions-linux.cjs)
- [test-captions.cjs](../../tests/unit/audio/test-captions.cjs)
- [test-tts.cjs](../../tests/unit/audio/test-tts.cjs)
- [test-fonts.cjs](../../tests/unit/editor/test-fonts.cjs)
- [test-anim.cjs](../../tests/unit/effects/test-anim.cjs)
- [test-textanim-export.cjs](../../tests/unit/export/test-textanim-export.cjs)
- [test-textanim-word-export.cjs](../../tests/unit/export/test-textanim-word-export.cjs)
- [test-textsmooth-export.cjs](../../tests/unit/export/test-textsmooth-export.cjs)
- [test-tplmotion-export.cjs](../../tests/unit/export/test-tplmotion-export.cjs)
- [test-transition-packs-export.cjs](../../tests/unit/export/test-transition-packs-export.cjs)
- [test-assets.cjs](../../tests/unit/library/test-assets.cjs)
- [test-bundled-templates.cjs](../../tests/unit/library/test-bundled-templates.cjs)
- [test-tracking.cjs](../../tests/unit/media/test-tracking.cjs)
- [test-telemetry.cjs](../../tests/unit/system/test-telemetry.cjs)
- [test-srt.mjs](../../tests/unit/text/test-srt.mjs)

Per-suite logs and JSON evidence: `/tmp/clipcraft-structure-baseline/` and `/tmp/clipcraft-structure-final/`. The standard command is now `npm test`; suites can be listed or filtered as documented in [the structure guide](project-structure.md).

## Other checks

- `npm run test:structure`: static imports and folder boundaries pass.
- Renderer production build passes. The existing chunk-size warning remains.
- CommonJS syntax checks pass for the backend, commands, tests and fixtures.
- A before/after AST comparison of existing production modules found no changes to code structure outside string/path references. Asset and module references were then exercised in the app.
- The dev watcher test passes for nested service files, newly created service directories and process-tree cleanup.

## Real Electron checks

- Editor UI, timeline stability and playback: passed. Evidence: `/tmp/clipcraft-structure-ui/result.json`.
- Native editor callbacks, conversation continuity and cancellation: passed. Evidence: `/tmp/clipcraft-structure-native/result.json`.
- Direct API loop, visual inspection, MCP and partial-edit Undo: passed. Evidence: `/tmp/clipcraft-structure-api/result.json`.
- Incremental images, cancellation, Undo/Redo and FFmpeg export: passed. Evidence: `/tmp/clipcraft-structure-images/result.json`.
- Recording window HTML/scripts/preloads and font IPC: passed. Evidence: `/tmp/clipcraft-structure-windows/result.json`.

The native/image checks used fixtures and mocked provider services; this was not a new live-provider/account test. Recording resource checks opened no camera stream and recorded no screen. User projects/settings were isolated from these smoke profiles.

No installer was packaged and nothing was pushed.
