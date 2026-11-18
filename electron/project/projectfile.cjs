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
      return out;
    });
    return changed ? JSON.stringify(p) : projectJson;
  } catch {
    return projectJson;
  }
}

// The same check for a project already parsed (an autosave slot): the project itself when nothing changed.
function checkGeneratedProject(project, cacheDir) {
  const text = JSON.stringify(project), checked = checkGenerated(text, cacheDir);
  return checked === text ? project : JSON.parse(checked);
}

// Projects saved before the rotation fix have the stored (not turned) size of phone videos: probe those again.
async function refreshSizes(projectJson, probe) {
  try {
    const p = JSON.parse(projectJson);
    let changed = false;
    for (const m of p.media || []) {
      if (m.type !== 'video' || (m.rotation !== undefined && m.hdr !== undefined) || !fs.existsSync(m.path)) continue;
      try {
        const info = await probe(m.path);
        changed = true;
        Object.assign(m, { width: info.width, height: info.height, rotation: info.rotation, hdr: info.hdr });
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

module.exports = { checkGenerated, checkGeneratedProject, refreshSizes, isProjectDocument };
