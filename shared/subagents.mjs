// One delegation contract for the renderer and native host. Children are source
// analysts, never additional editors. These limits also apply to reviewers.
import limits from './subagentLimits.json' with { type: 'json' };
export const SUBAGENT_LIMITS = Object.freeze(limits);
export const ANALYSIS_READS = ['read_video_transcript', 'find_video_moments', 'review_video_moment', 'inspect_frames'];
const S = { type: 'STRING' }, N = { type: 'NUMBER' };
export const SUBAGENT_SKIP = {
  type: 'OBJECT', description: 'Only when no child analysis completed: explain why delegation was not applicable or could not run. If the user explicitly requested subagents, a small task or preference for working alone is not a reason to skip; identify a concrete capability, source, indexing or runtime limitation. This reason is shown to the user.',
  properties: {
    status: { ...S, enum: ['not_applicable', 'unavailable'] },
    reason: { ...S, minLength: 1, maxLength: 1000, description: 'Specific, honest explanation of why no subagents ran. Never claim that an attempted or failed batch completed.' },
  }, required: ['status', 'reason'], additionalProperties: false,
};
export const DELEGATE_ANALYSIS = {
  name: 'delegate_video_analysis',
  description: `Delegate independent source analysis to native subagents, or ask reviewers to compare supplied candidate ranges. First get_video_analysis to reuse evidence, then index_video for missing coverage. Default evidence_mode audiovisual requires speech-processing coverage when the source has audio. Explicit visual_only requires a concrete visual_only_reason, disclosed in the result; missing dialogue cannot be treated as silence. Up to ${limits.tasksPerBatch} tasks per batch and ${limits.tasksPerRequest} tasks per request; concurrency follows the user's selected limit (1–${limits.maxConcurrent}). Children inherit provider/model and use only source inspection tools, including paginated source dialogue. Give analysts distinct ranges; give reviewers compact candidate context. Findings include actual reviewed ranges and frame provenance, not authority to edit or a claim to have watched the whole assigned range. Personally review finalists with your own frames. Stop cancels all children. Extra model requests apply.`,
  parameters: { type: 'OBJECT', properties: {
    media_id: S, index_id: S,
    evidence_mode: { ...S, enum: ['audiovisual', 'visual_only'], description: 'Default audiovisual. Use visual_only only when dialogue is unnecessary for the assigned work or a speech limitation has been explicitly accepted.' },
    visual_only_reason: { ...S, minLength: 1, maxLength: 1000, description: 'Required with visual_only. Specific reason this analysis can proceed without complete speech evidence; shown to the user if speech coverage is missing.' },
    tasks: { type: 'ARRAY', minItems: 1, maxItems: limits.tasksPerBatch, items: { type: 'OBJECT', properties: {
      role: { ...S, enum: ['analyst', 'reviewer'] }, start_sec: N, end_sec: N, task: { ...S, minLength: 1, maxLength: 6000, description: 'Focused instructions. For reviewers summarize candidate ranges, titles and reasons; omit frame-provenance arrays. The reviewer inspects its own source evidence.' },
    }, required: ['role', 'start_sec', 'end_sec', 'task'], additionalProperties: false } },
  }, required: ['media_id', 'index_id', 'tasks'], additionalProperties: false },
};
export const SUBMIT_ANALYSIS = {
  name: 'submit_analysis', description: 'Finish your source analysis with a short summary and up to 3 nonoverlapping findings in best-first order. Review at least one actual source passage before any submission, even empty findings. Each finding must match a review_video_moment range you actually inspected and include its review_id and 3–6 presented raw frame_ids spanning beginning/middle/end. Explain setup/payoff and uncertainty; do not infer game events, emotions or audio meaning from signals alone. Empty findings mean none found in inspected passages, never that the whole assigned source was watched. This submits findings to the parent, never edits the timeline.',
  parameters: { type: 'OBJECT', properties: {
    summary: { ...S, minLength: 1, maxLength: 1800 }, findings: { type: 'ARRAY', maxItems: 3, items: { type: 'OBJECT', properties: {
      review_id: S, start_sec: N, end_sec: N, title: { ...S, minLength: 1, maxLength: 120 }, reason: { ...S, minLength: 1, maxLength: 1000 },
      confidence: { ...S, enum: ['low', 'medium', 'high'] }, frame_ids: { type: 'ARRAY', minItems: 3, maxItems: 6, items: S },
    }, required: ['review_id', 'start_sec', 'end_sec', 'title', 'reason', 'confidence', 'frame_ids'], additionalProperties: false } },
  }, required: ['summary', 'findings'], additionalProperties: false },
};

export function scopedAnalysisCall(name, args, scope) {
  if (!ANALYSIS_READS.includes(name)) throw Error('Analysis subagents can only inspect source footage. Timeline edits, exports, external tools and delegation are unavailable.');
  if (args.media_id !== scope.media_id) throw Error('Inspect only the source assigned to this analysis task.');
  const inside = t => Number.isFinite(t) && t >= scope.start_sec && t < scope.end_sec;
  if (name === 'inspect_frames') {
    if (args.source !== 'media' || !Array.isArray(args.source_times_sec) || !args.source_times_sec.length || args.source_times_sec.some(t => !inside(t))) throw Error('Inspect raw media frames inside the assigned source range.');
    return args;
  }
  if (args.index_id !== scope.index_id) throw Error('Use the video index assigned to this analysis task.');
  const start = args.start_sec ?? scope.start_sec, end = args.end_sec ?? scope.end_sec;
  if (!inside(start) || !Number.isFinite(end) || end <= start || end > scope.end_sec) throw Error('Keep analysis inside the assigned source range.');
  return { ...args, start_sec: start, end_sec: end };
}
