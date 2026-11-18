// SDK development validation only. Never installs a plugin, launches Electron,
// publishes a package, builds an installer or approves a production release.
const fs=require('node:fs/promises'),sync=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),{spawn}=require('node:child_process'),{pathToFileURL}=require('node:url');
const {npmCommand}=require('./npm-command.cjs');
const SUITES=Object.freeze(['test-plugin-sdk.mjs','test-extension-authoring.cjs','test-extension-view-authoring.cjs','test-extension-package-paths.cjs','test-extension-resource-admission.cjs','test-extension-archive-limits.cjs','test-plugin-package-publication.cjs','test-plugin-sdk-cli.cjs','test-plugin-sdk-verification.cjs']);
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
async function snapshot(root){
 const files={};
 const visit=async directory=>{for(const entry of await fs.readdir(directory,{withFileTypes:true})){if(['node_modules','dist','.git'].includes(entry.name))continue;const file=path.join(directory,entry.name);if(entry.isDirectory())await visit(file);else if(entry.isFile())files[path.relative(root,file).split(path.sep).join('/')]=hash(await fs.readFile(file));}};
 for(const name of ['src','electron','shared','examples','scripts','tests','packages/plugin-sdk/src','.github']){const folder=path.join(root,name);if(sync.existsSync(folder))await visit(folder);}
 for(const name of ['package.json','package-lock.json','packages/plugin-sdk/package.json','packages/plugin-sdk/package-lock.json','packages/plugin-sdk/README.md','packages/plugin-sdk/LICENSE'])files[name]=hash(await fs.readFile(path.join(root,name)));
 return Object.fromEntries(Object.entries(files).sort(([a],[b])=>a.localeCompare(b)));
}
async function newOutput(root,requested){
 if(!requested)return fs.mkdtemp(path.join(os.tmpdir(),'clipcraft-sdk-validation-'));
 const parent=await fs.realpath(path.dirname(path.resolve(requested))),target=path.join(parent,path.basename(requested)),relative=path.relative(await fs.realpath(root),target);
 if(!relative||!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative))throw Error('Choose a new validation output directory outside the checkout.');
 await fs.mkdir(target);return target;
}
function run(command,args,{cwd,log,stderrLog,timeoutMs=360000}){
 return new Promise(resolve=>{
  const fd=sync.openSync(log,'wx'),errFd=stderrLog?sync.openSync(stderrLog,'wx'):fd;let child,error,timedOut=false;
  const close=()=>{sync.closeSync(fd);if(errFd!==fd)sync.closeSync(errFd);};
  try{child=spawn(command,args,{cwd,env:process.env,stdio:['ignore',fd,errFd],detached:process.platform!=='win32',windowsHide:true});}catch(value){close();resolve({status:'FAIL',error:value.message,log});return;}
  const timer=setTimeout(()=>{timedOut=true;if(process.platform==='win32'){const killer=spawn('taskkill',['/pid',String(child.pid),'/T','/F'],{stdio:'ignore',windowsHide:true});killer.on('error',()=>child.kill());killer.on('exit',code=>{if(code)child.kill();});}else try{process.kill(-child.pid,'SIGKILL');}catch{child.kill();}},timeoutMs);
  child.once('error',value=>{error=value.message;});child.once('close',(code,signal)=>{clearTimeout(timer);close();resolve({status:timedOut?'TIMEOUT':code===0&&!error?'PASS':'FAIL',code,signal,...(error?{error}:{}),log});});
 });
}
async function validate({output:requested,root=path.resolve(__dirname,'..')}={}){
 const output=await newOutput(root,requested),before=await snapshot(root),report={ok:false,releaseReady:false,root,scope:'SDK contract/authoring development checks; native installed-app, hardware/manual and release gates remain separate',sourceManifest:'source-before.json',environment:{node:process.version,platform:process.platform,arch:process.arch,ci:process.env.CI||null,runnerImage:process.env.ImageOS||null,runnerImageVersion:process.env.ImageVersion||null},suites:[]};
 console.log('SDK validation evidence: '+output);await fs.writeFile(path.join(output,'source-before.json'),JSON.stringify(before,null,2)+'\n');
 try{
  const [major,minor]=process.versions.node.split('.').map(Number);if(major<20||major===20&&minor<19)throw Error('SDK verification requires Node >=20.19.0.');
  for(const name of SUITES){const file=path.join('tests','unit','plugins',name),result=await run(process.execPath,[file],{cwd:root,log:path.join(output,name+'.log')});report.suites.push({file,...result,log:path.basename(result.log)});console.log(result.status+' '+file);}
  const after=await snapshot(root);report.sourceChanges=[...new Set([...Object.keys(before),...Object.keys(after)])].filter(name=>before[name]!==after[name]).sort();await fs.writeFile(path.join(output,'source-after.json'),JSON.stringify(after,null,2)+'\n');
  if(report.sourceChanges.length)throw Error('Source changed during SDK validation.');if(report.suites.some(row=>row.status!=='PASS'))throw Error('SDK validation has failed suites; no candidate tarball was produced.');
  const pkg=JSON.parse(await fs.readFile(path.join(root,'packages/plugin-sdk/package.json'))),sdk=await import(pathToFileURL(path.join(root,'packages/plugin-sdk/dist/index.mjs')).href);if(sdk.SDK_VERSION!==pkg.version)throw Error('Built SDK version does not match its manifest.');
  const artifacts=path.join(output,'artifacts');await fs.mkdir(artifacts);const npm=npmCommand(['pack','--ignore-scripts','--json','--pack-destination',artifacts]);const packed=await run(npm.command,npm.args,{cwd:path.join(root,'packages/plugin-sdk'),log:path.join(output,'npm-pack.json'),stderrLog:path.join(output,'npm-pack.stderr.log')});if(packed.status!=='PASS')throw Error('SDK tarball preparation failed.');
  const [metadata]=JSON.parse(await fs.readFile(packed.log,'utf8')),paths=new Set(metadata.files.map(file=>file.path)),expected=['package.json','README.md','LICENSE',...Object.values(pkg.bin)];
  const entries=value=>{if(typeof value==='string')expected.push(value.replace(/^\.\//,''));else for(const item of Object.values(value))entries(item);};entries(pkg.exports);
  if(expected.some(file=>!paths.has(file.replace(/^\.\//,'')))||[...paths].some(file=>file.startsWith('src/')||file.startsWith('node_modules/')))throw Error('SDK tarball does not match its public artifact contract.');
  const archive=path.join(artifacts,metadata.filename),bytes=await fs.readFile(archive);report.artifact={file:path.relative(output,archive),bytes:bytes.length,sha256:hash(bytes),files:[...paths].sort()};report.versions={app:JSON.parse(await fs.readFile(path.join(root,'package.json'))).version,sdk:pkg.version,hostApi:sdk.HOST_API_VERSION};
  const final=await snapshot(root);report.sourceChanges=[...new Set([...Object.keys(before),...Object.keys(final)])].filter(name=>before[name]!==final[name]).sort();await fs.writeFile(path.join(output,'source-after.json'),JSON.stringify(final,null,2)+'\n');if(report.sourceChanges.length)throw Error('Source changed while preparing SDK artifacts.');
  report.sourceSha256=hash(await fs.readFile(path.join(output,'source-before.json')));report.ok=true;
 }catch(error){report.error=error.stack||error.message;}
 finally{
  if(!report.ok){delete report.artifact;await fs.rm(path.join(output,'artifacts'),{recursive:true,force:true});}
  await fs.writeFile(path.join(output,'result.json'),JSON.stringify(report,null,2)+'\n');
 }
 console.log('SDK validation '+(report.ok?'passed':'failed')+'; production release is not approved.');return {output,report};
}
if(require.main===module){const args=process.argv.slice(2);if(args.length&&!(args.length===2&&args[0]==='--output'&&args[1])){console.error('Usage: npm run sdk:verify -- [--output <new-directory-outside-checkout>]');process.exitCode=1;}else validate({output:args[1]}).then(({report})=>{if(!report.ok)process.exitCode=1;}).catch(error=>{console.error(error.message);process.exitCode=1;});}
module.exports={validate,snapshot,SUITES};
