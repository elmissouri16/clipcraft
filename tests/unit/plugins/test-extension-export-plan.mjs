import assert from 'node:assert/strict';
import {agentExportPlan} from '../../../src/features/export/agentExport.js';
import {emptyProject,exportDuration} from '../../../src/state/store.js';
const project={...emptyProject(),width:320,height:180,fps:12,media:[{id:'image',path:'/virtual/source.png',type:'image'}],videoClips:[{id:'clip',mediaId:'image',in:0,out:60}],textClips:[{id:'caption',caption:true,text:'Late caption',start:40,duration:3}],layerState:{'video:0':{locked:true}}};
const before=JSON.stringify(project),plan=agentExportPlan(project,{range:{start_sec:5,end_sec:45},quality:'low',fps:24});
assert.equal(exportDuration(plan.project),40);assert.equal(plan.project.videoClips[0].in,5);assert.equal(plan.project.videoClips[0].out,45);assert.equal(plan.project.textClips[0].start,35);assert.equal(plan.project.layerState['video:0'].locked,false);assert.equal(plan.effective.outFps,24);assert.equal(JSON.stringify(project),before);
const bitrate=agentExportPlan(project,{bitrate_mbps:1.5});assert.equal(bitrate.effective.mode,'bitrate');assert.equal(bitrate.effective.bitrateMbps,1.5);assert.equal(JSON.stringify(project),before);assert.throws(()=>agentExportPlan(project,{bitrate_mbps:2,crf:18}),/separately/);
assert.throws(()=>agentExportPlan(project,{range:{start_sec:50,end_sec:70}}),/range/);assert.throws(()=>agentExportPlan(project,{range:{start_sec:4,end_sec:3}}),/range/);assert.throws(()=>agentExportPlan(project,{review:true,start_sec:5,end_sec:45}),/30 seconds/);
console.log('Full-length extension section snapshots preserve document locks/preferences and correctly shift captions beyond the review limit');
