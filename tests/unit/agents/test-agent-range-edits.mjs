import assert from 'node:assert/strict';
import { emptyProject, historyReducer, cutRanges, videoLayout, exportDuration } from "../../../src/state/store.js";
const base=()=>({...emptyProject(),id:'range-test',media:[{id:'m',type:'video',hasAudio:true,duration:30}],
  videoClips:[{id:'v',mediaId:'m',in:0,out:10,speed:1}]});
const state=p=>({past:[],future:[],present:p});
const cut=(p,ranges,ripple=true)=>historyReducer(state(p),{type:'cutRanges',ranges,ripple}).present;
{
 let p=cut(base(),[{start:3,end:5}]);p=cut(p,[{start:1,end:2}]);
 assert.equal(new Set(p.videoClips.map(c=>c.id)).size,p.videoClips.length,'repeated cuts never duplicate IDs');
 const id=p.videoClips[1].id;
 const deleted=historyReducer(state(p),{type:'delete',track:'video',id}).present;
 assert.equal(deleted.videoClips.length,p.videoClips.length-1,'ID-targeted delete removes only one piece');
 assert.equal(exportDuration(p),7);
}
{
 const p=base();p.videoClips[0]={...p.videoClips[0],muted:true,linkId:'pair',keyframes:{scale:[{t:2,v:1},{t:8,v:2}]},anim:{in:{type:'fade_in'},out:{type:'fade_out'}}};
 p.audioClips=[{id:'a',mediaId:'m',start:0,in:0,out:10,speed:1,volume:1,linkId:'pair',linkOff:0,linkInOff:0}];
 const next=cut(p,[{start:3,end:5}]);assert.equal(next.audioClips.length,2);
 next.videoClips.forEach((c,i)=>{const audio=next.audioClips.find(a=>a.linkId===c.linkId);assert.ok(audio);assert.equal(audio.in,c.in);assert.equal(audio.out,c.out);assert.equal(audio.start,videoLayout(next.videoClips)[i].start);assert.deepEqual(c.keyframes,p.videoClips[0].keyframes);});
 assert.notEqual(next.videoClips[0].linkId,next.videoClips[1].linkId);
 assert.ok(next.videoClips[0].anim.in);assert.equal(next.videoClips[0].anim.out,undefined);assert.equal(next.videoClips[1].anim.in,undefined);assert.ok(next.videoClips[1].anim.out);
 p.layerState={'audio:0':{locked:true}};assert.equal(cut(p,[{start:3,end:5}]),p,'locked linked audio rejects the entire edit');
}
{
 const p=base();p.textClips=[{id:'cap',caption:true,text:'one two three',start:2,duration:6,words:[{text:'one',start:0,end:1},{text:'two',start:2,end:3},{text:'three',start:4,end:5}]}];
 p.overlayClips=[{id:'o',mediaId:'m',start:5,in:10,out:16,speed:2}];p.effectClips=[{id:'fx',fx:'blur',start:6,duration:1}];p.markers=[{id:'before',time:1},{id:'inside',time:3},{id:'after',time:7}];
 const next=cut(p,[{start:3,end:5}]);assert.deepEqual(next.textClips.map(c=>[c.start,c.duration,c.text]),[[2,1,'one'],[3,3,'three']]);
 assert.equal(next.overlayClips[0].start,3);assert.equal(next.overlayClips[0].in,10);assert.equal(next.overlayClips[0].out,16);assert.equal(next.effectClips[0].start,4);assert.deepEqual(next.markers.map(m=>[m.id,m.time]),[['before',1],['after',5]]);
 const manual=cutRanges(p,[{start:3,end:5}]);assert.equal(manual.textClips[0],p.textClips[0]);assert.equal(manual.overlayClips[0],p.overlayClips[0]);
 p.layerState={'text:0':{locked:true}};assert.equal(cut(p,[{start:3,end:5}]),p,'locked caption ripple is atomic');
}
{
 const p=base();p.videoClips.push({id:'w',mediaId:'m',in:10,out:20,speed:1,transition:{type:'fade',duration:2}});
 const next=cut(p,[{start:8,end:9}]);assert.equal(exportDuration(next),17,'cut during an overlap removes exactly the requested timeline interval');
 assert.deepEqual(videoLayout(next.videoClips).map(l=>[l.start,l.end]),[[0,8],[8,9],[8,17]]);
 const double=cut(p,[{start:3,end:4},{start:8,end:9}]);assert.equal(exportDuration(double),16);
 assert.deepEqual(p.videoClips[1].transition,{type:'fade',duration:2},'range planning never mutates the original');
}
{
 const p=base();assert.equal(cutRanges(p,[{start:8,end:2}],{ripple:true}),p);assert.equal(cutRanges(p,[{start:NaN,end:2}],{ripple:true}),p);
 const next=cut(p,[{start:1,end:4},{start:2,end:5}]);assert.equal(exportDuration(next),6,'overlapping ranges are merged');
}
{
 let s={past:Array.from({length:100},()=>base()),future:[],present:base()};const original=s.present;
 s=historyReducer(s,{type:'beginAgentEdit',token:'one'});
 s=historyReducer(s,{type:'setProject',patch:{name:'first'},agentToken:'one'});
 s=historyReducer(s,{type:'setProject',patch:{name:'second'},agentToken:'one'});
 assert.equal(s.past.length,100);assert.equal(s.agentEdit.steps.length,2);
 s=historyReducer(s,{type:'undoAgentEdit',token:'one'});assert.equal(s.present.name,'first');
 s=historyReducer(s,{type:'endAgentEdit',token:'one'});assert.equal(s.agentEdit,undefined);assert.equal(s.past.length,100);
 s=historyReducer(s,{type:'undo'});assert.equal(s.present.name,original.name,'one Undo restores the request at full history capacity');
}
{
 let s=state(base());s=historyReducer(s,{type:'beginAgentEdit',token:'one'});
 s=historyReducer(s,{type:'setProject',patch:{name:'agent'},agentToken:'one'});
 s=historyReducer(s,{type:'setProject',patch:{background:'#ff0000'}});assert.equal(s.agentEdit,undefined);
 const before=s;s=historyReducer(s,{type:'setProject',patch:{name:'late agent'},agentToken:'one'});assert.equal(s,before,'manual document edit revokes stale agent writes');
 s=historyReducer(s,{type:'undo'});assert.equal(s.present.name,'agent');assert.equal(s.present.background,'#000000');
 s=historyReducer(s,{type:'undo'});assert.equal(s.present.name,base().name,'manual edits retain their own Undo step');
}
{
 let s=state(base());s=historyReducer(s,{type:'beginAgentEdit',token:'one'});
 s=historyReducer(s,{type:'setProject',patch:{name:'agent'},agentToken:'one'});
 s=historyReducer(s,{type:'craftChat',projectId:'range-test',chat:{saved:true}});
 s=historyReducer(s,{type:'setLayerState',track:'video',layer:0,patch:{locked:true}});
 s=historyReducer(s,{type:'undoAgentEdit',token:'one'});assert.equal(s.present.craftAI.saved,true);assert.equal(s.present.layerState['video:0'].locked,true);
 s=historyReducer(s,{type:'endAgentEdit',token:'one'});assert.equal(s.past.length,0,'a fully undone request creates no checkpoint');
}
console.log('agent range edits ok (IDs, linked pairs, ripple, locks, source keys, transition duration, transaction ownership and capacity)');
