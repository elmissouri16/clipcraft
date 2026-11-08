const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const {SparseTextStream}=require('../../../electron/export/sparseText.cjs');
const {ffmpegPath,ffprobePath}=require('../../../electron/media/ffmpeg.cjs');
(async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'clipcraft-sparse-text-')),W=32,H=16,fps=30,size=W*H*4;
 const first=new Uint8Array(size),second=new Uint8Array(size);
 for(let i=0;i<size;i+=4){first.set([255,140,30,128],i);second.set([20,200,255,255],i);}
 const stream=new SparseTextStream(ffmpegPath,dir,W,H,fps);
 await stream.add({blank:30});await stream.add(first);await stream.add({same:59});
 await stream.add({x:0,y:0,w:W,h:H,data:second});await stream.add({same:29});await stream.add({blank:30});
 await stream.finish();assert.equal(stream.count,150);assert.equal(stream.surfaces,3,'each changed or blank surface is written once');
 const info=JSON.parse(execFileSync(ffprobePath,['-v','error','-show_streams','-of','json',stream.file]));
 assert.ok(Number(info.streams[0].nb_frames)<=5,'holds do not become repeated encoded frames');assert.ok(Math.abs(Number(info.streams[0].duration)-5)<1/fps);
 const decoded=execFileSync(ffmpegPath,['-v','error','-i',stream.file,'-vf','fps=30','-f','rawvideo','-pix_fmt','rgba','-'],{maxBuffer:4*1024*1024});
 assert.equal(decoded.length,size*150);
 for(let frame=0;frame<150;frame++)assert.deepEqual(decoded.subarray(frame*size,(frame+1)*size),Buffer.from(frame<30||frame>=120?new Uint8Array(size):frame<90?first:second),'RGBA/timestamp mismatch at frame '+frame);
 const empty=new SparseTextStream(ffmpegPath,dir,W,H,24);await assert.rejects(empty.add({x:-1,y:0,w:1,h:1,data:new Uint8Array(4)}),/bad frame patch/);empty.kill();await assert.rejects(empty.add({blank:1}),/canceled/);
 const evidence={duration:Number(info.streams[0].duration),timelineFrames:stream.count,encodedFrames:Number(info.streams[0].nb_frames),surfaces:stream.surfaces};
 fs.writeFileSync(path.join(dir,'evidence.json'),JSON.stringify(evidence,null,2));console.log('Sparse text retains exact RGBA and timing with held surfaces; evidence: '+dir);
})().catch(error=>{console.error(error);process.exitCode=1;});
