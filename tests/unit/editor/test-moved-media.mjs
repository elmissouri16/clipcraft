// Recovering a project whose media moved: found next to the project file on open, flagged offline when
// still missing (not "optimizing"), re-pointed by Locate in one Undo step with ids and clips kept, other
// offline items under the same old folder following, and the export refusing up front by file name.
// Usage: node tests/unit/editor/test-moved-media.mjs
import assert from 'assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';
import { emptyProject, historyReducer } from '../../../src/state/store.js';

const require = createRequire(import.meta.url);
const pf = require('../../../electron/project/projectfile.cjs');
const { missingExportMedia } = require('../../../electron/export/exportTarget.cjs');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clipcraft-moved-'));
const write = (file, bytes = 'x') => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, bytes); return file; };
try {
  // --- A project folder moved: media next to the project, and in a sub-folder of it, is found again.
  const oldDir = path.join(root, 'ProjectA'), newDir = path.join(root, 'Moved', 'ProjectA');
  const project = {
    media: [
      { id: 'm1', type: 'video', name: 'clip.mp4', path: path.join(oldDir, 'clip.mp4'), duration: 5 },
      { id: 'm2', type: 'audio', name: 'song.mp3', path: path.join(oldDir, 'Music', 'song.mp3'), duration: 9 },
      { id: 'm3', type: 'video', name: 'interview.mp4', path: 'E:\\Footage\\Day 1\\interview.mp4', duration: 9, size: 4 },
      { id: 'm4', type: 'video', name: 'take.mp4', path: path.join(oldDir, 'cam', 'take.mp4'), duration: 3 },
      { id: 'm5', type: 'image', name: 'gone.png', path: path.join(oldDir, 'gone.png') },
      { id: 'm6', type: 'video', name: 'sized.mp4', path: 'D:\\x\\sized.mp4', size: 999 },
    ],
    videoClips: [{ id: 'c1', mediaId: 'm1', in: 0, out: 5 }, { id: 'c3', mediaId: 'm3', in: 0, out: 9 }, { id: 'c5', mediaId: 'm5', in: 0, out: 2 }],
    audioClips: [{ id: 'a2', mediaId: 'm2', in: 0, out: 9 }], overlayClips: [],
  };
  write(path.join(newDir, 'clip.mp4'));
  write(path.join(newDir, 'Music', 'song.mp3'));
  write(path.join(newDir, 'Footage', 'Day 1', 'interview.mp4'), 'abcd'); // a Windows E:\ path opened here, size matches
  write(path.join(newDir, 'take.mp4')); write(path.join(newDir, 'cam', 'take.mp4')); // ambiguous: two candidates
  write(path.join(newDir, 'sized.mp4'), 'abc'); // recorded size 999 does not match
  const file = write(path.join(newDir, 'p.clipcraft.json'), JSON.stringify(project));
  const opened = JSON.parse(pf.checkGenerated(pf.relocateMedia(fs.readFileSync(file, 'utf8'), file), path.join(root, 'cache')));
  const byId = Object.fromEntries(opened.media.map((m) => [m.id, m]));
  assert.equal(byId.m1.path, path.join(newDir, 'clip.mp4'), 'a file next to the moved project is found');
  assert.equal(byId.m2.path, path.join(newDir, 'Music', 'song.mp3'), 'a file in a sub-folder is found by its trailing components');
  assert.equal(byId.m3.path, path.join(newDir, 'Footage', 'Day 1', 'interview.mp4'), 'a Windows-style path is split on backslashes');
  assert.equal(byId.m4.path, project.media[3].path, 'an ambiguous name is not auto-matched');
  assert.equal(byId.m6.path, project.media[5].path, 'a candidate whose size differs from the recorded size is not used');
  for (const id of ['m1', 'm2', 'm3']) assert.ok(!byId[id].missing, `${id} is not offline`);
  for (const id of ['m4', 'm5', 'm6']) { assert.equal(byId[id].missing, true, `${id} is flagged offline`); assert.ok(!byId[id].optimizing, `${id} is not "optimizing"`); }
  assert.equal(pf.relocateMedia('{"media":[]', file), '{"media":[]', 'unreadable text is returned unchanged');

  // --- Locate: the mapping for other offline items under the same old folder (both separators).
  assert.equal(pf.relocatedPath('/old/Proj/a.mp4', '/new/P/a.mp4', '/old/Proj/sub/b.mp4'), path.join('/new/P', 'sub', 'b.mp4'));
  assert.equal(pf.relocatedPath('E:\\Proj\\a.mp4', '/new/P/a.mp4', 'e:\\proj\\b.mp4'), path.join('/new/P', 'b.mp4'), 'Windows paths compare without case');
  assert.equal(pf.relocatedPath('/old/Proj/a.mp4', '/new/P/a.mp4', '/elsewhere/b.mp4'), null, 'an item outside the old folder is not moved');

  // --- Reducer: relinkMedia re-points paths, keeps ids and clips, is one Undo step.
  let st = { past: [], present: { ...emptyProject(), media: opened.media, videoClips: [{ id: 'c4', mediaId: 'm4', in: 0, out: 3, start: 0 }] }, future: [] };
  const before = st.present;
  st = historyReducer(st, { type: 'relinkMedia', changes: [{ id: 'm4', path: path.join(newDir, 'cam', 'take.mp4') }, { id: 'm5', path: path.join(newDir, 'gone.png') }] });
  const m4 = st.present.media.find((m) => m.id === 'm4'), m5 = st.present.media.find((m) => m.id === 'm5');
  assert.equal(m4.path, path.join(newDir, 'cam', 'take.mp4'));
  assert.ok(!m4.missing && !m5.missing, 'located items are no longer offline');
  assert.equal(m4.optimizing, true, 'a located video has its copies made again');
  assert.equal(st.present.media.length, before.media.length, 'no media item added or removed');
  assert.equal(st.present.videoClips[0].mediaId, 'm4', 'the clip still uses the same media id');
  assert.equal(st.past.length, 1, 'one Undo step');
  const undone = historyReducer(st, { type: 'undo' });
  assert.equal(undone.present.media.find((m) => m.id === 'm4').path, project.media[3].path, 'Undo restores the old path');
  assert.equal(historyReducer(st, { type: 'relinkMedia', changes: [] }).present, st.present, 'an empty relink changes nothing');

  // --- Export preflight names the missing files the timeline uses.
  assert.deepEqual(missingExportMedia(project), ['clip.mp4', 'interview.mp4', 'gone.png', 'song.mp3'], 'every used missing file is named once');
  assert.deepEqual(missingExportMedia(opened), ['gone.png'], 'after relocation only the still-missing used file is named');
  assert.deepEqual(missingExportMedia({ media: [], videoClips: [{ id: 'g', gap: true }] }), []);
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
console.log('moved media OK: found next to the project, offline flag, Locate relink + Undo, export preflight');
