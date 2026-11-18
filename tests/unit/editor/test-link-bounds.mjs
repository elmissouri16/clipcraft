// Linked pairs (Detach audio / Link clips) stay inside their bounds: no edit leaves a sound
// starting before 0 or reading outside its file, a duplicated layer never shares a link, and
// Detach's one-step insert is all or nothing on an open layer. The export never builds a
// negative delay. Usage: node tests/unit/editor/test-link-bounds.mjs
import { createRequire } from 'node:module';
import { historyReducer, normalizeProject, videoLayout, findLinkPartner, openLayer, renderable, linkPairBatch } from '../../../src/state/store.js';

const require = createRequire(import.meta.url);
const { buildExportArgs } = require('../../../electron/media/ffmpeg.cjs');
const fails = [];
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) fails.push(msg); };
const run = (s, ...actions) => actions.reduce((st, a) => historyReducer(st, a), s);
const state = (p) => ({ past: [], present: normalizeProject(p), future: [] });
const video = (id, inPt, out, extra = {}) => ({ id, mediaId: 'v', in: inPt, out, speed: 1, volume: 1, muted: false, transition: null, ...extra });

// 1. A mic linked 1 s before its picture: deleting the clip before the picture (magnet on) would
//    move the mic to -1 s. The edit is refused; the export of such a project never delays by < 0.
{
  let s = state({ id: 'p', width: 160, height: 90,
    media: [{ id: 'v', type: 'video', path: '/m/v.mp4', duration: 10, hasAudio: true, width: 160, height: 90 },
      { id: 'mic', type: 'audio', path: '/m/mic.wav', duration: 12, hasAudio: true }],
    videoClips: [video('A', 0, 4), video('B', 4, 9, { muted: true, linkId: 'L' })],
    audioClips: [{ id: 'M', mediaId: 'mic', start: 3, in: 0, out: 5, speed: 1, volume: 1, linkId: 'L', linkOff: -1, linkInOff: -4 }] });
  const before = s.present;
  s = run(s, { type: 'delete', track: 'video', id: 'A' });
  ok(s.present === before, 'a delete that would start the linked mic at -1 s is refused');
  ok(s.present.audioClips[0].start === 3, 'the mic keeps its start');
  // An older project that already holds a negative start still exports.
  const broken = { ...before, audioClips: [{ ...before.audioClips[0], start: -1 }] };
  const args = buildExportArgs(renderable(broken), '/tmp/out.mp4', {});
  const graph = (Array.isArray(args) ? args : args.args).join(' ');
  ok(!/adelay=-/.test(graph), 'the export clamps a negative start to a zero delay');
}

// 2. Detached sound of an overlay holds source 4..7 only: extending the picture's head past 4 s
//    would read the detached file before 0. Refused; a trim inside the range still follows.
{
  let s = state({ id: 'p', magnet: { video: true, overlay: false, audio: false, text: false },
    media: [{ id: 'v', type: 'video', path: '/m/v.mp4', duration: 10, hasAudio: true, width: 160, height: 90 },
      { id: 'det', type: 'audio', path: '/c/det.wav', duration: 3, hasAudio: true, origin: 'detach' }],
    videoClips: [video('BG', 0, 8, { muted: true })],
    overlayClips: [{ ...video('O', 4, 7, { muted: true, linkId: 'L' }), start: 3, layer: 0, transform: { scale: 0.5, x: 0, y: 0 } }],
    audioClips: [{ id: 'S', mediaId: 'det', start: 3, in: 0, out: 3, speed: 1, volume: 1, linkId: 'L', linkOff: 0, linkInOff: -4 }] });
  const before = s.present;
  s = run(s, { type: 'update', track: 'overlay', id: 'O', patch: { in: 3, start: 2 } });
  ok(s.present === before, 'extending the picture before the detached window is refused');
  s = run(s, { type: 'update', track: 'overlay', id: 'O', patch: { out: 8 } });
  ok(s.present === before, 'extending the picture past the detached window is refused');
  s = run(s, { type: 'update', track: 'overlay', id: 'O', patch: { in: 5, start: 4 } });
  const snd = s.present.audioClips[0];
  ok(snd.in === 1 && snd.start === 4, 'a trim inside the window still moves the sound with its picture');
}

// 3. Duplicate layer: copies never share the original's link (main track and overlay layer).
{
  const media = [{ id: 'v', type: 'video', path: '/m/v.mp4', duration: 20, hasAudio: true, width: 1920, height: 1080 },
    { id: 'det', type: 'audio', path: '/c/det.wav', duration: 5, hasAudio: true, origin: 'detach' }];
  let s = state({ id: 'p', media, videoClips: [video('A', 0, 3), video('B', 10, 15, { muted: true, linkId: 'L' })],
    audioClips: [{ id: 'S', mediaId: 'det', start: 3, in: 0, out: 5, speed: 1, linkId: 'L', linkOff: 0, linkInOff: -10 }] });
  s = run(s, { type: 'duplicateLayer', track: 'video', newIds: ['c0', 'c1'] });
  ok(s.present.overlayClips.every((c) => !c.linkId && c.linkOff === undefined), 'main-track copies carry no link');
  ok(findLinkPartner(s.present, s.present.videoClips[1])?.clip.id === 'S', 'the sound stays linked to the original');
  s = run(s, { type: 'delete', track: 'video', id: 'A' });
  ok(videoLayout(s.present.videoClips)[0].start === 0 && s.present.audioClips[0].start === 0, 'the sound still follows the original');

  let o = state({ id: 'p', media, videoClips: [video('A', 0, 3)],
    overlayClips: [{ ...video('O', 10, 15, { muted: true, linkId: 'L' }), start: 2, layer: 0 }],
    audioClips: [{ id: 'S', mediaId: 'det', start: 2, in: 0, out: 5, speed: 1, linkId: 'L', linkOff: 0, linkInOff: -10 }] });
  o = run(o, { type: 'duplicateLayer', track: 'overlay', layer: 0, newIds: ['o1'] });
  ok(!o.present.overlayClips.find((c) => c.id === 'o1').linkId, 'overlay-layer copies carry no link');
  o = run(o, { type: 'update', track: 'overlay', id: 'O', patch: { in: 11, start: 3 } });
  const S = o.present.audioClips[0];
  ok(S.start === 3 && S.in === 1, 'trimming the original overlay still moves its sound');
}

// 4. Detach audio's single step: with audio layer 0 locked, the open layer is 1 and the whole
//    batch lands; a batch aimed at the locked layer is refused as a whole (the picture stays audible).
{
  const make = () => state({ id: 'p',
    media: [{ id: 'v', type: 'video', path: '/m/v.mp4', duration: 20, hasAudio: true, width: 1920, height: 1080 },
      { id: 'vo', type: 'audio', path: '/m/vo.wav', duration: 30, hasAudio: true }],
    videoClips: [video('B', 2, 9)], audioClips: [{ id: 'VO', mediaId: 'vo', start: 0, in: 0, out: 30, layer: 0 }] });
  const lock = { type: 'setLayerState', track: 'audio', layer: 0, patch: { locked: true } };
  const detach = (layer) => ({ type: 'batch', actions: [
    { type: 'addMedia', items: [{ id: 'det', type: 'audio', path: '/c/x.wav', duration: 7, hasAudio: true, origin: 'detach' }] },
    { type: 'update', track: 'video', id: 'B', patch: { muted: true, linkId: 'L' } },
    { type: 'insertAudioClip', clip: { id: 'A', mediaId: 'det', start: 0, in: 0, out: 7, layer, speed: 1, volume: 1, fadeIn: 0, fadeOut: 0, linkId: 'L', linkOff: 0, linkInOff: -2 } }] });
  let s = run(make(), lock);
  const layer = openLayer(s.present, 'audio', 0, 7);
  ok(layer === 1, 'the open audio layer skips the locked layer 0');
  s = run(s, detach(layer));
  ok(s.present.videoClips[0].muted && s.present.audioClips.some((c) => c.id === 'A' && c.layer === 1), 'detach lands whole on layer 1');
  const locked = run(make(), lock), refused = run(locked, detach(0));
  ok(refused === locked && !refused.present.videoClips[0].muted, 'a detach aimed at the locked layer changes nothing');
  const muted = run(make(), { type: 'setLayerState', track: 'audio', layer: 1, patch: { muted: true } }, { type: 'addLayer', track: 'audio' });
  ok(openLayer(muted.present, 'audio', 0, 7) === 2, 'the open layer skips a muted layer too');
}

// Link clips: a mic with less sound left (file 12 s, in 3 -> 9 s) than its 10 s picture. The
// link is one batch: both end where the mic's file ends, and a refused link leaves neither
// clip linked (before, the picture kept a dangling linkId).
{
  const base = state({ id: 'p', magnet: { video: true, overlay: false, audio: false, text: false },
    media: [{ id: 'v', type: 'video', path: '/m/v.mp4', duration: 30, hasAudio: true, width: 160, height: 90 },
      { id: 'mic', type: 'audio', path: '/m/mic.wav', duration: 12, hasAudio: true }],
    videoClips: [video('V', 0, 10), video('W', 10, 14)],
    audioClips: [{ id: 'M', mediaId: 'mic', start: 0, in: 3, out: 12, speed: 1, volume: 1, layer: 0 }] });
  const batch = linkPairBatch(base.present, { track: 'video', id: 'V' }, { track: 'audio', id: 'M' }, 'L1');
  const s = run(base, { type: 'beginGesture', group: true }, batch, { type: 'endGesture', group: true });
  const V = s.present.videoClips.find((c) => c.id === 'V'), M = s.present.audioClips[0];
  ok(V.linkId === 'L1' && M.linkId === 'L1' && findLinkPartner(s.present, V)?.clip.id === 'M', 'the shorter mic links to its picture');
  ok(M.out === 12 && V.out === 9, `the pair ends where the mic's file ends (mic out ${M.out}, picture out ${V.out})`);
  ok(s.past.length === 1, 'the link is one undo step');
  // The same link without the clamp is refused as a whole: no half-linked picture.
  const raw = { type: 'batch', actions: [batch.actions[0], { ...batch.actions[1], patch: { ...batch.actions[1].patch, out: 13 } }].map((a, i) => i === 0 ? { ...a, patch: { linkId: 'L1' } } : a) };
  const r = run(base, { type: 'beginGesture', group: true }, raw, { type: 'endGesture', group: true });
  ok(!r.present.videoClips.some((c) => c.linkId) && !r.present.audioClips.some((c) => c.linkId), 'a refused link leaves neither clip linked');
  // A mic with nothing left after its in point cannot be linked.
  const empty = normalizeProject({ ...base.present, audioClips: [{ ...base.present.audioClips[0], in: 12, out: 12.5 }] });
  ok(linkPairBatch(empty, { track: 'video', id: 'V' }, { track: 'audio', id: 'M' }, 'L2') === null, 'no batch when the sound has no audio left');
}

if (fails.length) { console.log(`${fails.length} FAILURE(S)`); process.exit(1); }
console.log('ALL PASS');
