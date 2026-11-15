import assert from 'node:assert/strict';
import {editorSnapshot,editorChanges,EDITOR_LIMITS} from '../../../shared/pluginEditor.mjs';
import {createEditorContext} from '../../../src/features/plugins/editorContext.js';
import {emptyProject,videoLayout} from '../../../src/state/store.js';
import {validateManifest} from '../../../shared/pluginManifest.mjs';
let checks=0;const check=(name,fn)=>{fn();checks++;console.log('PASS',name);};
const project={...emptyProject(),id:'/private/project',name:'private name',media:[{id:'secret-media',path:'/private/movie.mp4'}],
 videoClips:[{id:'/private/raw-clip',mediaId:'secret-media',in:2,out:6},{id:'second',in:0,out:4,transition:{type:'fade',duration:1}}],
 textClips:[{id:'caption-secret',start:1,duration:2,text:'private caption',layer:2}],
 audioClips:[{id:'audio',start:2,in:0,out:6,speed:2,layer:1}],
 effectClips:[{id:'fx',start:1,duration:3,fx:{expression:'private expression'}}],
 layerNames:{text:{2:'private track name'}},layerState:{'text:2':{locked:true,hidden:true}},craftAI:{secret:'private conversation'}};
const read=createEditorContext(),head={time_sec:2,playing:false},selection={items:[{track:'video',id:'second'},{track:'text',id:'caption-secret'}]};
const initial=read(project,selection,head);
check('snapshot passes the canonical native schema',()=>assert.deepEqual(editorSnapshot(initial),initial));
check('projection excludes content and internal identifiers',()=>{const s=JSON.stringify(initial);for(const secret of ['/private','secret','private','mediaId','expression','caption'])assert.equal(s.includes(secret),false);});
check('selection references returned opaque clips and layers',()=>{assert.equal(initial.selection.total,2);assert.equal(initial.selection.clipIds.length,2);assert.equal(initial.timeline.tracks.find(t=>t.id==='text:2').locked,true);});
check('timing follows transition overlap and audio speed',()=>{assert.equal(initial.timeline.clips[0].start_sec,videoLayout(project.videoClips)[1].start);assert.equal(initial.timeline.clips.find(c=>c.trackId==='audio:1').end_sec,5);});
check('unchanged sampling preserves object and revision',()=>assert.equal(read(project,selection,head),initial));
const playing=read(project,selection,{time_sec:2.5,playing:true});
check('playhead sampling reuses projected timeline and reports playback only',()=>{assert.equal(playing.timeline,initial.timeline);assert.deepEqual(editorChanges(initial,playing),['playhead']);assert.equal(playing.revision,2);});
const edited={...project,textClips:project.textClips.map(c=>({...c,start:3,text:'changed private caption'}))};
const moved=read(edited,selection,head);
check('ordinary edits preserve handles and document scope',()=>{assert.deepEqual(moved.selection.clipIds,initial.selection.clipIds);assert.equal(moved.documentId,initial.documentId);assert.ok(editorChanges(playing,moved).includes('timeline'));});
const undone=read(project,selection,head);
check('Undo restores projected timing with stable handles',()=>assert.deepEqual(undone.timeline,initial.timeline));
check('reopening the same project creates a fresh document scope',()=>assert.notEqual(createEditorContext()(project,selection,head).documentId,initial.documentId));
const huge={...emptyProject(),textClips:Array.from({length:400},(_,i)=>({id:`private-${i}`,start:i,duration:1,layer:i}))};
const bounded=createEditorContext()(huge,{items:huge.textClips.slice(-100).map(c=>({track:'text',id:c.id}))},head);
check('large timelines and selection have explicit independent limits',()=>{assert.equal(bounded.timeline.clips_total,400);assert.equal(bounded.timeline.tracks_total,404);assert.equal(bounded.timeline.tracks.length,EDITOR_LIMITS.tracks);assert.equal(bounded.selection.total,100);assert.equal(bounded.selection.clipIds.length,64);assert.ok(bounded.timeline.clips.length<=256);assert.deepEqual(editorSnapshot(bounded),bounded);});
check('selection beyond normal timeline slice takes priority',()=>assert.equal(bounded.timeline.clips[0].start_sec,300));
check('empty selection and stale references are omitted',()=>assert.deepEqual(read(project,{track:'video',id:'deleted'},head).selection,{clipIds:[],total:0}));
for(const edit of [s=>s.path='/secret',s=>s.version=2,s=>s.revision=0,s=>s.documentId='/secret',s=>s.playhead.time_sec=NaN,s=>s.timeline.clips[0].mediaId='secret',s=>s.timeline.clips[0].trackId='unknown',s=>s.timeline.clips[0].end_sec=-1,s=>s.timeline.tracks[0].name='secret',s=>s.selection.clipIds.push('c-999999'),s=>s.timeline.clips_total=0,s=>s.selection.total=1e7,s=>s.timeline.tracks.push(s.timeline.tracks[0])]){
 const changed=structuredClone(initial);edit(changed);check('invalid or sensitive native payload is rejected',()=>assert.throws(()=>editorSnapshot(changed)));
}
const manifest={id:'studio.context',name:'Context',publisher:'Studio',version:'1.0.0',apiVersion:1,entry:'commands.js',permissions:['editor.read'],contributes:{commands:[{id:'read',name:'Read'}],panels:[{id:'main',name:'Context',entry:'panel.html',permissions:['editor.read'],commands:['read']}]}};
check('new permission is valid independently for panels and commands',()=>assert.deepEqual(validateManifest(manifest).permissions,['editor.read']));
check('unknown permissions remain rejected',()=>assert.throws(()=>validateManifest({...manifest,permissions:['editor.write']})));
console.log(JSON.stringify({ok:true,checks}));
