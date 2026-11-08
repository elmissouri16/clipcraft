# Effect and transition rendering audit

Validated 2026-11-06T15:20:30.616Z. Changes are local; nothing was pushed.

## Confirmed issues fixed

- Full-strength Grain and Pixelation had no preview implementation. Classic effects now share shader passes across clip and Effects-track use, including strength and regions. Baked effects are removed before final composition so they cannot be applied twice.
- Animated transition previews discarded transforms, animated placement, opacity, masks, outlines, blend modes and basic adjustments. Transition inputs now rasterize the styled picture before mixing.
- Transition jobs did not materialize outline/glow images. They now include these alongside mask and painted-removal images.
- RGB transition segments were converted with an implicit YUV matrix despite BT.709 output tags. Their final conversion now uses the explicit matrix and range.
- Cropped/keyed previews shaded pixels after cropping/keying; export shaded the source first. Both now shade the source before crop and keying. GPU key passes also respect framebuffer orientation and select the appropriate texture sampling after an effect.
- Several transition expressions left changed edge pixels at exactly zero or full progress. CPU and GPU transition entry points now preserve the exact endpoint picture.
- Dissolve was a crossfade in preview and a noise dissolve in export. It now uses one shared pixel-reveal expression.

## Verification

- Full battery: 119 PASS / 12 FAIL of 131 suite files. No new failing suite relative to the prior full battery.
- Real Electron UI: 22 checks passed. These cover GPU endpoints across the transition catalogue, effects followed by cropped keying, full-strength classic effects, effect stacks, cropped/keyed effects, styled zoom transitions and Dissolve. Actual exported pixels are compared with preview pixels.
- Dedicated transition-color regression verifies that lossless RGB transition segments retain their neighboring colors.
- Renderer compilation, repository structure check and whitespace check passed. No installer was packaged.
- Existing freeze-frame and corner-reveal assertions were corrected: compare displayed RGB across color spaces, and sample the corner reveal before its radius reaches the centre. Both now pass without changing those product behaviors.

Dissolve comparisons use local color averages because YUV 4:2:0 subsamples the chroma of its per-pixel noise pattern. Smooth transitions and effects retain full-size pixel comparisons. Tests allow compression and antialiasing differences; they do not claim bit-identical rendering at different resolutions.

## Remaining suite failures

- tests/unit/agents/test-agent-frames.mjs
- tests/unit/agents/test-codex-web-search.mjs
- tests/unit/audio/test-audiofx.cjs
- tests/unit/audio/test-captions.cjs
- tests/unit/audio/test-captions-linux.cjs
- tests/unit/editor/test-fonts.cjs
- tests/unit/audio/test-tts.cjs
- tests/unit/library/test-assets.cjs
- tests/unit/library/test-bundled-templates.cjs
- tests/unit/library/test-library.cjs
- tests/unit/system/test-telemetry.cjs
- tests/unit/text/test-srt.mjs

These are the previously failing agent fixture, audio channel-layout, platform/font, caption fixture, content-pack/library and telemetry suites. They are not all environment-only failures. Logs, real-app measurements and source hashes are recorded in [effect-transition-validation.json](effect-transition-validation.json).
