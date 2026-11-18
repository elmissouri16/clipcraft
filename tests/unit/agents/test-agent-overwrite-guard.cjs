// An assistant or outside agent never replaces an existing file on the model's word (overwrite: true)
// unless this app wrote that file for the same owner earlier in the session, unchanged since. The
// refusal asks for a new name and does not suggest overwrite. Covers video export targets
// (electron/agents/editorExport.cjs) and subtitle files (electron/agents/editorFiles.cjs); main.cjs
// supplies mayReplace / wrote from its per-session output records.
// Usage: node tests/unit/agents/test-agent-overwrite-guard.cjs
const assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { createEditorExportTarget } = require('../../../electron/agents/editorExport.cjs');
const { runEditorFileJob } = require('../../../electron/agents/editorFiles.cjs');

const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'clipcraft-overwrite-guard-')));
const frameDirs = [];
(async () => {
  try {
    // A session record like main.cjs keeps: file -> size+mtime written by this owner.
    const written = new Map();
    const stamp = file => { const s = fs.statSync(file); return `${s.size}:${s.mtimeMs}`; };
    const registry = owner => ({ mayReplace: file => written.get(file)?.owner === owner && written.get(file)?.stamp === stamp(file),
      wrote: file => written.set(file, { owner, stamp: stamp(file) }) });
    const footage = path.join(dir, 'interview-raw.mp4');fs.writeFileSync(footage, 'the user footage');
    const opts = { outputDir: dir, cacheDir: path.join(dir, 'reviews'), ...registry('window-1') };

    // Video exports: someone else's file is refused with or without overwrite, and the message asks for a new name.
    for (const overwrite of [true, false, undefined]) {
      assert.throws(() => createEditorExportTarget({ requestId: 'r1', file_path: footage, overwrite }, opts), (error) => {
        assert.match(error.message, /already exists/);assert.match(error.message, /new file name/);assert.doesNotMatch(error.message, /overwrite/i);return true;
      });
    }
    assert.equal(fs.readFileSync(footage, 'utf8'), 'the user footage');
    // A file this app wrote for this owner may be replaced when asked; it is still not replaced unasked.
    const own = path.join(dir, 'my-export.mp4');fs.writeFileSync(own, 'first render');written.set(own, { owner: 'window-1', stamp: stamp(own) });
    assert.throws(() => createEditorExportTarget({ requestId: 'r2', file_path: own }, opts), /explicitly request overwrite/);
    const again = createEditorExportTarget({ requestId: 'r2', file_path: own, overwrite: true }, opts);frameDirs.push(again.frameDir);
    assert.equal(again.file, own);assert.equal(again.noOverwrite, false);
    // Another owner, or the same file changed since it was written, is someone else's file again.
    assert.throws(() => createEditorExportTarget({ requestId: 'r3', file_path: own, overwrite: true }, { ...opts, ...registry('window-2') }), /new file name/);
    fs.writeFileSync(own, 'the user replaced it with something longer');
    assert.throws(() => createEditorExportTarget({ requestId: 'r2', file_path: own, overwrite: true }, opts), /new file name/);
    // Extension exports (no mayReplace) keep their own overwrite meaning.
    const ext = createEditorExportTarget({ requestId: 'x1', file_path: footage, overwrite: true }, { outputDir: dir, cacheDir: opts.cacheDir });frameDirs.push(ext.frameDir);
    assert.equal(ext.noOverwrite, false);

    // Subtitle files: the same rule.
    const files = { signal: new AbortController().signal, outputDir: path.join(dir, 'downloads'), probeAll: async () => [], ...registry('window-1') };
    const notes = path.join(dir, 'notes.srt');fs.writeFileSync(notes, 'the user subtitles');
    for (const overwrite of [true, false]) {
      await assert.rejects(runEditorFileJob({ action: 'write_subtitles', path: notes, text: '1\n00:00:00,000 --> 00:00:01,000\nhi\n', overwrite }, files), (error) => {
        assert.match(error.message, /new file name/);assert.doesNotMatch(error.message, /overwrite/i);return true;
      });
    }
    assert.equal(fs.readFileSync(notes, 'utf8'), 'the user subtitles');
    await assert.rejects(runEditorFileJob({ action: 'write_subtitles', path: notes, text: 'x', overwrite: true }, { ...files, mayReplace: undefined, wrote: undefined }), /new file name/, 'without a session record nothing is replaced');
    const mine = await runEditorFileJob({ action: 'write_subtitles', path: path.join(dir, 'mine.srt'), text: 'first' }, files);
    await runEditorFileJob({ action: 'write_subtitles', path: mine.path, text: 'second', overwrite: true }, files);
    assert.equal(fs.readFileSync(mine.path, 'utf8'), 'second', 'an own subtitle file is replaced when asked');
    await assert.rejects(runEditorFileJob({ action: 'write_subtitles', path: mine.path, text: 'third', overwrite: true }, { ...files, ...registry('window-2') }), /new file name/);
    assert.equal(fs.readFileSync(mine.path, 'utf8'), 'second');
    console.log('agent overwrite guard: only files this app wrote for the same owner (unchanged) are replaced; others ask for a new name');
  } finally {
    for (const d of frameDirs) fs.rmSync(d, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch((error) => { console.error(error);process.exitCode = 1; });
