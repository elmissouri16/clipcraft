// Bounded local-media discovery/import and subtitle I/O. No shell commands or
// arbitrary document reads: supported media and .srt files only.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const MEDIA = new Set('mp4 mov mkv webm avi m4v wmv flv 3gp mts m2ts ts mpg mpeg ogv mp3 wav m4a aac ogg oga opus flac wma aiff aif amr ac3 mka png jpg jpeg webp bmp gif'.split(' '));
const AUDIO = new Set('mp3 wav m4a aac ogg oga opus flac wma aiff aif amr ac3 mka'.split(' '));
const IMAGE = new Set('png jpg jpeg webp bmp gif'.split(' '));
const stop = signal => { if (signal?.aborted) throw Object.assign(Error('File job stopped.'), { name: 'AbortError' }); };
function localPath(value) {
  if (typeof value !== 'string' || !value || value.length > 4096 || value.includes('\0')) throw Error('Provide an absolute local file or folder path.');
  const expanded = value.startsWith('~/') ? path.join(os.homedir(), value.slice(2)) : value;
  if (!path.isAbsolute(expanded)) throw Error('Use an absolute path or ~/path.');
  return path.normalize(expanded);
}
async function collectMedia(roots, recursive, signal) {
  if (!Array.isArray(roots) || !roots.length || roots.length > 64) throw Error('Provide from one to 64 local paths.');
  const entries = [], seen = new Set(), directories = new Set(), warnings = [];
  let visited = 0, truncated = false;
  const warn = (file, error) => { if (warnings.length < 20) warnings.push({ path: file, error }); };
  const visit = async (file, depth = 0) => {
    stop(signal);
    if (++visited > 12000 || entries.length >= 4096) { truncated = true;return; }
    try {
      const canonical = await fs.promises.realpath(file), info = await fs.promises.stat(canonical);
      if (info.isDirectory()) {
        if (directories.has(canonical)) return;
        directories.add(canonical);
        if (depth > 8) { truncated = true;return; }
        const children = await fs.promises.readdir(canonical, { withFileTypes: true });
        children.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
        for (const entry of children) {
          stop(signal);
          if (visited >= 12000 || entries.length >= 4096) { truncated = true;break; }
          if (entry.isSymbolicLink()) continue;
          if (entry.isDirectory() && !recursive) continue;
          await visit(path.join(canonical, entry.name), depth + 1);
        }
      } else if (info.isFile()) {
        const extension = path.extname(canonical).slice(1).toLowerCase();
        if (!MEDIA.has(extension)) return;
        if (seen.has(canonical)) return;
        seen.add(canonical);
        entries.push({ path: canonical, name: path.basename(canonical), bytes: info.size, mtime_ms: info.mtimeMs,
          type: AUDIO.has(extension) ? 'audio' : IMAGE.has(extension) ? 'image' : 'video' });
      }
    } catch (error) { stop(signal);warn(file, error.message); }
  };
  for (const root of roots) await visit(localPath(root));
  return { entries, warnings, truncated };
}
function page(req, total) {
  const offset = req.offset ?? 0, limit = req.limit ?? 32;
  if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 64) throw Error('offset must be nonnegative; limit must be from 1 to 64.');
  return { offset, limit, next_offset: offset + limit < total ? offset + limit : null };
}
async function subtitlePath(value) {
  const file = localPath(value);
  if (path.extname(file).toLowerCase() !== '.srt') throw Error('Subtitle files must have the .srt extension.');
  return file;
}
// mayReplace(file) / wrote(file): the subtitle files this app wrote for the same owner in this session.
// Only such a file (unchanged since) may be replaced when the model asks; without them none is.
async function runEditorFileJob(req, { signal, probeAll, choosePaths, outputDir, mayReplace, wrote }) {
  stop(signal);
  if (req.action === 'list' || req.action === 'import') {
    let roots = req.paths;
    if (!roots?.length) {
      if (!choosePaths) throw Error('Provide local paths to import.');
      roots = await choosePaths(req.pick === 'folder' ? 'folder' : 'files');
      stop(signal);
      if (!roots?.length) return { canceled: true, items: [], entries: [], total: 0 };
    }
    const collection = await collectMedia(roots, !!req.recursive, signal), paging = page(req, collection.entries.length);
    const entries = collection.entries.slice(paging.offset, paging.offset + paging.limit);
    if (req.action === 'list') return { ...collection, entries, total: collection.entries.length, ...paging };
    const items = [], failures = [];
    // Check cancellation between probes; importing many files must stay stoppable.
    for (const entry of entries) {
      stop(signal);
      const [item] = await probeAll([entry.path]);
      stop(signal);
      if (!item || item.error) failures.push({ path: entry.path, error: item?.error || 'Could not probe media.' });
      else items.push(item);
    }
    return { items, failures, warnings: collection.warnings, truncated: collection.truncated, total: collection.entries.length, ...paging };
  }
  if (req.action === 'read_subtitles') {
    const file = await fs.promises.realpath(await subtitlePath(req.path)), info = await fs.promises.stat(file);
    if (path.extname(file).toLowerCase() !== '.srt') throw Error('Subtitle links must resolve to .srt files.');
    if (!info.isFile() || info.size > 2 * 1024 * 1024) throw Error('Choose a subtitle file up to 2 MiB.');
    const text = await fs.promises.readFile(file, { encoding: 'utf8', signal });
    stop(signal);return { text, path: file, bytes: info.size };
  }
  if (req.action === 'write_subtitles') {
    if (typeof req.text !== 'string' || !req.text.trim() || Buffer.byteLength(req.text) > 2 * 1024 * 1024) throw Error('Subtitle text must be nonempty and up to 2 MiB.');
    let file;
    if (req.path) file = await subtitlePath(req.path);
    else {
      await fs.promises.mkdir(outputDir, { recursive: true });
      const name = String(req.name || 'subtitles').replace(/\.srt$/i, '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '-').trim().slice(0, 120) || 'subtitles';
      file = path.join(outputDir, `${name}.srt`);
      for (let suffix = 2; fs.existsSync(file); suffix++) file = path.join(outputDir, `${name}-${suffix}.srt`);
    }
    const parent = await fs.promises.realpath(path.dirname(file));
    file = path.join(parent, path.basename(file));
    const temporary = path.join(parent, `.clipcraft-${crypto.randomUUID()}.srt.part`);
    try {
      await fs.promises.writeFile(temporary, req.text, { encoding: 'utf8', flag: 'wx', signal });
      stop(signal);
      const ours = () => !!mayReplace?.(file);
      const foreign = 'That subtitle file already exists and this assistant did not create it. Choose a new file name.';
      if (req.overwrite === true && fs.existsSync(file) && !ours()) throw Error(foreign);
      if (req.overwrite === true) await fs.promises.rename(temporary, file);
      else {
        try { await fs.promises.link(temporary, file); }
        catch (error) {
          if (error.code === 'EEXIST') throw Error(ours() ? 'That subtitle file already exists. Use another path, or overwrite only when the user requests it.' : foreign);
          if (require('../system/hardLinks.cjs').hardLinkUnsupported(error)) await fs.promises.copyFile(temporary, file, fs.constants.COPYFILE_EXCL);
          else throw error;
        }
      }
      wrote?.(file);
      return { path: file, name: path.basename(file), bytes: Buffer.byteLength(req.text), mime_type: 'application/x-subrip' };
    } finally { await fs.promises.rm(temporary, { force: true }); }
  }
  throw Error('Unknown editor file action.');
}
module.exports = { runEditorFileJob, collectMedia, localPath };
