// "Apply to all main captions" (TextInspector) restyles the captions on the edited caption's own
// track only; imported subtitles and translations on other text layers keep their style.
// The track-wide styleCaptions (no layer) still reaches every caption.
// Usage: node tests/unit/text/test-caption-apply-all.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { emptyProject, historyReducer } from '../../../src/state/store.js';

const p = { ...emptyProject(), layers: { text: 3 }, textClips: [
  { id: 'en1', text: 'Hello there', start: 0, duration: 2, caption: true, font: 'montserrat', y: 0.8 },
  { id: 'en2', text: 'General Kenobi', start: 2, duration: 2, caption: true, layer: 0, font: 'montserrat', y: 0.8 },
  { id: 'srt1', text: 'Imported line', start: 0, duration: 2, caption: true, source: 'srt', layer: 1, font: 'segoe', y: 0.1 },
  { id: 'ar1', text: 'مرحبا', start: 0, duration: 2, caption: true, source: 'plugin-translation', layer: 2, font: 'cairo', y: 0.65 },
  { id: 'title', text: 'Title', start: 0, duration: 2, layer: 0, font: 'anton', y: 0.2 },
] };
let st = historyReducer({ past: [], present: p, future: [] }, { type: 'load', project: p });
st = historyReducer(st, { type: 'styleCaptions', patch: { font: 'anton', y: 0.9 }, layer: 0 });
const by = Object.fromEntries(st.present.textClips.map((c) => [c.id, [c.font, c.y]]));
assert.deepEqual(by, { en1: ['anton', 0.9], en2: ['anton', 0.9], srt1: ['segoe', 0.1], ar1: ['cairo', 0.65], title: ['anton', 0.2] });
st = historyReducer(st, { type: 'styleCaptions', patch: { color: '#ff0000' }, layer: 2 });
assert.deepEqual(st.present.textClips.filter((c) => c.color).map((c) => c.id), ['ar1'], 'another track is styled on its own');
// A lock on another track does not block restyling this one.
const locked = historyReducer({ past: [], present: { ...st.present, layerState: { 'text:1': { locked: true } } }, future: [] }, { type: 'styleCaptions', patch: { size: 60 }, layer: 0 });
assert.equal(locked.present.textClips.find((c) => c.id === 'en1').size, 60);
st = historyReducer(st, { type: 'styleCaptions', patch: { color: '#00ff00' } });
assert.ok(st.present.textClips.filter((c) => c.caption).every((c) => c.color === '#00ff00'), 'without a layer every caption is styled');
const inspector = fs.readFileSync(new URL('../../../src/features/text/components/TextInspector.jsx', import.meta.url), 'utf8');
assert.match(inspector, /type: 'styleCaptions', patch: style, layer: clip\.layer \?\? 0/, 'the inspector limits Apply to all to the clip\'s track');
console.log('caption apply-all scope OK');
