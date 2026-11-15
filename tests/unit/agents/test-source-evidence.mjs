// Capability reuse, language separation, honest coverage and bounded transcript
// access. No UI, model, network or speech engine is needed for these regressions.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import source from '../../../electron/media/sourceIndex.cjs';
import evidence from '../../../electron/media/sourceEvidence.cjs';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clipcraft-source-evidence-')), checks = [];
function fixture(name, { hasAudio = true, empty = false, fail = false } = {}) {
  const file = path.join(root, `${name}.mp4`);fs.writeFileSync(file, 'source fixture');
  const media = { id: name, path: file, type: 'video', duration: 25 };
  const calls = { scan: [], speech: [] };
  const services = {
    probe: async () => ({ type: 'video', duration: 25, hasAudio }),
    scan: async (_file, start, end) => {
      calls.scan.push([start, end]);const bins = [];
      for (let t = Math.ceil(start * 2) / 2; t < end; t += .5) bins.push({ time_sec: t, change: .2, light: .5, ...(hasAudio ? { rms_db: -20 } : {}) });
      return { bins, cuts: [] };
    },
    transcribe: async (_media, start, end, language) => {
      calls.speech.push([start, end, language]);if (fail) throw Error('Recognizer unavailable.');if (empty) return [];
      const at = Math.ceil(start / 10) * 10 - start + .1;
      return [{ start: at, end: at + .8, text: `${language} source dialogue`, words: [{ start: at, end: at + .8, text: `${language} source dialogue` }] }];
    },
  };
  return { media, calls, services, service: new source.SourceIndex(path.join(root, name), services) };
}
try {
  const f = fixture('reuse');
  const original = await f.service.index(f.media, { chunk_sec: 10, language: 'en' });
  assert.equal(original.transcript.status, 'complete');assert.equal(f.calls.scan.length, 3);assert.equal(f.calls.speech.length, 3);
  const visualView = await f.service.index(f.media, { chunk_sec: 20, speech: false });
  assert.equal(visualView.complete, true);assert.equal(visualView.processed_chunks, 0);assert.equal(visualView.transcript.status, 'complete');assert.equal(visualView.transcript.language, 'en');
  assert.equal(f.calls.scan.length, 3);assert.equal(f.calls.speech.length, 3);
  const speech = f.service.transcript(f.media, visualView.index_id, { limit: 1 });
  assert.equal(speech.segments.length, 1);assert.equal(speech.next_offset, 1);assert.ok(speech.segments[0].text.includes('en source'));
  assert.equal(f.service.transcript(f.media, visualView.index_id, { query: 'missing phrase' }).total_segments, 0);
  const inventory = f.service.describe(f.media);assert.equal(inventory.analyses.length, 2);assert.ok(inventory.recommended_index_id);
  const firstView = f.service.describe(f.media, { limit: 1 });assert.equal(firstView.analyses.length, 1);assert.equal(firstView.next_offset, 1);
  assert.equal(f.service.describe(f.media, { offset: 1, limit: 1 }).recommended_index_id, firstView.recommended_index_id);
  checks.push('visual-only, auto-language and different chunk views reuse existing speech and scans without new processing');

  await f.service.index(f.media, { chunk_sec: 20, language: 'fr' });
  assert.equal(f.calls.scan.length, 3);assert.equal(f.calls.speech.length, 5);
  const fr = f.service.describe(f.media).analyses.find(a => a.options.language === 'fr');
  assert.equal(fr.transcript.language, 'fr');assert.ok(f.service.transcript(f.media, fr.index_id).segments.every(s => s.text.startsWith('fr')));
  checks.push('explicit transcript languages stay separate while sharing compatible visual evidence');

  const upgrade = fixture('upgrade');
  const before = await upgrade.service.index(upgrade.media, { chunk_sec: 10, speech: false });
  assert.equal(before.visual_complete, true);assert.equal(before.transcript.status, 'missing');assert.ok(before.warnings.some(w => w.code === 'transcript_incomplete'));
  const after = await upgrade.service.index(upgrade.media, { chunk_sec: 10 });
  assert.equal(upgrade.calls.scan.length, 3);assert.equal(upgrade.calls.speech.length, 3);assert.equal(after.complete, true);
  assert.equal(upgrade.service.transcript(upgrade.media, before.index_id).transcript.status, 'complete');
  await upgrade.service.index(upgrade.media, { chunk_sec: 10, speech: false });assert.equal(upgrade.calls.speech.length, 3);
  checks.push('missing, complete and visual coverage remain distinct; speech upgrades enrich older views without downgrade');

  const partial = fixture('partial');await partial.service.index(partial.media, { chunk_sec: 10, max_chunks: 1 });
  await partial.service.index(partial.media, { chunk_sec: 20, max_chunks: 1 });
  assert.deepEqual(partial.calls.scan, [[0, 10], [9.5, 20]]);
  assert.equal(partial.calls.speech.length, 2);assert.equal(partial.calls.speech[1][0], 8);
  const partialStatus = partial.service.describe(partial.media).analyses[0];assert.equal(partialStatus.transcript.processed_sec, 20);
  checks.push('partial reuse fills only missing source and speech intervals across changed chunk sizes');

  const broken = fixture('broken', { fail: true });
  await assert.rejects(broken.service.index(broken.media, { chunk_sec: 10, max_chunks: 1 }), /Recognizer unavailable/);
  const interrupted = broken.service.describe(broken.media).analyses[0];assert.equal(interrupted.indexed_sec, 10);assert.equal(interrupted.transcript.processed_sec, 0);assert.equal(interrupted.complete, false);
  broken.service.transcribe = async () => [{ start: .1, end: .8, text: 'Recovered source dialogue.' }];
  await broken.service.index(broken.media, { chunk_sec: 10, max_chunks: 1 });assert.equal(broken.calls.scan.length, 1);
  checks.push('recognition failure retains scan work, does not claim speech coverage and retries without rescanning');

  const ownChunk = path.join(upgrade.service.folder(after.index_id), '0.chunk.json'), chunk = JSON.parse(fs.readFileSync(ownChunk, 'utf8'));
  chunk.bins = [];fs.writeFileSync(ownChunk, JSON.stringify(chunk));
  assert.equal(upgrade.service.transcript(upgrade.media, after.index_id).transcript.status, 'complete');
  // The visual-only view still has a compatible scan, so both capabilities recover independently.
  await upgrade.service.index(upgrade.media, { chunk_sec: 10 });assert.equal(upgrade.calls.speech.length, 3);
  checks.push('scan corruption does not erase valid speech evidence or force repeated recognition');

  const malformed = fixture('malformed'), initialMalformed = await malformed.service.index(malformed.media, { chunk_sec: 10, max_chunks: 1 });
  const malformedFile = path.join(malformed.service.folder(initialMalformed.index_id), '0.chunk.json'), damaged = JSON.parse(fs.readFileSync(malformedFile, 'utf8'));
  damaged.bins = [null];damaged.segments = [{ start: .1, end: .9, text: 'Bad record', words: [null] }];fs.writeFileSync(malformedFile, JSON.stringify(damaged));
  const invalid = malformed.service.describe(malformed.media).analyses[0];assert.equal(invalid.indexed_sec, 0);assert.equal(invalid.transcript.processed_sec, 0);
  await malformed.service.index(malformed.media, { chunk_sec: 10, max_chunks: 1 });assert.equal(malformed.calls.scan.length, 2);
  checks.push('malformed cached measurements and word timings are rejected and repaired without crashing discovery');

  const silent = fixture('silent', { empty: true }), silence = await silent.service.index(silent.media, { chunk_sec: 10 });
  assert.equal(silence.transcript.status, 'complete');assert.equal(silence.transcript.has_text, false);assert.ok(silence.warnings.some(w => w.code === 'no_recognized_text'));
  const noAudio = fixture('no-audio', { hasAudio: false }), noSpeech = await noAudio.service.index(noAudio.media, { chunk_sec: 10 });
  assert.equal(noSpeech.transcript.status, 'no_audio');assert.equal(noAudio.calls.speech.length, 0);
  checks.push('processed empty recognition, unprocessed speech and a source with no audio have distinct states');

  const unknown = fixture('unknown-audio', { empty: true }), originalScan = unknown.service.scan;
  unknown.service.scan = async (...args) => { const result = await originalScan(...args);for (const bin of result.bins) delete bin.rms_db;return result; };
  const unknownStatus = await unknown.service.index(unknown.media, { chunk_sec: 10 });
  assert.equal(unknown.calls.speech.length, 3);assert.equal(unknownStatus.transcript.status, 'complete');
  const legacyFile = path.join(unknown.service.folder(unknownStatus.index_id), '0.chunk.json'), legacyChunk = JSON.parse(fs.readFileSync(legacyFile, 'utf8'));
  delete legacyChunk.transcript_state;fs.writeFileSync(legacyFile, JSON.stringify(legacyChunk));
  assert.equal(unknown.service.transcript(unknown.media, unknownStatus.index_id).transcript.status, 'partial');
  checks.push('missing audio measurements still require recognition; unknown legacy empty chunks are not migrated as silence');

  const scoped = evidence.sliceTranscript([{ start: 0, end: 4, text: 'outside inside outside', words: [{ start: 0, end: 1, text: 'outside' }, { start: 1, end: 2, text: 'inside' }, { start: 3, end: 4, text: 'outside' }] }], 1, 3);
  assert.equal(scoped.segments[0].text, 'inside');assert.equal(scoped.segments[0].start, 1);assert.equal(scoped.segments[0].end, 2);
  assert.equal(evidence.sliceTranscript([{ start: 0, end: 4, text: 'untimed crossing sentence' }], 1, 3).omitted_boundary_segments, 1);
  assert.deepEqual(evidence.mergeRanges([{ start_sec: 5, end_sec: 8 }, { start_sec: 0, end_sec: 10 }, { start_sec: 2, end_sec: 3 }]), [{ start_sec: 0, end_sec: 10 }]);
  checks.push('scope boundaries do not leak outside dialogue and overlapping evidence cannot shrink coverage');

  const joined = evidence.selectTranscript([
    { manifest: { options: { speech: true, language: 'en' }, duration_sec: 20 }, chunk: { start_sec: 0, end_sec: 10, segments: [{ start: 8, end: 9, text: 'prior', words: [{ start: 8, end: 9, text: 'prior' }] }] } },
    { manifest: { options: { speech: true, language: 'en' }, duration_sec: 20 }, chunk: { start_sec: 5, end_sec: 20, segments: [{ start: 8, end: 12, text: 'prior new', words: [{ start: 8, end: 9, text: 'prior' }, { start: 11, end: 12, text: 'new' }] }] } },
  ], 'en');
  assert.equal(joined.segments.map(s => s.text).join(' '), 'prior new');
  checks.push('overlapping transcript artifacts reuse uncovered words without duplicating already-covered dialogue');

  const stat = fs.statSync(f.media.path);fs.utimesSync(f.media.path, stat.atime, new Date(stat.mtimeMs + 2000));
  assert.equal(f.service.describe(f.media).analyses.length, 0);assert.throws(() => f.service.transcript(f.media, original.index_id), /stale/);
  checks.push('source replacement invalidates discovery and transcript access across all cached views');
  const result = { ok: true, checks };if (process.env.SOURCE_EVIDENCE_RESULT) fs.writeFileSync(process.env.SOURCE_EVIDENCE_RESULT, JSON.stringify(result, null, 2));console.log(JSON.stringify(result, null, 2));
} finally { fs.rmSync(root, { recursive: true, force: true }); }
