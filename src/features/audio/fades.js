const clamp = value => Math.max(0, Math.min(1, value));

// Points use source seconds, just like picture keyframes. Splits and trims keep
// the same curve; changing speed changes how quickly playback travels along it.
export function volumeAt(keys, sourceTime) {
  if (!keys?.length) return 1;
  if (sourceTime <= keys[0].t) return keys[0].v;
  let lo = 0, hi = keys.length - 1;
  if (sourceTime >= keys[hi].t) return keys[hi].v;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1;if (keys[mid].t <= sourceTime) lo = mid;else hi = mid; }
  const a = keys[lo], b = keys[hi];
  return a.v + (b.v - a.v) * (sourceTime - a.t) / (b.t - a.t);
}

export function audioGain(clip, localTime, length) {
  let gain = (clip.volume ?? 1) * volumeAt(clip.volumeKeys, (clip.in || 0) + localTime * (clip.speed || 1));
  if (clip.fadeIn > 0) gain *= clamp((localTime + (clip.fadeInOffset || 0)) / clip.fadeIn);
  if (clip.fadeOut > 0) gain *= clamp((length - localTime + (clip.fadeOutOffset || 0)) / clip.fadeOut);
  return gain;
}

// Keep the original envelope when a slice begins/ends inside a fade. Offsets
// measure the discarded head/tail in timeline seconds, including earlier cuts.
export function sliceFades(clip, from, to, length) {
  const patch = {};
  for (const [kind, offset] of [['In', (clip.fadeInOffset || 0) + from], ['Out', (clip.fadeOutOffset || 0) + length - to]]) {
    const duration = clip[`fade${kind}`] || 0;
    if (duration || clip[`fade${kind}`] !== undefined) {
      patch[`fade${kind}`] = offset < duration ? duration : 0;
      patch[`fade${kind}Offset`] = offset < duration ? offset : 0;
    }
  }
  return patch;
}
