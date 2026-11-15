const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),{spawn,execFile}=require('node:child_process'),{promisify}=require('node:util');
const runFile=promisify(execFile),repo=path.resolve(__dirname,'../../..'),sdk=path.join(repo,'packages/plugin-sdk');
(async()=>{
 const evidence=await fs.mkdtemp(path.join(os.tmpdir(),'clipcraft-sdk-cli-')),records=[];
 const check=(name,fn)=>{fn();records.push(name);console.log('PASS',name);};
 const record=name=>check(name,()=>{});
 try{
  await require('../../../scripts/build-plugin-sdk.cjs').buildSdk();
  const packed=await runFile('npm',['pack','--ignore-scripts','--json','--pack-destination',evidence],{cwd:sdk});
  const archive=path.join(evidence,JSON.parse(packed.stdout)[0].filename),consumer=path.join(evidence,'consumer');await fs.mkdir(consumer);await fs.writeFile(path.join(consumer,'package.json'),'{"private":true,"type":"module"}');
  await runFile('npm',['install','--offline','--ignore-scripts','--no-audit','--no-fund',archive],{cwd:consumer,timeout:60000});
  const installed=path.join(consumer,'node_modules/@clipcraft/plugin-sdk'),cli=path.join(installed,'dist/cli.cjs');
  const {createPlugin,buildPlugin,validatePlugin,packPlugin,checkPlugin}=require(path.join(installed,'dist/authoring.cjs'));
  check('clean SDK install includes public exports, CLI, types and license',()=>assert.ok(require(path.join(installed,'package.json')).exports['.'].types));
  check('distribution has no dependency on checkout source paths',()=>assert.equal(require(path.join(installed,'package.json')).files.includes('src'),false));
  const cliCall=async(args,code=0)=>{try{const result=await runFile(process.execPath,[cli,...args,'--json'],{timeout:45000});assert.equal(code,0,result.stdout);return JSON.parse(result.stdout);}catch(error){if(!error.stdout)throw error;assert.equal(error.code,code,error.stdout);return JSON.parse(error.stdout);}};
  const panel=path.join(evidence,'panel-project');await createPlugin(panel,{id:'studio.panel',name:'SDK panel',publisher:'Studio',template:'panel'});
  await runFile('npm',['install','--offline','--ignore-scripts','--no-audit','--no-fund'],{cwd:panel});
  let built=await buildPlugin(panel);record('scaffolded TypeScript panel and command build with a cleanly installed SDK');
  const native=require('../../../electron/plugins/package.cjs'),host=await native.validateFiles(await native.readFolder(built.directory),'2.0.0');check('SDK and editor produce the identical fingerprint',()=>assert.equal(built.key,host.key));
  check('installable output excludes source, dependency and build metadata files',()=>assert.deepEqual(built.files.sort(),['commands.js','panel.css','panel.html','panel.js','plugin.json']));
  await assert.rejects(validatePlugin(panel),e=>e.code==='VALIDATION_FAILED');record('source workspace cannot be installed as compiled payload');
  const packagePath=path.join(evidence,'panel.tgz');await packPlugin(built.directory,packagePath);assert.equal((await validatePlugin(packagePath)).key,built.key);record('packaged byte snapshot validates against both SDK and host');
  await assert.rejects(packPlugin(built.directory,packagePath),e=>e.code==='OUTPUT_EXISTS');record('packaging refuses overwrite');
  await assert.rejects(createPlugin(panel,{id:'studio.other',name:'Other',publisher:'Studio'}),e=>e.code==='OUTPUT_EXISTS');record('scaffolding refuses an existing directory');
  const original=await fs.readFile(path.join(panel,'src/commands.ts'),'utf8'),lastGood=built.key;
  await fs.writeFile(path.join(panel,'src/commands.ts'),original+'\nconst wrong: number = "text";\n');await assert.rejects(buildPlugin(panel),e=>e.code==='TYPECHECK_FAILED');assert.equal((await validatePlugin(built.directory)).key,lastGood);record('type errors preserve the last validated output');
  await fs.writeFile(path.join(panel,'tsconfig.json'),'{"include":[]}');await assert.rejects(checkPlugin(panel),e=>e.code==='TYPECHECK_FAILED');record('excluding required entries cannot bypass SDK type checking');
  await fs.writeFile(path.join(panel,'src/commands.ts'),original);await buildPlugin(panel);
  await fs.appendFile(path.join(panel,'dist/commands.js'),'\n// modified output');await assert.rejects(buildPlugin(panel),e=>e.code==='OUTPUT_EXISTS');record('modified output is protected from an SDK rebuild');await fs.rm(path.join(panel,'dist'),{recursive:true});await buildPlugin(panel);
  await fs.writeFile(path.join(panel,'src/commands.ts'),'export async function run(context:unknown,input:{module:string}){ await import(input.module); }');await assert.rejects(buildPlugin(panel),e=>e.code==='UNSUPPORTED_IMPORT');record('nonliteral dynamic imports rejected before installation');
  await fs.writeFile(path.join(panel,'src/commands.ts'),'export const other=1;');await assert.rejects(buildPlugin(panel),e=>e.code==='MISSING_EXPORT');record('commands require an exported run entry');
  await fs.writeFile(path.join(panel,'src/commands.ts'),original);await buildPlugin(panel);
  const bad=await cliCall(['validate',built.directory,'--app-version','1.0.0'],1);check('compatibility errors use nonzero exit and structured diagnostics',()=>assert.equal(bad.error.code,'VALIDATION_FAILED'));
  const unknown=await cliCall(['build',panel,'--shell','bad'],1);check('unknown CLI flags rejected',()=>assert.equal(unknown.error.code,'INVALID_ARGUMENT'));
  await fs.writeFile(path.join(panel,'.clipcraft-build.lock'),'locked');await assert.rejects(buildPlugin(panel),e=>e.code==='BUILD_BUSY');await fs.rm(path.join(panel,'.clipcraft-build.lock'));record('concurrent workspace builds refuse to share output ownership');
  const exampleFolder=path.join(repo,'examples/plugins'),exampleManifests=[];for(const entry of await fs.readdir(exampleFolder,{withFileTypes:true}))if(entry.isDirectory())exampleManifests.push(JSON.parse(await fs.readFile(path.join(exampleFolder,entry.name,'plugin.json'),'utf8')));
  await fs.writeFile(path.join(panel,'manifest-types.ts'),`import type {PluginManifest} from '@clipcraft/plugin-sdk';\nexport const manifests = ${JSON.stringify(exampleManifests)} satisfies PluginManifest[];\n`);
  await fs.writeFile(path.join(panel,'positive.ts'),`import {defineCommand,connectPanel,type PluginManifest} from '@clipcraft/plugin-sdk';\nimport type {Validation} from '@clipcraft/plugin-sdk/authoring';\nconst plugin:PluginManifest={id:'studio.a',name:'A',publisher:'Studio',version:'1.0.0',apiVersion:1,contributes:{effects:[]}};\nconst run=defineCommand(async (context,input:{count:number})=>{await context.markers.add([{time:1,label:'Marker'}]);return {message:String(input.count)};});\nasync function panel(){const client=await connectPanel();client.storage.set('x',{a:[null,true,1]});client.dispose();}\n`);
  await fs.writeFile(path.join(panel,'editor-types.ts'),`import type {CommandContext,PanelClient,ActionDefinition} from '@clipcraft/plugin-sdk';
const action:ActionDefinition={id:'run',commandId:'run',label:'Run',icon:'layers',locations:['plugins-menu','clip-menu'],when:{selection:'single',lanes:['text']}};
// @ts-expect-error Arbitrary UI insertion locations are unsupported.
const toolbar:ActionDefinition={id:'run',commandId:'run',label:'Run',locations:['toolbar']};
// @ts-expect-error Conditions cannot be executable strings.
const code:ActionDefinition={id:'run',commandId:'run',label:'Run',locations:['plugins-menu'],when:'selection.length > 0'};
async function checkEditor(context:CommandContext,panel:PanelClient){
 const snapshot=await context.editor.read();
 await context.editor.stage({documentId:snapshot.documentId,revision:snapshot.revision,operations:[{type:'move',clipId:'c-1',start_sec:2},{type:'trim',clipId:'c-1',start_sec:2,end_sec:3}]});
 await context.editor.stage({documentId:snapshot.documentId,revision:snapshot.revision,operations:[{type:'reorder',clipId:'c-1',beforeClipId:null,gaps:'preserve',transitions:'reject'}]});
 await context.editor.stage({documentId:snapshot.documentId,revision:snapshot.revision,operations:[{type:'split',clipId:'c-1',at_sec:2,gaps:'preserve-time',transitions:'reject'},{type:'trim-main',clipId:'c-1',start_sec:1,end_sec:2,gaps:'preserve-time',transitions:'preserve-overlap'}]});
 // @ts-expect-error Main splits cannot accept plugin-authored raw IDs.
 await context.editor.stage({documentId:'d',revision:1,operations:[{type:'split',clipId:'c-1',at_sec:2,gaps:'preserve-time',transitions:'reject',newId:'raw'}]});
 // @ts-expect-error Main trimming requires a non-ripple gap policy.
 await context.editor.stage({documentId:'d',revision:1,operations:[{type:'trim-main',clipId:'c-1',start_sec:1,end_sec:2,gaps:'ripple',transitions:'reject'}]});
 await context.editor.stage({documentId:snapshot.documentId,revision:snapshot.revision,operations:[{type:'split-linked',clipId:'c-1',partnerClipId:'c-2',at_sec:2,gaps:'preserve-time',transitions:'reject'},{type:'trim-linked',clipId:'c-1',partnerClipId:'c-2',start_sec:1,end_sec:2,gaps:'preserve-time',transitions:'preserve-overlap'}]});
 const group=snapshot.timeline.clips[0]?.link?.groupId,partner=snapshot.timeline.clips[0]?.link?.partnerId;
 // @ts-expect-error Linked writes require an explicit partner handle.
 await context.editor.stage({documentId:'d',revision:1,operations:[{type:'split-linked',clipId:'c-1',at_sec:2,gaps:'preserve-time',transitions:'reject'}]});
 // @ts-expect-error Plugins cannot create raw link IDs.
 await context.editor.stage({documentId:'d',revision:1,operations:[{type:'split-linked',clipId:'c-1',partnerClipId:'c-2',at_sec:2,gaps:'preserve-time',transitions:'reject',linkId:'raw'}]});
 // @ts-expect-error Link snapshots are read-only.
 snapshot.timeline.clips[0]!.link!.partnerId='c-3';
 const mainIndex=snapshot.timeline.clips[0]?.main?.index;
 // @ts-expect-error Reordering requires an explicit transition policy.
 await context.editor.stage({documentId:'d',revision:1,operations:[{type:'reorder',clipId:'c-1',beforeClipId:null,gaps:'preserve'}]});
 // @ts-expect-error Implicit transition preservation is not supported.
 await context.editor.stage({documentId:'d',revision:1,operations:[{type:'reorder',clipId:'c-1',beforeClipId:null,gaps:'preserve',transitions:'preserve'}]});
 // @ts-expect-error Editor snapshots cannot be mutated.
 snapshot.playhead.time_sec=2;
 // @ts-expect-error The transaction contract has no arbitrary delete or patch.
 await context.editor.stage({documentId:'d',revision:1,operations:[{type:'delete',clipId:'c-1'}]});
 // @ts-expect-error Panels have no direct staging capability.
 await panel.editor.stage({documentId:'d',revision:1,operations:[]});
}
`);
  const resolvedTsc=require.resolve('typescript/bin/tsc',{paths:[installed]});
  await runFile(process.execPath,[resolvedTsc,'--noEmit','--strict','--target','ES2022','--module','NodeNext','--moduleResolution','NodeNext',path.join(panel,'positive.ts'),path.join(panel,'manifest-types.ts'),path.join(panel,'editor-types.ts')]);record('public ESM and authoring declarations work in a NodeNext consumer');
  await fs.writeFile(path.join(panel,'negative.ts'),`import {connectPanel,defineCommand,type PluginManifest} from '@clipcraft/plugin-sdk';\nasync function x(){const c=await connectPanel();c.dispatch({type:'delete'});await c.storage.set('x',()=>{});}\nconst p:PluginManifest={id:'a.b',name:'A',publisher:'B',version:'1.0.0',apiVersion:99,contributes:{},permissions:['filesystem']};\ndefineCommand(async ctx=>{await ctx.markers.add([{time:'wrong',label:'x'}]);});\n`);
  await assert.rejects(runFile(process.execPath,[resolvedTsc,'--noEmit','--strict','--target','ES2022','--module','ESNext','--moduleResolution','Bundler',path.join(panel,'negative.ts')]));record('public types reject invented editor APIs, non-JSON values and invalid contracts');
  for(const template of ['command','effect','transition','export-preset','ai-provider']){
   const project=path.join(evidence,template);await createPlugin(project,{id:'studio.'+template,name:'SDK '+template,publisher:'Studio',template});
   if(template==='command')await runFile('npm',['install','--offline','--ignore-scripts','--no-audit','--no-fund'],{cwd:project});
   const result=await buildPlugin(project);assert.equal((await validatePlugin(result.directory)).key,result.key);record(template+' scaffold builds an editor-compatible payload');
   if(template==='command'){const shape=JSON.parse(await fs.readFile(path.join(result.directory,'plugin.json')));assert.equal(shape.contributes.actions[0].commandId,'run');assert.deepEqual(shape.contributes.actions[0].locations,['plugins-menu']);record('command scaffold registers its starter action in the Plugins menu');}
  }
  const examples=path.join(repo,'examples/plugins');for(const entry of await fs.readdir(examples,{withFileTypes:true})){if(entry.isDirectory()){const folder=path.join(examples,entry.name);const result=await validatePlugin(folder),nativeBundle=await native.validateFiles(await native.readFolder(folder),'2.0.0');assert.equal(result.key,nativeBundle.key);record('canonical validator parity: '+entry.name);}}
  // Watch a data-only project to keep rebuild verification independent of compiler latency.
  const watched=path.join(evidence,'effect'),events=[];let stderr='';const child=spawn(process.execPath,[cli,'watch',watched,'--json'],{stdio:['ignore','pipe','pipe']});let buffer='';child.stdout.on('data',chunk=>{buffer+=chunk;const lines=buffer.split('\n');buffer=lines.pop();for(const line of lines){try{events.push(JSON.parse(line));}catch{}}});child.stderr.on('data',chunk=>stderr+=chunk);
  try{
   const until=async fn=>{for(let i=0;i<300;i++){if(fn())return;await new Promise(r=>setTimeout(r,30));}throw Error('Watch timeout '+stderr);};
   await until(()=>events.some(e=>e.event==='watching'));const file=path.join(watched,'plugin.json'),m=JSON.parse(await fs.readFile(file));m.contributes.effects[0].name='Renamed effect';await fs.writeFile(file,JSON.stringify(m));await until(()=>events.filter(e=>e.event==='built').length===2);check('watch rebuilds local files and warns about reused immutable version',()=>assert.ok(events.some(e=>e.code==='VERSION_REUSED')));
   await fs.writeFile(file,'{invalid');await until(()=>events.some(e=>e.ok===false));m.version='0.1.1';await fs.writeFile(file,JSON.stringify(m));await until(()=>events.some(e=>e.manifest?.version==='0.1.1'));record('watch recovers from invalid input without launching the editor');
  }finally{child.kill('SIGTERM');}
  const summary={ok:true,checks:records.length,passed:records,archive,panelDirectory:panel};await fs.writeFile(path.join(evidence,'result.json'),JSON.stringify(summary,null,2));console.log('SDK authoring evidence: '+evidence);
 }catch(error){await fs.writeFile(path.join(evidence,'result.json'),JSON.stringify({ok:false,error:error.stack,passed:records},null,2));throw error;}
})().catch(error=>{console.error(error);process.exitCode=1;});
