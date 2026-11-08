// Mirrors the player's gain envelope, including slices through an active fade.
// afade rejects a negative start; prepend silence for that part of the ramp,
// apply the original slope, then discard the padding and reset timestamps.
function audioFadeFilters(clip, length, num = n => Number(n).toFixed(6)) {
  const filters = [];
  const add = (type, start, duration) => {
    const pad = Math.max(0, -start);
    if (pad) filters.push(`adelay=${num(pad * 1000)}:all=1`);
    filters.push(`afade=t=${type}:st=${num(Math.max(0, start))}:d=${num(duration)}`);
    if (pad) filters.push(`atrim=start=${num(pad)}`, 'asetpts=PTS-STARTPTS');
  };
  if (clip.fadeIn > 0 && (clip.fadeInOffset || 0) < clip.fadeIn) add('in', -(clip.fadeInOffset || 0), clip.fadeIn);
  if (clip.fadeOut > 0 && (clip.fadeOutOffset || 0) < clip.fadeOut) add('out', length + (clip.fadeOutOffset || 0) - clip.fadeOut, clip.fadeOut);
  return filters;
}
// Equivalent to the player's piecewise-linear source-time curve. Sum clipped
// ramps in a balanced tree so long dialogue does not exhaust FFmpeg's parser.
function audioAutomationFilters(clip) {
  const keys = clip.volumeKeys;
  if (!Array.isArray(keys) || !keys.length) return [];
  if (keys.length > 512 || keys.some((k, i) => !k || !Number.isFinite(k.t) || k.t < 0 || !Number.isFinite(k.v) || k.v < 0 || k.v > 2 || i && k.t <= keys[i - 1].t)) throw Error('Invalid audio volume automation.');
  const n = value => String(Number(value.toFixed(9)));
  const clock = `(${n(clip.in || 0)}+if(isnan(t),0,t)*${n(clip.speed || 1)})`;
  const terms = [n(keys[0].v)];
  for (let i = 1; i < keys.length; i++) {
    const a = keys[i - 1], b = keys[i];
    if (b.v !== a.v) terms.push(`(${n(b.v - a.v)}*clip((${clock}-${n(a.t)})/${n(b.t - a.t)},0,1))`);
  }
  const sum = list => list.length === 1 ? list[0] : `(${sum(list.slice(0, list.length >> 1))}+${sum(list.slice(list.length >> 1))})`;
  return [`volume='${sum(terms)}':eval=frame`];
}
module.exports = { audioFadeFilters, audioAutomationFilters };
