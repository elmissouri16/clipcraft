// Audio-suite sync: the inspector's preset table must match the export engine's copy,
// and every preset must produce the filters its name promises through the real chain builder.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { AUDIO_PRESETS, normalizeAudioFx, activePreset } from '../src/fx/audioPresets.js';

const require = createRequire(import.meta.url);
const { AUDIO_FX_PRESETS, audioFxFilters } = require('../electron/audiofx.cjs');

assert.deepEqual(
  AUDIO_PRESETS.map((p) => ({ id: p.id, name: p.name, fx: normalizeAudioFx(p.fx) })),
  AUDIO_FX_PRESETS.map((p) => ({ id: p.id, name: p.name, fx: normalizeAudioFx(p.fx) })),
  'renderer presets mirror the engine presets',
);
for (const p of AUDIO_PRESETS) {
  assert.ok(audioFxFilters(p.fx).length >= 3, `${p.name} drives at least three real filters`);
  assert.equal(activePreset(p.fx)?.id, p.id, `${p.name} detects itself as the active preset`);
}
assert.equal(activePreset(null), null);
assert.equal(activePreset({ comp: true }), null, 'a lone compressor is not a preset');
console.log('audio-presets ok (mirror in sync, presets drive real filters)');
