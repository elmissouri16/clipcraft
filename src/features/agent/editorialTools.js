// Editorial tools: footage logging, transcript-driven cleanup, highlight
// finding, edit plans, genre guides, self-critique and beat grids. Edits use
// the same ripple range cuts as remove_silences, so every track follows and
// the whole request stays one Undo step.
import { cutRanges, exportDuration, renderable } from '../../state/store.js';
import { audioRevision } from './context.js';
import { transcriptWords, sentences, findFillers, findRetakes, wordCuts, remapWords, hookCandidates, critiqueProject } from './editorial.js';
import { EDIT_GUIDE, EDIT_WORKFLOW, GUIDE_TOPICS } from './editGuide.js';

const S = { type: 'STRING' }, N = { type: 'NUMBER' }, B = { type: 'BOOLEAN' }, I = { type: 'INTEGER' };
const SPEECH = { language: { ...S, description: 'en, ar, fr, es...; default auto' }, source: { ...S, enum: ['all', 'video', 'overlay', 'audio'] }, clip_ids: { type: 'ARRAY', items: S } };
const RANGE = { start_sec: N, end_sec: N };
const r2 = n => Math.round(n * 100) / 100;
const PLATFORMS = ['tiktok', 'reels', 'shorts', 'youtube', 'podcast', 'tutorial', 'vlog', 'ad', 'other'];

// A short id bound to a retake candidate's content (see remove_retakes).
function retakeIds(list, words) {
  const hash = (text) => { let h = 0x811c9dc5; for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(36); };
  const norm = (text) => String(text || '').toLocaleLowerCase().replace(/\s+/g, ' ').trim();
  const seen = new Map();
  return list.map(r => {
    const before = words.filter(w => w.end <= r.start + 1e-6).slice(-3).map(w => norm(w.text)).join(' ');
    const base = `rt_${hash([r.kind, norm(r.removed), norm(r.kept), before].join('|'))}`, n = (seen.get(base) || 0) + 1;
    seen.set(base, n);
    return { id: n > 1 ? `${base}_${n}` : base, ...r };
  });
}

export const EDITORIAL_DECLARATIONS = [
  { name: 'edit_guide', description: `Editor playbook. topic: workflow (the step-by-step editing process), principles, or a genre recipe: ${GUIDE_TOPICS.filter(t => t !== 'principles').join(', ')}. Read workflow + the matching genre before any full edit or restructure.`,
    parameters: { type: 'OBJECT', properties: { topic: { ...S, enum: ['workflow', ...GUIDE_TOPICS] } }, required: ['topic'] } },
  { name: 'log_footage', description: 'Log the footage like an assistant editor: transcribes once (cached), splits speech into timed sentences, links each to its visual shot, and flags filler words, retakes/false starts and hook candidates. Start every substantial edit here. Paginated sentences (offset/limit).',
    parameters: { type: 'OBJECT', properties: { ...SPEECH, include_scenes: B, offset: I, limit: I }, required: [] } },
  { name: 'remove_fillers', description: 'Cut filler words (um, uh, euh, امم…) between the real pauses around them (audio-checked edges), rippling all tracks. Fillers spoken together with a word are skipped with a reason. discourse true also removes discourse markers (you know, I mean, like, يعني…) — only when the user wants a tight edit. Words with estimated timing are skipped unless allow_estimated. dry_run lists cuts without editing.',
    parameters: { type: 'OBJECT', properties: { ...SPEECH, ...RANGE, discourse: B, allow_estimated: B, handle_sec: N, dry_run: B }, required: [] } },
  { name: 'remove_retakes', description: 'Cut retakes and false starts, keeping the later take: restart (a sentence redone by the next one), restart_cue ("sorry, let me start again"), stutter (repeated word). Call with dry_run true first, review the removed/kept text, then apply with retake_ids for the ones that are real retakes.',
    parameters: { type: 'OBJECT', properties: { ...SPEECH, kinds: { type: 'ARRAY', items: { ...S, enum: ['restart', 'restart_cue', 'stutter'] } }, retake_ids: { type: 'ARRAY', items: S }, allow_estimated: B, dry_run: B }, required: [] } },
  { name: 'find_highlights', description: 'Rank sentences that could open the video or stand alone as a short (question, numbers, strong words, clean start). With clip_length_sec, also returns ready keep_ranges windows that start on a candidate and end on a sentence boundary. Heuristic candidates: read their text and judge them before using.',
    parameters: { type: 'OBJECT', properties: { ...SPEECH, limit: I, clip_length_sec: N }, required: [] } },
  { name: 'propose_edit_plan', description: 'Show the user an edit plan card before a substantial edit. After calling it, stop and ask the user to approve or change the plan; do not edit until they approve. Skip it for small fixes, when the user said to go ahead, or when continuing an approved plan.',
    parameters: { type: 'OBJECT', properties: {
      goal: S, platform: { ...S, enum: PLATFORMS }, target_duration_sec: N, hook: S,
      story: { type: 'ARRAY', maxItems: 20, items: { type: 'OBJECT', properties: { start_sec: N, end_sec: N, note: S }, required: ['note'] } },
      cuts: { type: 'ARRAY', maxItems: 12, items: S }, visuals: { type: 'ARRAY', maxItems: 12, items: S },
      audio: { type: 'ARRAY', maxItems: 8, items: S }, captions: S, questions: { type: 'ARRAY', maxItems: 4, items: S },
    }, required: ['goal', 'hook', 'story'] } },
  { name: 'critique_edit', description: 'Review the current edit like a senior editor: black gaps, pacing (time without visual change), hook in the first 3 s, remaining fillers/retakes/dead air, caption reading speed and safe area, title readability, music level under speech, loudness and true peak, transitions and target duration. Returns a 0–100 score and issues with time and fix. Fix high/medium issues before finishing.',
    parameters: { type: 'OBJECT', properties: { platform: { ...S, enum: PLATFORMS }, target_duration_sec: N, measure_loudness: B, speech: { ...S, enum: ['cached', 'transcribe', 'none'], description: 'cached (default) reuses this request’s transcript; transcribe refreshes it' } }, required: [] } },
  { name: 'get_beats', description: 'Beat grid of the music (or selected sources) in timeline seconds: bpm, beats, downbeats (bar starts), accents (strong hits). Cut, zoom or pop text on the beat; select music with clip_ids and source audio.',
    parameters: { type: 'OBJECT', properties: { clip_ids: { type: 'ARRAY', items: S }, source: { ...S, enum: ['all', 'video', 'overlay', 'audio'] }, ...RANGE }, required: [] } },
];
export const EDITORIAL_TOOL_NAMES = EDITORIAL_DECLARATIONS.map(t => t.name);

const clean = (value, max = 400) => typeof value === 'string' ? value.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max) : '';
const list = (value, max, len = 200) => Array.isArray(value) ? value.map(v => clean(v, len)).filter(Boolean).slice(0, max) : [];

// A sanitized, display-safe plan for the chat card.
export function normalizePlan(a = {}) {
  const num = v => Number.isFinite(v) && v >= 0 ? r2(v) : undefined;
  return {
    goal: clean(a.goal, 300), platform: PLATFORMS.includes(a.platform) ? a.platform : undefined, target_duration_sec: num(a.target_duration_sec),
    hook: clean(a.hook, 300),
    story: (Array.isArray(a.story) ? a.story : []).slice(0, 20).map(s => ({ start_sec: num(s?.start_sec), end_sec: num(s?.end_sec), note: clean(s?.note, 240) })).filter(s => s.note),
    cuts: list(a.cuts, 12), visuals: list(a.visuals, 12), audio: list(a.audio, 8), captions: clean(a.captions, 240), questions: list(a.questions, 4, 240),
  };
}

export function createEditorialTools({ project, dispatch, after, api, requestId, speech, sceneData, settle, isCanceled }) {
  // The words this request knows for the current audible timeline. After our
  // own cuts they are remapped instead of transcribing again.
  let known = null;
  const selection = a => ({ source: a.source || 'all', clip_ids: a.clip_ids });
  const revisionFor = a => audioRevision(renderable(project()), selection(a));
  const wordsFor = async (a = {}, { transcribe = true } = {}) => {
    const sel = selection(a), rev = revisionFor(a);
    if (known && known.revision === rev && known.source === sel.source && JSON.stringify(known.clip_ids || null) === JSON.stringify(sel.clip_ids || null)) return { words: known.words, language: known.language, cached: true };
    if (!transcribe) return { words: null };
    const res = await speech({ ...a, verbatim: true });
    if (res.error) return res;
    const words = transcriptWords(res.segments || []);
    known = { revision: revisionFor(a), ...sel, words, language: a.language && a.language !== 'auto' ? a.language : res.language || 'auto' };
    return { words, language: known.language, cached: !!res.cached };
  };
  const applyCuts = async (cuts, a) => {
    const before = project();
    if (cutRanges(before, cuts, { ripple: true }) === before) return { error: 'The range edit is blocked by a locked related track or has no editable footage.' };
    const total = exportDuration(before), kept = known;
    dispatch({ type: 'cutRanges', ranges: cuts, ripple: true });
    await settle();
    if (kept) known = { ...kept, words: remapWords(kept.words, cuts), revision: revisionFor(a) };
    return { removed_sec: r2(total - exportDuration(project())) };
  };
  // Cut ranges for transcript spans. With the host available, each edge is
  // snapped to a real pause in the audio (Whisper word times drift by
  // 0.1–0.3 s); spans without a clean pause are skipped with a reason.
  const cutsFor = async (spans, words, a, { handle_sec = 0.04, allow_estimated = false } = {}) => {
    const total = exportDuration(project()), rate = fps();
    if (!api.agentRefineCuts) return { ...wordCuts(spans, words, { total, fps: rate, handle_sec, allow_estimated }), boundaries: 'transcript' };
    const skipped = spans.filter(s => s.estimated && !allow_estimated).map(s => ({ ...s, reason: 'estimated word timing' }));
    const eligible = spans.filter(s => allow_estimated || !s.estimated);
    if (!eligible.length) return { cuts: [], skipped, boundaries: 'audio' };
    // Snap edges on the speech itself: a music bed fills the pauses between words.
    // Without an explicit selection, use the picture tracks and generated narration.
    let sel = known ? { source: known.source, clip_ids: known.clip_ids } : selection(a);
    if (sel.source === 'all' && !sel.clip_ids?.length) {
      const p = project(), media = id => p.media.find(m => m.id === id);
      const speech = [...p.videoClips.filter(c => !c.gap && (media(c.mediaId)?.hasAudio || media(c.mediaId)?.type === 'audio')), ...(p.overlayClips || []).filter(c => media(c.mediaId)?.hasAudio),
        ...(p.audioClips || []).filter(c => media(c.mediaId)?.origin === 'tts')].filter(c => !c.muted && !c.disabled).map(c => c.id);
      if (speech.length) sel = { source: 'all', clip_ids: speech };
    }
    const res = await api.agentRefineCuts(renderable(project()), { requestId, ...sel, language: known?.language, spans: eligible.map(s => ({ start: s.start, end: s.end,
      ...(s.word ? { kind: 'word', prev_end: words.filter(w => w.end <= s.start + 1e-6).at(-1)?.end } : {}) })) });
    if (res?.canceled) return { error: 'Cut analysis stopped.' };
    if (!res?.ok || res.ranges?.length !== eligible.length) return { error: res?.error || 'Audio cut analysis failed.' };
    const cuts = [];
    res.ranges.forEach((r, i) => {
      if (r.skip) { skipped.push({ ...eligible[i], reason: r.skip }); return; }
      const start = Math.max(0, Math.ceil(r.start * rate - 1e-6) / rate), end = Math.min(total, Math.floor(r.end * rate + 1e-6) / rate);
      if (end - start >= 1 / rate - 1e-7) cuts.push({ start, end }); else skipped.push({ ...eligible[i], reason: 'shorter than one frame' });
    });
    const merged = cuts.sort((x, y) => x.start - y.start).reduce((out, c) => { const last = out.at(-1); if (last && c.start <= last.end + 1e-6) last.end = Math.max(last.end, c.end); else out.push({ ...c }); return out; }, []);
    return { cuts: merged, skipped, boundaries: 'audio' };
  };
  const inRange = (a, span) => (a.start_sec === undefined || span.start >= a.start_sec) && (a.end_sec === undefined || span.end <= a.end_sec);
  const fps = () => project().fps || 30;

  return {
    async edit_guide({ topic }) {
      if (topic === 'workflow') return { topic, guide: EDIT_WORKFLOW };
      if (!Object.hasOwn(EDIT_GUIDE, topic)) return { error: `Unknown topic. Use workflow, ${GUIDE_TOPICS.join(', ')}.` };
      return { topic, guide: EDIT_GUIDE[topic], ...(topic !== 'principles' ? { also_read: 'principles' } : {}) };
    },

    async log_footage(a = {}) {
      const offset = Number.isInteger(a.offset) && a.offset >= 0 ? a.offset : 0, limit = Number.isInteger(a.limit) && a.limit > 0 ? Math.min(80, a.limit) : 40;
      let res = await wordsFor(a);
      // A timeline with nothing audible (empty, silent or muted) has no speech to log, not an error.
      const silent = res.error && /^No audible clips/.test(res.error);
      if (res.error && !silent) return res;
      if (silent) res = { words: [], language: 'none', cached: false, note: exportDuration(project()) ? `No speech to log: ${res.error}` : 'The timeline is empty: there is no footage or speech to log yet.' };
      const words = res.words, list = sentences(words), fillers = findFillers(words, { language: res.language }), retakes = findRetakes(words, list);
      const hooks = hookCandidates(list, { limit: 6 });
      let shots = [];
      if (a.include_scenes !== false) {
        try { shots = (await sceneData({})).rows || []; } catch (error) { shots = [{ error: error.message }]; }
      }
      if (isCanceled?.()) return { error: 'Logging stopped.' };
      const shotAt = t => shots.find(s => !s.error && s.start_sec <= t && s.end_sec > t);
      const rows = list.map(s => {
        const flags = [], shot = shotAt((s.start + s.end) / 2);
        const f = fillers.filter(x => x.start >= s.start - 1e-6 && x.end <= s.end + 1e-6).length;
        if (f) flags.push(`${f} filler${f > 1 ? 's' : ''}`);
        const r = retakes.find(x => x.kind !== 'stutter' && x.start < s.end - 1e-6 && x.end > s.start + 1e-6);
        if (r) flags.push(r.kind === 'restart' ? 'contains a false start (later take kept)' : 'restart cue');
        if (hooks.some(h => h.sentence_id === s.id)) flags.push('hook candidate');
        if (s.estimated) flags.push('estimated timing');
        return { id: s.id, start: r2(s.start), end: r2(s.end), text: s.text, ...(shot ? { shot: shot.scene_id, ...(shot.observation ? { shot_note: String(shot.observation.description || shot.observation).slice(0, 160) } : {}) } : {}), ...(flags.length ? { flags } : {}) };
      });
      const total = exportDuration(project()), speechSec = list.reduce((n, s) => n + s.end - s.start, 0);
      return {
        duration_sec: r2(total), speech_sec: r2(speechSec), words: words.length, words_per_min: r2(words.length / Math.max(1 / 60, speechSec / 60)),
        language: res.language, transcript_cached: res.cached, sentences_total: rows.length, offset, next_offset: offset + limit < rows.length ? offset + limit : null,
        sentences: rows.slice(offset, offset + limit),
        fillers: { count: fillers.length, examples: [...new Set(fillers.map(f => f.text.toLocaleLowerCase()))].slice(0, 8) },
        retakes: retakes.filter(r => r.kind !== 'stutter').slice(0, 10).map(r => ({ kind: r.kind, start: r2(r.start), end: r2(r.end), removed: r.removed.slice(0, 120), kept: r.kept.slice(0, 120) })),
        stutters: retakes.filter(r => r.kind === 'stutter').length,
        hook_candidates: hooks,
        shots: shots.some(s => s.error) ? { error: shots[0].error } : { count: shots.length, observed: shots.filter(s => s.observation).length },
        note: res.note || 'Flags are heuristic. Read the sentences, judge the story, then plan. Shot links are visual candidates; inspect frames before describing content.',
      };
    },

    async remove_fillers(a = {}) {
      const res = await wordsFor(a);
      if (res.error) return res;
      const spans = findFillers(res.words, { language: res.language, discourse: !!a.discourse }).filter(s => inRange(a, s)).map(s => ({ ...s, word: s.first === s.last }));
      if (!spans.length) return { ok: true, removed_count: 0, removed_sec: 0, note: 'No filler words found in the transcript.' };
      const handle = Number.isFinite(a.handle_sec) ? Math.min(0.2, Math.max(0, a.handle_sec)) : 0.04;
      const planned = await cutsFor(spans, res.words, a, { handle_sec: handle, allow_estimated: !!a.allow_estimated });
      if (planned.error) return planned;
      const { cuts, skipped } = planned;
      const summary = { found: spans.length, cuts: cuts.length, boundaries: planned.boundaries, examples: [...new Set(spans.map(s => s.text.toLocaleLowerCase()))].slice(0, 8), skipped: skipped.length,
        ...(skipped.length ? { skipped_reasons: [...new Set(skipped.map(s => s.reason))], skipped_at: skipped.slice(0, 12).map(s => ({ text: s.text, at_sec: r2(s.start), reason: s.reason })) } : {}) };
      if (a.dry_run) return { ok: true, dry_run: true, ...summary, ranges: cuts.slice(0, 40).map(c => ({ start: r2(c.start), end: r2(c.end) })) };
      if (!cuts.length) return { ok: true, removed_count: 0, removed_sec: 0, ...summary, note: 'Fillers were found but none could be cut safely.' };
      const out = await applyCuts(cuts, a);
      if (out.error) return out;
      return after({ removed_count: cuts.length, ...out, ...summary, speech_after: 'Transcript words were remapped through the cuts; no new transcription is needed.' });
    },

    // Retake ids name the candidate itself (its kind, text and the words just before it), never its
    // place in the list: after any cut an id remembered from a dry run still names the same sentence,
    // or no candidate at all (then it is refused as unknown).
    async remove_retakes(a = {}) {
      const res = await wordsFor(a);
      if (res.error) return res;
      const kinds = Array.isArray(a.kinds) && a.kinds.length ? a.kinds : ['restart', 'stutter'];
      const all = retakeIds(findRetakes(res.words), res.words);
      const chosen = all.filter(r => (Array.isArray(a.retake_ids) && a.retake_ids.length ? a.retake_ids.includes(r.id) : kinds.includes(r.kind)));
      const view = r => ({ id: r.id, kind: r.kind, start: r2(r.start), end: r2(r.end), removed: r.removed.slice(0, 160), kept: r.kept.slice(0, 160), ...(r.estimated ? { estimated: true } : {}) });
      if (a.dry_run) return { ok: true, dry_run: true, candidates: all.slice(0, 40).map(view), selected: chosen.map(r => r.id), note: 'Read removed vs kept. Apply with retake_ids for real retakes only.' };
      if (Array.isArray(a.retake_ids) && a.retake_ids.some(id => !all.some(r => r.id === id))) return { error: 'Some retake_ids are unknown for the current audio. Run with dry_run true again.' };
      if (!chosen.length) return { ok: true, removed_count: 0, removed_sec: 0, note: 'No retakes matched.' };
      const planned = await cutsFor(chosen.map(r => ({ ...r, word: r.kind === 'stutter' })), res.words, a, { handle_sec: 0.05, allow_estimated: !!a.allow_estimated });
      if (planned.error) return planned;
      const { cuts, skipped } = planned;
      if (!cuts.length) return { ok: true, removed_count: 0, removed_sec: 0, skipped: skipped.length, skipped_reasons: [...new Set(skipped.map(s => s.reason))], note: 'No retake could be cut cleanly. Estimated timings need allow_estimated after checking them.' };
      const out = await applyCuts(cuts, a);
      if (out.error) return out;
      return after({ removed_count: cuts.length, ...out, boundaries: planned.boundaries, removed: chosen.filter(r => !skipped.some(s => s.id === r.id)).slice(0, 12).map(view), skipped: skipped.length, ...(skipped.length ? { skipped_reasons: [...new Set(skipped.map(s => s.reason))] } : {}) });
    },

    async find_highlights(a = {}) {
      const res = await wordsFor(a);
      if (res.error) return res;
      const list = sentences(res.words), limit = Number.isInteger(a.limit) && a.limit > 0 ? Math.min(20, a.limit) : 8;
      const hooks = hookCandidates(list, { limit });
      const len = Number(a.clip_length_sec), total = exportDuration(project());
      const windows = Number.isFinite(len) && len >= 5 ? hooks.map(h => {
        const first = list.findIndex(s => s.id === h.sentence_id);let end = list[first].end, k = first;
        while (k + 1 < list.length && list[k + 1].end - list[first].start <= len * 1.15) end = list[++k].end;
        return { from_sentence: h.sentence_id, start_sec: r2(Math.max(0, list[first].start - 0.15)), end_sec: r2(Math.min(total, end + 0.25)), sentences: k - first + 1, text: list.slice(first, k + 1).map(s => s.text).join(' ').slice(0, 400) };
      }) : undefined;
      return { candidates: hooks, ...(windows ? { windows } : {}), sentences_total: list.length,
        note: 'Signals are heuristic (question, number, strong words, clean start). Judge meaning yourself; for a short, use keep_ranges with a window and then tighten it.' };
    },

    async propose_edit_plan(a = {}) {
      const plan = normalizePlan(a);
      if (!plan.goal || !plan.hook || !plan.story.length) return { error: 'A plan needs goal, hook and at least one story step.' };
      return { ok: true, status: 'awaiting_approval', plan,
        note: 'The plan is shown to the user with Approve and Change buttons. End this turn now: summarize it in 1–2 sentences and ask for approval. Do not edit until the user approves.' };
    },

    async critique_edit(a = {}) {
      const mode = a.speech || 'cached';
      let words = null, speechNote;
      if (mode !== 'none') {
        // Reuse the speech selection the transcript was made from (e.g. the voice track only).
        const res = await wordsFor(known ? { source: known.source, clip_ids: known.clip_ids, language: known.language } : {}, { transcribe: mode === 'transcribe' });
        if (res.error) speechNote = `Speech checks skipped: ${res.error}`;
        else if (res.words) words = res.words;
        else speechNote = 'Speech checks skipped: no transcript for the current audio in this request (use speech "transcribe" to refresh).';
      }
      let loudness = null, loudNote;
      if (a.measure_loudness !== false && api.agentLoudness) {
        const res = await api.agentLoudness(renderable(project()), { requestId });
        if (res?.ok) loudness = { integrated_lufs: res.integrated_lufs, true_peak_db: res.true_peak_db };
        else if (res?.canceled) return { error: 'Review stopped.' };
        else loudNote = `Loudness not measured: ${res?.error || 'unavailable'}`;
      }
      const review = critiqueProject(project(), { words, loudness, target_duration_sec: a.target_duration_sec, platform: a.platform });
      return { score: review.score, issues: review.issues.slice(0, 20), more_issues: Math.max(0, review.issues.length - 20), metrics: review.metrics,
        checked: { speech: !!words, loudness: !!loudness }, ...(speechNote ? { speech_note: speechNote } : {}), ...(loudNote ? { loudness_note: loudNote } : {}),
        note: 'Fix high and medium issues, or tell the user why one is intentional. Re-run after fixing. Heuristic checks do not replace looking at frames.' };
    },

    async get_beats(a = {}) {
      if (!api.agentBeats) return { error: 'Beat analysis requires an updated ClipCraft.' };
      const res = await api.agentBeats(renderable(project()), { requestId, source: a.source || (a.clip_ids?.length ? 'all' : 'audio'), clip_ids: a.clip_ids, start_sec: a.start_sec, end_sec: a.end_sec });
      if (res?.canceled) return { error: 'Beat analysis stopped.' };
      if (!res?.ok) return { error: res?.error || 'Beat analysis failed.' };
      const cap = (xs, n) => xs.length > n ? { values: xs.slice(0, n), more: xs.length - n } : { values: xs };
      return { bpm: res.bpm, tempo_confidence: res.tempo_confidence, beat_sec: res.bpm ? r2(60 / res.bpm) : null,
        beats: cap(res.beats, 240), downbeats: cap(res.downbeats, 80), accents: cap(res.accents, 80), downbeat_method: res.downbeat_method, analyzed_sec: res.analyzed_sec,
        note: res.tempo_confidence < 0.25 ? 'Low tempo confidence: the audio may not have a steady beat; prefer accents.' : 'Timeline seconds. Cut or pop on downbeats for structure, on beats for fast montages.' };
    },
  };
}
