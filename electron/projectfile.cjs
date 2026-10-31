const fs = require('fs');
const path = require('path');

// Generated files (thumbnails, waveform, preview proxy) recorded in a saved project may be gone (cache cleaned,
// another PC): drop them so they are made again, instead of the player showing black without sound.
const GENERATED = { thumb: ['thumb', 'thumbCount', 'thumbInterval', 'thumbW', 'thumbH'], wave: ['wave'], proxy: ['proxy'] };
// cacheDir: where generated files live now; a file moved there (older versions used another folder) is found again.
function checkGenerated(projectJson, cacheDir) {
  try {
    const p = JSON.parse(projectJson);
    let changed = false;
    p.media = (p.media || []).map((m) => {
      const out = { ...m };
      for (const [key, fields] of Object.entries(GENERATED)) {
        if (!out[key] || fs.existsSync(out[key])) continue;
        const moved = cacheDir && path.join(cacheDir, path.basename(out[key]));
        if (moved && fs.existsSync(moved)) {
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

module.exports = { checkGenerated, refreshSizes };
