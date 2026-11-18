// The hardware encoder probe must hand every encoder a complete argument set: a missing preset
// makes FFmpeg refuse NVENC/QSV, which then count as absent and every export falls back to the CPU.
const assert=require('node:assert/strict'),cp=require('node:child_process'),{EventEmitter}=require('node:events');
const probes=[];
cp.execFileSync=()=>Buffer.from(' V....D h264_nvenc  NVIDIA\n V....D h264_qsv  Intel\n V....D h264_amf  AMD\n V....D libx264  x264\n');
cp.spawn=(file,args)=>{
 const start=args.indexOf('-c:v');probes.push(args.slice(start,args.indexOf('-pix_fmt')));
 const child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.pid=0;child.kill=()=>{};
 // Only the Intel probe "succeeds", so NVENC (tried first) must fail and QSV must be chosen.
 setImmediate(()=>child.emit('close',args[start+1]==='h264_qsv'?0:1));
 return child;
};
delete process.env.FVE_ENCODER;
const ff=require('../../../electron/media/ffmpeg.cjs');
Object.defineProperty(process,'platform',{value:'win32'});
ff.pickEncoder('h264').then(pick=>{
 assert.equal(pick,'h264_qsv');
 assert.deepEqual(probes.map(args=>args[1]),['h264_nvenc','h264_qsv']);
 for(const args of probes){
  assert.ok(args.every(value=>typeof value==='string'&&value!=='undefined'&&value!=='null'),'complete probe arguments: '+JSON.stringify(args));
  const preset=args[args.indexOf('-preset')+1];
  assert.ok(args[1]==='h264_nvenc'?/^p[1-7]$/.test(preset):preset==='veryfast','valid encoder preset: '+JSON.stringify(args));
 }
 console.log('hardware encoder probes pass a valid preset');
}).catch(error=>{console.error(error);process.exitCode=1;});
