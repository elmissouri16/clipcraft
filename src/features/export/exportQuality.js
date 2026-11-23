// Export quality: presets, Custom settings, and the ONE resolver that turns the stored settings
// (project.exportSettings) into the EFFECTIVE configuration the export pipeline consumes.
// Project Settings, the Export dialog summary and electron/media/ffmpeg.cjs all read this same resolved
// object (the renderer stamps it onto the project as project.export before exportRun), so what the
// summary shows is exactly what the encoder gets — never display-only text.
//
// Rules (stated, not hidden):
// - Resolution caps apply to the LONGEST side and only ever downscale — nothing is ever upscaled.
// - H.265 uses capability-tested Apple hardware where available, otherwise libx265.
//   If neither is available the summary states the H.264 fallback.
// - Choosing an fps above the timeline's duplicates frames (the fps filter resamples) — noted.
// - project.crf stays in sync for back-compat: picking a preset (or a Custom CRF) writes its CRF.
import { t } from '../../i18n/index.js';
import exportFormats from 'clipcraft/internal/export-formats';
export const {VIDEO_FORMATS}=exportFormats;

// name and blurb are display text (the language is settled before this module evaluates).
export const EXPORT_PRESETS = {
  low: { name: t('export.preset_low'), mode: 'crf', crf: 28, bitrateMbps: 0, encoderPreset: 'fast', audioKbps: 96, resCap: 720, fps: 0, codec: 'h264', blurb: t('export.smallest_file') },
  medium: { name: t('export.preset_medium'), mode: 'crf', crf: 23, bitrateMbps: 0, encoderPreset: 'medium', audioKbps: 128, resCap: 1080, fps: 0, codec: 'h264', blurb: t('export.balanced') },
  high: { name: t('export.preset_high'), mode: 'crf', crf: 18, bitrateMbps: 0, encoderPreset: 'slow', audioKbps: 192, resCap: 0, fps: 0, codec: 'h264', blurb: t('export.full_quality') },
  ultra: { name: t('export.preset_ultra'), mode: 'crf', crf: 14, bitrateMbps: 0, encoderPreset: 'veryslow', audioKbps: 320, resCap: 0, fps: 0, codec: 'h264', blurb: t('export.near_lossless') },
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
  const format=Object.hasOwn(VIDEO_FORMATS,s?.format)?s.format:'mp4';
  if (s && EXPORT_PRESET_ORDER.includes(s.preset)) {
    return { format, preset: s.preset, custom: { ...CUSTOM_DEFAULTS, ...(s.custom || {}) }, ...(s.preset === 'custom' && validPluginPreset(s.pluginPreset) ? { pluginPreset: { ...s.pluginPreset } } : {}) };
  }
  const crf = (project && project.crf) || 20;
  const preset = crf >= 26 ? 'low' : crf >= 21 ? 'medium' : crf >= 17 ? 'high' : 'ultra';
  return { format, preset, custom: { ...CUSTOM_DEFAULTS, crf } };
}

// Provenance is display-only. The settings snapshot is always the encoder's authority.
function validPluginPreset(p) {
  return p && typeof p === 'object' && ['pluginId','contributionId','version','digest','name'].every(k => typeof p[k] === 'string' && p[k].length > 0 && p[k].length <= 200);
}
export function pluginPresetPatch(project, preset) {
  return settingsPatch(project, { preset:'custom', custom:{...preset.settings}, pluginPreset:{
    pluginId:preset.pluginId, contributionId:preset.contributionId, version:preset.version, digest:preset.digest, name:preset.name,
  } });
}

// Stored-settings patch for picking a preset / editing Custom, keeping project.crf in sync.
export function settingsPatch(project, next) {
  const stored = { format:next.format??storedExportSettings(project).format, preset: next.preset, custom: { ...CUSTOM_DEFAULTS, ...(next.custom || {}) } };
  exportFormats.videoFormat(stored.format);
  if (next.preset === 'custom' && validPluginPreset(next.pluginPreset)) stored.pluginPreset = { ...next.pluginPreset };
  const patch = { exportSettings: stored };
  const eff = stored.preset === 'custom' ? stored.custom : EXPORT_PRESETS[stored.preset];
  if (eff && eff.mode === 'crf') patch.crf = eff.crf;
  return patch;
}

// Resolve stored settings + project geometry + build capabilities into the effective export config.
// caps: { libx265 } — whether the bundled FFmpeg has libx265 (from the main process; default true).
export function resolveExport(project, caps = {}) {
  const libx265 = caps.libx265 !== false, hardware = caps.h265Hardware === true;
  const stored = storedExportSettings(project);
  const raw = stored.preset === 'custom' ? stored.custom : EXPORT_PRESETS[stored.preset];
  const format=exportFormats.videoFormat(stored.format);
  let codecFamily=format.codecs.includes(raw.codec)?raw.codec:format.codecs[0];
  const available=codecFamily!=='vp9'||caps.vp9!==false;
  const mode = raw.mode === 'bitrate' ? 'bitrate' : 'crf';
  const crf = clamp(Math.round(raw.crf ?? 20), 0, codecFamily==='vp9'?63:51);
  const bitrateMbps = clamp(Number(raw.bitrateMbps) || 12, 0.5, 100);
  const encoderPreset = ENCODER_PRESETS.includes(raw.encoderPreset) ? raw.encoderPreset : 'veryfast';
  const audioKbps = AUDIO_RATES.includes(raw.audioKbps) ? raw.audioKbps : snap(raw.audioKbps || 192, AUDIO_RATES);
  const resCap = RES_CAPS.includes(raw.resCap) ? raw.resCap : 0;
  const fpsChoice = FPS_CHOICES.includes(raw.fps) ? raw.fps : 0;

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
  if(!available)notes.push(t('export.vp9_unavailable'));
  if (codecFamily === 'h265' && !libx265 && !hardware) {
    codecFamily = 'h264';
    notes.push(t('export.h265_not_available_h264_instead'));
  } else if (codecFamily === 'h265') {
    notes.push(hardware ? t(libx265 ? 'export.h265_apple_hardware_encoding' : 'export.h265_apple_hardware_only') : t('export.h265_software_libx265'));
  }
  if (resCap && longest <= resCap) notes.push(t('export.project_under_cap', { width: W, height: H, cap: resCap }));
  if (!resCap && stored.preset === 'ultra') notes.push(t('export.ultra_never_upscales', { width: W, height: H }));
  if (fpsChoice && fpsChoice > (project.fps || 30)) notes.push(t('export.frames_duplicated_to_reach_fps', { fps: project.fps, target: fpsChoice }));

  return {
    preset: stored.preset,
    presetName: stored.preset === 'custom' ? stored.pluginPreset?.name || t('curve-editor.custom') : EXPORT_PRESETS[stored.preset].name,
    format:format.id,
    formatLabel:format.name,
    extension:format.extension,
    available,
    audioCodec:format.audioCodec==='libopus'?'opus':'aac',
    codecFamily,
    codecLabel: codecFamily==='vp9'?'VP9':codecFamily === 'h265' ? hardware ? 'H.265 · VideoToolbox' : 'H.265 · libx265' : 'H.264',
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
    [t('home.format'),eff.formatLabel||'MP4'],
    [t('export.preset'), eff.presetName],
    [t('export.codec'), eff.codecLabel],
    [t('export.resolution'), eff.outW === project.width && eff.outH === project.height
      ? t('export.size_project_size', { width: eff.outW, height: eff.outH })
      : t('export.size_scaled_from', { width: eff.outW, height: eff.outH, fromWidth: project.width, fromHeight: project.height })],
    [t('home.frame_rate'), eff.fpsChoice ? t('export.fps_from', { fps: eff.outFps, from: project.fps }) : t('export.fps_project', { fps: eff.outFps })],
    [t('export.quality'), eff.mode === 'crf' ? `CRF ${eff.crf}` : t('export.target_bitrate_mbps', { mbps: eff.bitrateMbps })],
    [t('inspector.encoder_preset'), eff.encoderPreset],
    [t('edit-plan-card.audio'), `${eff.audioCodec==='opus'?'Opus':'AAC'} ${eff.audioKbps} kbps`],
  ];
  return rows;
}
