import assert from 'node:assert/strict';
import {emptyProject,historyReducer,preparePluginEdits,pluginEditsApplied,videoLayout,prepareProjectAction} from '../../../src/state/store.js';
import {createEditorContext} from '../../../src/features/plugins/editorContext.js';
import {audioGain} from '../../../src/features/audio/fades.js';
import {resolveStyle} from '../../../src/features/text/style.js';
import {PROPERTY_FONTS} from '../../../shared/pluginProperties.mjs';
// Historical schema assertions are read-only; native edit planning remains in use.
import {validateLegacyManifest as validateManifest} from '../../../shared/legacyPluginManifest.mjs';
import {actionState} from '../../../shared/pluginActions.mjs';
import {FONT_LIST} from '../../../shared/fontCatalog.mjs';
let checks=0,generated=0;const check=(name,fn)=>{fn();checks++;console.log('PASS',name);},near=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`),grants=['editor.read','clips.properties','clips.links'];
function fixture(extra={}){
 const raw={...emptyProject(),media:[{id:'v',type:'video',duration:20,hasAudio:true},{id:'a',type:'audio',duration:20},{id:'i',type:'image'}],videoClips:[{id:'v',mediaId:'v',in:1,out:5,linkId:'lv'},{id:'gap',gap:true,in:0,out:4}],overlayClips:[{id:'o',mediaId:'i',start:1,in:0,out:2,layer:0,transform:{scale:.5,x:.1,y:0},opacity:.8}],audioClips:[{id:'a',mediaId:'a',start:.25,in:2,out:6,layer:0,linkId:'lv',linkOff:.25,linkInOff:1,volume:.8,fadeIn:2,fadeInOffset:.5,volumeKeys:[{t:2,v:.5},{t:6,v:1}]},{id:'free',mediaId:'a',start:5,in:1,out:3,layer:1}],textClips:[{id:'t',start:0,duration:2,text:'One two',caption:true,words:[{text:'One',start:0,end:.8},{text:'two',start:1,end:2}],word_timing:'measured',layer:0,outline:true,shadow:{on:false,color:'#123456',blur:3}}],effectClips:[{id:'fx',start:6,duration:1,fx:'vignette'}],markers:[{id:'m',time:7}],...extra};
 const state=historyReducer({past:[],present:emptyProject(),future:[]},{type:'load',project:raw}),read=createEditorContext(),snapshot=read(state.present,null,{time_sec:0,playing:false}),targets=read.targets(snapshot),h=id=>targets.find(t=>t.id===id)?.handle;
 const op=(type,id,fields={})=>({type,clipId:h(id),partnerClipId:id==='v'?h('a'):id==='a'?h('v'):null,...fields}),tx=operations=>({documentId:snapshot.documentId,revision:snapshot.revision,operations}),prepare=(ops,permissions=grants)=>preparePluginEdits(state.present,snapshot,targets,tx(ops),permissions),apply=ops=>{const plan=prepare(ops);return {plan,state:plan.action?historyReducer(state,plan.action):state};};
 return {state,snapshot,targets,h,op,tx,prepare,apply};
}
const f=fixture();
function exactUndo(x,r){assert.equal(r.state.past.length,1);assert.ok(pluginEditsApplied(r.state,r.plan.action));const u=historyReducer(r.state,{type:'undo'});assert.deepEqual(u.present,x.state.present);assert.deepEqual(historyReducer(u,{type:'redo'}).present,r.state.present);}
check('one batch edits typed text, style, picture transforms, opacity and audio only',()=>{
 const r=f.apply([f.op('set-text','t',{text:'Updated title',measuredWords:'invalidate'}),f.op('set-text-style','t',{style:{font:'montserrat',size:32,color:'#40a0ff',stroke:{color:'#abcdef'},shadow:{opacity:.4},bg:{on:true}}}),f.op('set-transform','v',{transform:{scale:.5,x:.25,rot:90}}),f.op('set-opacity','o',{opacity:.4}),f.op('set-audio','a',{audio:{volume:.5,fadeIn_sec:1,fadeOut_sec:.5},fadePolicy:'replace-edges'})]),p=r.state.present;
 assert.equal(r.plan.clipsChanged,4);assert.equal(p.textClips[0].text,'Updated title');assert.equal(p.textClips[0].words,undefined);assert.equal(p.textClips[0].word_timing,'estimated');assert.equal(resolveStyle(p.textClips[0]).stroke.width,resolveStyle(f.state.present.textClips[0]).stroke.width);assert.equal(p.textClips[0].shadow.color,'#123456');assert.equal(p.audioClips[0].fadeInOffset,0);assert.equal(p.audioClips[0].volumeKeys,f.state.present.audioClips[0].volumeKeys);assert.equal(p.videoClips[0].in,1);assert.equal(p.videoClips[0].out,5);assert.equal(p.audioClips[0].start,.25);assert.equal(p.audioClips[0].linkOff,.25);assert.equal(p.media,f.state.present.media);assert.equal(p.markers,f.state.present.markers);assert.equal(p.effectClips,f.state.present.effectClips);assert.deepEqual(videoLayout(p.videoClips).map(l=>[l.start,l.end]),videoLayout(f.state.present.videoClips).map(l=>[l.start,l.end]));exactUndo(f,r);
});
check('style-only edits preserve measured captions, timing and untouched nested settings',()=>{const r=f.apply([f.op('set-text-style','t',{style:{color:'#ffffff',size:40,shadow:{blur:8}}})]);assert.equal(r.state.present.textClips[0].words,f.state.present.textClips[0].words);assert.equal(r.state.present.textClips[0].shadow.color,'#123456');assert.equal(r.state.present.textClips[0].shadow.on,false);exactUndo(f,r);});
check('measured wording requires deliberate invalidation while unchanged wording is a no-op',()=>{assert.throws(()=>f.prepare([f.op('set-text','t',{text:'Changed',measuredWords:'reject'})]),/explicit invalidation/);assert.equal(f.prepare([f.op('set-text','t',{text:'One two',measuredWords:'reject'})]).action,null);});
check('setting effective default values does not invent properties or history',()=>{const x=fixture({textClips:[{id:'t',text:'Title',start:0,duration:2,layer:0}]});const p=x.prepare([x.op('set-text-style','t',{style:{size:64,bold:true,stroke:{color:'#000000'}}}),x.op('set-opacity','t',{opacity:1}),x.op('set-audio','free',{audio:{volume:1,muted:false,fadeIn_sec:0},fadePolicy:'replace-edges'})]);assert.equal(p.action,null);assert.equal(p.clipsChanged,0);});
check('unlinked property scope works without pair-management permission',()=>{const p=f.prepare([f.op('set-opacity','o',{opacity:.3})],['editor.read','clips.properties']);assert.equal(p.clipsChanged,1);});
check('linked writes affect only the named member and preserve fractional source offsets',()=>{const x=fixture({audioClips:f.state.present.audioClips.map(c=>c.id==='a'?{...c,in:2.1,out:6.1,linkInOff:1.1}:c)}),r=x.apply([x.op('set-opacity','v',{opacity:.5})]);assert.equal(r.state.present.audioClips,x.state.present.audioClips);assert.equal(r.state.present.audioClips[0].out,6.1);exactUndo(x,r);});
check('volume multiplies existing automation; changing a fade replaces only that edge',()=>{const r=f.apply([f.op('set-audio','a',{audio:{volume:.4,fadeOut_sec:1},fadePolicy:'replace-edges'})]),a=r.state.present.audioClips[0];assert.equal(a.fadeInOffset,.5);assert.equal(a.fadeIn,2);assert.equal(a.fadeOut,1);for(const t of [.25,.75,1.5])near(audioGain(a,t,4),audioGain(f.state.present.audioClips[0],t,4)*.5);exactUndo(f,r);});
check('a sliced fade can be deliberately restarted even at the same duration',()=>{const r=f.apply([f.op('set-audio','a',{audio:{fadeIn_sec:2},fadePolicy:'replace-edges'})]);assert.equal(r.plan.clipsChanged,1);assert.equal(r.state.present.audioClips[0].fadeInOffset,0);near(audioGain(r.state.present.audioClips[0],0,4),0);exactUndo(f,r);});
check('unrelated keyframes and edge animations are preserved',()=>{const x=fixture({overlayClips:[{...f.state.present.overlayClips[0],keyframes:{opacity:[{t:0,v:.5}]},anim:{in:{type:'fade'}}}]}),r=x.apply([x.op('set-transform','o',{transform:{x:.25}})]);assert.equal(r.state.present.overlayClips[0].keyframes,x.state.present.overlayClips[0].keyframes);assert.equal(r.state.present.overlayClips[0].anim,x.state.present.overlayClips[0].anim);exactUndo(x,r);});
check('setting a keyframed static property rejects without erasing automation',()=>{for(const [fields,operation] of [[{opacity:[{t:0,v:.5}]},x=>x.op('set-opacity','o',{opacity:.3})],[{x:[{t:0,v:.1}]},x=>x.op('set-transform','o',{transform:{x:.3}})]]){const x=fixture({overlayClips:[{...f.state.present.overlayClips[0],keyframes:fields}]});assert.throws(()=>x.prepare([operation(x)]),/existing keyframes/);}});
const invalid=[
 ['missing new grant',()=>f.prepare([f.op('set-opacity','o',{opacity:.3})],['editor.read','clips.write'])],
 ['missing linked grant',()=>f.prepare([f.op('set-opacity','v',{opacity:.3})],['editor.read','clips.properties'])],
 ['missing pair declaration',()=>f.prepare([{...f.op('set-opacity','v',{opacity:.3}),partnerClipId:null}])],
 ['wrong partner',()=>f.prepare([{...f.op('set-opacity','v',{opacity:.3}),partnerClipId:f.h('free')}])],
 ['unexpected partner',()=>f.prepare([{...f.op('set-opacity','o',{opacity:.3}),partnerClipId:f.h('free')}])],
 ['raw patch',()=>f.prepare([{...f.op('set-opacity','o',{opacity:.3}),patch:{path:'/secret'}}])],
 ['source mutation',()=>f.prepare([{...f.op('set-transform','o',{transform:{x:0}}),in:0}])],
 ['empty transform',()=>f.prepare([f.op('set-transform','o',{transform:{}})])],
 ['transform on text',()=>f.prepare([f.op('set-transform','t',{transform:{x:0}})])],
 ['opacity on effect',()=>f.prepare([f.op('set-opacity','fx',{opacity:.5})])],
 ['audio on image',()=>f.prepare([f.op('set-audio','o',{audio:{muted:true},fadePolicy:'replace-edges'})])],
 ['long fade',()=>f.prepare([f.op('set-audio','free',{audio:{fadeIn_sec:3},fadePolicy:'replace-edges'})])],
 ['fade policy',()=>f.prepare([f.op('set-audio','free',{audio:{volume:.4},fadePolicy:'preserve'})])],
 ['empty style',()=>f.prepare([f.op('set-text-style','t',{style:{}})])],
 ['unsafe font',()=>f.prepare([f.op('set-text-style','t',{style:{font:'file:///private/font'}})])],
 ['unsafe color',()=>f.prepare([f.op('set-text-style','t',{style:{color:'url(/secret)'}})])],
 ['nested unknown field',()=>f.prepare([f.op('set-text-style','t',{style:{stroke:{path:'secret'}}})])],
 ['empty nested field',()=>f.prepare([f.op('set-text-style','t',{style:{shadow:{}}})])],
 ['blank text',()=>f.prepare([f.op('set-text','t',{text:' ',measuredWords:'invalidate'})])],
 ['text control',()=>f.prepare([f.op('set-text','t',{text:'a\u0000',measuredWords:'invalidate'})])],
 ['long text',()=>f.prepare([f.op('set-text','t',{text:'x'.repeat(2001),measuredWords:'invalidate'})])],
 ['missing text policy',()=>{const o=f.op('set-text','t',{text:'New'});return f.prepare([o]);}],
 ['mixed family',()=>f.prepare([f.op('set-opacity','o',{opacity:.3}),{type:'move',clipId:f.h('o'),start_sec:3}])],
 ['main gap',()=>f.prepare([f.op('set-opacity','gap',{opacity:.3})])],
];
for(const [name,fn] of invalid)check('rejects '+name+' atomically',()=>{const before=JSON.stringify(f.state);assert.throws(fn);assert.equal(JSON.stringify(f.state),before);});
check('all numeric properties reject nonfinite and out-of-bounds inputs',()=>{
 const kinds=[['set-opacity','o','opacity',v=>v,-.1,1.1],['set-transform','o','transform',v=>({scale:v}),0,4.1],['set-text-style','t','style',v=>({size:v}),7,601],['set-audio','free','audio',v=>({volume:v}),-.1,2.1]];
 for(const [type,id,field,make,lo,hi] of kinds)for(const v of [NaN,Infinity,-Infinity,lo,hi])assert.throws(()=>f.prepare([f.op(type,id,{[field]:make(v),...(type==='set-audio'?{fadePolicy:'replace-edges'}:{})})]));
});
check('all text style, nested decoration and transform bounds are enforced',()=>{
 for(const [name,lo,hi] of [['size',8,600],['letterSpacing',-10,50],['lineHeight',.5,3],['maxWidth',.05,1],['x',-1,2],['y',-1,2],['rotation',-180,180],['opacity',0,1]]){for(const v of [lo,hi])assert.doesNotThrow(()=>f.prepare([f.op('set-text-style','t',{style:{[name]:v}})]));for(const v of [lo-.01,hi+.01])assert.throws(()=>f.prepare([f.op('set-text-style','t',{style:{[name]:v}})]));}
 for(const [nested,name,lo,hi] of [['stroke','width',0,24],['shadow','blur',0,100],['shadow','x',-100,100],['shadow','y',-100,100],['shadow','opacity',0,1],['bg','radius',0,100],['bg','padding',0,2],['bg','opacity',0,1]]){for(const v of [lo,hi])assert.doesNotThrow(()=>f.prepare([f.op('set-text-style','t',{style:{[nested]:{[name]:v}}})]));for(const v of [lo-.01,hi+.01])assert.throws(()=>f.prepare([f.op('set-text-style','t',{style:{[nested]:{[name]:v}}})]));}
 for(const name of ['bold','italic','underline','uppercase'])assert.throws(()=>f.prepare([f.op('set-text-style','t',{style:{[name]:1}})]));
 for(const [name,lo,hi] of [['scale',.05,4],['scaleX',.05,4],['scaleY',.05,4],['x',-2,2],['y',-2,2],['rot',-180,180]])for(const value of [lo-.01,hi+.01])assert.throws(()=>f.prepare([f.op('set-transform','o',{transform:{[name]:value}})]));
 for(const [nested,value] of [['shadow',{on:'yes'}],['bg',{mode:'url'}],['stroke',{color:'#abc'}]])assert.throws(()=>f.prepare([f.op('set-text-style','t',{style:{[nested]:value}})]));
});
check('both pair locks and hidden full-project group members reject writes',()=>{
 for(const layer of ['video:0','audio:0']){const x=fixture({layerState:{[layer]:{locked:true}}});assert.throws(()=>x.prepare([x.op('set-opacity','v',{opacity:.5})]));}
 const x=fixture({textClips:[...f.state.present.textClips,{id:'hidden',start:4,duration:1,layer:1,linkId:'lv'}]});assert.throws(()=>x.prepare([x.op('set-opacity','v',{opacity:.5})]));
});
check('pins on targets and on omitted followers reject collateral visual edits',()=>{const x=fixture({overlayClips:[{...f.state.present.overlayClips[0],track:{points:[{t:0,x:.5,y:.5}]}}],textClips:[{id:'t',start:0,duration:1,layer:0,text:'Pinned',pin:{to:'o'}}]});assert.throws(()=>x.prepare([x.op('set-opacity','o',{opacity:.5})]),/motion-pin/);assert.throws(()=>x.prepare([x.op('set-text-style','t',{style:{size:20}})]),/motion-pin/);});
check('ambiguous private IDs outside the public slice cannot multiply a property write',()=>{
 const raw={...f.state.present,overlayClips:[...f.state.present.overlayClips,{...f.state.present.overlayClips[0],start:6,layer:2}]};assert.throws(()=>preparePluginEdits(raw,f.snapshot,f.targets,f.tx([f.op('set-opacity','o',{opacity:.3})]),grants),/context changed/);
});
check('64 operations and changed-record receipts stay bounded',()=>{assert.throws(()=>f.prepare(Array.from({length:65},()=>f.op('set-opacity','o',{opacity:.5}))));const r=f.apply(Array.from({length:64},(_,i)=>f.op('set-opacity','o',{opacity:i/64})));assert.equal(r.plan.clipsChanged,1);exactUndo(f,r);});
check('private tokens, stale context, exact base and agent ownership remain mandatory',()=>{
 const p=f.prepare([f.op('set-opacity','o',{opacity:.3})]),r=historyReducer(f.state,p.action);assert.equal(historyReducer(r,p.action),r);assert.equal(historyReducer(f.state,JSON.parse(JSON.stringify(p.action))),f.state);const s=historyReducer(f.state,{type:'setProject',patch:{name:'Other'}});assert.equal(historyReducer(s,p.action),s);const a=historyReducer(f.state,{type:'beginAgentEdit',token:'property-agent'});assert.equal(historyReducer(a,p.action),a);assert.ok(pluginEditsApplied(historyReducer(a,{...p.action,agentToken:'property-agent'}),p.action));assert.equal(prepareProjectAction(f.state.present,{type:'preparedPluginClips',token:{}}).project,f.state.present);assert.throws(()=>preparePluginEdits(f.state.present,f.snapshot,f.targets,{...f.tx([f.op('set-opacity','o',{opacity:.3})]),revision:999},grants),/stale/);
});
check('manifest grants, menu scope and the bundled font subset match the actual host',()=>{
 const m={id:'studio.properties',name:'Properties',publisher:'Fixture',version:'0.1.0',apiVersion:1,entry:'commands.js',permissions:grants,contributes:{commands:[{id:'go',name:'Go'}]}};assert.deepEqual(validateManifest(m).permissions,grants);assert.throws(()=>validateManifest({...m,permissions:['clips.properties']}),/requires editor.read/);assert.throws(()=>validateManifest({...m,permissions:['editor.read','clips.properties','markers.write']}),/cannot be mixed/);
 const action={locations:['clip-menu'],permissions:['editor.read','clips.properties'],when:{selection:'single'}};for(const lane of ['video','overlay','text','audio'])assert.equal(actionState(action,'clip-menu',{hasProject:true,selection:[{lane}]}).enabled,true);assert.equal(actionState(action,'clip-menu',{hasProject:true,selection:[{lane:'video',gap:true}]}).visible,false);
 for(const font of PROPERTY_FONTS)assert.ok(FONT_LIST.some(value=>value.id===font),font);
});
check('generated static audio and transform edits match independent algebra',()=>{
 for(const volume of [0,.25,.5,1,2])for(const fade of [0,.25,.5,1])for(const opacity of [0,.25,.75,1])for(const x of [-.5,0,.25]){
  const z=fixture(),r=z.apply([z.op('set-audio','a',{audio:{volume,fadeIn_sec:fade,fadeOut_sec:fade},fadePolicy:'replace-edges'}),z.op('set-opacity','o',{opacity}),z.op('set-transform','v',{transform:{x,scale:.5}})]),p=r.state.present;
  for(const t of [.1,.5,1.5,3.9]){const automation=.5+t/8,gain=volume*automation*(fade?Math.min(1,t/fade):1)*(fade?Math.min(1,(4-t)/fade):1);near(audioGain(p.audioClips[0],t,4),gain);}
  assert.equal(p.overlayClips[0].opacity,opacity);assert.equal(p.videoClips[0].transform.x,x);assert.equal(p.videoClips[0].transform.scale,.5);assert.equal(p.audioClips[0].linkInOff,1);exactUndo(z,r);generated++;
 }
});
console.log(JSON.stringify({ok:true,checks,generated}));
