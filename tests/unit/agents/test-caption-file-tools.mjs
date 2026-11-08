import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { emptyProject, normalizeProject, historyReducer, videoLayout } from '../../../src/state/store.js';
import { createToolRunner } from '../../../src/features/agent/tools.js';
import { subtitleTimestamp } from '../../../src/features/agent/captionTools.js';
const require = createRequire(import.meta.url), { runEditorFileJob } = require('../../../electron/agents/editorFiles.cjs');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clipcraft-caption-tools-'));
const localMedia = path.join(dir, 'clip1.mp4');fs.writeFileSync(localMedia, 'fixture');
let state, mediaId = 0, active = true;
const reset = () => { active = true;state = { past: [], future: [], present: normalizeProject({ ...emptyProject(), id: 'caption-file-tools',
  media: [{ id: 'vsrc', type: 'video', path: '/existing.mp4', name: 'Original', duration: 6, width: 640, height: 360 }],
  videoClips: [{ id: 'v', mediaId: 'vsrc', in: 0, out: 6 }], magnet: { text: true },
  textClips: [{ id: 'c1', caption: true, text: 'Hello there', start: 1, duration: 1, word_timing: 'measured', words: [
    { text: 'Hello', start: 0, end: .4, timing: 'measured' }, { text: 'there', start: .5, end: 1, timing: 'measured' }] },
    { id: 'c2', caption: true, text: 'Next sentence', start: 2.2, duration: 1 },
    { id: 'title', text: 'Keep this title', start: 4, duration: 1 }],
}) }; };
reset();
const options = { outputDir: dir, signal: new AbortController().signal,
  probeAll: async files => files.map(file => ({ path: file, name: path.basename(file), type: 'video', duration: 3, width: 640, height: 360 })),
};
const runner = createToolRunner({ requestId: 'caption-files', getProject: () => state.present, settle: async () => {}, editActive: () => active,
  dispatch: action => { state = historyReducer(state, action); },
  addProbed: item => { const m = { ...item, id: 'imported-' + mediaId++ };state = historyReducer(state, { type: 'addMedia', items: [m] });return m; },
  api: { agentFileJob: async req => { assert.equal(req.requestId, 'caption-files');return runEditorFileJob(req, options); } },
});
const run = async (name, args) => { const r = await runner.run(name, args);assert.ok(!r.error, `${name}: ${r.error}`);return r; };
const blocked = async (name, args, pattern) => { const before = JSON.stringify(state.present);const r = await runner.run(name, args);assert.match(r.error || '', pattern);assert.equal(JSON.stringify(state.present), before); };

assert.equal(subtitleTimestamp(59.9999), '00:01:00,000');
assert.equal(runner.mutates('export_subtitles'), false);assert.equal(runner.requiresSuccess('export_subtitles'), true);
await run('edit_caption_words', { clip_id: 'c1', words: [{ text: 'Hello', start_sec: 1.1, end_sec: 1.5 }, { text: 'there', start_sec: 1.55, end_sec: 1.95 }] });
let c = state.present.textClips.find(c => c.id === 'c1');
assert.equal(c.start, 1);assert.equal(c.duration, 1);assert.equal(c.word_timing, 'edited');
assert.ok(Math.abs(c.words[0].start - .1) < 1e-8);
await blocked('edit_caption_words', { clip_id: 'c1', words: [{ text: 'outside', start_sec: 0, end_sec: 1 }] }, /inside/);
await blocked('caption_tools', { action: 'split', clip_id: 'c1', time_sec: 1.3 }, /timed word/);
const split = await run('caption_tools', { action: 'split', clip_id: 'c1', time_sec: 1.5 });
assert.deepEqual(split.clip_ids.map(id => state.present.textClips.find(c => c.id === id).text), ['Hello', 'there']);
await run('caption_tools', { action: 'merge', clip_ids: split.clip_ids });
c = state.present.textClips.find(c => c.id === 'c1');assert.equal(c.text, 'Hello there');assert.equal(c.duration, 1);
assert.ok(Math.abs(c.words[1].start - .55) < 1e-8);
assert.equal(state.present.textClips.find(c => c.id === 'title').start, 4, 'caption merge ignores the Text ripple magnet');
await blocked('caption_tools', { action: 'split', clip_id: 'c2', time_sec: 2.7 }, /word_index/);
const untimed = await run('caption_tools', { action: 'split', clip_id: 'c2', time_sec: 2.7, word_index: 1 });
assert.deepEqual(untimed.clip_ids.map(id => state.present.textClips.find(c => c.id === id).text), ['Next', 'sentence']);

reset();
const text = '1\n00:00:00,500 --> 00:00:01,500\nمرحبا\n\n2\n00:00:02,500 --> 00:00:03,000\nSecond cue\n';
const srt = path.join(dir, 'input.srt');fs.writeFileSync(srt, text);
let imported = await run('caption_tools', { action: 'import_srt', file_path: srt });
assert.equal(imported.imported_cues, 2);
assert.equal(state.present.textClips.find(c => c.source === 'srt').layer, 1, 'overlapping cues use a free layer');
assert.ok(state.present.textClips.some(c => c.id === 'title'));
const destination = path.join(dir, 'output.srt');
const output = await run('export_subtitles', { source: 'srt', file_path: destination });
assert.equal(output.cues, 2);assert.equal(output.artifact.type, 'subtitles');
assert.equal(fs.readFileSync(destination, 'utf8'), text, 'actual SRT file preserves cue timing and Unicode text');
await blocked('export_subtitles', { source: 'srt', file_path: destination }, /already exists/);
await blocked('caption_tools', { action: 'import_srt', srt_text: text + '\ninvalid block' }, /Invalid subtitle blocks/);
await blocked('caption_tools', { action: 'import_srt', srt_text: '1\n00:00:08,000 --> 00:00:09,000\nToo late' }, /beyond/);
await run('caption_tools', { action: 'import_srt', srt_text: text, replace_source: 'all' });
assert.equal(state.present.textClips.filter(c => c.caption).length, 2);
assert.equal(state.present.textClips.find(c => c.id === 'title').start, 4);
await run('layer_tools', { track: 'text', action: 'update', layer: 0, locked: true });
await blocked('caption_tools', { action: 'import_srt', srt_text: text, replace_source: 'all' }, /locked/);

reset();
const listed = await run('list_local_media', { paths: [dir] });
assert.equal(listed.entries.length, 1);assert.equal(listed.entries[0].name, 'clip1.mp4');
imported = await run('import_media', { paths: [localMedia] });assert.equal(imported.media.length, 1);
assert.equal(state.present.videoClips.length, 1, 'library import does not insert an unwanted clip');
await run('import_media', { paths: [localMedia], as: 'main' });
assert.equal(state.present.videoClips.length, 2);assert.equal(state.present.media.length, 2, 'repeat import reuses existing media IDs');
assert.equal(videoLayout(state.present.videoClips).at(-1).end, 9);
await blocked('import_media', { paths: [localMedia], as: 'audio' }, /choose audio files/);
active = false;await blocked('import_media', { paths: [localMedia], as: 'main' }, /outside|no longer/);
console.log('Word timing, caption split/merge, real subtitle I/O and local import tools passed; evidence: ' + dir);
