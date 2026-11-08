// Anonymous usage statistics (opt-in). Nothing is sent until the user agrees, and nothing after they turn it off.
// State lives in <userData>/telemetry.json: { consent: true | false | null, installId, installSent, lastHeartbeatDay }.
// A message holds only: a random installation ID (crypto UUID, not derived from the PC), the event and the app version.
// The server records its own time. Failures are ignored: statistics must never get in the way of the app.
// Described to users at https://hamzaabika.com/clipcraft/privacy.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { app, net } = require('electron');

const ENDPOINT = process.env.FVE_TELEMETRY_URL || 'https://hamzaabika.com/clipcraft/api/v1/telemetry';
const CHECK_EVERY = 6 * 3600 * 1000; // while the app stays open, send the next day's heartbeat

function stateFile() {
  // UI tests never touch the real file.
  const dir = process.env.FVE_SMOKE ? path.join(process.env.FVE_SMOKE, 'settings-test') : app.getPath('userData');
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, 'telemetry.json');
}

function read() {
  try {
    const s = JSON.parse(fs.readFileSync(stateFile(), 'utf8'));
    return s && typeof s === 'object' ? s : {};
  } catch {
    return {};
  }
}

function write(state) {
  try {
    fs.writeFileSync(stateFile(), JSON.stringify(state, null, 2), { encoding: 'utf8', mode: 0o600 });
  } catch {
    // a read-only profile only means no statistics
  }
}

// Sending is possible from the installed app, or from a dev/test run that names its own server.
// UI tests never send.
const canSend = () => false; // ClipCraft: telemetry to the original project's server is disabled.

const utcDay = () => new Date().toISOString().slice(0, 10);

async function post(event, installId) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await net.fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ install_id: installId, event, version: app.getVersion() }),
      signal: ctrl.signal,
      credentials: 'omit',
      cache: 'no-store',
    });
    // 204 = recorded (or already known). 4xx means the server will never accept this message: don't retry it.
    return res.status === 204 || (res.status >= 400 && res.status < 500 && res.status !== 429);
  } catch {
    return false; // offline or server down: try again on a later launch
  } finally {
    clearTimeout(timer);
  }
}

let busy = false;
// Send what is due: the install event once, then one heartbeat per UTC day.
async function sendDue() {
  if (busy || !canSend()) return;
  const s = read();
  if (s.consent !== true || !s.installId) return;
  busy = true;
  try {
    if (!s.installSent) {
      if (!(await post('install', s.installId))) return;
      const now = read();
      if (now.consent !== true) return; // turned off meanwhile
      write({ ...now, installSent: true, lastHeartbeatDay: utcDay() }); // the install counts as today's activity
      return;
    }
    const day = utcDay();
    if (s.lastHeartbeatDay === day) return;
    if (await post('heartbeat', s.installId)) {
      const now = read();
      if (now.consent === true) write({ ...now, lastHeartbeatDay: day });
    }
  } finally {
    busy = false;
  }
}

// For the renderer: whether to ask, and the current choice. The ID itself is never sent to the interface.
function getStatus() {
  const s = read();
  return { consent: s.consent === true ? true : s.consent === false ? false : null };
}

function setConsent(on) {
  const s = read();
  if (on) {
    s.consent = true;
    if (!s.installId) s.installId = crypto.randomUUID();
  } else {
    s.consent = false; // kept off for good: updates never turn it back on
  }
  s.decidedAt = new Date().toISOString();
  write(s);
  if (on) sendDue().catch(() => {});
  return getStatus();
}

let timer = null;
function start() {
  // A little after launch, so statistics never compete with the window opening.
  setTimeout(() => sendDue().catch(() => {}), 15000);
  if (!timer) {
    timer = setInterval(() => sendDue().catch(() => {}), CHECK_EVERY);
    timer.unref?.();
  }
}

module.exports = { start, getStatus, setConsent, sendDue, ENDPOINT };
