const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {execFileSync}=require('node:child_process'),ff=require('../../../electron/media/ffmpeg.cjs');
const {progressReader}=require('../../../electron/export/ffmpegProgress.cjs');
(async()=>{
 let events=[];const read=progressReader(2,(p,meta)=>events.push({p,...meta}));
 for(const part of ['frame=3\nfps=30\nout_ti','me_us=1000','000\nspeed=1.5x\ntotal_size=4096\nprogress=con','tinue\nframe=60\nout_time_us=2000000\nprogress=end\n'])read(part);
 assert.equal(events.length,2);assert.equal(events[0].p,.5);assert.equal(events[0].speed,1.5);assert.equal(events[1].p,1);
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'clipcraft-export-lifecycle-')),file=path.join(dir,'existing.mp4'),original=Buffer.from('Keep this existing export');fs.writeFileSync(file,original);
 const p={width:640,height:360,fps:30,media:[],videoClips:[{id:'gap',gap:true,in:0,out:5,speed:1}],overlayClips:[],textClips:[],audioClips:[]};
 let saved=process.env.FVE_ENCODER;process.env.FVE_ENCODER='libx264';
 try{
  const canceled=ff.runExport(p,file,()=>{});canceled.cancel();await assert.rejects(canceled.promise);assert.equal(canceled.canceled,true);assert.deepEqual(fs.readFileSync(file),original);
  const bad=ff.runExport({...p,videoClips:[{id:'missing',mediaId:'missing',in:0,out:1,speed:1}]},file,()=>{});await assert.rejects(bad.promise);assert.deepEqual(fs.readFileSync(file),original);
  let active,encodingStarted=false;
  active=ff.runExport({...p,width:1280,height:720,fps:60,videoClips:[{...p.videoClips[0],out:60}],export:{codecFamily:'h264',outW:1280,outH:720,outFps:60,encoderPreset:'veryslow',crf:18}},file,fraction=>{if(fraction>0&&fraction<.99){encodingStarted=true;active.cancel();}});
  await assert.rejects(active.promise);assert.ok(encodingStarted,'cancellation is exercised after actual encoder output');assert.deepEqual(fs.readFileSync(file),original);
  await ff.runExport({...p,videoClips:[{...p.videoClips[0],out:.3}]},file,()=>{}).promise;assert.equal((await ff.probe(file)).hasVideo,true);
  assert.ok(!fs.readdirSync(dir).some(f=>f.startsWith('.clipcraft-export-')),'temporary output folders are removed');
 }finally{if(saved===undefined)delete process.env.FVE_ENCODER;else process.env.FVE_ENCODER=saved;}
 console.log('Export lifecycle: split progress records, cancellation, failed overwrite protection and atomic publish passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
