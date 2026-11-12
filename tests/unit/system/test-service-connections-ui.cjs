// Isolated hidden Electron window; synthetic credentials only, no paid provider requests.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),net=require('node:net'),assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
(async()=>{
  const root=path.resolve(__dirname,'../../..'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'clipcraft-service-connections-ui-'));
  fs.mkdirSync(path.join(dir,'settings-test'));
  fs.writeFileSync(path.join(dir,'settings-test/settings.json'),JSON.stringify({firstRun:{tourSeen:true,packPromptSeen:true},ai:{provider:'openai',models:{openai:'preserved-model'},baseUrls:{openai:'https://keep.example/v1'}}}));
  const port=await new Promise(r=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>r(p));});});
  const fd=fs.openSync(path.join(dir,'runtime.log'),'w'),url=`http://127.0.0.1:${port}`;
  const vite=spawn(process.execPath,[path.join(root,'node_modules/vite/bin/vite.js'),'--host','127.0.0.1','--port',String(port),'--strictPort'],{cwd:root,stdio:['ignore',fd,fd]});let electron;
  try{
    let ready=false;for(let n=0;n<100;n++){try{ready=(await fetch(url)).ok;}catch{}if(ready)break;await new Promise(r=>setTimeout(r,60));}assert.ok(ready,'Vite starts');
    electron=spawn(require('electron'),['--no-sandbox',root],{cwd:root,stdio:['ignore',fd,fd],env:{...process.env,FVE_SMOKE:dir,FVE_SMOKE_MODE:'service-connections',VITE_DEV_SERVER_URL:url}});
    const code=await new Promise(resolve=>{const timer=setTimeout(()=>{electron.kill('SIGKILL');resolve(-1);},120000);electron.once('exit',c=>{clearTimeout(timer);resolve(c);});});
    const result=JSON.parse(fs.readFileSync(path.join(dir,'result.json')));assert.equal(code,0,result.error);assert.ok(!result.error,result.error);
    console.log('Hidden Electron service-connections checks passed; evidence: '+dir);
  }finally{electron?.kill();vite.kill();fs.closeSync(fd);}
})().catch(error=>{console.error(error);process.exitCode=1;});
