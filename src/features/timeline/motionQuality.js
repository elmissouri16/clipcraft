// How smooth a clip's animation is, measured frame by frame from the same state the preview and
// the export draw (stateAt / stateAtPinned). CraftAI reviews rendered sections as still images, so
// it cannot see motion; these numbers let it check the motion it built.
//
// Motion per frame is the largest on-screen displacement of the picture's corners, in pixels:
// translation, plus zoom (ln scale change times the half-diagonal) and rotation (angle times the
// half-diagonal). A picture at scale 1 fills the canvas, so this holds for main clips and for
// full-canvas overlays alike.
//
// Defects, each with timeline times:
// - stops: the motion slows to (nearly) zero between two moving stretches and restarts within
//   0.25 s: stop-and-go at a keyframe. A real hold (still for 0.25 s or more) is not a stop.
// - reversals: the zoom (by 4 % or more) or a pan axis (by 2 % of the frame or more) changes
//   direction. Camera "breathing" in and out; smaller wobbles (shakes, pulses) are ignored. A
//   reversal after a real hold (push in, hold, pull back) is marked after_hold.
// - jerks: the speed jumps from one frame to the next by half or more, and by far more than it
//   changes around that frame (linear keys meeting at different speeds, a move starting at full
//   speed). Eased acceleration changes speed steadily and is not a jerk.
// - rotation_jumps: more than 10 degrees in one frame.
// - fast: a pan above 1.5 frame widths per second or a zoom above 120 % per second, held for 0.2 s.
// With entrance true (overlays), the first 0.5 s and the last 0.3 s are an entrance and an exit
// (pops, fly-ins) and are not judged for jerks or speed.

const r2 = (n) => Math.round(n * 100) / 100;
const HOLD_SEC = 0.25, WINDOW_SEC = 0.6;

export function motionQuality(stateAt, { len, fps = 30, width, height, start = 0, entrance = false }) {
  // Whole frames only: a shorter last step would read as a sudden slowdown.
  const n = Math.max(1, Math.floor(len * fps + 1e-6)), half = 0.5 * Math.hypot(width, height);
  const st = [];
  for (let i = 0; i <= n; i++) { const s = stateAt(Math.min(len, i / fps)).transform; st.push({ x: s.x, y: s.y, s: Math.max(1e-4, s.scale), r: s.rot || 0 }); }
  const at = (i) => r2(start + Math.min(len, i / fps));
  // m[i]: motion from frame i-1 to i (m[0] = 0).
  const m = [0], zoom = [0], dx = [0], dy = [0], rot = [0];
  for (let i = 1; i <= n; i++) {
    const a = st[i - 1], b = st[i], radius = half * (a.s + b.s) / 2;
    dx[i] = (b.x - a.x) * width; dy[i] = (b.y - a.y) * height; zoom[i] = Math.log(b.s / a.s); rot[i] = b.r - a.r;
    m[i] = Math.hypot(dx[i], dy[i]) + Math.abs(zoom[i]) * radius + Math.abs(rot[i]) * Math.PI / 180 * radius;
  }
  const peak = Math.max(0, ...m);
  const win = Math.max(2, Math.round(WINDOW_SEC * fps)), holdFrames = Math.max(2, Math.round(HOLD_SEC * fps));

  // Stop-and-go: a dip well below the motion on both sides, without a real hold inside it.
  const stops = [];
  for (let i = 2; i < n; i++) {
    if (!(m[i] <= m[i - 1] && m[i] <= m[i + 1])) continue;
    const left = Math.max(...m.slice(Math.max(1, i - win), i)), right = Math.max(...m.slice(i + 1, Math.min(n, i + win) + 1));
    const around = Math.min(left, right);
    if (around < 0.5 || m[i] > 0.2 * around) continue;
    const still = Math.max(0.003, 0.01 * around);
    let a = i, b = i;
    while (a > 1 && m[a - 1] < still) a--;
    while (b < n && m[b + 1] < still) b++;
    const heldFrames = m[i] < still ? b - a + 1 : 0;
    if (heldFrames >= holdFrames) { i = b; continue; }
    if (!stops.length || i / fps - (stops.at(-1) - start) > 0.15) stops.push(at(i));
  }

  // Direction reversals of the zoom and of each pan axis, ignoring small wobbles.
  const reversals = [];
  // Walk each signal as alternating runs; a reversal is a significant run followed by a
  // significant run the other way.
  const runs = (deltas, scale = 1) => {
    // to: the last frame that moved, so a hold sits between two runs.
    const out = []; let dir = 0, amount = 0, from = 1, last = 1;
    for (let i = 1; i <= n; i++) {
      const d = deltas[i] * scale;
      if (Math.abs(d) < 1e-9) continue;
      const sign = Math.sign(d);
      if (sign !== dir) { if (dir) out.push({ dir, amount, from, to: last }); dir = sign; amount = 0; from = i; }
      amount += Math.abs(d); last = i;
    }
    if (dir) out.push({ dir, amount, from, to: last });
    return out;
  };
  const significant = (list, minimum) => {
    // Merge runs too small to count into their neighbours, then keep the large ones.
    const big = list.filter((r) => r.amount >= minimum);
    const out = [];
    for (const r of big) {
      const prev = out.at(-1);
      if (prev && prev.dir === r.dir) { prev.amount += r.amount; prev.to = r.to; } else out.push({ ...r });
    }
    return out;
  };
  // A still stretch of at least HOLD_SEC between two frames.
  const heldBetween = (from, to) => { let run = 0; for (let i = from; i <= to; i++) { run = m[i] < 0.003 ? run + 1 : 0; if (run >= holdFrames) return true; } return false; };
  const found = [];
  for (const [kind, deltas, minimum, scale] of [['zoom', zoom, Math.log(1.04), 1], ['pan', dx, 0.02, 1 / width], ['pan', dy, 0.02, 1 / height]]) {
    const list = significant(runs(deltas, scale), minimum);
    for (let k = 1; k < list.length; k++) found.push({ kind, i: list[k].from, after_hold: heldBetween(list[k - 1].to, list[k].from) });
  }
  // One event per turn: a zoom that turns back usually moves x and y back with it.
  found.sort((a, b) => a.i - b.i);
  for (const f of found) {
    const prev = reversals.at(-1);
    if (prev && f.i / fps - (prev.at_sec - start) <= 0.15) { if (!prev.kinds.includes(f.kind)) prev.kinds.push(f.kind); prev.after_hold &&= f.after_hold; continue; }
    reversals.push({ at_sec: at(f.i), kinds: [f.kind], after_hold: f.after_hold });
  }

  // Jerks and rotation jumps after the first frames (and outside an overlay's entrance and exit).
  const judged = (i) => i >= 3 && (!entrance || (i / fps >= 0.5 && i / fps <= len - 0.3));
  const jerks = [], rotation_jumps = [];
  for (let i = 3; i <= n; i++) {
    if (!judged(i)) continue;
    const a = m[i - 1], b = m[i], big = Math.max(a, b), jump = Math.abs(b - a);
    const around = Math.max(Math.abs(a - m[i - 2]), i < n ? Math.abs(m[i + 1] - b) : 0);
    if (big >= 3 && jump >= Math.max(3, 0.5 * big) && jump > 2 * around && (!jerks.length || i / fps - (jerks.at(-1) - start) > 0.1)) jerks.push(at(i));
    if (Math.abs(rot[i]) > 10 && rotation_jumps.length < 8) rotation_jumps.push(at(i));
  }

  // Sustained speed.
  const sustained = Math.max(2, Math.round(0.2 * fps));
  const fast = [];
  const longest = (test) => { let run = 0, best = 0, end = 0; for (let i = 1; i <= n; i++) { run = judged(i) && test(i) ? run + 1 : 0; if (run > best) { best = run; end = i; } } return best >= sustained ? at(end - best + 1) : null; };
  const pan = longest((i) => Math.hypot(dx[i], dy[i]) * fps / width > 1.5);
  const zoomFast = longest((i) => Math.abs(zoom[i]) * fps > Math.log(2.2));
  if (pan !== null) fast.push({ kind: 'pan', at_sec: pan });
  if (zoomFast !== null) fast.push({ kind: 'zoom', at_sec: zoomFast });

  const pans = dx.map((d, i) => Math.hypot(d, dy[i]));
  return {
    peak_motion_px_per_frame: r2(peak),
    peak_pan_frame_widths_per_sec: r2(Math.max(0, ...pans) * fps / width),
    peak_zoom_pct_per_sec: r2(Math.min(1000, (Math.exp(Math.max(0, ...zoom.map(Math.abs)) * fps) - 1) * 100)),
    stops: stops.slice(0, 12), reversals: reversals.slice(0, 12), jerks: jerks.slice(0, 12), rotation_jumps, fast,
    smooth: !stops.length && !jerks.length && !rotation_jumps.length,
  };
}
