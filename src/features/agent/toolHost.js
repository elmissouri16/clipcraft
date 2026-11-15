// The editor side of every native tool call (docs/design/external-agent-mcp.md): validation,
// execution, operation IDs, failures, the completion check (complete_edit), visual coverage and
// activity events, behind one serialized queue. Native agents (runNativeAgent.js) and external MCP
// agents (externalHost.js) run their calls through this one host, so both get the same treatment.
import { createToolRunner, describeImageProgress } from './tools.js';
import { clearsFailure, describeCall, editTarget, failureTargets, pruneFailures, unresolvedReport } from './runAgent.js';
import { validateToolCall } from "../../../shared/toolArguments.mjs";
import { projectRevision, recallContext } from './context.js';
import { validateAgentProject } from './validation.js';
import { introducedIssues } from './editorial.js';
import { updateVisualRequirements, markVisualCoverage, nextVisualSamples } from './visualVerification.js';
import { describeToolActivity, imageActivityProgress } from './toolActivity.js';
import { activityEvidence, renderActivityProgress } from './activityEvidence.js';
import { t } from '../../i18n/index.js';

// ctx: the agent context (agentCtx.js). contents: the request's model log (recall_context reads it).
// tools/catalog: from nativeTools(). isCanceled: the owner's cancel state.
export function createToolHost({ ctx, contents, onEvent, isCanceled, requestId, tools, catalog, completionPolicy }) {
  const initial = ctx.getProject(), initialRevision = projectRevision(initial);
  const initialIssues = new Set(validateAgentProject(initial).issues), failures = new Map(), operations = [];
  let editorialReviewed = null, staleError = null, interruption = null, stopError = null, stopped = false, finalized = null, visual = [], changed = false, index = 0;
  const canceled = () => stopped || isCanceled();
  let imageEvent, activeEvent, activeProject;
  const runner = createToolRunner({ ...ctx, requestId, isCanceled: canceled, onImageProgress: progress => {
    if (imageEvent && !canceled() && ctx.editActive?.()!==false) onEvent({ ...imageEvent, label:describeImageProgress(progress), activity:{...imageEvent.activity,progress:imageActivityProgress(progress),...activityEvidence(imageEvent.name,{},activeProject,undefined,ctx.getProject())} });
  },onToolProgress:progress=>{
    if(activeEvent&&!canceled()){activeEvent={...activeEvent,activity:{...activeEvent.activity,render:renderActivityProgress({...activeEvent.activity?.render,...progress})}};onEvent(activeEvent);}
  } });
  const editChanged = () => changed && projectRevision(ctx.getProject()) !== initialRevision;
  // A turn that changed nothing (an answer, a proposed plan) has nothing to
  // validate; any edit requires an explicit, current complete_edit.
  const settled = () => (completionPolicy?.ready() ?? true) && !failures.size && (finalized === projectRevision(ctx.getProject()) || (!changed && projectRevision(ctx.getProject()) === initialRevision));
  const validOwner = () => { if (canceled()) throw new Error(stopError?.error || 'Editing stopped.'); if (ctx.editActive && !ctx.editActive()) { staleError = 'The project changed during this request. Completed edits were kept. Continue from the current timeline.'; const cause = ctx.editInterruption?.();interruption = cause?.token === requestId ? cause : null;ctx.api.agentCancel?.(requestId).catch(()=>{});throw new Error(staleError); } };
  const remember = (name, args, result, id, before = ctx.getProject()) => {
    result.operation_id = id;
    // A user refusal ends plugin execution for this request. Do not require a
    // later retry of earlier plugin failures in order to finish the edit.
    if(name==='run_plugin_command'&&result.permission_denied)for(const [key,failure] of failures)if(failure.name==='run_plugin_command')failures.delete(key);
    if (result.error && !result.not_applicable && runner.requiresSuccess(name)) {
      result.failed_operation_id = id; failures.set(id, { name, key: editTarget(name, args), error: result.error, targets: failureTargets(args, before) });
    } else if (!result.error) for (const [key, failure] of failures) {
      if (clearsFailure(key, failure, name, args)) failures.delete(key);
    }
    operations.push({ id, name, changed: !!result.changed, status: result.error ? 'failed' : 'completed', revision: result.revision, ...(result.error ? { error: result.error } : {}) });
  };
  const verify = async (args) => {
    validOwner();
    const prerequisite = completionPolicy?.verify(args);
    if (prerequisite) return prerequisite;
    pruneFailures(failures, ctx.getProject());
    if (failures.size) return { ...unresolvedReport(failures), ready:false };
    const validation = validateAgentProject(ctx.getProject());
    const issues = validation.issues.filter(issue => !initialIssues.has(issue));
    if (changed && issues.length) return { error:`Edit validation failed: ${issues.join(' ')}`, ready:false };
    const times_sec = nextVisualSamples(visual);
    if (times_sec.length) {
      const result = await runner.run('inspect_frames', { times_sec, sheet: true });
      validOwner();
      if (result.error) return { ...result, ready:false };
      if (result.revision !== projectRevision(ctx.getProject())) return { error:'The project changed during visual verification.', ready:false };
      const pending = visual.filter(region => !region.checked).length;
      markVisualCoverage(visual, result.frames);
      if (visual.filter(region => !region.checked).length === pending) return { error:'Frame inspection did not cover the changed regions.', ready:false };
      return { ...result, ready:false, review_required:true,
        checked_regions:visual.filter(region=>region.checked).length, total_regions:visual.length,
        note:'Review these actual images, then call complete_edit again. More affected regions may need inspection.' };
    }
    // One editorial pass: issues this request introduced must be fixed or
    // explained once; a second call on the same revision proceeds.
    const editorial = changed ? introducedIssues(initial, ctx.getProject()) : [];
    const current = projectRevision(ctx.getProject());
    if (editorial.length && editorialReviewed !== current) {
      editorialReviewed = current;
      return { ready:false, editorial_review_required:true, editorial_issues:editorial,
        note:'This edit introduced these editorial issues. Fix them, or call complete_edit again if each one is intentional and say why in the final reply.' };
    }
    finalized = current;
    return { ready:true, revision:finalized, validation, visual_samples_checked:visual.length > 0 && visual.every(region=>region.checked), ...(editorial.length ? { editorial_notes:editorial } : {}), ...completionPolicy?.report() };
  };
  const execute = async call => {
    validOwner();
    if (call.name === '__native_status') {
      if (completionPolicy && !completionPolicy.ready()) return { ...completionPolicy.verify(), code: 'analysis_pending' };
      if (failures.size) return { ...unresolvedReport(failures), ready: false, code: 'unresolved_operations' };
      return { ready: settled(), ...(!settled() ? { code: 'edit_validation_pending', note: 'Validate the current revision with complete_edit and review the returned changed-region images.' } : {}) };
    }
    const beforeProject = ctx.getProject();
    const id = `native-${index++}`, before = projectRevision(beforeProject);
    const event = { type:'tool', id, name:call.name, label:call.name === 'complete_edit' ? t('activity.validating_the_completed_edit') : call.name === 'generate_images' ? t('activity.generating_scene_images') : describeCall(call.name, call.args), activity:describeToolActivity(call.name,call.args,beforeProject), status:'running' };
    activeEvent=event;activeProject=beforeProject;
    imageEvent = ['generate_image','generate_images'].includes(call.name) ? event : null;
    onEvent(event);
    let result, actions = [];
    try {
      const error = validateToolCall(call, tools);
      if (error) result = { error };
      else if (call.name === 'complete_edit') result = await verify(call.args);
      else if (call.name === 'delegate_video_analysis') result = await ctx.delegateAnalysis(call.args);
      else if (call.name === 'load_tools') result = catalog.load(call.args.groups);
      else if (call.name === 'recall_context') result = recallContext(contents, call.args);
      else if (call.name.startsWith('mcp_')) {
        const { retry_of, ...externalArgs } = call.args;
        const external = await ctx.api.mcpCall({ name:call.name, args:externalArgs, requestId, revision:before });
        result = external?.ok ? typeof external.result === 'string' ? { text:external.result } : external.result : { error:external?.error || 'MCP tool failed.' };
      } else if (call.name === 'generate_images') {
        const results = await runner.runImages(call.args.scenes);
        results.forEach((value, i) => remember('generate_image', call.args.scenes[i], value, `${requestId}:${id}:${i}`, beforeProject));
        result = { results, changed:results.some(value=>value.changed), ...(results.some(value=>value.error) ? { error:'Some scenes failed. Retry only the failed scenes using their failed_operation_id.' } : {}) };
      } else { result = await runner.run(call.name, call.args); actions = runner.lastActions(); }
      await ctx.settle(); validOwner();
      if (!result || typeof result !== 'object') result = { error:'Tool returned no valid result.' };
    } catch (error) { result = { error:error.message }; }
    const after = projectRevision(ctx.getProject());
    if (before !== after && (!ctx.editActive || ctx.editActive())) {
      changed = true; finalized = null;
      visual = updateVisualRequirements(initial, beforeProject, ctx.getProject(), visual);
    }
    if (['inspect_frames','get_storyboard','review_section','export_video'].includes(call.name) && result.revision === after && !result.error) markVisualCoverage(visual, result.frames);
    if (!['complete_edit','generate_images'].includes(call.name)) remember(call.name, call.args || {}, result, `${requestId}:${id}`, beforeProject);
    contents.push({ role:'model', parts:[{ functionCall:{ name:call.name, args:call.args } }] }, { role:'user', parts:[{ functionResponse:{ name:call.name, response:{ result } } }] });
    onEvent({ type:'tool', id, name:call.name, label:call.name === 'complete_edit'
      ? result.review_required ? t('activity.checking_the_edit_regions_reviewed', { checked: result.checked_regions, total: result.total_regions }) : t('activity.validating_the_completed_edit')
      : call.name === 'generate_images' ? t('activity.generating_scene_images') : describeCall(call.name, call.args), activity:describeToolActivity(call.name,call.args,beforeProject,result,ctx.getProject(),actions), status:result.error ? 'error' : 'done', detail:stopError?.error || result.error });
    imageEvent = null;
    activeEvent=null;activeProject=null;
    if (result.canceled) { stopped = true;await ctx.api.agentCancel?.(requestId); }
    return result;
  };
  // Agents may request tools concurrently. Serialize editor mutations and
  // reads; generate_images retains the existing bounded native image batching.
  let queue = Promise.resolve();
  const enqueue = (call) => { const task = queue.then(() => execute(call)); queue = task.catch(() => {}); return task; };
  return {
    enqueue, settled, initialRevision, operations,
    // Throws when the request was stopped or the user changed the project (sets staleError).
    check: validOwner,
    idle: () => queue,
    // The project changed since this host started, through its own calls.
    changed: editChanged,
    // Unresolved failures or an unaccepted change: what the external host reports as pending.
    pendingValidation: () => !settled(),
    stop(error) { stopped = true; stopError = error || null; },
    canceled,
    get staleError() { return staleError; },
    get interruption() { return interruption; },
    get stopError() { return stopError; },
  };
}
