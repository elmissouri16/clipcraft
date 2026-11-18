const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict'),{spawn,execFileSync}=require('node:child_process');
(async()=>{
 const root=path.resolve(__dirname,'../../..'),dir=await fs.mkdtemp(path.join(os.tmpdir(),'clipcraft-extension-example-migration-ui-'));await require('../../../scripts/build-plugin-sdk.cjs').buildSdk();const sdk=require('../../../packages/plugin-sdk/dist/authoring.cjs'),examples=[];
 for(const name of ['chapter-markers','project-dashboard','preference-workbench','clip-controls-demo','media-library-jobs']){
  const source=path.join(dir,name);await fs.cp(path.join(root,'examples/extensions',name),source,{recursive:true,filter:file=>!['dist','.clipcraft-build.json'].includes(path.basename(file))});
  if(name==='chapter-markers'){
   const entry=path.join(source,'src/extension.ts'),text=await fs.readFile(entry,'utf8'),index=text.lastIndexOf('}');await fs.writeFile(entry,text.slice(0,index)+`
    const controllers=new Map<string,AbortController>();
    let hookMode='none';await c.commands.register<{mode:string}>('hook-mode',input=>{hookMode=input.mode;return true;});
    for(const [name,mode] of [['project.validateSave','validate'],['project.willSave','prepare']] as const)await c.hooks.register(name,async()=>{if(hookMode===mode){const page=await c.workspace.inspect({section:'markers',limit:1});await c.markers.apply({documentId:page.documentId,projectRevision:page.projectRevision,operations:[{type:'add',time_sec:9.5,label:'Prepared marker'}]});}});

    await c.commands.register('host',()=>c.host.read());
    await c.commands.register('inspect',()=>c.workspace.inspect({section:'markers',limit:200}));
    await c.commands.register<Parameters<ExtensionContext['markers']['apply']>[0]>('transaction',input=>c.markers.apply(input));
    await c.commands.register<{id:string;save?:boolean}>('picker',async input=>{const controller=new AbortController();controllers.set(input.id,controller);try{return {selected:input.save?await c.ui.showSaveDialog({title:'Save proof',defaultPath:${JSON.stringify(path.join(dir,'proof.txt'))}},{signal:controller.signal}):await c.ui.showOpenDialog({title:'Choose proof',multiple:true,filters:[{name:'Images',extensions:['png']}]},{signal:controller.signal})};}catch(error){return {error:error instanceof Error?error.message:String(error),name:error instanceof Error?error.name:''};}finally{controllers.delete(input.id);}});
    await c.commands.register<{id:string}>('cancel-picker',input=>{controllers.get(input.id)?.abort();return true;});
   }\n`);
  }
  const built=await sdk.buildPlugin(source),archive=path.join(dir,name+'.tgz');await sdk.packPlugin(built.directory,archive);examples.push({name,title:built.manifest.name,id:built.manifest.id,key:built.key,archive,typecheck:built.typecheck});
 }
 const image=path.join(dir,'source.png');execFileSync(require('../../../electron/media/ffmpeg.cjs').ffmpegPath,['-v','error','-f','lavfi','-i','color=c=0x335577:s=128x72','-frames:v','1',image]);await fs.writeFile(path.join(dir,'fixtures.json'),JSON.stringify({examples,image}));await fs.mkdir(path.join(dir,'settings-test'));await fs.writeFile(path.join(dir,'settings-test/settings.json'),JSON.stringify({language:'en',firstRun:{tourSeen:true,packPromptSeen:true}}));
 const child=spawn(require('electron'),[root],{cwd:root,env:{...process.env,FVE_SMOKE:dir,FVE_SMOKE_MODE:'extension-example-migration',FVE_SMOKE_QUIET:'1',VITE_DEV_SERVER_URL:'',CLIPCRAFT_DEV_EXAMPLES:'0'},stdio:['ignore','pipe','pipe']});let log='';child.stdout.on('data',value=>log+=value);child.stderr.on('data',value=>log+=value);const timer=setTimeout(()=>child.kill('SIGKILL'),180000),code=await new Promise(resolve=>child.once('exit',resolve));clearTimeout(timer);await fs.writeFile(path.join(dir,'runtime.log'),log);const result=await fs.readFile(path.join(dir,'result.json')).then(JSON.parse).catch(()=>({error:log||'No app result'}));assert.equal(code,0,result.error||log);assert.ok(result.ok,result.error||log);console.log('Native Node example migration verified: '+dir);
})().catch(error=>{console.error(error);process.exitCode=1;});
