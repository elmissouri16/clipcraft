// Save, auto save and close in the real app (tests/smoke/index.cjs, mode autosave): a never-saved
// project asks on close, a saved one writes its changes by itself and on close, and when the file
// cannot be written the close is cancelled and the save question asked. Its Vite server and
// Electron profile are temporary. Usage: node tests/unit/editor/test-autosave-close-ui.cjs
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {spawn}=require('node:child_process'),net=require('node:net');
(async()=>{
 const root=path.resolve(__dirname,'../../..'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'clipcraft-autosave-close-ui-'));
 fs.mkdirSync(path.join(dir,'settings-test'));fs.writeFileSync(path.join(dir,'settings-test/settings.json'),JSON.stringify({firstRun:{tourSeen:true,packPromptSeen:true}}));
 const {emptyProject}=await import('../../../src/state/store.js');
 fs.writeFileSync(path.join(dir,'project.json'),JSON.stringify({...emptyProject(),id:'closecheck',name:'Close check',textClips:[{id:'t1',text:'Hello',start:0,duration:2}]}));
 const port=await new Promise(resolve=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
 const fd=fs.openSync(path.join(dir,'runtime.log'),'w'),url='http://127.0.0.1:'+port;
 const vite=spawn(process.execPath,[path.join(root,'node_modules/vite/bin/vite.js'),'preview','--host','127.0.0.1','--port',String(port),'--strictPort'],{cwd:root,stdio:['ignore',fd,fd]});let electron;
 try{
  let ready=false;for(let i=0;i<100;i++){try{ready=(await fetch(url)).ok;}catch{}if(ready)break;await new Promise(r=>setTimeout(r,50));}assert.ok(ready,'Vite starts');
  const bin=process.env.ELECTRON_BIN||require('electron');
  electron=spawn(bin,['--no-sandbox',root],{cwd:root,stdio:['ignore',fd,fd],env:{...process.env,FVE_SMOKE:dir,FVE_SMOKE_MODE:'autosave',VITE_DEV_SERVER_URL:url}});
  const code=await new Promise(resolve=>{const timer=setTimeout(()=>{electron.kill('SIGKILL');resolve(-1);},120000);electron.once('exit',code=>{clearTimeout(timer);resolve(code);});});
  const result=JSON.parse(fs.readFileSync(path.join(dir,'result.json')));assert.ok(!result.error,result.error);assert.equal(code,0);
  assert.ok(result.askedOnClose&&result.openAfterCancel,'a never-saved project asks on close and Cancel keeps it open');
  assert.equal(result.nameAfterAutosave,'Auto saved','a saved project writes its changes by itself');
  assert.match(String(result.askedOnFailedWrite),/could not be written/,'a failed write asks on close and says why');
  assert.equal(result.openAfterFailedWrite,true,'Cancel keeps the window open');
  assert.equal(result.nameAfterFailedWrite,'Auto saved','the read-only file kept its last written state');
  assert.equal(result.nameAfterClose,'Written on close','closing after a change still writes it');
  console.log('Save, auto save and close passed, failed-write close included; evidence: '+dir);
 }finally{electron?.kill();vite.kill();fs.closeSync(fd);}
})().catch(error=>{console.error(error);process.exitCode=1;});
