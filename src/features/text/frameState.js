import { resolveStyle } from './style.js';

// Export time advances monotonically. Sweep clip boundaries once instead of
// scanning every caption on every frame. Seeking backwards rebuilds the set.
export function createTextFrameState(project, overlayRanges = []) {
  const clips = project.textClips || [], active = new Set();
  const events = clips.flatMap((clip, index) => [
    { time: clip.start, index, add: true }, { time: clip.start + clip.duration, index, add: false },
  ]).sort((a, b) => a.time - b.time || Number(a.add) - Number(b.add));
  const styles = clips.map(resolveStyle);
  let cursor = 0, previous = -Infinity, visible = [];
  return t => {
    if (t < previous) { cursor = 0; active.clear(); }
    previous = t;
    let changed = cursor === 0;
    while (cursor < events.length && events[cursor].time <= t) {
      const event = events[cursor++];
      if (event.add) active.add(event.index); else active.delete(event.index);
      changed = true;
    }
    if (changed) visible = [...active].sort((a, b) => a - b);
    const overlays = overlayRanges.some(([from, to]) => t >= from && t < to);
    let dynamic = overlays;
    const key = visible.map(index => {
      const clip = clips[index], style = styles[index], local = t - clip.start;
      if (clip.pin || style.animLoop.id !== 'none'
        || (style.animIn.id !== 'none' && style.animIn.dur > 0 && local < style.animIn.dur)
        || (style.animOut.id !== 'none' && style.animOut.dur > 0 && local > clip.duration - style.animOut.dur)) dynamic = true;
      if (style.highlight.mode === 'karaoke') dynamic = true;
      let word = -1;
      if (style.highlight.mode !== 'none') {
        const count = String(style.text || '').trim().split(/\s+/).filter(Boolean).length;
        const times = style.words?.length === count ? style.words : Array.from({ length: count }, (_, i) => ({ start: i * clip.duration / count }));
        for (let i = 0; i < times.length; i++) if (times[i].start <= local) word = i;
      }
      return `${index}:${word}`;
    }).join('|');
    return { clips: visible.map(index => clips[index]), blank: !visible.length && !overlays, key: dynamic ? `${key}@${t}` : key };
  };
}
