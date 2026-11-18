// Export targets (electron/export/exportTarget.cjs): no export writes over the project's source media,
// and a user export replaces an existing file only when the save dialog returned that exact path.
// Also checks export:run in electron/main.cjs applies the check to every export.
// Usage: node tests/unit/export/test-export-target.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { exportTargetProblem } = require('../../../electron/export/exportTarget.cjs');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-export-target-'));
try {
  const source = path.join(dir, 'interview.mp4');
  const other = path.join(dir, 'old-export.mp4');
  fs.writeFileSync(source, 'source footage');
  fs.writeFileSync(other, 'an earlier export');
  const fresh = path.join(dir, 'new.mp4');
  const picked = path.join(dir, 'export.mp4');

  // A new file is always fine.
  assert.equal(exportTargetProblem({ file: fresh, mediaPaths: [source], confirmed: picked }), null);
  // The Name field renamed the target onto a source clip: refused for the user, even if confirmed.
  assert.deepEqual(exportTargetProblem({ file: source, mediaPaths: [source], confirmed: picked }), { reason: 'source' });
  assert.deepEqual(exportTargetProblem({ file: source, mediaPaths: [source], confirmed: source }), { reason: 'source' }, 'a dialog pick of a source file is refused too');
  assert.deepEqual(exportTargetProblem({ file: source, mediaPaths: [source], user: false }), { reason: 'source' }, 'assistant and extension exports are refused too');
  // Through another spelling of the same path.
  const alias = path.join(dir, 'link.mp4');
  try { fs.symlinkSync(source, alias); assert.deepEqual(exportTargetProblem({ file: alias, mediaPaths: [source], confirmed: alias }), { reason: 'source' }, 'a link to a source file is the source file'); } catch (e) { if (e.code !== 'EPERM') throw e; }
  // A typed name that matches another existing file: refused unless the dialog returned that path.
  assert.deepEqual(exportTargetProblem({ file: other, mediaPaths: [source], confirmed: picked }), { reason: 'exists' });
  assert.deepEqual(exportTargetProblem({ file: other, mediaPaths: [source], confirmed: null }), { reason: 'exists' });
  assert.equal(exportTargetProblem({ file: other, mediaPaths: [source], confirmed: other }), null, 'the save dialog confirmed this replacement');
  assert.equal(exportTargetProblem({ file: other, mediaPaths: [source], user: false }), null, 'host-created targets keep their own rules');

  // export:run uses the check for every export, with the dialog's path as the confirmation.
  const main = fs.readFileSync(path.join(__dirname, '../../../electron/main.cjs'), 'utf8');
  assert.match(main, /exportTargetProblem\(\{[^}]*confirmed: confirmedExportFiles\.get\(target\?\.frameDir\)[^}]*user: !owned \}\)/, 'export:run checks every target');
  assert.match(main, /frameDirs\.add\(frameDir\);confirmedExportFiles\.set\(frameDir, file\);/, 'export:begin records the dialog path');
  assert.doesNotMatch(main, /if \(owned && fs\.existsSync\(target\.file\) && project\.media\.some/, 'the source check is no longer limited to assistant exports');
  for (const lang of ['en', 'fr', 'es']) {
    const dict = JSON.parse(fs.readFileSync(path.join(__dirname, `../../../shared/i18n/${lang}.json`), 'utf8'));
    for (const key of ['main.export_target_exists', 'main.export_target_is_source']) assert.ok(dict[key]?.includes('{name}'), `${lang} ${key}`);
  }
  console.log('export target OK');
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
