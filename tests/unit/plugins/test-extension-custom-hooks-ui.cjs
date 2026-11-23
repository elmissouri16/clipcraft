const fs=require('node:fs/promises'),sync=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),{spawn}=require('node:child_process');
(async()=>{
 const root=path.resolve(__dirname,'../../..'),directory=await fs.mkdtemp(path.join(os.tmpdir(),'clipcraft-custom-hooks-ui-'));console.log('Custom hook evidence: '+directory);await require('../../../scripts/build-plugin-sdk.cjs').buildSdk();
 for(const name of ['sdk-workbench','scene-reviewer'])await fs.cp(path.join(root,'examples/extensions',name),path.join(directory,name),{recursive:true,filter:file=>!file.split(path.sep).includes('dist')});
 const owner=path.join(directory,'sdk-workbench/src/extension.ts');let code=await fs.readFile(owner,'utf8');code=code.slice(0,code.lastIndexOf('}'))+`
 let hookMode='none';await context.commands.register('hook-mode',(mode:string)=>{hookMode=mode;});await context.commands.register('hook-list',()=>context.hooks.list());await context.commands.register('hook-run',(input:{label:string})=>sceneReview.run(input));await context.commands.register('hook-dispose',()=>sceneReview.dispose());
 await context.hooks.register('project.willSave',async()=>{if(hookMode!=='none'&&hookMode!=='validate'){const result=sceneReview.run({label:hookMode==='refuse-caught'?'refuse':hookMode});if(hookMode==='refuse-caught')await result.catch(()=>{});else await result;}});
 await context.hooks.register('project.validateSave',async()=>{if(hookMode==='validate')await sceneReview.run({label:'prepare'});});
 function checkTypes(){sceneReview.run({label:'typed'});\n// @ts-expect-error hook input must match its inferred contract\nsceneReview.run({label:1});}
 }\n`;await fs.writeFile(owner,code);
 const helper=path.join(directory,'scene-reviewer/src/extension.ts');code=await fs.readFile(helper,'utf8');code=code.slice(0,code.lastIndexOf('}'))+`
 let staged=false,release:undefined|(()=>void);await context.commands.register('status',()=>({staged}));await context.commands.register('release',()=>release?.());await context.commands.register('allow',(value:boolean)=>context.configuration.update({key:'allow-scenes',value}));await registration.dispose();
 registration=await context.hooks.register('clipcraft-examples.sdk-workbench.scene-review',contract,async(input,control)=>{
  staged=false;if(['prepare','wait','refuse'].includes(input.label)){
   const types=await context.timeline.types({pluginId:'clipcraft-examples.sdk-workbench'}),track=types.items.find(row=>row.category==='track'&&row.id==='notes'&&row.preferred),clip=types.items.find(row=>row.category==='clip'&&row.id==='note'&&row.preferred);if(!track||!clip)throw Error('Fixture types unavailable');const scope=await context.timeline.read({section:'clips'});
   await context.timeline.apply({documentId:scope.documentId,projectRevision:scope.projectRevision,operations:[{type:'create-track',id:'hook-track',typeId:track.typeId},{type:'create-clip',id:'hook-note',trackId:'hook-track',typeId:clip.typeId,start_sec:0,duration_sec:1,data:{text:'Prepared by a custom hook'}}]});staged=true;
   if(input.label==='wait')await new Promise<void>(resolve=>{release=resolve;if(control.signal.aborted)resolve();else control.signal.addEventListener('abort',()=>resolve(),{once:true});});
   if(input.label==='refuse')return {approved:1,note:'Invalid callback output'} as any;
  }
  return review(input);
 },{order:10});
 }\n`;await fs.writeFile(helper,code);
 const sdk=require('../../../packages/plugin-sdk/dist/authoring.cjs'),archives=[];for(const name of ['sdk-workbench','scene-reviewer']){const built=await sdk.buildPlugin(path.join(directory,name)),archive=path.join(directory,name+'.tgz');await sdk.packPlugin(built.directory,archive);archives.push({key:built.key,archive});}
 await fs.writeFile(path.join(directory,'fixtures.json'),JSON.stringify({archives}));await fs.mkdir(path.join(directory,'settings-test'));await fs.writeFile(path.join(directory,'settings-test/settings.json'),JSON.stringify({language:'en',firstRun:{tourSeen:true,packPromptSeen:true}}));
 const fd=sync.openSync(path.join(directory,'runtime.log'),'w');try{for(const phase of [0,1]){const child=spawn(require('electron'),[root],{cwd:root,stdio:['ignore',fd,fd],env:{...process.env,FVE_SMOKE:directory,FVE_SMOKE_MODE:'extension-custom-hooks',FVE_CUSTOM_HOOKS_REOPEN:String(phase),FVE_SMOKE_QUIET:'1',CLIPCRAFT_DEV_EXAMPLES:'0',VITE_DEV_SERVER_URL:''}}),timer=setTimeout(()=>child.kill('SIGKILL'),180000),code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});clearTimeout(timer);const result=JSON.parse(await fs.readFile(path.join(directory,phase?'restart-result.json':'result.json'),'utf8'));assert.equal(code,0,result.error);assert.ok(result.ok,result.error);}}finally{sync.closeSync(fd);}
 console.log('Native custom hooks verified: '+directory);
})().catch(error=>{console.error(error);process.exitCode=1;});
