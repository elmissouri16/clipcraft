// Where a video export may write (export:run in electron/main.cjs). The encoder renames the finished
// render over its target, so the target is checked before any work starts:
// - no export ever writes over one of the project's own source media files;
// - a user export replaces an existing file only when that exact path is the one the save dialog
//   returned for this export (the system dialog asked the user to confirm the replacement). A name
//   typed in the Export dialog's Name field never had that confirmation.
// Plain Node (no Electron) so tests/unit/export/test-export-target.cjs can drive it.
const fs = require('node:fs');
const path = require('node:path');

const real = (file) => { try { return fs.realpathSync(file); } catch { return path.resolve(file); } };

// file: the export target; mediaPaths: the project's source media paths; confirmed: the path the save
// dialog returned for this export (or null); user: a user export (assistant and extension targets are
// created by the host and checked by it). Returns null when the target may be written, or
// { reason: 'source' | 'exists' } when it must be refused.
function exportTargetProblem({ file, mediaPaths = [], confirmed = null, user = true }) {
  if (typeof file !== 'string' || !file) return null;
  if (!fs.existsSync(file)) return null;
  const target = real(file);
  if (mediaPaths.some((p) => typeof p === 'string' && p && fs.existsSync(p) && real(p) === target)) return { reason: 'source' };
  if (user && !(typeof confirmed === 'string' && path.resolve(confirmed) === path.resolve(file))) return { reason: 'exists' };
  return null;
}

module.exports = { exportTargetProblem };
