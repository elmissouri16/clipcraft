const fs=require('node:fs/promises'),sync=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),{spawn}=require('node:child_process');
(async()=>{
 const root=path.resolve(__dirname,'../../..'),directory=await fs.mkdtemp(path.join(os.tmpdir(),'clipcraft-document-hooks-ui-'));console.log('Document lifecycle evidence: '+directory);await require('../../../scripts/build-plugin-sdk.cjs').buildSdk();
 const sdk=require('../../../packages/plugin-sdk/dist/authoring.cjs'),archives=[];
 for(const [name,order] of [['late',20],['early',10]]){
  const source=path.join(directory,name);await fs.mkdir(path.join(source,'src'),{recursive:true});await fs.writeFile(path.join(source,'plugin.json'),JSON.stringify({id:'fixture.lifecycle-'+name,name:'Lifecycle '+name,publisher:'ClipCraft tests',version:'0.1.0',apiVersion:1,main:'dist/extension.cjs',contributes:{commands:[{id:'mode',name:'Set lifecycle mode'}]}}));
  await fs.writeFile(path.join(source,'src/extension.ts'),`import type {ExtensionContext,DocumentHookContext} from '@clipcraft/plugin-sdk/extension';
export async function activate(c:ExtensionContext){
 let mode='none',staged=false,aborted=false,release:undefined|(()=>void);const events:any[]=[];
 await c.commands.register('mode',(value:string)=>{mode=value;staged=false;aborted=false;});await c.commands.register('status',()=>({mode,staged,aborted,events}));await c.commands.register('release',()=>release?.());
 await c.commands.register('project',async(input:any)=>(c.projects as any)[input.method](input.input));
 const marker=async(label:string)=>{const scope=await c.workspace.inspect({section:'markers'});return c.markers.apply({documentId:scope.documentId,projectRevision:scope.projectRevision,operations:[{type:'add',time_sec:0,label}]});};
 await c.commands.register('marker',()=>marker('Ordinary edit'));
 const record=async(input:DocumentHookContext)=>{const snapshot=await c.workspace.read(),status=await c.projects.status(),event={name:input.kind,phase:input.phase,transition:input.transition,documentName:snapshot.name,statusOpen:status.open};events.push(event);await c.log('lifecycle:'+JSON.stringify(event));};
 await c.hooks.register('project.validateClose',async input=>{await record(input);if(mode==='veto')return {cancel:'Lifecycle veto keeps this document open'};},{order:${order}});
 await c.hooks.register('project.willClose',async(input,{signal})=>{await record(input);if(['prepare','wait','fail'].includes(mode)){await marker('Close preparation one');await marker('Close preparation two');}if(mode==='settings'){const scope=await c.workspace.inspect({section:'project'});await c.configuration.update({scope:'project',documentId:scope.documentId,key:'closed',value:'prepared'});}if(mode==='fail')throw Error('Lifecycle preparation fixture failed');if(mode==='wait'){staged=true;await new Promise<void>(resolve=>{release=resolve;if(signal.aborted)resolve();else signal.addEventListener('abort',()=>resolve(),{once:true});});aborted=signal.aborted;}},{order:${order}});
 for(const name of ['project.didOpen','project.didCreate','project.didClose'] as const)await c.hooks.register(name,async input=>{await record(input);if(mode==='bad-observer')throw Error('Lifecycle observer fixture failed');if(mode==='readonly'){let refused=false;try{await marker('Forbidden observer edit');}catch{refused=true;}if(!refused)throw Error('Observer unexpectedly wrote a marker');}},{order:${order}});
}
`);
  const built=await sdk.buildPlugin(source),archive=path.join(directory,name+'.tgz');await sdk.packPlugin(built.directory,archive);archives.push({id:'fixture.lifecycle-'+name,key:built.key,archive});
 }
 await fs.writeFile(path.join(directory,'fixtures.json'),JSON.stringify({archives}));await fs.mkdir(path.join(directory,'settings-test'));await fs.writeFile(path.join(directory,'settings-test/settings.json'),JSON.stringify({language:'en',firstRun:{tourSeen:true,packPromptSeen:true}}));
 const fd=sync.openSync(path.join(directory,'runtime.log'),'w');try{for(const phase of [0,1]){const child=spawn(require('electron'),[root],{cwd:root,stdio:['ignore',fd,fd],env:{...process.env,FVE_SMOKE:directory,FVE_SMOKE_MODE:'extension-document-hooks',FVE_DOCUMENT_HOOKS_REOPEN:String(phase),FVE_SMOKE_QUIET:'1',CLIPCRAFT_DEV_EXAMPLES:'0',VITE_DEV_SERVER_URL:''}}),timer=setTimeout(()=>child.kill('SIGKILL'),180000),code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});clearTimeout(timer);const result=JSON.parse(await fs.readFile(path.join(directory,phase?'restart-result.json':'result.json'),'utf8'));assert.equal(code,0,result.error);assert.ok(result.ok,result.error);}}finally{sync.closeSync(fd);}
 console.log('Document lifecycle native workflow passed: '+directory);
})().catch(error=>{console.error(error);process.exitCode=1;});
