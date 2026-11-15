import { ANALYSIS_READS, scopedAnalysisCall } from '../../../shared/subagents.mjs';
import { createToolRunner } from './tools.js';
import { projectRevision } from './context.js';

// Child callbacks bypass the parent's serialized editing queue (the parent is
// waiting on their batch). Each child has its own read-only runner and queue.
export function createAnalysisHost({ ctx, requestId, isCanceled, enabled = false }) {
  let snapshot = null;
  let completed = 0, skipped = null, visualOnlyReason = '';
  const children = new Map();
  const check = () => {
    if (!snapshot || isCanceled()) throw Error('Analysis stopped.');
    if (ctx.editActive?.() === false || projectRevision(ctx.getProject()) !== snapshot.revision) {
      Promise.resolve(ctx.api.agentCancel?.(requestId)).catch(() => {});
      throw Error('The editor changed during delegated analysis.');
    }
  };
  return {
    async delegate(args) {
      if (snapshot) throw Error('An analysis batch is already active.');
      snapshot = { project: structuredClone(ctx.getProject()), revision: projectRevision(ctx.getProject()) };
      try {
        check();
        if (!ctx.api.agentDelegateAnalysis) throw Error('Restart ClipCraft to use analysis subagents.');
        const result = await ctx.api.agentDelegateAnalysis({ ...args, requestId, revision: snapshot.revision, project: { media: snapshot.project.media } });
        check();
        if (result?.ok === true && Array.isArray(result.tasks)) {
          const inspected = result.tasks.filter(task => task.status === 'completed' && task.reviewed_ranges?.some(r => Number.isFinite(r.start_sec) && Number.isFinite(r.end_sec) && r.end_sec > r.start_sec));
          completed += inspected.length;
          if (inspected.length && result.evidence?.missing_speech && result.evidence.mode === 'visual_only') visualOnlyReason = result.evidence.visual_only_reason;
        }
        return result;
      } finally { snapshot = null;children.clear(); }
    },
    async run(call) {
      check();const scope = call.analysis;
      if (call.requestId !== requestId || !scope || typeof scope.request_id !== 'string' || !scope.request_id.startsWith(`${requestId}:analysis:`)) throw Error('Unknown analysis request.');
      if (!ANALYSIS_READS.includes(call.name)) throw Error('Analysis subagents cannot edit the timeline.');
      let child = children.get(scope.request_id);
      if (!child) {
        const media = snapshot.project.media.find(m => m.id === scope.media_id);
        if (!media || scope.revision !== snapshot.revision) throw Error('Analysis snapshot is no longer current.');
        const project = { ...snapshot.project, craftAI: undefined, media: [media], videoClips: [], overlayClips: [], audioClips: [], textClips: [], effectClips: [] };
        child = { scope: JSON.stringify(scope), queue: Promise.resolve(), runner: createToolRunner({ ...ctx, requestId: scope.request_id, analysisScope: scope,
          getProject: () => { check();return project; }, dispatch: () => { throw Error('Analysis subagents cannot write to the editor.'); },
          editActive: () => { try { check();return true; } catch { return false; } }, isCanceled, settle: async () => {},
        }) };children.set(scope.request_id, child);
      }
      if (child.scope !== JSON.stringify(scope)) throw Error('An analysis task cannot change its assigned scope.');
      const args = scopedAnalysisCall(call.name, call.args, scope);
      const execute = async () => { check();const result = await child.runner.run(call.name, args);check();return result; };
      const task = child.queue.then(execute);child.queue = task.catch(() => {});return task;
    },
    // An unchanged project or a proposed plan must not bypass the delegation
    // decision. Count completed children, not tool availability or attempts.
    ready: () => !enabled || completed > 0 || !!skipped,
    verify(args = {}) {
      if (!enabled || completed > 0) return null;
      if (typeof args.subagent_skip?.reason === 'string' && args.subagent_skip.reason.trim()) skipped = { ...args.subagent_skip, reason: args.subagent_skip.reason.trim() };
      if (skipped) return null;
      return { ready: false, subagents_required: true,
        note: 'Subagents are enabled but no child analysis has completed. If the user requested subagents, use them for source analysis before finishing or proposing the final plan. Index the relevant source ranges, then call delegate_video_analysis and read its results. If delegation is not applicable or cannot run, call complete_edit with subagent_skip containing the specific reason; the user will see it. Do not skip an explicit request merely because the task is small.' };
    },
    report: () => !enabled ? {} : { subagents: completed > 0 ? { status: 'used', tasks_completed: completed, ...(visualOnlyReason ? { missing_speech: true, visual_only_reason: visualOnlyReason } : {}) } : skipped || { status: 'pending' } },
    get skipReason() { return completed > 0 ? '' : skipped?.reason || ''; },
    get visualOnlyReason() { return visualOnlyReason; },
    clear() { snapshot = null;children.clear(); },
  };
}
