// SDK providers own the reasoning/tool loop. This host receives actual native
// callbacks and keeps all editor writes inside the existing validated runner (toolHost.js).
import { TOOL_DECLARATIONS } from './tools.js';
import { TOOL_GROUPS, createToolCatalog } from './toolCatalog.js';
import { SYSTEM_PROMPT } from './runAgent.js';
import { prepareContext, projectRevision } from './context.js';
import { createToolHost } from './toolHost.js';

const COMPLETE = { name: 'complete_edit', description: 'Required before finishing. Validate the live edit and inspect any missing changed regions. If ready is false, review the returned images or repair failed operations, then call again. Only finish after ready is true.', parameters: { type: 'OBJECT', properties: {} } };
const IMAGES = { name: 'generate_images', description: 'Generate independent scene images concurrently, then insert them in request order. Use up to 12 scenes. Reuse an existing character reference before batching. Failed scenes have separate operation IDs; retry only those scenes with generate_image and retry_of.', parameters: { type: 'OBJECT', properties: { scenes: { type: 'ARRAY', minItems: 1, maxItems: 12, items: TOOL_DECLARATIONS.find(tool => tool.name === 'generate_image').parameters } }, required: ['scenes'] } };
// Every native agent is offered this list: all editor tool groups, the user's MCP tools and
// complete_edit; image generation only where the agent can generate images (Codex).
export function nativeTools(provider, externalTools = []) {
  const declarations = TOOL_DECLARATIONS.filter(tool => provider === 'codex-sdk' || tool.name !== 'generate_image');
  const catalog = createToolCatalog(declarations, externalTools);
  catalog.load([...Object.keys(TOOL_GROUPS), 'external']);
  return { catalog, tools: [...catalog.tools(), COMPLETE, ...(provider === 'codex-sdk' ? [IMAGES] : [])] };
}

// The instructions every native agent receives, sent once per session through its system channel.
export const nativeSystemPrompt = () => SYSTEM_PROMPT.replace('- Load needed tool groups with load_tools. Batch independent reads and group loads; perform edits in order. Only use available tools. Explain unsupported requests briefly.', '- Editor tools are registered natively. Call them directly; do not emit JSON tool requests in your answer. Perform dependent edits in order. load_tools is optional discovery. Explain unsupported requests briefly.') + '\nUse only registered ClipCraft tools for editing; no native filesystem or shell work. Before your final answer call complete_edit until ready is true. Review images returned by that tool. Describe actual edits in the final reply without internal tool/protocol names. When generate_images is available, use it for parallel scene images; it preserves insertion order and bounds native generation concurrency.';
// What changes per request (the live revision) travels with the request, not the instructions.
export const nativeRequestContext = (revision) => `Live editor revision: ${revision}. Reuse current user-attached references; refresh missing or stale project IDs/times before editing.`;

const STALE = 'The project changed during this request. Completed edits were kept. Continue from the current timeline.';
export async function runNativeAgent({ contents, ctx, onEvent, isCanceled, requestId, sessionKey }) {
  const initialRevision = projectRevision(ctx.getProject());
  let host = null, offTool, offStop, offProgress;
  const finish = result => ({ ...result, changed: !!host?.changed(), operations: host?.operations || [] });
  const interrupted = () => ({ error:{ error:host.staleError, code:'edit_interrupted', ...(host.interruption ? { interruption:host.interruption } : {}) } });
  // Before the host exists (the MCP tool listing), the same interruption result the host gives.
  const early = () => {
    if (isCanceled()) throw new Error('Editing stopped.');
    if (ctx.editActive && !ctx.editActive()) { const cause = ctx.editInterruption?.(); ctx.api.agentCancel?.(requestId).catch(()=>{}); return { error:{ error:STALE, code:'edit_interrupted', ...(cause?.token === requestId ? { interruption:cause } : {}) } }; }
    return null;
  };
  try {
    if (!ctx.api.agentRunNative || !ctx.api.onAgentNativeTool) throw new Error('Restart ClipCraft to load native agent support.');
    const external = await ctx.api.mcpTools?.({ requestId });
    const stale = early(); if (stale) return finish(stale);
    if (external?.problems?.length) onEvent({ type:'tool', id:'native-mcp-warning', name:'mcp', label:external.problems.map(p=>`${p.server}: ${p.error}`).join('; '), status:'error' });
    const { catalog, tools } = nativeTools(ctx.provider, external?.tools || []);
    host = createToolHost({ ctx, contents, onEvent, isCanceled, requestId, tools, catalog });
    offTool = ctx.api.onAgentNativeTool(call => {
      if (call.requestId !== requestId) return;
      host.enqueue(call).then(result => ctx.api.agentNativeToolResult({ requestId, callId:call.callId, result }), error => ctx.api.agentNativeToolResult({ requestId, callId:call.callId, result:{ error:error.message } })).catch(() => {});
    });
    offStop = ctx.api.onAgentNativeStop?.(event => { if (event.requestId === requestId) host.stop(event.error); });
    offProgress = ctx.api.onAgentNativeProgress?.(event => { if (event.requestId === requestId && event.event) onEvent(event.event); });
    const nativeSystem = nativeSystemPrompt(), requestContext = nativeRequestContext(initialRevision);
    const prompt = contents.at(-1)?.parts?.filter(part=>part.text).map(part=>part.text).join('\n') || '';
    const history = prepareContext(contents.slice(0, -1)).contents;
    const response = await ctx.api.agentRunNative({ requestId, sessionKey, provider:ctx.provider, system:nativeSystem, context:requestContext, prompt, history, tools, chatImageIds: ctx.chatImageIds || [] });
    await host.idle();
    if (host.staleError) return finish(interrupted());
    if (host.stopError) return finish({ error:host.stopError });
    if (response.canceled || isCanceled()) return finish({ canceled:true, text:'' });
    if (!response.ok) return finish({ error:response });
    host.check();
    if (!host.settled()) return finish({ error:{ error:'The native agent ended without completing edit validation. Completed changes remain undoable.' } });
    contents.push({ role:'model', parts:[{ text:response.text || 'Done.' }] });
    return finish({ text:response.text || 'Done.', ...(response.tokenUsage ? { tokenUsage:response.tokenUsage } : {}) });
  } catch (error) { if (host?.staleError) return finish(interrupted()); if(host?.stopError)return finish({error:host.stopError}); return finish(host?.canceled() || isCanceled() ? { canceled:true, text:'' } : { error:{ error:error.message } }); }
  finally { offTool?.(); offStop?.(); offProgress?.(); }
}
