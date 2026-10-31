// SubRip (.srt) parsing — pure module, no imports, so it runs (and is tested) in plain Node.
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

// Full file -> [{ start, end, text }] in file order, exact timings preserved.
export function parseSRT(input) {
  const text = String(input || '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const out = [];
  for (const block of text.split(/\n\s*\n/)) {
    const lines = block.split('\n').map((l) => l.trimEnd()).filter((l, i, a) => l.trim() !== '' || (i > 0 && i < a.length - 1));
    if (!lines.length) continue;
    // Timing line: the first line containing "-->", or the second when the first is an index.
    const ti = lines.findIndex((l) => l.includes('-->'));
    if (ti < 0 || ti > 1) continue;
    const timing = parseTimingLine(lines[ti]);
    if (!timing) continue;
    const cue = lines.slice(ti + 1).join('\n').trim();
    if (!cue) continue;
    out.push({ start: timing.start, end: timing.end, text: cue });
  }
  return out;
}

// Segments in the shape the store's caption actions use ({ id, start, end, text }).
export function srtSegments(input, makeId) {
  return parseSRT(input).map((s, i) => ({ ...s, id: makeId ? makeId(i) : `srt-${i}` }));
}
