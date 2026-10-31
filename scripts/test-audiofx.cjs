// Audio FX: each ffmpeg filter chain renders a generated 440 Hz tone to valid, non-silent output.
const assert = require('assert/strict');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
// Prefer the bundled ffmpeg-static binary; fall back to a system ffmpeg on dev machines
// where the package's postinstall download never ran. The filter strings under test are identical.
const staticPath = require('ffmpeg-static');
const ffmpeg = staticPath && fs.existsSync(staticPath) ? staticPath : 'ffmpeg';
const { audioFxFilters, hasAudioFx, AUDIO_FX_PRESETS } = require('../electron/audiofx.cjs');

assert.deepEqual(audioFxFilters(null), []);
assert.deepEqual(audioFxFilters({}), []);
assert.deepEqual(audioFxFilters({ eq: { low: 0, mid: 0, high: 0 }, pitch: 0 }), [], 'zeroed fx produce no filters');
assert.ok(hasAudioFx({ comp: true }));

// The new essentials: high-pass, low-pass and loudness normalize render the exact filters.
assert.deepEqual(audioFxFilters({ highpass: 80 }), ['highpass=f=80']);
assert.deepEqual(audioFxFilters({ highpass: 10 }), [], 'a sub-20 Hz high-pass is off, not a filter');
assert.deepEqual(audioFxFilters({ lowpass: 12000 }), ['lowpass=f=12000']);
assert.deepEqual(audioFxFilters({ lowpass: 20000 }), [], 'a 20 kHz low-pass is off, not a filter');
assert.deepEqual(audioFxFilters({ loudnorm: true }), ['loudnorm=I=-14:TP=-1:LRA=11', 'aresample=48000']);
assert.deepEqual(audioFxFilters({ highpass: 5000 }), ['highpass=f=1000'], 'high-pass clamps at 1 kHz');

// Presets: complete fx objects whose chains carry their signature filters.
assert.deepEqual(AUDIO_FX_PRESETS.map((p) => p.name), ['Clear Voice', 'Podcast', 'Warm', 'Bright']);
const byId = Object.fromEntries(AUDIO_FX_PRESETS.map((p) => [p.id, p]));
const cv = audioFxFilters(byId['clear-voice'].fx).join(',');
assert.ok(cv.includes('highpass=f=80') && cv.includes('loudnorm=I=-14') && cv.includes('afftdn'), `Clear Voice chain: ${cv}`);
const pod = audioFxFilters(byId.podcast.fx).join(',');
assert.ok(pod.includes('acompressor') && pod.includes('alimiter') && pod.includes('loudnorm=I=-14'), `Podcast chain: ${pod}`);
const warm = audioFxFilters(byId.warm.fx).join(',');
assert.ok(warm.includes('lowpass=f=12000') && !warm.includes('loudnorm'), `Warm chain: ${warm}`);
const bright = audioFxFilters(byId.bright.fx).join(',');
assert.ok(bright.includes('equalizer=f=8000:width_type=o:width=2:g=5') && bright.includes('highpass=f=40'), `Bright chain: ${bright}`);

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'afx-'));
const tone = path.join(dir, 'tone.wav');
execFileSync(ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-ar', '48000', tone]);

const cases = {
  eq: { eq: { low: 6, mid: -4, high: 8 } },
  compressor: { comp: true },
  limiter: { limit: true },
  denoise: { denoise: true },
  echo: { echo: { delay: 150, decay: 0.4 } },
  pitchUp: { pitch: 4 },
  pitchDown: { pitch: -6 },
  highpass: { highpass: 120 },
  lowpass: { lowpass: 6000 },
  loudnorm: { loudnorm: true },
  presetClearVoice: byId['clear-voice'].fx,
  presetPodcast: byId.podcast.fx,
  everything: { eq: { low: 3, mid: 2, high: 3 }, comp: true, limit: true, denoise: true, echo: { delay: 120, decay: 0.25 }, pitch: 2 },
};
for (const [name, fx] of Object.entries(cases)) {
  const chain = audioFxFilters(fx).join(',');
  assert.ok(chain.length > 0, `${name} produced filters`);
  const out = path.join(dir, `${name}.wav`);
  execFileSync(ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error', '-i', tone, '-af', chain, '-ar', '48000', out]);
  assert.ok(fs.statSync(out).size > 1000, `${name} wrote a real file`);
  console.log(`  ${name}: ${chain.slice(0, 90)}${chain.length > 90 ? '…' : ''}`);
}
// Non-silence check via volumedetect stderr for the combined chain.
const { spawnSync } = require('child_process');
const probe = spawnSync(ffmpeg, ['-i', path.join(dir, 'everything.wav'), '-af', 'volumedetect', '-f', 'null', '-'], { encoding: 'utf8' });
const mean = /mean_volume:\s*(-?[\d.]+) dB/.exec(probe.stderr || '');
assert.ok(mean, 'volumedetect reported a mean volume');
assert.ok(Number(mean[1]) > -50, `combined chain is not silent (mean ${mean[1]} dB)`);
console.log(`audiofx OK: ${Object.keys(cases).length} chains rendered, combined mean_volume ${mean[1]} dB`);
