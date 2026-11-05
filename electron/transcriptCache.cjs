// Bounded derived transcript cache. Keys identify audible content and engine options;
// titles, crop, effects on pictures and chat never invalidate expensive speech work.
const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { audioAnalysisKey } = require('./ffmpeg.cjs');
const stop = signal => { if (signal?.aborted) throw Object.assign(new Error('Transcription stopped.'), { name: 'AbortError' }); };
class TranscriptCache {
  constructor(dir, { maxEntries = 32, maxEntryBytes = 8 * 1024 * 1024 } = {}) {
    this.dir = dir; this.maxEntries = maxEntries; this.maxEntryBytes = maxEntryBytes;
  }
  key(project, opts = {}) {
    return createHash('sha256').update(JSON.stringify({ version: 2, audio: audioAnalysisKey(project, opts),
      engine: opts.engine || 'local', provider: opts.provider || '', model: opts.model || (opts.engine === 'cloud' ? '' : 'base'),
      language: opts.language || 'auto', maxLen: opts.maxLen ?? 42 })).digest('hex');
  }
  async get(project, opts, produce, signal) {
    stop(signal);
    const key = this.key(project, opts), file = path.join(this.dir, `${key}.json`);
    try {
      const st = fs.statSync(file);
      if (st.size <= this.maxEntryBytes) {
        const entry = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (entry.version === 2 && entry.key === key && Array.isArray(entry.segments)) {
          stop(signal);
          fs.utimesSync(file, new Date(), new Date());
          return { ok: true, segments: entry.segments, audio_revision: key, source_audio_key: audioAnalysisKey(project, opts), cached: true };
        }
      }
    } catch (error) { if (error.name === 'AbortError') throw error; }
    const segments = await produce(); stop(signal);
    if (this.key(project, opts) !== key) throw new Error('The source audio changed during transcription. Retry with the current source.');
    if (!Array.isArray(segments) || !segments.length) throw new Error('No speech was detected in the selected audible source. Check the source and language.');
    const json = JSON.stringify({ version: 2, key, segments });
    if (Buffer.byteLength(json) <= this.maxEntryBytes) {
      const temp = `${file}.${randomUUID()}.tmp`;
      try {
        fs.mkdirSync(this.dir, { recursive: true }); fs.writeFileSync(temp, json, { flag: 'wx' }); stop(signal); fs.renameSync(temp, file);
        const entries = fs.readdirSync(this.dir).filter(name => /^[a-f0-9]{64}\.json$/.test(name))
          .map(name => ({ name, time: fs.statSync(path.join(this.dir, name)).mtimeMs })).sort((a, b) => b.time - a.time);
        for (const entry of entries.slice(this.maxEntries)) fs.rmSync(path.join(this.dir, entry.name), { force: true });
      } catch (error) { if (error.name === 'AbortError') throw error; /* Cache I/O must not discard a successful transcript. */ }
      finally { fs.rmSync(temp, { force: true }); }
    }
    return { ok: true, segments, audio_revision: key, source_audio_key: audioAnalysisKey(project, opts), cached: false };
  }
}
module.exports = { TranscriptCache };
