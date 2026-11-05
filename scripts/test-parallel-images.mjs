import assert from 'node:assert/strict';
import { runAgent } from '../src/agent/runAgent.js';
import { createToolRunner } from '../src/agent/tools.js';
import { emptyProject, historyReducer, videoLayout } from '../src/store.js';
import jobs from '../electron/imageJobs.cjs';

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
  provider:'codex-sdk', getProject:() => state.present, settle:async () => {}, isCanceled:() => stopped,
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
assert.equal(result.changed,true);assert.equal(peak,3);
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
console.log('parallel images ok (real runner, concurrent jobs, ordered inserts/results, barriers, references, partial failure, Undo/Redo, Stop)');
