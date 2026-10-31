// Adjust > Auto: synthetic pictures with a known problem (too warm, too blue, green cast, dark, flat, washed out)
// must come out close to neutral and normal once the sliders autoGrade picks are applied; a good picture is left
// nearly as it is.
// Usage: node scripts/test-autocolor.mjs
import { autoGrade, measureFrames } from '../src/fx/autocolor.js';

const assert = (ok, what) => { if (!ok) { console.error('FAIL:', what); process.exit(1); } };
const W = 96;
const H = 54;
// A "scene": a grey ramp (left to right), a white card, a dark corner and a few colored patches, as 0..1 RGB,
// then the defect: per-channel gains, a gain for everything, a squeeze towards grey.
function scene({ gains = [1, 1, 1], gain = 1, squeeze = 1, desat = 1 } = {}) {
  const data = new Uint8Array(W * H * 3);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let c = [0.05 + 0.85 * (x / W), 0.05 + 0.85 * (x / W), 0.05 + 0.85 * (x / W)];
      if (y < 10 && x > 70) c = [0.92, 0.92, 0.92];
      if (y > 44 && x < 12) c = [0.02, 0.02, 0.02];
      if (y > 20 && y < 30 && x > 20 && x < 30) c = [0.7, 0.25, 0.2];
      if (y > 20 && y < 30 && x > 40 && x < 50) c = [0.2, 0.55, 0.3];
      if (y > 20 && y < 30 && x > 60 && x < 70) c = [0.2, 0.3, 0.7];
      const l = 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
      c = c.map((v) => l + (v - l) * desat);
      c = c.map((v, i) => ((v * gains[i] * gain) - 0.5) * squeeze + 0.5);
      for (let i = 0; i < 3; i++) data[(y * W + x) * 3 + i] = Math.round(Math.max(0, Math.min(1, c[i])) * 255);
    }
  }
  return [{ data, width: W, height: H }];
}
const cast = (s) => Math.max(...s.avg) - Math.min(...s.avg);
const check = (name, frames, test) => {
  const g = autoGrade(frames);
  const before = measureFrames(frames);
  const after = measureFrames(frames, g);
  test(g, before, after);
  console.log(`${name.padEnd(12)} ${JSON.stringify(g)}  cast ${cast(before).toFixed(3)}→${cast(after).toFixed(3)}  mid ${before.p50.toFixed(2)}→${after.p50.toFixed(2)}`);
};

check('good', scene(), (g) => assert(Object.values(g).every((v) => Math.abs(v) <= 12), 'a good picture stays nearly untouched'));
check('too warm', scene({ gains: [1.15, 1, 0.8] }), (g, b, a) => assert(g.temp < -15 && cast(a) < cast(b) / 2, 'warm cast removed'));
check('too blue', scene({ gains: [0.85, 0.95, 1.15] }), (g, b, a) => assert(g.temp > 15 && cast(a) < cast(b) / 2, 'blue cast removed'));
check('green', scene({ gains: [0.92, 1.12, 0.92] }), (g, b, a) => assert(g.tint > 15 && cast(a) < cast(b) / 2, 'green cast removed'));
check('dark', scene({ gain: 0.45 }), (g, b, a) => assert(g.exposure > 30 && a.p50 > 0.36, 'brightened'));
check('bright', scene({ gain: 1.5 }), (g, b, a) => assert(g.exposure < -10 || g.highlight < 0, 'brought down'));
check('flat', scene({ squeeze: 0.55 }), (g, b, a) => assert(g.contrast > 10 && (a.p98 - a.p02) > (b.p98 - b.p02) + 0.1, 'contrast added'));
check('washed out', scene({ desat: 0.25 }), (g) => assert(g.saturation > 5, 'more color'));
console.log('AUTOCOLOR OK');
