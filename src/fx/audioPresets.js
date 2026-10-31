// One-click audio "essentials" presets for the inspector. This table MIRRORS
// AUDIO_FX_PRESETS in electron/audiofx.cjs (the export engine's copy) — a suite
// (scripts/test-audio-presets.mjs) keeps the two identical. A preset is a COMPLETE
// audioFx object: applying it replaces the clip's audioFx wholesale.
export const AUDIO_PRESETS = [
  { id: 'clear-voice', name: 'Clear Voice', fx: { eq: { low: -3, mid: 2, high: 3 }, highpass: 80, lowpass: 0, comp: true, limit: false, denoise: true, loudnorm: true, echo: null, pitch: 0 } },
  { id: 'podcast', name: 'Podcast', fx: { eq: { low: 2, mid: 1, high: -1 }, highpass: 60, lowpass: 0, comp: true, limit: true, denoise: false, loudnorm: true, echo: null, pitch: 0 } },
  { id: 'warm', name: 'Warm', fx: { eq: { low: 4, mid: 0, high: -3 }, highpass: 0, lowpass: 12000, comp: false, limit: false, denoise: false, loudnorm: false, echo: null, pitch: 0 } },
  { id: 'bright', name: 'Bright', fx: { eq: { low: -2, mid: 1, high: 5 }, highpass: 40, lowpass: 0, comp: false, limit: false, denoise: false, loudnorm: false, echo: null, pitch: 0 } },
];

const DEFAULTS = {
  eq: { low: 0, mid: 0, high: 0 }, highpass: 0, lowpass: 0,
  comp: false, limit: false, denoise: false, loudnorm: false, echo: null, pitch: 0,
};

// Fill every field so a stored partial audioFx can be compared to a preset.
export function normalizeAudioFx(fx) {
  const f = fx || {};
  return {
    eq: { ...DEFAULTS.eq, ...(f.eq || {}) },
    highpass: f.highpass || 0,
    lowpass: f.lowpass || 0,
    comp: !!f.comp,
    limit: !!f.limit,
    denoise: !!f.denoise,
    loudnorm: !!f.loudnorm,
    echo: f.echo ? { delay: f.echo.delay ?? 180, decay: f.echo.decay ?? 0.3 } : null,
    pitch: f.pitch || 0,
  };
}

export const audioFxEquals = (a, b) => JSON.stringify(normalizeAudioFx(a)) === JSON.stringify(normalizeAudioFx(b));

// The preset matching the clip's current settings, if any (drives the active chip).
export function activePreset(fx) {
  return AUDIO_PRESETS.find((p) => audioFxEquals(fx, p.fx)) || null;
}
