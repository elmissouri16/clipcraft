// Recording failures are reported, never swallowed. A screen-recording chunk that cannot be written (full disk)
// stops the writing but not the chain: finish still runs, so the part already on disk is converted and added,
// and the error comes back with it. The voice-over saver reports a rejected save; the main process keeps or
// removes the recording it could not convert. Usage: node tests/unit/recording/test-recording-failures.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

class FakeRecorder {
  static isTypeSupported() { return true; }
  constructor() { this.state = 'inactive'; }
  start() { this.state = 'recording'; }
  stop() { this.state = 'inactive'; setTimeout(() => this.onstop?.(), 0); }
  emit(bytes) { this.ondataavailable?.({ data: { size: bytes.length, arrayBuffer: async () => bytes.buffer } }); }
}
globalThis.MediaRecorder = FakeRecorder;
globalThis.window = globalThis;
const written = [], calls = [];
let failAt = 2;
globalThis.api = {
  screenBegin: async () => 'rec1',
  screenChunk: async (id, bytes) => { calls.push('chunk'); if (written.length === failAt) throw new Error('ENOSPC: no space left on device, write'); written.push(bytes[0]); },
  screenFinish: async (id) => { calls.push(`finish ${id}`); return { path: '/Videos/ClipCraft/Screen recording.mp4', duration: 2 }; },
  screenDiscard: async () => {},
};
const { fileRecorder } = await import('../../../src/features/recording/useScreenRecorder.js');
const recorder = fileRecorder({}, 'screen', 8e6);
recorder.start();
for (let i = 0; i < 5; i++) recorder.mr.emit(new Uint8Array([i]));
const item = await recorder.finish();
assert.deepEqual(written, [0, 1], 'the chunks before the failure are on disk');
assert.equal(calls.filter((c) => c === 'chunk').length, 3, 'nothing is written after the failed chunk (the file stays a clean prefix)');
assert.ok(calls.includes('finish rec1'), 'finish still runs, so the partial recording is converted');
assert.equal(item.path, '/Videos/ClipCraft/Screen recording.mp4');
assert.match(item.writeError, /ENOSPC/, 'the write error comes back with the kept recording');

// A recording without write errors is returned as it is.
written.length = 0; calls.length = 0; failAt = Infinity;
const clean = fileRecorder({}, 'camera', 8e6);
clean.start(); clean.mr.emit(new Uint8Array([7])); clean.mr.emit(new Uint8Array([8]));
assert.deepEqual(await clean.finish(), { path: '/Videos/ClipCraft/Screen recording.mp4', duration: 2 });
assert.deepEqual(written, [7, 8]);

// The hook shows the partial-save message; the voice-over saver catches a rejected save; the main process never
// leaves a failed voice-over conversion unanswered (source checks: these need the app to run).
const screenHook = readFileSync(new URL('../../../src/features/recording/useScreenRecorder.js', import.meta.url), 'utf8');
assert.match(screenHook, /record\.part_of_recording_not_saved/);
const voice = readFileSync(new URL('../../../src/features/recording/useRecorder.js', import.meta.url), 'utf8');
assert.match(voice, /try \{\s*const buf = await new Blob\(chunks\)\.arrayBuffer\(\);[\s\S]*\} catch \(e\) \{\s*setError\(t\('record\.could_not_save_voiceover'/);
const main = readFileSync(new URL('../../../electron/main.cjs', import.meta.url), 'utf8');
assert.match(main, /await toM4a\(webm, m4a\);\s*\} catch \(e\) \{[\s\S]*main\.recording_was_empty[\s\S]*main\.original_was_kept/);
for (const lang of ['en', 'fr', 'es']) {
  const dict = JSON.parse(readFileSync(new URL(`../../../shared/i18n/${lang}.json`, import.meta.url), 'utf8'));
  for (const key of ['record.part_of_recording_not_saved', 'record.could_not_save_voiceover', 'main.recording_was_empty']) assert.ok(dict[key], `${lang} ${key}`);
}
console.log('recording failures: partial screen recordings are finished and reported; voice-over save errors are shown');
