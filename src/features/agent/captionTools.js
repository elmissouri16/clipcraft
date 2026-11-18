import { exportDuration, isLayerLocked, layerOf, renderable, uid } from '../../state/store.js';
import { parseSRT } from '../text/subtitles.js';
import { TEXT_TEMPLATES } from '../text/catalog.js';
const S = { type: 'STRING' }, N = { type: 'NUMBER' }, I = { type: 'INTEGER' }, B = { type: 'BOOLEAN' };
export const CAPTION_DECLARATIONS = [
  { name: 'edit_caption_words', description: 'Replace one caption’s word timing explicitly. words are the complete wording, with absolute timeline start_sec/end_sec inside that caption. Timings are labelled edited, never measured. For cue-level text/timing use edit_text.',
    parameters: { type: 'OBJECT', properties: { clip_id: S, words: { type: 'ARRAY', items: { type: 'OBJECT', properties: { text: S, start_sec: N, end_sec: N }, required: ['text', 'start_sec', 'end_sec'] } } }, required: ['clip_id', 'words'] } },
  { name: 'caption_tools', description: 'Caption split (clip_id, time_sec; word_index required when words lack timestamps), merge (clip_ids on the same layer/source; keeps first look and exact word times), or import_srt (srt_text or file_path). Imports keep cue timings; overlaps use free unlocked layers. replace_source none/srt/all controls prior captions. Source must fit the current video.',
    parameters: { type: 'OBJECT', properties: { action: { ...S, enum: ['split', 'merge', 'import_srt'] }, clip_id: S,
      clip_ids: { type: 'ARRAY', items: S }, time_sec: N, word_index: I, srt_text: S, file_path: S, style_id: S, layer: I,
      replace_source: { ...S, enum: ['none', 'srt', 'all'] } }, required: ['action'] } },
  { name: 'export_subtitles', description: 'Write visible caption cues to a real .srt file. clip_ids/source can filter cues. file_path optional; otherwise save a uniquely named file in Downloads. overwrite only if the user requests replacing a file. Returns the actual file path, size and cue count.',
    parameters: { type: 'OBJECT', properties: { file_path: S, name: S, overwrite: B, clip_ids: { type: 'ARRAY', items: S }, source: { ...S, enum: ['all', 'auto', 'srt'] } } } },
];
const finite = n => typeof n === 'number' && Number.isFinite(n);
const sameText = (a, b) => String(a).trim().replace(/\s+/gu, ' ') === String(b).trim().replace(/\s+/gu, ' ');
const tokens = text => String(text).trim().split(/\s+/u).filter(Boolean);
function cueWords(cue, base) {
  if (cue.words?.length && sameText(cue.words.map(w => w.text).join(' '), cue.text)) return cue.words.map(word => ({ ...word,
    start: word.start + cue.start - base, end: word.end + cue.start - base, timing: word.timing || cue.word_timing || 'estimated' }));
  const words = tokens(cue.text);
  return words.map((text, i) => ({ text, start: cue.start - base + cue.duration * i / words.length,
    end: cue.start - base + cue.duration * (i + 1) / words.length, timing: 'estimated' }));
}
export function subtitleTimestamp(seconds) {
  const ms = Math.round(Math.max(0, seconds) * 1000), pad = (n, size) => String(n).padStart(size, '0');
  return `${pad(Math.floor(ms / 3600000), 2)}:${pad(Math.floor(ms / 60000) % 60, 2)}:${pad(Math.floor(ms / 1000) % 60, 2)},${pad(ms % 1000, 3)}`;
}
// A blank line ends a cue in SubRip, so a caption's empty lines are dropped (its text lines are kept).
export function captionsToSrt(cues) {
  return [...cues].sort((a, b) => a.start - b.start || a.id.localeCompare(b.id)).map((cue, i) =>
    `${i + 1}\n${subtitleTimestamp(cue.start)} --> ${subtitleTimestamp(cue.start + cue.duration)}\n${cue.text.split(/\r\n?|\n/).map(l => l.trim()).filter(Boolean).join('\n')}\n`).join('\n');
}
export function createCaptionTools(env) {
  const { project, dispatch, after, findClip, api } = env;
  const caption = id => {
    const found = findClip(id);
    if (!found || found.track !== 'text' || !found.clip.caption) throw Error(`No caption cue with id ${id}.`);
    if (isLayerLocked(project(), 'text', layerOf(found.clip))) throw Error('The caption layer is locked.');
    return found.clip;
  };
  const fileJob = async args => {
    if (!api.agentFileJob) throw Error('Restart ClipCraft to load subtitle file tools.');
    const result = await api.agentFileJob({ ...args, requestId: env.requestId });
    if (result?.error) throw Error(result.error);
    return result;
  };
  return {
    async edit_caption_words({ clip_id, words }) {
      const cue = caption(clip_id);
      if (!Array.isArray(words) || !words.length || words.length > 128) throw Error('Provide from one to 128 timed words.');
      let previous = -Infinity;
      const edited = words.map(word => {
        if (!word || typeof word.text !== 'string' || !word.text.trim() || word.text.length > 256
          || !finite(word.start_sec) || !finite(word.end_sec) || word.start_sec < cue.start - 1e-6
          || word.end_sec > cue.start + cue.duration + 1e-6 || word.end_sec <= word.start_sec || word.start_sec < previous) throw Error('Words must have ordered timeline times inside the caption and nonempty text.');
        previous = word.start_sec;
        return { text: word.text.trim(), start: Math.max(0, word.start_sec - cue.start), end: Math.min(cue.duration, word.end_sec - cue.start), timing: 'edited' };
      });
      dispatch({ type: 'update', track: 'text', id: clip_id, patch: { text: edited.map(w => w.text).join(' '), words: edited, word_timing: 'edited' } });
      return after({ clip_id, words: edited.length, word_timing: 'edited', time_basis: 'timeline seconds in the request; cue-relative seconds in saved words' });
    },
    async caption_tools(a) {
      if (a.action === 'split') {
        const cue = caption(a.clip_id), cut = a.time_sec - cue.start;
        if (!finite(a.time_sec) || cut < .1 || cue.duration - cut < .1) throw Error('The split must leave at least 0.1 seconds on each side.');
        if (cue.words?.length) {
          if (cue.words.some(w => cut > w.start + 1e-6 && cut < w.end - 1e-6)) throw Error('That split cuts through a timed word. Choose a word boundary or edit its timing first.');
          if (!cue.words.some(w => w.end <= cut + 1e-6) || !cue.words.some(w => w.start >= cut - 1e-6)) throw Error('Choose a boundary with at least one word on each side.');
          return env.splitClip({ clip_id: cue.id, time_sec: a.time_sec });
        }
        const words = tokens(cue.text), index = a.word_index;
        if (!Number.isInteger(index) || index < 1 || index >= words.length) throw Error('Without timed words, provide word_index: the number of words in the first cue.');
        const next = uid();
        dispatch({ type: 'replaceCaptionCues', ids: [cue.id], clips: [
          { ...cue, words: undefined, word_timing: 'estimated', text: words.slice(0, index).join(' '), duration: cut },
          { ...cue, id: next, words: undefined, word_timing: 'estimated', text: words.slice(index).join(' '), start: a.time_sec, duration: cue.duration - cut },
        ] });
        return after({ clip_ids: [cue.id, next], word_timing: 'estimated' });
      }
      if (a.action === 'merge') {
        if (!Array.isArray(a.clip_ids) || a.clip_ids.length < 2 || a.clip_ids.length > 64 || new Set(a.clip_ids).size !== a.clip_ids.length) throw Error('Merge from two to 64 distinct caption IDs.');
        const cues = a.clip_ids.map(caption).sort((a, b) => a.start - b.start), first = cues[0];
        if (cues.some(c => layerOf(c) !== layerOf(first) || (c.source || 'auto') !== (first.source || 'auto'))) throw Error('Merge captions from the same layer and source.');
        const end = Math.max(...cues.map(c => c.start + c.duration)), ids = new Set(a.clip_ids);
        if (project().textClips.some(c => !ids.has(c.id) && layerOf(c) === layerOf(first) && c.start < end && c.start + c.duration > first.start)) throw Error('The merged cue would cover an unselected text clip on that layer.');
        const words = cues.flatMap(c => cueWords(c, first.start));
        const word_timing = words.every(w => w.timing === 'measured') ? 'measured' : words.some(w => w.timing === 'estimated') ? 'estimated' : 'edited';
        dispatch({ type: 'replaceCaptionCues', ids: a.clip_ids, clips: [{ ...first, text: cues.map(c => c.text.trim()).join(' '), duration: end - first.start, words, word_timing }] });
        return after({ clip_id: first.id, merged_cues: cues.length, word_timing, note: 'The first cue’s appearance is retained; timeline timing is unchanged.' });
      }
      if (a.action === 'import_srt') {
        if (!!a.srt_text === !!a.file_path) throw Error('Provide exactly one of srt_text or file_path.');
        const text = a.file_path ? (await fileJob({ action: 'read_subtitles', path: a.file_path })).text : a.srt_text;
        if (typeof text !== 'string' || text.length > 2 * 1024 * 1024) throw Error('Subtitle input is too large.');
        const segments = parseSRT(text);
        if (!segments.length || segments.length > 10000) throw Error('No valid subtitle cues, or more than 10,000 cues.');
        const blocks = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split(/\n\s*\n/).filter(block => block.trim());
        const invalid = blocks.flatMap((block, i) => parseSRT(block).length ? [] : [i + 1]);
        if (invalid.length) throw Error(`Invalid subtitle blocks: ${invalid.slice(0, 12).join(', ')}. Repair the file before importing; no cues were changed.`);
        const p = project(), duration = exportDuration(p);
        if (segments.some(s => s.end > duration + 1e-6)) throw Error('Subtitles extend beyond the current video. Adjust their timestamps or extend the video explicitly first.');
        const replace = a.replace_source || 'none';
        if (!['none', 'srt', 'all'].includes(replace)) throw Error('replace_source must be none, srt or all.');
        const removed = p.textClips.filter(c => c.caption && (replace === 'all' || replace === 'srt' && c.source === 'srt'));
        removed.forEach(c => caption(c.id));
        const tpl = TEXT_TEMPLATES.find(t => t.caption && t.id === (a.style_id || 'cap-classic'));
        if (!tpl) throw Error('Unknown caption style_id.');
        const base = a.layer ?? 0;
        if (!Number.isInteger(base) || base < 0 || base >= 128) throw Error('layer must be from 0 to 127.');
        const existing = p.textClips.filter(c => !removed.some(r => r.id === c.id)), clips = [];
        for (const cue of segments) {
          let layer = base;
          while (layer < 128 && (isLayerLocked(p, 'text', layer) || [...existing, ...clips].some(c => layerOf(c) === layer && c.start < cue.end && c.start + c.duration > cue.start))) layer++;
          if (layer === 128) throw Error('No unlocked text layer is available for these subtitle cues.');
          clips.push({ y: .8, size: Math.round(Math.min(p.width, p.height) * .075), ...tpl.patch, template: tpl.id,
            id: uid(), caption: true, source: 'srt', text: cue.text, start: cue.start, duration: cue.end - cue.start, layer, word_timing: 'unavailable' });
        }
        dispatch({ type: 'replaceCaptionCues', ids: removed.map(c => c.id), clips });
        return after({ imported_cues: clips.length, clip_ids: clips.slice(0, 64).map(c => c.id), omitted_clip_ids: Math.max(0, clips.length - 64) });
      }
      throw Error('action must be split, merge or import_srt.');
    },
    async export_subtitles(a) {
      if (a.overwrite !== undefined && typeof a.overwrite !== 'boolean') throw Error('overwrite must be true or false.');
      const p = project(), source = a.source || 'all';
      if (!['all', 'auto', 'srt'].includes(source)) throw Error('source must be all, auto or srt.');
      if (a.clip_ids !== undefined && (!Array.isArray(a.clip_ids) || !a.clip_ids.length)) throw Error('clip_ids must be a nonempty list when given.');
      const cues = renderable(p).textClips.filter(c => c.caption && (!a.clip_ids || a.clip_ids.includes(c.id))
        && (source === 'all' || (source === 'srt' ? c.source === 'srt' : c.source !== 'srt')));
      if (!cues.length) throw Error('No matching visible captions to export.');
      if (a.clip_ids?.some(id => !cues.some(c => c.id === id))) throw Error('Some requested caption IDs are missing, hidden or excluded by source.');
      const result = await fileJob({ action: 'write_subtitles', path: a.file_path, name: a.name || `${p.name || 'Video'} subtitles`, text: captionsToSrt(cues), overwrite: a.overwrite });
      return { ok: true, ...result, cues: cues.length, revision: env.revision(p), artifact: { ...result, type: 'subtitles' } };
    },
  };
}
