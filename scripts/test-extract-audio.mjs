// Extract audio (independent): the extractAudio action copies a video clip's sound to
// the audio track as an UNLINKED clip (no linkId, no sync ever after) and mutes the
// source. Covers: speed≠1 (the copy carries the speed so the lengths match), moving /
// deleting the picture leaves the sound alone, one-undo restore, the refusals, and a
// measured export — after extraction the exported sound comes from the extracted clip.
// Usage: node scripts/test-extract-audio.mjs
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { createRequire } from 'module';
import { freeLen, historyReducer, normalizeProject, renderable, videoLayout } from '../src/store.js';

const require = createRequire(import.meta.url);
const ff = require('../electron/ffmpeg.cjs');

const fails = [];
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) fails.push(msg); };
const run = (st, ...actions) => actions.reduce(historyReducer, st);
const mk = (id, mediaId, len, extra = {}) => ({ id, mediaId, in: 0, out: len, speed: 1, volume: 1, muted: false, transition: null, ...extra });
const fresh = (clips) => ({
  past: [],
  present: {
    ...normalizeProject({}),
    media: [{ id: 'v', type: 'video', duration: 12, hasAudio: true }, { id: 's', type: 'video', duration: 12, hasAudio: false }],
    videoClips: clips,
  },
  future: [],
});
const get = (p, list, id) => p[list].find((c) => c.id === id);

// ---- Speed 1: an independent copy at the clip's timeline position.
{
  const st = run(fresh([mk('a', 'v', 2), mk('b', 'v', 3)]), { type: 'extractAudio', track: 'video', id: 'b', newId: 'x' });
  const x = get(st.present, 'audioClips', 'x');
  ok(!!x, 'extract made an audio clip');
  ok(x && x.start === 2 && x.in === 0 && x.out === 3, `timing copied (start ${x?.start}, in ${x?.in}, out ${x?.out})`);
  ok(x && x.speed === 1 && freeLen('audio', x) === 3, 'length matches the picture (3 s)');
  ok(x && !('linkId' in x && x.linkId), 'extracted clip carries NO linkId');
  ok(get(st.present, 'videoClips', 'b').muted === true, 'source clip muted');
  ok(!get(st.present, 'videoClips', 'b').linkId, 'source clip not linked either');
  // One undo step restores both sides.
  const un = run(st, { type: 'undo' });
  ok(un.present.audioClips.length === 0 && un.present.videoClips[1].muted === false, 'one undo restores (no audio clip, source unmuted)');
}

// ---- Speed 2: allowed now — the copy carries the speed, lengths still match.
{
  const st = run(fresh([mk('a', 'v', 2), mk('b', 'v', 8, { speed: 2 })]), { type: 'extractAudio', track: 'video', id: 'b', newId: 'x' });
  const x = get(st.present, 'audioClips', 'x');
  ok(!!x, 'extract from a 2x clip works (was refused before)');
  ok(x && x.speed === 2, `copy carries the speed (got ${x?.speed})`);
  const pic = videoLayout(st.present.videoClips).find((l) => l.clip.id === 'b');
  ok(x && Math.abs(freeLen('audio', x) - (pic.end - pic.start)) < 1e-9 && x.start === pic.start,
    `audio span ${x?.start}+${x && freeLen('audio', x)} == picture span ${pic.start}+${pic.end - pic.start}`);
}

// ---- Independence: move and delete the picture; the sound does not follow.
{
  let st = run(fresh([mk('a', 'v', 2), mk('b', 'v', 3), mk('c', 'v', 2)]), { type: 'extractAudio', track: 'video', id: 'b', newId: 'x' });
  st = run(st, { type: 'moveVideo', id: 'b', toIndex: 0 });
  ok(get(st.present, 'audioClips', 'x').start === 2, 'moving the video left the audio at 2 s');
  st = run(st, { type: 'delete', track: 'video', id: 'b' });
  ok(st.present.videoClips.length === 2 && !!get(st.present, 'audioClips', 'x'), 'deleting the video kept the audio clip');
  ok(renderable(st.present).audioClips.some((c) => c.id === 'x'), 'the extracted clip is in the renderable (export) project');
}

// ---- Overlay source: start is the clip's own start.
{
  const base = fresh([]);
  base.present.overlayClips = [{ id: 'o', mediaId: 'v', start: 4, in: 1, out: 4, speed: 1, volume: 1, muted: false }];
  const st = run(base, { type: 'extractAudio', track: 'overlay', id: 'o', newId: 'x' });
  const x = get(st.present, 'audioClips', 'x');
  ok(x && x.start === 4 && x.in === 1 && x.out === 4, `overlay extract timing (start ${x?.start}, in ${x?.in}, out ${x?.out})`);
}

// ---- Refusals: silent media, an already-muted clip — nothing happens.
{
  const silent = run(fresh([mk('a', 's', 2)]), { type: 'extractAudio', track: 'video', id: 'a', newId: 'x' });
  ok(silent.present.audioClips.length === 0, 'silent media refused');
  const muted = run(fresh([mk('a', 'v', 2, { muted: true })]), { type: 'extractAudio', track: 'video', id: 'a', newId: 'x' });
  ok(muted.present.audioClips.length === 0, 'muted clip refused');
}

// ---- Measured export: the sound in the file comes from the extracted clip alone.
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fve-extract-'));
  const src = path.join(dir, 'talk.mp4');
  execFileSync(ff.ffmpegPath, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=0x3366cc:s=320x180:r=30:d=4',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=4', '-shortest', '-pix_fmt', 'yuv420p', src]);
  const item = { ...(await ff.probe(src)), path: src, id: 'm', name: 'talk.mp4' };
  const base = {
    ...normalizeProject({}), width: 320, height: 180, fps: 30, media: [item],
    videoClips: [{ id: 'a', mediaId: 'm', in: 0, out: 4, speed: 1, volume: 1, muted: false, filter: 'none', adjust: {}, effects: [], transition: null }],
  };
  const { spawnSync } = await import('child_process');
  const meanOf = (file) => {
    const r = spawnSync(ff.ffmpegPath, ['-i', file, '-af', 'volumedetect', '-f', 'null', '-'], { encoding: 'utf8' });
    return Number(/mean_volume:\s*(-?[\d.]+)/.exec(r.stderr || '')?.[1] ?? 'NaN');
  };
  const st = run({ past: [], present: base, future: [] }, { type: 'extractAudio', track: 'video', id: 'a', newId: 'x' });
  const withX = path.join(dir, 'with.mp4');
  await ff.runExport(renderable(st.present), withX, () => {}).promise;
  const v1 = meanOf(withX);
  ok(v1 > -30, `export with the extracted clip has the tone (mean ${v1} dB)`);
  const st2 = run(st, { type: 'delete', track: 'audio', id: 'x' });
  const withoutX = path.join(dir, 'without.mp4');
  await ff.runExport(renderable(st2.present), withoutX, () => {}).promise;
  const v2 = meanOf(withoutX);
  ok(Number.isNaN(v2) || v2 < -60, `same project minus the extracted clip is silent (mean ${v2} dB)`);
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log(fails.length ? `\n${fails.length} FAILURES` : '\nEXTRACT AUDIO OK');
process.exit(fails.length ? 1 : 0);
