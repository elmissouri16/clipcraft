// Motion tracking: single-point template tracking over a clip's range, in the main process. Frames are pulled
// from FFmpeg as small gray pictures (480 px wide) and followed with normalized cross-correlation in pure JS:
// a template cut around the picked point is searched in a window around its predicted position each frame.
// The result is a path of { t (source seconds), x, y (fractions of the media frame), c (0..1 confidence) },
// cached by file, range, pick and box like the other derivative renders (stabilize / reverse / enhance).
// A frame whose best match is weak does not teleport the path: the search widens once, and if it is still weak
// the point holds the last position and is marked with its low score, so occlusions bend the path, not break it.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const WORK_W = 480; // working width the matching runs at (speed); results are reported in fractions, so this is invisible outside
const TRACK_FPS = 30; // frames per second pulled from the source (the fps filter caps faster sources)
const GOOD = 0.55; // NCC at or above this is a solid match
const WEAK = 0.35; // below this even after widening, the point is held and marked low-confidence
const REACQUIRE = 0.75; // a match found only by the WIDENED search must clear this higher bar: far from the
// prediction, a merely decent score is usually a lookalike pattern (measured: when the fixture's target
// slides behind an occluder, a similar pattern elsewhere scores 0.66 and the path teleports to it).

// ---------- Pure matcher (scripts/test-tracking.cjs exercises this part directly) ----------

// Summed-area tables of a gray frame and of its squares: rectangle sums in O(1) from then on.
function summedArea(buf, w, h) {
  const W = w + 1;
  const s = new Float64Array(W * (h + 1));
  const sq = new Float64Array(W * (h + 1));
  for (let y = 0; y < h; y++) {
    let run = 0;
    let runSq = 0;
    const row = y * w;
    const out = (y + 1) * W;
    const up = y * W;
    for (let x = 0; x < w; x++) {
      const v = buf[row + x];
      run += v;
      runSq += v * v;
      s[out + x + 1] = s[up + x + 1] + run;
      sq[out + x + 1] = sq[up + x + 1] + runSq;
    }
  }
  return { s, sq, W };
}
const rectSum = (tab, W, x, y, rw, rh) => tab[(y + rh) * W + x + rw] - tab[y * W + x + rw] - tab[(y + rh) * W + x] + tab[y * W + x];

// A template cut from a frame, centered on (cx, cy) and clamped inside the frame. norm is the length of the
// zero-mean template vector, so a candidate's NCC is a dot product away.
function makeTemplate(frame, fw, fh, cx, cy, tw, th) {
  tw = Math.max(4, Math.min(tw, fw));
  th = Math.max(4, Math.min(th, fh));
  const x0 = Math.max(0, Math.min(fw - tw, Math.round(cx - tw / 2)));
  const y0 = Math.max(0, Math.min(fh - th, Math.round(cy - th / 2)));
  const data = new Float64Array(tw * th);
  let sum = 0;
  for (let y = 0; y < th; y++) {
    for (let x = 0; x < tw; x++) {
      const v = frame[(y0 + y) * fw + x0 + x];
      data[y * tw + x] = v;
      sum += v;
    }
  }
  const mean = sum / (tw * th);
  let norm = 0;
  for (let i = 0; i < data.length; i++) {
    data[i] -= mean;
    norm += data[i] * data[i];
  }
  return { data, tw, th, x0, y0, norm: Math.sqrt(norm) };
}

// NCC of the template placed with its top-left at (tx, ty) in a frame (ii: the frame's summed-area tables).
function nccAt(frame, fw, ii, tpl, tx, ty) {
  const { tw, th } = tpl;
  const n = tw * th;
  const sumF = rectSum(ii.s, ii.W, tx, ty, tw, th);
  const sumF2 = rectSum(ii.sq, ii.W, tx, ty, tw, th);
  const varF = sumF2 - (sumF * sumF) / n;
  if (varF <= 1e-6 || tpl.norm <= 1e-6) return -1; // a flat patch matches nothing and everything
  let dot = 0;
  const d = tpl.data;
  for (let y = 0; y < th; y++) {
    const row = (ty + y) * fw + tx;
    const trow = y * tw;
    for (let x = 0; x < tw; x++) dot += d[trow + x] * frame[row + x];
  }
  return dot / (tpl.norm * Math.sqrt(varF));
}

// Best template position whose CENTER is within `radius` of (cx, cy). Two stages: a step-2 sweep, then a
// step-1 refinement around the winner — most of the speed, the same winner for any textured patch.
// Returns { x, y } as the center in frame pixels, and the NCC score.
function matchTemplate(frame, fw, fh, tpl, cx, cy, radius) {
  const ii = summedArea(frame, fw, fh);
  const hw = tpl.tw / 2;
  const hh = tpl.th / 2;
  const search = (ccx, ccy, r, step) => {
    let best = null;
    const x1 = Math.max(0, Math.round(ccx - r));
    const x2 = Math.min(fw - tpl.tw, Math.round(ccx + r));
    const y1 = Math.max(0, Math.round(ccy - r));
    const y2 = Math.min(fh - tpl.th, Math.round(ccy + r));
    for (let ty = y1; ty <= y2; ty += step) {
      for (let tx = x1; tx <= x2; tx += step) {
        const score = nccAt(frame, fw, ii, tpl, tx, ty);
        if (!best || score > best.score) best = { tx, ty, score };
      }
    }
    return best;
  };
  let best = search(cx - hw, cy - hh, radius, radius > 8 ? 2 : 1);
  if (best && radius > 8) {
    const fine = search(best.tx, best.ty, 2, 1);
    if (fine && fine.score > best.score) best = fine;
  }
  if (!best) return { x: cx, y: cy, score: -1 };
  // Sub-pixel peak: a parabola through the scores either side of the best offset. Without it the path
  // steps in whole working pixels (4 px at 1080p) and a pinned follower visibly ticks along.
  const sub = (sm, s0, sp) => {
    const d = sm - 2 * s0 + sp;
    if (Math.abs(d) < 1e-9) return 0;
    return Math.max(-1, Math.min(1, (0.5 * (sm - sp)) / d));
  };
  let dx = 0;
  let dy = 0;
  if (best.tx - 1 >= 0 && best.tx + 1 <= fw - tpl.tw) dx = sub(nccAt(frame, fw, ii, tpl, best.tx - 1, best.ty), best.score, nccAt(frame, fw, ii, tpl, best.tx + 1, best.ty));
  if (best.ty - 1 >= 0 && best.ty + 1 <= fh - tpl.th) dy = sub(nccAt(frame, fw, ii, tpl, best.tx, best.ty - 1), best.score, nccAt(frame, fw, ii, tpl, best.tx, best.ty + 1));
  return { x: best.tx + hw + dx, y: best.ty + hh + dy, score: best.score };
}

// Drops points that sit (nearly) on the line between their neighbours — a tracked path is mostly smooth, so
// the stored path stays small; low-confidence (held) points are always kept, they carry information.
function simplifyPoints(pts, tol = 0.0012) {
  if (pts.length <= 2) return pts;
  const out = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const a = out[out.length - 1];
    const b = pts[i];
    const c = pts[i + 1];
    const span = c.t - a.t || 1;
    const k = (b.t - a.t) / span;
    const dx = a.x + (c.x - a.x) * k - b.x;
    const dy = a.y + (c.y - a.y) * k - b.y;
    if (b.c < GOOD || dx * dx + dy * dy > tol * tol) out.push(b);
  }
  out.push(pts[pts.length - 1]);
  return out;
}

// ---------- Engine ----------

const num = (v) => Number(v.toFixed(3)).toString();
const r4 = (v) => Math.round(v * 10000) / 10000;

function outFile(item, from, to, pick, box, cacheDir) {
  const st = fs.statSync(item.path);
  const key = crypto.createHash('sha1')
    .update(`${item.path}|${st.size}|${st.mtimeMs}|track1|${num(from)}|${num(to)}|${r4(pick.x)},${r4(pick.y)}|${r4(box.w)},${r4(box.h)}`)
    .digest('hex').slice(0, 16);
  return path.join(cacheDir, `${key}-track.json`);
}

// item: { path, width, height, duration }. pick / box in fractions of the media frame (pick is the CENTER).
// Returns { points, fps, frames, width, height } — points in source seconds and media-frame fractions.
// onProgress(fraction); isCanceled() stops the job and leaves nothing behind.
async function trackMotion(item, { from = 0, to, pick, box = { w: 0.055, h: 0.095 }, cacheDir, ffmpegPath = require('./ffmpeg.cjs').ffmpegPath, onProgress = () => {}, isCanceled = () => false }) {
  const a = Math.max(0, from);
  const b = Math.min(to ?? item.duration, item.duration || Infinity);
  const len = Math.max(0.1, b - a);
  fs.mkdirSync(cacheDir, { recursive: true });
  const out = outFile(item, a, b, pick, box, cacheDir);
  if (fs.existsSync(out)) {
    try { return { ...JSON.parse(fs.readFileSync(out, 'utf8')), cached: true }; } catch { /* a corrupt cache entry is re-tracked */ }
  }
  const mw = item.width || WORK_W;
  const mh = item.height || Math.round((WORK_W * 9) / 16);
  const workH = Math.max(2, Math.round(((WORK_W * mh) / mw) / 2) * 2);
  const frameBytes = WORK_W * workH;
  const tw = Math.max(16, Math.min(128, Math.round(box.w * WORK_W)));
  const th = Math.max(16, Math.min(128, Math.round(box.h * workH)));
  const totalFrames = Math.max(1, Math.round(len * TRACK_FPS));

  const points = await new Promise((resolve, reject) => {
    const args = ['-hide_banner', '-nostats', '-ss', num(a), '-t', num(len), '-i', item.path,
      '-vf', `fps=${TRACK_FPS},scale=${WORK_W}:${workH}:flags=bilinear,format=gray`,
      '-f', 'rawvideo', '-pix_fmt', 'gray', '-'];
    const p = spawn(ffmpegPath, args, { windowsHide: true });
    let err = '';
    let buf = Buffer.alloc(0);
    let tpl = null;
    let last = null; // last accepted center (working px)
    let vel = { x: 0, y: 0 };
    let idx = 0;
    let settled = false;
    const pts = [];
    const timer = setInterval(() => { if (isCanceled()) p.kill(); }, 200);
    const done = (fn, v) => { if (!settled) { settled = true; clearInterval(timer); fn(v); } };
    p.stderr.on('data', (d) => { err = (err + d).slice(-2000); });
    p.on('error', (e) => done(reject, e));

    // Frame pump: matching a frame is ~10 ms of synchronous JS, and this runs in the app's
    // MAIN process. Draining a whole pipe chunk synchronously starved the event loop for
    // seconds at a time on a slow laptop (window unresponsive during tracking — the K4
    // crash/hang report on a 45 s clip). Frames are queued instead and matched a few at a
    // time, yielding to the event loop between slices so progress, Cancel and the window
    // stay alive; stdout is paused when the queue grows, bounding memory.
    const queue = [];
    let ended = false;
    let endCode = 0;
    let pumping = false;
    const processFrame = (frame) => {
      const t = a + idx / TRACK_FPS;
      if (!tpl) {
        const cx = pick.x * WORK_W;
        const cy = pick.y * workH;
        tpl = makeTemplate(frame, WORK_W, workH, cx, cy, tw, th);
        last = { x: tpl.x0 + tpl.tw / 2, y: tpl.y0 + tpl.th / 2 };
        pts.push({ t: r4(t), x: r4(last.x / WORK_W), y: r4(last.y / workH), c: 1 });
      } else {
        const px = last.x + vel.x;
        const py = last.y + vel.y;
        const radius = Math.max(24, Math.round(tw * 0.9));
        let m = matchTemplate(frame, WORK_W, workH, tpl, px, py, radius);
        let widened = false;
        if (m.score < WEAK) { m = matchTemplate(frame, WORK_W, workH, tpl, px, py, radius * 2.5); widened = true; } // widen once
        // Velocity gate: a match that would teleport the point — many times its recent speed in a
        // single frame — is a lookalike, not the target, however decent its score (measured: a false
        // friend at 0.82, 141 px away in one frame, while the target moved ~6 px/frame). Only an
        // overwhelming match (0.88+) may jump like that. A gated point holds, marked low-confidence.
        const jump = Math.hypot(m.x - last.x, m.y - last.y);
        const plausible = Math.max(3 * Math.hypot(vel.x, vel.y) + 6, 10);
        const gated = jump > plausible && m.score < 0.88;
        if (m.score < WEAK || (widened && m.score < REACQUIRE) || gated) {
          pts.push({ t: r4(t), x: r4(last.x / WORK_W), y: r4(last.y / workH), c: Math.max(0.05, Math.min(0.34, r4(m.score))) });
        } else {
          vel = { x: (m.x - last.x) * 0.6 + vel.x * 0.4, y: (m.y - last.y) * 0.6 + vel.y * 0.4 };
          last = { x: m.x, y: m.y };
          pts.push({ t: r4(t), x: r4(m.x / WORK_W), y: r4(m.y / workH), c: r4(Math.max(0, Math.min(1, m.score))) });
        }
      }
      idx++;
      if (idx % 6 === 0) onProgress(Math.min(0.99, idx / totalFrames));
    };
    const pump = async () => {
      if (pumping) return;
      pumping = true;
      while (queue.length) {
        const slice = queue.splice(0, 3);
        for (const frame of slice) processFrame(frame);
        if (queue.length < 4 && !ended) { try { p.stdout.resume(); } catch { /* already flowing */ } }
        if (queue.length) await new Promise((r) => setImmediate(r));
      }
      pumping = false;
      if (ended) {
        if (isCanceled()) {
          const e = new Error('Canceled.');
          e.canceled = true;
          return done(reject, e);
        }
        if (endCode !== 0 && idx === 0) return done(reject, new Error(`Tracking failed: ${err.trim().split('\n').pop() || `FFmpeg exited with ${endCode}`}`));
        return done(resolve, pts);
      }
    };
    p.on('close', (code) => { ended = true; endCode = code ?? 0; pump(); });
    p.stdout.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      while (buf.length >= frameBytes) {
        queue.push(buf.subarray(0, frameBytes));
        buf = buf.subarray(frameBytes);
      }
      if (queue.length > 8) { try { p.stdout.pause(); } catch { /* noop */ } }
      pump();
    });
  });
  if (!points.length) throw new Error('Tracking produced no frames (is the clip range empty?).');
  const result = { points: simplifyPoints(points), raw: points.length, fps: TRACK_FPS, width: mw, height: mh };
  const part = `${out}.part`;
  fs.writeFileSync(part, JSON.stringify(result));
  fs.renameSync(part, out);
  onProgress(1);
  return result;
}

module.exports = { trackMotion, outFile, summedArea, makeTemplate, matchTemplate, nccAt, simplifyPoints, WORK_W, TRACK_FPS, GOOD, WEAK };
