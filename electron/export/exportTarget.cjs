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
// The same file on disk, however its path is spelled: case-insensitive volumes (NTFS, default APFS) accept
// Clip.mp4 for clip.mp4, and a hard link is the same file too. Compared by device and file number when the
// volume reports them, by the resolved path otherwise.
const identity = (file) => { try { const st = fs.statSync(file, { bigint: true }); return st.ino ? `${st.dev}:${st.ino}` : null; } catch { return null; } };
const sameFile = (a, b) => { const ia = identity(a), ib = identity(b); return (ia !== null && ia === ib) || real(a) === real(b); };

// file: the export target; mediaPaths: the project's source media paths; confirmed: the path the save
// dialog returned for this export (or null); user: a user export (assistant and extension targets are
// created by the host and checked by it). Returns null when the target may be written, or
// { reason: 'source' | 'exists' } when it must be refused.
function exportTargetProblem({ file, mediaPaths = [], confirmed = null, user = true }) {
  if (typeof file !== 'string' || !file) return null;
  if (!fs.existsSync(file)) return null;
  if (mediaPaths.some((p) => typeof p === 'string' && p && fs.existsSync(p) && sameFile(p, file))) return { reason: 'source' };
  if (user && !(typeof confirmed === 'string' && path.resolve(confirmed) === path.resolve(file))) return { reason: 'exists' };
  return null;
}

// Names of the source files the export would read that are not on disk: media used by a clip on the main,
// overlay or audio track. Empty when everything is there.
function missingExportMedia(project, exists = fs.existsSync) {
  const media = new Map((project?.media || []).filter(Boolean).map((m) => [m.id, m]));
  const names = [];
  for (const key of ['videoClips', 'overlayClips', 'audioClips']) {
    for (const c of Array.isArray(project?.[key]) ? project[key] : []) {
      const m = c && !c.gap && media.get(c.mediaId);
      if (!m || typeof m.path !== 'string' || !m.path || exists(m.path)) continue;
      const name = m.name || path.basename(m.path.replace(/\\/g, '/'));
      if (!names.includes(name)) names.push(name);
    }
  }
  return names;
}

module.exports = { exportTargetProblem, missingExportMedia };
