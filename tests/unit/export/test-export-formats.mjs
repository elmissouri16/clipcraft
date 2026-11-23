import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import formats from '../../../shared/exportFormats.cjs';
import ff from '../../../electron/media/ffmpeg.cjs';
import {exportInput} from '../../../electron/plugins/extensionExports.cjs';
import {createEditorExportTarget} from '../../../electron/agents/editorExport.cjs';
import {agentExportPlan} from '../../../src/features/export/agentExport.js';
import {settingsPatch,storedExportSettings,resolveExport} from '../../../src/features/export/exportQuality.js';
import {emptyProject} from '../../../src/state/store.js';
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'clipcraft-export-formats-')),source=path.join(directory,'source.mp4'),checks=[],outputs=[];
execFileSync(ff.ffmpegPath,['-v','error','-y','-f','lavfi','-i','testsrc2=s=160x96:r=24:d=1','-f','lavfi','-i','sine=frequency=440:duration=1','-c:v','libx264','-preset','ultrafast','-c:a','aac','-shortest',source]);
const project={...emptyProject(),width:160,height:96,fps:24,media:[{...await ff.probe(source),id:'media',path:source}],videoClips:[{id:'clip',mediaId:'media',in:0,out:1}]},before=JSON.stringify(project);
for(const [format,codec,mode] of [['mp4','h264'],['mov','h264'],['mkv','h264'],['webm','vp9'],['mov','h265'],['mkv','h265'],['mkv','vp9'],['webm','vp9','bitrate']]){
 const file=path.join(directory,format+'-'+codec+(mode?'-'+mode:'')+'.'+format),input=exportInput({file_path:file,codec,encoder_preset:'ultrafast',...(mode==='bitrate'?{bitrate_mbps:1.5}:{crf:20})}),plan=agentExportPlan(project,input),target=createEditorExportTarget({...input,requestId:'format-test'},{outputDir:directory});assert.equal(input.format,format);assert.equal(plan.effective.format,format);assert.equal(plan.effective.codecFamily,codec);
 const args=ff.buildExportArgs({...plan.project,export:plan.effective},file).args;assert.equal(args[args.lastIndexOf('-f')+1],formats.videoFormat(format).muxer);assert.equal(args.includes('-movflags'),['mp4','mov'].includes(format));
 await ff.runExport({...plan.project,export:plan.effective},file,()=>{},{noOverwrite:true}).promise;
 const probe=await ff.probe(file),raw=JSON.parse(execFileSync(ff.ffprobePath,['-v','error','-show_format','-show_streams','-of','json',file])),bytes=fs.readFileSync(file);assert.equal(probe.vcodec,codec==='h265'?'hevc':codec);assert.equal(probe.acodec,format==='webm'?'opus':'aac');assert.equal(probe.width,160);assert.equal(probe.height,96);assert.equal(probe.fps,24);assert.ok(Math.abs(probe.duration-1)<.08);
 if(format==='mov')assert.equal(raw.format.tags.major_brand.trim(),'qt');else if(format==='mp4')assert.notEqual(raw.format.tags.major_brand.trim(),'qt');else assert.ok(bytes.subarray(0,128).includes(Buffer.from(format==='webm'?'webm':'matroska')));
 const rgb=execFileSync(ff.ffmpegPath,['-v','error','-ss','0.5','-i',file,'-frames:v','1','-pix_fmt','rgb24','-f','rawvideo','-']);assert.equal(rgb.length,160*96*3);
 const sound=execFileSync(ff.ffmpegPath,['-v','error','-i',file,'-vn','-f','f32le','-ac','1','-']);let sum=0;for(let i=0;i<sound.length;i+=4)sum+=sound.readFloatLE(i)**2;const rms=Math.sqrt(sum/(sound.length/4));assert.ok(rms>.04);outputs.push({format,codec,mode:plan.effective.mode,container:probe.container,majorBrand:raw.format.tags?.major_brand,duration:probe.duration,audio:probe.acodec,audioRms:rms,file});
 fs.rmSync(target.frameDir,{recursive:true,force:true});
}
checks.push('actual outputs use the selected container, video/audio codecs, dimensions and frame rate; video and audible samples decode');assert.equal(JSON.stringify(project),before);
for(const input of [{format:'avi'},{format:null},{format:'webm',codec:'h264'},{format:'mov',codec:'vp9'},{format:'mp4',file_path:path.join(directory,'wrong.webm')},{file_path:path.join(directory,'wrong.avi')},{format:'webm',crf:64}])assert.throws(()=>exportInput(input));
assert.equal(exportInput({format:'webm',crf:63}).crf,63);assert.equal(exportInput({}).format,'mp4');
const webm=agentExportPlan(project,{format:'webm'});assert.equal(webm.effective.codecFamily,'vp9');assert.equal(resolveExport(webm.project,{vp9:false}).available,false);assert.throws(()=>agentExportPlan(project,{format:'webm'},{vp9:false}),/unavailable/);
checks.push('invalid format/codec/path combinations and unavailable VP9 fail rather than silently producing another format');
const stored={...project,...settingsPatch(project,{...storedExportSettings(project),format:'mov'})};assert.equal(resolveExport({...stored,...settingsPatch(stored,{preset:'low'})}).format,'mov');assert.equal(agentExportPlan(stored,{}).effective.format,'mp4');
checks.push('native format preferences survive quality changes while SDK defaults and overrides remain snapshot-only');
const sentinel=Buffer.from('Keep this destination');for(const format of ['mov','mkv','webm']){
 const file=path.join(directory,'cancel.'+format),plan=agentExportPlan(project,{format,encoder_preset:'ultrafast'});fs.writeFileSync(file,sentinel);let job;job=ff.runExport({...plan.project,export:plan.effective},file,()=>{job.cancel();});await assert.rejects(job.promise);assert.ok(fs.readFileSync(file).equals(sentinel));
}
checks.push('cancellation preserves existing destinations for every additional format');
assert.equal(fs.readdirSync(directory).filter(name=>name.startsWith('.clipcraft-export-')).length,0);
fs.writeFileSync(path.join(directory,'result.json'),JSON.stringify({ok:true,checks,outputs},null,2));console.log(JSON.stringify({ok:true,checks,evidence:directory},null,2));
