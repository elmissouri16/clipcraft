// Caption timestamps are local to the clip. Measured timings survive a crop;
// changing the wording or stretching the duration invalidates that measurement.
export function validWordTiming(words, duration, offset = 0) {
  return Array.isArray(words) && words.every((word, i) =>
    Number.isFinite(word.start) && Number.isFinite(word.end) && word.end > word.start
    && word.start >= offset && word.end <= offset + duration + 0.001
    && (!i || word.start >= words[i - 1].start));
}

// Cached/engine transcripts can contain collapsed or out-of-cue words. Keep
// the cue and wording, but use the renderer's estimated highlight timing rather
// than admitting invalid measurements to the project.
export function captionWordTiming(segment) {
  const words = (segment.words || []).map(word => ({ ...word,
    start: word.start - segment.start, end: word.end - segment.start,
  }));
  return validWordTiming(words, segment.end - segment.start)
    ? { words, ...(segment.word_timing ? { word_timing: segment.word_timing } : {}) }
    : { words: undefined, word_timing: 'estimated' };
}

export function editWordTiming(clip, patch) {
  if (Object.hasOwn(patch, 'words') || !clip.words?.length) return patch;
  if (patch.text !== undefined && patch.text !== clip.text) return { ...patch, words: undefined, word_timing: 'estimated' };
  if (patch.duration !== undefined && patch.duration !== clip.duration) {
    const factor = patch.duration / clip.duration;
    return { ...patch, word_timing: 'estimated', words: clip.words.map(word => ({ ...word,
      start: word.start * factor, end: word.end * factor, timing: 'estimated',
    })) };
  }
  return patch;
}

export function cropWordTiming(clip, from, to) {
  if (!clip.words?.length) return {};
  const words = clip.words.filter(word => word.start < to && word.end > from)
    .map(word => ({ ...word, start: Math.max(0, word.start - from), end: Math.min(to - from, word.end - from) }));
  return { words, text: words.map(word => word.text).join(' ') };
}
