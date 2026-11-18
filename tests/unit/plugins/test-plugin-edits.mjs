import assert from 'node:assert/strict';
import {emptyProject,historyReducer,preparePluginEdits,pluginEditsApplied,prepareProjectAction,freeLen} from '../../../src/state/store.js';
import {createEditorContext} from '../../../src/features/plugins/editorContext.js';
import {clipTransaction} from '../../../shared/pluginEdits.mjs';
// Historical schema assertions are read-only; native edit planning remains in use.
import {validateLegacyManifest as validateManifest} from '../../../shared/legacyPluginManifest.mjs';
let checks=0;const check=(name,fn)=>{fn();checks++;console.log('PASS',name);};
const fixture=()=>{
 const project={...emptyProject(),videoClips:[{id:'main',gap:true,in:0,out:12}],media:[{id:'audio-media',type:'audio',duration:20},{id:'image',type:'image'}],
 textClips:[{id:'text-one',start:1,duration:2,layer:0,text:'one two',caption:true,word_timing:'measured',words:[{text:'one',start:0,end:1},{text:'two',start:1,end:2}],anim:{in:{type:'fade'},out:{type:'fade'}}},{id:'text-two',start:5,duration:2,layer:0,text:'other'}],
 audioClips:[{id:'audio',mediaId:'audio-media',start:1,in:2,out:10,speed:2,layer:0,fadeIn:2,fadeOut:2,keyframes:{x:[{t:3,v:0}]}}],
 overlayClips:[{id:'overlay',mediaId:'image',start:3,in:0,out:3,layer:0}],effectClips:[{id:'fx',start:1,duration:2}]};
 const state=historyReducer({past:[],present:emptyProject(),future:[]},{type:'load',project}),read=createEditorContext(),snapshot=read(state.present,null,{time_sec:0,playing:false}),targets=read.targets(snapshot);
 const handle=id=>targets.find(t=>t.id===id).handle;
 const tx=operations=>({documentId:snapshot.documentId,revision:snapshot.revision,operations});
 const prepare=operations=>preparePluginEdits(state.present,snapshot,targets,tx(operations));
 return {state,read,snapshot,targets,handle,tx,prepare};
};
let f=fixture();const original=f.state.present;
let plan=f.prepare([{type:'move',clipId:f.handle('text-one'),start_sec:8},{type:'trim',clipId:f.handle('audio'),start_sec:2,end_sec:4}]);
check('preflight planning does not consume or acknowledge the edit token',()=>{const preview=prepareProjectAction(original,plan.action);assert.equal(preview.project.textClips[0].start,8);assert.equal(pluginEditsApplied(f.state,plan.action),false);});
let edited=historyReducer(f.state,plan.action);
check('mixed move/trim is one atomic history entry with actual receipt',()=>{assert.equal(plan.clipsChanged,2);assert.equal(edited.past.length,1);assert.equal(pluginEditsApplied(edited,plan.action),true);assert.equal(edited.present.textClips[0].start,8);});
check('replaying reducer evaluation is pure before React commits',()=>assert.deepEqual(historyReducer(f.state,plan.action),edited));
check('audio trim scales source timing and preserves fade envelopes and source keyframes',()=>{const c=edited.present.audioClips[0];assert.equal(c.in,4);assert.equal(c.out,8);assert.equal(c.start,2);assert.equal(c.fadeInOffset,1);assert.equal(c.fadeOutOffset,1);assert.equal(c.keyframes,original.audioClips[0].keyframes);});
check('one Undo restores all clip fields and Redo restores the batch',()=>{const undo=historyReducer(edited,{type:'undo'});assert.deepEqual(undo.present,original);assert.deepEqual(historyReducer(undo,{type:'redo'}).present,edited.present);});
check('private prepared tokens cannot be replayed after Undo',()=>assert.deepEqual(historyReducer(historyReducer(edited,{type:'undo'}),plan.action).present,original));
const caption=f.prepare([{type:'trim',clipId:f.handle('text-one'),start_sec:2,end_sec:3}]);const captionState=historyReducer(f.state,caption.action).present.textClips[0];
check('text trim crops measured words and entrance/exit animations',()=>{assert.deepEqual(captionState.words,[{text:'two',start:0,end:1}]);assert.equal(captionState.text,'two');assert.equal(captionState.word_timing,'measured');assert.equal(captionState.anim.in,undefined);assert.ok(captionState.anim.out);});
check('caption crops cannot erase all measured words',()=>{const p={...original,textClips:original.textClips.map(c=>c.id==='text-one'?{...c,words:[{text:'one',start:0,end:.4}]}:c)};assert.throws(()=>preparePluginEdits(p,f.snapshot,f.targets,f.tx([{type:'trim',clipId:f.handle('text-one'),start_sec:2,end_sec:3}])));});
check('move then trim composes against intermediate timing',()=>{const p=f.prepare([{type:'move',clipId:f.handle('audio'),start_sec:5},{type:'trim',clipId:f.handle('audio'),start_sec:6,end_sec:8}]);const c=historyReducer(f.state,p.action).present.audioClips[0];assert.equal(c.in,4);assert.equal(c.out,8);assert.equal(c.start,6);});
const swap=f.prepare([{type:'move',clipId:f.handle('text-one'),start_sec:5},{type:'move',clipId:f.handle('text-two'),start_sec:1}]);
check('final-state collision checks permit a simultaneous swap',()=>assert.equal(historyReducer(f.state,swap.action).present.textClips[0].start,5));
check('no-op transactions add no Undo step',()=>assert.deepEqual(f.prepare([{type:'move',clipId:f.handle('text-one'),start_sec:1}]),{action:null,clipsChanged:0}));
for(const ops of [
 [{type:'move',clipId:f.handle('text-one'),start_sec:8},{type:'move',clipId:f.handle('text-two'),start_sec:8}],
 [{type:'move',clipId:f.handle('text-one'),start_sec:8},{type:'trim',clipId:f.handle('audio'),start_sec:0,end_sec:2}],
 [{type:'move',clipId:f.handle('text-one'),start_sec:11}],
 [{type:'trim',clipId:f.handle('text-one'),start_sec:1,end_sec:1.05}],
 [{type:'move',clipId:f.handle('main'),start_sec:0}],
 [{type:'move',clipId:'text-one',start_sec:8}],
 [{type:'move',clipId:f.handle('text-one'),start_sec:NaN}],
 [{type:'move',clipId:f.handle('text-one'),start_sec:8,patch:{text:'forged'}}],
 Array.from({length:65},()=>({type:'move',clipId:f.handle('text-one'),start_sec:8})),
 ])check('invalid transaction fails before any edit or history change',()=>{assert.throws(()=>f.prepare(ops));assert.equal(f.state.present,original);assert.equal(f.state.past.length,0);});
check('scope and revision must match the captured command context',()=>{for(const extra of [{documentId:'d-other'},{revision:999}])assert.throws(()=>clipTransaction({...f.tx([{type:'move',clipId:f.handle('text-one'),start_sec:8}]),...extra},f.snapshot,12));});
let locked={...original,layerState:{'text:0':{locked:true}}};
check('host checks locks even if public metadata claims unlocked',()=>assert.throws(()=>preparePluginEdits(locked,f.snapshot,f.targets,f.tx([{type:'move',clipId:f.handle('text-one'),start_sec:8}]))));
let linked={...original,audioClips:original.audioClips.map(c=>({...c,linkId:'pair'}))};
check('linked targets cannot cause hidden partner changes',()=>assert.throws(()=>preparePluginEdits(linked,f.snapshot,f.targets,f.tx([{type:'move',clipId:f.handle('audio'),start_sec:6}]))));
const stale=f.prepare([{type:'move',clipId:f.handle('text-one'),start_sec:8}]);
check('queued document edits reject an entire prepared batch',()=>{const changed=historyReducer(f.state,{type:'setProject',patch:{name:'User edit'}});assert.equal(historyReducer(changed,stale.action),changed);assert.equal(pluginEditsApplied(f.state,stale.action),false);});
check('gestures and foreign agent ownership reject commits',()=>{assert.equal(historyReducer({...f.state,gestureStart:original},stale.action).present,original);const agent=historyReducer(f.state,{type:'beginAgentEdit',token:'agent'});assert.equal(historyReducer(agent,stale.action).present,original);assert.equal(historyReducer(agent,{...stale.action,agentToken:'other'}).present,original);});
check('forged reducer tokens cannot mint an edit',()=>assert.equal(historyReducer(f.state,{type:'pluginClipEdits',base:original,token:{}}),f.state));
let agent=historyReducer(f.state,{type:'beginAgentEdit',token:'agent'}),agentPlan=f.prepare([{type:'move',clipId:f.handle('text-one'),start_sec:8}]);
agent={...agent,present:{...agent.present,craftAI:{private:'latest chat'}}};agent=historyReducer(agent,{...agentPlan.action,agentToken:'agent'});
check('CraftAI records one guarded step and retains latest chat metadata',()=>{assert.equal(agent.agentEdit.steps.length,1);assert.deepEqual(agent.present.craftAI,{private:'latest chat'});assert.equal(agent.present.textClips[0].start,8);assert.ok(pluginEditsApplied(agent,agentPlan.action));});
const large={...original,textClips:Array.from({length:300},(_,i)=>({id:'large-'+i,start:i*.3,duration:.2,layer:0}))};
// An omitted obstacle on a represented layer must still be caught by full-project validation.
large.textClips.push({id:'obstacle',start:100,duration:1,layer:0});
const read=createEditorContext(),snapshot=read(large,{track:'text',id:'large-0'},{time_sec:0,playing:false}),targets=read.targets(snapshot),clip=targets.find(t=>t.id==='large-0');
check('collisions outside the bounded snapshot still fail',()=>{assert.ok(!targets.some(t=>t.id==='obstacle'));assert.throws(()=>preparePluginEdits(large,snapshot,targets,{documentId:snapshot.documentId,revision:snapshot.revision,operations:[{type:'move',clipId:clip.handle,start_sec:100}]}));});
const manifest={id:'studio.edits',name:'Edits',publisher:'Studio',version:'1.0.0',apiVersion:1,entry:'commands.js',permissions:['editor.read','clips.write'],contributes:{commands:[{id:'run',name:'Run'}]}};
check('manifest accepts a separate clip-write capability',()=>assert.ok(validateManifest(manifest)));
for(const permissions of [['clips.write'],['editor.read','clips.write','markers.write'],['editor.read','clips.write','export.gif'],['editor.read','clips.write','captions.read']])check('clip writes cannot mix incompatible grant contracts',()=>assert.throws(()=>validateManifest({...manifest,permissions})));
console.log(JSON.stringify({ok:true,checks}));
