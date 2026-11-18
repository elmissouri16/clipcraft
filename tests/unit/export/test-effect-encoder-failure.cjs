const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawn,execFileSync}=require('node:child_process'),{FxJobs,encoder,FrameReader}=require('../../../electron/export/fxjobs.cjs');
const ff=require('../../../electron/media/ffmpeg.cjs');
(async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'clipcraft-encoder-failure-')),source=path.join(dir,'source.png');
 execFileSync(ff.ffmpegPath,['-v','error','-y','-f','lavfi','-i','color=red:s=256x144','-frames:v','1',source]);
 const p={width:256,height:144,fps:24,media:[{id:'m',path:source,type:'image',width:256,height:144}],videoClips:[{id:'v',mediaId:'m',in:0,out:1}],overlayClips:[],audioClips:[],textClips:[]};
 const jobs=new FxJobs(),processes=[];
 try{
  for(const detail of ['No space left on device','Unknown encoder ffv1']){
   jobs.createEncoder=(file,w,h,fps)=>encoder(file,w,h,fps,()=>spawn(process.execPath,['-e',`process.stdin.once('data',()=>{process.stderr.write(${JSON.stringify(detail)},()=>process.exit(1));});`],{env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},stdio:['pipe','ignore','pipe']}));
   const job=jobs.begin(p,{kind:'clip',track:'video',clipId:'v'});processes.push(...jobs.jobs.get(job.id).decs);
   await assert.rejects(jobs.write(job.id,Buffer.alloc(256*144*4)),detail.startsWith('No space')?/Not enough disk space/:/Unknown encoder ffv1/,'backpressure retains the underlying encoder failure');
   jobs.clear();
  }
  const {EventEmitter}=require('node:events'),proc=new EventEmitter();proc.stdout=new EventEmitter();proc.stderr=new EventEmitter();proc.stdout.pause=proc.stdout.resume=()=>{};
  const reader=new FrameReader(proc,4),pending=reader.next();proc.stdout.emit('close');assert.equal(await pending,null,'destroyed decoder pipes unblock pending reads');
  const normal=new FxJobs(),job=normal.begin(p,{kind:'clip',track:'video',clipId:'v'}),decoder=normal.jobs.get(job.id).decs[0];
  processes.push(decoder);await normal.read(job.id,1);normal.clear();
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('decoder remained alive')),2000);if(decoder.exitCode!==null||decoder.signalCode){clearTimeout(timer);resolve();}else decoder.once('close',()=>{clearTimeout(timer);resolve();});});
  const output=path.join(dir,'real-encoder.mkv'),stream=encoder(output,16,16,24),frames=[];processes.push(stream.p);
  for(let i=0;i<6;i++){const frame=Buffer.alloc(16*16*4);for(let offset=0;offset<frame.length;offset+=4)frame.set([i*25,80,150,128+i*20],offset);frames.push(frame);await stream.write(frame);}
  await stream.end();await stream.done;
  const decoded=execFileSync(ff.ffmpegPath,['-v','error','-i',output,'-f','rawvideo','-pix_fmt','rgba','-']);assert.deepEqual(decoded,Buffer.concat(frames),'Real effect FIFO handoff preserves every frame/alpha and closes for EOF');
  if(process.platform==='darwin'&&!process.env.FVE_PLAIN_FRAME_PIPES)assert.ok(fs.existsSync(output+'.in'),'The real macOS effect encoder used its FIFO');
  console.log('Effect encoder: disk/codec failure reasons survive backpressure; canceled decoders exit and pending reads unblock.');
  console.log('Real lossless effect encoder: all six RGBA frames decode exactly and EOF completes.');
 }finally{jobs.clear();for(const proc of processes)if(proc.exitCode===null)proc.kill('SIGKILL');fs.rmSync(dir,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
