// A project file is not trusted: none of its values may reach an FFmpeg filter graph as text.
// The loader refuses wrongly typed render fields, and the graph builders coerce what they write
// (numbers, strict hex colours, known transition and blend names, escaped paths), so a value that
// bypasses the loader still cannot add filters of its own.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { emptyProject, normalizeProject, historyReducer, validateProject } from '../../../src/state/store.js';

const require = createRequire(import.meta.url);
const ff = require('../../../electron/media/ffmpeg.cjs');

const EVIL = 'aevalsrc=0,metadata=mode=print:file=/tmp/EVIL;color=c=black';
const video = { id: 'mv', path: '/media/clip.mp4', type: 'video', width: 320, height: 180, duration: 4, hasAudio: true, vcodec: 'h264', pixFmt: 'yuv420p', colorSpace: 'bt709', fps: 30, channels: 2 };
const sound = { id: 'ma', path: '/media/sound.wav', type: 'audio', duration: 4, hasAudio: true, channels: 1 };
const hostile = () => ({
  width: 320, height: 180, fps: 30, background: `#000000,${EVIL}`, media: [video, sound],
  videoClips: [
    { id: 'g', gap: true, in: 0, out: 1 },
    { id: 'v1', mediaId: 'mv', in: 0, out: 2, volume: `1,${EVIL}`, fadeIn: `1,${EVIL}`, fadeOut: { evil: EVIL }, fadeInOffset: EVIL, audioFx: { highpass: EVIL, eq: { low: EVIL }, echo: { delay: EVIL, decay: EVIL }, pitch: EVIL },
      transition: { type: `fade,${EVIL}`, duration: 0.3 } },
    { id: 'v2', mediaId: 'mv', in: 1, out: 3, chroma: { on: true, color: `#00ff00:${EVIL}` }, blend: 'constructor', transition: { type: EVIL, duration: 0.3 } },
  ],
  overlayClips: [{ id: 'o1', mediaId: 'mv', start: 0.5, in: 0, out: 1, volume: EVIL, blend: '__proto__', chroma: { on: true, color: EVIL }, opacity: 0.5 }],
  audioClips: [{ id: 'a1', mediaId: 'ma', start: 0, in: 0, out: 2, volume: `0.5,${EVIL}`, fadeOut: EVIL, audioFx: { lowpass: EVIL, eq: { mid: EVIL, high: EVIL } } }],
  textClips: [], effectClips: [],
});
const graphOf = (args) => args[args.indexOf('-filter_complex') + 1];
const clean = (args, what) => {
  for (const arg of args) assert.ok(!String(arg).includes('EVIL') && !String(arg).includes('aevalsrc'), `${what}: a project value reached the argument list (${String(arg).slice(0, 200)})`);
};

// 1) The graph builders: video export, audio export, analysis audio.
const exported = ff.buildExportArgs(hostile(), '/out/video.mp4', { encoder: 'libx264' }).args;
clean(exported, 'video export');
const graph = graphOf(exported);
assert.match(graph, /color=c=0x000000:/, 'a background that is not a hex colour falls back to the default');
assert.match(graph, /xfade=transition=fade:/, 'an unknown transition name crossfades');
assert.match(graph, /chromakey=color=0x00ff00:/, 'a chroma colour that is not hex falls back to green');
assert.ok(!/all_mode=function|\[native code\]/.test(graph), 'an inherited object key is not a blend mode');
assert.match(graph, /volume=1,/, 'a non-numeric volume plays at unity');
clean(ff.buildAudioExportArgs(hostile(), '/out/sound.m4a', 'm4a'), 'audio export');
clean(ff.buildTimelineAudioArgs(hostile(), '/out/analysis.wav', 'all'), 'analysis audio');
// An unstamped project's frame size and rate come from the project too.
clean(ff.buildExportArgs({ ...hostile(), width: `320,${EVIL}`, height: EVIL, fps: EVIL }, '/out/video.mp4', {}).args, 'unstamped size and rate');
clean(ff.buildExportArgs({ ...hostile(), export: { outW: EVIL, outH: EVIL, outFps: EVIL, crf: EVIL, encoderPreset: EVIL, audioKbps: EVIL } }, '/out/video.mp4', {}).args, 'export stamp');
// Speeds the loader would refuse still never reach setpts as text.
const speedy = hostile(); speedy.videoClips[1].speed = `2,${EVIL}`; speedy.overlayClips[0].speed = EVIL; speedy.audioClips[0].speed = EVIL;
clean(ff.buildExportArgs(speedy, '/out/video.mp4', {}).args, 'speed');
// Valid values are written unchanged.
const plain = hostile();
Object.assign(plain, { background: '#102030' });
Object.assign(plain.videoClips[1], { volume: 0.25, fadeIn: 0.5, fadeOut: 0, fadeInOffset: 0, audioFx: { highpass: 80 }, transition: { type: 'wipeleft', duration: 0.3 } });
Object.assign(plain.videoClips[2], { chroma: { on: true, color: '#0000ff' }, blend: 'screen', transition: { type: 'circleopen', duration: 0.3 } });
const plainGraph = graphOf(ff.buildExportArgs(plain, '/out/video.mp4', {}).args);
for (const part of ['color=c=0x102030:', 'volume=0.25,', 'xfade=transition=wipeleft:', 'xfade=transition=circleopen:', 'chromakey=color=0x0000ff:', 'all_mode=screen', 'highpass=f=80']) assert.ok(plainGraph.includes(part), `valid value kept: ${part}`);

// 2) Paths inside a filter: a quote, colon, comma, semicolon or bracket in the name stays in the name.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clipcraft-graph-values-'));
try {
  const odd = path.join(dir, "it's; a [odd],dir:x");
  fs.mkdirSync(odd);
  const lut = path.join(odd, "lo'ok.cube");
  fs.writeFileSync(lut, `LUT_3D_SIZE 2\n${['0 0 0', '1 0 0', '0 1 0', '1 1 0', '0 0 1', '1 0 1', '0 1 1', '1 1 1'].join('\n')}\n`);
  execFileSync(ff.ffmpegPath, ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc=s=32x32:d=0.1', '-filter_complex',
    `[0:v]lut3d=file='${ff.escapeFilterPath(lut)}':interp=tetrahedral[o]`, '-map', '[o]', '-f', 'null', '-']);
} finally { fs.rmSync(dir, { recursive: true, force: true }); }

// 3) The loader refuses those values in a project file, and keeps what the app writes.
const base = () => ({ ...emptyProject(), media: [video, sound] });
const refused = [
  { background: `#000000,${EVIL}` }, { background: 'black' },
  { videoClips: [{ id: 'v', mediaId: 'mv', in: 0, out: 1, volume: '1' }] },
  { audioClips: [{ id: 'a', mediaId: 'ma', in: 0, out: 1, start: 0, volume: `1,${EVIL}` }] },
  { videoClips: [{ id: 'v', mediaId: 'mv', in: 0, out: 1, transition: { type: `fade,${EVIL}`, duration: 0.5 } }] },
  { videoClips: [{ id: 'v', mediaId: 'mv', in: 0, out: 1, transition: { type: 7 } }] },
  { videoClips: [{ id: 'v', mediaId: 'mv', in: 0, out: 1, transition: 'fade' }] },
  { videoClips: [{ id: 'v', mediaId: 'mv', in: 0, out: 1, transition: { type: 'fade', duration: '0.5' } }] },
  { overlayClips: [{ id: 'o', mediaId: 'mv', in: 0, out: 1, start: 0, chroma: { on: true, color: EVIL } }] },
  { overlayClips: [{ id: 'o', mediaId: 'mv', in: 0, out: 1, start: 0, blend: EVIL }] },
  { audioClips: [{ id: 'a', mediaId: 'ma', in: 0, out: 1, start: 0, fadeIn: '1' }] },
  { audioClips: [{ id: 'a', mediaId: 'ma', in: 0, out: 1, start: 0, fadeOutOffset: EVIL }] },
  { audioClips: [{ id: 'a', mediaId: 'ma', in: 0, out: 1, start: 0, audioFx: { pitch: EVIL } }] },
  { audioClips: [{ id: 'a', mediaId: 'ma', in: 0, out: 1, start: 0, audioFx: { eq: { low: EVIL } } }] },
  { audioClips: [{ id: 'a', mediaId: 'ma', in: 0, out: 1, start: 0, audioFx: { echo: { delay: EVIL } } }] },
  { audioClips: [{ id: 'a', mediaId: 'ma', in: 0, out: 1, start: 0, volumeKeys: [{ t: 0, v: EVIL }] }] },
  { videoClips: [{ id: 'v', mediaId: 'mv', in: 0, out: 1, keyframes: { scale: [{ t: 0, v: EVIL }] } }] },
];
const state = { past: [], present: emptyProject(), future: [] };
for (const patch of refused) {
  const file = JSON.parse(JSON.stringify({ ...base(), ...patch }));
  assert.throws(() => normalizeProject(file), /Invalid project field/, `refused: ${JSON.stringify(patch).slice(0, 120)}`);
  assert.equal(historyReducer(state, { type: 'load', project: file }), state, 'a refused file leaves the open project as it was');
}

// What the reducer writes loads back: clips added through actions, then given the render fields the UI sets.
let p = { ...base(), background: '#203040' };
const act = (a) => { p = historyReducer({ past: [], present: p, future: [] }, a).present; };
act({ type: 'addToTimeline', mediaId: 'mv', clipId: 'v1' });
act({ type: 'addToTimeline', mediaId: 'mv', clipId: 'v2' });
act({ type: 'addToTimeline', mediaId: 'ma', clipId: 'a1', at: 0 });
act({ type: 'addOverlayClip', mediaId: 'mv', clipId: 'o1', at: 1 });
act({ type: 'update', track: 'video', id: 'v2', patch: { transition: { type: 'fx_swirl', duration: 0.6 }, volume: 0.8, fadeIn: 0.4, fadeOut: 0.2, chroma: { on: true, color: '#00ff00', intensity: 20, feather: 20, spill: 0 }, blend: 'softlight', opacity: 0.9, keyframes: { scale: [{ t: 0, v: 1 }, { t: 1, v: 1.2, e: 'easeOut' }] } } });
act({ type: 'update', track: 'video', id: 'v1', patch: { transition: null } });
act({ type: 'update', track: 'audio', id: 'a1', patch: { volume: 1.5, fadeInOffset: 0.1, volumeKeys: [{ t: 0, v: 1 }, { t: 1, v: 0.5 }], audioFx: { eq: { low: -3, mid: 2, high: 3 }, highpass: 80, lowpass: 0, comp: true, limit: false, denoise: true, loudnorm: true, echo: null, pitch: 0 } } });
act({ type: 'update', track: 'overlay', id: 'o1', patch: { transition: { type: 'plugin-transition:studio.creative-pack/one@sha256-0123abcd', duration: 0.5 }, audioFx: { echo: { delay: 180, decay: 0.3 } } } });
const saved = JSON.parse(JSON.stringify(p));
assert.doesNotThrow(() => validateProject(saved));
assert.equal(normalizeProject(saved).videoClips[1].transition.type, 'fx_swirl');
assert.doesNotThrow(() => normalizeProject({ ...emptyProject(), background: '#fff', videoClips: [{ id: 'x', mediaId: 'mv', in: 0, out: 1, volume: null, transition: { type: 'none' } }] }), 'null volume and the none transition load');

console.log('filter graph values: hostile project values never reach FFmpeg arguments; the loader refuses them and keeps app-written projects; quoted paths survive odd names');
