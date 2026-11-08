// Whisper word timing: a zero-length token must not turn a whole segment's
// measured words into estimates (filler cuts need the measured ones), and the
// repaired word itself is labelled estimated.
// Usage: node tests/unit/audio/test-whisper-words.cjs
const assert = require('node:assert/strict');
const { readSegments } = require('../../../electron/audio/whisper.cjs');

const token = (text, from, to) => ({ text, offsets: { from, to } });
// Token pattern taken from a real whisper-cli run (base model, verbatim prompt).
const [seg] = readSegments({ transcription: [{ text: ' The biggest mistake is, the biggest mistake.', offsets: { from: 6000, to: 9000 }, tokens: [
  token('[_BEG_]', 6000, 6000), token(' The', 6000, 6000), token(' biggest', 6000, 6000), token(' mistake', 6140, 6500), token(' is', 6500, 6670), token(',', 6670, 6680),
  token(' the', 6990, 7100), token(' biggest', 7100, 7670), token(' mistake', 8030, 8340), token('.', 8340, 9000),
] }] });
assert.equal(seg.words.length, 7);
assert.deepEqual(seg.words.map(w => w.timing), ['estimated', 'estimated', 'measured', 'measured', 'measured', 'measured', 'measured']);
assert.deepEqual(seg.words.slice(2).map(w => [w.text, w.start, w.end]), [['mistake', 6.14, 6.5], ['is,', 6.5, 6.68], ['the', 6.99, 7.1], ['biggest', 7.1, 7.67], ['mistake.', 8.03, 9]]);
assert.ok(seg.words.every((w, i) => w.end > w.start && (!i || w.start >= seg.words[i - 1].start)), 'repaired words have positive, ordered spans');
assert.ok(seg.words[1].end <= 6.14 + 1e-9, 'a repaired word ends before the next measured word');
assert.equal(seg.word_timing, 'estimated', 'the segment still reports that some timing is estimated');

// Fully measured segments are unchanged; mismatched counts still fall back to estimates.
const [clean] = readSegments({ transcription: [{ text: ' So um, hi.', offsets: { from: 0, to: 1000 }, tokens: [token(' So', 30, 210), token(' um', 210, 420), token(',', 420, 630), token(' hi', 630, 680), token('.', 680, 1000)] }] });
assert.equal(clean.word_timing, 'measured'); assert.deepEqual(clean.words.map(w => w.text), ['So', 'um,', 'hi.']);
const [odd] = readSegments({ transcription: [{ text: ' one two three', offsets: { from: 0, to: 900 }, tokens: [token(' one', 0, 300), token(' twothree', 300, 900)] }] });
assert.ok(odd.words.every(w => w.timing === 'estimated'));
console.log('whisper word timing: zero-length tokens repaired per word');
