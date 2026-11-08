# Motion graphics: plan

Status: phase 0 spike done (go). The agent slice works: `graphics_guide`, `add_graphic`, `edit_graphic`, sandbox render, preview and export (see [agent editing](../agents/agent-editing.md#motion-graphics)). Editor integration done: Graphics library group and badge, always a full-frame overlay, inspector Graphic tab with the declared fields, automatic re-draw on canvas changes and lost files. Next: cache size in Settings, re-timing on trim, poster frames over a checkerboard, Windows/Linux runs. Branch `feat/motion-graphics`.

## Goal

Custom animated graphics in a video: charts, counters, map routes, callouts, lower thirds, kinetic
diagrams, and anything else that can be drawn. The agent writes new graphics from scratch, everyone
can use ready-made templates, and anyone can edit a graphic's data and look without touching code.

Today the only option is a generated still picture moved as a whole: bars cannot grow, numbers
cannot count, and the data cannot be changed.

## Decision: our own component runtime, not Remotion

A graphic is a small **component**: a pure function of the frame number and its editable inputs,
drawn with HTML, SVG, CSS or canvas. This is the same model as Remotion. We build it ourselves and
do not ship Remotion:

- **Licence.** Remotion is not open source. Most companies need a paid licence, and ClipCraft is
  MIT. Check the current terms before anyone revisits this.
- **Packaging.** Remotion renders with a downloaded headless Chrome and a bundler. ClipCraft is
  Electron, so it already contains Chromium and can render hidden windows offscreen.
- **Export.** Remotion owns the whole render. ClipCraft has its own FFmpeg graph, and a graphic
  only needs to become one more transparent overlay in it.

What we keep is the general model: frame-pure rendering, interpolation, springs, sequences and
staggering. Models know this style well, so they write good components. The runtime and its
toolkit are original ClipCraft code (see the originality rule in `AGENTS.md`).

A user who owns a Remotion licence can still render their own composition to a transparent video
and import it as an overlay. That needs nothing from us.

## How it works

### The component

```js
export const inputs = {                      // editable fields, shown in the inspector
  data:   { type: 'series', default: [{ label: '2021', value: 1.2 }, { label: '2023', value: 3.4 }] },
  format: { type: 'text',   default: '$#.#M' },
  accent: { type: 'color',  default: '#e8b34a' },
};
export default function render({ frame, fps, width, height, inputs, kit }) {
  const grow = kit.spring({ frame: frame - 10, fps });   // 0 → 1
  return kit.svg`<svg viewBox="0 0 ${width} ${height}">…</svg>`;
}
```

- `render` must be pure: the same frame and inputs always give the same picture. That makes
  scrubbing, caching and exporting reliable.
- `kit` is the ClipCraft toolkit. It provides `interpolate`, `spring` and the keyframe easings from
  `anim.js` (including `continuous`), `sequence` and `stagger`, number formatting, a seeded
  `random`, text measuring, bundled fonts, and path helpers (draw-on lengths, arcs, smooth lines).
- Markup is written with a tagged template, so no bundler is needed. Whether to add a tiny
  React-style layer (for example Preact with htm, both MIT) is decided in the spike, because models
  write that style best.

### Sandbox

Agent-written code is untrusted. It runs in a hidden offscreen `BrowserWindow`, like frame
inspection (`captureTimelineFrame` in `electron/main.cjs`), but locked down further:

- `sandbox: true`, no Node, context isolation, and its own session partition;
- a Content Security Policy with no network; images only from `data:` and `blob:`, fonts only from
  the bundled set;
- every permission request, navigation and `window.open` denied;
- `Math.random`, `Date` and `performance.now` replaced with seeded or frozen versions; no timers;
- limits: code size, time per frame (an endless loop is stopped and reported) and total render time.

Errors (exceptions, timeouts, invalid inputs) come back as readable messages, so the agent can fix
its own code.

### Rendering and cache

- The render service steps through the frames and captures each one with transparency. It streams
  RGBA into a lossless transparent video, with the same QuickTime RLE pipe as `textstream.cjs`.
- Renders are cached under user data, keyed by a hash of code, inputs, size, frame rate and
  runtime version.
- The preview gets a fast low-resolution render first, then the full one. Export always uses the
  full resolution.
- Which capture method is used is decided by the spike (see below).

### On the timeline

- A graphic is an **overlay clip** with a `graphic` field: `{ graphicId, inputs }`. It therefore
  gets placement, transform, keyframes, `move_along_path`, blend, opacity, layers, pinning and
  the motion checks with no extra work.
- The component's code is stored in the project (`project.graphics[id] = { code, inputs schema,
  version }`), so the project file stays portable. Rendered video lives only in the cache.
- Export composites the cached transparent video like any overlay video. Preview and export play
  the same frames, so they cannot differ.

### Editing

- The inspector shows a graphic's declared inputs as normal fields: a table for series, colour,
  text, number, choice and duration. Changing a field re-renders the graphic.
- A code view is optional and advanced, and comes later.

### Templates

These are components written by us:
- charts: bar, line (draws itself), donut or pie, a single counting number, progress bar,
  comparison of two values;
- explainers: timeline of dates, map route with a moving marker and draw-on line, callout with a
  leader line, checklist, lower third, flow diagram.

They use the same runtime as agent-written graphics.

### Agent

- **Tools** (in a new `graphics` tool group):
  - `add_graphic`: a template or new code, inputs, start, duration and placement;
  - `edit_graphic`: change inputs or code;
  - `list_graphic_templates`.
- **What it gets back:** numbered frames of the rendered graphic for inspection, measured motion
  (frame-to-frame change: stops, jumps, steady movement) and any sandbox errors.
- **Timing from speech:** a helper turns transcript word times into frame numbers, so "3.4
  million" lands on the spoken words.
- **Guidance:** the motion guide gets a graphics section covering readable sizes and safe areas,
  pacing (build in 0.4–0.8 s, hold to read), one focal point at a time, and contrast.

## Phases

### 0. Spike (measure before building)

Render one animated bar chart at 1080×1920 for 5 s, through the sandbox, into a transparent video,
and put it on the timeline. Then:

- **Compare capture methods:**
  - a) offscreen window frames (the `paint` event, stepped);
  - b) `capturePage` per frame;
  - c) drawing the SVG into a canvas inside the sandbox and reading its pixels.
- **Record:** milliseconds per frame, alpha accuracy and memory, as an evidence file in `docs/`.
- **Go if:** the chosen method takes 50 ms per frame or less at 1080p, transparent pixels are
  exact (no dark fringes), and export composites the graphic exactly where the preview shows it.
- **Decide:** whether to use plain tagged templates or a small React-style layer.
- **Check:** offscreen transparency on Windows and Linux, not only macOS.

#### Spike results (done: go)

Run with `node tests/spikes/run-graphics-spike.cjs`. It renders the fixture
`tests/fixtures/graphics/barChart.js` at 1080×1920, 30 fps, 150 frames, through
`electron/graphics/` (sandbox page, runtime, renderer). Evidence:
[`motion-graphics-spike.json`](motion-graphics-spike.json), from macOS 25.5 arm64 with Electron
33.4.11.

**Capture methods**

| Method | ms per frame (whole render) | Exact pixels | Notes |
| --- | --- | --- | --- |
| canvas (SVG rasterised in the sandbox) | **18.7** | yes | Start-up 103 ms. 52 repeated frames skipped. Peak sandbox memory 184 MB. File 3.0 MB. |
| capture (`capturePage`) | 33.2 | yes on the final frame | At frame 40, 94,800 channels differ from canvas: it captures stale frames. |
| paint (offscreen paint event) | — | — | No paint arrived for the transparent offscreen window. Not pursued. |

- **Chosen: canvas.** It meets the 50 ms target with room to spare.
- Of the 18.7 ms, rasterising takes about 4 ms per drawn frame and QuickTime RLE encoding about
  4 ms (measured separately).
- **The rest is copying the 8 MB frame to the main process.** The next speed-up is sending only
  the changed rows; `TextStream` already accepts patches.
- **Repeated frames are free:** when a frame's markup equals the previous one, nothing is drawn
  or copied, and the encoder repeats the last frame. This suits holds and settled charts, and is
  one reason to keep returning markup (see the decision below).

**Transparency**

- Exact on the final frame: background alpha 0, bar `232,179,74,255`, the 25 % gridline
  `255,255,255,64`. There is no dark fringe.
- The `capture` method converts Chromium's premultiplied BGRA itself and matches on those pixels
  too.

**Preview copy**

- Transparent VP9: 661 ms to encode the full 5 s at full size (284 kB), 381 ms at half size.
- Alpha is kept (gridline `253,253,253,64`).
- Chromium plays it with transparency: drawn over red, the background stays `255,0,0` and the
  gridline is `255,64,64` (25 % white over red).
- Decoding with transparency needs FFmpeg's `libvpx-vp9` decoder; the built-in one drops alpha.
  So **export keeps the RLE file and the preview uses the VP9 copy.**

**Export composite**

The graphic is placed as an overlay over a solid background through the real
`buildExportArgs`.

- **Bar edge:** row 500 in both the graphic and the export.
- **Blend:** against the background as exported, the mean error is 0.51. 0.47 % of channels are
  off by more than 8, all at sharp coloured edges (H.264 4:2:0 chroma).
- **Separate existing issue:** every overlay makes the background about 2 luma levels darker,
  plain image overlays too (Y 58 without an overlay, 56 with one; BT.709 expects 59).
  This belongs to the existing export path and needs fixing on its own.

**Sandbox**

- Network and `file://` fetches are blocked.
- `require` and `process` do not exist.
- `Math.random` is seeded and `Date.now` is fixed.
- An endless loop is stopped after 1.6 s.
- Output that is not SVG is rejected with a readable message.
- The host bridge cannot be deleted from the page, so it is locked instead. The runtime takes the
  job and a one-time token before the component loads; a component calling the bridge is refused
  for both the job and frames.

**Fonts**

- An SVG drawn as an image loads nothing external, so fonts are embedded as `data:` URLs.
- Cost per drawn frame: about 4.1 ms with a 19 kB font and 5.3 ms with a 100 kB font, against
  4.0 ms with none.
- The font is applied: the title's ink changes.
- A font subset without the text's script falls back to another font, so the real version must
  embed subsets that cover the text.

**Decisions**

- Capture with canvas. Phase 1 removes the `capture` and `paint` paths.
- Components return SVG markup through tagged templates: no bundler, no dependencies, and equal
  markup means an identical frame. A React-style layer is not needed now; phase 3 evaluates
  whether models write better components with one.
- Two cached files per graphic: RLE for export, VP9 with alpha for the preview.

**Not tested yet:** Windows and Linux, and GPU-less machines.

### 1. Runtime, sandbox, render service, graphic clip

Graphic overlay clips play in the preview and export from the cache. Sandbox limits are enforced.

### 2. Inspector inputs and the first templates

Bar chart, line, counter and lower third first; then donut, progress bar, map route, callout and
timeline.

### 3. Agent tools, guidance and verification

Tools, frames returned for inspection, motion measurement, transcript timing, evaluation tasks in
the agent evaluation harness.

### 4. Hardening

Security tests, render speed, cache cleanup, cross-platform runs, documentation.

### Later

A code view for users, painting by hand on the player (strokes saved as components that draw
themselves on), and data import from CSV.

## Tests

- **Runtime unit tests:** pure rendering (the same frame gives the same pixels), toolkit maths,
  input validation.
- **Sandbox tests:** network blocked, no file or Node access, an endless loop stopped, oversized
  code refused, navigation and pop-ups refused.
- **Export test:** a known graphic rendered and composited; its pixels measured at known frames
  against the preview, like `tests/unit/export/test-continuous-motion-export.mjs`.
- **Real-app smoke:** an agent-written chart through the real tools, the inspector inputs edited,
  the preview re-rendered, and the export.
- **Agent evaluation:** "an animated bar chart of these numbers landing on the narration" checked
  for timing, readability and smooth motion.

## Risks and open questions

- **Capture speed and cross-platform transparency** are the main technical risks; the spike
  settles them.
- **Fonts:** only bundled fonts inside the sandbox, so renders are identical on every machine.
- **Different GPUs may differ by a pixel value or two.** That is acceptable; tests compare with a
  tolerance.
- **Cache size:** transparent RLE video is large. It needs an eviction policy and a size shown in
  Settings, like proxies.
- **Long graphics** (over 30 s) may need chunked rendering and progress shown on the clip.
