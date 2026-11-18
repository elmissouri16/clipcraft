// Native FIFO race in a disposable subprocess: an old blocking open would stop
// its event loop, so the parent owns an independent deadline.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const [directory,mode]=process.argv.slice(2),fifo=path.join(directory,'frames.in'),{fifoWriter}=require('../../electron/export/framePipes.cjs');
require('node:child_process').execFileSync(process.platform==='darwin'?'/usr/bin/mkfifo':'mkfifo',['-m','600',fifo]);
const open=fs.openSync,close=fs.closeSync,owned=new Set(),proc={exitCode:null,signalCode:null};let originalReader=null,triggered=false;
if(!['close-waiting','exited'].includes(mode)){originalReader=open(fifo,fs.constants.O_RDONLY|fs.constants.O_NONBLOCK);owned.add(originalReader);}
fs.closeSync=function(fd){const value=close.call(fs,fd);owned.delete(fd);return value;};
fs.openSync=function(file,flags,...args){
 if(file===fifo&&((mode==='guard-error'&&flags===(fs.constants.O_RDONLY|fs.constants.O_NONBLOCK))||(mode==='writer-error'&&flags===fs.constants.O_WRONLY))){triggered=true;throw Object.assign(Error('Original open failure'),{code:mode==='guard-error'?'EMFILE':'EACCES'});}
 const fd=open.call(fs,file,flags,...args);if(file===fifo){owned.add(fd);if(mode==='reader-disappears'&&!triggered&&flags===(fs.constants.O_WRONLY|fs.constants.O_NONBLOCK)){triggered=true;fs.closeSync(originalReader);originalReader=null;fs.writeFileSync(path.join(directory,'checkpoint.json'),JSON.stringify({stage:'reader-closed-after-probe'}));}}return fd;
};
(async()=>{
 const writer=fifoWriter(fifo,proc);let heartbeat=false;setImmediate(()=>{heartbeat=true;});
 try{
  if(mode==='exited')proc.exitCode=1;
  if(mode==='close-waiting'){const pending=writer.write(Buffer.alloc(4));setTimeout(()=>writer.close(),10);await assert.rejects(pending,/stopped/);}
  else await assert.rejects(writer.write(Buffer.alloc(4)),mode==='reader-disappears'?{code:'EPIPE'}:mode==='guard-error'?{code:'EMFILE'}:mode==='writer-error'?{code:'EACCES'}:/ended/);
  await new Promise(resolve=>setImmediate(resolve));assert.ok(heartbeat,'The event loop stays responsive');
 }finally{writer.close();if(originalReader!==null)fs.closeSync(originalReader);fs.openSync=open;fs.closeSync=close;}
 assert.equal(owned.size,0,'All probe, guard and writer descriptors close');
 fs.writeFileSync(path.join(directory,'result.json'),JSON.stringify({ok:true,mode,triggered,heartbeat,ownedDescriptors:owned.size}));
})().catch(error=>{fs.writeFileSync(path.join(directory,'failure.json'),JSON.stringify({error:error.stack,mode},null,2));console.error(error);process.exitCode=1;});
