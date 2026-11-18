// Working folders the export makes in the system temp folder (fve-…, clipcraft-text-…, clipcraft-fx-…) carry a
// small owner file naming the process that made them. They are removed when the export ends or the app quits;
// one left by an app that crashed is removed at the next start, once its process is gone. A folder without the
// owner file (another program's, an older version's) is never touched.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { processAlive } = require('./childProcesses.cjs');

const OWNER = '.clipcraft-owner.json';
const WORK_DIR = /^(?:fve-|clipcraft-text-|clipcraft-fx-)[A-Za-z0-9]{6}$/;

function makeWorkDir(prefix, root = os.tmpdir()) {
  const dir = fs.mkdtempSync(path.join(root, prefix));
  try { fs.writeFileSync(path.join(dir, OWNER), JSON.stringify({ kind: 'clipcraft-work', pid: process.pid })); } catch { /* removed at the end of its job anyway */ }
  return dir;
}

function sweepWorkDirs(root = os.tmpdir(), { alive = processAlive } = {}) {
  const removed = [];
  let entries = [];
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { return removed; }
  for (const entry of entries) {
    if (!entry.isDirectory() || !WORK_DIR.test(entry.name)) continue;
    const dir = path.join(root, entry.name);
    try {
      const owner = JSON.parse(fs.readFileSync(path.join(dir, OWNER), 'utf8'));
      if (owner.kind !== 'clipcraft-work' || !Number.isSafeInteger(owner.pid) || owner.pid < 1 || alive(owner.pid)) continue;
      fs.rmSync(dir, { recursive: true, force: true });
      removed.push(entry.name);
    } catch { /* no owner file, or in use: left alone */ }
  }
  return removed;
}

// Removes a working folder without ever throwing: a folder still held by a process that is exiting (Windows
// answers EBUSY/EPERM) is retried for a few seconds, and one that still cannot go is left for the OS temp
// cleanup. Resolves true when the folder is gone.
function removeWorkDir(dir, { retries = 10, delayMs = 200 } = {}) {
  if (!dir) return Promise.resolve(true);
  return new Promise((resolve) => {
    try { fs.rm(dir, { recursive: true, force: true, maxRetries: retries, retryDelay: delayMs }, (error) => resolve(!error)); }
    catch { resolve(false); }
  });
}

module.exports = { makeWorkDir, sweepWorkDirs, removeWorkDir, OWNER };
