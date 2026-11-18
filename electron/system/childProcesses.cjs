// Every helper program (FFmpeg, ffprobe…) the main process starts for media work goes through spawn() here, so
// quitting the app can stop all of them: a job left running would keep encoding into the media cache after the
// app is gone, and the next launch could publish its half-written file.
const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');

const live = new Set();
function track(child) {
  if (!child || typeof child.kill !== 'function') return child;
  live.add(child);
  const forget = () => live.delete(child);
  child.once?.('exit', forget);
  child.once?.('error', forget);
  return child;
}
// Looked up at call time so a test that replaces child_process.spawn still sees every call.
const spawn = (...args) => track(childProcess.spawn(...args));
// Callback form only (util.promisify on this wrapper would lose execFile's { stdout, stderr } result).
const execFile = (...args) => track(childProcess.execFile(...args));
function killAll() {
  for (const child of live) { try { child.kill('SIGKILL'); } catch { /* already gone */ } }
  live.clear();
}
const running = () => live.size;
// Resolves once the child has exited (at once if it already has), or after timeoutMs: what must wait for a
// process to let go of its files or working folder (Windows refuses to remove a live process's folder).
function processExited(child, timeoutMs = 5000) {
  return new Promise((resolve) => {
    if (!child || child.exitCode != null || child.signalCode != null || typeof child.once !== 'function') { resolve(); return; }
    const done = () => { clearTimeout(timer); resolve(); };
    const timer = setTimeout(done, timeoutMs);
    timer.unref?.();
    child.once('exit', done); child.once('error', done);
  });
}

// Partial files are named <name>.<pid>-<hex>.part[.<ext>] (stabilization's motion file: .<pid>-<hex>.trf; see
// PART_TAG in the media modules). At startup any whose process is no longer running, and any untagged one left by
// an older version, is a dead job's leftover.
const PART_FILE = /\.(?:(\d+)-[0-9a-f]+\.)?(?:part(?:\.[^.]+)?|trf)$/i;
function processAlive(pid) {
  if (!pid || pid === process.pid) return pid === process.pid;
  try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; }
}
function sweepPartFiles(dir, { alive = processAlive } = {}) {
  const removed = [];
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return removed; }
  for (const name of names) {
    const match = PART_FILE.exec(name);
    if (!match || (match[1] && alive(Number(match[1])))) continue;
    try { fs.rmSync(path.join(dir, name), { force: true }); removed.push(name); } catch { /* in use: next launch */ }
  }
  return removed;
}

module.exports = { spawn, execFile, track, killAll, running, sweepPartFiles, processAlive, processExited };
