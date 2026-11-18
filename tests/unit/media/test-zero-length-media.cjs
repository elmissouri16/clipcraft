// A container without a duration (a browser-recorded WebM, an interrupted MKV) must probe with its
// real length, a file with no readable length must be refused, and no export or analysis graph may
// carry a 0-long clip: FFmpeg reads trim/atrim duration=0 as "no limit", which spliced a whole file
// into a video export and made the audio renders run until the disk was full.
// Usage: node tests/unit/media/test-zero-length-media.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawn } = require('node:child_process');
const ff = require('../../../electron/media/ffmpeg.cjs');

// Runs FFmpeg with a watchdog: a graph without an end is killed and reported, never left filling the disk.
const run = (args, out, limitMs = 20000) => new Promise((resolve) => {
  const p = spawn(ff.ffmpegPath, args, { windowsHide: true });
  let err = '';
  p.stderr.on('data', (d) => { err = (err + d).slice(-2000); });
  const timer = setTimeout(() => p.kill('SIGKILL'), limitMs);
  p.on('close', (code, signal) => { clearTimeout(timer); resolve({ code, signal, err, size: fs.existsSync(out) ? fs.statSync(out).size : 0 }); });
});

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clipcraft-zero-length-'));
  try {
    // Written to a pipe, the WebM muxer cannot go back to store the duration.
    const webm = path.join(dir, 'nodur.webm');
    fs.writeFileSync(webm, execFileSync(ff.ffmpegPath, ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=64x48:r=10:d=2', '-f', 'lavfi', '-i', 'sine=d=2',
      '-c:v', 'libvpx', '-c:a', 'libopus', '-f', 'webm', 'pipe:1'], { maxBuffer: 64 << 20 }));
    const header = JSON.parse(execFileSync(ff.ffprobePath, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', webm]).toString());
    assert.equal(header.format.duration, undefined, 'the fixture has no container duration');
    const w = await ff.probe(webm);
    assert.equal(w.type, 'video');
    assert.ok(Math.abs(w.duration - 2) < 0.1, `the length is read from the packets (${w.duration})`);
    // Only the header (no frame at all): refused with a plain message.
    const headerOnly = path.join(dir, 'header-only.webm');
    fs.writeFileSync(headerOnly, fs.readFileSync(webm).subarray(0, 600));
    await assert.rejects(ff.probe(headerOnly), /no readable length/);

    // Backstop: a project saved before the fix still holds a 0-long clip of such a file.
    const mp4 = path.join(dir, 'a.mp4');
    execFileSync(ff.ffmpegPath, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=blue:s=64x48:r=10:d=2', '-f', 'lavfi', '-i', 'sine=d=2', '-pix_fmt', 'yuv420p', '-shortest', mp4]);
    const a = { id: 'A', path: mp4, ...(await ff.probe(mp4)) };
    const z = { id: 'W', path: webm, ...w, duration: 0 };
    const clip = (id, m, extra = {}) => ({ id, mediaId: m.id, in: 0, out: m === z ? 0 : m.duration, speed: 1, volume: 1, muted: false, filter: 'none', adjust: {}, effects: [], transition: null, ...extra });
    const project = { width: 64, height: 48, fps: 10, media: [a, z],
      videoClips: [clip('c1', a), clip('c2', z, { transition: { type: 'fade', duration: 0.5 } }), clip('c3', a, { transition: { type: 'fade', duration: 0.5 } })],
      overlayClips: [clip('o1', z, { start: 1 })], audioClips: [clip('m1', z, { start: 0.5 })], textClips: [] };
    const expected = 4; // two 2 s clips; the clip after the 0-long one keeps the plain cut the timeline showed
    const unbounded = /(?:^|[,=:\]])(?:trim|atrim)=duration=0\.000|whole_dur=0\.000|atrim=start=0:end=0\.000/;
    const graph = (args) => args[args.indexOf('-filter_complex') + 1];
    const tOf = (args) => Number(args[args.indexOf('-t') + 1]);

    const video = ff.buildExportArgs(project, path.join(dir, 'out.mp4'), { encoder: 'libx264' });
    assert.ok(!unbounded.test(graph(video.args)), 'the video graph has no unbounded trim');
    assert.ok(!/xfade/.test(graph(video.args)), 'no transition across the dropped clip');
    assert.equal(video.total, expected);
    const audioArgs = ff.buildAudioExportArgs(project, path.join(dir, 'out.wav'), 'wav');
    assert.ok(!unbounded.test(graph(audioArgs)), 'the audio export graph has no unbounded trim');
    assert.equal(tOf(audioArgs), expected, 'the audio export is cut to the timeline');
    const analysisArgs = ff.buildTimelineAudioArgs(project, path.join(dir, 'analysis.wav'), 'all');
    assert.ok(!unbounded.test(graph(analysisArgs)), 'the analysis graph has no unbounded trim');
    assert.equal(tOf(analysisArgs), expected, 'the analysis render is cut to the timeline');
    assert.deepEqual(ff.audibleIntervals(project, 'all'), [{ start: 0, end: expected }]);

    for (const [name, args, out] of [['video export', video.args, path.join(dir, 'out.mp4')], ['audio export', audioArgs, path.join(dir, 'out.wav')], ['analysis render', analysisArgs, path.join(dir, 'analysis.wav')]]) {
      const r = await run(args, out);
      assert.equal(r.signal, null, `${name} ended by itself (killed at ${r.size} bytes)`);
      assert.equal(r.code, 0, `${name}: ${r.err}`);
      const got = (await ff.probe(out)).duration;
      assert.ok(Math.abs(got - expected) < 0.15, `${name} lasts the timeline (${got} s)`);
    }
    // The video export keeps the third clip (blue) after the first instead of the whole WebM.
    const px = execFileSync(ff.ffmpegPath, ['-v', 'error', '-ss', '3', '-i', path.join(dir, 'out.mp4'), '-frames:v', '1', '-vf', 'scale=1:1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1']);
    assert.ok(px[2] > 150 && px[0] < 80, `the third clip follows the first (rgb ${[...px].join(',')})`);
    console.log('ZERO-LENGTH MEDIA OK');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch((e) => { console.error(e.stack || e.message); process.exit(1); });
