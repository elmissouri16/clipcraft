const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const {readFolder,readArchive,readRegularFile,validateFiles,validateIntake}=require('../../../electron/plugins/package.cjs');
const {assertExtensionPaths,extensionDirectory,EXTENSION_LIMITS}=require('../../../shared/pluginExtensionFiles.cjs');
const {templateFiles}=require('./templates.cjs');
const schema=import('../../../shared/pluginManifest.mjs');
const SDK_ROOT=path.resolve(__dirname,'..'),APP_VERSION='2.0.0';
const TEMPLATES=['extension','effect','transition','export-preset','content-pack','text-style-pack','color-pack','motion-pack'];
class ToolError extends Error {constructor(code,message,details){super(message);this.code=code;if(details)this.details=details;}}
const fail=(code,message,details)=>{throw new ToolError(code,message,details);};
const regular=async file=>{const stat=await fs.lstat(file);if(!stat.isFile()||stat.isSymbolicLink())fail('INVALID_FILE','Expected a regular file: '+file);return stat;};
const readJson=async file=>{try{const bytes=await readRegularFile(file,256*1024,'JSON');return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch(error){if(error instanceof ToolError)throw error;fail('VALIDATION_FAILED','Cannot read JSON: '+file,error.message);}};
async function workspace(directory){const root=path.resolve(directory);if(!(await fs.lstat(root)).isDirectory())fail('CONFIG_INVALID','Workspace must be a regular directory.');return root;}
async function manifestAt(root,appVersion=APP_VERSION){try{const input=await readJson(path.join(root,'plugin.json'));(await schema).validateManifest(input,appVersion);return input;}catch(error){if(error instanceof ToolError)throw error;fail('VALIDATION_FAILED',error.message);}}
async function createPlugin(directory,{id,name,publisher,template='extension'}={}){
 if(['panel','command','ai-provider','local-tool'].includes(template))fail('MIGRATION_REQUIRED','Executable recipes are retired. Use the extension template and general APIs.');
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
 if(bundle.manifest.legacyExecutable)fail('MIGRATION_REQUIRED','This historical executable package cannot be authored or run. Rebuild it as a Node extension.');
 if(bundle.manifest.main){const source=bundle.files.get(bundle.manifest.main).toString('utf8');await require('esbuild').transform(source,{loader:'js',platform:'node',target:'node20',logLevel:'silent'});}
 return bundle;
}
async function inspectPlugin(source,{appVersion=APP_VERSION}={}){
 try{const stat=await fs.lstat(source),bundle=await validateFiles(await(stat.isDirectory()?readFolder(source):readArchive(source)),appVersion);if(!bundle.manifest.legacyExecutable)await analyzeBundle(bundle);return {key:bundle.key,manifest:bundle.manifest,files:[...bundle.files.keys()],migrationRequired:!!bundle.manifest.legacyExecutable};}catch(error){if(error instanceof ToolError)throw error;fail('VALIDATION_FAILED',error.message);}
}
async function validatePlugin(source,{appVersion=APP_VERSION}={}){
 try{
  const stat=await fs.lstat(source),files=await(stat.isDirectory()?readFolder(source):readArchive(source));
  const bundle=await analyzeBundle(await validateIntake(files,appVersion));
  return {key:bundle.key,manifest:bundle.manifest,files:[...bundle.files.keys()]};
 }catch(error){if(error instanceof ToolError)throw error;fail('VALIDATION_FAILED',error.message);}
}
async function checkPlugin(directory,{appVersion=APP_VERSION}={}){
 const root=await workspace(directory),manifest=await manifestAt(root,appVersion);
 try{assertExtensionPaths(['plugin.json',...(await import('../../../shared/pluginContent.mjs')).contentAssets(manifest).keys()]);}catch(error){fail('VALIDATION_FAILED',error.message);}
 if(manifest.main){await regular(path.join(root,'src/extension.ts'));const result=await require('./nodeCheck.cjs').checkNodeExtension(root,__dirname);if(result.code!==0)fail('TYPECHECK_FAILED','TypeScript check failed for extension.ts.',result.text);return {manifest,typecheck:'passed'};}
 return {manifest,typecheck:'not-needed'};
}
async function collectNodeAssets(root,files){
 const base=path.join(root,'src','assets');let stat;try{stat=await fs.lstat(base);}catch(error){if(error.code==='ENOENT')return;throw error;}if(!stat.isDirectory()||stat.isSymbolicLink())fail('INVALID_FILE','Node assets must be a regular directory.');
 const {extensionFile}=await import('../../../shared/pluginExtension.mjs'),{CONTENT_LIMITS}=await import('../../../shared/pluginContent.mjs');let bytes=[...files.values()].reduce((n,value)=>n+value.length,0),count=files.size,visited=assertExtensionPaths(files.keys())+1;
 const pending=[{directory:base,prefix:'assets'}];while(pending.length){const {directory,prefix}=pending.pop();for await(const entry of await fs.opendir(directory)){
  if(++visited>EXTENSION_LIMITS.nodes)fail('BUILD_FAILED','Node assets exceed directory resource limits');
  const file=path.join(directory,entry.name),name=prefix+'/'+entry.name;
  if(entry.isDirectory()){if(!extensionDirectory(name))fail('INVALID_FILE','Unsupported Node asset directory: '+name);pending.push({directory:file,prefix:name});continue;}
  if(!extensionFile(name))fail('INVALID_FILE','Unsupported Node asset: '+name);await regular(file);
  if(++count>EXTENSION_LIMITS.files||bytes>CONTENT_LIMITS.total)fail('BUILD_FAILED','Node assets exceed package limits');
  let captured;try{captured=await readRegularFile(file,Math.min(EXTENSION_LIMITS.file,CONTENT_LIMITS.total-bytes),'Node asset');}catch(error){fail('BUILD_FAILED','Node assets exceed package limits: '+error.message);}
  bytes+=captured.length;files.set(name,captured);
 }}
}
async function collect(directory,appVersion){
 const root=await workspace(directory),{manifest,typecheck}=await checkPlugin(root,{appVersion});
 const files=new Map([['plugin.json',Buffer.from(JSON.stringify(manifest,null,2)+'\n')]]);
 if(manifest.main){const result=await require('esbuild').build({absWorkingDir:await fs.realpath(root),entryPoints:['src/extension.ts'],bundle:true,write:false,platform:'node',format:'cjs',target:'node20',sourcemap:'inline',sourcesContent:true,logLevel:'silent'});files.set(manifest.main,result.outputFiles[0].contents);await collectNodeAssets(root,files);}
 const {contentAssets,CONTENT_LIMITS}=await import('../../../shared/pluginContent.mjs');let bytes=[...files.values()].reduce((n,value)=>n+value.length,0);
 for(const [name,kind] of contentAssets(manifest)){
  if(files.has(name))continue; // Node assets already have one coherent captured snapshot.
  const directory=path.join(root,'src','assets');if(!(await fs.lstat(directory)).isDirectory())fail('INVALID_FILE','assets must be a regular directory.');const file=path.join(root,'src',name);await regular(file);
  if(bytes>CONTENT_LIMITS.total)fail('BUILD_FAILED','Content assets exceed package limits');
  let captured;try{captured=await readRegularFile(file,Math.min(CONTENT_LIMITS[kind],CONTENT_LIMITS.total-bytes),'Content asset');}catch(error){fail('BUILD_FAILED',error.message);}
  bytes+=captured.length;files.set(name,captured);
 }
 try{const bundle=await validateIntake(files,appVersion);return {root,bundle,typecheck};}catch(error){if(error instanceof ToolError)throw error;fail('VALIDATION_FAILED',error.message);}
}
async function publishPlugin(directory,{appVersion=APP_VERSION}={}){
 const {root,bundle,typecheck}=await collect(directory,appVersion),output=path.join(root,'dist'),marker=path.join(root,'.clipcraft-build.json');
 let exists=false;
 try{await fs.lstat(output);exists=true;}catch(error){if(error.code!=='ENOENT')throw error;}
 if(exists){
  let owned=false;try{const metadata=await readJson(marker);owned=metadata.version===1&&(await validateFiles(await readFolder(output),appVersion)).key===metadata.key;}catch{}
  if(!owned)fail('OUTPUT_EXISTS','dist is not an unchanged SDK build. Move it aside before building.');
 }
 const stage=await fs.mkdtemp(path.join(root,'.clipcraft-stage-')),backup=path.join(root,'.clipcraft-backup-'+crypto.randomUUID());
 const temp=marker+'.'+crypto.randomUUID()+'.tmp';
 let moved=false,published=false;
 try{
  for(const [file,bytes] of bundle.files){await fs.mkdir(path.dirname(path.join(stage,file)),{recursive:true});await fs.writeFile(path.join(stage,file),bytes,{flag:'wx'});}
  await fs.writeFile(temp,JSON.stringify({version:1,key:bundle.key})+'\n',{flag:'wx'});
  if(exists){await fs.rename(output,backup);moved=true;}
  try{
   await fs.rename(stage,output);published=true;
   await fs.rename(temp,marker);
  }catch(error){
   if(published)await fs.rename(output,stage);
   if(moved)await fs.rename(backup,output);
   throw error;
  }
  if(moved)await fs.rm(backup,{recursive:true,force:true});
 }finally{
  await fs.rm(temp,{force:true});
  await fs.rm(stage,{recursive:true,force:true});
 }
 return {directory:output,key:bundle.key,manifest:bundle.manifest,files:[...bundle.files.keys()],typecheck};
}
async function buildPlugin(directory,options={}){
 const root=await workspace(directory),lock=path.join(root,'.clipcraft-build.lock');let handle;
 try{handle=await fs.open(lock,'wx');}catch(error){if(error.code==='EEXIST')fail('BUILD_BUSY','Another build owns this workspace. If its process stopped, remove .clipcraft-build.lock.');throw error;}
 try{await handle.writeFile(JSON.stringify({pid:process.pid})+'\n');return await publishPlugin(root,options);}finally{await handle.close();await fs.rm(lock,{force:true});}
}
async function packPlugin(source,output,{appVersion=APP_VERSION}={}){
 const bundle=await analyzeBundle(await validateIntake(await readFolder(source),appVersion));
 // Share the host's compressed-byte cap, captured buffers and exclusive atomic
 // publication. Keep the SDK's existing support for arbitrary output suffixes.
 try{await require('../../../electron/plugins/packageWriter.cjs').writePackage(bundle,path.resolve(output),{requireTgz:false});}
 catch(error){if(error.code==='EEXIST')fail('OUTPUT_EXISTS','Package output already exists.');throw error;}
 return {file:path.resolve(output),key:bundle.key,id:bundle.manifest.id,version:bundle.manifest.version};
}
module.exports={ToolError,TEMPLATES,createPlugin,validatePlugin,inspectPlugin,checkPlugin,buildPlugin,packPlugin};
