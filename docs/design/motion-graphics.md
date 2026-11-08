# Motion graphics: plan

Status: plan, not built. Branch `feat/motion-graphics`.

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
