// Starting a command on Windows without a shell that re-splits its arguments, and stopping all of it.
// A .exe or .com is started directly. Anything else (an npm .cmd shim, a .bat, a bare name such as npx that
// only cmd.exe finds through PATHEXT) runs through cmd.exe with a command line built here: each part is
// quoted by the C runtime's rules (CommandLineToArgvW), then every character cmd.exe treats specially is
// escaped with ^, so an argument with spaces, quotes or & stays one argument and runs nothing else.
// windowsVerbatimArguments stops Node from quoting the line a second time. Other platforms: unchanged.
const childProcess = require('node:child_process');

const CMD_SPECIAL = /[()[\]%!^"`<>&|;, *?]/g;

// One argument for the C runtime's parser: quoted, inner quotes escaped, and backslashes doubled only
// where they precede a quote (inside the argument or the closing one).
function quoteArgument(value) {
  let out = '"', slashes = 0;
  for (const ch of String(value)) {
    if (ch === '\\') { slashes++; continue; }
    out += ch === '"' ? `${'\\'.repeat(slashes * 2 + 1)}"` : `${'\\'.repeat(slashes)}${ch}`;
    slashes = 0;
  }
  return `${out}${'\\'.repeat(slashes * 2)}"`;
}
const commandLine = (file, args) => [file, ...args].map((part) => quoteArgument(part).replace(CMD_SPECIAL, '^$&')).join(' ');

// { command, args, options } for spawn/execFile. options holds only what the launch itself needs.
function launchSpec(file, args = [], { platform = process.platform, env = process.env } = {}) {
  if (platform !== 'win32' || /\.(?:exe|com)$/i.test(String(file))) return { command: file, args, options: {} };
  return { command: env.ComSpec || env.COMSPEC || 'cmd.exe', args: ['/d', '/s', '/c', `"${commandLine(file, args)}"`], options: { windowsVerbatimArguments: true } };
}

// Stops a child and everything it started. On Windows kill() ends only the direct child (cmd.exe, an npx
// shim), so the tree goes with taskkill; elsewhere the child gets the usual signal.
function stopProcessTree(child, { platform = process.platform, spawnImpl = childProcess.spawn } = {}) {
  if (!child) return;
  if (platform === 'win32' && child.pid) {
    try {
      const killer = spawnImpl('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
      killer.on?.('error', () => { try { child.kill(); } catch { /* gone */ } });
      return;
    } catch { /* fall back to the direct child */ }
  }
  try { child.kill(); } catch { /* already gone */ }
}

module.exports = { launchSpec, stopProcessTree, quoteArgument, commandLine };
