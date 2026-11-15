// Build an author project using the public SDK and install its archive in hidden Electron.
const fs=require('node:fs'),fsp=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict'),{promisify}=require('node:util');
const {spawn,execFile}=require('node:child_process'),net=require('node:net'),runFile=promisify(execFile);
(async()=>{
 const root=path.resolve(__dirname,'../../..'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'clipcraft-sdk-ui-'));
 await require('../../../scripts/build-plugin-sdk.cjs').buildSdk();
 const sdk=require('../../../packages/plugin-sdk/dist/authoring.cjs'),source=path.join(dir,'source');
 await sdk.createPlugin(source,{id:'studio.sdk-harness',name:'SDK harness',publisher:'SDK fixture',template:'panel'});
 await runFile('npm',['install','--offline','--ignore-scripts','--no-audit','--no-fund'],{cwd:source,timeout:60000});
 const built=await sdk.buildPlugin(source),packed=await sdk.packPlugin(built.directory,path.join(dir,'sdk-plugin.tgz'));await fsp.writeFile(path.join(dir,'bundle.json'),JSON.stringify({key:built.key,archive:packed.file}));
 fs.mkdirSync(path.join(dir,'settings-test'));fs.writeFileSync(path.join(dir,'settings-test/settings.json'),JSON.stringify({firstRun:{tourSeen:true,packPromptSeen:true}}));
 const port=await new Promise(resolve=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
 const fd=fs.openSync(path.join(dir,'runtime.log'),'w'),url='http://127.0.0.1:'+port;
 const vite=spawn(process.execPath,[path.join(root,'node_modules/vite/bin/vite.js'),'--host','127.0.0.1','--port',String(port),'--strictPort'],{cwd:root,stdio:['ignore',fd,fd]});let electron;
 try{
  let ready=false;for(let i=0;i<100;i++){try{ready=(await fetch(url)).ok;}catch{}if(ready)break;await new Promise(r=>setTimeout(r,50));}assert.ok(ready,'Vite starts');
  electron=spawn(process.env.ELECTRON_BIN||require('electron'),[root],{cwd:root,stdio:['ignore',fd,fd],env:{...process.env,FVE_SMOKE:dir,FVE_SMOKE_QUIET:'1',FVE_SMOKE_MODE:'plugin-sdk',VITE_DEV_SERVER_URL:url,CLIPCRAFT_DEV_EXAMPLES:'0'}});
  const code=await new Promise(resolve=>{const timer=setTimeout(()=>{electron.kill('SIGKILL');resolve(-1);},90000);electron.once('exit',code=>{clearTimeout(timer);resolve(code);});});
  const result=JSON.parse(fs.readFileSync(path.join(dir,'result.json')));assert.equal(code,0,result.error);assert.ok(result.ok,result.error);assert.equal(result.windowsShown,0);console.log('Public SDK generated plugin passed in hidden Electron; evidence: '+dir);
 }finally{electron?.kill();vite.kill();fs.closeSync(fd);}
})().catch(error=>{console.error(error);process.exitCode=1;});
