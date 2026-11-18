import assert from 'node:assert/strict';
import {emptyProject,historyReducer,preparePluginEdits,pluginEditsApplied,prepareProjectAction,videoLayout,projectDuration} from '../../../src/state/store.js';
import {createEditorContext} from '../../../src/features/plugins/editorContext.js';
// Historical schema assertions are read-only; native edit planning remains in use.
import {validateLegacyManifest as validateManifest} from '../../../shared/legacyPluginManifest.mjs';
let checks=0,generated=0,accepted=0,rejected=0;
const check=(name,fn)=>{fn();checks++;console.log('PASS',name);};
const grants=['editor.read','timeline.reorder','clips.links'];
const clip=(id,length=2,extra={})=>({id,in:1,out:1+length,speed:1,...extra});
function fixture({main,offsets={a:.25,b:-.25,c:.125},extra={},audioPatch={},selected}={}){
 main??=[clip('a',2),clip('g1',1,{gap:true}),clip('b',3),clip('u',2),clip('c',1),clip('g2',2,{gap:true})];
 main=main.map(c=>Object.hasOwn(offsets,c.id)?{...c,linkId:'private-'+c.id}:c);
 const audio=videoLayout(main).filter(l=>l.clip.linkId).map((l,i)=>({id:l.clip.id+'-sound',mediaId:'audio',start:l.start+offsets[l.clip.id],in:3,out:3+l.clip.out-l.clip.in,speed:l.clip.speed||1,layer:i,linkId:l.clip.linkId,linkOff:offsets[l.clip.id],linkInOff:3-l.clip.in,fadeIn:.2,volumeKeys:[{t:3,v:.5}],...audioPatch[l.clip.id]}));
 const project={...emptyProject(),media:[{id:'audio',type:'audio',duration:100}],videoClips:main,audioClips:audio,textClips:[{id:'text',start:0,duration:.1,layer:0,text:'Private'}],markers:[{id:'m',time:1}],...extra};
 const state=historyReducer({past:[],present:emptyProject(),future:[]},{type:'load',project}),read=createEditorContext(),snapshot=read(state.present,selected,{time_sec:0,playing:false}),targets=read.targets(snapshot),handle=id=>targets.find(t=>t.id===id)?.handle;
 const pair=id=>({clipId:handle(id),partnerClipId:handle(id+'-sound')});
 const op=(id='c',before='a',companions=Object.keys(offsets).filter(k=>k!==id),transitions='reject')=>({type:'reorder-linked',...pair(id),beforeClipId:before===null?null:handle(before),companions:companions.map(pair),gaps:'preserve',transitions});
 const tx=operations=>({documentId:snapshot.documentId,revision:snapshot.revision,operations});
 const prepare=(ops,permissions=grants)=>preparePluginEdits(state.present,snapshot,targets,tx(ops),permissions);
 const apply=ops=>{const plan=prepare(ops);return {plan,state:plan.action?historyReducer(state,plan.action):state};};
 return {state,read,snapshot,targets,handle,pair,op,tx,prepare,apply};
}
const order=p=>p.videoClips.map(c=>c.id),near=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);
const f=fixture();
check('source and explicitly allowed neighbours reorder with exact audio windows',()=>{
 const {plan,state}=f.apply([f.op()]);assert.deepEqual(order(state.present),['c','a','g1','b','u','g2']);
 const starts={c:0,a:1,b:4};for(const [id,start] of Object.entries(starts)){
  const before=f.state.present.audioClips.find(c=>c.id===id+'-sound'),after=state.present.audioClips.find(c=>c.id===before.id);
  assert.deepEqual(after,{...before,start:start+before.linkOff});assert.equal(state.present.videoClips.find(c=>c.id===id),f.state.present.videoClips.find(c=>c.id===id));
 }
 assert.equal(plan.clipsChanged,8);assert.equal(projectDuration(state.present),11);assert.equal(state.past.length,1);
 assert.equal(state.present.textClips,f.state.present.textClips);assert.equal(state.present.markers,f.state.present.markers);
 const undo=historyReducer(state,{type:'undo'});assert.deepEqual(undo.present,f.state.present);assert.deepEqual(historyReducer(undo,{type:'redo'}).present,state.present);
});
check('audio handle can initiate; anchors always address main pictures or gaps',()=>{
 const op=f.op();[op.clipId,op.partnerClipId]=[op.partnerClipId,op.clipId];assert.deepEqual(order(f.apply([op]).state.present),['c','a','g1','b','u','g2']);
 assert.deepEqual(order(f.apply([f.op('a','g2')]).state.present),['g1','b','u','c','a','g2']);
});
check('linked pairs may reorder together on their existing shared audio layer',()=>{
 const x=fixture({offsets:{a:0,b:0,c:0},audioPatch:{a:{layer:0},b:{layer:0},c:{layer:0}}}),p=x.apply([x.op()]).state.present;
 assert.deepEqual(p.audioClips.map(c=>c.layer),[0,0,0]);assert.deepEqual(p.audioClips.map(c=>c.start),[1,4,0]);
});
check('stored offsets cannot force colliding partners onto another layer',()=>{
 const x=fixture({offsets:{a:0,b:0,c:.125},audioPatch:{a:{layer:0},b:{layer:0},c:{layer:0}}});assert.throws(()=>x.prepare([x.op()]),/overlap/);
});
check('linked reorder and unrelated free writes form one atomic Undo step',()=>{
 const plan=f.prepare([f.op(),{type:'move',clipId:f.handle('text'),start_sec:10}],[...grants,'clips.write']),state=historyReducer(f.state,plan.action);
 assert.equal(plan.clipsChanged,9);assert.equal(state.present.textClips[0].start,10);assert.equal(state.past.length,1);assert.deepEqual(historyReducer(state,{type:'undo'}).present,f.state.present);
});
check('unnamed affected linked neighbours fail atomically',()=>{
 for(const list of [[],['a'],['b']])assert.throws(()=>f.prepare([f.op('c','a',list)]),/companion/);
 assert.equal(f.state.past.length,0);assert.deepEqual(order(f.state.present),['a','g1','b','u','c','g2']);
});
check('adjacent and round-trip moves are no-ops; unrelated pairs need no grant',()=>{
 assert.equal(f.prepare([f.op('c','g2',[])]).action,null);
 assert.equal(f.prepare([f.op(),f.op('c','g2')]).action,null);
});
check('ordinary reordering never inherits earlier pair authorization',()=>{
 const legacy={type:'reorder',clipId:f.handle('u'),beforeClipId:f.handle('a'),gaps:'preserve',transitions:'reject'};
 assert.throws(()=>f.prepare([f.op(),legacy]),/reorder-linked/);
 assert.throws(()=>f.prepare([{...legacy,clipId:f.handle('c')}]),/reorder-linked/);
 assert.throws(()=>f.prepare([f.op(),f.op('c','g2',[])]),/companion/);
});
check('legacy atomic swaps around an unchanged linked neighbour remain supported',()=>{
 const x=fixture({main:[clip('left',1),clip('a',1),clip('right',1)],offsets:{a:0}}),op=(id,before)=>({type:'reorder',clipId:x.handle(id),beforeClipId:before===null?null:x.handle(before),gaps:'preserve',transitions:'reject'}),r=x.apply([op('left',null),op('right','a')]);
 assert.deepEqual(order(r.state.present),['right','a','left']);assert.equal(r.state.present.audioClips,x.state.present.audioClips);assert.equal(r.plan.clipsChanged,2);
});
for(const speed of [.75,1.5])for(const offset of [-.3,.3])check('fractional source windows and speed remain exact '+speed+'/'+offset,()=>{
 const main=[clip('lead',2),clip('c',4,{in:.1,out:4.1,speed,effects:['vignette'],keyframes:{opacity:[{t:.1,v:.5}]}}),clip('u',2),clip('tail',2,{gap:true})],x=fixture({main,offsets:{c:offset},audioPatch:{c:{in:.3,out:4.3,linkInOff:.2}}}),p=x.apply([x.op('c','tail',[])]).state.present;
 assert.equal(p.videoClips.find(c=>c.id==='c'),x.state.present.videoClips.find(c=>c.id==='c'));const a=p.audioClips[0];assert.equal(a.in,.3);assert.equal(a.out,4.3);assert.equal(a.speed,speed);assert.equal(a.linkOff,offset);assert.equal(a.linkInOff,.2);near(a.start,4+offset);
});
for(let mask=0;mask<32;mask++)check('combined permission boundary '+mask,()=>{
 const names=['clips.write','timeline.reorder','timeline.edit','clips.linked','clips.links'],permissions=['editor.read',...names.filter((_,i)=>mask&(1<<i))];
 if(permissions.includes('timeline.reorder')&&permissions.includes('clips.links'))assert.ok(f.prepare([f.op()],permissions).action);
 else assert.throws(()=>f.prepare([f.op()],permissions),/requires timeline.reorder and clips.links/);
});
for(const mutate of [o=>delete o.companions,o=>o.companions=[...o.companions,o.companions[0]],o=>o.companions=[f.pair('c')],o=>o.companions=Array(32).fill(f.pair('a')),o=>o.beforeClipId=o.clipId,o=>o.beforeClipId=f.handle('c-sound'),o=>o.partnerClipId='raw',o=>o.companions[0].rawId='x',o=>o.gaps='ripple',o=>o.transitions='preserve-overlap',o=>o.linkId='raw'])check('forged fields, handles and policies reject',()=>{const op=f.op();mutate(op);assert.throws(()=>f.prepare([op]));});
for(const track of ['video:0','audio:0','audio:1','audio:2'])check('source and companion locks reject '+track,()=>{
 const x=fixture({extra:{layerState:{[track]:{locked:true}}}});assert.throws(()=>x.prepare([x.op()]),/locked/);
});
check('inconsistent offsets, speed, source bounds and incomplete groups reject',()=>{
 for(const patch of [{linkOff:9},{linkInOff:9},{speed:2},{in:-1},{out:101}]){const x=fixture({audioPatch:{c:patch}});assert.throws(()=>x.prepare([x.op()]));}
 const x=fixture({extra:{textClips:[{id:'hidden',start:0,duration:1,layer:0,linkId:'private-c'}]}});assert.throws(()=>x.prepare([x.op()]));
});
check('omitted main neighbours cannot be silently authorized by the bounded snapshot',()=>{
 const main=Array.from({length:300},(_,i)=>clip('v'+i,1)),offsets={v260:0,v299:0};const x=fixture({main,offsets,selected:{track:'video',id:'v299'}});
 assert.equal(x.handle('v260'),undefined);assert.ok(x.handle('v299-sound'));assert.throws(()=>x.prepare([x.op('v299','v0',[])]),/companion/);
});
check('audio placement cannot collide or extend beyond the declared clock',()=>{
 const x=fixture({extra:{audioClips:[...f.state.present.audioClips,{id:'busy',start:.2,in:0,out:.5,layer:2}]}});assert.throws(()=>x.prepare([x.op()]),/overlap/);
 assert.throws(()=>f.prepare([f.op('c',null)]),/project/);
 const y=fixture({offsets:{a:-.25,b:0,c:0},main:[clip('lead',1),clip('a'),clip('b'),clip('c'),clip('tail',2,{gap:true})]});assert.throws(()=>y.prepare([y.op('a','lead')]),/aligned|offset|invalid/);
});
check('motion pins on source pictures and unrelated retimed neighbours reject',()=>{
 for(const target of ['c','u']){const main=f.state.present.videoClips.map(c=>c.id===target?{...c,track:{points:[{t:1,x:.5,y:.5}]}}:c),x=fixture({main,extra:{textClips:[{id:'pin',start:0,duration:1,layer:0,pin:{to:target}}]}});assert.throws(()=>x.prepare([x.op()]),/motion-pin/);}
});
check('transition policies retain exact boundaries and allow explicit clock growth only',()=>{
 const main=[clip('a',2),clip('b',3),clip('c',1,{transition:{type:'fade',duration:.5}}),clip('d',1)],x=fixture({main,offsets:{a:.25,c:.125,d:0}});
 assert.throws(()=>x.prepare([x.op('c','a',['a','d'])]),/transition/);
 const p=x.apply([x.op('c','a',['a','d'],'clear-boundaries')]).state.present;
 assert.equal(p.videoClips[0].transition,null);near(projectDuration(p),7);near(p.audioClips.find(c=>c.id==='d-sound').start,6);
 const free={type:'move',clipId:x.handle('text'),start_sec:6.8};assert.throws(()=>x.prepare([x.op('c','a',['a','d'],'clear-boundaries'),free],[...grants,'clips.write']),/project/);
});
check('unaffected linked pairs and predecessor boundaries stay untouched',()=>{
 const transition={type:'fade',duration:.25},main=[clip('a'),clip('b',2,{transition}),clip('u'),clip('c'),clip('tail',2,{gap:true})],x=fixture({main,offsets:{a:.25,c:.125}}),p=x.apply([x.op('c','u',[])]).state.present;
 assert.equal(p.videoClips.find(c=>c.id==='b').transition,transition);assert.equal(p.audioClips[0],x.state.present.audioClips[0]);near(projectDuration(p),projectDuration(x.state.present));
});
check('new split pieces cannot become unnamed collateral of a later reorder',()=>{
 const split={type:'split-linked',...f.pair('c'),at_sec:8.5,gaps:'preserve-time',transitions:'reject'};
 assert.throws(()=>f.prepare([split,f.op('c',null)], [...grants,'clips.linked']),/companion/);
});
check('every affected picture/audio member counts toward the shared limit',()=>{
 const main=Array.from({length:32},(_,i)=>clip('v'+i,1)),offsets=Object.fromEntries(main.map(c=>[c.id,0])),x=fixture({main,offsets});assert.equal(x.prepare([x.op('v31','v0')]).clipsChanged,64);
 main.splice(31,0,clip('extra',.5));const y=fixture({main,offsets});assert.throws(()=>y.prepare([y.op('v31','v0')]),/64 clips/);
 const noop=x.op('v31',null);assert.throws(()=>x.prepare([noop,noop,noop]),/64 operations and companion/);
});
check('private plans are pure, single-use and bound to the exact owner/base',()=>{
 const plan=f.prepare([f.op()]);assert.equal(pluginEditsApplied(f.state,plan.action),false);const p=prepareProjectAction(f.state.present,plan.action).project;assert.deepEqual(order(p),['c','a','g1','b','u','g2']);
 const out=historyReducer(f.state,plan.action),undo=historyReducer(out,{type:'undo'});assert.equal(historyReducer(undo,plan.action),undo);assert.deepEqual(historyReducer(f.state,plan.action),out);
 const changed=historyReducer(f.state,{type:'setProject',patch:{name:'Manual'}});assert.equal(historyReducer(changed,plan.action),changed);
 const owned=historyReducer(f.state,{type:'beginAgentEdit',token:'owner'});assert.equal(historyReducer(owned,plan.action),owned);const applied=historyReducer(owned,{...plan.action,agentToken:'owner'});assert.equal(applied.agentEdit.steps.length,1);
 const gesture={...f.state,gestureStart:f.state.present};assert.equal(historyReducer(gesture,plan.action),gesture);
});
function oracle(project,specs){
 const list=[...project.videoClips],audio=project.audioClips.map(c=>({...c})),duration=list.reduce((n,c)=>n+(c.out-c.in)/(c.speed||1),0);
 for(const [id,before] of specs){
  const at=list.findIndex(c=>c.id===id),[item]=list.splice(at,1);list.splice(before===null?list.length:list.findIndex(c=>c.id===before),0,item);
  let start=0;for(const c of list){const a=audio.find(a=>a.linkId===c.linkId&&c.linkId);if(a){a.start=start+a.linkOff;if(a.start<0)return null;}start+=(c.out-c.in)/(c.speed||1);}
 }
 if(audio.some(c=>c.start+(c.out-c.in)/(c.speed||1)>duration+1e-8))return null;
 return {...project,videoClips:list,audioClips:audio};
}
check('generated two-step permutations match an independent sequence/source oracle',()=>{
 const choices=[];for(const id of ['a','b','c'])for(const before of [null,...order(f.state.present)])if(id!==before)choices.push([id,before]);
 for(const a of choices)for(const b of choices){
  const expected=oracle(f.state.present,[a,b]),input=[f.op(...a),f.op(...b)],before=JSON.stringify(f.state.present);generated++;
  if(!expected){assert.throws(()=>f.prepare(input));rejected++;continue;}
  const r=f.apply(input);accepted++;assert.deepEqual(r.state.present,expected,JSON.stringify([a,b]));
  const positions=list=>{let start=0;return new Map(list.map((c,index)=>{const entry=[c.id,{index,start}];start+=(c.out-c.in)/(c.speed||1);return entry;}));},original=positions(f.state.present.videoClips),next=positions(expected.videoClips);
  const mainChanged=expected.videoClips.filter(c=>original.get(c.id).index!==next.get(c.id).index||original.get(c.id).start!==next.get(c.id).start).length,audioChanged=expected.audioClips.filter((c,i)=>c.start!==f.state.present.audioClips[i].start).length;
  assert.equal(r.plan.clipsChanged,mainChanged+audioChanged);assert.equal(JSON.stringify(f.state.present),before);
  if(r.plan.action){assert.deepEqual(historyReducer(r.state,{type:'undo'}).present,f.state.present);assert.equal(r.state.past.length,1);}else assert.equal(r.state,f.state);
 }
});
const manifest={id:'studio.linked-reorder',name:'Reorder',publisher:'Studio',version:'1.0.0',apiVersion:1,entry:'commands.js',permissions:grants,contributes:{commands:[{id:'run',name:'Run'}]}};
check('combined grants use existing manifest rules without new permissions',()=>{assert.ok(validateManifest(manifest));assert.throws(()=>validateManifest({...manifest,permissions:grants.filter(p=>p!=='editor.read')}));assert.throws(()=>validateManifest({...manifest,permissions:[...grants,'markers.write']}));});
console.log(JSON.stringify({ok:true,checks,generated,accepted,rejected}));
