// Real-world scripts in the shared text renderer (preview and export) and in subtitle import/export:
// wrapping text without spaces, grapheme-safe letter effects, word-level fallback for shaped scripts,
// bidi run ordering, subtitle markup, cues without blank lines and the SRT round trip.
// Usage: node tests/unit/text/test-text-scripts.mjs
import assert from 'assert/strict';
import { registerHooks } from 'module';

// render.js pulls font stylesheets in through fonts.js; Node only needs them to resolve.
registerHooks({ resolve: (spec, ctx, next) => (spec.endsWith('.css') ? { url: 'data:text/javascript,export default {}', shortCircuit: true } : next(spec, ctx)) });
const { drawTextClip } = await import('../../../src/features/text/render.js');
const { graphemes, strongDir, wordSegments } = await import('../../../src/features/text/scripts.js');
const { parseSRT, regroupSegments } = await import('../../../src/features/text/subtitles.js');
const { captionsToSrt } = await import('../../../src/features/agent/captionTools.js');

// A 2D context stand-in: each code point is `size` px wide (a space 0.3 size); records painted strings.
function mockCtx(size) {
  const calls = []; let tx = 0, ty = 0; const stack = [];
  const ctx = {
    font: '', letterSpacing: '0px', textBaseline: '', textAlign: '', direction: 'inherit', globalAlpha: 1, filter: 'none', fillStyle: '', strokeStyle: '',
    lineWidth: 1, lineJoin: '', miterLimit: 1, shadowColor: '', shadowBlur: 0, shadowOffsetX: 0, shadowOffsetY: 0, globalCompositeOperation: '',
    measureText: (s) => ({ width: [...s].length * (s === ' ' ? size * 0.3 : size) }),
    save() { stack.push([tx, ty, this.globalAlpha, this.direction]); }, restore() { [tx, ty, this.globalAlpha, this.direction] = stack.pop(); },
    translate(x, y) { tx += x; ty += y; }, rotate() {}, scale() {},
    fillText(s, x, y) { calls.push({ s, x: Math.round(tx + x), y: Math.round(ty + y), dir: this.direction }); },
    strokeText() {}, fillRect() {}, strokeRect() {}, beginPath() {}, roundRect() {}, fill() {}, stroke() {}, rect() {}, clip() {}, moveTo() {}, lineTo() {}, closePath() {}, arc() {},
    createLinearGradient: () => ({ addColorStop() {} }),
  };
  return { ctx, calls };
}
const W = 1080, H = 1920;
function paint(clip, lt = 1) {
  const { ctx, calls } = mockCtx(clip.size || 64);
  drawTextClip(ctx, { start: 0, duration: 3, size: 64, stroke: { width: 0 }, shadow: { on: false }, animIn: { id: 'none' }, animOut: { id: 'none' }, ...clip }, lt, W, H);
  const seen = new Set();
  return calls.filter((c) => { const k = `${c.s}@${c.x},${c.y}`; if (seen.has(k)) return false; seen.add(k); return true; });
}
// Words of each painted line in visual order, left to right.
const visual = (calls) => {
  const rows = new Map();
  for (const c of calls) rows.set(c.y, [...(rows.get(c.y) || []), c]);
  return [...rows.keys()].sort((a, b) => a - b).map((y) => rows.get(y).sort((a, b) => a.x - b.x).map((c) => c.s));
};

// --- Wrapping: a caption without spaces breaks into pieces that fit the frame.
{
  const ja = '今日はとても良い天気ですね、散歩に行きましょう';
  const calls = paint({ text: ja, caption: true });
  assert.ok(calls.length >= 2, 'the space-free caption wraps onto more than one line');
  assert.equal(calls.map((c) => c.s).join(''), ja, 'every character is painted once, in order');
  for (const c of calls) {
    assert.ok(c.x >= 0 && c.x + [...c.s].length * 64 <= W, `piece "${c.s}" stays inside the frame (x=${c.x})`);
    assert.ok(!/^[、。]/.test(c.s), 'punctuation never starts a line');
  }
  const url = 'https://example.com/a-very-long-path/with-no-spaces/at-all';
  const u = paint({ text: url });
  assert.equal(u.map((c) => c.s).join(''), url, 'a long URL breaks without losing characters');
  assert.ok(u.every((c) => c.x >= 0 && c.x + [...c.s].length * 64 <= W), 'URL pieces fit the frame');
  assert.deepEqual(visual(paint({ text: 'short words stay whole' })).flat(), ['short', 'words', 'stay', 'whole'], 'ordinary words are never broken');
}

// --- Letter effects split by grapheme cluster, and shaped scripts animate by word.
{
  assert.deepEqual(graphemes('👨‍👩‍👧 🇺🇸 👍🏽 café'), ['👨‍👩‍👧', ' ', '🇺🇸', ' ', '👍🏽', ' ', 'c', 'a', 'f', 'é']);
  const emoji = paint({ text: '👨‍👩‍👧 🇺🇸 👍🏽', animIn: { id: 'charFade', dur: 0.5 } }, 0.45).map((c) => c.s);
  assert.deepEqual(emoji, ['👨‍👩‍👧', '🇺🇸', '👍🏽'], 'emoji sequences are painted whole during a letter effect');
  const accent = paint({ text: 'café', animLoop: { id: 'wave', speed: 1 } }, 2).map((c) => c.s);
  assert.deepEqual(accent, ['c', 'a', 'f', 'é'], 'a combining accent stays on its letter in the Wave loop');
  const settled = paint({ text: 'Hello', animIn: { id: 'charFade', dur: 0.5 } }, 2.9).map((c) => c.s);
  assert.deepEqual(settled, ['Hello'], 'a finished letter entrance paints the word whole again');
  for (const [label, clip] of [['wave loop', { animLoop: { id: 'wave', speed: 1 } }], ['letter-by-letter fade', { animIn: { id: 'fade', dur: 0.6, unit: 'char' } }], ['typewriter', { animIn: { id: 'typewriter', dur: 3 } }]]) {
    const hindi = paint({ text: 'नमस्ते दुनिया', ...clip }, 2).map((c) => c.s);
    assert.ok(hindi.every((s) => s === 'नमस्ते' || s === 'दुनिया'), `Devanagari animates by whole word (${label}): ${JSON.stringify(hindi)}`);
    const thai = paint({ text: 'สวัสดี ครับ', ...clip }, 2).map((c) => c.s);
    assert.ok(thai.every((s) => s === 'สวัสดี' || s === 'ครับ'), `Thai animates by whole word (${label})`);
  }
  // Typewriter counts clusters: half way through two emoji, exactly the first is shown.
  assert.deepEqual(paint({ text: '👍🏽👍🏽', animIn: { id: 'typewriter', dur: 2 } }, 1).map((c) => c.s), ['👍🏽']);
}

// --- Bidi: runs keep their reading order; only an RTL paragraph reverses the runs.
{
  assert.equal(strongDir('123 שלום'), 'rtl');
  assert.equal(strongDir('!? Hello'), 'ltr');
  assert.equal(strongDir('123'), null);
  const ar = paint({ text: 'أنا أستخدم Final Cut Pro يوميا', font: 'cairo', size: 24 });
  assert.equal(visual(ar).length, 1, 'the bidi samples fit on one line');
  const arFlat = visual(ar).flat();
  const at = (s) => arFlat.indexOf(s);
  assert.ok(at('Final') < at('Cut') && at('Cut') < at('Pro'), `the Latin phrase keeps its word order: ${JSON.stringify(visual(ar))}`);
  assert.ok(at('يوميا') < at('Final') && at('Pro') < at('أستخدم') && at('أستخدم') < at('أنا'), 'the Arabic runs read right to left around it');
  assert.ok(ar.filter((c) => /[؀-ۿ]/.test(c.s)).every((c) => c.dir === 'rtl') && ar.filter((c) => /[A-Za-z]/.test(c.s)).every((c) => c.dir === 'ltr'), 'canvas direction follows each word');
  const he = visual(paint({ text: 'Welcome to שלום Tel Aviv tour', size: 24 })).flat();
  assert.deepEqual(he, ['Welcome', 'to', 'שלום', 'Tel', 'Aviv', 'tour'], 'an English caption with one Hebrew word is not flipped');
  const pureAr = visual(paint({ text: 'مرحبا بكم في القناة', size: 24 })).flat();
  assert.deepEqual(pureAr, ['القناة', 'في', 'بكم', 'مرحبا'], 'a purely Arabic line reads right to left as before');
  const pureEn = visual(paint({ text: 'Hello and welcome back', size: 24 })).flat();
  assert.deepEqual(pureEn, ['Hello', 'and', 'welcome', 'back'], 'a purely English line is unchanged');
}

// --- Subtitles: markup is not burned in, missing blank lines still split cues, round trip keeps text.
{
  const tags = parseSRT('1\r\n00:00:01,000 --> 00:00:02,000\r\n<i>Hello</i> <font color="#ff0">there</font>\r\n{\\an8}Top <b>line</b>\r\n');
  assert.deepEqual(tags, [{ start: 1, end: 2, text: 'Hello there\nTop line' }], 'tags and override blocks are stripped');
  assert.equal(parseSRT('00:00:01.000 --> 00:00:02.000\n<v Bob>Hi <c.loud>you</c> a < b\n')[0].text, 'Hi you a < b', 'WebVTT voice/class tags stripped, plain brackets kept');
  const tight = parseSRT('1\n00:00:01,000 --> 00:00:02,000\nA\n2\n00:00:02,000 --> 00:00:03,000\nB\n00:00:03,000 --> 00:00:04,000\nC\n');
  assert.deepEqual(tight, [{ start: 1, end: 2, text: 'A' }, { start: 2, end: 3, text: 'B' }, { start: 3, end: 4, text: 'C' }], 'cues split on timing lines without blank lines');
  assert.deepEqual(parseSRT('1\n00:00:01,000 --> 00:00:02,000\nIn 2024\nwe won\n'), [{ start: 1, end: 2, text: 'In 2024\nwe won' }], 'a number line inside a cue stays text');
  const srt = captionsToSrt([{ id: 'a', start: 1, duration: 1, text: 'Para one\n\nPara two' }, { id: 'b', start: 3, duration: 1, text: 'Next' }]);
  assert.ok(!/Para one\n\n/.test(srt), 'no empty line inside a cue');
  assert.deepEqual(parseSRT(srt).map((c) => c.text), ['Para one\nPara two', 'Next'], 'the round trip keeps every line');
  // Regrouping words per line works for scripts written without spaces, and rejoins without spaces.
  const ja = '今日はとても良い天気ですね散歩に行きましょう';
  const groups = regroupSegments([{ start: 1, end: 5, text: ja }], 3);
  assert.ok(groups.length > 1, 'a space-free caption is regrouped');
  assert.equal(groups.map((g) => g.text).join(''), ja, 'no character lost or space added');
  assert.ok(groups.every((g, i) => !i || g.start >= groups[i - 1].end - 1e-9), 'chunks stay in time order');
  assert.ok(wordSegments('ね、散歩').every((p) => !/^、/.test(p)), 'punctuation is glued to the word before it');
  const mixed = regroupSegments([{ start: 0, end: 4, text: 'one two three four five six' }], 3);
  assert.deepEqual(mixed.map((g) => g.text), ['one two three', 'four five six'], 'spaced text regroups as before');
}

console.log('text scripts OK: wrapping without spaces, grapheme letters, shaped scripts by word, bidi runs, subtitle markup and cues');
