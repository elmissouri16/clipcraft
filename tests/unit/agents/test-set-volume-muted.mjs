// set_volume: volume 0 mutes a clip; a higher volume unmutes it, except a picture whose sound
// already plays from an audio clip (Detach audio partner or extracted copy) — that one stays muted
// and the result names the clip that carries the sound. Usage: node tests/unit/agents/test-set-volume-muted.mjs
import assert from 'node:assert/strict';
import { historyReducer, normalizeProject, renderable } from '../../../src/state/store.js';
import { createToolRunner } from '../../../src/features/agent/tools.js';

const media = [{ id: 'm', name: 'talk.mp4', type: 'video', duration: 60, width: 1920, height: 1080, hasAudio: true, path: '/x/talk.mp4' },
  { id: 'mus', name: 'music.mp3', type: 'audio', duration: 120, hasAudio: true, path: '/x/music.mp3' }];
function make(present) {
  let state = { past: [], future: [], present: { ...normalizeProject({}), fps: 30, ratio: '16:9', resolution: 1080, width: 1920, height: 1080, media, ...present } };
  const runner = createToolRunner({ getProject: () => state.present, dispatch: (a) => { state = historyReducer(state, a); }, api: {}, settle: async () => {}, fontIds: () => ['montserrat'] });
  return { run: (name, args) => runner.run(name, args), p: () => state.present };
}

// Extracted sound: the picture stays muted, its new volume is kept, the result names the copy.
{
  const h = make({ videoClips: [{ id: 'a', mediaId: 'm', in: 0, out: 10, speed: 1, volume: 1 }] });
  const ex = await h.run('clip_tools', { clip_id: 'a', action: 'extract_audio' });
  const r = await h.run('set_volume', { clip_id: 'a', volume: 0.5 });
  assert.ok(!r.error, r.error);
  assert.equal(h.p().videoClips[0].muted, true, 'the picture stays muted');
  assert.equal(h.p().videoClips[0].volume, 0.5);
  assert.equal(r.sound_clip_id, ex.audio_clip_id, 'the result names the extracted clip');
  assert.equal(renderable(h.p()).videoClips[0].muted, true, 'the sound does not play twice');
}

// Detach-audio partner: same.
{
  const h = make({ videoClips: [{ id: 'v', mediaId: 'm', in: 0, out: 10, speed: 1, muted: true, linkId: 'L' }],
    audioClips: [{ id: 'mic', mediaId: 'mus', in: 0, out: 10, start: 0, speed: 1, layer: 0, linkId: 'L', linkOff: 0, linkInOff: 0 }] });
  const r = await h.run('set_volume', { clip_id: 'v', volume: 1 });
  assert.equal(h.p().videoClips[0].muted, true);
  assert.equal(r.sound_clip_id, 'mic');
}

// A clip muted by volume 0, with no other clip carrying its sound, is unmuted by a higher volume;
// an audio-track clip as well.
{
  const h = make({ videoClips: [{ id: 'a', mediaId: 'm', in: 0, out: 10, speed: 1, volume: 1 }],
    audioClips: [{ id: 'bed', mediaId: 'mus', in: 0, out: 10, start: 0, layer: 0, volume: 1 }] });
  for (const id of ['a', 'bed']) {
    await h.run('set_volume', { clip_id: id, volume: 0 });
    const list = id === 'a' ? h.p().videoClips : h.p().audioClips;
    assert.equal(list[0].muted, true, `${id}: volume 0 mutes`);
    const r = await h.run('set_volume', { clip_id: id, volume: 0.8 });
    assert.equal((id === 'a' ? h.p().videoClips : h.p().audioClips)[0].muted, false, `${id}: a volume unmutes`);
    assert.equal(r.sound_clip_id, undefined);
  }
}
console.log('set_volume keeps a picture whose sound plays elsewhere muted, and unmutes the others');
