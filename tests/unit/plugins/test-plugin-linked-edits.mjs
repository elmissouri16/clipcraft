// Native edit planning and read-only historical metadata regression.
import assert from 'node:assert/strict';
import {emptyProject,historyReducer,preparePluginEdits,prepareProjectAction,pluginEditsApplied,videoLayout,projectDuration} from '../../../src/state/store.js';
import {createEditorContext} from '../../../src/features/plugins/editorContext.js';
import {editorSnapshot} from '../../../shared/pluginEditor.mjs';
import {clipTransaction} from '../../../shared/pluginEdits.mjs';
import {validateLegacyManifest as validateManifest} from '../../../shared/legacyPluginManifest.mjs';
import {actionState} from '../../../shared/pluginActions.mjs';
import {actionSelection} from '../../fixtures/plugins/legacySelection.mjs';
import {audioGain} from '../../../src/features/audio/fades.js';
let checks=0;const check=(name,fn)=>{fn();checks++;console.log('PASS',name);};
const permissions=['editor.read','clips.linked'],baseClip=(id,n=4,extra={})=>({id,in:0,out:n,speed:1,...extra});
const fixture=({track='video',picture={},sound={},extra={},selection=null}={})=>{
 const pic={id:'private-v',mediaId:'picture-media',in:2,out:10,speed:2,linkId:'private-link/source',effects:['vignette'],anim:{in:{type:'fade'},out:{type:'fade'}},keyframes:{opacity:[{t:2,v:0},{t:10,v:1}]},...picture};
 const main=track==='video'?[baseClip('before'),pic,baseClip('after')]:[baseClip('main',12)];
 const start=track==='video'?videoLayout(main).find(l=>l.clip.id===pic.id).start:4;
 const audio={id:'private-a',mediaId:'audio-media',start,in:5,out:13,speed:2,layer:0,linkId:pic.linkId,linkOff:0,linkInOff:3,fadeIn:3,fadeOut:3,volumeKeys:[{t:5,v:.2},{t:13,v:1}],...sound};
 const project={...emptyProject(),media:[{id:'picture-media',type:'video',duration:30},{id:'audio-media',type:'audio',duration:30}],videoClips:main,overlayClips:track==='overlay'?[{...pic,start}]:[],audioClips:[audio],textClips:[{id:'title',start:0,duration:1,text:'Title',layer:0}],markers:[{id:'marker',time:2,label:'Absolute'}],...extra};
 const state=historyReducer({past:[],present:emptyProject(),future:[]},{type:'load',project}),read=createEditorContext(),snapshot=read(state.present,selection,{time_sec:0,playing:false}),targets=read.targets(snapshot);
 const handle=id=>targets.find(t=>t.id===id)?.handle;
 const split=(at_sec=6,transitions='reject',from='private-v',partner='private-a')=>({type:'split-linked',clipId:handle(from),partnerClipId:handle(partner),at_sec,gaps:'preserve-time',transitions});
 const trim=(start_sec=5,end_sec=7,transitions='reject')=>({type:'trim-linked',clipId:handle('private-v'),partnerClipId:handle('private-a'),start_sec,end_sec,gaps:'preserve-time',transitions});
 const tx=operations=>({documentId:snapshot.documentId,revision:snapshot.revision,operations});
 const prepare=(ops,grants=permissions)=>preparePluginEdits(state.present,snapshot,targets,tx(ops),grants);
 const apply=(ops,grants=permissions)=>{const plan=prepare(ops,grants);return {plan,state:plan.action?historyReducer(state,plan.action):state};};
 return {state,read,snapshot,targets,handle,split,trim,tx,prepare,apply,track};
};
const pics=(p,track='video')=>p[`${track}Clips`].filter(c=>c.linkId);
const pairTimes=(p,track='video')=>pics(p,track).map(v=>{const a=p.audioClips.find(c=>c.linkId===v.linkId),start=track==='video'?videoLayout(p.videoClips).find(l=>l.clip===v).start:v.start;assert.ok(a);assert.equal(a.start,start);assert.equal((a.out-a.in)/(a.speed||1),(v.out-v.in)/(v.speed||1));assert.equal(a.speed,v.speed);assert.equal(a.in-v.in,a.linkInOff||0);return {v,a,start};});
let f=fixture(),split=f.apply([f.split()]),out=split.state.present;
check('safe reciprocal opaque link metadata validates without leaking raw identifiers',()=>{assert.deepEqual(editorSnapshot(f.snapshot),f.snapshot);const v=f.snapshot.timeline.clips.find(c=>c.id===f.handle('private-v')),a=f.snapshot.timeline.clips.find(c=>c.id===f.handle('private-a'));assert.equal(v.link.partnerId,a.id);assert.equal(a.link.partnerId,v.id);assert.equal(v.link.members_total,2);assert.ok(v.link.groupId.startsWith('l-'));for(const s of ['private-link','private-v','linkInOff','audio-media'])assert.ok(!JSON.stringify(f.snapshot).includes(s));const clone=editorSnapshot(f.snapshot);clone.timeline.clips.find(c=>c.link).link.partnerId=null;assert.notDeepEqual(clone,f.snapshot);});
check('main split creates two complete pairs with distinct host-owned right links',()=>{const pairs=pairTimes(out);assert.equal(pairs.length,2);assert.equal(split.plan.clipsChanged,4);assert.equal(pairs[0].v.id,'private-v');assert.equal(pairs[0].a.id,'private-a');assert.equal(pairs[0].v.out,6);assert.equal(pairs[0].a.out,9);assert.equal(pairs[1].v.in,6);assert.equal(pairs[1].a.in,9);assert.notEqual(pairs[0].v.linkId,pairs[1].v.linkId);assert.equal(projectDuration(out),12);assert.equal(out.markers,f.state.present.markers);assert.equal(out.textClips,f.state.present.textClips);assert.equal(split.state.past.length,1);});
check('linked split has one Undo/Redo with exact IDs and pair metadata',()=>{const undo=historyReducer(split.state,{type:'undo'});assert.deepEqual(undo.present,f.state.present);assert.deepEqual(historyReducer(undo,{type:'redo'}).present,out);const s=f.read(out,null,{time_sec:0,playing:false});assert.equal(s.timeline.clips.filter(c=>c.link).length,4);});
check('main trim crops both speed-scaled source windows and creates explicit gaps',()=>{const r=f.apply([f.trim()]),p=r.state.present,{v,a,start}=pairTimes(p)[0];assert.equal(start,5);assert.equal(v.in,4);assert.equal(v.out,8);assert.equal(a.in,7);assert.equal(a.out,11);assert.deepEqual(p.videoClips.filter(c=>c.gap).map(c=>c.out),[1,1]);assert.equal(r.plan.clipsChanged,4);assert.equal(projectDuration(p),12);assert.equal(videoLayout(p.videoClips).find(l=>l.clip.id==='after').start,8);assert.deepEqual(historyReducer(r.state,{type:'undo'}).present,f.state.present);});
check('either explicit member can initiate the same paired split',()=>{const p=f.apply([f.split(6,'reject','private-a','private-v')]).state.present;assert.equal(pairTimes(p).length,2);assert.equal(p.audioClips[1].start,6);});
check('overlay and audio pairs split and trim together without touching main timing',()=>{const x=fixture({track:'overlay'}),s=x.apply([x.split()]),t=x.apply([x.trim()]);assert.equal(pairTimes(s.state.present,'overlay').length,2);assert.equal(s.plan.clipsChanged,4);assert.equal(t.plan.clipsChanged,2);assert.equal(pairTimes(t.state.present,'overlay')[0].start,5);assert.equal(t.state.present.videoClips,x.state.present.videoClips);});
check('split and trim preserve source-time keys, fades and exterior animations',()=>{const old=f.state.present.audioClips[0],pairs=pairTimes(out);for(const t of [.2,1,1.8]){assert.ok(Math.abs(audioGain(pairs[0].a,t,2)-audioGain(old,t,4))<1e-9);assert.ok(Math.abs(audioGain(pairs[1].a,t,2)-audioGain(old,t+2,4))<1e-9);}assert.ok(pairs[0].v.anim.in&&!pairs[0].v.anim.out);assert.ok(!pairs[1].v.anim.in&&pairs[1].v.anim.out);assert.deepEqual(pairs[1].v.keyframes,f.state.present.videoClips[1].keyframes);const trimmed=pairTimes(f.apply([f.trim()]).state.present)[0];for(const t of [.2,1,1.8])assert.ok(Math.abs(audioGain(trimmed.a,t,2)-audioGain(old,t+1,4))<1e-9);assert.ok(!trimmed.v.anim.in&&!trimmed.v.anim.out);});
check('ordered split then trim updates the retained pair and keeps right partners intact',()=>{const r=f.apply([f.split(),f.trim(4.5,5.5)]);assert.equal(r.plan.clipsChanged,6);const pairs=pairTimes(r.state.present);assert.equal(pairs[0].start,4.5);assert.equal(pairs[1].start,6);assert.equal(r.state.past.length,1);assert.deepEqual(historyReducer(r.state,{type:'undo'}).present,f.state.present);});
check('fractional source windows use exact shared link arithmetic without reducer repairs',()=>{const x=fixture({picture:{in:.1,out:6.1,speed:1.5},sound:{in:.3,out:6.3,speed:1.5,linkInOff:.2}}),r=x.apply([x.split(5.333333333,'reject'),x.trim(4.123456789,5.111111111)]);assert.equal(r.state.past.length,1);const v=pics(r.state.present)[0],a=r.state.present.audioClips.find(c=>c.linkId===v.linkId);assert.equal(a.in,v.in+.2);assert.equal(a.out,v.out+.2);assert.deepEqual(historyReducer(r.state,{type:'undo'}).present,x.state.present);});
check('an earlier explicit pair edit cannot authorize later ordinary linked reordering',()=>{assert.throws(()=>f.prepare([f.split(),{type:'reorder',clipId:f.handle('private-v'),beforeClipId:null,gaps:'preserve',transitions:'reject'}],[...permissions,'timeline.reorder']),/linked|aligned/i);});
check('full-range trim is a no-op without a new receipt or history',()=>{const r=f.apply([f.trim(4,8)]);assert.equal(r.plan.action,null);assert.equal(r.plan.clipsChanged,0);assert.equal(r.state,f.state);});
check('transition rejection and retained-overlap policies also apply to linked main pairs',()=>{const x=fixture({picture:{transition:{type:'fade',duration:1}}});assert.throws(()=>x.prepare([x.split(5)]),/transition/);const s=x.apply([x.split(5.25,'preserve-overlap')]).state.present;assert.equal(pairTimes(s).length,2);assert.equal(projectDuration(s),11);const t=x.apply([x.trim(3.5,6.5,'preserve-overlap')]).state.present;assert.equal(pairTimes(t)[0].start,3.5);assert.equal(videoLayout(t.videoClips).find(l=>l.clip.id==='after').start,7);});
check('existing gaps and final trailing gap survive linked trimming',()=>{const x=fixture({extra:{videoClips:[baseClip('lead-gap',1,{gap:true}),{...f.state.present.videoClips[1]}],audioClips:[{...f.state.present.audioClips[0],start:1}]}}),p=x.apply([x.trim(2,4)]).state.present;assert.equal(p.videoClips[0],x.state.present.videoClips[0]);assert.equal(p.videoClips.at(-1).gap,true);assert.equal(projectDuration(p),5);pairTimes(p);});
check('unrelated free moves may share one batch with explicit linked edits',()=>{const r=f.apply([f.split(),{type:'move',clipId:f.handle('title'),start_sec:9}],[...permissions,'clips.write']);assert.equal(r.plan.clipsChanged,5);assert.equal(r.state.present.textClips[0].start,9);assert.equal(r.state.past.length,1);});
for(const grants of [['editor.read','clips.write'],['editor.read','timeline.edit'],['editor.read','timeline.reorder']])check('older grants cannot escalate into explicit linked operations',()=>assert.throws(()=>f.prepare([f.split()],grants),/clips.linked/));
check('linked permission does not authorize ordinary main or free writes',()=>{assert.throws(()=>f.prepare([{type:'split',clipId:f.handle('private-v'),at_sec:6,gaps:'preserve-time',transitions:'reject'}]),/timeline.edit/);assert.throws(()=>f.prepare([{type:'trim',clipId:f.handle('private-a'),start_sec:5,end_sec:7}]),/clips.write/);});
check('ordinary grants still reject linked clips even when the new grant exists',()=>{assert.throws(()=>f.prepare([{type:'split',clipId:f.handle('private-v'),at_sec:6,gaps:'preserve-time',transitions:'reject'}],[...permissions,'timeline.edit']),/linked/);assert.throws(()=>f.prepare([{type:'trim',clipId:f.handle('private-a'),start_sec:5,end_sec:7}],[...permissions,'clips.write']),/linked/);});
for(const patch of [o=>o.partnerClipId=o.clipId,o=>o.partnerClipId='raw-id',o=>o.partnerClipId=f.handle('title'),o=>o.newId='plugin-id',o=>o.gaps='ripple',o=>o.transitions='clear-boundaries',o=>o.at_sec=NaN,o=>o.at_sec=4.05])check('forged partners, arbitrary IDs, bounds and unsupported policies are refused',()=>{const op=f.split();patch(op);assert.throws(()=>f.prepare([op]));});
check('a later bad operation rejects a complete preceding pair split',()=>assert.throws(()=>f.prepare([f.split(),f.trim(4,9)])));
check('either locked member rejects the whole batch',()=>{for(const key of ['video:0','audio:0']){const x=fixture({extra:{layerState:{[key]:{locked:true}}}});assert.throws(()=>x.prepare([x.split()]),/locked/);}});
check('missing and ambiguous partner groups never project a valid reciprocal pair',()=>{for(const audioClips of [[],[f.state.present.audioClips[0],{...f.state.present.audioClips[0],id:'third',layer:1}]]){const x=fixture({extra:{audioClips}}),v=x.snapshot.timeline.clips.find(c=>c.id===x.handle('private-v'));assert.equal(v.link.partnerId,null);assert.throws(()=>x.prepare([x.split()]));}});
for(const sound of [{start:4.5},{speed:1},{linkOff:.5},{linkInOff:8},{out:12}])check('misaligned ranges, unequal speed and invalid stored offsets reject whole pairs',()=>{const x=fixture({sound});assert.throws(()=>x.prepare([x.split()]));});
check('selected partners are prioritized within the bounded read',()=>{const main=Array.from({length:300},(_,i)=>baseClip('v'+i,1));main[0]={...main[0],id:'private-v',in:2,out:4,speed:2,linkId:'private-link/source'};const x=fixture({extra:{videoClips:main,audioClips:[{...f.state.present.audioClips[0],start:0,in:5,out:7}]},selection:{track:'video',id:'private-v'}});assert.equal(x.snapshot.timeline.clips.length,256);assert.ok(x.handle('private-a'));assert.ok(x.snapshot.timeline.clips.find(c=>c.id===x.handle('private-v')).link.partnerId);});
check('omitted partners are explicitly incomplete rather than silently editable',()=>{const main=Array.from({length:300},(_,i)=>baseClip('v'+i,1));main[0]={...main[0],id:'private-v',in:2,out:4,speed:2,linkId:'private-link/source'};const x=fixture({extra:{videoClips:main,audioClips:[{...f.state.present.audioClips[0],start:0,in:5,out:7}]}});assert.equal(x.handle('private-a'),undefined);assert.equal(x.snapshot.timeline.clips.find(c=>c.id===x.handle('private-v')).link.partnerId,null);assert.throws(()=>x.prepare([x.split(.5)]));});
check('hidden extra group members prevent accidental partial group edits',()=>{const x=fixture({extra:{textClips:Array.from({length:300},(_,i)=>({id:'t'+i,start:i,duration:.5,layer:0,...(i===299?{linkId:'private-link/source'}:{})}))}});assert.equal(x.handle('t299'),undefined);assert.equal(x.snapshot.timeline.clips.find(c=>c.id===x.handle('private-v')).link.members_total,3);assert.throws(()=>x.prepare([x.split()]));});
check('motion-pin dependencies reject linked picture slices',()=>{const x=fixture({picture:{track:{points:[{t:0,x:.5,y:.5}]}},extra:{textClips:[{id:'follower',start:0,duration:1,text:'Pin',pin:{to:'private-v'}}]}});assert.throws(()=>x.prepare([x.split()]),/motion-pin/);});
check('source duration violations reject both partners without partial writes',()=>{const x=fixture({extra:{media:[{id:'audio-media',type:'audio',duration:6}]}});assert.throws(()=>x.prepare([x.split()]),/source bounds/);});
check('a different linked neighbor requiring transition pinning rejects the whole batch',()=>{const before=f.state.present;const x=fixture({extra:{videoClips:[before.videoClips[0],before.videoClips[1],{...before.videoClips[2],linkId:'other-link',transition:{type:'fade',duration:1}}],audioClips:[before.audioClips[0],{id:'other-audio',start:7,in:0,out:4,speed:1,layer:1,linkId:'other-link',linkOff:0,linkInOff:0}]}});assert.throws(()=>x.prepare([x.split(6.75,'preserve-overlap')]),/linked/);});
check('all original and new pair members count toward the 64-clip bound',()=>{const main=Array.from({length:17},(_,i)=>({id:'v'+i,in:2,out:10,speed:2,linkId:'g'+i})),audio=main.map((c,i)=>({id:'a'+i,start:i*4,in:5,out:13,speed:2,layer:0,linkId:c.linkId,linkOff:0,linkInOff:3})),x=fixture({extra:{videoClips:main,audioClips:audio}}),ops=main.map((_,i)=>x.split(i*4+2,'reject','v'+i,'a'+i));assert.equal(x.prepare(ops.slice(0,16)).clipsChanged,64);assert.throws(()=>x.prepare(ops),/64 clips/);});
check('picture source violations and legacy ID collisions also reject the complete pair',()=>{const x=fixture({extra:{media:[{id:'picture-media',type:'video',duration:6}]}});assert.throws(()=>x.prepare([x.split()]),/source bounds/);const y=fixture({extra:{stickerClips:[{id:'plugin-i'}]}}),random=Math.random;try{Math.random=()=>.5;assert.throws(()=>y.prepare([y.split()]),/unique clip ID/);}finally{Math.random=random;}});
check('snapshot partner, group and total tampering fail canonical validation',()=>{for(const mutate of [s=>s.timeline.clips.find(c=>c.link).link.partnerId='c-9999',s=>s.timeline.clips.find(c=>c.link).link.groupId='private/raw',s=>s.timeline.clips.find(c=>c.link).link.members_total=3]){const s=structuredClone(f.snapshot);mutate(s);assert.throws(()=>editorSnapshot(s));}});
check('forged complete public groups cannot hide a real third member from host planning',()=>{const x=fixture({extra:{audioClips:[f.state.present.audioClips[0],{...f.state.present.audioClips[0],id:'third',layer:1}]}}),s=structuredClone(x.snapshot),v=s.timeline.clips.find(c=>c.id===x.handle('private-v')),a=s.timeline.clips.find(c=>c.id===x.handle('private-a'));for(const c of s.timeline.clips)if(c!==v&&c!==a)delete c.link;v.link={...v.link,partnerId:a.id,members_total:2};a.link={...a.link,partnerId:v.id,members_total:2};assert.deepEqual(editorSnapshot(s),s);assert.throws(()=>preparePluginEdits(x.state.present,s,x.targets,x.tx([x.split()]),permissions),/exactly one/);});
check('private group binding or source-offset tampering cannot authorize a pair',()=>{assert.throws(()=>preparePluginEdits(f.state.present,f.snapshot,f.targets.map(t=>t.linkId?{...t,linkId:'foreign'}:t),f.tx([f.split()]),permissions));const changed={...f.state.present,audioClips:f.state.present.audioClips.map(c=>({...c,linkInOff:99}))};assert.throws(()=>preparePluginEdits(changed,f.snapshot,f.targets,f.tx([f.split()]),permissions));});
check('legacy snapshots remain readable but cannot stage linked writes',()=>{const s=structuredClone(f.snapshot);s.timeline.clips.forEach(c=>delete c.link);assert.deepEqual(editorSnapshot(s),s);assert.throws(()=>clipTransaction(f.tx([f.split()]),s,12,permissions));});
check('speculative preparation is pure and applied tokens cannot be replayed',()=>{const plan=f.prepare([f.split()]);assert.equal(pluginEditsApplied(f.state,plan.action),false);assert.equal(prepareProjectAction(f.state.present,plan.action).project.audioClips.length,2);assert.deepEqual(historyReducer(f.state,plan.action),historyReducer(f.state,plan.action));const applied=historyReducer(f.state,plan.action),undo=historyReducer(applied,{type:'undo'});assert.equal(historyReducer(undo,plan.action),undo);assert.equal(historyReducer(f.state,{type:'preparedPluginClips',token:{}}),f.state);});
check('stale documents and foreign owners cannot apply new pairs',()=>{const plan=f.prepare([f.split()]),changed=historyReducer(f.state,{type:'setProject',patch:{name:'User edit'}}),owned=historyReducer(f.state,{type:'beginAgentEdit',token:'owner'});assert.equal(historyReducer(changed,plan.action),changed);assert.equal(historyReducer(owned,plan.action),owned);assert.equal(historyReducer({...f.state,gestureStart:f.state.present},plan.action).present,f.state.present);});
check('CraftAI owns the complete pair edit as one undoable step',()=>{const plan=f.prepare([f.split(),f.trim(4.5,5.5)]),owned=historyReducer(f.state,{type:'beginAgentEdit',token:'owner'}),applied=historyReducer(owned,{...plan.action,agentToken:'owner'});assert.equal(applied.agentEdit.steps.length,1);assert.equal(pairTimes(applied.present).length,2);const done=historyReducer(applied,{type:'endAgentEdit',token:'owner'});assert.deepEqual(historyReducer(done,{type:'undo'}).present,f.state.present);});
check('registered actions enable supported pairs and respect partner locks',()=>{const action={locations:['clip-menu'],permissions,when:{lanes:['video','audio','overlay']}},selection=actionSelection(f.state.present,{items:[{track:'video',id:'private-v'},{track:'audio',id:'private-a'}]});assert.equal(actionState(action,'clip-menu',{hasProject:true,selection}).enabled,true);assert.equal(actionState({...action,permissions:['timeline.edit']},'clip-menu',{hasProject:true,selection}).reason,'unsupported');const x=fixture({extra:{layerState:{'audio:0':{locked:true}}}}),one=actionSelection(x.state.present,{track:'video',id:'private-v'});assert.equal(actionState(action,'clip-menu',{hasProject:true,selection:one}).reason,'locked');});
check('the private array guard retains ordinary main coverage and lock behavior',()=>{const p=historyReducer(f.state,{type:'extendVideoTo',end:14});assert.equal(projectDuration(p.present),14);const locked={...f.state,present:{...f.state.present,layerState:{'video:0':{locked:true}}}};assert.equal(historyReducer(locked,{type:'extendVideoTo',end:14}),locked);});
const manifest={id:'studio.linked',name:'Linked',publisher:'Studio',version:'1.0.0',apiVersion:1,entry:'commands.js',permissions,contributes:{commands:[{id:'run',name:'Run'}]}};
check('manifest supports independent and combined linked edit grants',()=>{assert.ok(validateManifest(manifest));assert.ok(validateManifest({...manifest,permissions:[...permissions,'clips.write','timeline.edit','timeline.reorder']}));});
for(const grants of [['clips.linked'],[...permissions,'markers.write'],[...permissions,'captions.read'],[...permissions,'export.gif']])check('incompatible permissions cannot mix with linked writes',()=>assert.throws(()=>validateManifest({...manifest,permissions:grants})));
const near=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-8,`${actual} != ${expected}`);
for(const track of ['video','overlay'])for(const offset of [-1.25,-1/3,1/3,1.25])for(const speed of [1,1.5,2.25]){
 check(`${track} shifted split/trim preserves relative sources and offset ${offset} at speed ${speed}`,()=>{
  const x=fixture({track,picture:{in:2,out:2+4*speed,speed},sound:{start:4+offset,in:5,out:5+4*speed,speed,linkOff:offset}});
  const split=x.apply([x.split()]),r=x.apply([x.split(),x.trim(4.5,5.5)]),p=r.state.present;
  const pictures=pics(p,track),layout=new Map(videoLayout(p.videoClips).map(l=>[l.clip.id,l]));
  assert.equal(pictures.length,2);assert.equal(p.audioClips.length,2);
  for(let i=0;i<2;i++){
   const v=pictures[i],a=p.audioClips.find(c=>c.linkId===v.linkId),start=i?6:4.5;
   near(track==='video'?layout.get(v.id).start:v.start,start);near(a.start,start+offset);
   near(v.in,2+(i?2:.5)*speed);near(v.out,2+(i?4:1.5)*speed);
   near(a.in,5+(i?2:.5)*speed);near(a.out,5+(i?4:1.5)*speed);
   assert.equal(a.linkOff,offset);assert.equal(a.linkInOff,3);assert.equal(a.speed,speed);
   assert.deepEqual(a.volumeKeys,x.state.present.audioClips[0].volumeKeys);
   for(const t of [.1,.4,.8])near(audioGain(a,t,i?2:1),audioGain(x.state.present.audioClips[0],t+(i?2:.5),4));
  }
  assert.equal(split.state.present.audioClips[0].in,5);
  assert.equal(split.state.present.audioClips[1].out,5+4*speed);
  assert.notEqual(pictures[0].linkId,pictures[1].linkId);
  assert.equal(p.markers,x.state.present.markers);assert.equal(p.textClips,x.state.present.textClips);
  near(projectDuration(p),12);assert.equal(r.state.past.length,1);
  const undone=historyReducer(r.state,{type:'undo'});assert.deepEqual(undone.present,x.state.present);
  assert.deepEqual(historyReducer(undone,{type:'redo'}).present,p);
 });
}
for(const offset of [-.75,.75]){
 check('audio-initiated shifted operations use picture times '+offset,()=>{
  const x=fixture({sound:{start:4+offset,linkOff:offset}}),trim=x.trim(5,7);
  [trim.clipId,trim.partnerClipId]=[trim.partnerClipId,trim.clipId];
  const p=x.apply([trim]).state.present;near(p.audioClips[0].start,5+offset);near(p.audioClips[0].in,7);
  const s=x.apply([x.split(6,'reject','private-a','private-v')]).state.present;near(s.audioClips[1].start,6+offset);
 });
 check('full shifted trim is a no-op '+offset,()=>{const x=fixture({sound:{start:4+offset,linkOff:offset}});assert.equal(x.prepare([x.trim(4,8)]).action,null);});
 check('shifted registered actions respect complete pairs and partner locks '+offset,()=>{
  const x=fixture({sound:{start:4+offset,linkOff:offset}}),action={locations:['clip-menu'],permissions};
  assert.equal(actionState(action,'clip-menu',{hasProject:true,selection:actionSelection(x.state.present,{track:'audio',id:'private-a'})}).enabled,true);
  const locked=fixture({sound:{start:4+offset,linkOff:offset},extra:{layerState:{'audio:0':{locked:true}}}});
  assert.equal(actionState(action,'clip-menu',{hasProject:true,selection:actionSelection(locked.state.present,{track:'video',id:'private-v'})}).reason,'locked');
  assert.throws(()=>locked.prepare([locked.split()]),/locked/);
 });
 check('shifted pairs still reject extension and tiny source pieces '+offset,()=>{
  const x=fixture({sound:{start:4+offset,linkOff:offset}});
  for(const op of [x.trim(3.9,7),x.trim(5,8.1),x.split(4.05),x.split(7.95)])assert.throws(()=>x.prepare([op]));
 });
}
check('shifted main transition edits preserve unrelated main times',()=>{
 const x=fixture({picture:{transition:{type:'fade',duration:1}},sound:{start:3.5,linkOff:.5}});
 assert.throws(()=>x.prepare([x.split(5.25)]),/transition/);
 const p=x.apply([x.split(5.25,'preserve-overlap'),x.trim(3.5,4.5,'preserve-overlap')]).state.present;
 near(videoLayout(p.videoClips).find(l=>l.clip.id==='after').start,7);near(p.audioClips[0].start,4);
});
check('shifted source violations reject the whole batch',()=>{
 const x=fixture({sound:{start:4.5,linkOff:.5},extra:{media:[{id:'audio-media',type:'audio',duration:12}]}});
 assert.throws(()=>x.prepare([x.split()]),/source bounds/);
});
console.log(JSON.stringify({ok:true,checks}));
