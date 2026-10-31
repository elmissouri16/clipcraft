// Detach audio + link behaviour (Stage D): the ffmpeg extraction renders the clip's exact
// range to a cached audio file, and linked pairs stay in sync through the store — move,
// trim, split, speed and delete all propagate or unlink correctly.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { createRequire } from 'module';
import { emptyProject, historyReducer, videoLayout } from '../src/store.js';

const require = createRequire(import.meta.url);
const { detach } = require('../electron/detach.cjs');
const { ffmpegPath, probe } = require('../electron/ffmpeg.cjs');

const fails = [];
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) fails.push(msg); };
const run = (state, actions) => actions.reduce((s, a) => historyReducer(s, a), state);
const state = (p) => ({ past: [], present: p, future: [] });

// ---- Extraction: the clip's range [2, 5] of a 6 s tone file becomes a ~3 s audio file.
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fve-detach-'));
  const src = path.join(dir, 'clip.mp4');
  execFileSync(ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=30:duration=6',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=6', '-shortest', '-pix_fmt', 'yuv420p', src]);
  const item = { path: src, duration: 6, hasAudio: true, type: 'video' };
  const out = await detach(item, { from: 2, to: 5, cacheDir: dir, ffmpegPath });
  ok(fs.existsSync(out) && out.endsWith('.wav'), 'extraction produced a wav file');
  const info = await probe(out);
  ok(info.type === 'audio' && Math.abs(info.duration - 3) < 0.15, `extracted duration ~3s (got ${info.duration})`);
  const again = await detach(item, { from: 2, to: 5, cacheDir: dir, ffmpegPath });
  ok(again === out, 'the same range is served from the cache');
  const other = await detach(item, { from: 0, to: 2, cacheDir: dir, ffmpegPath });
  ok(other !== out && fs.existsSync(other), 'a different range renders a different file');
}

// ---- Link sync through the store. The pair as App's detach flow builds it:
// video v1 (in 1, out 5) muted + linkId L; audio a1 = extracted [1,5]: in 0, out 4,
// linkOff 0, linkInOff -1.
const media = [
  { id: 'm1', path: '/x/a.mp4', type: 'video', duration: 10, hasAudio: true },
  { id: 'm2', path: '/x/b.mp4', type: 'video', duration: 10, hasAudio: true },
  { id: 'w1', path: '/x/a (detached).wav', type: 'audio', duration: 4, hasAudio: true },
];
const pair = () => ({
  ...emptyProject(), media,
  videoClips: [
    { id: 'v0', mediaId: 'm2', in: 0, out: 2, speed: 1, volume: 1, muted: false, filter: 'none', adjust: {}, effects: [], transition: null },
    { id: 'v1', mediaId: 'm1', in: 1, out: 5, speed: 1, volume: 1, muted: true, filter: 'none', adjust: {}, effects: [], transition: null, linkId: 'L' },
  ],
  audioClips: [{ id: 'a1', mediaId: 'w1', start: 2, in: 0, out: 4, speed: 1, volume: 1, fadeIn: 0, fadeOut: 0, linkId: 'L', linkOff: 0, linkInOff: -1 }],
});
const get = (p, list, id) => p[list].find((c) => c.id === id);

// Move: reorder v1 before v0 — its layout start goes 2 -> 0 and the audio follows.
{
  let s = run(state(pair()), [{ type: 'moveVideo', id: 'v1', toIndex: 0 }]);
  ok(videoLayout(s.present.videoClips).find((l) => l.clip.id === 'v1').start === 0, 'video moved to the front');
  ok(get(s.present, 'audioClips', 'a1').start === 0, 'linked audio followed the move');
}

// Trim the video's left edge (magnet off leaves a gap; the start moves): audio trims too.
{
  const p = pair();
  p.magnet = { ...p.magnet, video: false };
  let s = run(state(p), [{ type: 'trimClip', track: 'video', id: 'v1', edge: 'left', delta: 1 }]);
  const a = get(s.present, 'audioClips', 'a1');
  ok(Math.abs(a.start - 3) < 1e-9 && Math.abs(a.in - 1) < 1e-9 && Math.abs(a.out - 4) < 1e-9,
    `audio start/in followed the trim (start ${a.start}, in ${a.in})`);
}

// Trim the AUDIO's right edge: the picture follows (trim together, either direction).
{
  let s = run(state(pair()), [{ type: 'trimClip', track: 'audio', id: 'a1', edge: 'right', delta: 1 }]);
  const v = get(s.present, 'videoClips', 'v1');
  ok(Math.abs(v.out - 4) < 1e-9, `video out followed the audio trim (out ${v.out})`);
}

// Split the video at t=4: both halves split, left pair keeps L, right pair gets a new link.
{
  let s = run(state(pair()), [{ type: 'split', track: 'video', id: 'v1', t: 4, newId: 'v1r' }]);
  const p = s.present;
  const vr = get(p, 'videoClips', 'v1r');
  const auds = p.audioClips.filter((c) => c.linkId);
  ok(p.audioClips.length === 2, 'the audio was split with the video');
  ok(get(p, 'audioClips', 'a1').linkId === 'L' && get(p, 'videoClips', 'v1').linkId === 'L', 'left halves keep the link');
  ok(vr.linkId && vr.linkId !== 'L' && auds.some((c) => c.linkId === vr.linkId), 'right halves form their own linked pair');
  const ar = auds.find((c) => c.linkId === vr.linkId);
  ok(Math.abs(ar.start - 4) < 1e-9 && Math.abs((ar.in - vr.in) - (ar.linkInOff || 0)) < 1e-9,
    'right pair offsets are consistent');
}

// Speed: change the video to 2x — the audio takes the same speed and halved window span.
{
  let s = run(state(pair()), [{ type: 'update', track: 'video', id: 'v1', patch: { speed: 2 } }]);
  const a = get(s.present, 'audioClips', 'a1');
  ok(a.speed === 2 && Math.abs((a.out - a.in) / a.speed - 2) < 1e-9, 'audio speed and span follow the video');
}

// Delete the audio: the video survives, unlinked.
{
  let s = run(state(pair()), [{ type: 'delete', track: 'audio', id: 'a1' }]);
  const v = get(s.present, 'videoClips', 'v1');
  ok(v && !v.linkId, 'deleting one half unlinks the survivor');
}

// Unlink (App clears both sides): later moves no longer propagate.
{
  let s = run(state(pair()), [
    { type: 'updateMany', updates: [
      { track: 'video', id: 'v1', patch: { linkId: undefined, linkOff: undefined, linkInOff: undefined } },
      { track: 'audio', id: 'a1', patch: { linkId: undefined, linkOff: undefined, linkInOff: undefined } },
    ] },
    { type: 'moveVideo', id: 'v1', toIndex: 0 },
  ]);
  ok(get(s.present, 'audioClips', 'a1').start === 2, 'after unlink the audio stays put when the video moves');
}

console.log(fails.length ? `\n${fails.length} FAILURE(S)` : '\nALL PASS');
process.exit(fails.length ? 1 : 0);
