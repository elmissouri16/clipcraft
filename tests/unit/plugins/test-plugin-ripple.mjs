// Native edit planning and read-only historical metadata regression.
import assert from 'node:assert/strict';
import {emptyProject,historyReducer,preparePluginEdits,prepareProjectAction,pluginEditsApplied,videoLayout,projectDuration} from '../../../src/state/store.js';
import {createEditorContext} from '../../../src/features/plugins/editorContext.js';
import {validateLegacyManifest as validateManifest} from '../../../shared/legacyPluginManifest.mjs';
import {actionState} from '../../../shared/pluginActions.mjs';
import {actionSelection} from '../../fixtures/plugins/legacySelection.mjs';
import {audioGain} from '../../../src/features/audio/fades.js';
let checks=0,generated=0;
const check=(name,fn)=>{fn();checks++;console.log('PASS',name);},near=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`),grants=['editor.read','timeline.ripple','clips.write','clips.links'];
const mainClip=(id,length,extra={})=>({id,mediaId:'v',in:0,out:length,speed:1,...extra});
function fixture({extra={},plain=false,selection=null}={}){
 let project={...emptyProject(),media:[{id:'v',type:'video',duration:30},{id:'a',type:'audio',duration:30}],videoClips:[mainClip('lead',2),mainClip('gap',1,{gap:true}),mainClip('p',4,{in:1,out:5,linkId:'private-p',anim:{in:{type:'fade'},out:{type:'fade'}},keyframes:{opacity:[{t:1,v:.5}]}}),mainClip('tail',3,{in:5,out:8}),mainClip('trailing',2,{gap:true})],overlayClips:[{id:'q',mediaId:'v',start:4,in:.1,out:3.1,speed:1.5,layer:0,linkId:'private-q'},{id:'o',mediaId:'v',start:8,in:1,out:3,speed:1,layer:1}],audioClips:[{id:'pa',mediaId:'a',start:3.25,in:2,out:6,speed:1,layer:0,linkId:'private-p',linkOff:.25,linkInOff:1,fadeIn:.4,fadeOut:.4,volumeKeys:[{t:2,v:.5}]},{id:'qa',mediaId:'a',start:4.125,in:.3,out:3.3,speed:1.5,layer:1,linkId:'private-q',linkOff:.125,linkInOff:.2},{id:'f',mediaId:'a',start:8.5,in:5,out:7,speed:1,layer:2}],textClips:[{id:'t',start:7.5,duration:2,text:'Title',layer:0}],effectClips:[{id:'e',start:8,duration:1,fx:'vignette',layer:0}],markers:[{id:'mark',time:9,label:'Absolute marker'}],...extra};
 if(plain)for(const track of ['video','overlay','audio'])project={...project,[track+'Clips']:project[track+'Clips'].map(c=>{const {linkId,linkOff,linkInOff,...rest}=c;return rest;})};
 const state=historyReducer({past:[],present:emptyProject(),future:[]},{type:'load',project}),read=createEditorContext(),snapshot=read(state.present,selection,{time_sec:0,playing:false}),targets=read.targets(snapshot),handle=id=>targets.find(t=>t.id===id)?.handle,pair=id=>({clipId:handle(id),partnerClipId:handle(id+'a')});
 const op=(start_sec=4,end_sec=5,clips=['o','f','t','e'],pairs=['p','q'])=>({type:'ripple-remove',start_sec,end_sec,clipIds:clips.map(handle),linkedPairs:pairs.map(pair),gaps:'preserve-pieces',transitions:'reject',markers:'preserve'}),tx=operations=>({documentId:snapshot.documentId,revision:snapshot.revision,operations}),prepare=(ops,permissions=grants)=>preparePluginEdits(state.present,snapshot,targets,tx(ops),permissions),apply=ops=>{const plan=prepare(ops);return {plan,state:plan.action?historyReducer(state,plan.action):state};};
 return {state,read,snapshot,targets,handle,pair,op,tx,prepare,apply};
}
const f=fixture();
check('ripple cuts main sources and closes exactly the removed clock interval',()=>{
 const r=f.apply([f.op()]),p=r.state.present,l=videoLayout(p.videoClips);assert.equal(r.plan.clipsChanged,12);assert.equal(r.state.past.length,1);near(projectDuration(p),11);
 assert.deepEqual(l.map(x=>[x.clip.mediaId,x.start,x.end,x.clip.in,x.clip.out]),[['v',0,2,0,2],['v',2,3,0,1],['v',3,4,1,2],['v',4,6,3,5],['v',6,9,5,8],['v',9,11,0,2]]);
 const sound=p.audioClips.filter(c=>c.linkOff===.25);assert.equal(sound.length,2);assert.deepEqual(sound.map(c=>[c.start,c.in,c.out]),[[3.25,2,3],[4.25,4,6]]);
 const pictures=p.videoClips.filter(c=>c.linkId);assert.equal(pictures.length,2);assert.notEqual(pictures[0].linkId,pictures[1].linkId);for(let i=0;i<2;i++)assert.equal(pictures[i].linkId,sound[i].linkId);
 near(p.overlayClips[0].start,4);near(p.overlayClips[0].in,1.6);near(p.audioClips.find(c=>c.id==='qa').start,4.125);assert.equal(p.audioClips.find(c=>c.id==='qa').out,3.3);
 assert.equal(p.overlayClips[1].start,7);assert.equal(p.audioClips.find(c=>c.id==='f').start,7.5);assert.equal(p.textClips[0].start,6.5);assert.equal(p.effectClips[0].start,7);assert.equal(p.markers,f.state.present.markers);
 assert.equal(p.media,f.state.present.media);assert.deepEqual(historyReducer(r.state,{type:'undo'}).present,f.state.present);assert.deepEqual(historyReducer(historyReducer(r.state,{type:'undo'}),{type:'redo'}).present,p);
});
check('free tracks and unlisted overlay pairs stay absolutely unchanged',()=>{
 const p=f.apply([f.op(4,5,[],['p'])]).state.present;assert.equal(p.overlayClips,f.state.present.overlayClips);assert.equal(p.textClips,f.state.present.textClips);assert.equal(p.effectClips,f.state.present.effectClips);assert.equal(p.audioClips.find(c=>c.id==='qa'),f.state.present.audioClips.find(c=>c.id==='qa'));assert.equal(p.audioClips.find(c=>c.id==='f'),f.state.present.audioClips.find(c=>c.id==='f'));
});
check('linked source fades, curves and independent fractional windows remain continuous',()=>{
 const p=f.apply([f.op()]).state.present,old=f.state.present.audioClips[0],parts=p.audioClips.filter(c=>c.linkOff===.25);
 for(let i=0;i<2;i++)for(const t of [.1,.4,.8])near(audioGain(parts[i],t,i?2:1),audioGain(old,t+(i?2:0),4));
 for(const c of p.videoClips.filter(c=>c.linkId))assert.equal(c.keyframes,f.state.present.videoClips[2].keyframes);
 const a=p.audioClips.find(c=>c.id==='qa');assert.equal(a.out,3.3);near(a.in,1.8);assert.equal(a.linkInOff,.2);
});
check('whole interval removal counts deleted pictures and sound; markers stay fixed',()=>{
 const r=f.apply([f.op(0,12)]);for(const track of ['video','overlay','audio','text','effect'])assert.deepEqual(r.state.present[track+'Clips'],[]);assert.equal(r.plan.clipsChanged,12);assert.equal(r.state.present.markers,f.state.present.markers);near(projectDuration(r.state.present),0);
});
check('gaps are cut into surviving pieces without merging or dropping trailing time',()=>{
 const p=f.apply([f.op(2.25,2.75,[],['p'])]).state.present;const gaps=p.videoClips.filter(c=>c.gap);assert.equal(gaps.length,3);near((gaps[0].out-gaps[0].in)/(gaps[0].speed||1),.25);near((gaps[1].out-gaps[1].in)/(gaps[1].speed||1),.25);assert.equal(gaps[0].id,'gap');assert.ok(gaps[1].id.startsWith('plugin-'));assert.equal(gaps[2].id,'trailing');near(projectDuration(p),11.5);
});
check('closing a complete short gap does not impose the retained-piece minimum on deletion',()=>{
 const x=fixture({plain:true,extra:{videoClips:[mainClip('a',2),mainClip('gap',.05,{gap:true}),mainClip('b',2)],overlayClips:[],audioClips:[],textClips:[],effectClips:[]}}),p=x.apply([x.op(2,2.05,[],[])]).state.present;assert.deepEqual(p.videoClips.map(c=>c.id),['a','b']);near(projectDuration(p),4);
});
for(const mutate of [o=>o.start_sec=-1,o=>o.end_sec=13,o=>o.end_sec=o.start_sec,o=>o.markers='shift',o=>o.gaps='merge',o=>o.transitions='clear-boundaries',o=>o.clipIds.push(o.clipIds[0]),o=>o.linkedPairs.push(o.linkedPairs[0]),o=>o.clipIds=[f.handle('pa')],o=>o.linkedPairs[0].partnerClipId='raw',o=>o.rawId='private',o=>o.clipIds=Array(64).fill(f.handle('t'))])check('unsupported ripple scope, fields and policies reject atomically',()=>{const op=f.op();mutate(op);assert.throws(()=>f.prepare([op]));assert.equal(f.state.past.length,0);});
for(let mask=0;mask<64;mask++)check('ripple permission boundary '+mask,()=>{
 const names=['timeline.ripple','clips.write','clips.links','timeline.edit','clips.linked','timeline.reorder'],permissions=['editor.read',...names.filter((_,i)=>mask&(1<<i))];
 if(['timeline.ripple','clips.write','clips.links'].every(p=>permissions.includes(p)))assert.ok(f.prepare([f.op()],permissions).action);else assert.throws(()=>f.prepare([f.op()],permissions),/Permission denied/);
});
check('ripple-only permission can cut main while leaving every free clip fixed',()=>{const x=fixture({plain:true}),p=historyReducer(x.state,x.prepare([x.op(4,5,[],[])],['editor.read','timeline.ripple']).action).present;assert.equal(p.audioClips,x.state.present.audioClips);assert.equal(p.overlayClips,x.state.present.overlayClips);near(projectDuration(p),11);});
check('unnamed main pairs and foreign group members are never implicitly written',()=>{
 assert.throws(()=>f.prepare([f.op(4,5,[],[])]),/every affected linked/);const x=fixture({extra:{textClips:[{id:'hidden',start:0,duration:1,linkId:'private-p'}]}});assert.throws(()=>x.prepare([x.op()]));
});
check('a ripple operation cannot share authority with other staged operations',()=>{assert.throws(()=>f.prepare([f.op(),{type:'move',clipId:f.handle('t'),start_sec:1}]),/only operation/);assert.throws(()=>f.prepare([{type:'move',clipId:f.handle('t'),start_sec:1},f.op()]),/only operation/);});
check('retained tiny pieces reject instead of silently disappearing',()=>{for(const [a,b] of [[3.05,5],[4,6.95],[2.05,2.95]])assert.throws(()=>f.prepare([f.op(a,b)]),/0.1/);});
for(const lane of ['video:0','audio:0','audio:1','text:0'])check('declared ripple locks reject '+lane,()=>{const x=fixture({extra:{layerState:{[lane]:{locked:true}}}});assert.throws(()=>x.prepare([x.op()]),/locked/);});
check('unselected locked free layers do not block a main-only scope',()=>{const x=fixture({extra:{layerState:{'text:0':{locked:true}}}});assert.ok(x.prepare([x.op(4,5,[],['p'])]).action);});
check('ripple cannot collide with an unselected clip or silently change layers',()=>{
 const x=fixture({extra:{overlayClips:[...f.state.present.overlayClips,{id:'busy',mediaId:'v',start:7.2,in:0,out:.5,layer:1}]}});assert.throws(()=>x.prepare([x.op()]),/overlap/);
});
check('negative linked starts and inconsistent source offsets reject without repair',()=>{
 const x=fixture({extra:{audioClips:f.state.present.audioClips.map(c=>c.id==='pa'?{...c,start:2.75,linkOff:-.25}:c)}});assert.throws(()=>x.prepare([x.op(0,3,[],['p'])]),/aligned|offset|invalid/);
 const y=fixture({extra:{audioClips:f.state.present.audioClips.map(c=>c.id==='pa'?{...c,linkInOff:8}:c)}});assert.throws(()=>y.prepare([y.op()]));
});
check('transition boundaries and overlap are retained exactly outside the cut',()=>{
 const transition={type:'fade',duration:.5},x=fixture({extra:{videoClips:f.state.present.videoClips.map(c=>c.id==='tail'?{...c,transition}:c)}}),p=x.apply([x.op(4,5)]).state.present;
 assert.equal(p.videoClips.find(c=>c.id==='tail').transition,transition);near(videoLayout(p.videoClips).find(l=>l.clip.id==='tail').start,5.5);assert.throws(()=>x.prepare([x.op(6.6,7.1)]),/transition|0.1/);
});
check('dormant transition records are preserved or rejected, never activated implicitly',()=>{
 const x=fixture({extra:{videoClips:f.state.present.videoClips.map(c=>c.id==='lead'?{...c,transition:{type:'fade',duration:.5}}:c)}});assert.ok(x.prepare([x.op()]).action);assert.throws(()=>x.prepare([x.op(0,1)]),/transition/);
});
check('caption pieces keep measured words and refuse empty-word survivors',()=>{
 const text={id:'t',start:3.5,duration:2,layer:0,caption:true,text:'One Two',words:[{start:0,end:.6,text:'One'},{start:1.4,end:2,text:'Two'}]},x=fixture({extra:{textClips:[text]}}),p=x.apply([x.op()]).state.present;
 assert.deepEqual(p.textClips.map(c=>c.text),['One','Two']);assert.deepEqual(p.textClips.map(c=>[c.start,c.duration]),[[3.5,.5],[4,.5]]);
 const y=fixture({extra:{textClips:[{...text,words:[{start:0,end:.2,text:'One'}],text:'One'}]}});assert.throws(()=>y.prepare([y.op()]),/no measured words/);
});
check('motion-pin dependencies on removed or shifted source records reject',()=>{
 const x=fixture({extra:{videoClips:f.state.present.videoClips.map(c=>c.id==='p'?{...c,track:{points:[{t:1,x:.5,y:.5}]}}:c),textClips:[{id:'t',start:0,duration:1,layer:0,pin:{to:'p'}}]}});assert.throws(()=>x.prepare([x.op()]),/motion-pin/);
});
check('all removed, new and retimed records share the affected-clip budget',()=>{
 const main=Array.from({length:64},(_,i)=>mainClip('v'+i,1)),x=fixture({plain:true,extra:{videoClips:main,overlayClips:[],audioClips:[],textClips:[],effectClips:[]}});assert.equal(x.prepare([x.op(0,64,[],[])]).clipsChanged,64);
 const y=fixture({plain:true,extra:{videoClips:[...main,mainClip('last',1)],overlayClips:[],audioClips:[],textClips:[],effectClips:[]}});assert.throws(()=>y.prepare([y.op(0,1,[],[])]),/64 clips/);
});
check('hidden unlinked main time is bounded; hidden linked time still needs explicit pairs',()=>{
 const main=Array.from({length:300},(_,i)=>mainClip('v'+i,1)),x=fixture({plain:true,extra:{videoClips:main,overlayClips:[],audioClips:[],textClips:[],effectClips:[]}});assert.equal(x.handle('v299'),undefined);assert.equal(x.prepare([x.op(299,300,[],[])]).clipsChanged,1);
 main[299]=mainClip('p',1,{linkId:'private-p'});const y=fixture({extra:{videoClips:main,audioClips:[{...f.state.present.audioClips[0],start:299.25,out:3}],overlayClips:[],textClips:[],effectClips:[]}});assert.throws(()=>y.prepare([y.op(299,300,[],[])]),/every affected linked/);
});
check('private ripple tokens are pure, single-use and scoped to base and edit owner',()=>{
 const plan=f.prepare([f.op()]);assert.equal(pluginEditsApplied(f.state,plan.action),false);assert.equal(prepareProjectAction(f.state.present,plan.action).project.videoClips.length,6);const out=historyReducer(f.state,plan.action),undo=historyReducer(out,{type:'undo'});assert.equal(historyReducer(undo,plan.action),undo);assert.deepEqual(historyReducer(f.state,plan.action),out);
 const changed=historyReducer(f.state,{type:'setProject',patch:{name:'Manual'}});assert.equal(historyReducer(changed,plan.action),changed);const gesture={...f.state,gestureStart:f.state.present};assert.equal(historyReducer(gesture,plan.action),gesture);
 const owner=historyReducer(f.state,{type:'beginAgentEdit',token:'owner'});assert.equal(historyReducer(owner,plan.action),owner);assert.equal(historyReducer(owner,{...plan.action,agentToken:'owner'}).agentEdit.steps.length,1);
});
check('generated range cuts match an independent source/time-map oracle',()=>{
 const media=[0,1,2].map(i=>({id:'v'+i,type:'video',duration:30})),main=[mainClip('v0',2,{mediaId:'v0'}),mainClip('v1',2.25,{mediaId:'v1',speed:1.5}),mainClip('v2',2.5,{mediaId:'v2'})],x=fixture({plain:true,extra:{media:[...media,{id:'a',type:'audio',duration:30}],videoClips:main,overlayClips:[],audioClips:[{id:'f',mediaId:'a',start:.5,in:2,out:7.5,layer:0}],textClips:[{id:'t',start:1,duration:4,text:'Keep',layer:0}],effectClips:[]}});
 const round=n=>Math.round(n*1e8)/1e8,spans=(a,b,s,e)=>[[a,Math.min(b,s)],[Math.max(a,e),b]].filter(([from,to])=>to>from),map=(t,s,e)=>t-(t>=e?e-s:0),base=x.state.present;
 for(let s=0;s<6;s+=.25)for(let e=s+.25;e<=6;e+=.25)for(const selected of [false,true]){
  const before=JSON.stringify(base),r=x.apply([x.op(s,e,selected?['f','t']:[],[])]),out=r.state.present;generated++;
  let at=0;const expected=[];for(const c of base.videoClips){const end=at+(c.out-c.in)/(c.speed||1);for(const [from,to] of spans(at,end,s,e))expected.push([c.mediaId,round(map(from,s,e)),round(map(to,s,e)),round(c.in+(from-at)*(c.speed||1)),round(c.in+(to-at)*(c.speed||1))]);at=end;}
  assert.deepEqual(videoLayout(out.videoClips).map(l=>[l.clip.mediaId,round(l.start),round(l.end),round(l.clip.in),round(l.clip.out)]),expected);
  for(const track of ['audio','text']){const c=base[track+'Clips'][0],length=track==='audio'?c.out-c.in:c.duration,kept=selected?spans(c.start,c.start+length,s,e):[[c.start,c.start+length]],want=kept.map(([from,to])=>track==='audio'?[round(selected?map(from,s,e):from),round(c.in+from-c.start),round(c.in+to-c.start)]:[round(selected?map(from,s,e):from),round(to-from)]);assert.deepEqual(out[track+'Clips'].map(c=>track==='audio'?[round(c.start),round(c.in),round(c.out)]:[round(c.start),round(c.duration)]),want);}
  assert.equal(out.markers,base.markers);assert.equal(out.media,base.media);assert.equal(JSON.stringify(base),before);assert.deepEqual(historyReducer(r.state,{type:'undo'}).present,base);assert.deepEqual(historyReducer(historyReducer(r.state,{type:'undo'}),{type:'redo'}).present,out);
 }
});
const manifest={id:'studio.ripple',name:'Ripple',publisher:'Studio',version:'1.0.0',apiVersion:1,entry:'commands.js',permissions:grants,contributes:{commands:[{id:'run',name:'Run'}]}};
check('manifest and menus expose ripple explicitly while old grants keep their scope',()=>{
 assert.ok(validateManifest(manifest));assert.throws(()=>validateManifest({...manifest,permissions:['timeline.ripple']}));for(const permission of ['markers.write','captions.read','ai.chapters','export.gif'])assert.throws(()=>validateManifest({...manifest,permissions:[...grants,permission]}));
 const selection=actionSelection(f.state.present,{track:'video',id:'gap'});assert.equal(actionState({locations:['clip-menu'],permissions:['timeline.ripple']},'clip-menu',{hasProject:true,selection}).enabled,true);assert.equal(actionState({locations:['clip-menu'],permissions:['timeline.edit']},'clip-menu',{hasProject:true,selection}).visible,false);
});
console.log(JSON.stringify({ok:true,checks,generated}));
