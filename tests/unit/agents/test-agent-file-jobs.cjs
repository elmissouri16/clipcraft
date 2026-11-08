const assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { runEditorFileJob, collectMedia } = require('../../../electron/agents/editorFiles.cjs');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clipcraft-agent-files-')), media = path.join(dir, 'media');
fs.mkdirSync(path.join(media, 'nested'), { recursive: true });
for (const file of ['clip10.mp4', 'clip2.mp4', 'ignore.txt', 'nested/speech.wav']) fs.writeFileSync(path.join(media, file), file);
fs.symlinkSync(media, path.join(media, 'nested', 'loop'));
const options = { signal: new AbortController().signal, outputDir: path.join(dir, 'downloads'),
  probeAll: async files => files.map(file => ({ path: file, name: path.basename(file), type: file.endsWith('.wav') ? 'audio' : 'video', duration: 4 })),
};
(async () => {
  let found = await collectMedia([media], false, options.signal);
  assert.deepEqual(found.entries.map(e => e.name), ['clip2.mp4', 'clip10.mp4']);
  found = await collectMedia([media], true, options.signal);
  assert.equal(found.entries.length, 3, 'recursive scans skip symbolic-link cycles and unsupported documents');
  assert.equal((await collectMedia([path.join(media, 'clip2.mp4'), path.join(media, 'clip2.mp4')], false, options.signal)).entries.length, 1);
  const page = await runEditorFileJob({ action: 'list', paths: [media], recursive: true, offset: 1, limit: 1 }, options);
  assert.equal(page.entries[0].name, 'clip10.mp4');assert.equal(page.next_offset, 2);assert.equal(page.total, 3);
  const imported = await runEditorFileJob({ action: 'import', paths: [media], recursive: true }, options);
  assert.equal(imported.items.length, 3);assert.equal(imported.failures.length, 0);
  assert.equal((await runEditorFileJob({ action: 'import' }, { ...options, choosePaths: async () => [] })).canceled, true);
  await assert.rejects(runEditorFileJob({ action: 'list', paths: [media], limit: 1000 }, options), /limit/);
  await assert.rejects(collectMedia(['relative/file.mp4'], false, options.signal), /absolute/);
  const controller = new AbortController();controller.abort();
  await assert.rejects(runEditorFileJob({ action: 'list', paths: [media] }, { ...options, signal: controller.signal }), /stopped/);
  const stopping = new AbortController();
  await assert.rejects(runEditorFileJob({ action: 'import', paths: [media] }, { ...options, signal: stopping.signal,
    probeAll: async files => { stopping.abort();return [{ path: files[0], type: 'video' }]; },
  }), /stopped/);
  const text = '1\n00:00:01,000 --> 00:00:02,000\nمرحبا بالعالم\n';
  const subtitle = await runEditorFileJob({ action: 'write_subtitles', name: 'Arabic test', text }, options);
  assert.equal(fs.readFileSync(subtitle.path, 'utf8'), text);assert.equal(subtitle.bytes, Buffer.byteLength(text));
  assert.equal((await runEditorFileJob({ action: 'read_subtitles', path: subtitle.path }, options)).text, text);
  await assert.rejects(runEditorFileJob({ action: 'write_subtitles', path: subtitle.path, text: 'replacement' }, options), /already exists/);
  assert.equal(fs.readFileSync(subtitle.path, 'utf8'), text);
  await runEditorFileJob({ action: 'write_subtitles', path: subtitle.path, text: 'replacement', overwrite: true }, options);
  assert.equal(fs.readFileSync(subtitle.path, 'utf8'), 'replacement');
  const second = await runEditorFileJob({ action: 'write_subtitles', name: 'Arabic test', text }, options);
  assert.notEqual(second.path, subtitle.path);
  await assert.rejects(runEditorFileJob({ action: 'read_subtitles', path: path.join(media, 'ignore.txt') }, options), /\.srt/);
  const link = path.join(dir, 'pretend.srt');fs.symlinkSync(path.join(media, 'ignore.txt'), link);
  await assert.rejects(runEditorFileJob({ action: 'read_subtitles', path: link }, options), /resolve/);
  assert.ok(!fs.readdirSync(options.outputDir).some(name => name.endsWith('.part')));
  console.log('Local media paging/import, cancellation, subtitle I/O and overwrite guards passed; evidence: ' + dir);
})().catch(error => { console.error(error);process.exitCode = 1; });
