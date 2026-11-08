const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { localPath } = require('./editorFiles.cjs');

function createEditorExportTarget(req, { outputDir, cacheDir }) {
  if (typeof req?.requestId !== 'string' || !req.requestId || req.requestId.length > 100) throw Error('Export requires an active request ID.');
  if (req.overwrite !== undefined && typeof req.overwrite !== 'boolean') throw Error('overwrite must be true or false.');
  const review = req.kind === 'review';
  let file;
  if (review) {
    if (req.file_path || req.overwrite) throw Error('Review renders use the application cache.');
    fs.mkdirSync(cacheDir, { recursive: true });
    // Keep only recent application-created previews. Never prune user exports.
    const old = fs.readdirSync(cacheDir).filter(name => /^review-[a-f0-9-]{36}\.mp4$/.test(name))
      .map(name => ({ file: path.join(cacheDir, name), info: fs.statSync(path.join(cacheDir, name)) }))
      .filter(entry => entry.info.isFile()).sort((a, b) => b.info.mtimeMs - a.info.mtimeMs);
    for (const entry of old.slice(11)) fs.rmSync(entry.file, { force: true });
    file = path.join(cacheDir, `review-${crypto.randomUUID()}.mp4`);
  } else if (req.file_path) file = localPath(req.file_path);
  else {
    const name = String(req.name || 'ClipCraft video').replace(/[\\/:*?"<>|\x00-\x1f]+/g, '_').replace(/\.mp4$/i, '').slice(0, 100) || 'ClipCraft video';
    file = path.join(outputDir, `${name}-${crypto.randomUUID().slice(0, 8)}.mp4`);
  }
  if (path.extname(file).toLowerCase() !== '.mp4') throw Error('Choose an .mp4 export path.');
  const parent = fs.realpathSync(path.dirname(file));
  if (!fs.statSync(parent).isDirectory()) throw Error('The output folder does not exist.');
  file = path.join(parent, path.basename(file));
  if (fs.existsSync(file) && !req.overwrite) throw Error('The export destination already exists. Choose another name or explicitly request overwrite.');
  if (fs.existsSync(file) && !fs.statSync(file).isFile()) throw Error('The export destination must be a regular file.');
  const frameDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clipcraft-text-'));
  return { file, frameDir, requestId: req.requestId, noOverwrite: !req.overwrite, kind: review ? 'review' : 'export', revision: req.revision, timelineStart: review ? req.start_sec : 0 };
}
module.exports = { createEditorExportTarget };
