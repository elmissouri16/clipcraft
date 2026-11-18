import assert from 'node:assert/strict';
import {emptyProject,historyReducer,preparePluginEdits,pluginEditsApplied,videoLayout,projectDuration} from '../../../src/state/store.js';
import {createEditorContext} from '../../../src/features/plugins/editorContext.js';
// Historical schema assertions are read-only; native edit planning remains in use.
import {validateLegacyManifest as validateManifest} from '../../../shared/legacyPluginManifest.mjs';

// Independent bounded oracle: topology and placement only. It does not invoke
// planner helpers, normalize the expected project, or ignore source fields.
const grants=['clips.write','timeline.reorder','timeline.edit','clips.linked','clips.links'];
let checks=0,permissionCases=0,generatedCases=0,generatedAccepted=0,generatedRejected=0,rejections=0;
const check=(name,fn)=>{fn();checks++;console.log('PASS',name);};
function freeze(value){if(value&&typeof value==='object'&&!Object.isFrozen(value)){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}
function fixture({linked=true,offset=0,speed=1.5}={}){
 const p={...emptyProject(),media:[{id:'v',type:'video',duration:50},{id:'a',type:'audio',duration:50}],videoClips:[{id:'main-a',mediaId:'v',in:0,out:2},{id:'main-b',mediaId:'v',in:2,out:4},{id:'gap',gap:true,in:0,out:12}],
  overlayClips:[{id:'p',mediaId:'v',start:4,in:.1,out:.1+4*speed,speed,layer:0,...(linked?{linkId:'private-p'}:{})},{id:'q',mediaId:'v',start:2,in:1,out:3,speed:1,layer:1}],
  audioClips:[{id:'pa',mediaId:'a',start:4+offset,in:.3,out:.3+4*speed,speed,layer:0,...(linked?{linkId:'private-p',linkOff:offset,linkInOff:.2}:{})},{id:'qa',mediaId:'a',start:2.25,in:4,out:6,speed:1,layer:1}],
  textClips:[{id:'text',start:0,duration:1,text:'Unrelated title',layer:0}],markers:[{id:'marker',time:3,label:'Keep'}]};
 const state=historyReducer({past:[],present:emptyProject(),future:[]},{type:'load',project:p}),read=createEditorContext(),snapshot=read(state.present,null,{time_sec:0,playing:false}),targets=read.targets(snapshot),handle=id=>targets.find(t=>t.id===id).handle;
 const tx=operations=>({documentId:snapshot.documentId,revision:snapshot.revision,operations});
 const pair=(type,id='p',start_sec=9)=>({type,clipId:handle(id),partnerClipId:handle(id+'a'),...(type==='move-linked'?{start_sec,gaps:'preserve-time',transitions:'reject'}:{})});
 freeze(state.present);freeze(snapshot);freeze(targets);
 const prepare=(ops,permissions=['editor.read',...grants])=>preparePluginEdits(state.present,snapshot,targets,freeze(tx(ops)),permissions);
 return {state,snapshot,targets,handle,pair,tx,prepare};
}
const f=fixture(),operations=[
 ['clips.write',{type:'move',clipId:f.handle('text'),start_sec:14}],
 ['clips.write',{type:'trim',clipId:f.handle('text'),start_sec:.2,end_sec:.8}],
 ['timeline.reorder',{type:'reorder',clipId:f.handle('main-b'),beforeClipId:f.handle('main-a'),gaps:'preserve',transitions:'reject'}],
 ['timeline.edit',{type:'split',clipId:f.handle('main-a'),at_sec:1,gaps:'preserve-time',transitions:'reject'}],
 ['timeline.edit',{type:'trim-main',clipId:f.handle('main-a'),start_sec:.25,end_sec:1.75,gaps:'preserve-time',transitions:'reject'}],
 ['clips.linked',{type:'split-linked',...f.pair('split-linked'),at_sec:6,gaps:'preserve-time',transitions:'reject'}],
 ['clips.linked',{...f.pair('trim-linked'),start_sec:4.5,end_sec:7.5,gaps:'preserve-time',transitions:'reject'}],
 ['clips.links',f.pair('link','q')],['clips.links',f.pair('unlink')],['clips.links',f.pair('move-linked')],
];
check('all permission subsets preserve separate operation authority',()=>{
 for(let mask=0;mask<32;mask++)for(const [required,op] of operations){
  const permissions=['editor.read',...grants.filter((_,i)=>mask&(1<<i))],before=JSON.stringify(f.state.present);
  if(permissions.includes(required))assert.ok(f.prepare([structuredClone(op)],permissions).action,op.type);
  else{assert.throws(()=>f.prepare([structuredClone(op)],permissions),new RegExp('Permission denied: '+required.replace('.','\\.')));rejections++;}
  assert.equal(JSON.stringify(f.state.present),before);permissionCases++;
 }
});
check('manifest combinations require editor access and exclude unrelated mutation/AI/export grants',()=>{
 const manifest={id:'audit.transactions',name:'Transaction audit',publisher:'ClipCraft test',version:'1.0.0',apiVersion:1,entry:'commands.js',contributes:{commands:[{id:'run',name:'Run'}]}};
 for(let mask=1;mask<32;mask++){
  const selected=grants.filter((_,i)=>mask&(1<<i));assert.doesNotThrow(()=>validateManifest({...manifest,permissions:['editor.read',...selected]}));
  assert.throws(()=>validateManifest({...manifest,permissions:selected}));
  for(const extra of ['markers.write','captions.read','captions.write','ai.chapters','ai.translateCaptions','export.gif'])assert.throws(()=>validateManifest({...manifest,permissions:['editor.read',...selected,extra]}));
 }
});
function semantic(project){
 return Object.fromEntries(['overlay','audio','text'].map(track=>[track,project[track+'Clips'].map(c=>{const {linkId,...rest}=c;return {...rest,...(linkId?{linked:true}:{})};})]));
}
function oracle(base,specs){
 const expected=structuredClone(semantic(base)),pairs=id=>[expected.overlay.find(c=>c.id===id),expected.audio.find(c=>c.id===id+'a')];
 for(const {type,id,start} of specs){
  if(type==='text'){expected.text[0].start=start;continue;}
  const [p,a]=pairs(id);
  if(type==='link'){
   if(p.linked||a.linked)return null;
   p.linked=true;a.linked=true;a.linkOff=a.start-p.start;a.linkInOff=a.in-p.in;
  }else{
   if(!p.linked||!a.linked)return null;
   if(type==='unlink'){delete p.linked;delete a.linked;delete a.linkOff;delete a.linkInOff;}
   else if(Math.abs(start-p.start)>=1e-8){p.start=start;a.start=start+(a.linkOff||0);}
  }
 }
 return expected;
}
function verifyGenerated(x,specs){
 const expected=oracle(x.state.present,specs),before=JSON.stringify(x.state.present),ops=specs.map(s=>s.type==='text'?{type:'move',clipId:x.handle('text'),start_sec:s.start}:x.pair(s.type,s.id,s.start));
 let plan;
 if(!expected){assert.throws(()=>x.prepare(ops),/unlinked|existing complete pair/);rejections++;generatedRejected++;}
 else{
  generatedAccepted++;
  plan=x.prepare(ops);const out=plan.action?historyReducer(x.state,plan.action):x.state;
  assert.deepEqual(semantic(out.present),expected,JSON.stringify(specs));
  for(const key of Object.keys(x.state.present).filter(k=>!['overlayClips','audioClips','textClips'].includes(k)))assert.equal(out.present[key],x.state.present[key],key);
  const groups=[];for(const id of ['p','q']){const p=out.present.overlayClips.find(c=>c.id===id),a=out.present.audioClips.find(c=>c.id===id+'a');assert.equal(p.linkId,a.linkId);if(p.linkId){assert.ok(!groups.includes(p.linkId));groups.push(p.linkId);assert.equal([p,a].filter(c=>c.linkId===p.linkId).length,2);assert.ok(Math.abs(a.start-p.start-a.linkOff)<1e-8);assert.ok(Math.abs(a.in-p.in-a.linkInOff)<1e-8);assert.ok(Math.abs(a.out-p.out-a.linkInOff)<1e-8);}}
  assert.equal(projectDuration(out.present),16);
  if(plan.action){
   assert.equal(out.past.length,1);assert.ok(pluginEditsApplied(out,plan.action));
   assert.deepEqual(historyReducer(x.state,plan.action),out,'React reducer reevaluation must be pure');
   const undone=historyReducer(out,{type:'undo'});assert.deepEqual(undone.present,x.state.present);assert.equal(historyReducer(undone,plan.action),undone);assert.deepEqual(historyReducer(undone,{type:'redo'}).present,out.present);
  }else assert.equal(out,x.state);
 }
 assert.equal(JSON.stringify(x.state.present),before);generatedCases++;
}
check('generated ordered mixtures match an independent topology/placement/source oracle',()=>{
 const choices=[{type:'link',id:'p'},{type:'unlink',id:'p'},{type:'move-linked',id:'p',start:9},{type:'move-linked',id:'p',start:4},{type:'link',id:'q'},{type:'unlink',id:'q'},{type:'move-linked',id:'q',start:10},{type:'move-linked',id:'q',start:2},{type:'text',start:14}];
 for(const linked of [false,true]){const x=fixture({linked,offset:.125});for(const a of choices)for(const b of choices)for(const c of choices)verifyGenerated(x,[a,b,c]);}
 let seed=0x51a7e;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/2**32;};
 for(let i=0;i<300;i++){
  const x=fixture({linked:i%2===0,offset:[-.25,0,.125][i%3],speed:[.75,1.25,1.5,2][i%4]}),specs=Array.from({length:1+i%7},()=>{const op={...choices[Math.floor(random()*choices.length)]};if(op.type==='move-linked')op.start=8+random();return op;});verifyGenerated(x,specs);
 }
});
check('mixed range, pair, topology and unrelated edits are one exact atomic batch',()=>{
 const ops=[operations[5][1],f.pair('unlink'),operations[4][1],operations[0][1]],plan=f.prepare(structuredClone(ops)),out=historyReducer(f.state,plan.action);
 assert.equal(out.past.length,1);assert.equal(out.present.textClips[0].start,14);assert.equal(out.present.overlayClips.find(c=>c.id==='p').linkId,undefined);
 const right=out.present.overlayClips.find(c=>c.id!=='p'&&c.id!=='q'),audio=out.present.audioClips.find(c=>c.linkId===right.linkId);assert.ok(right.linkId&&audio);assert.equal(audio.in,right.in+.2);assert.equal(audio.out,right.out+.2);assert.equal(right.start,6);assert.equal(audio.start,6);
 assert.equal(videoLayout(out.present.videoClips).find(l=>l.clip.id==='main-b').start,2);assert.equal(out.present.markers,f.state.present.markers);assert.deepEqual(historyReducer(out,{type:'undo'}).present,f.state.present);assert.deepEqual(historyReducer(historyReducer(out,{type:'undo'}),{type:'redo'}).present,out.present);
});
check('unsupported topology/range mixtures reject without partial mutation',()=>{
 const qSplit={...f.pair('split-linked','q'),at_sec:3,gaps:'preserve-time',transitions:'reject'};
 for(const ops of [[f.pair('link','q'),qSplit],[f.pair('unlink'),operations[5][1]],[operations[5][1],f.pair('unlink'),f.pair('move-linked')]]){
  const before=JSON.stringify(f.state.present);assert.throws(()=>f.prepare(structuredClone(ops)));assert.equal(JSON.stringify(f.state.present),before);
 }
});
check('unlink then main range/reorder needs separate grants and keeps the detached audio fixed',()=>{
 const project={...f.state.present,videoClips:f.state.present.videoClips.map(c=>c.id==='main-a'?{...c,linkId:'main-pair'}:c),audioClips:[...f.state.present.audioClips,{id:'main-audio',mediaId:'a',in:0,out:2,start:0,layer:2,linkId:'main-pair',linkOff:0,linkInOff:0}]};
 const state=historyReducer({past:[],present:emptyProject(),future:[]},{type:'load',project}),read=createEditorContext(),snapshot=read(state.present,null,{time_sec:0,playing:false}),targets=read.targets(snapshot),h=id=>targets.find(t=>t.id===id).handle;
 const tx={documentId:snapshot.documentId,revision:snapshot.revision,operations:[{type:'unlink',clipId:h('main-a'),partnerClipId:h('main-audio')},{type:'trim-main',clipId:h('main-a'),start_sec:.25,end_sec:1.75,gaps:'preserve-time',transitions:'reject'},{type:'reorder',clipId:h('main-a'),beforeClipId:null,gaps:'preserve',transitions:'reject'}]},plan=preparePluginEdits(state.present,snapshot,targets,tx,['editor.read','clips.links','timeline.edit','timeline.reorder']),out=historyReducer(state,plan.action);
 assert.equal(out.past.length,1);const a=out.present.audioClips.find(c=>c.id==='main-audio');assert.equal(a.linkId,undefined);assert.equal(a.start,0);assert.equal(a.in,0);assert.equal(a.out,2);assert.equal(videoLayout(out.present.videoClips).find(l=>l.clip.id==='main-a').start,14.5);assert.deepEqual(historyReducer(out,{type:'undo'}).present,state.present);
});
check('mutating proposal objects after planning cannot change a captured private plan',()=>{
 const proposal=f.tx([f.pair('move-linked')]),plan=preparePluginEdits(f.state.present,f.snapshot,f.targets,proposal,['editor.read','clips.links']);proposal.operations[0].start_sec=0;proposal.operations.length=0;
 const out=historyReducer(f.state,plan.action);assert.equal(out.present.overlayClips.find(c=>c.id==='p').start,9);assert.deepEqual(historyReducer(out,{type:'undo'}).present,f.state.present);
});
check('JSON proposals and fake reducer actions cannot opt into private link preservation',()=>{
 const before=JSON.stringify(f.state.present);
 for(const field of ['preservedLinks','shiftedLinks','preparedAction','token','agentToken','base']){
  const tx={...f.tx([f.pair('move-linked')]),[field]:{}};assert.throws(()=>preparePluginEdits(f.state.present,f.snapshot,f.targets,tx,['editor.read',...grants]));
 }
 for(const action of [{type:'preparedPluginClips',token:{},preservedLinks:['private-p']},{type:'pluginClipEdits',token:{},base:f.state.present,preservedLinks:['private-p']}])assert.equal(historyReducer(f.state,action),f.state);
 assert.equal(JSON.stringify(f.state.present),before);
});
check('prepared plans reject document, lock, gesture and owner changes without a receipt',()=>{
 const plan=f.prepare([f.pair('move-linked')]),other=historyReducer(f.state,{type:'beginAgentEdit',token:'other'});
 for(const state of [historyReducer(f.state,{type:'setProject',patch:{name:'Manual edit'}}),{...f.state,present:{...f.state.present,layerState:{'audio:0':{locked:true}}}},{...f.state,gestureStart:f.state.present},other]){assert.equal(historyReducer(state,plan.action),state);assert.equal(pluginEditsApplied(state,plan.action),false);}
 const owned=historyReducer(f.state,{type:'beginAgentEdit',token:'owner'});assert.equal(historyReducer(owned,{...plan.action,agentToken:'foreign'}),owned);
 const out=historyReducer(owned,{...plan.action,agentToken:'owner'});assert.equal(out.agentEdit.steps.length,1);assert.deepEqual(historyReducer(historyReducer(out,{type:'endAgentEdit',token:'owner'}),{type:'undo'}).present,f.state.present);
});
console.log(JSON.stringify({ok:true,checks,permissionCases,generatedCases,generatedAccepted,generatedRejected,rejections,seed:'0x51a7e'}));
