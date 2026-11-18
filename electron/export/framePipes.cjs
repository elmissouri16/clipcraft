// Raw frames between FFmpeg and the app (the effects pass, electron/export/fxjobs.cjs).
//
// On macOS a child's stdio is a Unix socket pair whose buffers are 8 KB
// (net.local.stream.sendspace/recvspace). An 8 MB 1080p frame then took about
// 1,000 reads, and in Electron's main process every read costs a full event-loop
// turn: 600 frames cost 12.6 s of main-process CPU just to arrive, which made the
// whole app sluggish while an effect exported. Measured in Electron on macOS:
//  - frames FROM FFmpeg: FFmpeg's end of stdout gets a 1 MB send buffer before it
//    starts (the system Perl sets the socket option and then becomes FFmpeg: same
//    process, same pid, nothing between the two): 64 KB reads, 600 frames in 1.3 s;
//  - frames TO FFmpeg: our end cannot be resized from Node, so frames go through a
//    private named pipe with one blocking write per frame (the kernel moves it in
//    pipe-sized pieces without waking the event loop): 300 frames in 1.1 s of CPU
//    instead of 5.2 s.
// Elsewhere, without Perl, or when anything here fails, the plain pipes are used.
const fs = require('fs');
const path = require('path');
const { spawn } = require('../system/childProcesses.cjs');

const PERL = '/usr/bin/perl';
const SEND_BUFFER = 1 << 20;
// Never fails before exec: a refused option only means the plain buffer size.
const RAISE_SEND_BUFFER = 'use Socket; my $n = shift @ARGV; eval { open(my $s, ">&=", 1) or die; setsockopt($s, SOL_SOCKET, SO_SNDBUF, pack("i", $n)) or die; }; exec { $ARGV[0] } @ARGV; die "Could not start $ARGV[0]: $!\\n";';

const fastPipes = () => process.platform === 'darwin' && !process.env.FVE_PLAIN_FRAME_PIPES;
let perl;
const hasPerl = () => (perl ??= fastPipes() && fs.existsSync(PERL));

// FFmpeg writing raw frames to stdout.
function spawnDecoder(ffmpegPath, args, options = {}) {
  if (hasPerl()) return spawn(PERL, ['-e', RAISE_SEND_BUFFER, String(SEND_BUFFER), ffmpegPath, ...args], { windowsHide: true, ...options });
  return spawn(ffmpegPath, args, { windowsHide: true, ...options });
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const fsWrite = (fd, buffer, offset) => new Promise((resolve, reject) => fs.write(fd, buffer, offset, buffer.length - offset, null, (error, n) => (error ? reject(error) : resolve(n))));

// A writer for FFmpeg reading raw frames from `input` (a named pipe it opens itself).
// write(buffer) resolves once the frame is in the pipe; end() closes it (FFmpeg sees the end).
function fifoWriter(fifo, proc) {
  let fd = null, opening = null, closed = false;
  const open = () => opening ??= (async () => {
    // Opening for writing without a reader fails (ENXIO): wait until FFmpeg has it open.
    const until = Date.now() + 15000;
    for (;;) {
      if (closed) throw new Error('The effect encoder was stopped.');
      if (proc.exitCode !== null || proc.signalCode) throw new Error('The effect encoder ended before all frames were written.');
      try {
        const probe = fs.openSync(fifo, fs.constants.O_WRONLY | fs.constants.O_NONBLOCK);
        try {
          // The encoder can close its reader after the probe succeeds. Hold
          // our own nonblocking reader across the blocking open so that race
          // cannot freeze the main thread. It never reads or survives open().
          const reader = fs.openSync(fifo, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK);
          try { fd = fs.openSync(fifo, fs.constants.O_WRONLY); } finally { fs.closeSync(reader); }
        } finally { fs.closeSync(probe); }
        return fd;
      } catch (error) {
        if (error.code !== 'ENXIO' || Date.now() > until) throw error;
        await wait(5);
      }
    }
  })();
  return {
    async write(buffer) {
      const out = await open();
      for (let offset = 0; offset < buffer.length;) offset += await fsWrite(out, buffer, offset);
    },
    async end() {
      if (closed) return;
      try { await open(); } catch { /* the encoder is gone; its own error explains why */ }
      closed = true;
      if (fd !== null) { try { fs.closeSync(fd); } catch { /* already closed */ } fd = null; }
    },
    close() {
      closed = true;
      if (fd !== null) { try { fs.closeSync(fd); } catch { /* already closed */ } fd = null; }
    },
  };
}

// Makes a private named pipe in `dir` (only this user can open it), or null when the
// system cannot (the caller then uses stdin).
function makeFifo(dir, name) {
  if (!fastPipes()) return null;
  const file = path.join(dir, name);
  try {
    require('child_process').execFileSync('/usr/bin/mkfifo', ['-m', '600', file], { stdio: 'ignore' });
    return file;
  } catch { return null; }
}

module.exports = { spawnDecoder, fifoWriter, makeFifo };
