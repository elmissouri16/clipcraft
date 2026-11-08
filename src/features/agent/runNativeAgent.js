// SDK providers own the reasoning/tool loop. This host receives actual native
// callbacks and keeps all editor writes inside the existing validated runner.
import { TOOL_DECLARATIONS, createToolRunner, describeImageProgress } from './tools.js';
import { TOOL_GROUPS, createToolCatalog } from './toolCatalog.js';
import { SYSTEM_PROMPT, describeCall, editTarget } from './runAgent.js';
import { validateToolCall } from "../../../shared/toolArguments.mjs";
import { prepareContext, projectRevision, recallContext } from './context.js';
import { validateAgentProject } from './validation.js';
import { introducedIssues } from './editorial.js';
import { updateVisualRequirements, markVisualCoverage, nextVisualSamples } from './visualVerification.js';
import { describeToolActivity, imageActivityProgress } from './toolActivity.js';
import { activityEvidence, renderActivityProgress } from './activityEvidence.js';

const COMPLETE = { name: 'complete_edit', description: 'Required before finishing. Validate the live edit and inspect any missing changed regions. If ready is false, review the returned images or repair failed operations, then call again. Only finish after ready is true.', parameters: { type: 'OBJECT', properties: {} } };
const IMAGES = { name: 'generate_images', description: 'Generate independent scene images concurrently, then insert them in request order. Use up to 12 scenes. Reuse an existing character reference before batching. Failed scenes have separate operation IDs; retry only those scenes with generate_image and retry_of.', parameters: { type: 'OBJECT', properties: { scenes: { type: 'ARRAY', minItems: 1, maxItems: 12, items: TOOL_DECLARATIONS.find(tool => tool.name === 'generate_image').parameters } }, required: ['scenes'] } };
export async function runNativeAgent({ contents, ctx, onEvent, isCanceled, requestId, sessionKey }) {
  const initial = ctx.getProject(), initialRevision = projectRevision(initial);
  const initialIssues = new Set(validateAgentProject(initial).issues), failures = new Map(), operations = [];
  let editorialReviewed = null, staleError = null, interruption = null, stopError = null, stopped = false, finalized = null, visual = [], changed = false, index = 0, offTool, offStop, offProgress;
  const canceled = () => stopped || isCanceled();
  let imageEvent,activeEvent,activeProject;
  const runner = createToolRunner({ ...ctx, requestId, isCanceled: canceled, onImageProgress: progress => {
    if (imageEvent && !canceled() && ctx.editActive?.()!==false) onEvent({ ...imageEvent, label:describeImageProgress(progress), activity:{...imageEvent.activity,progress:imageActivityProgress(progress),...activityEvidence(imageEvent.name,{},activeProject,undefined,ctx.getProject())} });
  },onToolProgress:progress=>{
    if(activeEvent&&!canceled()){activeEvent={...activeEvent,activity:{...activeEvent.activity,render:renderActivityProgress({...activeEvent.activity?.render,...progress})}};onEvent(activeEvent);}
  } });
  const finish = result => ({ ...result, changed: changed && projectRevision(ctx.getProject()) !== initialRevision, operations });
  // A turn that changed nothing (an answer, a proposed plan) has nothing to
  // validate; any edit requires an explicit, current complete_edit.
  const settled = () => !failures.size && (finalized === projectRevision(ctx.getProject()) || (!changed && projectRevision(ctx.getProject()) === initialRevision));
  const validOwner = () => { if (canceled()) throw new Error(stopError?.error || 'Editing stopped.'); if (ctx.editActive && !ctx.editActive()) { staleError = 'The project changed during this request. Completed edits were kept. Continue from the current timeline.'; const cause = ctx.editInterruption?.();interruption = cause?.token === requestId ? cause : null;ctx.api.agentCancel?.(requestId).catch(()=>{});throw new Error(staleError); } };
  const remember = (name, args, result, id) => {
    result.operation_id = id;
    if (result.error && runner.requiresSuccess(name)) {
      result.failed_operation_id = id; failures.set(id, { name, key: editTarget(name, args), error: result.error });
    } else if (!result.error) for (const [key, failure] of failures) {
      if (failure.key === editTarget(name, args) || (args.retry_of === key && (failure.name === name || failure.name === 'generate_image' && name === 'generate_image'))) failures.delete(key);
    }
    operations.push({ id, name, changed: !!result.changed, status: result.error ? 'failed' : 'completed', revision: result.revision, ...(result.error ? { error: result.error } : {}) });
  };
  try {
    if (!ctx.api.agentRunNative || !ctx.api.onAgentNativeTool) throw new Error('Restart ClipCraft to load native agent support.');
    const external = await ctx.api.mcpTools?.({ requestId });
    validOwner();
    if (external?.problems?.length) onEvent({ type:'tool', id:'native-mcp-warning', name:'mcp', label:external.problems.map(p=>`${p.server}: ${p.error}`).join('; '), status:'error' });
    const declarations = TOOL_DECLARATIONS.filter(tool => ctx.provider === 'codex-sdk' || tool.name !== 'generate_image');
    const catalog = createToolCatalog(declarations, external?.tools || []);
    catalog.load([...Object.keys(TOOL_GROUPS), 'external']);
    const tools = [...catalog.tools(), COMPLETE, ...(ctx.provider === 'codex-sdk' ? [IMAGES] : [])];
    const verify = async () => {
      validOwner();
      if (failures.size) return { error: `Unresolved operations: ${[...failures.values()].map(f=>f.error).join(' ')}`, ready:false };
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
      return { ready:true, revision:finalized, validation, visual_samples_checked:visual.length > 0 && visual.every(region=>region.checked), ...(editorial.length ? { editorial_notes:editorial } : {}) };
    };
    const execute = async call => {
      validOwner();
      if (call.name === '__native_status') return { ready:settled() };
      const beforeProject = ctx.getProject();
      const id = `native-${index++}`, before = projectRevision(beforeProject);
      const event = { type:'tool', id, name:call.name, label:call.name === 'complete_edit' ? 'Validating the completed edit' : call.name === 'generate_images' ? 'Generating scene images' : describeCall(call.name, call.args), activity:describeToolActivity(call.name,call.args,beforeProject), status:'running' };
      activeEvent=event;activeProject=beforeProject;
      imageEvent = ['generate_image','generate_images'].includes(call.name) ? event : null;
      onEvent(event);
      let result;
      try {
        const error = validateToolCall(call, tools);
        if (error) result = { error };
        else if (call.name === 'complete_edit') result = await verify();
        else if (call.name === 'load_tools') result = catalog.load(call.args.groups);
        else if (call.name === 'recall_context') result = recallContext(contents, call.args);
        else if (call.name.startsWith('mcp_')) {
          const { retry_of, ...externalArgs } = call.args;
          const external = await ctx.api.mcpCall({ name:call.name, args:externalArgs, requestId, revision:before });
          result = external?.ok ? typeof external.result === 'string' ? { text:external.result } : external.result : { error:external?.error || 'MCP tool failed.' };
        } else if (call.name === 'generate_images') {
          const results = await runner.runImages(call.args.scenes);
          results.forEach((value, i) => remember('generate_image', call.args.scenes[i], value, `${requestId}:${id}:${i}`));
          result = { results, changed:results.some(value=>value.changed), ...(results.some(value=>value.error) ? { error:'Some scenes failed. Retry only the failed scenes using their failed_operation_id.' } : {}) };
        } else result = await runner.run(call.name, call.args);
        await ctx.settle(); validOwner();
        if (!result || typeof result !== 'object') result = { error:'Tool returned no valid result.' };
      } catch (error) { result = { error:error.message }; }
      const after = projectRevision(ctx.getProject());
      if (before !== after && (!ctx.editActive || ctx.editActive())) {
        changed = true; finalized = null;
        visual = updateVisualRequirements(initial, beforeProject, ctx.getProject(), visual);
      }
      if (['inspect_frames','get_storyboard','review_section','export_video'].includes(call.name) && result.revision === after && !result.error) markVisualCoverage(visual, result.frames);
      if (!['complete_edit','generate_images'].includes(call.name)) remember(call.name, call.args || {}, result, `${requestId}:${id}`);
      contents.push({ role:'model', parts:[{ functionCall:{ name:call.name, args:call.args } }] }, { role:'user', parts:[{ functionResponse:{ name:call.name, response:{ result } } }] });
      onEvent({ type:'tool', id, name:call.name, label:call.name === 'complete_edit'
        ? result.review_required ? `Checking the edit: ${result.checked_regions} of ${result.total_regions} regions reviewed` : 'Validating the completed edit'
        : call.name === 'generate_images' ? 'Generating scene images' : describeCall(call.name, call.args), activity:describeToolActivity(call.name,call.args,beforeProject,result,ctx.getProject()), status:result.error ? 'error' : 'done', detail:stopError?.error || result.error });
      imageEvent = null;
      activeEvent=null;activeProject=null;
      if (result.canceled) { stopped = true;await ctx.api.agentCancel?.(requestId); }
      return result;
    };
    // Native SDKs may request tools concurrently. Serialize editor mutations and
    // reads; generate_images retains the existing bounded native image batching.
    let queue = Promise.resolve();
    offTool = ctx.api.onAgentNativeTool(call => {
      if (call.requestId !== requestId) return;
      const task = queue.then(() => execute(call));
      queue = task.catch(() => {});
      task.then(result => ctx.api.agentNativeToolResult({ requestId, callId:call.callId, result }), error => ctx.api.agentNativeToolResult({ requestId, callId:call.callId, result:{ error:error.message } })).catch(() => {});
    });
    offStop = ctx.api.onAgentNativeStop?.(event => { if (event.requestId === requestId) { stopped = true;stopError = event.error || null; } });
    offProgress = ctx.api.onAgentNativeProgress?.(event => { if (event.requestId === requestId && event.event) onEvent(event.event); });
    const nativeSystem = SYSTEM_PROMPT.replace('- Load needed tool groups with load_tools. Batch independent reads and group loads; perform edits in order. Only use available tools. Explain unsupported requests briefly.', '- Editor tools are registered natively. Call them directly; do not emit JSON tool requests in your answer. Perform dependent edits in order. load_tools is optional discovery. Explain unsupported requests briefly.') + `\nLive editor revision: ${initialRevision}. Reuse current user-attached references; refresh missing or stale project IDs/times before editing.` + '\nUse only registered ClipCraft tools for editing; no native filesystem or shell work. Before your final answer call complete_edit until ready is true. Review images returned by that tool. Describe actual edits in the final reply without internal tool/protocol names. When generate_images is available, use it for parallel scene images; it preserves insertion order and bounds native generation concurrency.';
    const prompt = contents.at(-1)?.parts?.filter(part=>part.text).map(part=>part.text).join('\n') || '';
    const history = prepareContext(contents.slice(0, -1)).contents;
    const response = await ctx.api.agentRunNative({ requestId, sessionKey, provider:ctx.provider, system:nativeSystem, prompt, history, tools, chatImageIds: ctx.chatImageIds || [] });
    await queue;
    if (staleError) return finish({ error:{error:staleError, code:'edit_interrupted', ...(interruption ? { interruption } : {})} });
    if (stopError) return finish({ error:stopError });
    if (response.canceled || isCanceled()) return finish({ canceled:true, text:'' });
    if (!response.ok) return finish({ error:response });
    validOwner();
    if (!settled()) return finish({ error:{ error:'The native agent ended without completing edit validation. Completed changes remain undoable.' } });
    contents.push({ role:'model', parts:[{ text:response.text || 'Done.' }] });
    return finish({ text:response.text || 'Done.', ...(response.tokenUsage ? { tokenUsage:response.tokenUsage } : {}) });
  } catch (error) { if (staleError) return finish({error:{error:staleError,code:'edit_interrupted',...(interruption ? { interruption } : {})}}); if(stopError)return finish({error:stopError}); return finish(canceled() ? { canceled:true, text:'' } : { error:{ error:error.message } }); }
  finally { offTool?.(); offStop?.(); offProgress?.(); }
}
