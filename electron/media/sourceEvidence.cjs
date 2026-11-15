// Source evidence is independent of a caller's index options. Index manifests
// are views; compatible scans and transcripts may be reused across those views.
// Keep legacy on-disk records readable and never infer missing speech from [].
const fs = require('node:fs');
const path = require('node:path');
const VERSION = 'source-index-v1';
const isId = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const read = file => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };
const validRange = r => r && Number.isFinite(r.start_sec) && Number.isFinite(r.end_sec) && r.start_sec >= 0 && r.end_sec > r.start_sec;
function mergeRanges(input) {
  const out = [];
  for (const r of input.filter(validRange).sort((a, b) => a.start_sec - b.start_sec || a.end_sec - b.end_sec)) {
    const last = out.at(-1);
    if (last && r.start_sec <= last.end_sec + 1e-7) last.end_sec = Math.max(last.end_sec, r.end_sec);
    else out.push({ start_sec: r.start_sec, end_sec: r.end_sec });
  }
  return out;
}
function missingRanges(coverage, start, end) {
  let cursor = start;const out = [];
  for (const r of mergeRanges(coverage)) {
    if (r.end_sec <= cursor || r.start_sec >= end) continue;
    if (r.start_sec > cursor + 1e-7) out.push({ start_sec: cursor, end_sec: Math.min(end, r.start_sec) });
    cursor = Math.max(cursor, Math.min(end, r.end_sec));
  }
  if (cursor < end - 1e-7) out.push({ start_sec: cursor, end_sec: end });
  return out;
}
const coveredSeconds = ranges => mergeRanges(ranges).reduce((n, r) => n + r.end_sec - r.start_sec, 0);
const segmentValid = (s, duration) => s && Number.isFinite(s.start) && Number.isFinite(s.end) && s.start >= 0 && s.end > s.start && s.end <= duration + 1e-6 && typeof s.text === 'string'
  && (s.words === undefined || Array.isArray(s.words) && s.words.every(w => w && Number.isFinite(w.start) && Number.isFinite(w.end) && w.start >= 0 && w.end > w.start && w.end <= duration + 1e-6 && typeof w.text === 'string'));
function manifest(root, id) {
  if (!isId(id)) return null;
  const m = read(path.join(root, id, 'index.json'));
  return m?.version === VERSION && m.index_id === id && Number.isFinite(m.duration_sec) && m.duration_sec > 0 && typeof m.has_audio === 'boolean'
    && Number.isInteger(m.options?.chunk_sec) && m.options.chunk_sec >= 10 && m.options.chunk_sec <= 300
    && typeof m.options.speech === 'boolean' && /^(auto|[a-z]{2,3})$/.test(m.options.language)
    && m.total_chunks === Math.ceil(m.duration_sec / m.options.chunk_sec) ? m : null;
}
function scanValid(c, m, n) {
  return c?.index === n && c.start_sec === n * m.options.chunk_sec && c.end_sec === Math.min(m.duration_sec, (n + 1) * m.options.chunk_sec)
    && Array.isArray(c.bins) && c.bins.length > 0 && c.bins.every(b => b && Number.isFinite(b.time_sec) && b.time_sec >= c.start_sec && b.time_sec < c.end_sec && Number.isFinite(b.change))
    && Array.isArray(c.cuts) && c.cuts.every(t => Number.isFinite(t) && t >= c.start_sec && t < c.end_sec);
}
function collect(root, fingerprint, duration) {
  const views = [], records = [];let names = [];
  try { names = fs.readdirSync(root).filter(isId).sort(); } catch { /* first analysis */ }
  for (const name of names) {
    const m = manifest(root, name);
    if (!m || m.fingerprint !== fingerprint || m.duration_sec !== duration) continue;
    const chunks = [];
    for (let n = 0; n < m.total_chunks; n++) {
      const c = read(path.join(root, name, `${n}.chunk.json`));
      if (!c || c.index !== n || c.start_sec !== n * m.options.chunk_sec || c.end_sec !== Math.min(m.duration_sec, (n + 1) * m.options.chunk_sec)) continue;
      const scan_valid = !!scanValid(c, m, n);
      if (scan_valid) chunks.push(c);
      records.push({ manifest: m, chunk: c, scan_valid });
    }
    views.push({ ...m, chunks });
  }
  return { views, records };
}
function reuseScan(records, start, end) {
  const relevant = records.filter(r => r.scan_valid !== false && r.chunk.end_sec > start && r.chunk.start_sec < end);
  if (missingRanges(relevant.map(r => r.chunk), start, end).length) return null;
  const bins = new Map(), cuts = new Set();
  for (const { chunk } of relevant) {
    for (const b of chunk.bins) if (b.time_sec >= start && b.time_sec < end && !bins.has(b.time_sec)) bins.set(b.time_sec, b);
    for (const t of chunk.cuts) if (t >= start && t < end) cuts.add(t);
  }
  return bins.size ? { bins: [...bins.values()].sort((a, b) => a.time_sec - b.time_sec), cuts: [...cuts].sort((a, b) => a - b) } : null;
}
function speechRecords(records) {
  return records.flatMap(({ manifest: m, chunk: c }) => {
    // Legacy speech-enabled chunks were committed only after recognition. New
    // records explicitly distinguish a committed scan from completed speech.
    const state = c.transcript_state;
    if (!(state ? state.status === 'processed' : m.options.speech) || !Array.isArray(c.segments) || !c.segments.every(s => segmentValid(s, m.duration_sec))) return [];
    // The old implementation skipped ASR whenever it found no loud bin, even
    // if audio measurements were missing. Do not migrate that unknown as silence.
    if (m.has_audio && state?.version !== 2 && !c.segments.length
      && !(c.bins || []).some(b => Number.isFinite(b?.rms_db) && b.rms_db > -100)
      && !(c.bins?.length && c.bins.every(b => Number.isFinite(b?.rms_db) && b.rms_db <= -100))) return [];
    const language = state?.language || m.options.language;
    if (!/^(auto|[a-z]{2,3})$/.test(language)) return [];
    return [{ start_sec: c.start_sec, end_sec: c.end_sec, language, segments: c.segments }];
  });
}
function selectTranscript(records, requested = 'auto', start = 0, end = Infinity) {
  const speech = speechRecords(records), languages = [...new Set(speech.map(r => r.language))];
  const score = lang => coveredSeconds(speech.filter(r => r.language === lang).map(r => ({ start_sec: Math.max(start, r.start_sec), end_sec: Math.min(end, r.end_sec) })));
  // Auto can reuse one coherent cached language. Never combine different
  // language hypotheses or silently substitute one explicitly requested code.
  const language = requested === 'auto' ? languages.sort((a, b) => score(b) - score(a) || (a === 'auto' ? -1 : b === 'auto' ? 1 : a.localeCompare(b)))[0] || 'auto' : requested;
  const selected = speech.filter(r => r.language === language).sort((a, b) => a.start_sec - b.start_sec || b.end_sec - a.end_sec);
  const coverage = mergeRanges(selected), segments = [], seen = new Set();let used = [];
  for (const r of selected) {
    const gaps = missingRanges(used, r.start_sec, r.end_sec);
    for (const original of r.segments) {
      const owns = time => gaps.some(g => time >= g.start_sec && time < g.end_sec);
      let s = original;
      if (s.words?.length) {
        const words = s.words.filter(w => owns((w.start + w.end) / 2));
        if (!words.length) continue;
        if (words.length !== s.words.length) s = { ...s, start: words[0].start, end: words.at(-1).end, words, text: words.map(w => w.text.trim()).join(' ') };
      } else {
        if (!owns((s.start + s.end) / 2)) continue;
        if (!gaps.some(g => s.start >= g.start_sec && s.end <= g.end_sec)) s = { ...s, boundary_uncertain: true };
      }
      const key = JSON.stringify([s.start, s.end, s.text]);
      if (!seen.has(key)) { seen.add(key);segments.push(s); }
    }
    used = mergeRanges([...used, r]);
  }
  return { language, coverage, segments: segments.sort((a, b) => a.start - b.start || a.end - b.end) };
}
// Strict source windows must not leak dialogue beyond a delegated scope. Whole
// crossing sentences without word timings are omitted rather than relabelled.
function sliceTranscript(segments, start, end, strict = true) {
  let omitted = 0;
  const clipped = (Array.isArray(segments) ? segments : []).filter(s => segmentValid(s, Infinity)).flatMap(s => {
    if (s.end <= start || s.start >= end) return [];
    if (s.start >= start && s.end <= end) return [s];
    if (s.words?.length) {
      const words = s.words.filter(w => w.start >= start && w.end <= end);
      if (!words.length) { omitted++;return []; }
      return [{ ...s, start: words[0].start, end: words.at(-1).end, words, text: words.map(w => w.text.trim()).join(' '), boundary_clipped: true }];
    }
    if (strict) { omitted++;return []; }
    return [s];
  });
  return { segments: clipped, omitted_boundary_segments: omitted };
}
function transcriptStatus(index, start = 0, end = index.duration_sec) {
  const transcript = index.source_transcript || { language: index.options.language, coverage: [], segments: [] };
  const coverage = mergeRanges(transcript.coverage.map(r => ({ start_sec: Math.max(start, r.start_sec), end_sec: Math.min(end, r.end_sec) })));
  const missing = index.has_audio ? missingRanges(coverage, start, end) : [];
  const text = sliceTranscript(transcript.segments, start, end);
  return { status: !index.has_audio ? 'no_audio' : !missing.length ? 'complete' : coverage.length ? 'partial' : 'missing',
    language: transcript.language, coverage, missing_ranges: missing.slice(0, 100), missing_ranges_total: missing.length,
    processed_sec: coveredSeconds(coverage), has_text: text.segments.some(s => s.text.trim()), omitted_boundary_segments: text.omitted_boundary_segments,
    uncertain_boundary_segments: text.segments.filter(s => s.boundary_uncertain).length };
}
function evidenceWarnings(index, status = transcriptStatus(index)) {
  if (!index.has_audio) return [];
  if (status.status !== 'complete') return [{ code: 'transcript_incomplete', message: 'This source has audio, but speech processing does not cover the entire requested range. Missing transcript is not evidence of silence. Reuse or complete speech analysis before drawing conclusions about dialogue.', missing_ranges: status.missing_ranges }];
  if (!status.has_text && status.omitted_boundary_segments) return [{ code: 'transcript_boundary_omitted', message: 'Recognized text crossed the requested boundary and could not be safely included. It was omitted; an empty range is not evidence of silence.' }];
  if (!status.has_text) return [{ code: 'no_recognized_text', message: 'Speech processing completed for this range but recognized no text. This is not proof that no dialogue exists.' }];
  if (status.uncertain_boundary_segments) return [{ code: 'transcript_timing_uncertain', message: 'Some recognized sentences cross cached evidence boundaries without word timings. Their exact word placement is uncertain.' }];
  return [];
}
module.exports = { VERSION, isId, read, manifest, scanValid, collect, reuseScan, selectTranscript, sliceTranscript, transcriptStatus, evidenceWarnings, mergeRanges, missingRanges, coveredSeconds };
