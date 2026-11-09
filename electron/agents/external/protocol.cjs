// What the ClipCraft app (endpoint.cjs) and the stdio bridge (bridge.cjs) share
// (docs/design/external-agent-mcp.md): where the endpoint lives and how messages are framed.
// No Electron imports: the bridge runs in plain Node (or the app binary in Node mode).
const crypto = require('node:crypto');
const os = require('node:os');
const path = require('node:path');

const APP_NAME = 'ClipCraft';
// MCP versions the bridge speaks, newest first.
const PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const ENDPOINT_FILE = 'endpoint.json';
const MANIFEST_FILE = 'tools.json';

// Electron's userData for ClipCraft on each platform (main.cjs sets the app name).
function defaultUserData({ platform = process.platform, env = process.env, home = os.homedir() } = {}) {
  if (platform === 'darwin') return path.join(home, 'Library', 'Application Support', APP_NAME);
  if (platform === 'win32') return path.join(env.APPDATA || path.join(home, 'AppData', 'Roaming'), APP_NAME);
  return path.join(env.XDG_CONFIG_HOME || path.join(home, '.config'), APP_NAME);
}
const endpointDir = (userData) => path.join(userData, 'mcp');

// A Unix socket in the endpoint folder, or a short one in the temp folder when that path would pass
// the 104-byte limit (macOS); a per-user named pipe on Windows.
function socketPath(dir, { platform = process.platform } = {}) {
  const hash = crypto.createHash('sha256').update(dir).digest('hex').slice(0, 16);
  if (platform === 'win32') return `\\\\.\\pipe\\clipcraft-mcp-${hash}`;
  const local = path.join(dir, 'clipcraft.sock');
  return Buffer.byteLength(local) <= 100 ? local : path.join(os.tmpdir(), `clipcraft-${hash}.sock`);
}

// Newline-delimited JSON in both directions; bad lines are skipped.
function lineReader(onMessage) {
  let buffer = '';
  return (chunk) => {
    buffer += chunk;
    if (buffer.length > 64 * 1024 * 1024) buffer = ''; // a runaway peer cannot grow memory without bound
    let at;
    while ((at = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, at).trim();
      buffer = buffer.slice(at + 1);
      if (!line) continue;
      let message;
      try { message = JSON.parse(line); } catch { continue; }
      if (message && typeof message === 'object') onMessage(message);
    }
  };
}
const frame = (message) => `${JSON.stringify(message)}\n`;

const textResult = (text, isError = false) => ({ ...(isError ? { isError: true } : {}), content: [{ type: 'text', text }] });

module.exports = { APP_NAME, PROTOCOL_VERSIONS, ENDPOINT_FILE, MANIFEST_FILE, defaultUserData, endpointDir, socketPath, lineReader, frame, textResult };
