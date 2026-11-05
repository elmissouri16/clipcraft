const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { TranscriptCache } = require('./transcriptCache.cjs');
const ffmpeg = require('./ffmpeg.cjs');
const stop = signal => { if (signal?.aborted) throw Object.assign(new Error('Transcription stopped.'), { name: 'AbortError' }); };

function createTranscriptService({ cacheDir, whisperDir, whisper = require('./whisper.cjs'), cloud = require('./cloudCaptions.cjs'),
  renderAudio = ffmpeg.renderTimelineAudio, probe = ffmpeg.probe, ffmpegPath = ffmpeg.ffmpegPath, fetchImpl, getKey = () => '' }) {
  const cache = new TranscriptCache(cacheDir);
  return {
    async run(project, opts = {}, { signal, onProgress = () => {} } = {}) {
      stop(signal);
      const engine = opts.engine || 'local';
      if (!['local', 'cloud'].includes(engine)) throw new Error('Speech engine must be local or cloud.');
      const meta = engine === 'cloud' ? cloud.PROVIDERS[opts.provider || 'groq'] : null;
      if (engine === 'cloud' && !meta) throw new Error('Unknown cloud transcription provider.');
      const normalized = { ...opts, engine, source: opts.source || 'all', language: opts.language || 'auto',
        provider: engine === 'cloud' ? opts.provider || 'groq' : undefined,
        model: opts.model || (meta ? meta.defaultModel : 'base'), maxLen: opts.maxLen ?? 42 };
      if (engine === 'local' && !Object.hasOwn(whisper.MODELS, normalized.model)) throw new Error('Unknown local speech model.');
      onProgress('Preparing', 0);
      const result = await cache.get(project, normalized, async () => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'clipcraft-transcript-'));
        try {
          let key;
          if (engine === 'cloud') {
            key = getKey(meta.service);
            if (!key) throw new Error(`No ${meta.name} API key saved. Add it in the Captions panel first.`);
          } else {
            await whisper.install(whisperDir, (what, fraction) => onProgress(`Downloading ${what}`, fraction), normalized.model, signal);
          }
          stop(signal); onProgress('Extracting audio', 0);
          const wav = await renderAudio(project, path.join(tmp, 'audio.wav'), { source: normalized.source, clip_ids: normalized.clip_ids, signal });
          stop(signal); onProgress('Transcribing', 0);
          if (engine === 'cloud') return await cloud.transcribePrepared({ provider: normalized.provider, key, model: normalized.model,
            language: normalized.language, wavPath: wav, dir: tmp, ffmpegPath, probe, fetchImpl, signal,
            onProgress: fraction => onProgress('Transcribing', fraction) });
          const run = () => whisper.transcribe(whisperDir, wav, { ...normalized, signal }, fraction => onProgress('Transcribing', fraction));
          try { return await run(); }
          catch (error) {
            if (error.code !== 'MODEL_DAMAGED') throw error;
            stop(signal);
            await whisper.install(whisperDir, (what, fraction) => onProgress(`Downloading ${what}`, fraction), normalized.model, signal);
            return await run();
          }
        } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
      }, signal);
      stop(signal); onProgress(result.cached ? 'Cached transcript' : 'Transcribed', 1);
      return result;
    },
  };
}
module.exports = { createTranscriptService };
