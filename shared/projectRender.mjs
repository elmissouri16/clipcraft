// Pure project rendering and main-track timing shared by the editor and shipped host.
// No renderer, Node or Electron dependencies. Keep the store exports as compatibility aliases.

export const newGap = (id, len) => ({ id, gap: true, in: 0, out: len, speed: 1 });

export const clipLen = (c) => (c.out - c.in) / (c.speed || 1);

export const layerOf = (c) => c.layer ?? 0;

export const LAYER_STATE_DEFAULTS = { locked: false, hidden: false, muted: false, solo: false };
export const layerKey = (track, layer) => `${track}:${layer}`;
export function layerStateOf(p, track, layer) {
  return { ...LAYER_STATE_DEFAULTS, ...((p.layerState || {})[layerKey(track, layer)] || {}) };
}
export const isLayerLocked = (p, track, layer) => layerStateOf(p, track, layer).locked;
export const AUDIO_LANES = { video: true, overlay: true, audio: true };

// True when any audio-capable layer is soloed (solo then decides what sounds at all).
export function anySolo(p) {
  const ls = p.layerState || {};
  return Object.entries(ls).some(([k, s]) => s && s.solo && AUDIO_LANES[k.split(':')[0]]);
}
// Does this layer's sound reach the mix? Mute silences it; once anything is soloed,
// only soloed layers sound.
export function layerSounds(p, track, layer) {
  const st = layerStateOf(p, track, layer);
  if (st.muted) return false;
  return !anySolo(p) || st.solo;
}

// Transition length into clip i, limited to half of either neighbouring clip.
export function transitionDur(clips, i) {
  const t = clips[i]?.transition;
  if (!t || i === 0 || t.type === 'none') return 0;
  // Range edits preserve the retained overlap, even when a surviving piece is
  // shorter than twice that overlap. Ordinary UI transitions retain their cap.
  if (Number.isFinite(t.timelineOverlap)) return Math.max(0, Math.min(t.timelineOverlap, clipLen(clips[i]), clipLen(clips[i - 1])));
  return Math.max(0, Math.min(t.duration, clipLen(clips[i]) / 2, clipLen(clips[i - 1]) / 2));
}

// Clips overlap by the length of the transition into them (FFmpeg xfade).
export function videoLayout(videoClips) {
  let end = 0;
  return videoClips.map((c, i) => {
    const td = transitionDur(videoClips, i);
    const start = Math.max(0, end - td);
    const item = { clip: c, index: i, start, end: start + clipLen(c), trans: td };
    end = item.end;
    return item;
  });
}

// Total duration of what gets exported (the video track drives the output length).
// This is THE shared duration basis for everything export-facing: it mirrors, step for
// step, the total electron/media/ffmpeg.cjs accumulates in buildExportArgs (each clip starts
// at the previous end minus its clamped transition overlap). The text rasterizer
// (src/features/export/exportText.js) and the Export dialog's Duration + size estimate both read this
// function — never projectDuration(), which also counts text/audio/overlay ends.
export function exportDuration(p) {
  const v = videoLayout(p.videoClips);
  return v.length ? v[v.length - 1].end : 0;
}

// What plays and exports: deactivated main clips become gaps (black, silent), other deactivated clips are left out.
// Layer state applies here too — this is the one project both the preview and the export
// pipeline read, so a hidden layer vanishes from both and a muted / non-solo layer is
// silent in both: hidden picture layers are dropped (the main track leaves gaps), a
// silenced picture layer keeps its picture with clip.muted set, silenced audio clips go.
export function renderable(p) {
  const hasOff = [p.videoClips, p.overlayClips || [], p.audioClips, p.textClips, p.effectClips || []].some((l) => l.some((c) => c.disabled));
  const ls = p.layerState || {};
  const hasLayerFx = Object.values(ls).some((s) => s && (s.hidden || s.muted || s.solo));
  if (!hasOff && !hasLayerFx) return (p.audioClips || []).some(c => c.muted)
    ? { ...p, audioClips: p.audioClips.filter(c => !c.muted) } : p;
  const hidden = (track, layer) => layerStateOf(p, track, layer).hidden;
  const kept = (track) => (l) => l.filter((c) => !c.disabled && !hidden(track, layerOf(c)));
  return {
    ...p,
    videoClips: p.videoClips.map((c) => (c.disabled || hidden('video', 0)
      ? { ...newGap(c.id, clipLen(c)), transition: c.transition }
      : (!layerSounds(p, 'video', 0) && !c.muted ? { ...c, muted: true } : c))),
    overlayClips: kept('overlay')(p.overlayClips || [])
      .map((c) => (!layerSounds(p, 'overlay', layerOf(c)) && !c.muted ? { ...c, muted: true } : c)),
    audioClips: (p.audioClips || []).filter((c) => !c.disabled && !c.muted && !hidden('audio', layerOf(c)) && layerSounds(p, 'audio', layerOf(c))),
    textClips: kept('text')(p.textClips),
    effectClips: (p.effectClips || []).filter((c) => !c.disabled && !hidden('effect', 0)),
  };
}
