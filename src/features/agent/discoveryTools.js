import { projectRevision } from './context.js';
import { videoLayout, isLayerLocked } from '../../state/store.js';

const S = { type: 'STRING' }, N = { type: 'NUMBER' }, I = { type: 'INTEGER' }, B = { type: 'BOOLEAN' };
const SOURCE = { media_id: S, index_id: S };
export const DISCOVERY_READS = ['get_video_analysis', 'index_video', 'read_video_transcript', 'find_video_moments', 'review_video_moment', 'propose_video_clips'];
export const DISCOVERY_DECLARATIONS = [
  { name: 'get_video_analysis', description: 'List cached index IDs, visual/speech coverage, languages, missing evidence and a recommended view. Source evidence is independent of timeline audio or narration. Does not process or edit footage.',
    parameters: { type: 'OBJECT', properties: { media_id: S, offset: I, limit: I }, required: ['media_id'] } },
  { name: 'index_video', description: 'Build missing local source evidence; first get_video_analysis to reuse work. Scans and transcripts are shared across options. speech defaults true; false skips NEW recognition without hiding cached text. Reports visual and speech coverage separately; missing text is not silence. Default 8 chunks of 120 sec per call; repeat SAME options until complete. No timeline edits or uploads.',
    parameters: { type: 'OBJECT', properties: { media_id: S, chunk_sec: I, max_chunks: I, speech: B, language: S }, required: ['media_id'] } },
  { name: 'read_video_transcript', description: 'Page timestamped original SOURCE dialogue, not timeline audio, narration or captions. Bounds use source seconds; follow next_offset before claiming full reading. query is literal search. Coverage/warnings distinguish missing speech from empty recognition; crossing boundary text may be omitted to honor scope.',
    parameters: { type: 'OBJECT', properties: { ...SOURCE, start_sec: N, end_sec: N, offset: I, limit: I, query: S }, required: ['media_id', 'index_id'] } },
  { name: 'find_video_moments', description: 'Retrieve paginated source clip candidates from index_video. kind adapts local signal weights to movie, stream, gameplay, talk or general. Query is literal transcript search, not semantic video search. Also returns quiet chronological exploration samples; page them with offset and next_exploration_offset. Signal score is NOT quality. Read transcripts and review promising candidates AND quiet samples with review_video_moment. Compare meaning, originality, setup/payoff and user intent before ranking. Reports partial coverage honestly.',
    parameters: { type: 'OBJECT', properties: { ...SOURCE, kind: { ...S, enum: ['general', 'movie', 'stream', 'gameplay', 'talk'] }, query: S, clip_length_sec: N, start_sec: N, end_sec: N, offset: I, limit: I }, required: ['media_id', 'index_id'] } },
  { name: 'review_video_moment', description: 'Review a candidate or refined SOURCE range (up to 90 sec): produces a playable local preview, transcript context, audio/change measurements and 6 ordered raw source images attached to your next vision turn. Use moment_id with the exact candidate range, or omit it for explicit refined boundaries. Read images before proposing. Refine to keep context and payoff, inspect extra raw frames for brief events. No claim to hear continuous audio or watch continuous action from stills. Returns review_id and frame_ids needed for propose_video_clips.',
    parameters: { type: 'OBJECT', properties: { ...SOURCE, moment_id: S, start_sec: N, end_sec: N }, required: ['media_id', 'index_id', 'start_sec', 'end_sec'] } },
  { name: 'propose_video_clips', description: 'Show 1–6 ranked clip cards with playable previews, source timestamps, reasons and low/medium/high confidence. Supply picks best-first after reading review frames and transcript. After extensive exploration, re-review finalists just before proposing, since old frame handles expire. Each needs review_id and presented frame_ids from THIS request spanning start/middle/end. Avoid overlap and unsupported event/emotion/audio claims. Does not change timeline. State remaining coverage; confidence is your judgment, not measured probability.',
    parameters: { type: 'OBJECT', properties: { ...SOURCE, picks: { type: 'ARRAY', items: { type: 'OBJECT', properties: { review_id: S, frame_ids: { type: 'ARRAY', items: S }, title: S, reason: S, confidence: { ...S, enum: ['low', 'medium', 'high'] } }, required: ['review_id', 'frame_ids', 'title', 'reason', 'confidence'] } } }, required: ['media_id', 'index_id', 'picks'] } },
  { name: 'add_video_clip', description: 'Append ONE previously proposed source pick to the main timeline at normal speed, using its validated exact source range. Existing clips stay in place. The user must request this addition or choose Add to timeline on its card. Analysis/proposals alone do not authorize adding. Saved pick is checked against the current source fingerprint; stale/replaced files are refused. Then finish/review with the normal editor tools.',
    parameters: { type: 'OBJECT', properties: { ...SOURCE, pick_id: S }, required: ['media_id', 'index_id', 'pick_id'] } },
];

export function createDiscoveryTools({ project, api, requestId, evidenceId, isCanceled, onProgress, editActive, place, dispatch, settle, after, analysisScope }) {
  const call = async (action, args) => {
    if (!api.agentSourceDiscovery) throw Error('Source discovery requires an updated ClipCraft.');
    if (isCanceled?.() || editActive?.() === false) throw Error('Source discovery stopped.');
    const result = await api.agentSourceDiscovery({ ...args, action, requestId, ...(evidenceId ? { evidenceId } : {}), project: { media: project().media } });
    if (isCanceled?.() || editActive?.() === false) throw Error('Source discovery stopped. Completed index chunks were kept.');
    if (!result?.ok) return { ...result, error: result?.error || 'Source discovery failed.' };
    return result;
  };
  return {
    async get_video_analysis({ media_id, ...options }) { return call('describe', { media_id, options }); },
    async index_video({ media_id, ...options }) {
      const off = api.onAgentSourceProgress?.(p => { if (p.requestId === requestId) onProgress?.({ phase: 'index', progress: p.total_chunks ? p.completed_chunks / p.total_chunks : 0, stage: p.stage, step: p.completed_chunks, steps: p.total_chunks }); });
      try { return await call('index', { media_id, options }); } finally { off?.(); }
    },
    async find_video_moments({ media_id, index_id, ...options }) { return call('find', { media_id, index_id, options }); },
    async read_video_transcript({ media_id, index_id, ...options }) { return call('transcript', { media_id, index_id, options }); },
    async review_video_moment(a) {
      const revision = projectRevision(project()), result = await call('review', { ...a, ...(analysisScope ? { context_start_sec: analysisScope.start_sec, context_end_sec: analysisScope.end_sec } : {}) });
      if (result.error) return result;
      if (projectRevision(project()) !== revision) throw Error('The project changed while reviewing this source.');
      const capture = await api.agentInspectFrames({ project: { ...project(), craftAI: undefined }, source: 'media', media_id: a.media_id, source_times_sec: result.sample_times_sec, revision, requestId });
      if (capture?.error || isCanceled?.() || editActive?.() === false) return { error: capture?.error || 'Source inspection stopped.' };
      if (projectRevision(project()) !== revision || capture.frames.some(f => f.fingerprint !== result.fingerprint)) throw Error('Source or project changed during inspection. Review again.');
      // Raw individual images retain detail for fast actions. The normal agent
      // image transport records actual presentation before a proposal is accepted.
      return { ...result, frames: capture.frames, frame_ids: capture.frames.map(f => f.id), revision };
    },
    async propose_video_clips(a) { return call('propose', a); },
    async add_video_clip(a) {
      const revision = projectRevision(project()), result = await call('pick', a);
      if (result.error) return result;
      if (projectRevision(project()) !== revision) throw Error('The project changed before adding this clip.');
      if (isLayerLocked(project(), 'video', 0)) throw Error('Unlock the main video track before adding a clip.');
      const media = project().media.find(m => m.id === a.media_id), pick = result.pick;
      const added = await place(media, { source_in: pick.start_sec, source_out: pick.end_sec });
      if (added.error) return added;
      dispatch({ type: 'update', track: 'video', id: added.clip_id, patch: { in: pick.start_sec, out: pick.end_sec, speed: 1, name: pick.title } });
      await settle();const row = videoLayout(project().videoClips).find(r => r.clip.id === added.clip_id);
      if (!row || Math.abs(row.clip.in - pick.start_sec) > .001 || Math.abs(row.clip.out - pick.end_sec) > .001) throw Error('The selected source range was not added correctly.');
      return after({ ...added, source_start_sec: pick.start_sec, source_end_sec: pick.end_sec, start_sec: row.start, end_sec: row.end });
    },
  };

}
