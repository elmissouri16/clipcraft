const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto'),{spawn}=require('node:child_process');
const {readFolder,readArchive,validateFiles}=require('../../../electron/plugins/package.cjs');
const {templateFiles}=require('./templates.cjs');
const schema=import('../../../shared/pluginManifest.mjs');
const SDK_ROOT=path.resolve(__dirname,'..'),APP_VERSION='2.0.0';
const TEMPLATES=['panel','command','effect','transition','export-preset','ai-provider'];
class ToolError extends Error {constructor(code,message,details){super(message);this.code=code;if(details)this.details=details;}}
const fail=(code,message,details)=>{throw new ToolError(code,message,details);};
const regular=async file=>{const stat=await fs.lstat(file);if(!stat.isFile()||stat.isSymbolicLink())fail('INVALID_FILE','Expected a regular file: '+file);return stat;};
const readJson=async file=>{try{const stat=await regular(file);if(stat.size>256*1024)fail('VALIDATION_FAILED','JSON exceeds 256 KiB.');return JSON.parse(await fs.readFile(file,'utf8'));}catch(error){if(error instanceof ToolError)throw error;fail('VALIDATION_FAILED','Cannot read JSON: '+file);}};
async function workspace(directory){const root=path.resolve(directory);if(!(await fs.lstat(root)).isDirectory())fail('CONFIG_INVALID','Workspace must be a regular directory.');return root;}
async function manifestAt(root,appVersion=APP_VERSION){try{const input=await readJson(path.join(root,'plugin.json'));(await schema).validateManifest(input,appVersion);return input;}catch(error){if(error instanceof ToolError)throw error;fail('VALIDATION_FAILED',error.message);}}
async function createPlugin(directory,{id,name,publisher,template='panel'}={}){
 if(!TEMPLATES.includes(template))fail('INVALID_ARGUMENT','Choose template: '+TEMPLATES.join(', '));
 const root=path.resolve(directory),sdkDependency=require('node:url').pathToFileURL(await fs.realpath(SDK_ROOT)).href;
 const files=templateFiles({id,name,publisher,template,sdkDependency});
 try{(await schema).validateManifest(JSON.parse(files['plugin.json']));}catch(error){if(error instanceof ToolError)throw error;fail('VALIDATION_FAILED',error.message);}
 try{await fs.lstat(root);fail('OUTPUT_EXISTS','Destination already exists. Choose a new directory.');}catch(error){if(error.code!=='ENOENT')throw error;}
 await fs.mkdir(path.dirname(root),{recursive:true});const stage=await fs.mkdtemp(path.join(path.dirname(root),'.clipcraft-create-'));
 try{for(const [file,source] of Object.entries(files)){const target=path.join(stage,file);await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,source,{flag:'wx'});}await fs.rename(stage,root);}finally{await fs.rm(stage,{recursive:true,force:true});}
 return {directory:root,template,id};
}
async function analyzeBundle(bundle){
 for(const name of ['commands.js','panel.js'])if(bundle.files.has(name)){
  const code=bundle.files.get(name).toString('utf8');standalone(code,name);
  await require('esbuild').transform(code,{loader:'js',target:'es2022',logLevel:'silent'});
 }
 if(bundle.code){const result=await require('esbuild').build({stdin:{contents:bundle.code,sourcefile:'commands.js'},write:false,metafile:true,format:'esm',platform:'browser',logLevel:'silent'});if(!Object.values(result.metafile.outputs)[0].exports.includes('run'))fail('MISSING_EXPORT','commands.js must export run.');}
 return bundle;
}
async function validatePlugin(source,{appVersion=APP_VERSION}={}){
 try{
  const stat=await fs.lstat(source),files=await(stat.isDirectory()?readFolder(source):readArchive(source));
  const bundle=await analyzeBundle(await validateFiles(files,appVersion));
  return {key:bundle.key,manifest:bundle.manifest,files:[...bundle.files.keys()]};
 }catch(error){if(error instanceof ToolError)throw error;fail('VALIDATION_FAILED',error.message);}
}
async function checkPlugin(directory,{appVersion=APP_VERSION}={}){
 const root=await workspace(directory),manifest=await manifestAt(root,appVersion),entries=[...(manifest.entry?['commands.ts']:[]),...(manifest.contributes.panels?.[0]?.script?['panel.ts']:[])];
 if(!entries.length)return {manifest,typecheck:'not-needed'};
 for(const name of entries)await regular(path.join(root,'src',name));
 const tsc=require.resolve('typescript/bin/tsc');
 for(const entry of entries){
  const result=await new Promise((resolve,reject)=>{
   const child=spawn(process.execPath,[tsc,'--noEmit','--pretty','false','--strict','--target','ES2022','--module','ESNext','--moduleResolution','Bundler','--lib',entry==='commands.ts'?'ES2022,WebWorker':'ES2022,DOM',path.join(root,'src',entry)],{cwd:root,stdio:['ignore','pipe','pipe']});
   let text='';const record=chunk=>{text=(text+chunk).slice(0,16000);};child.stdout.on('data',record);child.stderr.on('data',record);const timeout=setTimeout(()=>child.kill('SIGKILL'),30000);child.on('error',error=>{clearTimeout(timeout);reject(error);});child.on('close',code=>{clearTimeout(timeout);resolve({code,text});});
  });
  if(result.code!==0)fail('TYPECHECK_FAILED','TypeScript check failed for '+entry+'.',result.text);
 }
 return {manifest,typecheck:'passed'};
}
function standalone(source,name){
 const ts=require('typescript'),ast=ts.createSourceFile(name,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
 const visit=node=>{
  if(ts.isImportDeclaration(node)||ts.isExportDeclaration(node)&&node.moduleSpecifier||ts.isImportEqualsDeclaration(node)||ts.isCallExpression(node)&&(node.expression.kind===ts.SyntaxKind.ImportKeyword||ts.isIdentifier(node.expression)&&node.expression.text==='require'))fail('UNSUPPORTED_IMPORT','Installed scripts must be standalone; bundle all imports first.');
  ts.forEachChild(node,visit);
 };visit(ast);
}
async function bundleSource(root,name,format){
 const esbuild=require('esbuild');await regular(path.join(root,'src',name+'.ts'));
 let result;try{result=await esbuild.build({entryPoints:[path.join(root,'src',name+'.ts')],bundle:true,write:false,metafile:true,format,platform:'browser',target:'es2022',minify:true,legalComments:'none',logLevel:'silent'});}catch(error){fail('BUILD_FAILED',`Cannot bundle ${name}.ts.`,error.errors?.map(e=>({text:e.text,location:e.location})));}
 const output=Object.values(result.metafile.outputs)[0];
 if(result.warnings.length||output.imports.length)fail('UNSUPPORTED_IMPORT','Plugin code must bundle completely without external or unresolved dynamic imports.',result.warnings.map(w=>w.text));
 if(name==='commands'&&!output.exports.includes('run'))fail('MISSING_EXPORT','commands.ts must export run.');
 const source=result.outputFiles[0].text;standalone(source,name+'.js');return Buffer.from(source);
}
async function collect(directory,appVersion){
 const root=await workspace(directory),{manifest,typecheck}=await checkPlugin(root,{appVersion});
 const files=new Map([['plugin.json',Buffer.from(JSON.stringify(manifest,null,2)+'\n')]]);
 if(manifest.entry)files.set('commands.js',await bundleSource(root,'commands','esm'));
 const panel=manifest.contributes.panels?.[0];
 if(panel){
  for(const name of [panel.entry,panel.style].filter(Boolean)){const file=path.join(root,'src',name);const stat=await regular(file);if(stat.size>64*1024)fail('BUILD_FAILED','Panel source is too large.');files.set(name,await fs.readFile(file));}
  if(panel.script)files.set('panel.js',await bundleSource(root,'panel','iife'));
 }
 try{const bundle=await validateFiles(files,appVersion);return {root,bundle,typecheck};}catch(error){if(error instanceof ToolError)throw error;fail('VALIDATION_FAILED',error.message);}
}
async function publishPlugin(directory,{appVersion=APP_VERSION}={}){
 const {root,bundle,typecheck}=await collect(directory,appVersion),output=path.join(root,'dist'),marker=path.join(root,'.clipcraft-build.json');
 let exists=false;
 try{await fs.lstat(output);exists=true;}catch(error){if(error.code!=='ENOENT')throw error;}
 if(exists){
  let owned=false;try{const metadata=await readJson(marker);owned=metadata.version===1&&(await validateFiles(await readFolder(output),appVersion)).key===metadata.key;}catch{}
  if(!owned)fail('OUTPUT_EXISTS','dist is not an unchanged SDK build. Move it aside before building.');
 }
 const stage=await fs.mkdtemp(path.join(root,'.clipcraft-stage-')),backup=path.join(root,'.clipcraft-backup-'+crypto.randomUUID());let moved=false,published=false;
 try{
  for(const [file,bytes] of bundle.files)await fs.writeFile(path.join(stage,file),bytes,{flag:'wx'});
  if(exists){await fs.rename(output,backup);moved=true;}
  try{await fs.rename(stage,output);published=true;}catch(error){if(moved)await fs.rename(backup,output);throw error;}
  const temp=marker+'.'+crypto.randomUUID()+'.tmp';try{await fs.writeFile(temp,JSON.stringify({version:1,key:bundle.key})+'\n',{flag:'wx'});await fs.rename(temp,marker);}finally{await fs.rm(temp,{force:true});}
 }finally{await fs.rm(stage,{recursive:true,force:true});if(published&&moved)await fs.rm(backup,{recursive:true,force:true});}
 return {directory:output,key:bundle.key,manifest:bundle.manifest,files:[...bundle.files.keys()],typecheck};
}
async function buildPlugin(directory,options={}){
 const root=await workspace(directory),lock=path.join(root,'.clipcraft-build.lock');let handle;
 try{handle=await fs.open(lock,'wx');}catch(error){if(error.code==='EEXIST')fail('BUILD_BUSY','Another build owns this workspace. If its process stopped, remove .clipcraft-build.lock.');throw error;}
 try{await handle.writeFile(JSON.stringify({pid:process.pid})+'\n');return await publishPlugin(root,options);}finally{await handle.close();await fs.rm(lock,{force:true});}
}
async function packPlugin(source,output,{appVersion=APP_VERSION}={}){
 const fsSync=require('node:fs'),tar=require('tar'),{pipeline}=require('node:stream/promises');
 const bundle=await analyzeBundle(await validateFiles(await readFolder(source),appVersion));
 // Archive the exact validated buffers, never re-read mutable author files during packaging.
 const temp=await fs.mkdtemp(path.join(require('node:os').tmpdir(),'clipcraft-pack-'));
 let handle;try{
  for(const [name,bytes] of bundle.files)await fs.writeFile(path.join(temp,name),bytes,{flag:'wx'});
  try{handle=await fs.open(output,'wx');}catch(error){if(error.code==='EEXIST')fail('OUTPUT_EXISTS','Package output already exists.');throw error;}
  try{await pipeline(tar.c({cwd:temp,gzip:true,portable:true},[...bundle.files.keys()]),fsSync.createWriteStream(output,{fd:handle.fd,autoClose:false}));}
  catch(error){await fs.rm(output,{force:true});throw error;}
 }finally{await handle?.close();await fs.rm(temp,{recursive:true,force:true});}
 return {file:path.resolve(output),key:bundle.key,id:bundle.manifest.id,version:bundle.manifest.version};
}
module.exports={ToolError,TEMPLATES,createPlugin,validatePlugin,checkPlugin,buildPlugin,packPlugin};
