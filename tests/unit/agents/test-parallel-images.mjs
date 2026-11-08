import assert from 'node:assert/strict';
import { runAgent } from "../../../src/features/agent/runAgent.js";
import { createToolRunner } from "../../../src/features/agent/tools.js";
import { emptyProject, historyReducer, videoLayout } from "../../../src/state/store.js";
import jobs from "../../../electron/agents/imageJobs.cjs";

const reference = {id:'character',type:'image',path:'/character.png',name:'Character'};
let state = {past:[],future:[],present:{...emptyProject(),media:[reference]}}, stopped = false;
let active = 0, peak = 0, generated = 0, step = 0;
const mutations = [], events = [], requests = [], completion = [];
const call = (name, args) => ({name,args});
const image = (prompt, start_sec, extra = {}) => call('generate_image', {prompt,start_sec,duration_sec:2,reference_media_ids:['character'],...extra});
const first = [image('one',0),image('two',2),image('three',4),image('four',6)];
const second = [image('bad',8),image('library',0,{as:'library'})];
const turns = [[call('load_tools',{groups:['media']})], [...first,call('set_project',{name:'After images'}),...second], []];
const ctx = {
  // Exercise the direct loop's batching contract; native callbacks are covered
  // separately by test-native-agents and the real Electron image smoke.
  getProject:() => state.present, settle:async () => {}, isCanceled:() => stopped,
  dispatch:action => { mutations.push({type:action.type,generated}); state = historyReducer(state,action); },
  addProbed:res => { const m={...res,id:res.path};ctx.dispatch({type:'addMedia',items:[m]});return m; },
  api:{
    mcpTools:async () => ({tools:[]}),
    agentStep:async req => {
      if (step===2) {
        const results=req.contents.at(-1).parts.map(p=>p.functionResponse.response.result);
        assert.deepEqual(results.slice(0,4).map(r=>r.added),['one','two','three','four']);
        assert.match(results[5].error,/failed/); assert.equal(results[6].added,'library');
      }
      const calls=turns[step++];return {ok:true,provider:'codex-sdk',calls,text:'Done',content:{role:'model',parts:calls.map(functionCall=>({functionCall}))}};
    },
    agentGenerateImages:async req => {
      requests.push(req);assert.equal(req.requestId,'parallel');
      const results=await jobs.runImageJobs(req.scenes,async scene => {
        assert.deepEqual(scene.referencePaths,['/character.png']); peak=Math.max(peak,++active);
        await new Promise(resolve=>setTimeout(resolve,scene.prompt==='one'?35:5));
        active--;generated++;completion.push(scene.prompt);
        if(scene.prompt==='bad')throw new Error('Generation failed');
        return {type:'image',path:`/${scene.prompt}.png`,name:scene.prompt,width:100,height:100};
      });return {results};
    },
  },
};
const result=await runAgent({ctx,contents:[{role:'user',parts:[{text:'Make independent scenes with the same character'}]}],onEvent:e=>events.push(e),isCanceled:()=>stopped,requestId:'parallel'});
assert.equal(result.changed,true,JSON.stringify(result));assert.equal(peak,3);
assert.deepEqual(requests.map(r=>r.scenes.length),[4,2],'non-image edits separate batches');
assert.notEqual(completion[0],'one','completion order differs from prompt order');
assert.deepEqual(state.present.overlayClips.map(c=>[c.start,c.out,c.mediaId]),[[0,2,'/one.png'],[2,2,'/two.png'],[4,2,'/three.png'],[6,2,'/four.png']]);
assert.equal(videoLayout(state.present.videoClips).at(-1).end,8);
assert.ok(mutations.filter(m=>m.type==='addMedia').slice(0,4).every(m=>m.generated===4),'timeline mutations wait until generation settles and run in scene order');
assert.equal(events.filter(e=>e.status==='error').length,1);
ctx.dispatch({type:'collapseHistory',from:0});ctx.dispatch({type:'undo'});
assert.equal(state.present.media.length,1);assert.equal(state.present.overlayClips.length,0);
ctx.dispatch({type:'redo'});assert.equal(state.present.overlayClips.length,4);

// Validate references before launching jobs and refuse all inserts after Stop,
// even if a backend delivers a late successful image.
const runner=createToolRunner({...ctx,requestId:'parallel'});
const before=state.present, beforeRequests=requests.length;
const invalid=await runner.runImages([{prompt:'x',reference_media_ids:['invented']},{prompt:''}]);
assert.ok(invalid.every(r=>r.error));assert.equal(requests.length,beforeRequests);
ctx.api.agentGenerateImages=async req=>{stopped=true;return {results:req.scenes.map(()=>({type:'image',path:'/late.png'}))};};
const canceled=await runner.runImages([{prompt:'late one'},{prompt:'late two'}]);
assert.ok(canceled.every(r=>/stopped/.test(r.error)));assert.equal(state.present,before);

// Streaming imports must become visible before the slowest job resolves, while
// duplicate/foreign results and late work after Stop never create extra scenes.
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function streaming() {
 let current={past:[],future:[],present:emptyProject()}, canceled=false, req, resolve;
 const listeners=new Set(),progress=[];
 const ctx={requestId:'stream',getProject:()=>current.present,settle:async()=>{},isCanceled:()=>canceled,onImageProgress:value=>progress.push(value),
  dispatch:action=>{current=historyReducer(current,action);},
  addProbed:res=>{const m={...res,id:res.path};ctx.dispatch({type:'addMedia',items:[m]});return m;},
  api:{onAgentImageProgress:fn=>{listeners.add(fn);return()=>listeners.delete(fn);},agentGenerateImages:request=>{req=request;return new Promise(done=>{resolve=done;});}}};
 const images=Array.from({length:3},(_,i)=>({type:'image',name:`Scene ${i}`,path:`/stream-${i}.png`,width:100,height:100}));
 const pending=createToolRunner(ctx).runImages(images.map((_,i)=>({prompt:`Scene ${i}`,start_sec:i*2,duration_sec:2})));
 return {ctx,images,pending,progress,get project(){return current.present;},get listeners(){return listeners.size;},stop:()=>{canceled=true;},
  emit:(index,result=images[index],extra={})=>{for(const fn of listeners)fn({requestId:'stream',batchId:req.batchId,index,result,total:3,completed:index+1,active:1,...extra});},
  finish:()=>resolve({results:images})};
}
const streamed=streaming();await tick();
streamed.emit(1);await tick();assert.equal(streamed.project.overlayClips.length,0,'later results wait for the ready prefix');
streamed.emit(0,undefined,{batchId:'other-batch'});streamed.emit(0,undefined,{requestId:'other-request'});await tick();
assert.equal(streamed.project.overlayClips.length,0,'foreign batch/request results are ignored');
streamed.emit(0);await tick();
assert.deepEqual(streamed.project.overlayClips.map(c=>c.mediaId),['/stream-0.png','/stream-1.png'],'ordered scenes appear before all generation finishes');
streamed.emit(0);await tick();assert.equal(streamed.project.overlayClips.length,2,'replayed progress never inserts twice');
assert.ok(streamed.progress.some(p=>p.inserted===2),'progress reflects scenes already placed');
streamed.finish();assert.ok((await streamed.pending).every(result=>result.changed));
assert.equal(streamed.project.overlayClips.length,3);assert.equal(streamed.listeners,0,'subscription closes after completion');

const partial=streaming();await tick();partial.emit(0);await tick();partial.stop();partial.emit(1);partial.finish();
const partialResults=await partial.pending;
assert.equal(partial.project.overlayClips.length,1,'Stop keeps the completed prefix and refuses late insertions');
assert.equal(partialResults[0].changed,true);assert.ok(partialResults.slice(1).every(result=>/stopped/.test(result.error)));assert.equal(partial.listeners,0);

const stale=streaming();await tick();stale.emit(0);await tick();stale.ctx.dispatch({type:'setProject',patch:{name:'Manual edit'}});stale.emit(1);stale.finish();
const staleResults=await stale.pending;
assert.equal(stale.project.overlayClips.length,1,'manual changes block remaining stale insertions without discarding the completed prefix');
assert.equal(staleResults[0].changed,true);assert.ok(staleResults.slice(1).every(result=>/project changed/.test(result.error)));

const failed=streaming();await tick();failed.emit(1);failed.emit(0,{error:'One scene failed'});await tick();
assert.equal(failed.project.overlayClips.length,1,'a failed earlier scene does not block a completed later scene');
failed.finish();const failedResults=await failed.pending;assert.match(failedResults[0].error,/failed/);assert.equal(failedResults[1].changed,true);
console.log('parallel images ok (bounded jobs, ordered incremental imports, batch ownership, duplicate results, partial failure, Undo/Redo, Stop, stale edits)');
