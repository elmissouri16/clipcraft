// A user's own .cube (path reference) is not cached for the whole session: a read error is never kept
// (a LUT on a drive mounted later loads, and stops blocking the export), and a file re-exported at the
// same path is read again when the user picks it again or before an export (the main process reports
// its size and time). src/features/effects/lut.js. Usage: node tests/unit/effects/test-lut-reload.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clipcraft-lut-reload-'));
const stamp = (file) => { try { const st = fs.statSync(file); return `${st.size}:${st.mtimeMs}`; } catch { return null; } };
let reads = 0;
// The main process handlers (electron/main.cjs lut:read / lut:stamp), on real files.
globalThis.window = { api: {
  readLut: async (ref) => { reads++; if (!fs.existsSync(ref.path)) return { error: `LUT file not found: ${path.basename(ref.path)}` }; return { text: fs.readFileSync(ref.path, 'utf8'), stamp: stamp(ref.path) }; },
  lutStamp: async (ref) => stamp(ref.path),
} };
const { loadLut, getLut, loadProjectLuts } = await import('../../../src/features/effects/lut.js');
const cube = (r, extra = '') => { let s = `TITLE "look${extra}"\nLUT_3D_SIZE 2\n`; for (let b = 0; b < 2; b++) for (let g = 0; g < 2; g++) for (let x = 0; x < 2; x++) s += `${r} ${g} ${b}\n`; return s; };
const project = (file) => ({ videoClips: [{ id: 'c1', grade: { lut: { ref: { path: file }, intensity: 100 } } }], overlayClips: [], effectClips: [] });
try {
  // Re-exported at the same path: picking it again, or exporting, reads the new file.
  const file = path.join(dir, 'look.cube');
  fs.writeFileSync(file, cube(0));
  assert.equal((await loadLut({ path: file })).data[0], 0);
  assert.equal((await loadLut({ path: file })).data[0], 0);assert.equal(reads, 1, 'an unchanged LUT is read once');
  await loadProjectLuts(project(file), { strict: true });assert.equal(reads, 1, 'the export check does not re-read an unchanged file');
  fs.writeFileSync(file, cube(1, ' v2'));
  await loadProjectLuts(project(file), { strict: true });
  assert.equal(getLut({ path: file }).data[0], 255, 'the export reads the re-exported file');
  fs.writeFileSync(file, cube(0, ' v3 longer'));
  assert.equal((await loadLut({ path: file }, { reread: true })).data[0], 0, 'picking it again reads the file again');
  assert.equal(getLut({ path: file }).data[0], 0);

  // Missing when the project opened, mounted later: the error is not kept.
  const missing = path.join(dir, 'drive', 'grade.cube');
  assert.match((await loadLut({ path: missing })).error, /not found/);
  await assert.rejects(loadProjectLuts(project(missing), { strict: true }), /LUTs need attention/);
  fs.mkdirSync(path.dirname(missing));fs.writeFileSync(missing, cube(1));
  assert.equal((await loadLut({ path: missing })).data[0], 255, 'the LUT loads once its file is there');
  await loadProjectLuts(project(missing), { strict: true });

  // Bundled LUTs keep their once-per-session cache.
  let bundledReads = 0;
  window.api.readLut = async () => { bundledReads++;return { text: cube(1) }; };
  await loadLut({ bundled: 'x.cube' });await loadLut({ bundled: 'x.cube' }, { reread: true });await loadLut({ bundled: 'x.cube' }, { check: true });
  assert.equal(bundledReads, 1);
  console.log('LUT reload ok: path LUT errors are not kept; a changed file is read again on pick and before export');
} finally { fs.rmSync(dir, { recursive: true, force: true }); }
