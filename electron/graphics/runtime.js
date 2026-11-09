// Motion graphics runtime, inside the sandbox page. It loads one component, then renders frame after
// frame. A component is a pure function of the frame number and its inputs that returns SVG markup:
//
//   export const inputs = { values: { type: 'series', default: [...] } };
//   export default function render({ frame, frames, fps, time, width, height, inputs, kit }) {
//     return kit.svg`<svg viewBox="0 0 ${width} ${height}">…</svg>`;
//   }
//
// Randomness and the clock are fixed so the same frame always draws the same picture. Each frame's
// SVG is rasterised in a canvas here and its pixels sent to the host; a frame whose markup equals the
// previous one is not drawn again. Fonts handed over with the job are embedded in every frame (an SVG
// drawn as an image loads nothing external) and loaded into the page for text measuring.
(() => {
  'use strict';
  // ---- Determinism ----
  const seeded = (seed) => { let s = (seed >>> 0) || 0x9e3779b9; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; };
  const realNow = performance.now.bind(performance); // timings for the host only, never for components
  Math.random = seeded(1);
  const EPOCH = Date.UTC(2024, 0, 1);
  Date.now = () => EPOCH;
  performance.now = () => 0;

  // ---- Toolkit ----
  const clamp01 = (p) => Math.max(0, Math.min(1, p));
  const SPRING_END = 1 - Math.exp(-7) * 8;
  const easings = {
    linear: (p) => p,
    in: (p) => p * p * p,
    out: (p) => 1 - (1 - p) ** 3,
    inout: (p) => (p < 0.5 ? 4 * p ** 3 : 1 - (-2 * p + 2) ** 3 / 2),
    back: (p) => 1 + 2.70158 * (p - 1) ** 3 + 1.70158 * (p - 1) ** 2,
    spring: (p) => (1 - Math.exp(-7 * p) * (1 + 7 * p)) / SPRING_END,
  };
  const easeOf = (e) => typeof e === 'function' ? e : easings[e] || easings.linear;
  // Map x through matching input and output ranges (several segments allowed), eased per segment.
  function interpolate(x, input, output, { easing = 'linear', clamp = true } = {}) {
    const ease = easeOf(easing);
    if (x <= input[0]) return clamp ? output[0] : output[0] + (x - input[0]) * (output[1] - output[0]) / (input[1] - input[0]);
    const n = input.length - 1;
    if (x >= input[n]) return clamp ? output[n] : output[n] + (x - input[n]) * (output[n] - output[n - 1]) / (input[n] - input[n - 1]);
    let i = 1; while (input[i] < x) i++;
    const p = (x - input[i - 1]) / (input[i] - input[i - 1]);
    return output[i - 1] + (output[i] - output[i - 1]) * ease(p);
  }
  // A damped spring from `from` to `to`, `delay` frames late. Damping 2*sqrt(stiffness*mass) settles
  // without overshoot; lower bounces.
  function spring({ frame, fps, delay = 0, from = 0, to = 1, stiffness = 120, damping = 14, mass = 1 }) {
    const t = Math.max(0, (frame - delay) / fps);
    const w0 = Math.sqrt(stiffness / mass), zeta = damping / (2 * Math.sqrt(stiffness * mass));
    let x;
    if (zeta < 1) { const wd = w0 * Math.sqrt(1 - zeta * zeta); x = 1 - Math.exp(-zeta * w0 * t) * (Math.cos(wd * t) + (zeta * w0 / wd) * Math.sin(wd * t)); }
    else if (zeta === 1) x = 1 - Math.exp(-w0 * t) * (1 + w0 * t);
    else { const r = Math.sqrt(zeta * zeta - 1), r1 = -w0 * (zeta - r), r2 = -w0 * (zeta + r); x = 1 - (r2 * Math.exp(r1 * t) - r1 * Math.exp(r2 * t)) / (r2 - r1); }
    return from + (to - from) * x;
  }
  // Progress 0..1 through a stretch of frames: progress(frame, start, length, easing).
  const progress = (frame, start, length, easing = 'linear') => easeOf(easing)(clamp01((frame - start) / Math.max(1, length)));
  const stagger = (index, step, start = 0) => start + index * step;
  // Numbers like "$3.4M" from a pattern: text before the first # or 0, digits after the point, text after.
  function format(value, pattern = '#') {
    const m = /^([^#0]*)([#0,]*)(?:\.([#0]+))?(.*)$/.exec(pattern) || [];
    const decimals = (m[3] || '').length, grouped = (m[2] || '').includes(',');
    let text = Number(value).toFixed(decimals);
    if (grouped) { const [a, b] = text.split('.'); text = a.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (b ? '.' + b : ''); }
    return (m[1] || '') + text + (m[4] || '');
  }
  const countUp = (value, p, pattern = '#') => format(value * clamp01(p), pattern);
  // Markup built with a tagged template: numbers rounded, text escaped, nested markup kept as it is.
  class Markup { constructor(text) { this.text = text; } toString() { return this.text; } }
  const escape = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const piece = (v) => v instanceof Markup ? v.text : Array.isArray(v) ? v.map(piece).join('') : typeof v === 'number' ? String(Math.round(v * 1000) / 1000) : v == null || v === false ? '' : escape(v);
  const svg = (strings, ...values) => new Markup(strings.reduce((out, s, i) => out + s + (i < values.length ? piece(values[i]) : ''), ''));
  const raw = (text) => new Markup(String(text));
  // A stroke that draws itself on: put on a <path>/<line>/<circle>; p 0 hidden .. 1 complete.
  const drawOn = (p) => raw(`pathLength="1" stroke-dasharray="1 1" stroke-dashoffset="${Math.round((1 - clamp01(p)) * 10000) / 10000}"`);
  // <defs> pieces: gradients, soft shadows and glows, referenced as url(#id).
  const gradient = (id, stops, { angle = 90, radial = false } = {}) => {
    const s = stops.map((c, i) => Array.isArray(c) ? c : [i / Math.max(1, stops.length - 1), c]).map(([o, c]) => `<stop offset="${o}" stop-color="${escape(c)}"/>`).join('');
    if (radial) return raw(`<radialGradient id="${escape(id)}">${s}</radialGradient>`);
    const a = (angle - 90) * Math.PI / 180, x = Math.cos(a) / 2, y = Math.sin(a) / 2;
    return raw(`<linearGradient id="${escape(id)}" x1="${0.5 - x}" y1="${0.5 - y}" x2="${0.5 + x}" y2="${0.5 + y}">${s}</linearGradient>`);
  };
  const shadow = (id, { dx = 0, dy = 10, blur = 18, color = '#000000', opacity = 0.35 } = {}) =>
    raw(`<filter id="${escape(id)}" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="${dx}" dy="${dy}" stdDeviation="${blur / 2}" flood-color="${escape(color)}" flood-opacity="${opacity}"/></filter>`);
  const glow = (id, { blur = 16, color = '#ffffff', opacity = 0.8 } = {}) =>
    raw(`<filter id="${escape(id)}" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur in="SourceAlpha" stdDeviation="${blur / 2}" result="blur"/><feFlood flood-color="${escape(color)}" flood-opacity="${opacity}" result="tint"/><feComposite in="tint" in2="blur" operator="in" result="glow"/><feMerge><feMergeNode in="glow"/><feMergeNode in="SourceGraphic"/></feMerge></filter>`);
  // Smooth line through points [[x, y], ...] (for line charts and routes), as a path "d".
  function smoothPath(points, tension = 0.5) {
    if (points.length < 2) return points.length ? `M${points[0][0]},${points[0][1]}` : '';
    let d = `M${points[0][0]},${points[0][1]}`;
    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[i - 1] || points[i], p1 = points[i], p2 = points[i + 1], p3 = points[i + 2] || p2, k = tension / 3;
      d += ` C${p1[0] + (p2[0] - p0[0]) * k},${p1[1] + (p2[1] - p0[1]) * k} ${p2[0] - (p3[0] - p1[0]) * k},${p2[1] - (p3[1] - p1[1]) * k} ${p2[0]},${p2[1]}`;
    }
    return d.replace(/(\d+\.\d{3})\d+/g, '$1');
  }
  // Ring or pie segment from angle a0 to a1 (degrees, 0 = top, clockwise) as a path "d".
  function arc(cx, cy, r, a0, a1, inner = 0) {
    const pt = (rad, a) => [cx + rad * Math.sin(a * Math.PI / 180), cy - rad * Math.cos(a * Math.PI / 180)];
    const sweep = Math.min(359.999, Math.max(0, a1 - a0)), large = sweep > 180 ? 1 : 0, end = a0 + sweep;
    const [x0, y0] = pt(r, a0), [x1, y1] = pt(r, end);
    if (!inner) return `M${cx},${cy} L${x0},${y0} A${r},${r} 0 ${large} 1 ${x1},${y1} Z`;
    const [x2, y2] = pt(inner, end), [x3, y3] = pt(inner, a0);
    return `M${x0},${y0} A${r},${r} 0 ${large} 1 ${x1},${y1} L${x2},${y2} A${inner},${inner} 0 ${large} 0 ${x3},${y3} Z`;
  }
  const hex = (c) => { const m = /^#?([0-9a-f]{6})$/i.exec(String(c)); const n = m ? parseInt(m[1], 16) : 0; return [n >> 16 & 255, n >> 8 & 255, n & 255]; };
  const mix = (a, b, t) => '#' + hex(a).map((v, i) => Math.round(v + (hex(b)[i] - v) * clamp01(t)).toString(16).padStart(2, '0')).join('');
  // Where text and key content stay visible: away from the edges and, on vertical video, from the
  // platform buttons at the bottom.
  const safeArea = (width, height) => {
    const portrait = height > width;
    const x = Math.round(width * (portrait ? 0.08 : 0.06)), top = Math.round(height * (portrait ? 0.12 : 0.08)), bottom = Math.round(height * (portrait ? 0.2 : 0.08));
    return { x, y: top, width: width - 2 * x, height: height - top - bottom };
  };
  // Text measuring with the embedded fonts (or system ones).
  const measure = new OffscreenCanvas(8, 8).getContext('2d');
  const fontString = ({ family = 'sans-serif', size = 48, weight = 400, style = 'normal' } = {}) => `${style} ${weight} ${size}px ${/[\s,]/.test(family) && !/^["']/.test(family) ? `"${family}"` : family}`;
  const textWidth = (text, font = {}) => { measure.font = fontString(font); return measure.measureText(String(text)).width + (font.letterSpacing || 0) * Math.max(0, String(text).length - 1); };
  // The largest size (max..min) at which text fits maxWidth on one line.
  const fitText = (text, maxWidth, { max = 120, min = 12, ...font } = {}) => { let size = max; while (size > min && textWidth(text, { ...font, size }) > maxWidth) size -= 1; return size; };
  // Words wrapped into lines no wider than maxWidth.
  const wrapText = (text, maxWidth, font = {}) => {
    const lines = []; let line = '';
    for (const word of String(text).split(/\s+/).filter(Boolean)) { const next = line ? line + ' ' + word : word; if (line && textWidth(next, font) > maxWidth) { lines.push(line); line = word; } else line = next; }
    if (line) lines.push(line);
    return lines;
  };
  const kit = Object.freeze({ interpolate, spring, progress, stagger, format, countUp, svg, raw, drawOn, gradient, shadow, glow, smoothPath, arc, mix, safeArea,
    textWidth, fitText, wrapText, easings, clamp01, random: seeded });

  // ---- Running a job ----
  // The bridge cannot be removed from the page; the runtime takes the job (and its token) before the
  // component loads, so a component calling it gets nothing and cannot send frames or end the render.
  const host = window.graphicsHost;
  const toBytes = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  async function load(code) {
    const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
    try { return await import(url); } finally { URL.revokeObjectURL(url); }
  }
  // Readable errors for the agent: the message, and the component line where it happened.
  const explain = (error, frame) => {
    const at = /blob:[^\s)]*:(\d+):(\d+)/.exec(String(error?.stack || ''));
    return `${frame === null ? 'Loading the graphic' : `Frame ${frame}`}: ${error?.message || String(error)}${at ? ` (component line ${at[1]}, column ${at[2]})` : ''}`;
  };
  async function main() {
    const job = await host.job(), token = job.token;
    const { width, height, fps, frames } = job;
    // Design measurements for the agent: the smallest text drawn and the longest still stretch.
    const stats = { render_ms: 0, raster_ms: 0, send_ms: 0, frames: 0, repeated: 0, min_font_px: null, longest_still_frames: 0, longest_still_from: 0 };
    let still = 0;
    const clock = realNow;
    let frame = null;
    try {
      const faces = [];
      for (const f of job.fonts || []) {
        const face = new FontFace(f.family, toBytes(f.data), { weight: String(f.weight || 400), style: f.style || 'normal', ...(f.unicodeRange ? { unicodeRange: f.unicodeRange } : {}) });
        document.fonts.add(await face.load());
        faces.push(`@font-face{font-family:"${f.family.replace(/"/g, '')}";font-weight:${f.weight || 400};font-style:${f.style || 'normal'};${f.unicodeRange ? `unicode-range:${f.unicodeRange};` : ''}src:url(data:font/woff2;base64,${f.data}) format('woff2');}`);
      }
      const fontStyle = faces.length ? `<style>${faces.join('')}</style>` : '';
      const component = await load(job.code);
      if (typeof component.default !== 'function') throw Error('The graphic must `export default function render({ frame, fps, width, height, inputs, kit })`.');
      const defaults = Object.fromEntries(Object.entries(component.inputs || {}).map(([k, v]) => [k, v && typeof v === 'object' && 'default' in v ? v.default : v]));
      if (job.live) {
        const canvas = document.createElement('canvas'), ctx = canvas.getContext('2d');
        let previous = '', image = '';
        host.onLiveRequest(async (request) => {
          const started = clock();
          try {
            const inputs = Object.freeze({ ...defaults, ...request.inputs });
            const markup = String(component.default({ frame: request.frame, frames: request.frames, fps, time: request.frame / fps, width, height, inputs, kit }) ?? '');
            if (!/^\s*<svg[\s>]/.test(markup)) throw Error('render must return SVG markup.');
            const scale = Math.min(1, request.side / Math.max(width, height));
            const w = Math.max(1, Math.round(width * scale)), h = Math.max(1, Math.round(height * scale));
            const key = `${w}:${h}:${markup}`;
            if (key !== previous) {
              const sized = markup.replace(/^\s*<svg\b([^>]*)>/, (_open, attrs) => `<svg${/\bxmlns=/.test(attrs) ? '' : ' xmlns="http://www.w3.org/2000/svg"'}${/\bwidth=/.test(attrs) ? '' : ` width="${width}"`}${/\bheight=/.test(attrs) ? '' : ` height="${height}"`}${attrs}>${fontStyle}`);
              const url = URL.createObjectURL(new Blob([sized], { type: 'image/svg+xml' }));
              const img = new Image(); img.src = url;
              try { await img.decode(); } finally { URL.revokeObjectURL(url); }
              canvas.width = w; canvas.height = h; ctx.drawImage(img, 0, 0, w, h);
              image = canvas.toDataURL('image/png'); previous = key;
            }
            await host.liveResult(token, request.index, { image, width: w, height: h, render_ms: clock() - started });
          } catch (error) { await host.liveResult(token, request.index, { error: explain(error, request.frame) }); }
        });
        await host.liveReady(token, null);
        return;
      }
      // The declared inputs, as plain data, so the editor can show them as fields (it never runs the code).
      try { const schema = JSON.parse(JSON.stringify(component.inputs ?? null)); stats.schema = JSON.stringify(schema).length <= 65536 ? schema : null; } catch { stats.schema = null; }
      const inputs = Object.freeze({ ...defaults, ...(job.inputs || {}) });
      const canvas = new OffscreenCanvas(width, height), ctx = canvas.getContext('2d', { willReadFrequently: true });
      let previous = null;
      for (frame = 0; frame < frames; frame++) {
        let t = clock();
        const markup = String(component.default({ frame, frames, fps, time: frame / fps, width, height, inputs, kit }) ?? '');
        if (!/^\s*<svg[\s>]/.test(markup)) throw Error('render must return SVG markup: return kit.svg`<svg viewBox="0 0 ${width} ${height}">…</svg>`.');
        stats.render_ms += clock() - t; t = clock();
        // The same markup draws the same picture: nothing to rasterise or send (holds, settled charts).
        if (markup === previous) {
          still++; if (still > stats.longest_still_frames) { stats.longest_still_frames = still; stats.longest_still_from = frame - still; }
          await host.frame(token, frame, null); stats.send_ms += clock() - t; stats.repeated++; stats.frames++; continue;
        }
        still = 0; previous = markup;
        for (const m of markup.matchAll(/font-size(?:="|:\s*)([\d.]+)/g)) { const px = Number(m[1]); if (px > 0 && (stats.min_font_px === null || px < stats.min_font_px)) stats.min_font_px = px; }
        const sized = markup.replace(/^\s*<svg\b([^>]*)>/, (open, attrs) => `<svg${/\bxmlns=/.test(attrs) ? '' : ' xmlns="http://www.w3.org/2000/svg"'}${/\bwidth=/.test(attrs) ? '' : ` width="${width}"`}${/\bheight=/.test(attrs) ? '' : ` height="${height}"`}${attrs}>${fontStyle}`);
        const url = URL.createObjectURL(new Blob([sized], { type: 'image/svg+xml' }));
        const img = new Image(); img.src = url;
        try { await img.decode(); } catch { throw Error('the SVG markup is not valid (check unclosed tags, & written as &amp;, and attribute quotes).'); } finally { URL.revokeObjectURL(url); }
        ctx.clearRect(0, 0, width, height); ctx.drawImage(img, 0, 0, width, height);
        const pixels = ctx.getImageData(0, 0, width, height).data;
        stats.raster_ms += clock() - t; t = clock();
        await host.frame(token, frame, new Uint8Array(pixels.buffer));
        stats.send_ms += clock() - t;
        stats.frames++;
      }
      await host.done(token, null, stats);
    } catch (error) { if (job.live) await host.liveReady(token, explain(error, frame)); else await host.done(token, explain(error, frame), stats); }
  }
  main();
})();
