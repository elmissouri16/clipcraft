// Build an author project using the public SDK and install its archive in hidden Electron.
const fs=require('node:fs'),fsp=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict'),{promisify}=require('node:util');
const {spawn,execFile}=require('node:child_process'),net=require('node:net'),runFile=promisify(execFile);
(async()=>{
 const root=path.resolve(__dirname,'../../..'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'clipcraft-ui-actions-'));
 await require('../../../scripts/build-plugin-sdk.cjs').buildSdk();
 const sdk=require('../../../packages/plugin-sdk/dist/authoring.cjs'),source=path.join(dir,'source');
 await sdk.createPlugin(source,{id:'studio.action-harness',name:'UI Actions harness',publisher:'SDK fixture',template:'panel'});
 await runFile('npm',['install','--offline','--ignore-scripts','--no-audit','--no-fund'],{cwd:source,timeout:60000});
 const manifestPath=path.join(source,'plugin.json'),manifest=JSON.parse(await fsp.readFile(manifestPath));
 manifest.permissions=['editor.read','clips.write'];manifest.contributes.commands=[
  {id:'shift',name:'Shift clips',parameters:[{id:'offset',name:'Offset',min:.1,max:3,step:.1,default:1},{id:'direction',name:'Direction',type:'enum',options:[{value:'forward',label:'Forward'},{value:'backward',label:'Backward'}],default:'forward'}]},
  ...['quick','whole','wait','fail'].map(id=>({id,name:id,parameters:[]})),
 ];manifest.contributes.panels[0].commands=[];
 manifest.contributes.actions=[
  {id:'shift',commandId:'shift',label:'Shift selected clips',icon:'layers',locations:['plugins-menu','clip-menu'],when:{selection:'single',lanes:['text']}},
  {id:'quick',commandId:'quick',label:'Quick shift',icon:'sparkles',locations:['plugins-menu','clip-menu'],when:{selection:'single',lanes:['text']}},
  {id:'whole',commandId:'whole',label:'Whole project check',icon:'info',locations:['plugins-menu']},
  {id:'wait',commandId:'wait',label:'Wait after staging',locations:['plugins-menu'],when:{selection:'single',lanes:['text']}},
  {id:'fail',commandId:'fail',label:'Fail after staging',locations:['plugins-menu'],when:{selection:'single',lanes:['text']}},
  {id:'multi',commandId:'quick',label:'Shift multiple clips',locations:['plugins-menu','clip-menu'],when:{selection:'multiple',lanes:['text']}},
  {id:'plain-text',commandId:'whole',label:'<img src=x onerror=alert(1)>',locations:['plugins-menu']},
  ...Array.from({length:20},(_,i)=>({id:'extra-'+i,commandId:'quick',label:i===19?'Long action label '.repeat(5).slice(0,80):'Extra clip action '+(i+1),icon:'text',locations:['clip-menu'],when:{selection:'single',lanes:['text']}})),
 ];await fsp.writeFile(manifestPath,JSON.stringify(manifest));
 await fsp.writeFile(path.join(source,'src/commands.ts'),`import {defineCommand,type ClipEdit} from '@clipcraft/plugin-sdk';
 export const run=defineCommand(async(context,input)=>{
  const snapshot=await context.editor.read(),id=context.command.id;
  const selected=snapshot.timeline.clips.filter(c=>snapshot.selection.clipIds.includes(c.id));
  const targets=id==='whole'?[snapshot.timeline.clips.find(c=>c.trackId==='text:0')!]:selected;
  if(!targets.length)throw Error('No selected target');
  const delta=id==='whole'?0:id==='shift'?Number(input.offset)*(input.direction==='backward'?-1:1):.5;
  const operations:ClipEdit[]=targets.map(c=>({type:'move',clipId:c.id,start_sec:c.start_sec+delta}));
  await context.editor.stage({documentId:snapshot.documentId,revision:snapshot.revision,operations});
  if(id==='fail')throw Error('Fixture failed after staging');
  await context.progress(.5,'Staged');
  if(id==='wait')await new Promise(resolve=>setTimeout(resolve,30000));
 });`);
 await fsp.writeFile(path.join(source,'src/panel.ts'),`import {connectPanel} from '@clipcraft/plugin-sdk';async function main(){const p=await connectPanel();document.querySelector('#status')!.textContent='Panel ready.';window.addEventListener('pagehide',()=>p.dispose(),{once:true});}main();`);
 const built=await sdk.buildPlugin(source),packed=await sdk.packPlugin(built.directory,path.join(dir,'sdk-plugin.tgz'));await fsp.writeFile(path.join(dir,'bundle.json'),JSON.stringify({key:built.key,archive:packed.file,source}));
 fs.mkdirSync(path.join(dir,'settings-test'));fs.writeFileSync(path.join(dir,'settings-test/settings.json'),JSON.stringify({firstRun:{tourSeen:true,packPromptSeen:true}}));
 const port=await new Promise(resolve=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
 const fd=fs.openSync(path.join(dir,'runtime.log'),'w'),url='http://127.0.0.1:'+port;
 const vite=spawn(process.execPath,[path.join(root,'node_modules/vite/bin/vite.js'),'--host','127.0.0.1','--port',String(port),'--strictPort'],{cwd:root,stdio:['ignore',fd,fd]});let electron;
 try{
  let ready=false;for(let i=0;i<100;i++){try{ready=(await fetch(url)).ok;}catch{}if(ready)break;await new Promise(r=>setTimeout(r,50));}assert.ok(ready,'Vite starts');
  electron=spawn(process.env.ELECTRON_BIN||require('electron'),[root],{cwd:root,stdio:['ignore',fd,fd],env:{...process.env,FVE_SMOKE:dir,FVE_SMOKE_QUIET:'1',FVE_SMOKE_MODE:'plugin-ui-actions',VITE_DEV_SERVER_URL:url,CLIPCRAFT_DEV_EXAMPLES:'0'}});
  const code=await new Promise(resolve=>{const timer=setTimeout(()=>{electron.kill('SIGKILL');resolve(-1);},90000);electron.once('exit',code=>{clearTimeout(timer);resolve(code);});});
  const result=JSON.parse(fs.readFileSync(path.join(dir,'result.json')));assert.equal(code,0,result.error);assert.ok(result.ok,result.error);assert.equal(result.windowsShown,0);console.log('Host plugin UI actions passed in hidden Electron; evidence: '+dir);
 }finally{electron?.kill();vite.kill();fs.closeSync(fd);}
})().catch(error=>{console.error(error);process.exitCode=1;});
