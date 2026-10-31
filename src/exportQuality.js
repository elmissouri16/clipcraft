// Export quality: presets, Custom settings, and the ONE resolver that turns the stored settings
// (project.exportSettings) into the EFFECTIVE configuration the export pipeline consumes.
// Project Settings, the Export dialog summary and electron/ffmpeg.cjs all read this same resolved
// object (the renderer stamps it onto the project as project.export before exportRun), so what the
// summary shows is exactly what the encoder gets — never display-only text.
//
// Rules (stated, not hidden):
// - Resolution caps apply to the LONGEST side and only ever downscale — nothing is ever upscaled.
// - H.265 always encodes in software (libx265) in this build; if the bundled FFmpeg lacked libx265,
//   the export falls back to H.264 and the summary says so (caps.libx265 comes from the main process).
// - Choosing an fps above the timeline's duplicates frames (the fps filter resamples) — noted.
// - project.crf stays in sync for back-compat: picking a preset (or a Custom CRF) writes its CRF.

export const EXPORT_PRESETS = {
  low: { name: 'Low', mode: 'crf', crf: 28, bitrateMbps: 0, encoderPreset: 'fast', audioKbps: 96, resCap: 720, fps: 0, codec: 'h264', blurb: 'Smallest file' },
  medium: { name: 'Medium', mode: 'crf', crf: 23, bitrateMbps: 0, encoderPreset: 'medium', audioKbps: 128, resCap: 1080, fps: 0, codec: 'h264', blurb: 'Balanced' },
  high: { name: 'High', mode: 'crf', crf: 18, bitrateMbps: 0, encoderPreset: 'slow', audioKbps: 192, resCap: 0, fps: 0, codec: 'h264', blurb: 'Full quality' },
  ultra: { name: 'Ultra', mode: 'crf', crf: 14, bitrateMbps: 0, encoderPreset: 'veryslow', audioKbps: 320, resCap: 0, fps: 0, codec: 'h264', blurb: 'Near-lossless' },
};
export const EXPORT_PRESET_ORDER = ['low', 'medium', 'high', 'ultra', 'custom'];
export const CUSTOM_DEFAULTS = { mode: 'crf', crf: 20, bitrateMbps: 12, resCap: 0, fps: 0, codec: 'h264', encoderPreset: 'veryfast', audioKbps: 192 };
export const ENCODER_PRESETS = ['ultrafast', 'superfast', 'veryfast', 'faster', 'fast', 'medium', 'slow', 'slower', 'veryslow'];
export const RES_CAPS = [0, 2160, 1440, 1080, 720, 480]; // 0 = Original (project size)
export const FPS_CHOICES = [0, 24, 25, 30, 50, 60]; // 0 = project fps
export const AUDIO_RATES = [96, 128, 192, 256, 320];

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const snap = (v, list) => list.reduce((best, x) => (Math.abs(x - v) < Math.abs(best - v) ? x : best), list[0]);

// The stored settings for a project, migrating the pre-preset era (a bare project.crf) to the
// closest preset by CRF: 28 Light → Low, 23 Standard → Medium, 20 High → High, 16 Very high → Ultra.
export function storedExportSettings(project) {
  const s = project && project.exportSettings;
  if (s && EXPORT_PRESET_ORDER.includes(s.preset)) {
    return { preset: s.preset, custom: { ...CUSTOM_DEFAULTS, ...(s.custom || {}) } };
  }
  const crf = (project && project.crf) || 20;
  const preset = crf >= 26 ? 'low' : crf >= 21 ? 'medium' : crf >= 17 ? 'high' : 'ultra';
  return { preset, custom: { ...CUSTOM_DEFAULTS, crf } };
}

// Stored-settings patch for picking a preset / editing Custom, keeping project.crf in sync.
export function settingsPatch(project, next) {
  const stored = { preset: next.preset, custom: { ...CUSTOM_DEFAULTS, ...(next.custom || {}) } };
  const patch = { exportSettings: stored };
  const eff = stored.preset === 'custom' ? stored.custom : EXPORT_PRESETS[stored.preset];
  if (eff && eff.mode === 'crf') patch.crf = eff.crf;
  return patch;
}

// Resolve stored settings + project geometry + build capabilities into the effective export config.
// caps: { libx265 } — whether the bundled FFmpeg has libx265 (from the main process; default true).
export function resolveExport(project, caps = {}) {
  const libx265 = caps.libx265 !== false;
  const stored = storedExportSettings(project);
  const raw = stored.preset === 'custom' ? stored.custom : EXPORT_PRESETS[stored.preset];
  const mode = raw.mode === 'bitrate' ? 'bitrate' : 'crf';
  const crf = clamp(Math.round(raw.crf ?? 20), 0, 51);
  const bitrateMbps = clamp(Number(raw.bitrateMbps) || 12, 0.5, 100);
  const encoderPreset = ENCODER_PRESETS.includes(raw.encoderPreset) ? raw.encoderPreset : 'veryfast';
  const audioKbps = AUDIO_RATES.includes(raw.audioKbps) ? raw.audioKbps : snap(raw.audioKbps || 192, AUDIO_RATES);
  const resCap = RES_CAPS.includes(raw.resCap) ? raw.resCap : 0;
  const fpsChoice = FPS_CHOICES.includes(raw.fps) ? raw.fps : 0;
  let codecFamily = raw.codec === 'h265' ? 'h265' : 'h264';

  const W = project.width || 1280;
  const H = project.height || 720;
  const longest = Math.max(W, H);
  let outW = W;
  let outH = H;
  if (resCap && longest > resCap) {
    const k = resCap / longest;
    outW = Math.max(2, Math.round((W * k) / 2) * 2);
    outH = Math.max(2, Math.round((H * k) / 2) * 2);
  }
  const outFps = fpsChoice || project.fps || 30;

  const notes = [];
  if (codecFamily === 'h265' && !libx265) {
    codecFamily = 'h264';
    notes.push('H.265 (libx265) is not available in this build — exporting H.264 instead.');
  } else if (codecFamily === 'h265') {
    notes.push('H.265 encodes in software (libx265) in this build.');
  }
  if (resCap && longest <= resCap) notes.push(`Project is ${W}×${H} — under the ${resCap} cap, so it exports at project size (never upscaled).`);
  if (!resCap && stored.preset === 'ultra') notes.push(`Exports at the project's full ${W}×${H} — Ultra never upscales.`);
  if (fpsChoice && fpsChoice > (project.fps || 30)) notes.push(`Timeline is ${project.fps} fps — frames are duplicated to reach ${fpsChoice} fps (no new motion).`);

  return {
    preset: stored.preset,
    presetName: stored.preset === 'custom' ? 'Custom' : EXPORT_PRESETS[stored.preset].name,
    codecFamily,
    codecLabel: codecFamily === 'h265' ? 'H.265 · libx265' : 'H.264',
    mode,
    crf: mode === 'crf' ? crf : null,
    bitrateMbps: mode === 'bitrate' ? bitrateMbps : null,
    encoderPreset,
    audioKbps,
    resCap,
    fpsChoice,
    outW,
    outH,
    outFps,
    notes,
  };
}

// Estimated output size for the resolved configuration. Bitrate mode is exact arithmetic from the
// settings (video bitrate + audio bitrate over the duration). CRF mode is a heuristic: libx264's
// output is modelled at bits-per-pixel bpp(crf) = 0.22 · 2^(−(crf−18)/5.5), calibrated so a 1080p30
// High (CRF 18) project estimates ≈ 13.7 Mbps — mid-range for typical footage. Real CRF output is
// content-dependent, so the UI always labels CRF-mode numbers as estimates.
export function estimateExport(eff, durationSec) {
  const dur = Math.max(0, Number(durationSec) || 0);
  const audioMB = (eff.audioKbps * 1000 * dur) / 8 / 1e6;
  if (eff.mode === 'bitrate') {
    return { mb: (eff.bitrateMbps * 1e6 * dur) / 8 / 1e6 + audioMB, videoMbps: eff.bitrateMbps, exact: true };
  }
  const bpp = 0.22 * Math.pow(2, -(eff.crf - 18) / 5.5);
  const videoMbps = (eff.outW * eff.outH * eff.outFps * bpp) / 1e6;
  return { mb: (videoMbps * 1e6 * dur) / 8 / 1e6 + audioMB, videoMbps, exact: false };
}

// The pre-export summary rows, rendered by the Export dialog from the resolved object.
export function summaryRows(eff, project) {
  const rows = [
    ['Preset', eff.presetName],
    ['Codec', eff.codecLabel],
    ['Resolution', eff.outW === project.width && eff.outH === project.height
      ? `${eff.outW}×${eff.outH} (project size)`
      : `${eff.outW}×${eff.outH} (scaled from ${project.width}×${project.height})`],
    ['Frame rate', eff.fpsChoice ? `${eff.outFps} fps (from ${project.fps})` : `${eff.outFps} fps (project)`],
    ['Quality', eff.mode === 'crf' ? `CRF ${eff.crf}` : `Target bitrate ${eff.bitrateMbps} Mbps`],
    ['Encoder preset', eff.encoderPreset],
    ['Audio', `AAC ${eff.audioKbps} kbps`],
  ];
  return rows;
}
