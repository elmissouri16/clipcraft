import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { emptyProject, historyReducer, prepareProjectAction } from '../../../src/state/store.js';
import { projectRevision } from '../../../src/features/agent/context.js';
import { createTextFrameState } from '../../../src/features/text/frameState.js';
import { exportRenderPlan } from '../../../src/features/export/renderPlan.js';
import { resolveExport } from '../../../src/features/export/exportQuality.js';
import { timelineViewport, intersectsViewport, filmstripTiles, timelineClipBox, boxesIntersect } from '../../../src/features/timeline/viewport.js';
const require=createRequire(import.meta.url);
const {disableGpuVideo}=require('../../../electron/system/videoPolicy.cjs');
const {buildExportArgs}=require('../../../electron/media/ffmpeg.cjs');
{
 const view=timelineViewport(6000,1000,60);assert.equal(intersectsViewport(0,1,view),false);assert.equal(intersectsViewport(100,1,view),true);
 const tiles=filmstripTiles(60000,80,0,60,view);assert.ok(tiles.first>0);assert.ok(tiles.end-tiles.first<30);
 const lane={left:-5808,top:100,bottom:180};const box=timelineClipBox(lane,100,1,60,0);
 assert.equal(box.left,192);assert.equal(box.top,122);assert.equal(box.bottom,152);
 assert.equal(boxesIntersect(box,{left:180,right:260,top:120,bottom:155}),true);
}
assert.equal(disableGpuVideo('darwin',{}),false);assert.equal(disableGpuVideo('win32',{}),true);
assert.equal(disableGpuVideo('darwin',{FVE_GPU_VIDEO:'0'}),true);assert.equal(disableGpuVideo('win32',{FVE_GPU_VIDEO:'1'}),false);
const base=()=>({...emptyProject(),videoClips:[{id:'gap',gap:true,in:0,out:10,speed:1}],textClips:[{id:'title',text:'Title',start:0,duration:6,layer:0}]});
{
 let state={past:[],present:base(),future:[]};const before=state.present;
 const prepared=prepareProjectAction(before,{type:'update',track:'text',id:'title',patch:{color:'#ff0000'}});
 state=historyReducer(state,prepared.action);assert.equal(state.present,prepared.project);assert.equal(state.past[0],before);
 state=historyReducer(state,{type:'undo'});assert.deepEqual(state.present,before);
 const manual=historyReducer(state,{type:'setProject',patch:{name:'Manual edit'}});
 const stale=historyReducer(manual,prepared.action);assert.equal(stale.present.name,'Manual edit');assert.equal(stale.present.textClips[0].color,'#ff0000');
 const locked={...state,present:{...state.present,layerState:{'text:0':{locked:true}}}};
 assert.equal(historyReducer(locked,prepared.action),locked);
 const fake=historyReducer(state,{...prepared.action,preparedAction:{},patch:{color:'#00ff00'}});
 assert.equal(fake.present.textClips[0].color,'#00ff00','forged token follows normal reducer behavior');
 const owner=historyReducer(state,{type:'beginAgentEdit',token:'owner'});
 const ownedPlan=prepareProjectAction(owner.present,{type:'update',track:'text',id:'title',patch:{color:'#ff0000'}});
 const owned=historyReducer(owner,{...ownedPlan.action,agentToken:'owner'});
 assert.equal(owned.present,ownedPlan.project);assert.equal(owned.agentEdit.steps.length,1);
 assert.equal(historyReducer(owner,{...prepared.action,agentToken:'stale'}),owner);
 assert.equal(projectRevision(owned.present),projectRevision({...owned.present}));
 const mutable=base();const revision=projectRevision(mutable);mutable.name='Changed plain input';assert.notEqual(projectRevision(mutable),revision);
}
// The indexed placement must retain the old first-fitting-layer semantics for
// explicit, inferred, overlapping, adjacent and fractional boundaries.
let seed=1234;const random=()=>((seed=(seed*1664525+1013904223)>>>0)/2**32);
for(let trial=0;trial<30;trial++){
 const p=base();p.textClips=Array.from({length:100},(_,i)=>({id:'t'+i,text:'word',start:Math.floor(random()*100)/10,duration:.1+Math.floor(random()*20)/10,...(random()<.65?{layer:Math.floor(random()*4)}:{})}));
 const placed=[],expected=new Map();
 for(const c of [...p.textClips].sort((a,b)=>(a.layer===undefined)-(b.layer===undefined)||a.start-b.start)){
  let l=c.layer??0;while((placed[l]||[]).some(r=>r.start<c.start+c.duration-1e-6&&c.start<r.end-1e-6))l++;
  (placed[l]||=[]).push({start:c.start,end:c.start+c.duration});expected.set(c.id,l);
 }
 const q=historyReducer({past:[],present:emptyProject(),future:[]},{type:'load',project:p}).present;
 q.textClips.forEach(c=>assert.equal(c.layer,expected.get(c.id)));
}
{
 const p=base(),at=createTextFrameState(p);
 assert.notEqual(at(.05).key,at(.1).key,'entrance animation remains live');
 assert.equal(at(1).key,at(2).key,'static hold reuses a frame');
 assert.notEqual(at(5.8).key,at(5.9).key,'exit animation remains live');
 assert.equal(at(6).blank,true);assert.equal(at(2).blank,false,'backward seek rebuilds active clips');
 const word={...p,textClips:[{...p.textClips[0],highlight:{mode:'box'},words:[{text:'A',start:0,end:3},{text:'B',start:3,end:6}],text:'A B'}]};
 const words=createTextFrameState(word);assert.equal(words(1).key,words(2).key);assert.notEqual(words(2).key,words(4).key);
 word.textClips[0]={...word.textClips[0],highlight:{mode:'karaoke'}};const karaoke=createTextFrameState(word);assert.notEqual(karaoke(1).key,karaoke(2).key);
 // The reveal/single highlights pop each word in over 0.15 s / 0.12 s: live frames then, a reused frame after.
 for(const [mode,pop] of [['reveal',.15],['single',.12]]){word.textClips[0]={...word.textClips[0],highlight:{mode}};const at=createTextFrameState(word);
  assert.notEqual(at(3+pop/3).key,at(3+pop*2/3).key,`${mode}: the word pop is drawn frame by frame`);assert.equal(at(3+pop+.01).key,at(5).key,`${mode}: the settled word reuses its frame`);
  assert.notEqual(at(.02).key,at(.05).key,`${mode}: the first word pops too`);}
 const effects=createTextFrameState(p,[[1,2]]);assert.notEqual(effects(1.1).key,effects(1.2).key);
}
{
 const p={...base(),width:1920,height:1080,fps:60};const effective={outW:640,outH:360,outFps:24,codecFamily:'h264',crf:20};
 const plan=exportRenderPlan(p,effective);assert.equal(plan.width,1920);assert.equal(plan.textClips,p.textClips);assert.deepEqual(plan.renderSize,{width:640,height:360,fps:24});
 const up=exportRenderPlan({...p,fps:24},{...effective,outFps:60});assert.equal(up.renderSize.fps,24);
 const graph=buildExportArgs(plan,'/tmp/unused.mp4',{encoder:'libx264'}).args.join(' ');
 assert.ok(graph.includes('s=640x360:r=24'));assert.ok(!graph.includes('s=1920x1080:r=60'));
 const apple=buildExportArgs(plan,'/tmp/unused.mp4',{encoder:'h264_videotoolbox'}).args;
 assert.ok(apple.includes('h264_videotoolbox'));assert.ok(apple.includes('-allow_sw'));assert.ok(!apple.includes('-crf'));
 const h265=resolveExport({...p,exportSettings:{preset:'custom',custom:{codec:'h265'}}},{libx265:false,h265Hardware:true});assert.equal(h265.codecFamily,'h265');assert.match(h265.codecLabel,/VideoToolbox/);
}
console.log('performance contracts passed: platform policy, prepared/stale/locked/owned edits, indexed placement, revision identity, text cache boundaries and early export size/FPS');
