// PKG-1 (2026-11-01): normalize the staged app payload's permissions before any package
// (deb) is assembled from it. This build environment creates files with restrictive modes
// (660 files / 770 dirs) and electron-builder + fpm copy the staged modes verbatim into the
// .deb — the shipped 1.0.0 test build installed /opt/ClipCraft as 770 with a 660 app.asar,
// so a normal user could not even enter the app directory and the menu entry was dead
// (Hamza had to chmod by hand). Normalizing here, in the packaging config itself, fixes every
// future package built from this tree:
//   directories -> 755, plain files -> 644, executables -> 755.
// A file counts as executable when it already carries an exec bit OR is an ELF binary/shared
// object (magic bytes) — the second rule rescues payloads staged without any exec bit (the
// bundled ffmpeg/ffprobe, onnxruntime .so files). Special bits already present (e.g. the
// chrome-sandbox helper's setuid) are preserved.
const fs = require('fs');
const path = require('path');

const ELF_MAGIC = Buffer.from([0x7f, 0x45, 0x4c, 0x46]); // \x7f 'E' 'L' 'F'

function isElf(file) {
  try {
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(4);
    fs.readSync(fd, buf, 0, 4, 0);
    fs.closeSync(fd);
    return buf.equals(ELF_MAGIC);
  } catch {
    return false;
  }
}

function normalize(dir) {
  fs.chmodSync(dir, 0o755);
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      normalize(p);
    } else if (ent.isFile()) {
      const mode = fs.statSync(p).mode;
      const executable = (mode & 0o111) !== 0 || isElf(p);
      fs.chmodSync(p, (mode & 0o7000) | (executable ? 0o755 : 0o644));
    }
    // Symlinks are left alone: their targets live inside the same tree and are normalized
    // at their real paths.
  }
}

module.exports = async function afterPack(context) {
  normalize(context.appOutDir);
};
