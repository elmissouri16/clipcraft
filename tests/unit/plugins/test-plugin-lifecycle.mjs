import assert from 'node:assert/strict';
import {emptyProject,historyReducer,preparePluginEdits,pluginEditsApplied,videoLayout,layerCount,prepareProjectAction} from '../../../src/state/store.js';
import {createEditorContext} from '../../../src/features/plugins/editorContext.js';
// Historical schema assertions are read-only; native edit planning remains in use.
import {validateLegacyManifest as validateManifest} from '../../../shared/legacyPluginManifest.mjs';
import {actionState} from '../../../shared/pluginActions.mjs';
let checks=0,generated=0;const check=(name,fn)=>{fn();checks++;console.log('PASS',name);},near=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`),policies={gaps:'preserve-time',transitions:'reject'},grants=['editor.read','clips.manage','tracks.write','clips.links'];
function fixture(extra={}){
 const p={...emptyProject(),media:[{id:'v',type:'video',duration:20,hasAudio:true},{id:'a',type:'audio',duration:20},{id:'i',type:'image'}],videoClips:[{id:'lead',mediaId:'v',in:0,out:2},{id:'gap',gap:true,in:0,out:8},{id:'tail',mediaId:'v',in:8,out:10}],overlayClips:[{id:'o',mediaId:'v',start:0,in:1,out:3,layer:0,transform:{scale:.8,x:.1,y:0},speed:1.5,muted:true},{id:'q',mediaId:'v',start:4,in:2,out:4,layer:1,linkId:'lq'}],audioClips:[{id:'f',mediaId:'a',start:0,in:1,out:3,layer:0,fadeIn:.5,volume:.3},{id:'qa',mediaId:'a',start:4.25,in:3,out:5,layer:1,linkId:'lq',linkOff:.25,linkInOff:1}],textClips:[{id:'t',start:1,duration:1,text:'Existing',layer:0}],effectClips:[{id:'e',start:0,duration:1,fx:'vignette'}],layers:{overlay:2,audio:3,text:2},markers:[{id:'marker',time:11}],layerState:{'overlay:1':{hidden:true},'audio:2':{muted:true}},...extra};
 const state=historyReducer({past:[],present:emptyProject(),future:[]},{type:'load',project:p}),read=createEditorContext(),snapshot=read(state.present,null,{time_sec:0,playing:false}),targets=read.targets(snapshot),h=id=>targets.find(t=>t.id===id)?.handle;
 const tx=operations=>({documentId:snapshot.documentId,revision:snapshot.revision,operations}),prepare=(operations,permissions=grants)=>preparePluginEdits(state.present,snapshot,targets,tx(operations),permissions),apply=operations=>{const plan=prepare(operations);return {plan,state:plan.action?historyReducer(state,plan.action):state};};
 return {state,snapshot,targets,h,tx,prepare,apply};
}
const f=fixture(),duplicate=(f,id,trackId,start_sec)=>({type:'duplicate-clip',clipId:f.h(id),trackId,start_sec,...policies}),erase=(f,id)=>({type:'delete-clip',clipId:f.h(id),...policies}),place=(f,id,trackId,start_sec)=>({...duplicate(f,id,trackId,start_sec),type:'place-clip'}),pair=(f,type,start_sec=7,pictureTrackId='overlay:1',audioTrackId='audio:2')=>({type,clipId:f.h('q'),partnerClipId:f.h('qa'),...(type==='delete-linked'?{}:{pictureTrackId,audioTrackId,start_sec}),...policies});
function exactUndo(f,r){assert.ok(pluginEditsApplied(r.state,r.plan.action));const undo=historyReducer(r.state,{type:'undo'});assert.deepEqual(undo.present,f.state.present);assert.deepEqual(historyReducer(undo,{type:'redo'}).present,r.state.present);}
check('media creation uses source windows at speed with host defaults and no links',()=>{
 const r=f.apply([{type:'create-media',sourceClipId:f.h('o'),trackId:'overlay:1',start_sec:7,offset_sec:.25,duration_sec:.75,...policies}]),c=r.state.present.overlayClips.find(c=>!['o','q'].includes(c.id));
 near(c.in,1.375);near(c.out,2.5);assert.equal(c.speed,1.5);assert.equal(c.volume,1);assert.deepEqual(c.transform,{scale:.5,x:0,y:0});assert.ok(!c.linkId&&!c.pin);assert.equal(r.plan.clipsChanged,1);exactUndo(f,r);
});
check('creation, duplication, deletion, track append and placement share one Undo',()=>{
 const r=f.apply([{type:'create-track',trackId:'overlay:2'},{type:'create-media',sourceClipId:f.h('lead'),trackId:'video:0',start_sec:6,offset_sec:.5,duration_sec:1,...policies},{type:'create-text',trackId:'text:1',start_sec:3,duration_sec:1,text:'Created\ntext'},{type:'create-effect',sourceClipId:f.h('e'),trackId:'effect:0',start_sec:3,duration_sec:1},duplicate(f,'f','audio:0',3),erase(f,'t'),place(f,'o','overlay:2',0)]),p=r.state.present;
 assert.equal(r.plan.tracksChanged,1);assert.equal(layerCount(p,'overlay'),3);assert.equal(p.overlayClips.find(c=>c.id==='o').layer,2);assert.equal(p.textClips.length,1);assert.equal(p.textClips[0].text,'Created\ntext');assert.equal(p.effectClips[1].fx,'vignette');assert.equal(p.audioClips.find(c=>!['qa','f'].includes(c.id)).volume,.3);assert.equal(p.markers,f.state.present.markers);assert.equal(p.media,f.state.present.media);assert.equal(videoLayout(p.videoClips).at(-1).end,12);assert.equal(videoLayout(p.videoClips).find(l=>l.clip.id==='tail').start,10);assert.equal(r.state.past.length,1);exactUndo(f,r);
});
check('empty track creation commits a track receipt and survives Undo/Redo',()=>{
 const r=f.apply([{type:'create-track',trackId:'text:2'}]);assert.equal(r.plan.clipsChanged,0);assert.equal(r.plan.tracksChanged,1);assert.equal(layerCount(r.state.present,'text'),3);assert.equal(r.state.past.length,1);exactUndo(f,r);
});
check('placement keeps existing source metadata and track toggles fixed on Undo',()=>{
 const r=f.apply([place(f,'o','overlay:1',0)]);assert.deepEqual(r.state.present.layerState,f.state.present.layerState);assert.equal(r.state.present.overlayClips.find(c=>c.id==='o').transform.scale,.8);exactUndo(f,r);
 const toggled=historyReducer(r.state,{type:'setLayerState',track:'overlay',layer:1,patch:{solo:true}}),undo=historyReducer(toggled,{type:'undo'});assert.equal(undo.present.layerState['overlay:1'].solo,true);assert.equal(undo.present.layerState['overlay:0'],undefined);
});
check('Undo removes toggles on new layers while preserving existing track state',()=>{
 const r=f.apply([{type:'create-track',trackId:'text:2'}]),toggled=historyReducer(r.state,{type:'setLayerState',track:'text',layer:2,patch:{locked:true,hidden:true}}),undo=historyReducer(toggled,{type:'undo'});assert.equal(undo.present.layerState['text:2'],undefined);assert.deepEqual(undo.present.layerState,f.state.present.layerState);const redo=historyReducer(undo,{type:'redo'});assert.equal(redo.present.layerState['text:2'],undefined);assert.equal(layerCount(redo.present,'text'),3);
});
check('ordinary structural track reorder still carries states through Undo',()=>{
 const r=historyReducer(f.state,{type:'moveLayer',track:'overlay',from:1,to:0});assert.equal(r.present.layerState['overlay:0'].hidden,true);const u=historyReducer(r,{type:'undo'});assert.deepEqual(u.present.layerState,f.state.present.layerState);
});
check('free deletion never ripples despite magnets and retains empty layers',()=>{
 const r=f.apply([erase(f,'f')]);assert.equal(r.state.present.audioClips.length,1);assert.equal(r.state.present.audioClips[0].start,4.25);assert.equal(layerCount(r.state.present,'audio'),3);exactUndo(f,r);
});
check('main deletion replaces the shot with an independent explicit gap',()=>{
 const r=f.apply([erase(f,'lead')]),p=r.state.present;assert.ok(p.videoClips[0].gap);assert.notEqual(p.videoClips[0].id,'lead');assert.equal(p.videoClips.length,3);assert.equal(videoLayout(p.videoClips).at(-1).end,12);assert.equal(r.plan.clipsChanged,2);exactUndo(f,r);
});
check('main duplicate and movement consume gaps without moving other pictures',()=>{
 for(const op of [duplicate(f,'lead','video:0',4),place(f,'lead','video:0',4)]){const r=f.apply([op]),l=videoLayout(r.state.present.videoClips);assert.equal(l.find(l=>l.clip.id==='tail').start,10);assert.equal(l.at(-1).end,12);assert.ok(l.some(l=>!l.clip.gap&&l.start===4));exactUndo(f,r);}
});
check('shifted paired duplication preserves topology, offsets, sources and fades',()=>{
 const r=f.apply([pair(f,'duplicate-linked')]),p=r.state.present,original=p.overlayClips.find(c=>c.id==='q'),pic=p.overlayClips.find(c=>!['q','o'].includes(c.id)),audio=p.audioClips.find(c=>!['qa','f'].includes(c.id));assert.notEqual(pic.linkId,original.linkId);assert.equal(pic.linkId,audio.linkId);assert.equal(pic.start,7);assert.equal(audio.start,7.25);assert.equal(audio.in,3);assert.equal(audio.out,5);assert.equal(audio.linkInOff,1);assert.equal(r.plan.clipsChanged,2);exactUndo(f,r);
});
check('pair placement and deletion require the exact original complete pair',()=>{
 for(const op of [pair(f,'place-linked'),pair(f,'delete-linked')]){const r=f.apply([op]);assert.equal(r.plan.clipsChanged,2);exactUndo(f,r);}
});
check('same-position placement produces no history or affected count',()=>{const r=f.apply([place(f,'o','overlay:0',0),pair(f,'place-linked',4,'overlay:1','audio:1')]);assert.equal(r.plan.action,null);assert.equal(r.plan.clipsChanged,0);assert.equal(r.state,f.state);});
check('source creation from a linked resource creates no implicit partner',()=>{const p=f.apply([{type:'create-media',sourceClipId:f.h('q'),trackId:'overlay:0',start_sec:7,offset_sec:0,duration_sec:1,...policies}]).state.present;assert.equal(p.audioClips.length,2);assert.ok(!p.overlayClips.find(c=>!['q','o'].includes(c.id)).linkId);});
const invalid=[
 ['missing grant',()=>f.prepare([duplicate(f,'f','audio:0',7)],['editor.read','clips.write'])],
 ['placement grant',()=>f.prepare([place(f,'o','overlay:1',0)],['editor.read','clips.manage'])],
 ['pair grant',()=>f.prepare([pair(f,'duplicate-linked')],['editor.read','clips.manage'])],
 ['track grant',()=>f.prepare([{type:'create-track',trackId:'text:2'}],['editor.read','clips.manage'])],
 ['raw path',()=>f.prepare([{...duplicate(f,'f','audio:0',7),path:'/secret'}])],
 ['chosen ID',()=>f.prepare([{...duplicate(f,'f','audio:0',7),id:'chosen'}])],
 ['raw media ID',()=>f.prepare([{type:'create-media',sourceClipId:'v',trackId:'video:0',start_sec:6,offset_sec:0,duration_sec:1,...policies}])],
 ['mixed family',()=>f.prepare([duplicate(f,'f','audio:0',7),{type:'move',clipId:f.h('f'),start_sec:7}])],
 ['missing policy',()=>{const op=erase(f,'t');delete op.transitions;return f.prepare([op]);}],
 ['implicit pair delete',()=>f.prepare([erase(f,'q')])],
 ['implicit pair copy',()=>f.prepare([duplicate(f,'q','overlay:0',7)])],
 ['wrong partner',()=>f.prepare([{...pair(f,'delete-linked'),partnerClipId:f.h('f')}])],
 ['cross lane',()=>f.prepare([place(f,'o','audio:0',7)])],
 ['unknown track',()=>f.prepare([duplicate(f,'f','audio:3',7)])],
 ['uncreated destination',()=>f.prepare([place(f,'o','overlay:2',7),{type:'create-track',trackId:'overlay:2'}])],
 ['nonappend track',()=>f.prepare([{type:'create-track',trackId:'text:3'}])],
 ['fixed lane',()=>f.prepare([{type:'create-track',trackId:'effect:1'}])],
 ['duplicate append',()=>f.prepare([{type:'create-track',trackId:'text:2'},{type:'create-track',trackId:'text:2'}])],
 ['bad source range',()=>f.prepare([{type:'create-media',sourceClipId:f.h('o'),trackId:'overlay:0',start_sec:7,offset_sec:1,duration_sec:1,...policies}])],
 ['text source as media',()=>f.prepare([{type:'create-media',sourceClipId:f.h('t'),trackId:'overlay:0',start_sec:7,offset_sec:0,duration_sec:1,...policies}])],
 ['blank text',()=>f.prepare([{type:'create-text',trackId:'text:0',start_sec:4,duration_sec:1,text:' '}])],
 ['long text',()=>f.prepare([{type:'create-text',trackId:'text:0',start_sec:4,duration_sec:1,text:'x'.repeat(2001)}])],
 ['text controls',()=>f.prepare([{type:'create-text',trackId:'text:0',start_sec:4,duration_sec:1,text:'x\u0000'}])],
 ['short clip',()=>f.prepare([{type:'create-text',trackId:'text:0',start_sec:4,duration_sec:.01,text:'x'}])],
 ['past bounds',()=>f.prepare([duplicate(f,'f','audio:0',11)])],
 ['negative',()=>f.prepare([place(f,'f','audio:0',-1)])],
 ['collision',()=>f.prepare([duplicate(f,'f','audio:0',1)])],
 ['overwrite main',()=>f.prepare([duplicate(f,'lead','video:0',9)])],
 ['tiny gap',()=>f.prepare([duplicate(f,'lead','video:0',2.01)])],
 ['removed source',()=>f.prepare([erase(f,'f'),duplicate(f,'f','audio:0',7)])],
 ['main gap source',()=>f.prepare([erase(f,'gap')])],
];
for(const [name,fn] of invalid)check('rejects '+name+' atomically',()=>{const before=JSON.stringify(f.state);assert.throws(fn);assert.equal(JSON.stringify(f.state),before);});
check('both source and destination locks guard all lifecycle changes',()=>{
 for(const [id,ops] of [['audio:0',x=>[erase(x,'f')]],['audio:2',x=>[pair(x,'duplicate-linked')]],['overlay:1',x=>[pair(x,'delete-linked')]],['text:2',x=>[{type:'create-track',trackId:'text:2'}]]]){const x=fixture({layerState:{[id]:{locked:true}}});assert.throws(()=>x.prepare(ops(x)));}
});
check('hidden dependencies and motion pins reject explicit deletion/placement',()=>{
 const main=f.state.present.videoClips.map(c=>c.id==='lead'?{...c,track:{points:[{t:0,x:.5,y:.5}]}}:c);for(const extra of [{textClips:[{id:'pin',start:0,duration:1,layer:0,pin:{to:'lead'}}]},{overlayClips:[{id:'pinned',mediaId:'v',start:0,in:0,out:1,layer:0,pin:{to:'lead'}}]}]){const x=fixture({...extra,videoClips:main});assert.ok(Object.values(x.state.present).some(v=>Array.isArray(v)&&v.some(c=>c.pin?.to==='lead')));assert.throws(()=>x.prepare([erase(x,'lead')]),/motion-pin/);}
});
check('private group topology is checked beyond returned handles',()=>{const x=fixture({textClips:[{id:'hidden',start:0,duration:1,layer:0,linkId:'lq'}]});assert.throws(()=>x.prepare([pair(x,'delete-linked')]));});
check('incoming, outgoing and dormant transitions reject main lifecycle',()=>{
 for(const id of ['lead','tail']){const x=fixture();const p={...x.state.present,videoClips:x.state.present.videoClips.map(c=>c.id===id?{...c,transition:{type:'fade',duration:.5}}:c)},y=fixture(p);assert.throws(()=>y.prepare([erase(y,id)]));}
 const x=fixture({videoClips:[{id:'lead',mediaId:'v',in:0,out:2},{id:'tail',mediaId:'v',in:2,out:4,transition:{type:'fade',duration:.5}},{id:'gap',gap:true,in:0,out:8}]});assert.throws(()=>x.prepare([erase(x,'lead')]));
});
check('scope, ownership and private token guards apply to the whole lifecycle batch',()=>{
 const plan=f.prepare([erase(f,'f')]),a=plan.action;assert.equal(historyReducer(f.state,JSON.parse(JSON.stringify(a))),f.state);const applied=historyReducer(f.state,a);assert.equal(historyReducer(applied,a),applied);const altered=historyReducer(f.state,{type:'setProject',patch:{name:'other'}});assert.equal(historyReducer(altered,a),altered);const agent=historyReducer(f.state,{type:'beginAgentEdit',token:'a'});assert.equal(historyReducer(agent,a),agent);assert.ok(pluginEditsApplied(historyReducer(agent,{...a,agentToken:'a'}),a));
 assert.deepEqual(prepareProjectAction(f.state.present,{type:'preparedPluginClips',token:{}}).project,f.state.present);
});
check('track creation and all new/deleted records share bounded budgets',()=>{
 assert.throws(()=>f.prepare(Array.from({length:9},(_,i)=>({type:'create-track',trackId:`text:${i+2}`}))));
 assert.throws(()=>f.prepare(Array.from({length:65},()=>({type:'create-text',trackId:'text:1',start_sec:0,duration_sec:.1,text:'x'}))));
 const x=fixture({layers:{text:127,audio:1,overlay:1}});assert.throws(()=>x.prepare([{type:'create-track',trackId:'text:127'}]));
});
check('generated free lifecycle sequences match an independent source/placement oracle',()=>{
 for(let sourceIn=0;sourceIn<3;sourceIn++)for(let speed of [.5,1,1.5,2])for(let offset of [0,.25,.5])for(let destination of [3,6,9]){
  const x=fixture({audioClips:[{id:'f',mediaId:'a',start:0,in:sourceIn,out:sourceIn+2*speed,speed,layer:0}],layerState:{}}),r=x.apply([{type:'create-track',trackId:'audio:3'},{type:'create-media',sourceClipId:x.h('f'),trackId:'audio:3',start_sec:destination,offset_sec:offset,duration_sec:.75,...policies},duplicate(x,'f','audio:2',destination),erase(x,'f')]),p=r.state.present;
  assert.equal(p.audioClips.length,2);const a=p.audioClips.find(c=>c.layer===3),b=p.audioClips.find(c=>c.layer===2);near(a.in,sourceIn+offset*speed);near(a.out,sourceIn+(offset+.75)*speed);near(a.start,destination);near(b.in,sourceIn);near(b.out,sourceIn+2*speed);assert.equal(r.plan.clipsChanged,3);assert.equal(r.plan.tracksChanged,1);exactUndo(x,r);generated++;
 }
});

check('main pair lifecycle preserves shifted sound and fixed sequence timing',()=>{
 const x=fixture({videoClips:f.state.present.videoClips.map(c=>c.id==='lead'?{...c,linkId:'ll'}:c),audioClips:[...f.state.present.audioClips,{id:'la',mediaId:'a',start:.25,in:1,out:3,layer:2,linkId:'ll',linkOff:.25,linkInOff:1}]});
 for(const type of ['duplicate-linked','place-linked','delete-linked']){const op={type,clipId:x.h('lead'),partnerClipId:x.h('la'),...(type==='delete-linked'?{}:{pictureTrackId:'video:0',audioTrackId:'audio:0',start_sec:4}),...policies},r=x.apply([op]),p=r.state.present;assert.equal(videoLayout(p.videoClips).at(-1).end,12);assert.equal(videoLayout(p.videoClips).find(l=>l.clip.id==='tail').start,10);if(type!=='delete-linked'){const pic=videoLayout(p.videoClips).find(l=>l.start===4&&!l.clip.gap).clip,sound=p.audioClips.find(c=>c.linkId===pic.linkId);assert.equal(sound.start,4.25);assert.equal(sound.in,1);assert.equal(sound.out,3);}exactUndo(x,r);}
});
check('negative pair offsets remain relative; out-of-bounds onset is refused',()=>{
 const x=fixture({audioClips:f.state.present.audioClips.map(c=>c.id==='qa'?{...c,start:3.5,linkOff:-.5}:c)}),r=x.apply([pair(x,'duplicate-linked',7)]);assert.equal(r.state.present.audioClips.find(c=>!['qa','f'].includes(c.id)).start,6.5);assert.throws(()=>x.prepare([pair(x,'duplicate-linked',.25,'overlay:1','audio:2')]),/captured project/);exactUndo(x,r);
});
check('collisions include unrelated unlisted and hidden layer occupants',()=>{
 assert.throws(()=>f.prepare([pair(f,'duplicate-linked',4,'overlay:1','audio:2')]),/overlap/);
 const x=fixture({audioClips:[...f.state.present.audioClips,{id:'unlisted',mediaId:'a',start:7,in:0,out:2,layer:2}]});assert.throws(()=>x.prepare([pair(x,'duplicate-linked')]),/overlap/);
});
check('source bounds, missing resources and stored source offsets fail closed',()=>{
 for(const extra of [{media:[]},{audioClips:f.state.present.audioClips.map(c=>c.id==='qa'?{...c,out:21}:c)},{audioClips:f.state.present.audioClips.map(c=>c.id==='qa'?{...c,linkInOff:.1}:c)}]){const x=fixture(extra);assert.throws(()=>x.prepare([pair(x,'duplicate-linked')]));}
});
check('explicit zero source speed cannot be treated as a creation default',()=>{
 const x=fixture({overlayClips:[{id:'o',mediaId:'v',start:0,in:0,out:2,speed:1,layer:0}]}),raw={...x.state.present,overlayClips:x.state.present.overlayClips.map(c=>({...c,speed:0}))};assert.throws(()=>preparePluginEdits(raw,x.snapshot,x.targets,x.tx([duplicate(x,'o','overlay:1',7)]),grants),/source window/);
});
check('main consumption counts deleted gap identities and new fragments',()=>{
 const r=f.apply([duplicate(f,'lead','video:0',4)]);assert.equal(r.plan.clipsChanged,4);assert.ok(!r.state.present.videoClips.some(c=>c.id==='gap'));assert.equal(r.state.present.videoClips.filter(c=>c.gap).length,2);
});
check('the affected limit includes main gap fragments independently of operation count',()=>{
 const operations=[duplicate(f,'lead','video:0',4),...Array.from({length:61},(_,i)=>({type:'create-text',trackId:'text:1',start_sec:i*.1,duration_sec:.1,text:'x'}))];assert.throws(()=>f.prepare(operations),/64/);
});
check('canonical manifests enforce exact grants, dependencies and write-family mixtures',()=>{
 const shipped={id:'studio.lifecycle',name:'Lifecycle',publisher:'Fixture',version:'0.1.0',apiVersion:1,minClipcraftVersion:'2.0.0',entry:'commands.js',permissions:grants,contributes:{commands:[{id:'go',name:'Go'}]}};
 assert.deepEqual(validateManifest(shipped).permissions,grants);
 for(const grant of ['clips.manage','tracks.write']){assert.throws(()=>validateManifest({...shipped,permissions:[grant]}),/requires editor.read/);assert.throws(()=>validateManifest({...shipped,permissions:['editor.read',grant,'markers.write']}),/cannot be mixed/);}
 const action={locations:['clip-menu'],permissions:['editor.read','clips.manage'],when:{selection:'single'}};assert.equal(actionState(action,'clip-menu',{hasProject:true,selection:[{lane:'text'}]}).enabled,true);assert.equal(actionState({...action,permissions:['editor.read','clips.write']},'clip-menu',{hasProject:true,selection:[{lane:'video'}]}).enabled,false);
});
console.log(JSON.stringify({ok:true,checks,generated}));
