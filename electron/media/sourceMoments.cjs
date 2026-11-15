const { createHash } = require('node:crypto');
const { mergeRanges, sliceTranscript } = require('./sourceEvidence.cjs');
const round = n => Math.round(n * 1000) / 1000;
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const overlap = (a, b) => Math.max(0, Math.min(a.end_sec, b.end_sec) - Math.max(a.start_sec, b.start_sec));
const percentile = (values, q) => { const sorted = [...values].sort((a, b) => a - b);return sorted[Math.floor((sorted.length - 1) * q)] || 0; };
function ranges(chunks) {
  return mergeRanges(chunks);
}
function candidates(index, { kind = 'general', query = '', clip_length_sec = 30, start_sec = 0, end_sec = index.duration_sec, offset = 0, limit = 12 } = {}) {
  if (!['general', 'movie', 'stream', 'gameplay', 'talk'].includes(kind)) throw Error('kind must be general, movie, stream, gameplay or talk.');
  if (!Number.isFinite(clip_length_sec) || clip_length_sec < 5 || clip_length_sec > 90) throw Error('Use clip_length_sec from 5 to 90.');
  if (!Number.isFinite(start_sec) || start_sec < 0 || !Number.isFinite(end_sec) || end_sec <= start_sec || end_sec > index.duration_sec + .001) throw Error('Use a valid source-time search range.');
  if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 30 || typeof query !== 'string' || query.length > 200) throw Error('Use offset >= 0, limit 1–30 and a short query.');
  const chunks = index.chunks, coverage = ranges(chunks), bins = chunks.flatMap(c => c.bins).filter(b => b.time_sec >= start_sec && b.time_sec < end_sec);
  const segments = index.source_transcript?.segments || chunks.flatMap(c => c.segments || []), cuts = chunks.flatMap(c => c.cuts);
  const motion90 = Math.max(.015, percentile(bins.map(b => b.change), .9)), levels = bins.filter(b => b.rms_db > -55).map(b => b.rms_db);
  const level50 = percentile(levels, .5), level90 = Math.max(level50 + 6, percentile(levels, .9));
  const q = query.trim().toLocaleLowerCase(), seeds = [];
  for (let i = 0; i < bins.length; i++) {
    const b = bins[i], motion = Math.min(1, b.change / motion90), energy = b.rms_db === undefined ? 0 : Math.max(0, Math.min(1, (b.rms_db - level50) / (level90 - level50)));
    const last = i > 0 && bins[i - 1].time_sec >= b.time_sec - .6 ? bins[i - 1] : null;
    const rise = b.rms_db === undefined || !last || last.rms_db === undefined ? 0 : Math.max(0, Math.min(1, (b.rms_db - last.rms_db) / 12));
    const weights = kind === 'gameplay' ? [.5, .2, .3] : kind === 'stream' ? [.15, .4, .45] : [.4, .3, .3];
    const score = motion * weights[0] + energy * weights[1] + rise * weights[2];
    if (score >= .3 && b.light > .03) seeds.push({ t: b.time_sec, score, signals: [motion > .65 && 'visual change', energy > .6 && 'elevated audio', rise > .5 && 'audio rise'].filter(Boolean) });
  }
  for (const s of segments) {
    if (s.end <= start_sec || s.start >= end_sec || !s.text?.trim()) continue;
    const match = q && s.text.toLocaleLowerCase().includes(q);
    seeds.push({ t: s.start, score: match ? 3 : kind === 'talk' ? .7 : .45, signals: [match ? 'transcript query match' : 'speech passage'] });
  }
  // Uniform exploration prevents quiet, dialogue-free scenes from disappearing.
  for (const c of coverage) for (let t = Math.max(c.start_sec, start_sec); t < Math.min(c.end_sec, end_sec); t += Math.max(clip_length_sec * 2, 30)) seeds.push({ t, score: .15, signals: ['coverage sample'] });
  const make = seed => {
    const span = coverage.find(c => seed.t >= c.start_sec && seed.t < c.end_sec);if (!span) return null;
    const lo = Math.max(span.start_sec, start_sec), hi = Math.min(span.end_sec, end_sec);
    let start = Math.max(lo, seed.t - Math.min(8, clip_length_sec * .3)), end = Math.min(hi, start + clip_length_sec);
    start = Math.max(lo, end - clip_length_sec);
    // Prefer whole speech boundaries, with a bounded allowance beyond target length.
    const first = segments.find(s => s.start < start && s.end > start && s.start >= start - 3 && s.start >= lo);
    if (first) start = Math.max(lo, first.start - .15);
    const last = segments.find(s => s.start < end && s.end > end && s.end <= end + 3 && s.end <= hi);
    if (last) end = Math.min(hi, last.end + .2);
    if (end - start > 90) end = start + 90;
    if (end - start < Math.min(5, index.duration_sec)) return null;
    const speech = sliceTranscript(segments, start, end).segments;
    if (q && !speech.some(s => s.text.toLocaleLowerCase().includes(q))) return null;
    const row = { start_sec: round(start), end_sec: Math.min(index.duration_sec, round(end)), anchor_sec: round(seed.t), signal_score: round(seed.score), signals: seed.signals,
      transcript: speech.map(s => s.text).join(' ').slice(0, 1800), shot_changes: cuts.filter(t => t >= start && t < end).length,
      needs_review: true, selection_basis: 'local_signals', kind };
    row.moment_id = hash([index.index_id, row.start_sec, row.end_sec]);return row;
  };
  // Keep the strongest seed in each short region before expanding windows.
  // Otherwise a multi-hour source repeats transcript scans for every half-second.
  const buckets = new Map();
  for (const seed of seeds) { const key = Math.floor(seed.t / Math.max(2, clip_length_sec / 2)), previous = buckets.get(key);if (!previous || seed.score > previous.score) buckets.set(key, seed); }
  const ranked = [...buckets.values()].sort((a, b) => b.score - a.score || a.t - b.t).map(make).filter(Boolean), selected = [];
  for (const row of ranked) if (!selected.some(p => overlap(row, p) / Math.min(row.end_sec - row.start_sec, p.end_sec - p.start_sec) > .5)) selected.push(row);
  // Keep a separate chronological exploration page even when high-energy moments dominate.
  const exploration = !q ? seeds.filter(s => s.signals[0] === 'coverage sample').map(make).filter(Boolean) : [];
  return { total_candidates: selected.length, offset, next_offset: offset + limit < selected.length ? offset + limit : null, candidates: selected.slice(offset, offset + limit),
    exploration: exploration.slice(offset, offset + limit), next_exploration_offset: offset + limit < exploration.length ? offset + limit : null,
    note: 'Signal scores are retrieval priority, not clip quality or confidence. Review context and sampled frames, read speech, compare quiet exploration samples and judge setup/payoff. No action, emotion, laughter or game event recognition is claimed.' };
}
module.exports = { candidates, ranges, hash, overlap };
