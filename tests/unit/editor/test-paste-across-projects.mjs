// The clip clipboard outlives a project load. A clip copied in one project and pasted into another
// brings its media item: the target's own item for the same file is used, or the item is added; a
// clip whose media cannot be resolved is not pasted (the timeline would show a block the export
// drops, shifting the main track). Usage: node tests/unit/editor/test-paste-across-projects.mjs
import assert from 'node:assert/strict';
import { emptyProject, historyReducer, videoLayout } from '../../../src/state/store.js';

const vid = (id, path, duration = 10) => ({ id, name: id, path, type: 'video', duration, width: 1280, height: 720, hasAudio: true, fps: 30 });
const A = { ...emptyProject(), id: 'A', media: [vid('mA', '/footage/a.mp4', 30)], videoClips: [{ id: 'ca', mediaId: 'mA', in: 0, out: 4, speed: 1, volume: 0.5 }] };
const clipboard = { track: 'video', clip: A.videoClips[0], media: A.media[0] }; // what copy() keeps
const B = () => ({ ...emptyProject(), id: 'B', media: [vid('m1', '/footage/b1.mp4'), vid('m2', '/footage/b2.mp4')],
  videoClips: [{ id: 'v1', mediaId: 'm1', in: 0, out: 5, speed: 1 }, { id: 'v2', mediaId: 'm2', in: 0, out: 5, speed: 1 }] });
const paste = (project, extra = {}) => historyReducer({ past: [], future: [], present: project }, { type: 'paste', track: 'video', clip: clipboard.clip, media: clipboard.media, mediaId: 'fresh', at: 0, newId: 'pasted', ...extra });
const pasted = (s) => s.present.videoClips.find((c) => c.id === 'pasted');
const resolves = (s) => s.present.videoClips.every((c) => c.gap || s.present.media.some((m) => m.id === c.mediaId));

// Another project without the file: the media item is added, the clip plays it, one Undo step for both.
let s = paste(B());
assert.ok(pasted(s));assert.equal(pasted(s).mediaId, 'mA');assert.equal(pasted(s).volume, 0.5);
assert.deepEqual(s.present.media.map((m) => m.id), ['m1', 'm2', 'mA']);assert.equal(s.present.media[2].path, '/footage/a.mp4');
assert.ok(resolves(s), 'every main-track clip names media of this project');
assert.deepEqual(videoLayout(s.present.videoClips).map((l) => l.clip.id), ['pasted', 'v1', 'v2']);
assert.equal(s.past.length, 1);
assert.equal(historyReducer(s, { type: 'undo' }).present.media.length, 2, 'Undo removes the added media too');

// The target already has the file under another id: that item is used, nothing is added.
s = paste({ ...B(), media: [...B().media, vid('mine', '/footage/a.mp4', 30)] });
assert.equal(pasted(s).mediaId, 'mine');assert.equal(s.present.media.length, 3);
// The target has an item with the copied id but for another file: the copy gets a fresh id.
s = paste({ ...B(), media: [...B().media, vid('mA', '/footage/other.mp4')] });
assert.equal(pasted(s).mediaId, 'fresh');assert.equal(s.present.media.find((m) => m.id === 'fresh').path, '/footage/a.mp4');
assert.equal(s.present.media.find((m) => m.id === 'mA').path, '/footage/other.mp4');assert.ok(resolves(s));
// Within the same project nothing changes in the media list.
s = historyReducer({ past: [], future: [], present: A }, { type: 'paste', track: 'video', clip: clipboard.clip, media: clipboard.media, at: 10, newId: 'pasted' });
assert.equal(s.present.media, A.media);assert.equal(pasted(s).mediaId, 'mA');
// Without its media item (an older clipboard, a caller that does not send it) an unknown media id is not pasted.
const before = { past: [], future: [], present: B() };
assert.equal(historyReducer(before, { type: 'paste', track: 'video', clip: clipboard.clip, at: 0, newId: 'pasted' }), before);
// Free tracks follow the same rule.
const overlay = historyReducer({ past: [], future: [], present: B() }, { type: 'paste', track: 'overlay', clip: { ...clipboard.clip, start: 0 }, media: clipboard.media, at: 2, newId: 'po' });
assert.equal(overlay.present.overlayClips[0].mediaId, 'mA');assert.equal(overlay.present.media.length, 3);
// A text clip (no media) pastes as before.
const text = historyReducer({ past: [], future: [], present: B() }, { type: 'paste', track: 'text', clip: { id: 't', text: 'Hi', start: 0, duration: 2 }, at: 1, newId: 'pt' });
assert.equal(text.present.textClips[0].start, 1);
console.log('paste across projects ok: the media item comes along (matched by path), unresolved media is refused');
