// Auto color (Adjust > Auto): reads a few small frames of a clip and sets the Basic sliders so the picture looks
// natural: neutral white balance (Temp / Tint), the middle tones at a normal brightness (Exposure), a full range
// from dark to light (Contrast), no burnt highlights or crushed shadows (Highlight / Shadow) and a normal amount
// of color (Saturation). The slider math mirrors gradeExpr in grade.js, applied in the same order, so the result
// can be computed here and checked with simulateGrade. Everything runs on this PC.

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const luma = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;

// The Basic sliders (-100..100) applied to one pixel (0..1 each), as gradeExpr does.
function gradePixel(g, r, gr, b) {
  const k = (id) => clamp((Number(g[id]) || 0) / 100, -1, 1);
  const l0 = luma(r, gr, b);
  let c = [r, gr, b];
  if (k('saturation')) c = c.map((v) => l0 + (v - l0) * (1 + k('saturation')));
  if (k('temp') || k('tint')) {
    const t = k('temp') * 0.18;
    const ti = k('tint') * 0.14;
    c = [c[0] * (1 + t + ti / 2), c[1] * (1 - ti), c[2] * (1 - t + ti / 2)];
  }
  if (k('exposure')) c = c.map((v) => v * 2 ** k('exposure'));
  if (k('contrast')) c = c.map((v) => (v - 0.5) * (1 + k('contrast') * (k('contrast') > 0 ? 0.6 : 0.5)) + 0.5);
  const tone = k('highlight') * 0.25 * smooth(0.45, 1, l0) + k('shadow') * 0.25 * (1 - smooth(0, 0.55, l0));
  return c.map((v) => clamp(v + tone, 0, 1));
}

// Statistics of the frames ({ data: RGB bytes, width, height }) with a grade applied: average color of the
// pixels that tell the white balance, luminance percentiles, clipped shares, mean colorfulness.
function measure(frames, grade = {}) {
  const lumas = [];
  const chromas = [];
  let wr = 0; let wg = 0; let wb = 0; let ws = 0;
  let chroma = 0; let n = 0; let hi = 0; let lo = 0;
  for (const f of frames) {
    const d = f.data;
    for (let i = 0; i + 2 < d.length; i += 3) {
      const [r, g, b] = gradePixel(grade, d[i] / 255, d[i + 1] / 255, d[i + 2] / 255);
      const y = luma(r, g, b);
      const mx = Math.max(r, g, b);
      const mn = Math.min(r, g, b);
      lumas.push(y);
      n++;
      chroma += mx - mn;
      chromas.push(mx - mn);
      if (mx > 0.985) hi++;
      if (y < 0.02) lo++;
      // White balance from the mid and light tones, mostly from the least colorful pixels (likely grey or white
      // things); near-black and burnt pixels say nothing about the light's color.
      if (y > 0.12 && mx < 0.97) {
        const w = 1 / (1 + 10 * (mx - mn));
        wr += r * w; wg += g * w; wb += b * w; ws += w;
      }
    }
  }
  lumas.sort((a, b) => a - b);
  chromas.sort((a, b) => b - a);
  const top = chromas.slice(0, Math.max(1, Math.floor(chromas.length * 0.05)));
  const pct = (p) => (lumas.length ? lumas[Math.min(lumas.length - 1, Math.floor(p * lumas.length))] : 0.5);
  return {
    avg: ws ? [wr / ws, wg / ws, wb / ws] : [0.5, 0.5, 0.5],
    p02: pct(0.02), p50: pct(0.5), p98: pct(0.98), p995: pct(0.995),
    hi: n ? hi / n : 0, lo: n ? lo / n : 0, chroma: n ? chroma / n : 0,
    vivid: top.reduce((a, b) => a + b, 0) / top.length, // how colorful the most colorful 5% are
  };
}

const round = (v) => {
  const r = Math.round(v);
  return Math.abs(r) < 3 ? 0 : r; // too small to see
};

// The Basic slider values for these frames: { temp, tint, exposure, contrast, highlight, shadow, saturation }.
export function autoGrade(frames) {
  const out = { temp: 0, tint: 0, exposure: 0, contrast: 0, highlight: 0, shadow: 0, saturation: 0 };
  if (!frames.length) return out;

  // 1. White balance: gains that make the reference color grey (75% of the way: a warm sunset or a colored
  // light should stay a little warm or colored, not turn clinical).
  const [R, G, B] = measure(frames).avg;
  const h = (R + B) / 2;
  const ti = (G - h) / (G + h / 2);
  const t = ((1 + ti / 2) * (B - R)) / Math.max(1e-3, R + B);
  out.temp = round(clamp((t / 0.18) * 100 * 0.75, -60, 60));
  out.tint = round(clamp((ti / 0.14) * 100 * 0.75, -60, 60));

  // 2. Exposure: the middle tones to about 0.45, without pushing the brightest 0.5% past white.
  let s = measure(frames, out);
  if (Math.abs(s.p50 - 0.45) > 0.04) {
    let k = Math.log2(0.45 / Math.max(0.02, s.p50));
    if (k > 0) k = Math.min(k, Math.max(0, Math.log2(0.99 / Math.max(0.05, s.p995))));
    out.exposure = round(clamp(k * 100, -60, 80));
  }

  // 3. Contrast: a flat picture (dark to light range under 0.82) is stretched, gently.
  s = measure(frames, out);
  const spread = s.p98 - s.p02;
  if (spread < 0.82) out.contrast = round(clamp(((0.86 / Math.max(0.2, spread) - 1) / 0.6) * 100 * 0.6, 0, 35));
  else if (spread > 0.97 && s.hi + s.lo > 0.06) out.contrast = -10;

  // 4. Burnt highlights are brought down, crushed shadows lifted.
  s = measure(frames, out);
  if (s.hi > 0.015) out.highlight = round(-clamp(s.hi * 600, 10, 45));
  if (s.lo > 0.03) out.shadow = round(clamp(s.lo * 300, 8, 35));
  else if (s.p02 < 0.03 && s.p50 < 0.3) out.shadow = 12;

  // 5. Saturation: when even the most colorful parts are pale the picture is washed out and gets more color;
  // when the whole picture is very colorful it gets a little less. (A grey scene with some color is left alone.)
  s = measure(frames, out);
  if (s.vivid < 0.25) out.saturation = round(clamp((0.32 - s.vivid) * 150, 0, 30));
  else if (s.chroma > 0.38) out.saturation = round(-clamp((s.chroma - 0.32) * 120, 0, 20));
  return out;
}

export { measure as measureFrames };
