const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),net=require('node:net'),assert=require('node:assert/strict'),{spawn,execFileSync}=require('node:child_process');
(async()=>{
 const root=path.resolve(__dirname,'../../..'),directory=await fs.mkdtemp(path.join(os.tmpdir(),'clipcraft-extension-expansion-'));console.log('Extension expansion evidence: '+directory);
 await require('../../../scripts/build-plugin-sdk.cjs').buildSdk();const source=path.join(directory,'source');await fs.cp(path.join(root,'examples/extensions/sdk-workbench'),source,{recursive:true});
 const file=path.join(source,'src/extension.ts');let code=await fs.readFile(file,'utf8');code=code.slice(0,code.lastIndexOf('}'))+`
 await context.commands.register('project-call',async(input:any)=>(context.projects as any)[input.method](input.input));
 await context.commands.register('import-gif',async(input:any)=>{const media=await context.media.import({path:input.path});const placed=await context.media.insert({id:media.id});return {media,placed};});
 await context.commands.register('status-state',async(input:any)=>{await status.update(input);return true;});
 await context.commands.register('marker',async()=>{const scope=await context.workspace.inspect({section:'markers'});return context.markers.apply({documentId:scope.documentId,projectRevision:scope.projectRevision,operations:[{type:'add',time_sec:.5,label:'Before save'}]});});
 await context.commands.register('stale-undo',async(input:any)=>context.editor.undo(input));
 await context.commands.register('wait-prompt',async()=>({value:await context.ui.showInput({title:'Pending label',minLength:2})??null}));
}\n`;await fs.writeFile(file,code);
 const sdk=require('../../../packages/plugin-sdk/dist/authoring.cjs'),built=await sdk.buildPlugin(source),archive=path.join(directory,'extension.tgz');await sdk.packPlugin(built.directory,archive);
 const socket=net.createServer();const port=await new Promise((resolve,reject)=>{socket.once('error',reject);socket.listen(0,'127.0.0.1',()=>{const value=socket.address().port;socket.close(()=>resolve(value));});});
 const ff=require('../../../electron/media/ffmpeg.cjs'),gif=path.join(directory,'motion.gif');execFileSync(ff.ffmpegPath,['-v','error','-y','-f','lavfi','-i','testsrc2=s=96x54:r=8:d=1','-loop','0',gif]);
 await fs.writeFile(path.join(directory,'fixtures.json'),JSON.stringify({id:'clipcraft-examples.sdk-workbench',key:built.key,archive,node:process.execPath,port,gif}));await fs.mkdir(path.join(directory,'settings-test'));await fs.writeFile(path.join(directory,'settings-test/settings.json'),JSON.stringify({language:'en',firstRun:{tourSeen:true,packPromptSeen:true}}));
 for(const phase of [0,1]){
  const child=spawn(require('electron'),[root],{cwd:root,env:{...process.env,FVE_SMOKE:directory,FVE_SMOKE_MODE:'extension-expansion',FVE_EXTENSION_EXPANSION_REOPEN:String(phase),FVE_SMOKE_QUIET:'1',VITE_DEV_SERVER_URL:'',CLIPCRAFT_DEV_EXAMPLES:'0'},stdio:['ignore','pipe','pipe']});let log='';child.stdout.on('data',chunk=>log+=chunk);child.stderr.on('data',chunk=>log+=chunk);
  const timer=setTimeout(()=>child.kill('SIGKILL'),180000),exit=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});clearTimeout(timer);await fs.writeFile(path.join(directory,phase?'restart.log':'runtime.log'),log);
  const result=await fs.readFile(path.join(directory,phase?'restart-result.json':'result.json'),'utf8').then(JSON.parse).catch(()=>({ok:false,error:log}));assert.equal(exit,0,result.error||log);assert.ok(result.ok,result.error);
 }
 console.log('Extension expansion native workflow passed: '+directory);
})().catch(error=>{console.error(error);process.exitCode=1;});
