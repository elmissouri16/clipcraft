const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { fileFingerprint } = require('./mediaAnalysis.cjs');
const { probe } = require('./ffmpeg.cjs');
const { scanChunk, encodePreview, abortError } = require('./sourceSignals.cjs');
const { candidates, ranges, hash, overlap } = require('./sourceMoments.cjs');
const evidence = require('./sourceEvidence.cjs');
const { VERSION, isId: id, read } = evidence;
const stop = signal => { if (signal?.aborted) throw abortError(); };
function write(file, value) { const tmp = `${file}.${randomUUID()}.tmp`;try { fs.writeFileSync(tmp, JSON.stringify(value));fs.renameSync(tmp, file); } finally { fs.rmSync(tmp, { force: true }); } }
class SourceIndex {
  constructor(root, services = {}) {
    this.root = root;this.scan = services.scan || scanChunk;this.probe = services.probe || probe;this.transcribe = services.transcribe;this.encode = services.encode || encodePreview;
    this.busy = new Set();this.reviews = new Map();
  }
  folder(indexId) { if (!id(indexId)) throw Error('Unknown video index.');return path.join(this.root, indexId); }
  source(media) { if (media?.type !== 'video' || !media.path) throw Error('Select a video from the media library.');return fileFingerprint(media.path); }
  assemble(index, records) {
    const speech = evidence.selectTranscript(records, index.options.language, 0, index.duration_sec), chunks = [];
    for (let n = 0; n < index.total_chunks; n++) {
      const start = n * index.options.chunk_sec, end = Math.min(index.duration_sec, (n + 1) * index.options.chunk_sec);
      const scan = evidence.reuseScan(records, start, end);
      if (scan) chunks.push({ index: n, start_sec: start, end_sec: end, ...scan,
        segments: speech.segments.filter(s => (s.start + s.end) / 2 >= start && (s.start + s.end) / 2 < end) });
    }
    return { ...index, chunks, source_transcript: speech };
  }
  load(media, indexId) {
    this.folder(indexId);
    const index = evidence.manifest(this.root, indexId), fingerprint = this.source(media);
    if (!index || index.fingerprint !== fingerprint) throw Error('Video index is missing or stale. Run index_video for the current source.');
    return this.assemble(index, evidence.collect(this.root, fingerprint, index.duration_sec).records);
  }
  status(index) {
    const coverage = ranges(index.chunks), indexed = coverage.reduce((n, r) => n + r.end_sec - r.start_sec, 0);
    const missing = [];for (let n = 0; n < index.total_chunks; n++) if (!index.chunks.some(c => c.index === n)) missing.push({ start_sec: n * index.options.chunk_sec, end_sec: Math.min(index.duration_sec, (n + 1) * index.options.chunk_sec) });
    const transcript = evidence.transcriptStatus(index), visualComplete = !missing.length;
    return { index_id: index.index_id, duration_sec: index.duration_sec, completed_chunks: index.chunks.length, total_chunks: index.total_chunks, indexed_sec: indexed,
      complete: visualComplete && (!index.options.speech || !index.has_audio || transcript.status === 'complete'), visual_complete: visualComplete,
      coverage, unscanned_ranges: missing.slice(0, 100), unscanned_ranges_total: missing.length,
      speech: !index.has_audio ? 'no_audio' : transcript.coverage.length ? 'local_transcript' : index.options.speech ? 'missing' : 'not_requested',
      transcript, warnings: evidence.evidenceWarnings(index, transcript),
      limitations: 'Visual changes and stereo audio activity are measured locally. Sampled frames and transcripts need semantic review. Continuous audiovisual understanding and automatic game/movie event recognition are not provided.' };
  }
  describe(media, { offset = 0, limit = 12 } = {}) {
    if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 30) throw Error('Use offset >= 0 and limit 1–30.');
    const fingerprint = this.source(media);let first;
    try { first = fs.readdirSync(this.root).filter(id).map(key => evidence.manifest(this.root, key)).find(m => m?.fingerprint === fingerprint); } catch { /* no analysis yet */ }
    if (!first) return { ok: true, media_id: media.id, analyses: [], total_analyses: 0, offset, next_offset: null, recommended_index_id: null, note: 'No cached analysis for the current source. Use index_video; speech processing is enabled by default.' };
    const catalog = evidence.collect(this.root, fingerprint, first.duration_sec);
    const analyses = catalog.views.map(view => ({ ...this.status(this.assemble(view, catalog.records)), options: view.options }));
    analyses.sort((a, b) => b.transcript.processed_sec - a.transcript.processed_sec || b.indexed_sec - a.indexed_sec || Number(b.options.speech) - Number(a.options.speech) || a.index_id.localeCompare(b.index_id));
    return { ok: true, media_id: media.id, analyses: analyses.slice(offset, offset + limit), total_analyses: analyses.length, offset, next_offset: offset + limit < analyses.length ? offset + limit : null, recommended_index_id: analyses[0]?.index_id || null,
      note: 'Cached evidence is shared across compatible index views. A transcript describes source dialogue, independently of the current timeline mix and narration. Read actual coverage and language before reuse.' };
  }
  transcript(media, indexId, { start_sec = 0, end_sec, offset = 0, limit = 40, query = '' } = {}) {
    const index = this.load(media, indexId);end_sec ??= index.duration_sec;
    if (!Number.isFinite(start_sec) || !Number.isFinite(end_sec) || start_sec < 0 || end_sec <= start_sec || end_sec > index.duration_sec
      || !Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 80 || typeof query !== 'string' || query.length > 200) throw Error('Use a valid source range, offset >= 0, limit 1–80 and a short literal query.');
    const sliced = evidence.sliceTranscript(index.source_transcript.segments, start_sec, end_sec), q = query.trim().toLocaleLowerCase();
    const segments = sliced.segments.filter(s => !q || s.text.toLocaleLowerCase().includes(q)), page = segments.slice(offset, offset + limit);
    const status = evidence.transcriptStatus(index, start_sec, end_sec);
    return { ok: true, index_id: indexId, media_id: media.id, source_range: { start_sec, end_sec }, transcript: status,
      segments: page.map(({ words, ...s }) => s), total_segments: segments.length, offset, next_offset: offset + limit < segments.length ? offset + limit : null,
      warnings: evidence.evidenceWarnings(index, status), omitted_boundary_segments: sliced.omitted_boundary_segments,
      note: 'Source-time dialogue, not recap narration. Speech processing coverage does not mean every word was recognized correctly. Continue paging before claiming to have read the entire range.' };
  }
  async index(media, opts = {}, { signal, onProgress = () => {} } = {}) {
    const { chunk_sec = 120, speech = true, language = 'auto', max_chunks = 8 } = opts;
    if (!Number.isInteger(chunk_sec) || chunk_sec < 10 || chunk_sec > 300 || typeof speech !== 'boolean' || typeof language !== 'string' || !/^(auto|[a-z]{2,3})$/.test(language)
      || !Number.isInteger(max_chunks) || max_chunks < 1 || max_chunks > 32) throw Error('Use chunk_sec 10–300, max_chunks 1–32, speech true/false and a language code or auto.');
    stop(signal);const fingerprint = this.source(media), info = await this.probe(media.path);stop(signal);
    if (info.type !== 'video' || !Number.isFinite(info.duration) || info.duration <= 0) throw Error('Source has no measurable video duration.');
    const options = { chunk_sec, speech: speech && !!info.hasAudio, language }, indexId = hash([VERSION, fingerprint, options]);
    if (this.busy.has(fingerprint)) throw Error('This source analysis is already being updated. Reuse completed evidence or retry after the active scan.');
    this.busy.add(fingerprint);
    try {
      const folder = this.folder(indexId);fs.mkdirSync(folder, { recursive: true });
      // Recreate deterministic metadata so a damaged manifest is repairable.
      // Completed chunk files are independently validated and retained.
      write(path.join(folder, 'index.json'), { version: VERSION, index_id: indexId, fingerprint, duration_sec: info.duration, has_audio: !!info.hasAudio, options, total_chunks: Math.ceil(info.duration / chunk_sec) });
      let catalog = evidence.collect(this.root, fingerprint, info.duration), index = this.assemble(evidence.manifest(this.root, indexId), catalog.records), processed = 0;
      const effectiveLanguage = evidence.selectTranscript(catalog.records, language, 0, info.duration).language;
      onProgress({ ...this.status(index), stage: 'Indexing video' });
      for (let n = 0; n < index.total_chunks && processed < max_chunks; n++) {
        stop(signal);const start = n * chunk_sec, end = Math.min(info.duration, start + chunk_sec);
        const knownSpeech = evidence.selectTranscript(catalog.records, effectiveLanguage, start, end);
        const speechMissing = options.speech ? evidence.missingRanges(knownSpeech.coverage, start, end) : [];
        let measured = evidence.reuseScan(catalog.records, start, end);
        if (measured && !speechMissing.length) continue;
        // A half-second overlap carries the preceding picture/audio into cut
        // detection at an exact chunk boundary. Commit only the core interval.
        if (!measured) {
          const pieces = [...catalog.records], gaps = evidence.missingRanges(catalog.records.filter(r => r.scan_valid).map(r => r.chunk), start, end);
          for (const gap of gaps) {
            const scan = await this.scan(media.path, Math.max(0, gap.start_sec - .5), gap.end_sec, !!info.hasAudio, signal);stop(signal);
            pieces.push({ chunk: { start_sec: gap.start_sec, end_sec: gap.end_sec,
              bins: scan.bins.filter(b => b.time_sec >= gap.start_sec && b.time_sec < gap.end_sec), cuts: scan.cuts.filter(t => t >= gap.start_sec && t < gap.end_sec) } });
          }
          measured = evidence.reuseScan(pieces, start, end);
          if (!measured) throw Error('Source scan returned incomplete visual evidence.');
        }
        stop(signal);
        measured.bins = measured.bins.filter(b => b.time_sec >= start && b.time_sec < end);
        measured.cuts = measured.cuts.filter(t => t >= start && t < end);
        if (this.source(media) !== fingerprint) throw Error('Source changed during indexing. Run index_video again.');
        const chunkFile = path.join(folder, `${n}.chunk.json`), existing = read(chunkFile);
        // A scan and ASR are separate capabilities. A failed recognizer must
        // preserve the scan without labelling its empty text as processed speech.
        const cachedSpeechComplete = !evidence.missingRanges(knownSpeech.coverage, start, end).length;
        if (!evidence.scanValid(existing, index, n)) write(chunkFile, { index: n, start_sec: start, end_sec: end, ...measured,
          segments: cachedSpeechComplete ? knownSpeech.segments.filter(s => (s.start + s.end) / 2 >= start && (s.start + s.end) / 2 < end) : [],
          transcript_state: cachedSpeechComplete ? { version: 2, status: 'processed', language: effectiveLanguage } : { status: 'missing' } });
        let segments = knownSpeech.segments.filter(s => (s.start + s.end) / 2 >= start && (s.start + s.end) / 2 < end);
        for (const gap of speechMissing) {
          const gapBins = measured.bins.filter(b => b.time_sec >= gap.start_sec && b.time_sec < gap.end_sec);
          // Missing audio measurements are unknown, not quiet. Skip recognition
          // only when every measured sample in this interval confirms near-silence.
          if (gapBins.length && gapBins.every(b => Number.isFinite(b.rms_db) && b.rms_db <= -100)) continue;
          if (!this.transcribe) throw Error('Local transcription is unavailable. Configure speech or explicitly index with speech false.');
          onProgress({ ...this.status(index), stage: 'Transcribing source chunk', chunk_start_sec: start });
          let speechStart = Math.max(0, gap.start_sec - 2), speechEnd = Math.min(info.duration, gap.end_sec + 2);
          // Whisper can place the first words inside a long silent lead-in.
          // Keep contextual overlap for active boundaries, but remove verified
          // near-silence at a chunk's outer edges before recognition.
          const inGap = measured.bins.filter(b => b.time_sec >= gap.start_sec && b.time_sec < gap.end_sec);
          const active = inGap.filter(b => b.rms_db > -65), first = active[0], last = active.at(-1);
          if (first && first.time_sec > gap.start_sec + .5 && inGap.filter(b => b.time_sec < first.time_sec).every(b => b.rms_db < -80)) speechStart = Math.max(0, first.time_sec - .25);
          if (last && gap.end_sec - last.time_sec > 1 && inGap.filter(b => b.time_sec > last.time_sec).every(b => b.rms_db < -80)) speechEnd = Math.min(info.duration, last.time_sec + 1);
          const result = await this.transcribe(media, speechStart, speechEnd, effectiveLanguage, signal);
          if (!Array.isArray(result) || result.some(s => !s || !Number.isFinite(s.start) || !Number.isFinite(s.end) || s.start < 0 || s.end <= s.start || typeof s.text !== 'string'
            || s.words !== undefined && (!Array.isArray(s.words) || s.words.some(w => !w || !Number.isFinite(w.start) || !Number.isFinite(w.end) || w.start < 0 || w.end <= w.start || typeof w.text !== 'string')))) throw Error('Source transcription returned no valid transcript.');
          segments.push(...result.flatMap(s => {
            if (!Number.isFinite(s.start) || !Number.isFinite(s.end) || s.end <= s.start || typeof s.text !== 'string') return [];
            const from = Math.max(0, speechStart + s.start), to = Math.min(info.duration, speechStart + s.end);
            const words = (Array.isArray(s.words) ? s.words : []).filter(w => Number.isFinite(w.start) && Number.isFinite(w.end) && w.end > w.start && typeof w.text === 'string')
              .map(w => ({ ...w, start: Math.max(0, speechStart + w.start), end: Math.min(info.duration, speechStart + w.end) }))
              .filter(w => w.end > w.start && (w.start + w.end) / 2 >= gap.start_sec && (w.start + w.end) / 2 < gap.end_sec);
            if (s.words?.length && !words.length || !s.words?.length && ((from + to) / 2 < gap.start_sec || (from + to) / 2 >= gap.end_sec)) return [];
            const crosses = from < gap.start_sec || to > gap.end_sec;
            return [{ start: words.length ? words[0].start : from, end: words.length ? words.at(-1).end : to,
              text: (crosses && words.length ? words.map(w => w.text.trim()).join(' ') : s.text).slice(0, 4000), ...(words.length ? { words } : {}) }];
          }));
        }
        stop(signal);if (this.source(media) !== fingerprint) throw Error('Source changed during indexing. Run index_video again.');
        const chunk = { index: n, start_sec: start, end_sec: end, ...measured, segments,
          transcript_state: options.speech || cachedSpeechComplete ? { version: 2, status: 'processed', language: effectiveLanguage } : { status: 'missing' } };
        write(chunkFile, chunk);catalog = evidence.collect(this.root, fingerprint, info.duration);index = this.assemble(evidence.manifest(this.root, indexId), catalog.records);processed++;
        onProgress({ ...this.status(index), stage: 'Indexed source chunk' });
      }
      stop(signal);if (this.source(media) !== fingerprint) throw Error('Source changed during indexing. Run index_video again.');
      return { ok: true, ...this.status(index), processed_chunks: processed, next: this.status(index).complete ? 'Use find_video_moments, then review candidates and quiet exploration samples before proposing clips.' : 'Call index_video again with the same options to resume. Results currently cover only the reported ranges.' };
    } finally { this.busy.delete(fingerprint); }
  }
  find(media, indexId, opts) {
    const index = this.load(media, indexId);return { ok: true, ...this.status(index), ...candidates(index, opts) };
  }
  async review(media, req, { owner, signal } = {}) {
    const index = this.load(media, req.index_id), start = req.start_sec, end = req.end_sec;
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end > index.duration_sec || end <= start || end - start > 90) throw Error('Review a source range of up to 90 seconds.');
    if (req.context_start_sec !== undefined && (!Number.isFinite(req.context_start_sec) || req.context_start_sec < 0 || req.context_start_sec > start)
      || req.context_end_sec !== undefined && (!Number.isFinite(req.context_end_sec) || req.context_end_sec < end || req.context_end_sec > index.duration_sec)) throw Error('Use valid source context bounds containing the reviewed range.');
    if (!ranges(index.chunks).some(r => r.start_sec <= start && r.end_sec >= end)) throw Error('Index this entire source range before reviewing it.');
    // IDs returned by find_video_moments bind the exact suggested range. Refinement
    // is supported by reviewing an explicit source range without a moment_id.
    if (req.moment_id && req.moment_id !== hash([index.index_id, start, end])) throw Error('Candidate range changed. Omit moment_id to review a refined source range.');
    const folder = this.folder(index.index_id), key = hash([index.index_id, start, end, 'preview-v2']), file = path.join(folder, `${key}.mp4`);
    const temp = path.join(folder, `${key}.${randomUUID()}.tmp.mp4`);
    stop(signal);
    const valid = info => info?.type === 'video' && info.duration > 0 && Math.abs(info.duration - (end - start)) <= .3;
    let preview;
    if (fs.existsSync(file)) { try { preview = await this.probe(file); } catch {}if (!valid(preview)) { fs.rmSync(file, { force: true });preview = null; } }
    if (!preview) {
      try {
        await this.encode(media.path, temp, start, end, signal);stop(signal);preview = await this.probe(temp);
        if (!valid(preview)) throw Error('Preview duration does not match the source range.');
        if (this.source(media) !== index.fingerprint) throw Error('Source changed during preview.');
        stop(signal);fs.renameSync(temp, file);
      } finally { fs.rmSync(temp, { force: true }); }
    }
    if (this.source(media) !== index.fingerprint) throw Error('Source changed during review.');
    const reviewId = randomUUID();stop(signal);
    const record = { review_id: reviewId, owner, index_id: index.index_id, fingerprint: index.fingerprint, media_id: media.id, start_sec: start, end_sec: end, file, preview_fingerprint: fileFingerprint(file) };
    if (this.reviews.size >= 200) this.reviews.delete(this.reviews.keys().next().value);this.reviews.set(reviewId, record);
    const contextStart = Math.max(0, start - 15, req.context_start_sec ?? 0), contextEnd = Math.min(index.duration_sec, end + 15, req.context_end_sec ?? index.duration_sec);
    if (contextStart > start || contextEnd < end) throw Error('Review context must contain the reviewed range.');
    const sliced = evidence.sliceTranscript(index.source_transcript.segments, contextStart, contextEnd);
    const transcript = sliced.segments.map(({ words, ...s }) => s), speechStatus = evidence.transcriptStatus(index, contextStart, contextEnd);
    const bins = index.chunks.flatMap(c => c.bins).filter(b => b.time_sec >= start && b.time_sec < end);
    return { ok: true, ...record, owner: undefined, preview_fingerprint: undefined, transcript: transcript.slice(0, 100), transcript_partial: transcript.length > 100,
      transcript_status: speechStatus, transcript_context: { start_sec: contextStart, end_sec: contextEnd }, omitted_boundary_segments: sliced.omitted_boundary_segments,
      warnings: evidence.evidenceWarnings(index, speechStatus),
      signals: { max_frame_change: Math.max(0, ...bins.map(b => b.change)), max_rms_db: bins.some(b => b.rms_db !== undefined) ? Math.max(...bins.map(b => b.rms_db ?? -120)) : null, shot_changes: index.chunks.flatMap(c => c.cuts).filter(t => t >= start && t < end) },
      metadata: { duration_sec: preview.duration, width: preview.width, height: preview.height },
      sample_times_sec: [0, .18, .38, .58, .78, .98].map(f => Math.min(end - .001, start + (end - start) * f)),
      note: 'Preview is for human playback. The agent reviews sampled stills and transcript, not continuous video or heard audio. Confirm setup/payoff and inspect further raw frames when uncertain.' };
  }
  propose(media, req, { owner, evidence: frameEvidence } = {}) {
    const index = this.load(media, req.index_id);
    if (!Array.isArray(req.picks) || !req.picks.length || req.picks.length > 6) throw Error('Propose 1–6 reviewed clips. Re-review finalists immediately before proposing after a long exploration.');
    const picks = req.picks.map(p => {
      const review = this.reviews.get(p.review_id);
      if (!review || review.owner !== owner || review.index_id !== index.index_id || review.media_id !== media.id || review.fingerprint !== index.fingerprint || review.preview_fingerprint !== fileFingerprint(review.file)) throw Error('Each pick needs a current review_video_moment result from this request and unchanged source/preview.');
      if (typeof p.title !== 'string' || !p.title.trim() || p.title.length > 120 || typeof p.reason !== 'string' || !p.reason.trim() || p.reason.length > 1000 || !['low', 'medium', 'high'].includes(p.confidence)) throw Error('Each pick needs a short title, a reason and low/medium/high confidence.');
      if (!Array.isArray(p.frame_ids) || !p.frame_ids.length) throw Error('Present actual raw source frames before proposing a clip.');
      const frames = frameEvidence(p.frame_ids);
      if (new Set(p.frame_ids).size < 3 || frames.length < 3 || frames.some(f => f.source !== 'media' || f.media_id !== media.id || f.fingerprint !== index.fingerprint || f.source_time_sec < review.start_sec || f.source_time_sec >= review.end_sec)
        || ![.2, .5, .8].every(fraction => frames.some(f => Math.abs((f.source_time_sec - review.start_sec) / (review.end_sec - review.start_sec) - fraction) <= .22))) throw Error('Present source samples spanning the beginning, middle and end of each proposed clip.');
      return { pick_id: hash([index.index_id, review.start_sec, review.end_sec]), index_id: index.index_id, media_id: media.id, source_name: media.name,
        start_sec: review.start_sec, end_sec: review.end_sec, title: p.title.trim(), reason: p.reason.trim(), confidence: p.confidence,
        file: review.file, fingerprint: index.fingerprint, transcript_status: evidence.transcriptStatus(index, review.start_sec, review.end_sec),
        selection_basis: evidence.transcriptStatus(index, review.start_sec, review.end_sec).has_text ? 'agent_review_of_sampled_frames_and_transcript' : 'agent_review_of_sampled_frames' };
    });
    if (picks.some((p, i) => picks.slice(0, i).some(q => overlap(p, q) / Math.min(p.end_sec - p.start_sec, q.end_sec - q.start_sec) > .5))) throw Error('Suggested clips overlap substantially. Keep the strongest version of each moment.');
    const file = path.join(this.folder(index.index_id), 'picks.json'), stored = read(file), old = Array.isArray(stored) ? stored.filter(p => p && typeof p.pick_id === 'string') : [];
    write(file, [...picks, ...old.filter(p => !picks.some(q => q.pick_id === p.pick_id))].slice(0, 100));
    return { ok: true, ...this.status(index), picks, note: 'Ranked by the agent after sampled review. Confidence is the agent’s judgment, not a measured probability. The timeline is unchanged.' };
  }
  pick(media, indexId, pickId) {
    const index = this.load(media, indexId), stored = read(path.join(this.folder(indexId), 'picks.json'));
    const p = Array.isArray(stored) ? stored.find(p => p?.pick_id === pickId) : null;
    if (!p || p.fingerprint !== index.fingerprint || !Number.isFinite(p.start_sec) || !Number.isFinite(p.end_sec) || p.start_sec < 0 || !(p.end_sec > p.start_sec) || p.end_sec > index.duration_sec) throw Error('Unknown or stale clip pick. Find and review current source moments again.');
    return { ok: true, pick: p };
  }
}
module.exports = { SourceIndex };
