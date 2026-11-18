const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),{promisify}=require('node:util'),{execFile}=require('node:child_process');
(async()=>{
 if(process.platform==='win32'){console.log('SKIP: Windows uses ordinary frame stdin rather than POSIX FIFOs');return;}
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'clipcraft-frame-pipe-race-')),results=[];
 for(const mode of ['reader-disappears','guard-error','writer-error','close-waiting','exited']){
  const profile=path.join(directory,mode);await fs.mkdir(profile);
  try{await promisify(execFile)(process.execPath,[path.resolve(__dirname,'../../fixtures/framePipeRace.cjs'),profile,mode],{timeout:5000,killSignal:'SIGKILL'});}catch(error){throw Error(mode+' failed or blocked its event loop; see '+profile+'\n'+error.stderr);}
  const result=JSON.parse(await fs.readFile(path.join(profile,'result.json')));assert.ok(result.ok);assert.equal(result.ownedDescriptors,0);results.push(result);
 }
 await fs.writeFile(path.join(directory,'result.json'),JSON.stringify({ok:true,results},null,2));console.log('Native FIFO race and cleanup verified: '+directory);
})().catch(error=>{console.error(error);process.exitCode=1;});
