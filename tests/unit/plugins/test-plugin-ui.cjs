// Isolated real-app proof; its Vite server and Electron profile are temporary.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {spawn}=require('node:child_process'),net=require('node:net');
(async()=>{
 const root=path.resolve(__dirname,'../../..'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'clipcraft-plugins-ui-'));
 fs.mkdirSync(path.join(dir,'settings-test'));fs.writeFileSync(path.join(dir,'settings-test/settings.json'),JSON.stringify({firstRun:{tourSeen:true,packPromptSeen:true}}));
 const port=await new Promise(resolve=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
 const fd=fs.openSync(path.join(dir,'runtime.log'),'w'),url='http://127.0.0.1:'+port;
 const vite=spawn(process.execPath,[path.join(root,'node_modules/vite/bin/vite.js'),'--host','127.0.0.1','--port',String(port),'--strictPort'],{cwd:root,stdio:['ignore',fd,fd]});let electron;
 try{
  let ready=false;for(let i=0;i<100;i++){try{ready=(await fetch(url)).ok;}catch{}if(ready)break;await new Promise(r=>setTimeout(r,50));}assert.ok(ready,'Vite starts');
  const bin=process.env.ELECTRON_BIN||require('electron');
  let code;
  for(const stage of ['0','1']) {
   electron=spawn(bin,[root],{cwd:root,stdio:['ignore',fd,fd],env:{...process.env,FVE_SMOKE:dir,FVE_SMOKE_MODE:'plugins',FVE_PLUGIN_RESTART:stage,VITE_DEV_SERVER_URL:url}});
   code=await new Promise(resolve=>{const timer=setTimeout(()=>{electron.kill('SIGKILL');resolve(-1);},90000);electron.once('exit',code=>{clearTimeout(timer);resolve(code);});});
   if(code!==0)break;
  }
  const result=JSON.parse(fs.readFileSync(path.join(dir,'result.json')));assert.equal(code,0,result.error);assert.ok(!result.error,result.error);
  console.log('Real-app plugin installation, preset snapshot, removal and export passed; evidence: '+dir);
 }finally{electron?.kill();vite.kill();fs.closeSync(fd);}
})().catch(error=>{console.error(error);process.exitCode=1;});
