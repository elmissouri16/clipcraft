import assert from 'node:assert/strict';
import {emptyProject,historyReducer,preparePluginEdits,pluginEditsApplied,videoLayout} from '../../../src/state/store.js';
import {createEditorContext} from '../../../src/features/plugins/editorContext.js';
import {setPluginEffects,pluginEffectInstance,pluginEffectSource} from '../../../src/features/plugins/effectRegistry.js';
import {effectId} from '../../../shared/pluginEffects.mjs';
import {baseAt} from '../../../src/features/timeline/anim.js';
import {audioGain} from '../../../src/features/audio/fades.js';
// Historical schema assertions are read-only; native edit planning remains in use.
import {validateLegacyManifest as validateManifest} from '../../../shared/legacyPluginManifest.mjs';
let checks=0,generated=0;const check=(name,fn)=>{fn();checks++;console.log('PASS',name);},near=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`),grants=['editor.read','clips.retime','clips.automation','clips.effects','clips.links'];
const definition={pluginId:'studio.fx',id:'gain',contributionId:'studio.fx/gain',name:'Gain',version:'0.1.0',digest:'a'.repeat(64),expression:'S(X,Y)*{{gain}}',parameters:[{id:'gain',name:'Gain',min:0,max:2,step:.1,default:1}],preferred:true};setPluginEffects([definition]);const fx=effectId(definition),ref=pluginEffectInstance(fx,{gain:.8});
function fixture(extra={}){
 const raw={...emptyProject(),media:[{id:'v',type:'video',duration:30,hasAudio:true},{id:'a',type:'audio',duration:30},{id:'i',type:'image'}],videoClips:[{id:'v',mediaId:'v',in:1,out:5,linkId:'lv',keyframes:{x:[{t:1,v:0},{t:5,v:.5}]}},{id:'gap',gap:true,in:0,out:4}],overlayClips:[{id:'o',mediaId:'i',start:1,in:0,out:2,layer:0,effects:['vignette'],fxStrength:{vignette:.5},fxRegions:{vignette:{x:.5,y:.5,w:.5,h:.5}}}],audioClips:[{id:'a',mediaId:'a',start:.25,in:2.1,out:6.1,layer:0,linkId:'lv',linkOff:.25,linkInOff:1.1,fadeIn:.5,volumeKeys:[{t:2.1,v:.5},{t:6.1,v:1}]},{id:'free',mediaId:'a',start:6,in:1,out:3,layer:1}],textClips:[{id:'t',text:'Keep',start:0,duration:2,layer:0}],effectClips:[{id:'e',start:6,duration:1,fx:'vignette'},{id:'pe',start:6,duration:1,fx,pluginEffect:ref,disabled:true}],markers:[{id:'m',time:7}],...extra};
 const state=historyReducer({past:[],present:emptyProject(),future:[]},{type:'load',project:raw}),read=createEditorContext(),snapshot=read(state.present,null,{time_sec:0,playing:false}),targets=read.targets(snapshot),h=id=>targets.find(t=>t.id===id)?.handle;
 const op=(type,id,fields={})=>({type,clipId:h(id),partnerClipId:id==='v'?h('a'):id==='a'?h('v'):null,...fields}),tx=operations=>({documentId:snapshot.documentId,revision:snapshot.revision,operations}),prepare=(ops,permissions=grants)=>preparePluginEdits(state.present,snapshot,targets,tx(ops),permissions),apply=ops=>{const plan=prepare(ops);return {plan,state:plan.action?historyReducer(state,plan.action):state};};
 return {state,snapshot,targets,h,op,tx,prepare,apply};
}
const f=fixture(),speed=(x,id,value)=>x.op('set-speed',id,{speed:value,timeline:'preserve-time',source:'within-media',automation:'preserve-source'}),curve=(x,id,property,points)=>x.op('set-keyframes',id,{property,points,timebase:'source'}),point=(source_sec,value,easing='linear')=>({source_sec,value,easing});
function exactUndo(x,r){assert.equal(r.state.past.length,1);assert.ok(pluginEditsApplied(r.state,r.plan.action));const u=historyReducer(r.state,{type:'undo'});assert.deepEqual(u.present,x.state.present);assert.deepEqual(historyReducer(u,{type:'redo'}).present,r.state.present);}
check('speed changes both named source windows at fixed timeline duration',()=>{
 const r=f.apply([speed(f,'v',2)]),p=r.state.present;assert.equal(r.plan.clipsChanged,2);assert.equal(p.videoClips[0].in,1);assert.equal(p.videoClips[0].out,9);assert.equal(p.audioClips[0].in,2.1);assert.equal(p.audioClips[0].out,10.1);assert.equal(p.audioClips[0].start,.25);assert.equal(p.audioClips[0].linkInOff,1.1);assert.equal(p.videoClips[0].keyframes,f.state.present.videoClips[0].keyframes);assert.equal(p.audioClips[0].volumeKeys,f.state.present.audioClips[0].volumeKeys);assert.equal(p.audioClips[0].fadeIn,.5);assert.deepEqual(videoLayout(p.videoClips).map(l=>[l.start,l.end]),videoLayout(f.state.present.videoClips).map(l=>[l.start,l.end]));assert.equal(p.markers,f.state.present.markers);assert.equal(p.overlayClips,f.state.present.overlayClips);exactUndo(f,r);
});
check('audio-initiated speed is still picture-relative and source offsets stay exact',()=>{const r=f.apply([speed(f,'a',.5)]);assert.equal(r.state.present.videoClips[0].out,3);assert.equal(r.state.present.audioClips[0].out,4.1);exactUndo(f,r);});
check('curve replacement, clear, easing and volume automation are explicit',()=>{
 const r=f.apply([curve(f,'v','x',[point(1,-.5),point(5,.5,'continuous')]),curve(f,'o','opacity',[point(0,.25),point(2,.75,'inout')]),curve(f,'a','volume',[point(2.1,0),point(6.1,1)])]),p=r.state.present;assert.equal(r.plan.clipsChanged,3);assert.equal(p.videoClips[0].keyframes.x[1].e,'continuous');near(baseAt(p.overlayClips[0],1).opacity,.5);assert.deepEqual(p.audioClips[0].volumeKeys,[{t:2.1,v:0},{t:6.1,v:1}]);assert.equal(p.audioClips[0].linkOff,.25);exactUndo(f,r);
 const clear=f.apply([curve(f,'v','x',[]),curve(f,'a','volume',[])]);assert.equal(clear.state.present.videoClips[0].keyframes,undefined);assert.equal(clear.state.present.audioClips[0].volumeKeys,undefined);exactUndo(f,clear);
});
check('operation order validates curves against the currently requested speed window',()=>{
 const r=f.apply([speed(f,'v',2),curve(f,'v','opacity',[point(1,0),point(9,1)])]);near(baseAt(r.state.present.videoClips[0],2).opacity,.5);exactUndo(f,r);
 assert.throws(()=>f.prepare([curve(f,'v','opacity',[point(1,0),point(9,1)]),speed(f,'v',2)]),/current source window/);
});
check('effect resource attachment, validated parameters, slot reorder and removal preserve other fields',()=>{
 const r=f.apply([f.op('attach-effect','o',{sourceClipId:f.h('pe'),beforeIndex:0,strength:.75,params:{gain:.5}}),f.op('set-effect','o',{effectIndex:0,enabled:true,strength:.5,params:{gain:1.2}}),f.op('move-effect','o',{effectIndex:0,beforeIndex:1}),f.op('remove-effect','o',{effectIndex:0})]),c=r.state.present.overlayClips[0];assert.deepEqual(c.effects,[fx]);assert.equal(c.fxStrength[fx],.5);assert.equal(c.pluginEffects[fx].params.gain,1.2);assert.equal(c.fxStrength.vignette,undefined);assert.equal(c.fxRegions.vignette,undefined);assert.ok(pluginEffectSource(fx,c.pluginEffects[fx]).includes('1.2'));assert.equal(c.start,1);exactUndo(f,r);
});
check('free effect values change without altering duration or choosing a new identity',()=>{const r=f.apply([f.op('set-effect','pe',{effectIndex:null,enabled:true,strength:.4,params:{gain:.6}})]),c=r.state.present.effectClips.find(c=>c.id==='pe');assert.equal(c.disabled,false);assert.equal(c.fx,fx);assert.equal(c.pluginEffect.params.gain,.6);assert.equal(c.duration,1);exactUndo(f,r);});
check('disabling and removing broken plugin dependencies requires no silent upgrade',()=>{
 const x=fixture({overlayClips:[{id:'o',mediaId:'i',start:1,in:0,out:2,layer:0,effects:[fx],pluginEffects:{[fx]:ref}}]});setPluginEffects([]);const r=x.apply([x.op('set-effect','o',{effectIndex:0,enabled:false,strength:1,params:{}})]);assert.equal(r.state.present.overlayClips[0].fxStrength[fx],0);assert.throws(()=>x.prepare([x.op('set-effect','o',{effectIndex:0,enabled:true,strength:1,params:{}})]),/exact available/);assert.equal(x.apply([x.op('remove-effect','o',{effectIndex:0})]).state.present.overlayClips[0].effects.length,0);setPluginEffects([definition]);
});
check('effect-catalog revocation after planning invalidates the private commit token',()=>{const plan=f.prepare([f.op('set-effect','pe',{effectIndex:null,enabled:true,strength:.5,params:{gain:.5}})]);setPluginEffects([]);assert.equal(historyReducer(f.state,plan.action),f.state);setPluginEffects([definition]);assert.equal(historyReducer(f.state,plan.action),f.state);});
check('unchanged speed, canonical curve and empty clear operations create no history',()=>{const p=f.prepare([speed(f,'v',1),curve(f,'v','x',[point(1,0),point(5,.5)]),curve(f,'free','volume',[]),f.op('set-effect','e',{effectIndex:null,enabled:true,strength:1,params:{}}),f.op('move-effect','o',{effectIndex:0,beforeIndex:0})]);assert.equal(p.action,null);assert.equal(p.clipsChanged,0);});
const invalid=[
 ['old speed grant',()=>f.prepare([speed(f,'v',2)],['editor.read','clips.properties','clips.links'])],
 ['old curve grant',()=>f.prepare([curve(f,'o','x',[point(0,0)])],['editor.read','clips.properties'])],
 ['old effect grant',()=>f.prepare([f.op('set-effect','e',{effectIndex:null,enabled:true,strength:.4,params:{}})],['editor.read','clips.properties'])],
 ['missing pair grant',()=>f.prepare([speed(f,'v',2)],['editor.read','clips.retime'])],
 ['implicit pair',()=>f.prepare([{...speed(f,'v',2),partnerClipId:null}])],
 ['wrong partner',()=>f.prepare([{...speed(f,'v',2),partnerClipId:f.h('free')}])],
 ['image speed',()=>f.prepare([speed(f,'o',2)])],
 ['zero speed',()=>f.prepare([speed(f,'free',0)])],
 ['negative speed',()=>f.prepare([speed(f,'free',-1)])],
 ['infinite speed',()=>f.prepare([speed(f,'free',Infinity)])],
 ['large speed',()=>f.prepare([speed(f,'free',4.1)])],
 ['bad speed policy',()=>f.prepare([{...speed(f,'free',2),timeline:'ripple'}])],
 ['text curve',()=>f.prepare([curve(f,'t','opacity',[point(0,.5)])])],
 ['audio picture curve',()=>f.prepare([curve(f,'free','opacity',[point(1,.5)])])],
 ['image sound curve',()=>f.prepare([curve(f,'o','volume',[point(0,.5)])])],
 ['prototype curve',()=>f.prepare([curve(f,'o','constructor',[])])],
 ['curve outside source',()=>f.prepare([curve(f,'v','x',[point(0,0)])])],
 ['curve repeats',()=>f.prepare([curve(f,'v','x',[point(1,0),point(1,1)])])],
 ['curve descending',()=>f.prepare([curve(f,'v','x',[point(2,0),point(1,1)])])],
 ['curve nonfinite',()=>f.prepare([curve(f,'v','x',[point(1,NaN)])])],
 ['bad opacity',()=>f.prepare([curve(f,'o','opacity',[point(0,1.1)])])],
 ['unknown easing',()=>f.prepare([curve(f,'o','x',[point(0,0,'code')])])],
 ['volume easing',()=>f.prepare([curve(f,'free','volume',[point(1,0,'continuous')])])],
 ['extra curve field',()=>f.prepare([curve(f,'o','x',[{...point(0,0),expression:'process.exit()'}])])],
 ['empty missing policy',()=>f.prepare([{...curve(f,'o','x',[]),timebase:'timeline'}])],
 ['oversized curve',()=>f.prepare([curve(f,'o','x',Array.from({length:65},(_,i)=>point(i/64,0)))])],
 ['missing resource',()=>f.prepare([f.op('attach-effect','o',{sourceClipId:'raw-id',beforeIndex:0,strength:1,params:{}})])],
 ['duplicate effect',()=>f.prepare([f.op('attach-effect','o',{sourceClipId:f.h('e'),beforeIndex:0,strength:1,params:{}})])],
 ['missing slot',()=>f.prepare([f.op('set-effect','o',{effectIndex:2,enabled:true,strength:1,params:{}})])],
 ['free-effect index',()=>f.prepare([f.op('set-effect','e',{effectIndex:0,enabled:true,strength:1,params:{}})])],
 ['bad strength',()=>f.prepare([f.op('set-effect','e',{effectIndex:null,enabled:true,strength:1.1,params:{}})])],
 ['builtin params',()=>f.prepare([f.op('set-effect','e',{effectIndex:null,enabled:true,strength:1,params:{script:1}})])],
 ['unknown plugin params',()=>f.prepare([f.op('set-effect','pe',{effectIndex:null,enabled:true,strength:1,params:{secret:1}})])],
 ['out-of-range plugin params',()=>f.prepare([f.op('set-effect','pe',{effectIndex:null,enabled:true,strength:1,params:{gain:3}})])],
 ['parameter code',()=>f.prepare([f.op('set-effect','pe',{effectIndex:null,enabled:true,strength:1,params:{gain:'eval(1)'}})])],
 ['shader injection',()=>f.prepare([{...f.op('set-effect','e',{effectIndex:null,enabled:true,strength:1,params:{}}),expression:'S(X,Y)'}])],
 ['slot reorder out of bounds',()=>f.prepare([f.op('move-effect','o',{effectIndex:0,beforeIndex:1})])],
 ['mix with static',()=>f.prepare([speed(f,'free',2),f.op('set-opacity','o',{opacity:.5})])],
];
for(const [name,fn] of invalid)check('rejects '+name+' atomically',()=>{const before=JSON.stringify(f.state);assert.throws(fn);assert.equal(JSON.stringify(f.state),before);});
check('new media bounds and processed-source restrictions include both linked members',()=>{
 for(const extra of [{media:f.state.present.media.map(m=>m.id==='a'?{...m,duration:7}:m)},{videoClips:f.state.present.videoClips.map(c=>c.id==='v'?{...c,enhance:{on:true}}:c)},{media:f.state.present.media.map(m=>m.id==='v'?{...m,graphic:{id:'g'}}:m)}]){const x=fixture(extra);assert.throws(()=>x.prepare([speed(x,'v',2)]));}
});
check('whole private topology, locks, pins and ambiguous IDs guard source automation',()=>{
 for(const layer of ['video:0','audio:0']){const x=fixture({layerState:{[layer]:{locked:true}}});assert.throws(()=>x.prepare([speed(x,'v',2)]));}
 const hidden=fixture({textClips:[{id:'hidden',text:'Hidden',start:0,duration:1,layer:0,linkId:'lv'}]});assert.throws(()=>hidden.prepare([speed(hidden,'v',2)]));
 const pins=fixture({videoClips:f.state.present.videoClips.map(c=>c.id==='v'?{...c,track:{points:[{t:1,x:.5,y:.5}]}}:c),textClips:[{id:'t',text:'Pinned',start:0,duration:1,layer:0,pin:{to:'v'}}]});assert.throws(()=>pins.prepare([speed(pins,'v',2)]),/motion-pin/);
 const raw={...f.state.present,overlayClips:[...f.state.present.overlayClips,{...f.state.present.overlayClips[0],start:5,layer:1}]};assert.throws(()=>preparePluginEdits(raw,f.snapshot,f.targets,f.tx([curve(f,'o','opacity',[point(0,.5)])]),grants),/context changed/);
});
check('point and operation budgets cover the full transaction, not each declaration alone',()=>{
 const full=Array.from({length:64},(_,i)=>point(1+i*4/63,0));assert.throws(()=>f.prepare(Array.from({length:5},()=>curve(f,'v','x',full))),/256/);assert.throws(()=>f.prepare(Array.from({length:65},()=>speed(f,'free',2))),/64/);
});
check('main transitions retain their exact original overlaps under fixed-time speed',()=>{
 const x=fixture({videoClips:[{id:'v',mediaId:'v',in:1,out:5,linkId:'lv'},{id:'next',mediaId:'v',in:2,out:6,transition:{type:'fade',duration:.5}}]});const r=x.apply([speed(x,'v',2)]);assert.deepEqual(videoLayout(r.state.present.videoClips).map(l=>[l.start,l.end,l.trans]),videoLayout(x.state.present.videoClips).map(l=>[l.start,l.end,l.trans]));exactUndo(x,r);
});
check('effect fingerprint mismatch never silently upgrades saved parameters',()=>{const x=fixture({effectClips:[{id:'pe',start:6,duration:1,fx,pluginEffect:{...ref,digest:'b'.repeat(64)}}]});assert.throws(()=>x.prepare([x.op('set-effect','pe',{effectIndex:null,enabled:true,strength:1,params:{gain:.5}})]),/exact available/);});
check('private source plans reject forged/replayed tokens, stale contexts and wrong edit owner',()=>{
 const plan=f.prepare([speed(f,'v',2)]),done=historyReducer(f.state,plan.action);assert.equal(historyReducer(done,plan.action),done);assert.equal(historyReducer(f.state,JSON.parse(JSON.stringify(plan.action))),f.state);const s=historyReducer(f.state,{type:'setProject',patch:{name:'Changed'}});assert.equal(historyReducer(s,plan.action),s);const a=historyReducer(f.state,{type:'beginAgentEdit',token:'owner'});assert.equal(historyReducer(a,plan.action),a);assert.ok(pluginEditsApplied(historyReducer(a,{...plan.action,agentToken:'owner'}),plan.action));assert.throws(()=>preparePluginEdits(f.state.present,f.snapshot,f.targets,{...f.tx([speed(f,'v',2)]),revision:99},grants));
});
check('new manifest grants require read access and keep other writer families separate',()=>{
 const manifest={id:'studio.automation',name:'Automation',publisher:'Fixture',version:'0.1.0',apiVersion:1,entry:'commands.js',permissions:grants,contributes:{commands:[{id:'go',name:'Go'}]}};assert.deepEqual(validateManifest(manifest).permissions,grants);for(const grant of ['clips.retime','clips.automation','clips.effects']){assert.throws(()=>validateManifest({...manifest,permissions:[grant]}),/requires editor.read/);assert.throws(()=>validateManifest({...manifest,permissions:['editor.read',grant,'markers.write']}),/cannot be mixed/);}
});
check('generated speed/curve edits match independent source-window and interpolation algebra',()=>{
 for(const sourceIn of [0,.1,1])for(const oldSpeed of [.5,1,2])for(const newSpeed of [.25,.5,1,2,4])for(const startValue of [0,.25,.5]){
  const length=2,off=.3,x=fixture({videoClips:[{id:'v',mediaId:'v',in:sourceIn,out:sourceIn+length*oldSpeed,speed:oldSpeed,linkId:'lv'},{id:'gap',gap:true,in:0,out:4}],audioClips:[{id:'a',mediaId:'a',start:.25,in:sourceIn+off,out:sourceIn+off+length*oldSpeed,speed:oldSpeed,layer:0,linkId:'lv',linkOff:.25,linkInOff:off}]}),r=x.apply([speed(x,'v',newSpeed),curve(x,'v','opacity',[point(sourceIn,startValue),point(sourceIn+length*newSpeed,1)]),curve(x,'a','volume',[point(sourceIn+off,startValue),point(sourceIn+off+length*newSpeed,1)])]),p=r.state.present;
  near(p.videoClips[0].out,sourceIn+length*newSpeed);near(p.audioClips[0].out,sourceIn+off+length*newSpeed);near(videoLayout(p.videoClips)[0].end,length);for(const local of [0,.25,1,1.75,2]){const value=startValue+(1-startValue)*local/length;near(baseAt(p.videoClips[0],local).opacity,value);near(audioGain(p.audioClips[0],local,length),value);}exactUndo(x,r);generated++;
 }
});
console.log(JSON.stringify({ok:true,checks,generated}));
