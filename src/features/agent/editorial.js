// Editorial analysis shared by CraftAI tools, completion checks and the offline
// evaluation scorer. Everything here is deterministic and works from the live
// project plus transcript words (timeline seconds). Heuristics are labelled as
// candidates: the model still judges content, and tools report provenance.
import { clipLen, exportDuration, videoLayout } from '../../state/store.js';

const r2 = n => Math.round(n * 100) / 100;
const finite = n => typeof n === 'number' && Number.isFinite(n);
// Lowercase, strip punctuation/diacritics/tatweel so "Um," "um" and Arabic forms compare equal.
export const normWord = text => String(text || '').normalize('NFKC').toLocaleLowerCase()
  .replace(/[ً-ٰٟـ]/g, '').replace(/[\p{P}\p{S}]/gu, '').trim();

// Hesitation sounds are always safe to remove. Discourse markers ("you know",
// "يعني") often carry meaning, so they are only removed when asked for.
const HESITATIONS = {
  en: ['um', 'umm', 'uh', 'uhh', 'uhm', 'erm', 'er', 'ah', 'hmm', 'mm', 'mhm'],
  fr: ['euh', 'euhh', 'heu', 'bah', 'hum'],
  es: ['eh', 'em', 'emm', 'mmm'],
  // Not "اه"/"آه"/"ايه" (yes in Darija/Levantine) or "ام" (mother): real words.
  ar: ['امم', 'اممم', 'ااا', 'اا', 'ممم', 'مم', 'همم', 'إمم', 'أمم'],
};
const DISCOURSE = {
  en: ['you know', 'i mean', 'kind of', 'sort of', 'basically', 'like', 'so yeah', 'actually'],
  fr: ['du coup', 'genre', 'en fait', 'tu vois', 'bon'],
  es: ['o sea', 'pues', 'este', 'bueno'],
  ar: ['يعني', 'ياعني', 'واقيلا', 'بصح', 'المهم', 'شوف'],
};
// Auto-detected speech uses the unambiguous lists only: Spanish "em"/"este" are
// real words in Portuguese and Spanish, so they need an explicit language.
const phraseList = (table, language) => {
  const langs = !language || language === 'auto' ? ['en', 'fr', 'ar'] : [String(language).slice(0, 2), 'en'];
  return [...new Set(langs.flatMap(l => table[l] || []))].map(p => p.split(' ').map(normWord)).sort((a, b) => b.length - a.length);
};

// Flatten transcript segments into timed words, keeping timing provenance.
export function transcriptWords(segments = []) {
  const words = [];
  for (const s of segments) {
    if (Array.isArray(s.words) && s.words.length) {
      for (const w of s.words) if (finite(w.start) && finite(w.end) && w.end >= w.start && normWord(w.text))
        words.push({ text: String(w.text).trim(), start: w.start, end: w.end, estimated: w.timing ? w.timing !== 'measured' : s.word_timing !== 'measured' });
    } else {
      // No word timings: spread words evenly and mark them estimated.
      const tokens = String(s.text || '').trim().split(/\s+/).filter(t => normWord(t));
      const span = Math.max(0, (s.end || 0) - (s.start || 0));
      tokens.forEach((text, i) => words.push({ text, start: s.start + span * i / tokens.length, end: s.start + span * (i + 1) / tokens.length, estimated: true }));
    }
  }
  return words.sort((a, b) => a.start - b.start);
}

// Spans of filler words or phrases. Returns { start, end, text, first, last, estimated }.
export function findFillers(words, { language = 'auto', discourse = false } = {}) {
  const phrases = [...phraseList(HESITATIONS, language), ...(discourse ? phraseList(DISCOURSE, language) : [])].sort((a, b) => b.length - a.length);
  const norm = words.map(w => normWord(w.text)), out = [];
  for (let i = 0; i < words.length;) {
    const hit = phrases.find(p => p.every((token, k) => norm[i + k] === token));
    if (hit) {
      const last = i + hit.length - 1;
      out.push({ start: words[i].start, end: words[last].end, text: words.slice(i, last + 1).map(w => w.text).join(' '), first: i, last, estimated: words.slice(i, last + 1).some(w => w.estimated) });
      i = last + 1;
    } else i++;
  }
  return out;
}

// Group words into sentences on terminal punctuation or a pause.
export function sentences(words, { pause_sec = 0.7, max_words = 40 } = {}) {
  const out = [];let current = [];
  const flush = () => { if (current.length) out.push({ start: current[0].start, end: current.at(-1).end, text: current.map(w => w.text).join(' '), first: current[0].index, last: current.at(-1).index, estimated: current.some(w => w.estimated) }); current = []; };
  words.forEach((w, index) => {
    if (current.length && (w.start - current.at(-1).end >= pause_sec || current.length >= max_words)) flush();
    current.push({ ...w, index });
    if (/[.!?؟…]$/.test(w.text)) flush();
  });
  flush();
  return out.map((s, i) => ({ id: `s${i + 1}`, ...s }));
}

const tokens = text => String(text).split(/\s+/).map(normWord).filter(Boolean);
const overlap = (a, b) => { const A = new Set(a), B = new Set(b); let n = 0; for (const t of A) if (B.has(t)) n++; return n / Math.max(1, Math.min(A.size, B.size)); };
const RESTART = /\b(sorry|let me (start|say that|try) again|start (over|again)|one more time|again)\b|من جديد|عاود|نعاود|سمحلي|pardon|je recommence|otra vez/i;

// Retakes: a sentence restarted by the next one (prefix or heavy overlap within
// 12 s), sentences that announce a restart, and immediate word stutters
// ("I I think"). The later take is kept: speakers usually redo until it is right.
export function findRetakes(words, list = sentences(words)) {
  const out = [];
  for (let i = 0; i < list.length - 1; i++) {
    const a = list[i], b = list[i + 1], ta = tokens(a.text), tb = tokens(b.text);
    if (b.start - a.end > 12 || ta.length < 2) continue;
    const prefix = ta.length <= tb.length && ta.slice(0, Math.min(ta.length, 3)).every((t, k) => tb[k] === t);
    const similar = ta.length >= 3 && overlap(ta, tb) >= 0.7 && tb.length >= ta.length * 0.6;
    if (prefix || similar) out.push({ kind: 'restart', start: a.start, end: b.start, removed: a.text, kept: b.text, sentence_id: a.id, estimated: a.estimated });
    else if (RESTART.test(a.text) && ta.length <= 8) out.push({ kind: 'restart_cue', start: a.start, end: b.start, removed: a.text, kept: b.text, sentence_id: a.id, estimated: a.estimated });
  }
  // Restarts inside one breath: the same 3-word run again within a few
  // seconds ("the best way is — the best way is to cut"). Remove the first run
  // up to where the repeat begins.
  const norm = words.map(w => normWord(w.text));
  for (let i = 0; i + 2 < words.length; i++) {
    for (let j = i + 3; j + 2 < words.length && j <= i + 16 && words[j].start - words[i].start < 8; j++) {
      if (norm[i] && norm[i] === norm[j] && norm[i + 1] === norm[j + 1] && norm[i + 2] === norm[j + 2]) {
        out.push({ kind: 'restart', start: words[i].start, end: words[j].start, removed: words.slice(i, j).map(w => w.text).join(' '), kept: words.slice(j, Math.min(words.length, j + 8)).map(w => w.text).join(' '), estimated: words.slice(i, j + 1).some(w => w.estimated) });
        i = j - 1;break;
      }
    }
  }
  for (let i = 0; i < words.length - 1; i++) {
    const a = normWord(words[i].text);
    if (a && a === normWord(words[i + 1].text) && words[i + 1].start - words[i].end < 0.6 && a.length <= 12)
      out.push({ kind: 'stutter', start: words[i].start, end: words[i + 1].start, removed: words[i].text, kept: words[i + 1].text, estimated: words[i].estimated || words[i + 1].estimated });
  }
  return out.sort((x, y) => x.start - y.start).filter((r, i, all) => !all.slice(0, i).some(o => o.start <= r.start && o.end >= r.end));
}

// Turn word-level removals into frame-aligned timeline cuts that never clip a
// neighbouring kept word: each cut runs from the previous kept word's end to
// the next kept word's start, minus a small breathing handle.
export function wordCuts(spans, words, { total, fps = 30, handle_sec = 0.04, allow_estimated = false } = {}) {
  const cuts = [], skipped = [];
  for (const span of spans) {
    if (span.estimated && !allow_estimated) { skipped.push({ ...span, reason: 'estimated word timing' }); continue; }
    const before = words.filter(w => w.end <= span.start + 1e-6).at(-1), after = words.find(w => w.start >= span.end - 1e-6);
    let start = before ? Math.max(before.end + handle_sec, span.start - 0.25) : Math.max(0, span.start - 0.1);
    let end = after ? Math.min(after.start - handle_sec, span.end + 0.25) : Math.min(total ?? span.end + 0.1, span.end + 0.1);
    start = Math.max(start, before ? before.end : 0);end = Math.min(end, after ? after.start : end);
    start = Math.ceil(start * fps - 1e-6) / fps;end = Math.floor(end * fps + 1e-6) / fps;
    if (finite(total)) { start = Math.max(0, Math.min(total, start)); end = Math.max(0, Math.min(total, end)); }
    if (end - start >= 1 / fps - 1e-7) cuts.push({ start, end });else skipped.push({ ...span, reason: 'shorter than one frame' });
  }
  const merged = cuts.sort((a, b) => a.start - b.start).reduce((out, c) => { const last = out.at(-1); if (last && c.start <= last.end + 1e-6) last.end = Math.max(last.end, c.end); else out.push({ ...c }); return out; }, []);
  return { cuts: merged, skipped };
}

// Shift transcript words through ripple cuts so later checks use the current
// timeline without transcribing again. Words inside a cut are dropped.
export function remapWords(words, cuts) {
  const sorted = [...cuts].sort((a, b) => a.start - b.start);
  return words.flatMap(w => {
    if (sorted.some(c => w.start < c.end - 1e-6 && w.end > c.start + 1e-6 && (Math.min(w.end, c.end) - Math.max(w.start, c.start)) >= (w.end - w.start) * 0.5)) return [];
    const shift = t => t - sorted.reduce((sum, c) => sum + (c.end <= t ? c.end - c.start : c.start < t ? t - c.start : 0), 0);
    return [{ ...w, start: shift(w.start), end: shift(w.end) }];
  });
}

const HOOK_WORDS = /\b(how|why|what|secret|mistake|never|always|stop|best|worst|truth|nobody|everyone|need|must|actually|finally|here'?s|you)\b|كيف|علاش|لماذا|سر|غلط|أبدا|ابدا|خاص|لازم|الحقيقة|comment|pourquoi|jamais|secreto|nunca/i;
// Rank sentences that could open a video or stand alone as a short. Heuristic
// signals only (question, numbers, strong words, length, clean start).
export function hookCandidates(list, { limit = 8, min_sec = 1.5, max_sec = 15 } = {}) {
  return list.map(s => {
    const t = tokens(s.text), dur = s.end - s.start, reasons = [];let score = 0;
    if (dur < min_sec || dur > max_sec * 2 || t.length < 4) return null;
    if (/[?؟]/.test(s.text)) { score += 2; reasons.push('question'); }
    if (/\d/.test(s.text)) { score += 1.5; reasons.push('number'); }
    const strong = (s.text.match(new RegExp(HOOK_WORDS.source, 'gi')) || []).length;
    if (strong) { score += Math.min(3, strong); reasons.push('strong words'); }
    if (t.length >= 6 && t.length <= 22) { score += 1; reasons.push('readable length'); }
    if (dur <= max_sec) score += 0.5;
    if (HESITATIONS.en.concat(HESITATIONS.fr, HESITATIONS.ar).includes(t[0])) { score -= 2; reasons.push('starts with a filler'); }
    return { sentence_id: s.id, start: r2(s.start), end: r2(s.end), text: s.text, score: r2(score), reasons };
  }).filter(Boolean).sort((a, b) => b.score - a.score || a.start - b.start).slice(0, limit);
}

// ---------- Critique ----------
const KEY_TRACKS = [['videoClips', 'video'], ['overlayClips', 'overlay'], ['textClips', 'text'], ['effectClips', 'effect']];
// Times where the picture visibly changes: cuts, overlays, titles, effects and keyframes.
export function visualChangeTimes(p) {
  const times = new Set([0]);
  const layout = videoLayout(p.videoClips || []);
  for (const row of layout) {
    times.add(r2(row.start));
    for (const keys of Object.values(row.clip.keyframes || {})) if (Array.isArray(keys)) for (const k of keys) if (finite(k.t)) times.add(r2(row.start + (k.t - (row.clip.in || 0)) / (row.clip.speed || 1)));
    if (row.clip.anim?.in || row.clip.anim?.combo) times.add(r2(row.start));
  }
  for (const [key] of KEY_TRACKS.slice(1)) for (const c of p[key] || []) {
    if (c.disabled || (key === 'textClips' && c.caption)) continue;
    const len = key === 'overlayClips' ? clipLen(c) : c.duration || 0;
    times.add(r2(c.start));times.add(r2(c.start + len));
  }
  return [...times].filter(finite).sort((a, b) => a - b);
}

const vertical = p => (p.height || 0) > (p.width || 0);
const words = text => String(text || '').trim().split(/\s+/).filter(Boolean).length;
const visibleChars = text => String(text || '').replace(/\s+/g, ' ').trim().length;

// Issues with severity high|medium|low, a timeline time when one applies, and
// a concrete fix. `transcript` is optional current-timeline words; `loudness`
// is optional { integrated_lufs, true_peak_db }.
export function critiqueProject(p, { words: spoken = null, loudness = null, target_duration_sec, platform } = {}) {
  const issues = [], add = (severity, code, message, fix, at) => issues.push({ severity, code, message, fix, ...(finite(at) ? { at_sec: r2(at) } : {}) });
  const total = exportDuration(p), layout = videoLayout(p.videoClips || []);
  const mediaOf = c => (p.media || []).find(m => m.id === c.mediaId);
  if (!total) return { score: 0, issues: [{ severity: 'high', code: 'empty', message: 'The main track is empty.', fix: 'Add footage first.' }], metrics: { duration_sec: 0 } };
  const portrait = vertical(p) || platform === 'tiktok' || platform === 'reels' || platform === 'shorts';

  // An empty main-track stretch under a title or overlay is a title card (the
  // editor extends the track for titles past the footage); only an uncovered
  // stretch is a black hole.
  const covered = (a, b) => [...(p.overlayClips || []).map(c => [c.start, c.start + clipLen(c), c.disabled]), ...(p.textClips || []).filter(c => !c.caption).map(c => [c.start, c.start + (c.duration || 0), c.disabled])]
    .filter(([, , off]) => !off).reduce((n, [s, e]) => n + Math.max(0, Math.min(b, e) - Math.max(a, s)), 0) >= (b - a) * 0.5;
  for (const row of layout) if (row.clip.gap && row.end - row.start > 0.05 && !covered(row.start, row.end)) add('high', 'gap', `Black gap of ${r2(row.end - row.start)} s on the main track.`, 'Close the gap (move_clip / magnet) or fill it with b-roll or a title.', row.start);

  // Pacing: the longest stretch with no visible change.
  const changes = visualChangeTimes(p).filter(t => t < total).concat(total);
  let longest = { len: 0, at: 0 };
  for (let i = 1; i < changes.length; i++) if (changes[i] - changes[i - 1] > longest.len) longest = { len: changes[i] - changes[i - 1], at: changes[i - 1] };
  const staticLimit = portrait ? 6 : 12;
  if (longest.len > staticLimit * 1.5) add('medium', 'static', `${r2(longest.len)} s without a cut, zoom, overlay or title starting at ${r2(longest.at)} s.`, `Add a punch-in zoom, b-roll or a cut every ${portrait ? '3–6' : '6–12'} s.`, longest.at);
  else if (longest.len > staticLimit) add('low', 'static', `${r2(longest.len)} s without a visual change at ${r2(longest.at)} s.`, 'Consider a zoom or b-roll to keep momentum.', longest.at);

  // Hook: something should happen in the first 3 seconds.
  const opening = changes.filter(t => t > 0.05 && t <= 3).length;
  const titleEarly = (p.textClips || []).some(c => !c.caption && !c.disabled && c.start < 1.5);
  const zoomEarly = layout.some(r => r.start < 3 && Object.values(r.clip.keyframes || {}).some(k => Array.isArray(k) && k.length));
  if (total > 8 && !titleEarly && !zoomEarly && !opening) add(portrait ? 'high' : 'medium', 'hook', 'Nothing changes in the first 3 seconds: no title, zoom or cut.', 'Open with the strongest line, a hook title and a zoom or fast cut.', 0);

  // Speech-dependent checks.
  let fillers = 0, retakes = 0, deadAir = 0;
  if (Array.isArray(spoken) && spoken.length) {
    fillers = findFillers(spoken).length;
    retakes = findRetakes(spoken).filter(r => r.kind !== 'stutter').length;
    if (fillers >= 3) add('medium', 'fillers', `${fillers} filler words remain (um, uh…).`, 'Run remove_fillers.', findFillers(spoken)[0].start);
    if (retakes) add('medium', 'retakes', `${retakes} probable retake(s) or false start(s) remain.`, 'Run remove_retakes after checking the takes.', findRetakes(spoken).find(r => r.kind !== 'stutter')?.start);
    if (spoken[0].start > 1.2) add('medium', 'late_start', `Speech starts ${r2(spoken[0].start)} s in.`, 'Trim the opening so the first words start within 0.5 s.', 0);
    for (let i = 1; i < spoken.length; i++) {
      const pause = spoken[i].start - spoken[i - 1].end;
      if (pause > 1.2) { deadAir += pause; if (pause > 2) add('medium', 'dead_air', `${r2(pause)} s pause in speech.`, 'Run remove_silences or cut the pause.', spoken[i - 1].end); }
    }
  }

  // Captions and titles: reading speed, minimum time, safe area, overlaps.
  const caps = (p.textClips || []).filter(c => c.caption && !c.disabled).sort((a, b) => a.start - b.start);
  let fast = 0, worst = null;
  for (const c of caps) {
    const cps = visibleChars(c.text) / Math.max(0.05, c.duration);
    if (cps > 22) { fast++; if (!worst || cps > worst.cps) worst = { cps, at: c.start }; }
  }
  if (fast) add(fast > caps.length * 0.2 ? 'medium' : 'low', 'caption_speed', `${fast} caption(s) read faster than 22 characters/s (worst ${r2(worst.cps)}).`, 'Use fewer words per caption (add_captions words_per_caption 3–5) or merge short cues.', worst.at);
  for (let i = 1; i < caps.length; i++) if (caps[i].start < caps[i - 1].start + caps[i - 1].duration - 0.05 && (caps[i].layer || 0) === (caps[i - 1].layer || 0)) { add('low', 'caption_overlap', 'Captions overlap in time.', 'Regenerate or trim captions so cues follow each other.', caps[i].start); break; }
  const lowLimit = portrait ? 0.82 : 0.92;
  const capY = caps.find(c => finite(c.y) && (c.y > lowLimit || c.y < 0.06));
  if (capY) add('medium', 'caption_safe_area', `Captions sit at y ${r2(capY.y)}, outside the ${portrait ? 'vertical-video' : ''} safe area.`, `Move captions to y ${portrait ? '0.68–0.78' : '0.8–0.88'} with edit_text clip_id "captions".`, capY.start);
  for (const c of (p.textClips || []).filter(c => !c.caption && !c.disabled)) {
    const need = 0.6 + 0.3 * words(c.text);
    if (c.duration < need && words(c.text) > 1) { add('low', 'title_short', `Title "${String(c.text).slice(0, 40)}" is on screen ${r2(c.duration)} s; it needs about ${r2(need)} s to read.`, 'Lengthen the title or shorten its text.', c.start); break; }
    if ((finite(c.x) && (c.x < 0.06 || c.x > 0.94)) || (finite(c.y) && (c.y < 0.05 || c.y > (portrait ? 0.85 : 0.95)))) { add('medium', 'title_safe_area', `Title "${String(c.text).slice(0, 40)}" is near the frame edge.`, 'Keep titles inside the middle 80–90% of the frame.', c.start); break; }
  }

  // Audio mix: music level under speech without automation, and loudness.
  // Audio-track clips that are not generated narration are treated as music/ambience.
  const music = (p.audioClips || []).filter(c => !c.disabled && !c.muted && mediaOf(c)?.origin !== 'tts' && !/voice|narrat|speech/i.test(mediaOf(c)?.name || c.name || ''));
  const hasSpeech = Array.isArray(spoken) ? spoken.length > 0 : layout.some(r => !r.clip.gap && !r.clip.muted);
  const loudMusic = music.find(c => (c.volume ?? 1) > 0.4 && !(c.volumeKeys?.length));
  if (hasSpeech && loudMusic) add('medium', 'music_level', `Background audio at ${Math.round((loudMusic.volume ?? 1) * 100)}% competes with speech.`, 'Lower music to 15–30% (set_volume) or duck it under speech (duck_audio).', loudMusic.start);
  if (loudness && finite(loudness.integrated_lufs)) {
    // One call fixes both: clip loudnorm targets −14 LUFS with a −1 dBTP ceiling.
    const speechIds = [...layout.filter(r => !r.clip.gap && !r.clip.muted && (mediaOf(r.clip)?.hasAudio)).map(r => r.clip.id),
      ...(p.audioClips || []).filter(c => !c.muted && mediaOf(c)?.origin === 'tts').map(c => c.id)];
    const missing = speechIds.filter(id => !([...layout.map(r => r.clip), ...(p.audioClips || [])].find(c => c.id === id)?.audioFx?.loudnorm));
    const fix = missing.length ? `Normalize all speech in one call: set_audio_effects clip_ids ${JSON.stringify(missing.slice(0, 200))} loudnorm true limit true. Do not adjust volumes clip by clip.` : 'Loudnorm is already on every speech clip; lower the music bed instead of changing speech volumes.';
    if (loudness.integrated_lufs < -18 || loudness.integrated_lufs > -10) add('medium', 'loudness', `Integrated loudness ${r2(loudness.integrated_lufs)} LUFS; online platforms expect about −14.`, fix);
    if (finite(loudness.true_peak_db) && loudness.true_peak_db > -1) add('medium', 'clipping', `True peak ${r2(loudness.true_peak_db)} dBTP risks clipping.`, fix);
  }

  // Transitions: long or overused dissolves feel dated in fast edits.
  const transitions = layout.filter(r => r.clip.transition);
  const longT = transitions.find(r => (r.clip.transition.duration || 0) > 1);
  if (longT) add('low', 'transition_length', `A ${r2(longT.clip.transition.duration)} s transition slows the pace.`, 'Keep transitions 0.2–0.5 s, or use straight cuts.', longT.start);
  if (layout.length > 4 && transitions.length > layout.length * 0.6) add('low', 'transition_overuse', `${transitions.length} of ${layout.length} cuts use transitions.`, 'Use straight cuts for most edits; save transitions for section changes.');

  if (finite(target_duration_sec) && target_duration_sec > 0) {
    const off = (total - target_duration_sec) / target_duration_sec;
    if (Math.abs(off) > 0.15) add(Math.abs(off) > 0.4 ? 'high' : 'medium', 'duration', `Duration ${r2(total)} s vs target ${r2(target_duration_sec)} s.`, off > 0 ? 'Cut weaker sentences or tighten pauses.' : 'Keep more material or slow the pacing.');
  }

  const weights = { high: 18, medium: 8, low: 3 };
  const score = Math.max(0, Math.min(100, 100 - issues.reduce((n, i) => n + weights[i.severity], 0)));
  const order = { high: 0, medium: 1, low: 2 };
  issues.sort((a, b) => order[a.severity] - order[b.severity] || (a.at_sec ?? 0) - (b.at_sec ?? 0));
  return { score, issues, metrics: { duration_sec: r2(total), cuts: layout.filter(r => !r.clip.gap).length, longest_static_sec: r2(longest.len),
    visual_changes_per_min: r2((changes.length - 1) / Math.max(total / 60, 1 / 60)), captions: caps.length, fast_captions: fast,
    ...(Array.isArray(spoken) ? { fillers, retakes, dead_air_sec: r2(deadAir), words_per_min: r2(spoken.length / Math.max(total / 60, 1 / 60)) } : {}),
    ...(loudness ? { integrated_lufs: loudness.integrated_lufs, true_peak_db: loudness.true_peak_db } : {}) } };
}

// Structural issues (no speech/loudness) that this request introduced: the
// completion gate only asks the agent to fix what it caused, never to widen
// the edit beyond the user's scope.
const GATED = new Set(['gap', 'caption_speed', 'caption_safe_area', 'caption_overlap', 'title_short', 'title_safe_area', 'music_level', 'hook', 'transition_length']);
export function introducedIssues(before, after) {
  const old = new Set(critiqueProject(before).issues.map(i => i.code));
  return critiqueProject(after).issues.filter(i => GATED.has(i.code) && i.severity !== 'low' && !old.has(i.code));
}
