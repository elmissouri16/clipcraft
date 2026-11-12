// The UI language in the real app (docs/design/localization.md): with settings.json { language: 'fr' } the shell
// renders in French (FVE_SMOKE_MODE=language, tests/smoke/index.cjs); FVE_UI_LANGUAGE=es runs the same check in Spanish. Isolated Vite server and Electron profile.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {spawn}=require('node:child_process'),net=require('node:net');
(async()=>{
 const root=path.resolve(__dirname,'../../..'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'clipcraft-language-ui-'));
 fs.mkdirSync(path.join(dir,'settings-test'));fs.writeFileSync(path.join(dir,'settings-test/settings.json'),JSON.stringify({firstRun:{tourSeen:true,packPromptSeen:true},language:process.env.FVE_UI_LANGUAGE||'fr'}));
 const port=await new Promise(resolve=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
 const fd=fs.openSync(path.join(dir,'runtime.log'),'w'),url='http://127.0.0.1:'+port;
 const vite=spawn(process.execPath,[path.join(root,'node_modules/vite/bin/vite.js'),'--host','127.0.0.1','--port',String(port),'--strictPort'],{cwd:root,stdio:['ignore',fd,fd]});let electron;
 try{
  let ready=false;for(let i=0;i<100;i++){try{ready=(await fetch(url)).ok;}catch{}if(ready)break;await new Promise(r=>setTimeout(r,50));}assert.ok(ready,'Vite starts');
  const bin=process.env.ELECTRON_BIN||require('electron');
  electron=spawn(bin,['--no-sandbox',root],{cwd:root,stdio:['ignore',fd,fd],env:{...process.env,FVE_SMOKE:dir,FVE_SMOKE_MODE:'language',FVE_UI_LANGUAGE:process.env.FVE_UI_LANGUAGE||'fr',VITE_DEV_SERVER_URL:url}});
  const code=await new Promise(resolve=>{const timer=setTimeout(()=>{electron.kill('SIGKILL');resolve(-1);},120000);electron.once('exit',code=>{clearTimeout(timer);resolve(code);});});
  const result=JSON.parse(fs.readFileSync(path.join(dir,'result.json')));
  assert.equal(code,0,result.error);assert.ok(!result.error,result.error);
  assert.ok(result.ok,'French UI: '+JSON.stringify({lang:result.lang,homeActions:result.homeActions,expected:result.expectedActions,newProject:result.newProject,railLanguage:result.railLanguage,railGeneral:result.railGeneral,selected:result.selected,englishLeft:result.englishLeft}));
  console.log((process.env.FVE_UI_LANGUAGE||'fr')+' UI in the real app passed; evidence: '+dir);
 }finally{electron?.kill();vite.kill();fs.closeSync(fd);}
})().catch(error=>{console.error(error);process.exitCode=1;});
