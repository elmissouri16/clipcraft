import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
import {EventEmitter} from 'node:events';
import {validateManifest} from '../../../shared/pluginManifest.mjs';
import {commandInput,validateCommand} from '../../../shared/pluginCommands.mjs';
import {translationSnapshot,translationResponse,translationProposal,reviewedCaptionResult} from '../../../shared/pluginAi.mjs';
import {emptyProject,historyReducer,layerCount,renderable,prepareProjectAction} from '../../../src/state/store.js';
import {createToolRunner} from '../../../src/features/agent/tools.js';
import {createToolHost} from '../../../src/features/agent/toolHost.js';
import {nativeTools} from '../../../src/features/agent/runNativeAgent.js';
import {changedVisualRegions} from '../../../src/features/agent/visualVerification.js';
const require=createRequire(import.meta.url),{createChapterService}=require('../../../electron/plugins/chapterService.cjs'),{CommandRuntime}=require('../../../electron/plugins/commandRuntime.cjs'),{createTranslationReview}=require('../../../electron/plugins/translationReview.cjs');
const sample=JSON.parse(fs.readFileSync(new URL('../../../examples/plugins/caption-translation/plugin.json',import.meta.url))),manifest=validateManifest(sample),command=manifest.contributes.commands[0],key='a'.repeat(64);
const originals=[{id:'a',caption:true,layer:0,start:0,duration:2,text:'Hello world',words:[{text:'Hello',start:0,end:1},{text:'world',start:1,end:2}],word_timing:'measured'},{id:'b',caption:true,layer:0,start:4,duration:2,text:'Next topic',word_timing:'edited'}];
const project={...emptyProject(),id:'translation-fixture',videoClips:[{id:'gap',gap:true,in:0,out:10}],textClips:originals,layerNames:{text:{0:'Original captions'}},layerState:{'text:0':{locked:true}}};
const translations=[{index:0,text:'Bonjour le monde'},{index:1,text:'Sujet suivant'}],proposal={language:'fr',translations},input={language:'fr',source_track:1};
const check=async(name,fn)=>{await fn();checks++;console.log('PASS',name);};let checks=0;
await check('enum definitions validate bounded unique choices without changing legacy numeric normalization',()=>{
 assert.deepEqual(commandInput(command,{}),input);assert.equal(commandInput(command,{language:'ar'}).language,'ar');
 for(const value of [{language:'xx'},{language:4},{source_track:'1'}])assert.throws(()=>commandInput(command,value));
 for(const change of [p=>p.options.push(p.options[0]),p=>p.default='invalid',p=>p.options[0].label='bad\n',p=>p.options[0].path='/private',p=>p.options=Array.from({length:33},(_,i)=>({value:'v'+i,label:'value'}))]){const c=structuredClone(sample.contributes.commands[0]);change(c.parameters[0]);assert.throws(()=>validateCommand(c));}
 const numeric={id:'number',name:'Number',min:1,max:5,step:1,default:2};assert.deepEqual(validateCommand({id:'simple',name:'Simple',parameters:[numeric]}).parameters[0],numeric);
});
await check('caption grants cannot bypass dependencies or combine marker edits',()=>{
 for(const edit of [m=>m.permissions=m.permissions.filter(p=>p!=='captions.read'),m=>m.permissions=m.permissions.filter(p=>p!=='captions.write'),m=>m.permissions.push('markers.write'),m=>m.contributes.commands[0].parameters[0].options[0].value='unsupported']){const m=structuredClone(sample);edit(m);assert.throws(()=>validateManifest(m));}
});
await check('source selection and bounds reject mixed/oversized tracks, without silent partial translation',()=>{
 const p={...project,textClips:[...originals,{...originals[0],id:'other',layer:1,text:'Private second track'}]};assert.equal(translationSnapshot(p,10,1).length,2);assert.equal(translationSnapshot(p,10,2)[0].text,'Private second track');
 for(const p of [{...project,textClips:Array.from({length:101},(_,i)=>({caption:true,start:i,duration:1,text:'cue'}))},{...project,textClips:[{...originals[0],text:'x'.repeat(12001)}]},{...project,textClips:[originals[0],{...originals[1],start:1}]}])assert.throws(()=>translationSnapshot(p,200,1));
 assert.throws(()=>translationSnapshot(project,10,2));
});
await check('translation output contains one ordered text per cue and no timestamps, IDs or routing',()=>{
 const cues=translationSnapshot(project,10,1);assert.deepEqual(translationResponse(JSON.stringify({translations}),cues,'fr'),translations);
 for(const text of ['bad',JSON.stringify({translations:translations.slice(1)}),JSON.stringify({translations:translations.toReversed()}),JSON.stringify({translations:[{...translations[0],time:7},translations[1]]}),JSON.stringify({translations:[{index:0,text:'x'.repeat(1001)},translations[1]]})])assert.throws(()=>translationResponse(text,cues,'fr'));
 assert.throws(()=>translationProposal({...proposal,language:'ar'},cues,'fr'));
 assert.throws(()=>reviewedCaptionResult(project,10,input,{translation:{...proposal,sourceTrack:1},reviewed:false}));
});
await check('host captures translation language and sends source text only, with bounded output',async()=>{
 let request,cfg;const prepared=createChapterService({getConfig:()=>({provider:'ollama',model:'fixture'}),chat:async(c,o)=>{cfg=c;request=o;return JSON.stringify({translations});}}).prepare(translationSnapshot(project,10,1),{language:'fr'});
 await assert.rejects(prepared.translateCaptions({language:'ar'}),/approved/);await assert.rejects(prepared.translateCaptions({language:'fr',prompt:'override'}),/approved/);
 assert.deepEqual(await prepared.translateCaptions({language:'fr'}),translations);assert.equal(request.maxTokens,8192);assert.equal(cfg.webResearch,false);assert.deepEqual(JSON.parse(request.messages[0].content),{target_language:'French',captions:[{index:0,text:'Hello world'},{index:1,text:'Next topic'}]});
});
const action={type:'pluginCaptionTrack',base:project,sourceTrack:1,translation:proposal,ids:['new-a','new-b']};
await check('one atomic edit creates a named hidden track, exact timings and honest word timing while originals remain intact',()=>{
 const state=historyReducer({past:[],present:project,future:[]},action),p=state.present;
 assert.equal(state.past.length,1);assert.equal(layerCount(p,'text'),2);assert.equal(p.layerNames.text[1],'Captions · French');assert.ok(p.layerState['text:1'].hidden);assert.deepEqual(p.textClips.slice(0,2),originals);assert.equal(renderable(p).textClips.length,2);
 const translated=p.textClips.filter(c=>c.source==='plugin-translation');assert.deepEqual(translated.map(c=>[c.start,c.duration,c.text]),[[0,2,'Bonjour le monde'],[4,2,'Sujet suivant']]);assert.ok(translated.every(c=>!c.words&&c.word_timing==='unavailable'&&c.language==='fr'));
 const undo=historyReducer(state,{type:'undo'});assert.deepEqual(undo.present,project);const redo=historyReducer(undo,{type:'redo'});assert.equal(redo.present.textClips.length,4);assert.ok(redo.present.layerState['text:1'].hidden);assert.ok(redo.present.layerState['text:0'].locked);
});
await check('stale bases, foreign owners, gestures, locked new targets and invalid proposals reject all writes',()=>{
 for(const s of [{past:[],present:project,future:[],agentEdit:{token:'other'}},{past:[],present:project,future:[],gestureStart:project},{past:[],present:{...project,name:'changed'},future:[]}])assert.equal(historyReducer(s,action),s);
 const locked={...project,layerState:{...project.layerState,'text:1':{locked:true}}},s={past:[],present:locked,future:[]};assert.equal(historyReducer(s,{...action,base:locked}).present,locked);
 assert.equal(historyReducer({past:[],present:project,future:[]},{...action,ids:['a','b']}).present,project);
});
await check('agent token, queued chat persistence and Undo stay within one owned transaction',()=>{
 let state=historyReducer({past:[],present:project,future:[]},{type:'beginAgentEdit',token:'owner'});state=historyReducer(state,{type:'craftChat',projectId:project.id,chat:{progress:true}});state=historyReducer(state,{...action,agentToken:'owner'});assert.equal(state.agentEdit.steps.length,1);state=historyReducer(state,{type:'endAgentEdit',token:'owner'});assert.equal(state.past.length,1);assert.equal(historyReducer(state,{type:'undo'}).present.textClips.length,2);
});
await check('regenerating automatic captions preserves separately created translations',()=>{
 const base={...project,layerState:{}},added=historyReducer({past:[],present:base,future:[]},{...action,base});
 const regenerated=historyReducer(added,{type:'setCaptions',style:{},segments:[{id:'new-auto',start:0,end:1,text:'New recognition'}]});
 assert.equal(regenerated.present.textClips.filter(c=>c.source==='plugin-translation').length,2);
});
await check('hidden translated track does not require visual reinspection of unchanged composition',()=>{
 const next=prepareProjectAction(project,action).project;assert.deepEqual(changedVisualRegions(project,next),[]);
 const shown={...next,layerState:{...next.layerState,'text:1':{hidden:false}}};assert.ok(changedVisualRegions(next,shown).length);
 const hidden={...project,layerState:{'text:0':{hidden:true}}};assert.ok(changedVisualRegions(project,hidden).length);
});
await check('host review IDs cannot be forged or replayed; abort closes pending review',async()=>{
 const events=[],review=createTranslationReview(()=>({webContents:{send:(_channel,data)=>events.push(data)}}));const ctl=new AbortController(),pending=review.request({rows:[]},ctl.signal),id=events[0].id;
 assert.throws(()=>review.answer({id:'forged',accept:true}),/Unknown/);assert.throws(()=>review.answer({id,accept:'yes'}),/Unknown/);ctl.abort();assert.equal(await pending,false);assert.ok(events.at(-1).closed);assert.throws(()=>review.answer({id,accept:true}),/Unknown/);
 const second=review.request({rows:[]});review.answer({id:events.at(-1).id,accept:true});assert.equal(await second,true);
});
await check('agent enum choice and reviewed-caption results pass normal tool validation and completion',async()=>{
 let state=historyReducer({past:[],present:project,future:[]},{type:'beginAgentEdit',token:'owner'});const events=[];
 const api={pluginsList:async()=>[{key,enabled:true,manifest}],pluginsRunCommand:async request=>{assert.equal(request.input.language,'fr');assert.equal(request.captions.length,2);return {status:'completed',key,reviewed:true,markers:[],translation:{...proposal,sourceTrack:1}};},pluginsCancelCommand:async()=>{},onPluginCommandProgress:()=>()=>{}};
 const ctx={allowPluginCommands:true,getProject:()=>state.present,dispatch:a=>{state=historyReducer(state,{...a,agentToken:'owner'});},settle:async()=>{},editActive:()=>state.agentEdit?.token==='owner',isCanceled:()=>false,api};
 const host=createToolHost({...nativeTools('codex-sdk'),ctx,contents:[],onEvent:e=>events.push(e),isCanceled:()=>false,requestId:'owner'});
 await host.enqueue({name:'list_plugin_commands',args:{}});const applied=await host.enqueue({name:'run_plugin_command',args:{key,command_id:command.id,input:[{id:'language',choice:'fr'}]}});assert.ok(!applied.error,applied.error);assert.equal(applied.captions_added,2);assert.equal(applied.caption_track,2);assert.equal(state.agentEdit.steps.length,1);assert.ok((await host.enqueue({name:'complete_edit',args:{}})).ready);
});
console.log(`${checks} caption translation checks passed`);
