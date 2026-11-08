// remove_silences only removes real pauses inside selected, audible clips. The
// analysis mix is also silent wherever nothing selected plays (other clips,
// photos, silent b-roll, or pieces of a clip that earlier ripple cuts split
// into new IDs); that synthetic silence must never be cut. Real FFmpeg.
// Usage: node tests/unit/agents/test-silence-scope.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import ff from '../../../electron/media/ffmpeg.cjs';
import { emptyProject, historyReducer, exportDuration, videoLayout } from '../../../src/state/store.js';
import { createToolRunner } from '../../../src/features/agent/tools.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clipcraft-silence-scope-'));
const checks = [];
const check = async (name, fn) => { await fn(); checks.push(name); };
const near = (a, b, eps = 0.05) => assert.ok(Math.abs(a - b) <= eps, `${a} ≈ ${b}`);
// The same host contract as agent:silences in electron/main.cjs.
const host = { agentSilences: async (p, o) => ({ ok: true, silences: await ff.detectSilences(p, o), audible: ff.audibleIntervals(p, { source: o.source || 'all', clip_ids: o.clip_ids }) }) };
const runner = state => createToolRunner({ getProject: () => state.present, dispatch: a => { state.present = historyReducer(state, a).present; }, settle: async () => {}, api: host });
try {
  // 12 s of speech-like tone with real pauses at 2–3 s and 8–9 s.
  const talk = path.join(dir, 'talk.wav'), photo = path.join(dir, 'photo.png');
  execFileSync(ff.ffmpegPath, ['-v', 'error', '-y', '-f', 'lavfi', '-i', "aevalsrc='if(between(t,2,3)+between(t,8,9),0,0.2*sin(2*PI*300*t))':s=16000:d=12", talk]);
  execFileSync(ff.ffmpegPath, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=blue:s=64x64:d=1', '-frames:v', '1', photo]);
  const media = [{ id: 'talk', type: 'video', path: talk, name: 'Talk', duration: 12, hasAudio: true, channels: 1 }, { id: 'pic', type: 'image', path: photo, name: 'Photo', width: 64, height: 64 }];

  await check('audible intervals follow the render: transitions overlap, muted and photo clips do not count', () => {
    const p = { ...emptyProject(), media, videoClips: [
      { id: 'a', mediaId: 'talk', in: 0, out: 4, speed: 1 }, { id: 'b', mediaId: 'pic', in: 0, out: 3, speed: 1 },
      { id: 'c', mediaId: 'talk', in: 4, out: 8, speed: 2, transition: { type: 'fade', duration: 1 } }, { id: 'd', mediaId: 'talk', in: 8, out: 12, speed: 1, muted: true }],
      audioClips: [{ id: 'x', mediaId: 'talk', start: 20, in: 0, out: 2, speed: 1 }] };
    const layout = videoLayout(p.videoClips);
    const spans = ff.audibleIntervals(p);
    assert.equal(spans.length, 3);
    near(spans[0].start, 0); near(spans[0].end, 4);
    near(spans[1].start, layout[2].start); near(spans[1].end, layout[2].end); // speed and transition overlap match the editor's layout
    near(spans[2].start, 20); near(spans[2].end, 22);
    assert.deepEqual(ff.audibleIntervals(p, { clip_ids: ['c'] }).map(s => [Math.round(s.start * 100) / 100, Math.round(s.end * 100) / 100]), [[Math.round(layout[2].start * 100) / 100, Math.round(layout[2].end * 100) / 100]]);
  });

  await check('a clip split by earlier cuts: selecting its first piece never removes the other pieces', async () => {
    // What ripple cuts leave behind: the original id names only the first piece.
    const state = { past: [], future: [], present: { ...emptyProject(), fps: 30, media, videoClips: [
      { id: 'v', mediaId: 'talk', in: 0, out: 5, speed: 1 }, { id: 'v2', mediaId: 'talk', in: 5, out: 12, speed: 1 }] } };
    const res = await runner(state).run('remove_silences', { clip_ids: ['v'], min_silence_sec: 0.5, keep_padding_sec: 0.1 });
    assert.equal(res.status, 'applied'); assert.equal(res.removed_count, 1);
    near(res.removed_sec, 0.8, 0.07); // only the real 2–3 s pause inside the first piece
    near(exportDuration(state.present), 12 - 0.8, 0.07);
    assert.match(res.note, /Only pauses inside the 5 s/); near(res.analyzed_sec, 5);
  });

  await check('selecting the whole track still removes every real pause', async () => {
    const state = { past: [], future: [], present: { ...emptyProject(), fps: 30, media, videoClips: [
      { id: 'v', mediaId: 'talk', in: 0, out: 5, speed: 1 }, { id: 'v2', mediaId: 'talk', in: 5, out: 12, speed: 1 }] } };
    const res = await runner(state).run('remove_silences', { source: 'video', min_silence_sec: 0.5, keep_padding_sec: 0.1 });
    assert.equal(res.removed_count, 2); near(res.removed_sec, 1.6, 0.1); assert.equal(res.note, undefined);
  });

  await check('a photo or silent b-roll on the main track is not "silence"', async () => {
    const state = { past: [], future: [], present: { ...emptyProject(), fps: 30, media, videoClips: [
      { id: 'v', mediaId: 'talk', in: 0, out: 4, speed: 1 }, { id: 'p', mediaId: 'pic', in: 0, out: 4, speed: 1 }, { id: 'v3', mediaId: 'talk', in: 4, out: 8, speed: 1, muted: true }] } };
    const res = await runner(state).run('remove_silences', { min_silence_sec: 0.5, keep_padding_sec: 0.1 });
    assert.equal(res.removed_count, 1); near(exportDuration(state.present), 12 - 0.8, 0.07);
    assert.deepEqual(state.present.videoClips.filter(c => !c.gap).map(c => c.mediaId).filter(id => id === 'pic'), ['pic']);
    near(state.present.videoClips.find(c => c.id === 'p').out - state.present.videoClips.find(c => c.id === 'p').in, 4, 0.01);
  });

  await check('narration on the audio track only scopes cuts to where it plays', async () => {
    const state = { past: [], future: [], present: { ...emptyProject(), fps: 30, media, videoClips: [{ id: 'v', mediaId: 'talk', in: 0, out: 12, speed: 1, muted: true }],
      audioClips: [{ id: 'n', mediaId: 'talk', start: 6, in: 6, out: 10, speed: 1 }] } };
    const res = await runner(state).run('remove_silences', { source: 'audio', min_silence_sec: 0.5, keep_padding_sec: 0.1 });
    assert.equal(res.removed_count, 1); near(res.removed_sec, 0.8, 0.07); // the 8–9 s pause inside the narration, not 0–6 s or 10–12 s
  });
  console.log(`${checks.length} silence scope checks passed`);
} finally { fs.rmSync(dir, { recursive: true, force: true }); }
