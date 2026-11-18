import { validWordTiming } from './timing.js';
import { UNSPACED_CHARS, wordSegments } from './scripts.js';
// SubRip (.srt) parsing — pure module, also tested in plain Node.
//
// Handles the files real tools produce: an optional UTF-8 BOM, CRLF or LF endings, blocks
// with or without a numeric index line, timing lines with comma or dot milliseconds
// (1–3 digits), position coordinates after the end time, and multi-line cue text.
// Malformed blocks are skipped, never thrown on.

const TIME = /^(\d{1,2}):(\d{2}):(\d{2})(?:[.,](\d{1,3}))?$/;

// "00:01:02,500" | "00:01:02.5" | "01:02,500" -> seconds (float), or null.
export function parseSrtTime(value) {
  const m = TIME.exec(String(value || '').trim());
  if (!m) {
    // Some exporters drop the hours: "01:23,400" means 1 min 23.4 s. The strict regex above
    // requires three groups, so try the two-group shape explicitly.
    const short = /^(\d{1,2}):(\d{2})(?:[.,](\d{1,3}))?$/.exec(String(value || '').trim());
    if (!short) return null;
    const ms = short[3] ? Number(short[3].padEnd(3, '0')) : 0;
    return Number(short[1]) * 60 + Number(short[2]) + ms / 1000;
  }
  const ms = m[4] ? Number(m[4].padEnd(3, '0')) : 0;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + ms / 1000;
}

// Parses one timing line: "00:00:01,000 --> 00:00:04,000 X1:.. X2:.." -> { start, end } | null.
export function parseTimingLine(line) {
  const parts = String(line || '').split('-->');
  if (parts.length !== 2) return null;
  const start = parseSrtTime(parts[0]);
  const end = parseSrtTime(parts[1].trim().split(/\s+/)[0]);
  if (start == null || end == null || end < start) return null;
  return { start, end };
}

// Styling markup that subtitle files carry but a burned-in caption must not show: SubRip/WebVTT tags
// (<i>, <b>, <u>, <s>, <font ...>, <v Speaker>, <c.class>, <lang ..>, <ruby>/<rt>, inline <00:01.000>
// timestamps) and ASS/SSA override blocks such as {\an8} or {\i1}. Plain angle brackets in text
// ("a < b") are kept: only these tag names are removed.
const MARKUP = /<\/?(?:i|b|u|s|font|v|c|lang|ruby|rt|span)(?:[\s.][^<>]*)?>|<\d{1,2}(?::\d{2}){1,2}[.,]\d{1,3}>|\{\\[^{}]*\}/gi;
export const stripSubtitleMarkup = (line) => String(line || '').replace(MARKUP, '');

// Full file -> [{ start, end, text }] in file order, exact timings preserved. A cue is its timing line and
// the text lines after it, up to a blank line or the next cue — a timing line, or an index line followed
// by one — so files that leave out the blank line between cues still split correctly.
export function parseSRT(input) {
  const lines = String(input || '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n');
  const isTiming = (l) => l != null && l.includes('-->') && !!parseTimingLine(l);
  const out = [];
  let cur = null;
  const flush = () => {
    if (cur) {
      const text = cur.lines.map((l) => stripSubtitleMarkup(l).trim()).filter(Boolean).join('\n');
      if (text) out.push({ start: cur.start, end: cur.end, text });
    }
    cur = null;
  };
  for (let k = 0; k < lines.length; k++) {
    const line = lines[k].trimEnd();
    if (isTiming(line)) { flush(); cur = { ...parseTimingLine(line), lines: [] }; continue; }
    if (!cur) continue;
    if (!line.trim()) { flush(); continue; }
    if (/^\d+$/.test(line.trim()) && isTiming(lines[k + 1]?.trimEnd())) { flush(); continue; }
    cur.lines.push(line);
  }
  flush();
  return out;
}

// Segments in the shape the store's caption actions use ({ id, start, end, text }).
export function srtSegments(input, makeId) {
  return parseSRT(input).map((s, i) => ({ ...s, id: makeId ? makeId(i) : `srt-${i}` }));
}

// Re-group caption segments so none carries more than `n` words: a longer segment is
// split into consecutive chunks of at most n words, each chunk timed by its word share
// of the original span (chunk i covers words [i, i+n) of the segment's [start, end]).
// Word count and order are preserved exactly; multi-line text is re-joined with single
// spaces. Text in a script written without spaces (Chinese, Japanese, Thai, ...) counts the words inside
// it (Intl.Segmenter word boundaries) and is re-joined without adding spaces. n < 1 (or unset) returns the segments untouched — the historical behaviour.
// Used for .srt imports and for auto captions alike (the engines' segments pass through
// the same regroup in App's runCaptions). Chunked pieces carry no id — callers assign
// fresh ids to the result, as both import flows already do.
// Words of a caption in reading order; `space` says whether a space separated it from the one before.
function captionTokens(text) {
  const out = [];
  for (const part of String(text || '').trim().split(/\s+/).filter(Boolean)) {
    const pieces = UNSPACED_CHARS.test(part) ? wordSegments(part).filter((x) => x.trim()) : [part];
    pieces.forEach((p, k) => out.push({ text: p, space: k === 0 }));
  }
  return out;
}

export function regroupSegments(segments, n) {
  const limit = Math.floor(Number(n) || 0);
  if (limit < 1) return segments;
  const out = [];
  for (const s of segments || []) {
    const tokens = captionTokens(s.text);
    const words = tokens.map((t) => t.text);
    if (words.length <= limit) { out.push(s); continue; }
    const { id, words: originalWords, ...base } = s;
    const wordIdentity = text => String(text).normalize('NFKC').replace(/[\p{P}\p{S}]/gu, '').toLocaleLowerCase();
    const measured = Array.isArray(originalWords) && originalWords.length === words.length
      && validWordTiming(originalWords, s.end - s.start, s.start)
      && originalWords.every((w, i) => wordIdentity(w.text) === wordIdentity(words[i]));
    const span = Math.max(0, (Number(s.end) || 0) - (Number(s.start) || 0));
    for (let i = 0; i < words.length; i += limit) {
      const chunk = words.slice(i, i + limit);
      const chunkText = tokens.slice(i, i + limit).map((t, k) => (k && t.space ? ' ' : '') + t.text).join('');
      const timings = measured ? originalWords.slice(i, i + limit).map((word, k) => ({ ...word, text: chunk[k] })) : null;
      out.push({
        ...base,
        start: timings ? timings[0].start : (Number(s.start) || 0) + (span * i) / words.length,
        end: timings ? timings.at(-1).end : (Number(s.start) || 0) + (span * (i + chunk.length)) / words.length,
        text: chunkText,
        ...(timings ? { words: timings } : { word_timing: 'estimated' }),
      });
    }
  }
  return out;
}
