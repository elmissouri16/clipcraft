#!/usr/bin/env node
const path=require('node:path'),fs=require('node:fs');
const tools=require('./authoring.cjs');
const VERSION=require('../package.json').version;
const help=`ClipCraft plugin SDK ${VERSION} (host API 1)\n\nclipcraft-plugin create <new-directory> --id publisher.name --name "Plugin name" --publisher "Author" [--template extension|effect|transition|export-preset|content-pack|text-style-pack|color-pack|motion-pack]\nclipcraft-plugin check <source-project>\nclipcraft-plugin build <source-project>\nclipcraft-plugin watch <source-project>\nclipcraft-plugin validate <dist-folder|archive.tgz>\nclipcraft-plugin inspect <dist-folder|archive.tgz>\nclipcraft-plugin pack <dist-folder> <new-archive.tgz>\n\nOptions: --json, --app-version 2.0.0, --help, --version\nSource projects are not installable: install the compiled dist folder.\nWatch rebuilds local output; it never installs, approves or executes a plugin.\n`;
function parse(args){
 const positional=[],options={};const allowed=['id','name','publisher','template','app-version','json','help','version'];
 for(let i=0;i<args.length;i++){
  const arg=args[i];if(!arg.startsWith('--')){positional.push(arg);continue;}
  const key=arg.slice(2);if(!allowed.includes(key)||Object.hasOwn(options,key))throw new tools.ToolError('INVALID_ARGUMENT','Unknown or repeated option: '+arg);
  if(['json','help','version'].includes(key)){options[key]=true;continue;}
  const value=args[++i];if(!value||value.startsWith('--'))throw new tools.ToolError('INVALID_ARGUMENT','Missing value for '+arg);options[key]=value;
 }
 return {positional,options};
}
function output(value,json){console.log(json?JSON.stringify({ok:true,...value}):value.message||JSON.stringify(value,null,2));}
function diagnostic(error,json){const value={code:error.code||'TOOL_FAILED',message:error.message||String(error),...(error.details?{details:error.details}:{})};(json?console.log:console.error)(json?JSON.stringify({ok:false,error:value}):`${value.code}: ${value.message}${value.details?'\n'+(typeof value.details==='string'?value.details:JSON.stringify(value.details,null,2)):''}`);}
async function watch(root,options){
 root=path.resolve(root);const watchers=new Map();let timer,busy=false,pending=false,closed=false,previous;
 const refresh=()=>{
  const wanted=new Set([root]);const scan=dir=>{if(!fs.existsSync(dir)||!fs.lstatSync(dir).isDirectory()||fs.lstatSync(dir).isSymbolicLink())return;wanted.add(dir);for(const item of fs.readdirSync(dir,{withFileTypes:true}))if(item.isDirectory())scan(path.join(dir,item.name));};scan(path.join(root,'src'));
  for(const [dir,watcher] of watchers)if(!wanted.has(dir)){watcher.close();watchers.delete(dir);}
  for(const dir of wanted)if(!watchers.has(dir)){
   const watcher=fs.watch(dir,(_event,file)=>{if(dir===root&&!['plugin.json','tsconfig.json','src'].includes(String(file)))return;clearTimeout(timer);timer=setTimeout(()=>{try{refresh();}catch(error){diagnostic(error,options.json);}rebuild();},150);});
   watcher.on('error',error=>diagnostic(error,options.json));watchers.set(dir,watcher);
  }
 };
 const rebuild=async()=>{
  if(closed)return;if(busy){pending=true;return;}busy=true;
  try{
   const result=await tools.buildPlugin(root,{appVersion:options['app-version']});
   if(previous&&previous.key!==result.key&&previous.version===result.manifest.version)output({event:'warning',code:'VERSION_REUSED',message:'Local bytes changed. Increment plugin.json version before reinstalling.'},options.json);
   previous={key:result.key,version:result.manifest.version};output({event:'built',...result},options.json);
  }catch(error){diagnostic(error,options.json);}finally{busy=false;if(pending){pending=false;rebuild();}}
 };
 refresh();await rebuild();output({event:'watching',directory:root,message:'Watching src/ and plugin.json; editor windows remain untouched.'},options.json);
 const close=()=>{closed=true;clearTimeout(timer);for(const watcher of watchers.values())watcher.close();};
 process.once('SIGINT',close);process.once('SIGTERM',close);
}
async function main(args=process.argv.slice(2)){
 const {positional,options}=parse(args);
 if(options.version){console.log(VERSION);return;}
 if(options.help||!positional.length){console.log(help);return;}
 const [command,...paths]=positional,expected=command==='pack'?2:1;
 if(!['create','check','build','watch','validate','inspect','pack'].includes(command)||paths.length!==expected)throw new tools.ToolError('INVALID_ARGUMENT','Invalid command or number of paths. Use --help.');
 const createOptions=['id','name','publisher','template'];if(command!=='create'&&createOptions.some(key=>Object.hasOwn(options,key)))throw new tools.ToolError('INVALID_ARGUMENT','Creation options are only valid with create.');
 if(command==='watch'){await watch(paths[0],options);return;}
 const settings={appVersion:options['app-version']};let value;
 if(command==='create')value=await tools.createPlugin(paths[0],options);
 else if(command==='check')value=await tools.checkPlugin(paths[0],settings);
 else if(command==='build')value=await tools.buildPlugin(paths[0],settings);
 else if(command==='pack')value=await tools.packPlugin(paths[0],paths[1],settings);
 else value=await (command==='inspect'?tools.inspectPlugin:tools.validatePlugin)(paths[0],settings);
 if(command==='inspect')value={...value,capabilities:{node:!!value.manifest.main,migrationRequired:!!value.migrationRequired,contributions:Object.keys(value.manifest.contributes).filter(key=>value.manifest.contributes[key].length)}};
 output({command,...value},options.json);
}
if(require.main===module)main().catch(error=>{diagnostic(error,process.argv.includes('--json'));process.exitCode=1;});
module.exports={main,parse};
