import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {createRequire} from 'node:module';import {spawnSync} from 'node:child_process';
import {gifPlan,gifProjectSnapshot} from '../../../shared/pluginGif.mjs';
import {validateManifest} from '../../../shared/pluginManifest.mjs';
const require=createRequire(import.meta.url),{createGifExporter,destination}=require('../../../electron/export/pluginGif.cjs'),{ffmpegPath}=require('../../../electron/media/ffmpeg.cjs');
let checks=0;const check=(name,fn)=>{fn();checks++;console.log('PASS',name);};
const geometry={width:1920,height:1080,duration_sec:30},defaults=gifPlan(geometry,{});
check('defaults bound duration, geometry and exact timing',()=>assert.deepEqual(defaults,{start_sec:0,end_sec:5,width:480,height:270,fps:10,frame_count:50,duration_sec:5}));
check('portrait preserves aspect with pixel rounding',()=>assert.deepEqual([gifPlan({width:1080,height:1920,duration_sec:2},{}).width,gifPlan({width:1080,height:1920,duration_sec:2},{}).height],[270,480]));
check('no upscaling and fractional range rounds to a full frame',()=>assert.deepEqual(gifPlan({width:32,height:18,duration_sec:2},{start_sec:0.01,end_sec:0.12}).duration_sec,0.2));
for(const input of [{start_sec:-1},{start_sec:30},{end_sec:31},{end_sec:16},{fps:'fps-24'},{max_size:'size-4000'},{file:'/tmp/out.gif'},{start_sec:NaN},{end_sec:Infinity}])check('unsafe or unbounded recipe rejected',()=>assert.throws(()=>gifPlan(geometry,input)));
const manifest=JSON.parse(fs.readFileSync(new URL('../../../examples/plugins/gif-export/plugin.json',import.meta.url)));
check('example passes manifest validation',()=>assert.deepEqual(validateManifest(manifest).permissions,['export.gif']));
for(const permission of ['markers.write','captions.read','ai.chapters'])check('export permission cannot be mixed with editing or AI',()=>assert.throws(()=>validateManifest({...manifest,permissions:['export.gif',permission]})));
check('GIF commands require bounded standard controls',()=>{const m=structuredClone(manifest);m.contributes.commands[0].parameters[0].max=1e9;assert.throws(()=>validateManifest(m));});
check('composition snapshot excludes conversation and playback proxies',()=>{const snap=gifProjectSnapshot({craftAI:{secret:'x'},posterImage:'x',media:[{id:'a',path:'/source',proxy:'/proxy',poster:'data',proxies:{full:'x'}}]});assert.equal(snap.craftAI,undefined);assert.deepEqual(snap.media,[{id:'a',path:'/source'}]);});
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'clipcraft-gif-unit-'));
try{
 const red=path.join(dir,'red.png'),blue=path.join(dir,'blue.png');
 for(const [file,color] of [[red,'red'],[blue,'blue']]){const encoded=spawnSync(ffmpegPath,['-v','error','-f','lavfi','-i',`color=${color}:s=32x18`,'-frames:v','1','-threads','1',file]);assert.equal(encoded.status,0,String(encoded.stderr));}
 const frames=[fs.readFileSync(red),fs.readFileSync(blue)];
 const plan=gifPlan({width:32,height:18,duration_sec:2},{end_sec:0.2}),project={media:[],videoClips:[],overlayClips:[]};
 let chosen=path.join(dir,'out.gif'),closed=0;
 const exporter=createGifExporter({dialog:{showSaveDialog:async()=>({filePath:chosen})},getWindow:()=>null,createFrames:()=>({frame:async i=>frames[i%2],close:()=>closed++})});
 const execute=extra=>exporter.run({project,plan,signal:new AbortController().signal,...extra});
 const artifact=await execute();check('real encoded GIF is fully verified before artifact return',()=>{assert.equal(artifact.path,fs.realpathSync(chosen));assert.equal(artifact.frame_count,2);assert.equal(artifact.duration_sec,0.2);assert.ok(artifact.bytes>0);assert.equal(closed,1);});
 const original=fs.readFileSync(chosen);await assert.rejects(execute(),/already exists/);checks++;assert.deepEqual(fs.readFileSync(chosen),original);
 check('existing symlinks are protected',()=>{fs.symlinkSync(chosen,path.join(dir,'alias.gif'));assert.throws(()=>destination(path.join(dir,'alias.gif')),/already exists/);});
 chosen=path.join(dir,'cancel.gif');const controller=new AbortController();await assert.rejects(execute({signal:controller.signal,onProgress:p=>{if(p>0)controller.abort();}}));check('cancellation leaves no output or temporary output directories',()=>{assert.ok(!fs.existsSync(chosen));assert.ok(!fs.readdirSync(dir).some(f=>f.startsWith('.clipcraft-gif-')));assert.equal(exporter.busy,false);});
 chosen=path.join(dir,'race.gif');await assert.rejects(execute({verify:async()=>fs.writeFileSync(chosen,'keep')}),/EEXIST/);check('destination publication race preserves the competing file',()=>assert.equal(fs.readFileSync(chosen,'utf8'),'keep'));
 chosen=path.join(dir,'revoked.gif');await assert.rejects(execute({verify:async()=>{throw Error('revoked');}}),/revoked/);check('revocation before publication produces no artifact',()=>assert.ok(!fs.existsSync(chosen)));
 chosen=path.join(dir,'source-change.gif');const sourceProject={...project,media:[{id:'red',path:red,type:'image'}],videoClips:[{mediaId:'red'}]};await assert.rejects(execute({project:sourceProject,verify:async()=>fs.appendFileSync(red,'changed')}),/source file changed/);check('source changes prevent publication',()=>assert.ok(!fs.existsSync(chosen)));
 console.log(JSON.stringify({ok:true,checks}));
}finally{fs.rmSync(dir,{recursive:true,force:true});}
