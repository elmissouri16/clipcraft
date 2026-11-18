// Grade "Reset all" with several clips selected clears every selected clip's own grade (look.js),
// keeping only each clip's HSL and curves, exactly as for a single clip; one undo step.
// Usage: node tests/unit/effects/test-look-reset.mjs
import assert from 'node:assert/strict';
import { lookResetAction, resetLookPatch, selectedPictures } from '../../../src/features/effects/look.js';
import { emptyProject, historyReducer } from '../../../src/state/store.js';

const clip = (id, grade, adjust = {}) => ({ id, mediaId: 'm', in: 0, out: 5, speed: 1, volume: 1, muted: false, filter: 'none', adjust, effects: [], transition: null, grade });
const hsl = { red: { h: 10, s: 0, l: 0 } };
const p = { ...emptyProject(), media: [{ id: 'm', type: 'video', path: '/v.mp4', duration: 30, width: 1920, height: 1080 }],
  videoClips: [clip('a', { exposure: 40, saturation: 30, lut: { ref: { bundled: true, file: 'x.cube' }, name: 'X', intensity: 80 } }, { brightness: 0.2 }), clip('b', { exposure: -20, temp: 15, hsl })],
  overlayClips: [{ ...clip('o', { tint: 5 }), start: 0 }] };
let st = historyReducer({ past: [], present: p, future: [] }, { type: 'load', project: p });
const selection = { track: 'video', id: 'a', items: [{ track: 'video', id: 'a' }, { track: 'video', id: 'b' }, { track: 'overlay', id: 'o' }] };
st = historyReducer(st, lookResetAction(selectedPictures(st.present, selection)));
const grades = [...st.present.videoClips, ...st.present.overlayClips].map((c) => [c.id, c.grade, c.adjust]);
assert.deepEqual(grades, [['a', {}, {}], ['b', { hsl }, {}], ['o', {}, {}]], 'every selected clip is reset; its own HSL stays');
assert.equal(st.past.length, 1, 'one undo step');
assert.deepEqual(resetLookPatch(clip('x', { exposure: 3 })), { grade: {}, adjust: {} });
console.log('look reset OK');
