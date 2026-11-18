// Script-aware text helpers shared by the text renderer and caption regrouping. Pure: no DOM, so the
// plain Node suites import it directly.
//
// - graphemes(): user-perceived characters (an emoji family, a flag, a letter with its accent, an Indic
//   conjunct stay one unit), the only safe unit to count, reveal or paint "letter by letter".
// - wordSegments(): word boundaries for scripts written without spaces (Chinese, Japanese, Thai, ...).
// - strongDir(): the direction of a string's first strong character, for bidi run ordering.

// Hebrew, Arabic, Syriac, Thaana, N'Ko and the Arabic presentation forms.
export const RTL_CHARS = /[֐-ࣿיִ-﷿ﹰ-﻿]/;
// Scripts whose letters shape, stack or join across grapheme clusters: painting their clusters one by
// one breaks the word, so letter animations play word by word for them (as for Arabic and Hebrew).
export const SHAPED_CHARS = /[\p{Script=Devanagari}\p{Script=Bengali}\p{Script=Gurmukhi}\p{Script=Gujarati}\p{Script=Oriya}\p{Script=Tamil}\p{Script=Telugu}\p{Script=Kannada}\p{Script=Malayalam}\p{Script=Sinhala}\p{Script=Thai}\p{Script=Lao}\p{Script=Tibetan}\p{Script=Myanmar}\p{Script=Khmer}\p{Script=Mongolian}]/u;
// Scripts written without spaces between words, and their full-width punctuation.
export const UNSPACED_CHARS = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}　-〿！-｠]/u;

let graphemeSeg = null;
let wordSeg = null;
const segmenter = (granularity) => {
  if (typeof Intl === 'undefined' || typeof Intl.Segmenter !== 'function') return null;
  if (granularity === 'grapheme') return (graphemeSeg ||= new Intl.Segmenter(undefined, { granularity }));
  return (wordSeg ||= new Intl.Segmenter(undefined, { granularity }));
};

export function graphemes(text) {
  const s = String(text ?? '');
  const seg = segmenter('grapheme');
  return seg ? Array.from(seg.segment(s), (x) => x.segment) : [...s];
}

// Word-boundary pieces of a space-free run, with punctuation glued to the word before it (a comma or a
// full stop never starts a piece). Falls back to graphemes when the runtime has no segmenter.
export function wordSegments(text) {
  const s = String(text ?? '');
  const seg = segmenter('word');
  const parts = seg ? Array.from(seg.segment(s), (x) => x.segment) : graphemes(s);
  const out = [];
  for (const p of parts) {
    if (out.length && /^[\p{P}\p{S}\s]+$/u.test(p) && !/[\p{Ps}\p{Pi}]/u.test(p) && !/\p{Extended_Pictographic}/u.test(p)) out[out.length - 1] += p;
    else out.push(p);
  }
  return out;
}

// 'rtl' | 'ltr' | null (no strong character: digits, punctuation, emoji).
export function strongDir(text) {
  for (const ch of String(text ?? '')) {
    if (!/\p{L}/u.test(ch)) continue;
    return RTL_CHARS.test(ch) ? 'rtl' : 'ltr';
  }
  return null;
}
