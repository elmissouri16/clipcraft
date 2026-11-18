// Regressions from the 2026-11-18 plugin API review in the document read/edit contracts.
// Usage: node tests/unit/plugins/test-extension-edit-regressions.mjs
import assert from 'node:assert/strict';
import {emptyProject,historyReducer,preparePluginEdits,projectDuration} from '../../../src/state/store.js';
import {createEditorContext} from '../../../src/features/plugins/editorContext.js';
import {captionWrite,mediaInsertion} from '../../../src/features/plugins/extensionOperations.js';
import {ExtensionDraft,extensionEditPermissions as permissions} from '../../../src/features/plugins/extensionDraft.js';
import {clipTransaction} from '../../../shared/pluginEdits.mjs';
import {EFFECTS,FILTERS} from '../../../src/features/effects/effects.js';

const checks=[],check=name=>{checks.push(name);console.log('PASS',name);};
const load=extra=>historyReducer({past:[],present:emptyProject(),future:[]},{type:'load',project:{...emptyProject(),...extra}});
const media=[{id:'m1',type:'video',duration:60,hasAudio:true,width:1920,height:1080,path:'/x.mp4'},{id:'a1',type:'audio',duration:30,path:'/a.mp3'}];
function fixture(extra){
 const state=load(extra),read=createEditorContext(),snapshot=read(state.present,null,{time_sec:0,playing:false}),targets=read.targets(snapshot);
 const handle=id=>targets.find(target=>target.id===id).handle,plan=operations=>preparePluginEdits(state.present,snapshot,targets,clipTransaction({documentId:snapshot.documentId,revision:snapshot.revision,operations},snapshot,projectDuration(state.present),permissions),permissions);
 return {state,read,snapshot,handle,plan,apply:operations=>{const prepared=plan(operations);return prepared.action?historyReducer(state,prepared.action).present:state.present;}};
}

// --- a write captured before the playhead or selection moved is still current
{
 const state=load({media,videoClips:[{id:'g',gap:true,in:0,out:20,speed:1}],textClips:[{id:'T',text:'hi',start:1,duration:2,layer:0}]}),project=state.present,read=createEditorContext();
 const first=read(project,null,{time_sec:1,playing:true}),clip=first.timeline.clips.find(entry=>entry.trackId==='text:0').id;
 const transaction={documentId:first.documentId,revision:first.revision,operations:[{type:'move',clipId:clip,start_sec:5}]};
 const later=read(project,{track:'text',id:'T'},{time_sec:1.4,playing:true});
 assert.ok(later.revision>first.revision);assert.throws(()=>clipTransaction(transaction,later,20,permissions),/stale/);
 const rebased=read.rebase(transaction,later);assert.equal(rebased.revision,later.revision);clipTransaction(rebased,later,20,permissions);
 const cues={documentId:first.documentId,revision:first.revision,mode:'append',cues:[{text:'x',start_sec:10,end_sec:11}]};
 assert.equal(captionWrite(project,later,read.rebase(cues,later),'test',read.scope()).ids.length,1);
 check('playback and selection changes do not make a captured edit stale');
 const edited=historyReducer(state,{type:'update',track:'text',id:'T',patch:{text:'changed'}}).present,after=read(edited,null,{time_sec:1.4,playing:true});
 assert.notEqual(edited,project);assert.equal(read.rebase(transaction,after),transaction);assert.throws(()=>clipTransaction(read.rebase(transaction,after),after,20,permissions),/stale/);
 assert.equal(read.rebase({...transaction,documentId:'d-other'},after).revision,transaction.revision);
 check('a document change still makes an earlier revision stale');
}

// --- caption cues never spill onto other tracks
{
 const project=load({media,videoClips:[{id:'g',gap:true,in:0,out:20,speed:1}],layers:{text:2},layerState:{'text:1':{locked:true}},textClips:[{id:'title',text:'Title',start:1,duration:2,layer:0}]}).present,read=createEditorContext(),snapshot=read(project,null,{time_sec:0,playing:false});
 const write=(mode,cues,extra={})=>captionWrite(project,snapshot,{documentId:snapshot.documentId,revision:snapshot.revision,mode,cues,...extra},'test',read.scope());
 assert.throws(()=>write('append',[{text:'a',start_sec:5,end_sec:7.001},{text:'b',start_sec:7,end_sec:9}]),/Caption cues overlap each other/);
 assert.throws(()=>write('append',[{text:'a',start_sec:0,end_sec:2}]),/overlaps a clip already on this track/);
 assert.throws(()=>write('create-track',[{text:'a',start_sec:0,end_sec:2.5},{text:'b',start_sec:2,end_sec:4}],{newTrack:{name:'Subtitles',hidden:true}}),/Caption cues overlap each other/);
 assert.equal(write('append',[{text:'a',start_sec:5,end_sec:7},{text:'b',start_sec:7,end_sec:9}]).ids.length,2);
 check('overlapping caption cues are refused instead of being moved to other tracks');
}

// --- an inserted clip lands on the requested track or not at all
{
 const item={id:'new-v',type:'video',duration:5,width:1280,height:720,hasAudio:false,hasVideo:true,path:'/tmp/new.mp4',name:'new'},sound={id:'new-a',type:'audio',duration:5,path:'/tmp/new.mp3',name:'new'};
 const main=[{id:'A',mediaId:'m1',in:0,out:20,speed:1}];
 const insert=(extra,input)=>{const draft=new ExtensionDraft(load(extra));draft.read('editor.read');try{return {value:draft.write('media.insert',input,'test'),project:draft.project};}catch(error){return {error:error.message,project:draft.project};}};
 let result=insert({media,videoClips:main,layers:{overlay:2},layerState:{'overlay:1':{locked:true}},overlayClips:[{id:'O',mediaId:'m1',in:0,out:6,speed:1,start:0,layer:0}]},{item,id:'new-v',lane:'overlay',trackId:'overlay:0',start_sec:2});
 assert.match(result.error,/track is occupied/);assert.equal(result.project.overlayClips.length,1);
 result=insert({media,videoClips:main,layers:{audio:2},layerState:{'audio:1':{locked:true}},audioClips:[{id:'S',mediaId:'a1',in:0,out:8,speed:1,start:3,layer:0}]},{item:sound,id:'new-a',lane:'audio',trackId:'audio:0',start_sec:0});
 assert.match(result.error,/track is occupied/);assert.deepEqual(result.project.audioClips.map(clip=>[clip.id,clip.layer||0]),[['S',0]]);
 check('media.insert refuses a placement that would bump a clip to another, possibly locked, track');
 result=insert({media,videoClips:main,layers:{overlay:2}},{item,id:'new-v',trackId:'overlay:1',start_sec:2});
 assert.equal(result.value.lane,'overlay');assert.equal(result.project.overlayClips[0].layer,1);
 check('media.insert takes its lane from the named track');
}

// --- clip transactions
{
 let f=fixture({media,videoClips:[{id:'A',mediaId:'m1',in:0,out:20,speed:1}],audioClips:[{id:'S',mediaId:'a1',in:0,out:8,speed:1,start:0.30000000000000004,layer:0}]});
 assert.equal(f.apply([{type:'trim',clipId:f.handle('S'),start_sec:0.3,end_sec:3}]).audioClips[0].in,0);
 check('a frame-snapped trim start within tolerance of the clip start is accepted');

 f=fixture({media,videoClips:[{id:'A',mediaId:'m1',in:0,out:10,speed:1}],effectClips:[{id:'E1',fx:EFFECTS[0].id,start:0,duration:3},{id:'E2',fx:EFFECTS[1].id,start:1,duration:3}]});
 assert.equal(f.apply([{type:'trim',clipId:f.handle('E1'),start_sec:0,end_sec:2.5}]).effectClips.find(clip=>clip.id==='E1').duration,2.5);
 assert.equal(f.apply([{type:'create-effect',sourceClipId:f.handle('E1'),trackId:'effect:0',start_sec:1.5,duration_sec:1}]).effectClips.length,3);
 check('effects on the Effects track may overlap, as they do in the editor');

 const look=FILTERS.find(filter=>filter.id!=='none').id;
 f=fixture({media,videoClips:[{id:'A',mediaId:'m1',in:0,out:10,speed:1}],effectClips:[{id:'L',fx:'filter:'+look,start:0,duration:3},{id:'U',fx:'filter:lut:Teal Orange.cube',start:4,duration:3}]});
 assert.throws(()=>f.plan([{type:'attach-effect',clipId:f.handle('A'),partnerClipId:null,sourceClipId:f.handle('L'),beforeIndex:0,strength:1,params:{}}]),/filter look applies as an Effects-track layer/);
 assert.equal(f.apply([{type:'set-effect',clipId:f.handle('U'),partnerClipId:null,effectIndex:null,enabled:true,strength:.5,params:{}}]).effectClips.find(clip=>clip.id==='U').strength,.5);
 check('a filter look cannot be attached to one clip, and a LUT filter layer accepts set-effect');

 // A split upstream of a linked picture/audio pair: the pair's recomputed start differs from the
 // stored one by a rounding step, which is not a move of the pair.
 let accepted=0,rejected=[];
 for(let frame=10;frame<280;frame+=3){
  f=fixture({media,videoClips:[{id:'Z',mediaId:'m1',in:0,out:3.7,speed:1},{id:'A',mediaId:'m1',in:2.4,out:17.4,speed:1.5},{id:'B',mediaId:'m1',in:0,out:5,speed:1,linkId:'L1'}],audioClips:[{id:'Ba',mediaId:'m1',in:0,out:5,speed:1,start:13.700000000000001,layer:0,linkId:'L1'}]});
  const at=3.7+frame/30;
  try{f.plan([{type:'split',clipId:f.handle('A'),at_sec:at,gaps:'preserve-time',transitions:'reject'}]);accepted++;}catch(error){rejected.push(error.message);}
 }
 assert.ok(accepted>=85,`${accepted} accepted; ${[...new Set(rejected)].join(' / ')}`);assert.ok(rejected.every(message=>!/collateral/.test(message)),[...new Set(rejected)].join(' / '));
 check('splitting a main clip upstream of a linked pair is not rejected for rounding');
}
console.log(`EXTENSION EDIT REGRESSIONS OK (${checks.length} checks)`);
