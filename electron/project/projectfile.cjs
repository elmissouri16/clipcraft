const fs = require('fs');
const path = require('path');
const { derivedCurrent } = require('../media/quality.cjs');

// Generated files (thumbnails, waveform, preview proxy) recorded in a saved project may be gone (cache cleaned,
// another PC): drop them so they are made again, instead of the player showing black without sound.
const GENERATED = { thumb: ['thumb', 'thumbCount', 'thumbInterval', 'thumbW', 'thumbH'], wave: ['wave'], proxy: ['proxy'] };
// cacheDir: where generated files live now; a file moved there (older versions used another folder) is found again.
// A generated file made from an earlier version of the source (replaced at the same path) counts as gone:
// its name no longer matches the source's key (electron/media/quality.cjs derivedCurrent).
function checkGenerated(projectJson, cacheDir) {
  try {
    const p = JSON.parse(projectJson);
    let changed = false;
    p.media = (p.media || []).map((m) => {
      const out = { ...m };
      const usable = (file) => fs.existsSync(file) && derivedCurrent(m, file);
      // A copy that is gone (Clear proxies, a cleaned cache) is dropped like a stale one, so it is made
      // again instead of the player playing a file that does not exist; one moved to cacheDir is kept.
      const found = (file) => {
        if (usable(file)) return file;
        const moved = cacheDir && path.join(cacheDir, path.basename(file));
        return moved && usable(moved) ? moved : null;
      };
      for (const field of ['poster', 'lightProxy']) {
        if (typeof out[field] !== 'string') continue;
        const file = found(out[field]);
        if (file === out[field]) continue;
        if (file) out[field] = file; else delete out[field];
        changed = true;
      }
      if (out.proxies && typeof out.proxies === 'object') {
        const entries = Object.entries(out.proxies).map(([level, f]) => [level, typeof f === 'string' ? found(f) : f]);
        if (entries.some(([level, f]) => f !== out.proxies[level])) {
          out.proxies = Object.fromEntries(entries.filter(([, f]) => f !== null));
          changed = true;
        }
      }
      for (const [key, fields] of Object.entries(GENERATED)) {
        if (!out[key] || usable(out[key])) continue;
        const moved = cacheDir && path.join(cacheDir, path.basename(out[key]));
        if (moved && usable(moved)) {
          out[key] = moved;
          changed = true;
        } else {
          fields.forEach((f) => delete out[f]);
          if (key === 'proxy') out.optimizing = true;
          changed = true;
        }
      }
      // A source file that is not there (and was not found next to the project) is offline, not "optimizing":
      // no copy can be made of it until the user locates it.
      if (typeof out.path === 'string' && out.path && !fs.existsSync(out.path)) {
        if (!out.missing || out.optimizing) changed = true;
        out.missing = true;
        delete out.optimizing;
      } else if (out.missing) {
        delete out.missing;
        changed = true;
      }
      return out;
    });
    // A Voice Enhancer render that is gone (project opened on another computer, cache cleared): the export would
    // fall back to the original sound while the player played the missing file as silence. The clip is set back
    // to its original sound and flagged, so the Enhance voice section says so and offers to render it again.
    for (const key of ['videoClips', 'overlayClips', 'audioClips']) {
      if (!Array.isArray(p[key])) continue;
      p[key] = p[key].map((c) => {
        const e = c && c.enhance;
        if (!e || typeof e.path !== 'string' || fs.existsSync(e.path)) return c;
        const moved = cacheDir && path.join(cacheDir, path.basename(e.path));
        changed = true;
        if (moved && fs.existsSync(moved)) return { ...c, enhance: { ...e, path: moved } };
        const { path: _gone, ...rest } = e;
        return { ...c, enhance: { ...rest, on: false, missing: true } };
      });
    }
    return changed ? JSON.stringify(p) : projectJson;
  } catch {
    return projectJson;
  }
}

// Media whose file is no longer where the project recorded it (the project folder copied to another computer,
// a drive with another letter, a Windows project opened here). The recorded path's trailing components are
// tried under the project file's own folder (both separators understood): clip.mp4, Footage/clip.mp4, ...
// A file is adopted only when exactly one candidate exists and, when the project recorded a size, it matches.
const isFile = (file) => { try { return fs.statSync(file).isFile(); } catch { return false; } };
const pathParts = (file) => String(file || '').split(/[\\/]+/).filter((s) => s && s !== '.' && s !== '..' && !/^[A-Za-z]:$/.test(s));
function movedCandidates(recorded, projectDir) {
  const parts = pathParts(recorded), out = [];
  for (let k = 1; k <= Math.min(parts.length, 8); k++) {
    const file = path.join(projectDir, ...parts.slice(-k));
    if (isFile(file) && !out.includes(file)) out.push(file);
  }
  return out;
}
function findMovedMedia(m, projectDir) {
  if (!m || typeof m.path !== 'string' || !m.path || !projectDir) return null;
  const found = movedCandidates(m.path, projectDir);
  if (found.length !== 1) return null;
  if (Number.isFinite(m.size) && m.size > 0) { try { if (fs.statSync(found[0]).size !== m.size) return null; } catch { return null; } }
  return found[0];
}
function relocateMedia(projectJson, projectFile) {
  try {
    const p = JSON.parse(projectJson);
    if (!projectFile || !Array.isArray(p.media)) return projectJson;
    const dir = path.dirname(projectFile);
    let changed = false;
    p.media = p.media.map((m) => {
      if (!m || typeof m.path !== 'string' || !m.path || fs.existsSync(m.path)) return m;
      const file = findMovedMedia(m, dir);
      if (!file) return m;
      changed = true;
      return { ...m, path: file };
    });
    return changed ? JSON.stringify(p) : projectJson;
  } catch {
    return projectJson;
  }
}
function relocateMediaProject(project, projectFile) {
  const text = JSON.stringify(project), moved = relocateMedia(text, projectFile);
  return moved === text ? project : JSON.parse(moved);
}
// Locate: the user pointed the offline item at `oldFile` to `newFile`; another offline item that sat under the
// same old folder is looked for at the same relative path under the new folder. Returns that path or null.
function relocatedPath(oldFile, newFile, otherFile) {
  const from = pathParts(oldFile).slice(0, -1), other = pathParts(otherFile);
  if (!from.length || other.length <= from.length) return null;
  const windows = /^[A-Za-z]:|\\/.test(String(oldFile));
  const same = (a, b) => (windows ? a.toLowerCase() === b.toLowerCase() : a === b);
  if (!from.every((part, i) => same(part, other[i]))) return null;
  return path.join(path.dirname(newFile), ...other.slice(from.length));
}

// The same check for a project already parsed (an autosave slot): the project itself when nothing changed.
function checkGeneratedProject(project, cacheDir) {
  const text = JSON.stringify(project), checked = checkGenerated(text, cacheDir);
  return checked === text ? project : JSON.parse(checked);
}

// Projects saved before the rotation fixes have the stored (not turned) size of phone videos and photos: probe
// those again.
async function refreshSizes(projectJson, probe) {
  try {
    const p = JSON.parse(projectJson);
    let changed = false;
    for (const m of p.media || []) {
      const stale = m.type === 'video' ? m.rotation === undefined || m.hdr === undefined : m.type === 'image' && m.orientation === undefined;
      if (!stale || !fs.existsSync(m.path)) continue;
      try {
        const info = await probe(m.path);
        changed = true;
        Object.assign(m, { width: info.width, height: info.height, rotation: info.rotation, hdr: info.hdr }, m.type === 'image' ? { orientation: info.orientation ?? 1 } : {});
      } catch {
        // keep what the project says
      }
    }
    return changed ? JSON.stringify(p) : projectJson;
  } catch {
    return projectJson;
  }
}

// A ClipCraft project file, not merely JSON: an object with the media and main-track lists every
// saved project carries. Only such a file may become an auto save target (another JSON file opened
// by mistake, or by an outside agent, would be rewritten as a project).
function isProjectDocument(projectJson) {
  let p;
  try { p = JSON.parse(projectJson); } catch { return false; }
  return !!p && typeof p === 'object' && !Array.isArray(p) && Array.isArray(p.media) && Array.isArray(p.videoClips);
}

module.exports = { checkGenerated, checkGeneratedProject, refreshSizes, isProjectDocument, relocateMedia, relocateMediaProject, findMovedMedia, relocatedPath };
