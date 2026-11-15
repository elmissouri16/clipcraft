// Build an author project using the public SDK and install its archive in hidden Electron.
const fs=require('node:fs'),fsp=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict'),{promisify}=require('node:util');
const {spawn,execFile}=require('node:child_process'),net=require('node:net'),runFile=promisify(execFile);
(async()=>{
 const root=path.resolve(__dirname,'../../..'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'clipcraft-main-reorder-ui-'));
 await require('../../../scripts/build-plugin-sdk.cjs').buildSdk();
 const sdk=require('../../../packages/plugin-sdk/dist/authoring.cjs'),source=path.join(dir,'source');
 await sdk.createPlugin(source,{id:'studio.reorder-harness',name:'Reorder SDK harness',publisher:'SDK fixture',template:'panel'});
 await runFile('npm',['install','--offline','--ignore-scripts','--no-audit','--no-fund'],{cwd:source,timeout:60000});
 const commands=['reorder','reject','mixed','stage-fail','wait','scope','no-op'];
 const manifestPath=path.join(source,'plugin.json'),manifest=JSON.parse(await fsp.readFile(manifestPath));manifest.permissions=['editor.read','clips.write','timeline.reorder'];manifest.contributes.commands=commands.map(id=>({id,name:id}));manifest.contributes.panels[0].commands=commands;manifest.contributes.actions=[{id:'reorder',commandId:'reorder',label:'Reorder selected main clip',locations:['plugins-menu','clip-menu'],when:{selection:'single',lanes:['video']}}];await fsp.writeFile(manifestPath,JSON.stringify(manifest));
 await fsp.writeFile(path.join(source,'src/commands.ts'),`import {defineCommand,type ClipEdit} from '@clipcraft/plugin-sdk';
 export const run=defineCommand(async context=>{
  const snapshot=await context.editor.read(),id=context.command.id;
  const main=snapshot.timeline.clips.filter(c=>c.main).sort((a,b)=>a.main!.index-b.main!.index);
  const source=main.find(c=>snapshot.selection.clipIds.includes(c.id)&&!c.gap)??main.at(-1)!;
  const operations:ClipEdit[]=[{type:'reorder',clipId:source.id,beforeClipId:id==='no-op'?null:main[0].id,gaps:'preserve',transitions:id==='reject'?'reject':'clear-boundaries'}];
  if(id==='mixed'){const text=snapshot.timeline.clips.find(c=>c.trackId==='text:0')!;operations.push({type:'move',clipId:text.id,start_sec:4});}
  await context.editor.stage({documentId:snapshot.documentId,revision:snapshot.revision+(id==='scope'?1:0),operations});
  if(id==='stage-fail')throw Error('Fixture failed after staging');
  await context.progress(.5,'Staged edits');
  if(id==='wait')await new Promise(resolve=>setTimeout(resolve,30000));
 });`);
 await fsp.writeFile(path.join(source,'src/panel.html'),'<!doctype html><html><head><script src="panel.js" defer></script><link rel="stylesheet" href="panel.css"></head><body><main><h1>Editing SDK fixture</h1><p id="status">Connecting</p><div id="buttons"></div></main></body></html>');
 await fsp.writeFile(path.join(source,'src/panel.ts'),`import {connectPanel} from '@clipcraft/plugin-sdk';
 async function main(){const panel=await connectPanel();panel.commands.onProgress(event=>{document.body.dataset.progress=String(event.progress);});for(const command of panel.info.commands){const b=document.createElement('button');b.id=command.id;b.textContent=command.name;b.onclick=async()=>{delete document.body.dataset.result;document.body.dataset.progress='0';try{const result=await panel.commands.run(command.id);document.body.dataset.result=JSON.stringify(result);}catch(error){document.body.dataset.result=JSON.stringify({error:String(error)});}};document.querySelector('#buttons')!.append(b);}document.body.dataset.ready='yes';window.addEventListener('pagehide',()=>panel.dispose(),{once:true});}main();`);
 const built=await sdk.buildPlugin(source),packed=await sdk.packPlugin(built.directory,path.join(dir,'sdk-plugin.tgz'));manifest.id='studio.reorder-ungranted';manifest.name='Reorder ungranted';manifest.permissions=['editor.read'];manifest.contributes.panels=[];await fsp.writeFile(manifestPath,JSON.stringify(manifest));await fsp.rm(path.join(source,'src/panel.ts'));await fsp.rm(path.join(source,'src/panel.html'));await fsp.rm(path.join(source,'src/panel.css'));
 const ungranted=await sdk.buildPlugin(source),ungrantedPack=await sdk.packPlugin(ungranted.directory,path.join(dir,'ungranted.tgz'));
 await fsp.writeFile(path.join(dir,'bundle.json'),JSON.stringify({key:built.key,archive:packed.file,ungrantedKey:ungranted.key,ungrantedArchive:ungrantedPack.file}));
 fs.mkdirSync(path.join(dir,'settings-test'));fs.writeFileSync(path.join(dir,'settings-test/settings.json'),JSON.stringify({firstRun:{tourSeen:true,packPromptSeen:true}}));
 const port=await new Promise(resolve=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
 const fd=fs.openSync(path.join(dir,'runtime.log'),'w'),url='http://127.0.0.1:'+port;
 const vite=spawn(process.execPath,[path.join(root,'node_modules/vite/bin/vite.js'),'--host','127.0.0.1','--port',String(port),'--strictPort'],{cwd:root,stdio:['ignore',fd,fd]});let electron;
 try{
  let ready=false;for(let i=0;i<100;i++){try{ready=(await fetch(url)).ok;}catch{}if(ready)break;await new Promise(r=>setTimeout(r,50));}assert.ok(ready,'Vite starts');
  electron=spawn(process.env.ELECTRON_BIN||require('electron'),[root],{cwd:root,stdio:['ignore',fd,fd],env:{...process.env,FVE_SMOKE:dir,FVE_SMOKE_QUIET:'1',FVE_SMOKE_MODE:'plugin-main-reorder',VITE_DEV_SERVER_URL:url,CLIPCRAFT_DEV_EXAMPLES:'0'}});
  const code=await new Promise(resolve=>{const timer=setTimeout(()=>{electron.kill('SIGKILL');resolve(-1);},90000);electron.once('exit',code=>{clearTimeout(timer);resolve(code);});});
  const result=JSON.parse(fs.readFileSync(path.join(dir,'result.json')));assert.equal(code,0,result.error);assert.ok(result.ok,result.error);assert.equal(result.windowsShown,0);console.log('Main-track reorder passed in hidden Electron; evidence: '+dir);
 }finally{electron?.kill();vite.kill();fs.closeSync(fd);}
})().catch(error=>{console.error(error);process.exitCode=1;});
