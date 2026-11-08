// Continuous keyframes in the real export: a dot travels through four waypoints; its position is
// measured on every rendered frame (raw export frames: the main track, through the same motion path). With easing 'continuous' it must keep moving through the middle
// waypoints (no stop-and-go) and sit where the preview puts it; per-key 'inout' stops at each one.
// Usage: node tests/unit/export/test-continuous-motion-export.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import ff from '../../../electron/media/ffmpeg.cjs';
import { motionDataPinned } from '../../../src/features/timeline/track.js';
import { stateAt } from '../../../src/features/timeline/anim.js';
import { pathKeys } from '../../../src/features/agent/pathTools.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clipcraft-continuous-export-'));
const W = 320, H = 180, fps = 30, len = 4;
try {
  const bg = path.join(dir, 'bg.png'), dot = path.join(dir, 'dot.png');
  execFileSync(ff.ffmpegPath, ['-v', 'error', '-y', '-f', 'lavfi', '-i', `color=c=0x202020:s=${W}x${H}`, '-frames:v', '1', bg]);
  // A transparent canvas-sized image with an opaque 8 px white square at its centre.
  const pixels = Buffer.alloc(W * H * 4);
  for (let y = H / 2 - 4; y < H / 2 + 4; y++) for (let x = W / 2 - 4; x < W / 2 + 4; x++) pixels.fill(255, (y * W + x) * 4, (y * W + x) * 4 + 4);
  execFileSync(ff.ffmpegPath, ['-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${W}x${H}`, '-i', '-', '-frames:v', '1', dot], { input: pixels });
  const media = [{ ...await ff.probe(bg), id: 'bg', path: bg }, { ...await ff.probe(dot), id: 'dot', path: dot }];
  const points = [{ x: -0.35, y: 0.2 }, { x: -0.1, y: -0.05 }, { x: 0.12, y: 0.1 }, { x: 0.35, y: -0.2 }];
  const { keys } = pathKeys(points, { from: 0.3, to: 3.7, width: W, height: H });
  const render = (easing) => {
    const keyframes = Object.fromEntries(Object.entries(keys).map(([prop, list]) => [prop, list.map(([t, v], i) => ({ t, v, ...(i ? { e: easing } : {}) }))]));
    const clip = { id: 'v', mediaId: 'dot', in: 0, out: len, speed: 1, keyframes };
    const project = { width: W, height: H, fps, background: '#000000', media, videoClips: [clip], overlayClips: [], audioClips: [], textClips: [] };
    project.motion = motionDataPinned(project);
    const { args } = ff.buildExportArgs(project, path.join(dir, 'unused.mp4'), { raw: true });
    const data = execFileSync(ff.ffmpegPath, args, { maxBuffer: 64 * 1024 * 1024 }), bytes = W * H * 4;
    // Centroid of the bright dot on each frame.
    const centres = [];
    for (let f = 0; f < data.length / bytes; f++) {
      let sx = 0, sy = 0, n = 0;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const v = data[f * bytes + (y * W + x) * 4]; if (v > 128) { const w = v - 128; sx += x * w; sy += y * w; n += w; } }
      centres.push(n ? [sx / n, sy / n] : null);
    }
    return { clip, centres };
  };
  const evidence = {};
  for (const easing of ['inout', 'continuous']) {
    const { clip, centres } = render(easing);
    assert.equal(centres.length, len * fps, `${easing}: frame count`);
    assert.ok(centres.every(Boolean), `${easing}: the dot is visible on every frame (missing: ${centres.map((c, i) => c ? null : i).filter((i) => i !== null).slice(0, 12)})`);
    // Where the preview puts it (same stateAt), within a pixel.
    let worst = 0;
    centres.forEach(([x, y], f) => { const t = stateAt(clip, f / fps, len).transform; worst = Math.max(worst, Math.hypot(x - (W / 2 - 0.5 + t.x * W), y - (H / 2 - 0.5 + t.y * H))); });
    // Speed through the middle waypoints (frames well inside the journey).
    const times = keys.x.map(([t]) => t), speeds = centres.slice(1).map(([x, y], i) => Math.hypot(x - centres[i][0], y - centres[i][1]));
    const around = (t) => Math.min(...speeds.slice(Math.round(t * fps) - 2, Math.round(t * fps) + 2));
    const median = [...speeds.slice(Math.round(0.6 * fps), Math.round(3.4 * fps))].sort((a, b) => a - b)[Math.round(1.4 * fps)];
    evidence[easing] = { worst_offset_px: +worst.toFixed(2), median_speed_px: +median.toFixed(2), speed_at_middle_waypoints_px: times.slice(1, -1).map((t) => +around(t).toFixed(2)) };
  }
  fs.writeFileSync(path.join(dir, 'evidence.json'), JSON.stringify(evidence, null, 2));
  // Move-only layers are placed on whole pixels by FFmpeg's overlay (up to 1 px per axis), so the
  // tolerance is 1.5 px: enough to catch any timing difference between preview and export.
  for (const easing of ['inout', 'continuous']) assert.ok(evidence[easing].worst_offset_px <= 1.5, `${easing}: export matches the preview position (${evidence[easing].worst_offset_px} px)`);
  assert.ok(evidence.inout.speed_at_middle_waypoints_px.every((s) => s < 0.35 * evidence.inout.median_speed_px), `per-key inout stops at each waypoint: ${JSON.stringify(evidence.inout)}`);
  assert.ok(evidence.continuous.speed_at_middle_waypoints_px.every((s) => s > 0.5 * evidence.continuous.median_speed_px), `continuous keeps moving through the waypoints: ${JSON.stringify(evidence.continuous)}`);
  console.log('continuous motion export OK', JSON.stringify(evidence));
} finally { fs.rmSync(dir, { recursive: true, force: true }); }
