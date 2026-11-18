const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict'),{spawn}=require('node:child_process');
(async()=>{
 const root=path.resolve(__dirname,'../../..'),dir=await fs.mkdtemp(path.join(os.tmpdir(),'clipcraft-sdk-additions-ui-'));
 await require('../../../scripts/build-plugin-sdk.cjs').buildSdk();const sdk=require('../../../packages/plugin-sdk/dist/authoring.cjs');
 const contract=`const contract=defineServiceContract({version:1,methods:{double:{input:{type:'integer',minimum:0},output:{type:'integer',minimum:0}},bad:{input:{type:'null'},output:{type:'integer'}},chunks:{input:{type:'null'},output:{type:'integer'},stream:true}}});`;
 const entries={provider:`${contract}
 export async function activate(c:ExtensionContext){let calls=0;await c.services.registerTyped('math',contract,{double:input=>{calls++;return input*2;},bad:()=>('invalid' as any),async *chunks(){yield 1;yield 'invalid' as any;}});await c.commands.register('calls',()=>calls);}`,
 consumer:`${contract}
 export async function activate(c:ExtensionContext){let mode='off',validationAttempted=false,validationRejected=false;const events:unknown[]=[];const sub=c.events.on('configuration.changed',value=>{events.push(value);});await sub.ready;
  await c.commands.register('hook-mode',(input:{mode:string})=>{mode=input.mode;return true;});await c.commands.register('hook-status',()=>({validationAttempted,validationRejected}));await c.hooks.register('project.validateSave',async()=>{if(mode==='deny'){validationAttempted=true;const {documentId}=await c.workspace.read();try{await c.configuration.update({scope:'project',documentId,key:'denied',value:true});}catch(error){validationRejected=true;throw error;}}});await c.hooks.register('project.willSave',async()=>{if(mode==='prepare'){const {documentId}=await c.workspace.read();await c.configuration.update({scope:'project',documentId,key:'hook',value:1});}});
  await c.commands.register('capabilities',()=>c.host.capabilities());
  await c.commands.register('types',async()=>{const client=await c.services.connect('fixture.sdk-provider.math',contract);const doubled=await client.call('double',4);const number:number=doubled;if(false){
   // @ts-expect-error typed inputs reject strings
   await client.call('double','wrong');
   // @ts-expect-error streaming methods cannot be called as unary methods
   await client.call('chunks',null);
   // @ts-expect-error project scope requires a document anchor
   await c.configuration.get('value',{scope:'project'});
   // @ts-expect-error global settings cannot carry a document anchor
   await c.configuration.update({key:'value',value:1,scope:'global',documentId:'wrong'});
  }let invalid=false,bad=false,stream=false,mismatch=false,count=0;
  try{await c.services.call('fixture.sdk-provider.math','double','wrong');}catch{invalid=true;}
  try{await client.call('bad',null);}catch{bad=true;}
  try{for await(const value of client.stream('chunks',null)){const typed:number=value;count++;}}catch{stream=true;}
  try{await c.services.connect('fixture.sdk-provider.math',{...contract,version:2});}catch{mismatch=true;}
  return {number,invalid,bad,stream,mismatch,count};});
  await c.commands.register('project',async(input:{value?:unknown;documentId?:string;write?:boolean})=>{const documentId=input.documentId??(await c.workspace.read()).documentId;if(input.write)await c.configuration.update({key:'value',value:input.value,scope:'project',documentId});return {documentId,value:await c.configuration.get('value',{scope:'project',documentId})};});
  await c.commands.register('global',async()=>{await c.configuration.update({key:'value',value:'global'});return c.configuration.get('value');});
  await c.commands.register('events',()=>events);
  await c.commands.register('debug',async(input:{value:number})=>{
   const next=input.value+1;
   const output=next*2;
   return output;
  });
 }`};
 const fixtures={};for(const [name,entry]of Object.entries(entries)){
  const source=path.join(dir,name);await fs.mkdir(path.join(source,'src'),{recursive:true});await fs.mkdir(path.join(source,'node_modules/@clipcraft'),{recursive:true});await fs.symlink(path.join(root,'packages/plugin-sdk'),path.join(source,'node_modules/@clipcraft/plugin-sdk'),'dir');const id='fixture.sdk-'+name;
  await fs.writeFile(path.join(source,'plugin.json'),JSON.stringify({id,name:'SDK '+name,publisher:'ClipCraft tests',version:'0.1.0',apiVersion:1,main:'dist/extension.cjs',contributes:{commands:[]}}));
  await fs.writeFile(path.join(source,'src/extension.ts'),`import {defineServiceContract,type ExtensionContext} from '@clipcraft/plugin-sdk/extension';\n`+entry);
  const built=await sdk.buildPlugin(source);assert.equal(built.typecheck,'passed');if(name==='provider'){const archive=path.join(dir,name+'.tgz');await sdk.packPlugin(built.directory,archive);fixtures[name]=archive;}else fixtures[name]=built.directory;
 }
 await fs.writeFile(path.join(dir,'fixtures.json'),JSON.stringify(fixtures));await fs.mkdir(path.join(dir,'settings-test'));await fs.writeFile(path.join(dir,'settings-test/settings.json'),JSON.stringify({language:'en',firstRun:{tourSeen:true,packPromptSeen:true}}));
 const child=spawn(require('electron'),[root,'--user-data-dir='+path.join(dir,'user-data')],{cwd:root,env:{...process.env,FVE_SMOKE:dir,FVE_SMOKE_MODE:'extension-sdk-additions',FVE_SMOKE_QUIET:'1',VITE_DEV_SERVER_URL:'',CLIPCRAFT_DEV_EXAMPLES:'0'},stdio:['ignore','pipe','pipe']});let log='';child.stdout.on('data',v=>{log+=v;require('node:fs').appendFileSync(path.join(dir,'runtime-live.log'),v);});child.stderr.on('data',v=>{log+=v;require('node:fs').appendFileSync(path.join(dir,'runtime-live.log'),v);});const timer=setTimeout(()=>child.kill('SIGKILL'),180000),code=await new Promise(resolve=>child.once('exit',resolve));clearTimeout(timer);await fs.writeFile(path.join(dir,'runtime.log'),log);const result=await fs.readFile(path.join(dir,'result.json')).then(JSON.parse).catch(()=>({error:log}));assert.equal(code,0,result.error||log);assert.ok(result.ok,result.error||log);console.log('SDK additions real-app verification: '+dir);console.log(JSON.stringify(result.checks));
})().catch(error=>{console.error(error);process.exitCode=1;});
