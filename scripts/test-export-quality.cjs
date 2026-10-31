// Export quality battery: the same short project exported at Low / Medium / High / Ultra + a Custom
// (bitrate mode, 720 longest-side cap) + a Custom H.265, all through the REAL export path
// (runExport), with the effective settings resolved by src/exportQuality.js — the same resolver the
// UI and the Export dialog summary use. Asserts, from ffprobe + PSNR measurements:
//   - file sizes strictly increase Low < Medium < High < Ultra
//   - PSNR vs the source increases with the preset tier
//   - Custom output's longest side <= 720 and its video bitrate is within ±25% of the 8 Mbps target
//   - Ultra's resolution == the project resolution (never upscales)
//   - the H.265 export really is HEVC
// Also pins the argument-level contract: an unstamped (legacy) project keeps the historical encoder
// args, and each preset stamps a distinct parameter set.
// Usage: node scripts/test-export-quality.cjs
process.env.FVE_ENCODER = 'libx264'; // deterministic software encoding for measurements
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const { ffmpegPath, ffprobePath, probe, runExport, buildExportArgs } = require('../electron/ffmpeg.cjs');

const W = 1280;
const H = 720;
const DUR = 5;
let failures = 0;
const check = (ok, msg) => { console.log(`${ok ? '  ok' : '  FAIL'}  ${msg}`); if (!ok) failures++; };

function probeFull(file) {
  const out = execFileSync(ffprobePath, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file]).toString();
  const j = JSON.parse(out);
  const v = j.streams.find((s) => s.codec_type === 'video');
  const a = j.streams.find((s) => s.codec_type === 'audio');
  return { codec: v.codec_name, width: v.width, height: v.height, vBitrate: Number(v.bit_rate || 0), aBitrate: a ? Number(a.bit_rate || 0) : 0, size: fs.statSync(file).size, duration: Number(j.format.duration) };
}

// PSNR of `file` against the source render; lower-resolution outputs are scaled back up first,
// which only ever hurts their score — the tier ordering must survive it.
function psnrVs(file, srcFile) {
  const r = spawnSync(ffmpegPath, ['-hide_banner', '-i', file, '-i', srcFile,
    '-filter_complex', `[0:v]scale=${W}:${H}:flags=lanczos[d];[d][1:v]psnr`, '-f', 'null', '-'],
    { maxBuffer: 16 * 1024 * 1024 });
  const err = (r.stderr || '').toString();
  const m = err.match(/average:([0-9.]+|inf)/);
  if (!m) throw new Error(`no PSNR line for ${file}: ${err.slice(-300)}`);
  return m[1] === 'inf' ? 99 : Number(m[1]);
}

(async () => {
  const { resolveExport } = await import('../src/exportQuality.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fve-eq-'));
  const gen = (args) => execFileSync(ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', ...args]);
  const src = path.join(dir, 'src.mp4');
  gen(['-f', 'lavfi', '-i', `testsrc2=size=${W}x${H}:rate=30:duration=${DUR}`, '-f', 'lavfi', '-i', `sine=frequency=440:duration=${DUR}`, '-shortest', '-c:v', 'libx264', '-crf', '10', src]);
  const info = await probe(src);
  const media = [{ id: 'm1', path: src, name: 'src.mp4', ...info }];
  const base = { volume: 1, muted: false, filter: 'none', adjust: {}, effects: [], transition: null, speed: 1 };
  const mkProject = (exportSettings) => ({
    name: 'eq', ratio: '16:9', resolution: 720, width: W, height: H, fps: 30, background: '#101010', media,
    videoClips: [{ ...base, id: 'c1', mediaId: 'm1', in: 0, out: DUR }],
    overlayClips: [], textClips: [], audioClips: [], stickerClips: [],
    ...(exportSettings ? { exportSettings } : {}),
  });

  // Argument-level contract.
  const legacy = buildExportArgs(mkProject(null), path.join(dir, 'x.mp4'), { encoder: 'libx264' }).args.join(' ');
  check(legacy.includes('-crf 20') && legacy.includes('-preset veryfast') && legacy.includes('-b:a 192k'), 'legacy unstamped project keeps CRF 20 / veryfast / AAC 192k');
  const effs = {};
  for (const p of ['low', 'medium', 'high', 'ultra']) {
    effs[p] = resolveExport(mkProject({ preset: p, custom: {} }), { libx265: true });
  }
  const sig = (e) => JSON.stringify([e.crf, e.encoderPreset, e.audioKbps, e.outW, e.outH]);
  check(new Set(Object.values(effs).map(sig)).size === 4, 'the four presets resolve to four distinct parameter sets');
  check(effs.ultra.outW === W && effs.ultra.outH === H, 'Ultra resolves to the full project size (no cap, no upscale)');
  check(effs.low.outW === 720 && effs.low.outH === 406, `Low caps the longest side to 720, height rounded to even (got ${effs.low.outW}×${effs.low.outH})`);

  // Real exports.
  const rows = [];
  const run = async (label, exportSettings) => {
    const project = mkProject(exportSettings);
    project.export = resolveExport(project, { libx265: true });
    const out = path.join(dir, `${label}.mp4`);
    const job = runExport(project, out, () => {});
    await job.promise;
    const p = probeFull(out);
    rows.push({ label, ...p });
    return p;
  };
  const low = await run('low', { preset: 'low', custom: {} });
  const medium = await run('medium', { preset: 'medium', custom: {} });
  const high = await run('high', { preset: 'high', custom: {} });
  const ultra = await run('ultra', { preset: 'ultra', custom: {} });
  const custom = await run('custom', { preset: 'custom', custom: { mode: 'bitrate', bitrateMbps: 8, resCap: 720, fps: 0, codec: 'h264', encoderPreset: 'veryfast', audioKbps: 128, crf: 20 } });
  const h265 = await run('h265', { preset: 'custom', custom: { mode: 'crf', crf: 28, bitrateMbps: 12, resCap: 0, fps: 0, codec: 'h265', encoderPreset: 'ultrafast', audioKbps: 96 } });

  for (const r of rows) r.psnr = psnrVs(path.join(dir, `${r.label}.mp4`), src);
  console.log('\n  preset   res        size        video kbps  audio kbps  PSNR dB');
  for (const r of rows) console.log(`  ${r.label.padEnd(8)} ${`${r.width}×${r.height}`.padEnd(10)} ${String(r.size).padEnd(11)} ${String(Math.round(r.vBitrate / 1000)).padEnd(11)} ${String(Math.round(r.aBitrate / 1000)).padEnd(11)} ${r.psnr.toFixed(2)}`);

  check(low.size < medium.size && medium.size < high.size && high.size < ultra.size,
    `sizes strictly increase Low<Medium<High<Ultra (${low.size} < ${medium.size} < ${high.size} < ${ultra.size})`);
  const [pl, pm, ph, pu] = [rows[0].psnr, rows[1].psnr, rows[2].psnr, rows[3].psnr];
  check(pl < pm && pm < ph && ph < pu, `PSNR increases with tier (${pl.toFixed(2)} < ${pm.toFixed(2)} < ${ph.toFixed(2)} < ${pu.toFixed(2)})`);
  check(ultra.width === W && ultra.height === H, 'Ultra output resolution == project resolution');
  check(Math.max(custom.width, custom.height) <= 720, `Custom longest side <= 720 (got ${custom.width}×${custom.height})`);
  const kbps = custom.vBitrate / 1000;
  check(Math.abs(kbps - 8000) <= 8000 * 0.25, `Custom video bitrate within ±25% of 8000 kbps (got ${Math.round(kbps)})`);
  check(h265.codec === 'hevc', `Custom H.265 export is HEVC (got ${h265.codec})`);
  // The wiring is pinned at the argument level; the stream measurement supports it (a pure sine
  // cannot fill a 320k AAC allocation — the encoder simply doesn't spend bits it doesn't need).
  const ultraArgs = (() => { const p = mkProject({ preset: 'ultra', custom: {} }); p.export = effs.ultra; return buildExportArgs(p, path.join(dir, 'x.mp4'), { encoder: 'libx264' }).args.join(' '); })();
  check(ultraArgs.includes('-b:a 320k') && ultraArgs.includes('-crf 14') && ultraArgs.includes('-preset veryslow'),
    'Ultra stamps CRF 14 / veryslow / AAC 320k into the encoder args');
  check(Math.abs(low.aBitrate / 1000 - 96) < 12 && ultra.aBitrate > high.aBitrate,
    `audio bitrates follow the presets (Low ${Math.round(low.aBitrate / 1000)}k, High ${Math.round(high.aBitrate / 1000)}k, Ultra ${Math.round(ultra.aBitrate / 1000)}k of 320k requested — sine source can't fill 320k)`);

  console.log(failures ? `\nEXPORT QUALITY: ${failures} FAILURE(S) — outputs in ${dir}` : `\nEXPORT QUALITY OK — outputs in ${dir}`);
  if (failures) process.exitCode = 1;
})().catch((e) => { console.error('EXPORT QUALITY ERROR:', e.message); process.exitCode = 1; });
