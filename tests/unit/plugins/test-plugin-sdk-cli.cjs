// Clean-install public SDK, strict authoring, immutable output, archive parity and watch recovery.
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),{spawn,execFile}=require('node:child_process'),{promisify}=require('node:util');
const runFile=promisify(execFile),repo=path.resolve(__dirname,'../../..');
const runNpm=(args,options)=>{const command=require('../../../scripts/npm-command.cjs').npmCommand(args);return runFile(command.command,command.args,options);};
(async()=>{
 const evidence=await fs.mkdtemp(path.join(os.tmpdir(),'clipcraft-sdk-cli-')),records=[];
 const record=name=>{records.push(name);console.log('PASS',name);};
 try{
  await require('../../../scripts/build-plugin-sdk.cjs').buildSdk();
  const packed=await runNpm(['pack','--ignore-scripts','--json','--pack-destination',evidence],{cwd:path.join(repo,'packages/plugin-sdk')}),archive=path.join(evidence,JSON.parse(packed.stdout)[0].filename),consumer=path.join(evidence,'consumer');await fs.mkdir(consumer);await fs.writeFile(path.join(consumer,'package.json'),'{"private":true,"type":"module"}');
  await runNpm(['install','--offline','--ignore-scripts','--no-audit','--no-fund',archive],{cwd:consumer,timeout:60000});
  const installed=path.join(consumer,'node_modules/@clipcraft/plugin-sdk'),cli=path.join(installed,'dist/cli.cjs'),sdk=require(path.join(installed,'dist/authoring.cjs')),native=require('../../../electron/plugins/package.cjs');
  assert.ok(require(path.join(installed,'package.json')).exports['.'].types);assert.equal(require(path.join(installed,'package.json')).files.includes('src'),false);record('offline tarball consumer has public types, CLI and no checkout dependency');
  const cliCall=async(args,code=0)=>{try{const result=await runFile(process.execPath,[cli,...args,'--json'],{timeout:45000});assert.equal(code,0,result.stdout);return JSON.parse(result.stdout);}catch(error){if(!error.stdout)throw error;assert.equal(error.code,code,error.stdout);return JSON.parse(error.stdout);}};
  // Spaces, dollar signs and backticks are literal filesystem names, never shell input.
  const source=path.join(evidence,'node project $ literal ` text');await sdk.createPlugin(source,{id:'studio.author',name:'SDK author',publisher:'Studio'});
  const built=await sdk.buildPlugin(source);assert.equal(built.typecheck,'passed');assert.equal(built.manifest.main,'dist/extension.cjs');assert.deepEqual(built.files.sort(),['dist/extension.cjs','plugin.json']);assert.equal((await native.validateFiles(await native.readFolder(built.directory),'2.0.0')).key,built.key);record('default Node template strictly builds a canonical native payload from literal paths');
  await assert.rejects(sdk.validatePlugin(source),{code:'VALIDATION_FAILED'});const output=path.join(evidence,'node.tgz');await sdk.packPlugin(built.directory,output);assert.equal((await sdk.validatePlugin(output)).key,built.key);assert.equal((await cliCall(['inspect',output])).migrationRequired,false);record('source is not installable; archive and CLI inspection retain exact package fingerprint');
  await assert.rejects(sdk.packPlugin(built.directory,output),{code:'OUTPUT_EXISTS'});await assert.rejects(sdk.createPlugin(source,{id:'studio.other',name:'Other',publisher:'Studio'}),{code:'OUTPUT_EXISTS'});record('scaffolding and packing protect existing output');
  const entry=path.join(source,'src/extension.ts'),original=await fs.readFile(entry,'utf8');await fs.writeFile(entry,original+'\nconst wrong:number="text";\n');await fs.writeFile(path.join(source,'tsconfig.json'),'{"include":[]}');await assert.rejects(sdk.buildPlugin(source),{code:'TYPECHECK_FAILED'});assert.equal((await sdk.validatePlugin(built.directory)).key,built.key);record('author configuration cannot bypass strict checks and type failures preserve the last valid build');
  await fs.writeFile(entry,original);await sdk.buildPlugin(source);await fs.appendFile(path.join(built.directory,'dist/extension.cjs'),'\n// external modification');await assert.rejects(sdk.buildPlugin(source),{code:'OUTPUT_EXISTS'});await fs.rm(built.directory,{recursive:true});await sdk.buildPlugin(source);record('SDK refuses to replace externally modified build output');
  await fs.writeFile(path.join(source,'.clipcraft-build.lock'),'locked');await assert.rejects(sdk.buildPlugin(source),{code:'BUILD_BUSY'});await fs.rm(path.join(source,'.clipcraft-build.lock'));record('concurrent builders cannot share output ownership');
  assert.equal((await cliCall(['validate',built.directory,'--app-version','1.0.0'],1)).error.code,'VALIDATION_FAILED');assert.equal((await cliCall(['build',source,'--shell','bad'],1)).error.code,'INVALID_ARGUMENT');assert.equal((await cliCall(['create',path.join(evidence,'retired'),'--id','studio.retired','--name','Retired','--publisher','Studio','--template','panel'],1)).error.code,'MIGRATION_REQUIRED');record('CLI rejects incompatible hosts, unknown flags and retired executable templates with structured errors');
  for(const template of sdk.TEMPLATES){if(template==='extension')continue;const project=path.join(evidence,template);await sdk.createPlugin(project,{id:'studio.'+template,name:'SDK '+template,publisher:'Studio',template});const value=await sdk.buildPlugin(project);assert.equal((await sdk.validatePlugin(value.directory)).key,value.key);record(template+' template builds without an executable recipe');}
  const manifests=[];for(const entry of await fs.readdir(path.join(repo,'examples/plugins'),{withFileTypes:true})){if(!entry.isDirectory())continue;const folder=path.join(repo,'examples/plugins',entry.name),value=await sdk.validatePlugin(folder);assert.equal((await native.validateFiles(await native.readFolder(folder),'2.0.0')).key,value.key);manifests.push(JSON.parse(await fs.readFile(path.join(folder,'plugin.json'))));}record('all shipped creative examples share SDK/native validation and fingerprints');
  await fs.writeFile(path.join(consumer,'types.ts'),`import {definePlugin,defineExtension,type PluginManifest,type FontContribution,type SoundContribution} from '@clipcraft/plugin-sdk';
import type {ExtensionContext,NativeUiLocation} from '@clipcraft/plugin-sdk/extension';
import type {Template,Validation} from '@clipcraft/plugin-sdk/authoring';
const examples=${JSON.stringify(manifests)} satisfies PluginManifest[];
const font:FontContribution={id:'display',name:'Display',license:'OFL',faces:[{file:'assets/font.woff2',weight:400,style:'normal'}]};
const sound:SoundContribution={id:'tone',name:'Tone',kind:'sfx',file:'assets/tone.wav',license:'CC0'};
const location:NativeUiLocation='export';const template:Template='extension';
defineExtension({async activate(c:ExtensionContext){await c.commands.register('hello',async()=>({message:'Hello'}));await c.services.register('ordinary',{async run(){return {ok:true};}});await c.editor.apply({documentId:'d',revision:1,operations:[]});}});
// @ts-expect-error Retired templates are not public authoring options.
const panel:Template='panel';
// @ts-expect-error Specialized provider declarations are retired.
const specialized:PluginManifest={id:'studio.a',name:'A',publisher:'Studio',version:'1.0.0',apiVersion:1,contributes:{aiProviders:[]}};
// @ts-expect-error Arbitrary UI locations cannot inject host HTML.
const invalidLocation:NativeUiLocation='host-html';
// @ts-expect-error Sounds have an explicit audio vocabulary.
const invalidSound:SoundContribution={...sound,kind:'video'};
// @ts-expect-error Retired connection helper is not exported.
import {connectPanel} from '@clipcraft/plugin-sdk';
`);
  const compilerPackage=require.resolve('typescript/package.json',{paths:[installed]}),tsc=path.resolve(path.dirname(compilerPackage),require(compilerPackage).bin.tsc);await runFile(process.execPath,[tsc,'--ignoreConfig','--noEmit','--strict','--target','ES2022','--module','NodeNext','--moduleResolution','NodeNext',path.join(consumer,'types.ts')]);record('clean NodeNext consumer accepts general/creative APIs and rejects retired public types');
  const watched=path.join(evidence,'effect'),events=[];let stderr='',buffer='';const child=spawn(process.execPath,[cli,'watch',watched,'--json'],{stdio:['ignore','pipe','pipe']});child.stdout.on('data',chunk=>{buffer+=chunk;const lines=buffer.split('\n');buffer=lines.pop();for(const line of lines)try{events.push(JSON.parse(line));}catch{}});child.stderr.on('data',chunk=>stderr+=chunk);
  try{const until=async fn=>{for(let end=Date.now()+15000;Date.now()<end;){if(fn())return;await new Promise(r=>setTimeout(r,30));}throw Error('Watch timeout '+stderr);};await until(()=>events.some(e=>e.event==='watching'));const file=path.join(watched,'plugin.json'),m=JSON.parse(await fs.readFile(file));m.contributes.effects[0].name='Renamed effect';await fs.writeFile(file,JSON.stringify(m));await until(()=>events.filter(e=>e.event==='built').length===2);assert.ok(events.some(e=>e.code==='VERSION_REUSED'));await fs.writeFile(file,'{invalid');await until(()=>events.some(e=>e.ok===false));m.version='0.1.1';await fs.writeFile(file,JSON.stringify(m));await until(()=>events.some(e=>e.manifest?.version==='0.1.1'));record('watch warns for reused immutable versions and recovers from malformed input');}finally{child.kill('SIGTERM');await new Promise(resolve=>child.once('exit',resolve));}
  await fs.writeFile(path.join(evidence,'result.json'),JSON.stringify({ok:true,checks:records.length,passed:records},null,2));console.log('SDK authoring evidence: '+evidence);
 }catch(error){await fs.writeFile(path.join(evidence,'result.json'),JSON.stringify({ok:false,error:error.stack,passed:records},null,2));throw error;}
})().catch(error=>{console.error(error);process.exitCode=1;});
