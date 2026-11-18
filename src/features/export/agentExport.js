import { renderable, exportDuration, cutRanges } from '../../state/store.js';
import { EXPORT_PRESETS, ENCODER_PRESETS, RES_CAPS, FPS_CHOICES, AUDIO_RATES, settingsPatch, storedExportSettings, resolveExport } from './exportQuality.js';

// Export settings affect only this snapshot. Asking for a render never silently
// edits the document or changes the user's saved export preferences.
export function agentExportPlan(project, options = {}, caps = {}) {
  let p = renderable(project);
  if (!(exportDuration(p) > 0)) throw Error('The timeline is empty.');
  if (options.review || options.range) {
    const from = options.range?.start_sec ?? options.start_sec, to = options.range?.end_sec ?? options.end_sec, total = exportDuration(p);
    if (![from, to].every(Number.isFinite) || from < 0 || to > total + 1e-6 || to <= from || options.review && to - from > 30) throw Error(options.review ? 'Review a valid timeline section of at most 30 seconds.' : 'Choose an export range inside the timeline.');
    // This is an ephemeral render snapshot; retain lock/visibility state in the
    // document while allowing a pure slice of its locked source content.
    p = { ...p, layerState: Object.fromEntries(Object.entries(p.layerState || {}).map(([key, state]) => [key, { ...state, locked: false }])), posterAt: undefined };
    if (to < total) p = cutRanges(p, [{ start: to, end: total }], { ripple: true });
    if (from > 0) p = cutRanges(p, [{ start: 0, end: from }], { ripple: true });
    if (Math.abs(exportDuration(p) - (to - from)) > 1 / (p.fps || 30) + .001) throw Error('The requested section could not be represented exactly. Choose boundaries outside a transition.');
  }
  if (options.quality !== undefined && !Object.hasOwn(EXPORT_PRESETS, options.quality)) throw Error('quality must be low, medium, high or ultra.');
  let settings = options.quality ? { preset: options.quality } : storedExportSettings(p);
  const custom = { ...(settings.preset === 'custom' ? settings.custom : EXPORT_PRESETS[settings.preset]) };
  let changed = false;
  for (const [input, output, allowed] of [['codec', 'codec', ['h264', 'h265']], ['resolution', 'resCap', RES_CAPS], ['fps', 'fps', FPS_CHOICES], ['audio_kbps', 'audioKbps', AUDIO_RATES], ['encoder_preset', 'encoderPreset', ENCODER_PRESETS]]) if (options[input] !== undefined) {
    if (!allowed.includes(options[input])) throw Error(`Invalid export ${input}.`);custom[output] = options[input];changed = true;
  }
  if (options.crf !== undefined) {
    if (!Number.isInteger(options.crf) || options.crf < 0 || options.crf > 51) throw Error('crf must be an integer from 0 to 51.');
    custom.crf = options.crf;custom.mode = 'crf';changed = true;
  }
  if(options.bitrate_mbps!==undefined){
    if(!Number.isFinite(options.bitrate_mbps)||options.bitrate_mbps<.5||options.bitrate_mbps>100||options.crf!==undefined)throw Error('Choose bitrate_mbps from 0.5 to 100, or crf, separately.');
    custom.bitrateMbps=options.bitrate_mbps;custom.mode='bitrate';changed=true;
  }
  if (changed) settings = { preset: 'custom', custom };
  p = { ...p, ...settingsPatch(p, settings) };
  return { project: p, effective: resolveExport(p, caps) };
}
