// SRT parsing + store integration. Usage: node scripts/test-srt.mjs
import assert from 'assert/strict';
import fs from 'fs';
import { parseSRT, parseSrtTime, srtSegments } from '../src/subtitles.js';
import { emptyProject, historyReducer } from '../src/store.js';

// Fixture: the user's own captions file.
const fixture = fs.readFileSync('/home/hatch/workspace/user/files/captions.srt', 'utf8');
const cues = parseSRT(fixture);
assert.ok(cues.length >= 5, `fixture parses (${cues.length} cues)`);
assert.equal(cues[0].start, 0.2);
assert.equal(cues[0].end, 1.5);
assert.ok(cues[0].text.length > 0, 'cue text kept');

// Time parsing: comma + dot millis, 1-3 digit fractions, missing hours.
assert.equal(parseSrtTime('00:00:01,500'), 1.5);
assert.equal(parseSrtTime('00:00:01.5'), 1.5);
assert.equal(parseSrtTime('01:02,250'), 62.25);
assert.equal(parseSrtTime('02:00:00,000'), 7200);
assert.equal(parseSrtTime('nonsense'), null);

// Edge cases: BOM + CRLF, no index lines, dot millis, coordinates, multi-line text, bad block skipped.
const messy = '\uFEFF1\r\n00:00:00,000 --> 00:00:02,000 X1:10 X2:600\r\nHello\r\nworld\r\n\r\n'
  + '00:00:03.5 --> 00:00:04.25\r\nNo index here\r\n\r\n'
  + '3\r\nnot a timing line\r\nBroken cue\r\n\r\n'
  + '4\r\n00:00:05,000 --> 00:00:06,000\r\n\r\n';
const m = parseSRT(messy);
assert.equal(m.length, 2, 'only the two valid cues survive');
assert.deepEqual([m[0].start, m[0].end], [0, 2]);
assert.equal(m[0].text, 'Hello\nworld');
assert.deepEqual([m[1].start, m[1].end], [3.5, 4.25]);

// Store: import creates source:'srt' caption clips with exact timing; regenerating auto
// captions must NOT delete them; removeSrtCaptions removes only them.
let st = { past: [], present: emptyProject(), future: [] };
const go = (a) => { st = historyReducer(st, a); return st.present; };
let p = go({ type: 'importSrtCaptions', style: { template: 'cap-classic' }, segments: srtSegments(fixture, (i) => `s${i}`) });
assert.equal(p.textClips.filter((c) => c.source === 'srt').length, cues.length, 'all cues imported');
assert.equal(p.textClips[0].start, 0.2);
assert.equal(p.textClips[0].duration, 1.3);
p = go({ type: 'setCaptions', style: {}, segments: [{ id: 'w1', start: 0, end: 1, text: 'auto', words: [] }] });
assert.equal(p.textClips.filter((c) => c.source === 'srt').length, cues.length, 'srt captions survive setCaptions');
assert.equal(p.textClips.filter((c) => c.caption && c.source !== 'srt').length, 1, 'auto caption present');
p = go({ type: 'styleCaptions', patch: { color: '#ff0000' } });
assert.ok(p.textClips.filter((c) => c.source === 'srt').every((c) => c.color === '#ff0000'), 'styleCaptions styles srt captions too');
p = go({ type: 'removeSrtCaptions' });
assert.equal(p.textClips.filter((c) => c.source === 'srt').length, 0, 'srt captions removed');
assert.equal(p.textClips.filter((c) => c.caption).length, 1, 'auto caption kept');
console.log(`srt OK: fixture ${cues.length} cues, edge cases + store behaviour verified`);
