// Real Settings removal failure + process restart + explicit retry, in a hidden isolated profile.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),net=require('node:net'),{spawn}=require('node:child_process');
(async()=>{
 const root=path.resolve(__dirname,'../../..'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'clipcraft-plugin-removal-ui-'));
 const source=path.join(root,'tests/fixtures/plugins/legacy/project-dashboard');await require('tar').c({file:path.join(dir,'dashboard.tgz'),gzip:true,cwd:source},fs.readdirSync(source));
 fs.mkdirSync(path.join(dir,'settings-test'));fs.writeFileSync(path.join(dir,'settings-test/settings.json'),JSON.stringify({firstRun:{tourSeen:true,packPromptSeen:true}}));
 const port=await new Promise(resolve=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
 const fd=fs.openSync(path.join(dir,'runtime.log'),'w'),url='http://127.0.0.1:'+port,vite=spawn(process.execPath,[path.join(root,'node_modules/vite/bin/vite.js'),'--host','127.0.0.1','--port',String(port),'--strictPort'],{cwd:root,stdio:['ignore',fd,fd]});let electron;
 try{
  let ready=false;for(let i=0;i<100;i++){try{ready=(await fetch(url)).ok;}catch{}if(ready)break;await new Promise(r=>setTimeout(r,50));}assert.ok(ready,'Vite starts');
  for(const reopen of [false,true]){
   electron=spawn(process.env.ELECTRON_BIN||require('electron'),[root],{cwd:root,stdio:['ignore',fd,fd],env:{...process.env,FVE_SMOKE:dir,FVE_SMOKE_QUIET:'1',FVE_SMOKE_MODE:'plugin-removal',FVE_PLUGIN_REMOVAL_REOPEN:reopen?'1':'0',VITE_DEV_SERVER_URL:url,CLIPCRAFT_DEV_EXAMPLES:'0'}});
   const code=await new Promise(resolve=>{const timer=setTimeout(()=>{electron.kill('SIGKILL');resolve(-1);},45000);electron.once('exit',code=>{clearTimeout(timer);resolve(code);});});
   const result=JSON.parse(fs.readFileSync(path.join(dir,reopen?'reopen-result.json':'result.json')));assert.equal(code,0,result.error);assert.ok(result.ok,result.error);assert.equal(result.windowsShown,0);
  }
  console.log('Removal failure/restart/retry passed in hidden Electron; evidence: '+dir);
 }finally{electron?.kill();vite.kill();fs.closeSync(fd);}
})().catch(error=>{console.error(error);process.exitCode=1;});
