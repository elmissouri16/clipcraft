// Shared editor loop: SDK turns use the same tools/history and stop semantics as APIs.
import assert from 'node:assert/strict';
import { runAgent } from "../../../src/features/agent/runAgent.js";
import { emptyProject, historyReducer } from "../../../src/state/store.js";

const makeContext = (step) => {
  let state = { past: [], present: emptyProject(), future: [] };
  const events = [];
  const calls = [];
  return {
    events, calls, state: () => state,
    ctx: { getProject: () => state.present,
      dispatch: (action) => { state = historyReducer(state, action); }, settle: async () => {},
      api: { mcpTools: async () => ({ ok: true, tools: [] }), agentStep: async (request) => {
        calls.push(structuredClone(request)); return step(calls.length, request);
      } },
    },
  };
};
const toolTurn = { ok: true, provider: 'codex-sdk', text: '', calls: [{ name: 'set_project', args: { name: 'SDK edit' } }],
  content: { role: 'model', parts: [{ functionCall: { name: 'set_project', args: { name: 'SDK edit' } } }] } };
const conversation = () => [{ role: 'user', parts: [{ text: 'Rename my project' }] }];
const first = makeContext((n) => n === 1 ? toolTurn : { ok: true, provider: 'codex-sdk', text: 'Done.', calls: [], content: { role: 'model', parts: [{ text: 'Done.' }] } });
let result = await runAgent({ contents: conversation(), ctx: first.ctx, onEvent: (e) => first.events.push(e), isCanceled: () => false, requestId: 'one-run' });
assert.equal(result.changed, true);
assert.equal(first.state().present.name, 'SDK edit');
assert.equal(first.calls[0].requestId, 'one-run');
assert.equal(first.calls[1].requestId, 'one-run');
assert.equal(first.calls[1].provider, 'codex-sdk');
assert.equal(first.calls[1].contents.at(-1).parts[0].functionResponse.name, 'set_project');
assert.ok(first.events.some((e) => e.status === 'done'));
assert.ok(first.events.some(e=>e.status==='running'&&e.activity?.description==='SDK edit'),'API activity explains the requested change before execution');
assert.ok(first.events.some(e=>e.status==='done'&&e.activity?.outcome==='Applied to the timeline'),'API activity reports the actual edit outcome');
first.ctx.dispatch({ type: 'undo' });
assert.equal(first.state().present.name, 'Untitled');

const partial = makeContext((n) => n === 1 ? toolTurn : { ok: false, error: 'Provider failed' });
result = await runAgent({ contents: conversation(), ctx: partial.ctx, onEvent: () => {}, isCanceled: () => false });
assert.equal(result.changed, true, 'completed edits remain undoable after a later provider error');
assert.equal(result.error.error, 'Provider failed');
for (const response of [{ ok: false, canceled: true }, toolTurn]) {
  let stopped = false;
  const cancel = makeContext(() => { stopped = response === toolTurn; return response; });
  result = await runAgent({ contents: conversation(), ctx: cancel.ctx, onEvent: () => {}, isCanceled: () => stopped });
  assert.equal(result.canceled, true);
  assert.equal(cancel.state().present.name, 'Untitled', 'a canceled response cannot apply a tool');
}
console.log('agent runner ok (shared tool results, provider continuity, Undo, partial errors, cancellation)');

// Final replies after visual edits require fresh composed images, not only a
// successful reducer dispatch. The images remain outside saved conversation.
{
  let stage = 0, captures = 0;
  const visual = makeContext((_n, req) => {
    const calls = stage++ === 0 ? [{name:'load_tools',args:{groups:['text']}}] : stage === 2 ? [{name:'add_text',args:{text:'Check me',duration_sec:2}}] : [];
    if(stage===4) assert.deepEqual(req.frameIds,['verified-frame']);
    return {ok:true,provider:'openai',text:calls.length?'':'Done.',calls,content:{role:'model',parts:calls.map(functionCall=>({functionCall}))}};
  });
  visual.ctx.api.agentInspectFrames=async req=>{captures++;assert.ok(req.times_sec.length>0);return {frames:req.times_sec.map(time_sec=>({id:'verified-frame',source:'timeline',time_sec})),revision:req.revision};};
  const result=await runAgent({contents:conversation(),ctx:visual.ctx,onEvent:()=>{},isCanceled:()=>false});
  assert.equal(captures,1);assert.equal(result.verification.visual_samples_checked,true);assert.equal(result.changed,true);assert.ok(!JSON.stringify(visual.calls).includes('base64'));
}
{
  let stage=0;
  const failed=makeContext(()=>{const calls=stage++===0?[{name:'load_tools',args:{groups:['text']}}]:stage===2?[{name:'add_text',args:{text:'Visible'}}]:[];return {ok:true,calls,text:'Done.',content:{role:'model',parts:calls.map(functionCall=>({functionCall}))}};});
  failed.ctx.api.agentInspectFrames=async()=>({error:'Source decode failed'});
  const result=await runAgent({contents:conversation(),ctx:failed.ctx,onEvent:()=>{},isCanceled:()=>false});assert.match(result.error.error,/Visual verification failed/);
}

{
  let stage=0;
  const f=makeContext(()=>{const calls=stage++===0?[{name:'load_tools',args:{groups:['audio']}}]:stage===2?[{name:'set_volume',args:{clip_id:'missing',volume:0}},{name:'set_volume',args:{clip_id:'a',volume:0}}]:[];return {ok:true,calls,text:'Muted both clips.',content:{role:'model',parts:calls.map(functionCall=>({functionCall}))}};});
  f.state().present.media=[{id:'m',type:'audio',duration:1}];f.state().present.audioClips=[{id:'a',mediaId:'m',start:0,in:0,out:1,volume:1}];
  const r=await runAgent({contents:[],ctx:f.ctx,onEvent:()=>{},isCanceled:()=>false});assert.ok(r.error,'unrelated target success cannot erase a failed operation');assert.equal(r.changed,true);
}

{
  let stage=0;
  const f=makeContext(()=>{const calls=stage++===0?[{name:'load_tools',args:{groups:['timeline']}}]:stage===2?[{name:'split_at',args:{time_sec:1000}},{name:'split_at',args:{time_sec:2}}]:[];return {ok:true,calls,text:'Split both moments.',content:{role:'model',parts:calls.map(functionCall=>({functionCall}))}};});
  f.state().present.media=[{id:'m',type:'video',duration:10}];f.state().present.videoClips=[{id:'v',mediaId:'m',in:0,out:10,speed:1}];
  const r=await runAgent({contents:[],ctx:f.ctx,onEvent:()=>{},isCanceled:()=>false});assert.ok(r.error,'different split timestamp cannot resolve a failed split');
}
{
  let stage=0;
  const f=makeContext((_n,req)=>{
    let calls=[];
    if(stage++===0)calls=[{name:'load_tools',args:{groups:['audio']}}];
    else if(stage===2)calls=[{name:'set_volume',args:{clip_id:'a',volume:3}}];
    else if(stage===3){const failure=req.contents.at(-1).parts[0].functionResponse.response.result;calls=[{name:'set_volume',args:{clip_id:'a',volume:0,retry_of:failure.failed_operation_id}}];}
    return {ok:true,calls,text:'Muted the clip.',content:{role:'model',parts:calls.map(functionCall=>({functionCall}))}};
  });
  f.state().present.media=[{id:'m',type:'audio',duration:1}];f.state().present.audioClips=[{id:'a',mediaId:'m',start:0,in:0,out:1,volume:1}];
  const r=await runAgent({contents:[],ctx:f.ctx,onEvent:()=>{},isCanceled:()=>false});assert.ok(!r.error,'an explicit matching retry resolves a corrected operation');assert.equal(f.state().present.audioClips[0].volume,0);
}
