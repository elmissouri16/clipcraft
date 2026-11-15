// Build an author project using the public SDK and install its archive in hidden Electron.
const fs=require('node:fs'),fsp=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict'),{promisify}=require('node:util');
const {spawn,execFile}=require('node:child_process'),net=require('node:net'),runFile=promisify(execFile);
(async()=>{
 const root=path.resolve(__dirname,'../../..'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'clipcraft-editor-ui-'));
 await require('../../../scripts/build-plugin-sdk.cjs').buildSdk();
 const sdk=require('../../../packages/plugin-sdk/dist/authoring.cjs'),source=path.join(dir,'source');
 await sdk.createPlugin(source,{id:'studio.editor-harness',name:'Editor SDK harness',publisher:'SDK fixture',template:'panel'});
 await runFile('npm',['install','--offline','--ignore-scripts','--no-audit','--no-fund'],{cwd:source,timeout:60000});
 const manifestPath=path.join(source,'plugin.json'),manifest=JSON.parse(await fsp.readFile(manifestPath));manifest.permissions=['editor.read'];manifest.contributes.panels[0].permissions=['editor.read'];await fsp.writeFile(manifestPath,JSON.stringify(manifest));
 let panelSource=await fsp.readFile(path.join(source,'src/panel.ts'),'utf8');
 panelSource=panelSource.replace('const panel = await connectPanel();',`const panel = await connectPanel();
  const events: string[][] = [];
  const stop = panel.editor.onChanged(event => {events.push([...event.changes]);document.body.dataset.events = JSON.stringify(events);document.body.dataset.editor = JSON.stringify(event.snapshot);});
  document.body.dataset.editor = JSON.stringify(await panel.editor.read());
  const unsubscribe = document.createElement('button');unsubscribe.id='unsubscribe';unsubscribe.textContent='Unsubscribe';unsubscribe.onclick=stop;document.body.append(unsubscribe);
 `);await fsp.writeFile(path.join(source,'src/panel.ts'),panelSource);
 await fsp.writeFile(path.join(source,'src/commands.ts'),`import {defineCommand} from '@clipcraft/plugin-sdk';
 export const run = defineCommand(async context => {
  const editor = await context.editor.read();
  if(editor.version!==1 || editor.playhead.time_sec!==2.5 || editor.selection.total!==1 || editor.timeline.clips_total!==2) throw Error('Wrong captured editor context');
  if(JSON.stringify(editor).includes('private')) throw Error('Sensitive fields leaked');
  await context.progress(1,'Read context');
 });`);
 const built=await sdk.buildPlugin(source),packed=await sdk.packPlugin(built.directory,path.join(dir,'sdk-plugin.tgz'));manifest.id='studio.editor-ungranted';manifest.name='Editor ungranted';manifest.contributes.panels[0].name='Editor ungranted';manifest.contributes.panels[0].permissions=[];await fsp.writeFile(manifestPath,JSON.stringify(manifest));
 await fsp.writeFile(path.join(source,'src/panel.ts'),`import {connectPanel,PluginError} from '@clipcraft/plugin-sdk';
 async function main(){const p=await connectPanel();try{await p.editor.read();}catch(e){document.body.dataset.denied=e instanceof PluginError?e.code:'wrong';}try{p.editor.onChanged(()=>{document.body.dataset.leaked='yes';});}catch(e){document.body.dataset.deniedSubscription=e instanceof PluginError?e.code:'wrong';}document.body.dataset.ready='yes';}main();`);
 const ungranted=await sdk.buildPlugin(source),ungrantedPack=await sdk.packPlugin(ungranted.directory,path.join(dir,'ungranted.tgz'));
 await fsp.writeFile(path.join(dir,'bundle.json'),JSON.stringify({key:built.key,archive:packed.file,ungrantedKey:ungranted.key,ungrantedArchive:ungrantedPack.file}));
 fs.mkdirSync(path.join(dir,'settings-test'));fs.writeFileSync(path.join(dir,'settings-test/settings.json'),JSON.stringify({firstRun:{tourSeen:true,packPromptSeen:true}}));
 const port=await new Promise(resolve=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
 const fd=fs.openSync(path.join(dir,'runtime.log'),'w'),url='http://127.0.0.1:'+port;
 const vite=spawn(process.execPath,[path.join(root,'node_modules/vite/bin/vite.js'),'--host','127.0.0.1','--port',String(port),'--strictPort'],{cwd:root,stdio:['ignore',fd,fd]});let electron;
 try{
  let ready=false;for(let i=0;i<100;i++){try{ready=(await fetch(url)).ok;}catch{}if(ready)break;await new Promise(r=>setTimeout(r,50));}assert.ok(ready,'Vite starts');
  electron=spawn(process.env.ELECTRON_BIN||require('electron'),[root],{cwd:root,stdio:['ignore',fd,fd],env:{...process.env,FVE_SMOKE:dir,FVE_SMOKE_QUIET:'1',FVE_SMOKE_MODE:'plugin-editor',VITE_DEV_SERVER_URL:url,CLIPCRAFT_DEV_EXAMPLES:'0'}});
  const code=await new Promise(resolve=>{const timer=setTimeout(()=>{electron.kill('SIGKILL');resolve(-1);},90000);electron.once('exit',code=>{clearTimeout(timer);resolve(code);});});
  const result=JSON.parse(fs.readFileSync(path.join(dir,'result.json')));assert.equal(code,0,result.error);assert.ok(result.ok,result.error);assert.equal(result.windowsShown,0);console.log('Read-only editor context passed in hidden Electron; evidence: '+dir);
 }finally{electron?.kill();vite.kill();fs.closeSync(fd);}
})().catch(error=>{console.error(error);process.exitCode=1;});
