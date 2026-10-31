// Clip animations and keyframes: the motion model (src/anim.js), the curves sent to FFmpeg, and an export whose
// pixels must follow the same motion as the player.
// Usage: node scripts/test-anim.cjs
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { ffmpegPath, probe, runExport } = require('../electron/ffmpeg.cjs');
const { shiftCurves } = require('../electron/layers.cjs');

const W = 640;
const H = 360;
const assert = (ok, what) => { if (!ok) throw new Error(what); };
const close = (a, b, tol, what) => assert(Math.abs(a - b) <= tol, `${what}: got ${a}, expected ${b} ± ${tol}`);

(async () => {
  const A = await import('../src/anim.js');
  const { historyReducer } = await import('../src/store.js');
  const reducer = (p, a) => historyReducer({ past: [], present: p, future: [] }, a).present;

  // ---- Motion model ----
  const base = { id: 'c', mediaId: 'm', in: 0, out: 4, speed: 1, transform: { scale: 0.5, x: 0.1 } };
  let s = A.stateAt(base, 1, 4);
  close(s.transform.scale, 0.5, 1e-9, 'static scale');
  close(s.opacity, 1, 1e-9, 'static opacity');

  const fade = { ...base, anim: { in: { type: 'fade_in', duration: 1 }, out: { type: 'slide_left_out', duration: 1 } } };
  close(A.stateAt(fade, 0, 4).opacity, 0, 1e-9, 'fade in starts transparent');
  close(A.stateAt(fade, 0.5, 4).opacity, 0.5, 1e-9, 'fade in halfway');
  close(A.stateAt(fade, 2, 4).opacity, 1, 1e-9, 'rest after fade in');
  close(A.stateAt(fade, 4, 4).transform.x, 0.1 - 1, 1e-9, 'slide left out ends one frame width to the left');
  // In + Out longer than the clip are shortened to fit.
  const both = A.animOf({ anim: { in: { type: 'fade_in', duration: 3 }, out: { type: 'fade_out', duration: 3 } } }, 4);
  close(both.in.duration + both.out.duration, 4, 1e-9, 'in + out fit the clip');
  assert(!A.animOf({ anim: { in: { type: 'fade_in' }, combo: { type: 'pulse' } } }, 4).in, 'a combo replaces in / out');

  // Keyframes are in source time: speed 2 plays them twice as fast.
  const kf = { ...base, keyframes: { scale: [{ t: 0, v: 1 }, { t: 2, v: 2 }] } };
  close(A.stateAt(kf, 1, 4).transform.scale, 1.5, 1e-9, 'keyframe interpolation');
  close(A.stateAt({ ...kf, speed: 2 }, 0.5, 2).transform.scale, 1.5, 1e-9, 'keyframes follow the speed');
  close(A.stateAt(kf, 3, 4).transform.scale, 2, 1e-9, 'held after the last keyframe');
  let patch = A.editAt(kf, { scale: 3, x: 0.2 }, 1);
  assert(patch.keyframes.scale.length === 3 && patch.keyframes.scale[1].v === 3, 'editing a keyframed value adds a keyframe');
  assert(patch.transform.x === 0.2 && !patch.keyframes.x, 'editing a plain value changes it for the whole clip');
  patch = A.addKeys(base, ['x', 'y'], 2);
  assert(patch.keyframes.x[0].v === 0.1 && patch.keyframes.y[0].t === 2, 'add keyframe keeps the current value');
  const withKey = { ...base, ...patch };
  assert(A.keyAt(withKey, 'x', 2.01, 30), 'keyframe found within half a frame');
  patch = A.removeKeys(withKey, ['x', 'y'], 2);
  assert(!patch.keyframes.x && patch.transform.x === 0.1, 'removing the last keyframe keeps the value');
  // Easing on the keyframe a segment arrives at (like Remotion's Easing): faster early with "out", spring settles
  // without passing the target, "back" overshoots a little, the ends stay exact; the export curves follow.
  const eased = (e) => ({ ...base, keyframes: { scale: [{ t: 0, v: 1 }, { t: 2, v: 2, ...(e ? { e } : {}) }] } });
  const at = (e, lt) => A.stateAt(eased(e), lt, 4).transform.scale;
  close(at(undefined, 0.5), 1.25, 1e-9, 'no easing is linear');
  assert(at('out', 0.5) > 1.5 && at('in', 0.5) < 1.1, `out ${at('out', 0.5)}, in ${at('in', 0.5)}`);
  close(at('inout', 1), 1.5, 1e-9, 'inout is half way at half time');
  for (const e of Object.keys(A.EASINGS)) close(at(e, 2), 2, 1e-9, `${e} ends on the keyframe`);
  const spring = [0.2, 0.6, 1, 1.4, 1.8].map((lt) => at('spring', lt));
  assert(spring.every((v, i) => v <= 2 + 1e-9 && (i === 0 || v >= spring[i - 1])), `spring rises without bounce: ${spring}`);
  assert([1.2, 1.4, 1.6].some((lt) => at('back', lt) > 2), 'back overshoots');
  const curve = A.motionCurves(eased('out'), 2, 30).s;
  const near05 = curve.reduce((b, p) => (Math.abs(p[0] - 0.5) < Math.abs(b[0] - 0.5) ? p : b));
  assert(Math.abs(near05[1] - at('out', near05[0])) < 0.01, 'export curve follows the easing');
  // Editing or moving a keyframe keeps its easing.
  patch = A.editAt(eased('spring'), { scale: 3 }, 2);
  assert(patch.keyframes.scale[1].e === 'spring' && patch.keyframes.scale[1].v === 3, 'edit keeps easing');
  patch = A.moveKeys(eased('back'), 2, 1.5);
  assert(patch.keyframes.scale.find((k) => k.v === 2).e === 'back', 'move keeps easing');

  // Dragging a keyframe on the timeline moves it with its value; with speed 2, local 1s is source 2s.
  patch = A.moveKeys({ ...kf, speed: 2 }, 1, 0.5);
  assert(patch.keyframes.scale.length === 2 && patch.keyframes.scale[1].t === 1 && patch.keyframes.scale[1].v === 2, 'moving a keyframe keeps its value');
  patch = A.moveKeys(kf, 2, 0);
  assert(patch.keyframes.scale.length === 1 && patch.keyframes.scale[0].v === 2, 'a keyframe moved onto another replaces it');

  // Split: In stays on the left part, Out goes to the right one, keyframes stay on both.
  const proj = {
    width: W, height: H, fps: 30, media: [{ id: 'm', type: 'video', duration: 10 }], overlayClips: [], textClips: [], audioClips: [], stickerClips: [], effectClips: [], markers: [],
    videoClips: [{ ...fade, keyframes: kf.keyframes }],
  };
  const split = reducer(proj, { type: 'split', track: 'video', id: 'c', t: 2, newId: 'd' });
  const [L, R] = split.videoClips;
  assert(L.anim.in && !L.anim.out && R.anim.out && !R.anim.in, 'split shares the animations');
  close(A.stateAt(R, 0, 2).transform.scale, A.stateAt(kf, 2, 4).transform.scale, 1e-9, 'split keeps the keyframed values');

  // Curves for FFmpeg stay within a fraction of a pixel of the player's motion, for every animation.
  const kinds = [...A.ANIMATIONS.in.map((a) => ({ in: { type: a.id, duration: 0.8 } })), ...A.ANIMATIONS.out.map((a) => ({ out: { type: a.id, duration: 0.8 } })),
    ...A.ANIMATIONS.combo.map((a) => ({ combo: { type: a.id } }))];
  const lerp = (pts, t) => {
    if (pts.length === 1 || t <= pts[0][0]) return pts[0][1];
    for (let i = 1; i < pts.length; i++) if (t <= pts[i][0]) return pts[i - 1][1] + ((pts[i][1] - pts[i - 1][1]) * (t - pts[i - 1][0])) / (pts[i][0] - pts[i - 1][0]);
    return pts[pts.length - 1][1];
  };
  let points = 0;
  for (const anim of kinds) {
    const clip = { ...base, anim, keyframes: { rot: [{ t: 0, v: 0 }, { t: 4, v: 30 }] } };
    const cur = A.motionCurves(clip, 4, 30);
    for (let i = 0; i <= 120; i++) {
      const lt = i / 30;
      const m = A.stateAt(clip, lt, 4);
      const name = JSON.stringify(anim);
      close(lerp(cur.s, lt), m.transform.scale, 0.0021, `${name} scale`);
      close(lerp(cur.x, lt), m.transform.x, 0.00061, `${name} x`);
      close(lerp(cur.y, lt), m.transform.y, 0.00061, `${name} y`);
      close(lerp(cur.r, lt), m.transform.rot, 0.11, `${name} rotation`);
      close(lerp(cur.o, lt), m.opacity, 0.0041, `${name} opacity`);
    }
    points += Object.values(cur).reduce((n, p) => n + p.length, 0);
  }
  const sh = shiftCurves({ s: [[0, 1], [2, 3]] }, 1);
  assert(sh.s[0][1] === 2 && sh.s[1][0] === 1, 'curves shifted for a transition');
  console.log(`motion model ok (${kinds.length} animations, ${points} curve points)`);

  // ---- Export ----
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fve-anim-'));
  const gen = (args) => execFileSync(ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', ...args]);
  const black = path.join(dir, 'black.png');
  const white = path.join(dir, 'white.png');
  const bar = path.join(dir, 'bar.png');
  gen(['-f', 'lavfi', '-i', `color=c=black:s=${W}x${H}`, '-frames:v', '1', black]);
  gen(['-f', 'lavfi', '-i', `color=c=white:s=${W}x${H}`, '-frames:v', '1', white]);
  gen(['-f', 'lavfi', '-i', 'color=c=white:s=320x36', '-frames:v', '1', bar]);
  const media = [];
  for (const [id, p] of [['k', black], ['w', white], ['b', bar]]) media.push({ id, path: p, name: path.basename(p), ...(await probe(p)) });
  const clip = { volume: 1, muted: false, filter: 'none', adjust: {}, effects: [], transition: null, speed: 1 };
  const project = {
    name: 'anim', width: W, height: H, fps: 30, background: '#000000', media,
    videoClips: [{ ...clip, id: 'bg', mediaId: 'k', in: 0, out: 6 }],
    overlayClips: [
      // Quarter size, moving from x -0.3 to 0.3 (keyframes) and zooming in over its first second.
      { ...clip, id: 'o1', mediaId: 'w', start: 0, in: 0, out: 2, transform: { scale: 0.25 },
        keyframes: { x: [{ t: 0, v: -0.3 }, { t: 2, v: 0.3 }] }, anim: { in: { type: 'zoom_in', duration: 1 } } },
      // A bar turning from 0 to 90 degrees.
      { ...clip, id: 'o2', mediaId: 'b', start: 2, in: 0, out: 2, transform: { scale: 0.5 }, keyframes: { rot: [{ t: 0, v: 0 }, { t: 2, v: 90 }] } },
      // Full frame, fading in over one second.
      { ...clip, id: 'o3', mediaId: 'w', start: 4, in: 0, out: 2, anim: { in: { type: 'fade_in', duration: 1 } } },
    ],
    textClips: [], audioClips: [], stickerClips: [],
  };
  project.motion = A.motionData(project);
  const out = path.join(dir, 'out.mp4');
  await runExport(project, out, () => {}).promise;

  const frameAt = (t) => execFileSync(ffmpegPath, ['-v', 'error', '-ss', String(t), '-i', out, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'gray', '-']);
  // Bounding box and centroid of the bright pixels.
  const box = (buf) => {
    let x0 = W; let x1 = -1; let y0 = H; let y1 = -1; let sx = 0; let n = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (buf[y * W + x] < 128) continue;
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); sx += x; n++;
    }
    return { w: x1 - x0 + 1, h: y1 - y0 + 1, cx: sx / n };
  };
  const expect = (t, id) => {
    const c = project.overlayClips.find((x) => x.id === id);
    return A.stateAt(c, t - c.start, 2).transform;
  };

  for (const t of [0.5, 1.5]) {
    const b = box(frameAt(t));
    const m = expect(t, 'o1');
    close(b.cx, (0.5 + m.x) * W - 0.5, 3, `keyframed position at ${t}s`);
    close(b.w, m.scale * W, 4, `zoom in width at ${t}s`);
  }
  for (const t of [3, 3.9]) {
    const b = box(frameAt(t));
    const a = (expect(t, 'o2').rot * Math.PI) / 180;
    // The 320x36 bar is fitted to 640x72, then scaled by 0.5: 320x36 on screen.
    close(b.w, 320 * Math.cos(a) + 36 * Math.sin(a), 6, `rotated width at ${t}s`);
    close(b.h, 320 * Math.sin(a) + 36 * Math.cos(a), 6, `rotated height at ${t}s`);
  }
  const mid = frameAt(4.5)[(H / 2) * W + W / 2];
  close(mid, 255 * 0.5, 14, 'fade in halfway');
  close(frameAt(5.5)[(H / 2) * W + W / 2], 255, 6, 'opaque after the fade');
  fs.rmSync(dir, { recursive: true, force: true });
  console.log('export follows the motion: position, zoom, rotation, opacity ok');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
