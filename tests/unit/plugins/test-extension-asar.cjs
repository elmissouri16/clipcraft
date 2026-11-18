// Archive-only native check. No installer, checkout dependency link or NODE_PATH.
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),crypto=require('node:crypto'),{spawn}=require('node:child_process');
(async()=>{
 const root=path.resolve(__dirname,'../../..'),dir=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'clipcraft-extension-asar-'))),payload=path.join(dir,'payload'),source=path.join(dir,'source'),dependencies=[],copied=new Set();
 console.log('ASAR native evidence: '+dir);
 await fs.mkdir(payload);for(const name of ['electron','shared'])await fs.cp(path.join(root,name),path.join(payload,name),{recursive:true});await fs.copyFile(path.join(root,'package.json'),path.join(payload,'package.json'));
 const copyDependency=async(name,from)=>{
  let folder=path.dirname(require.resolve(name,{paths:[from]})),manifest;
  while(true){try{manifest=JSON.parse(await fs.readFile(path.join(folder,'package.json'),'utf8'));if(manifest.name===name)break;}catch{}const parent=path.dirname(folder);if(parent===folder)throw Error('Cannot locate dependency '+name);folder=parent;}
  if(copied.has(folder))return;copied.add(folder);const relative=path.relative(path.join(root,'node_modules'),folder);assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative));
  await fs.cp(folder,path.join(payload,'node_modules',relative),{recursive:true,filter:file=>file===folder||path.basename(file)!=='node_modules'});dependencies.push({name,version:manifest.version,path:'node_modules/'+relative.split(path.sep).join('/')});
  for(const child of Object.keys(manifest.dependencies||{}))await copyDependency(child,folder);
 };
 await copyDependency('tar',root);
 await fs.mkdir(path.join(source,'dist'),{recursive:true});await fs.mkdir(path.join(source,'assets'));
 await fs.writeFile(path.join(source,'plugin.json'),JSON.stringify({id:'studio.asar',name:'ASAR proof',publisher:'Test',version:'0.1.0',apiVersion:1,main:'dist/extension.cjs',contributes:{commands:[{id:'hello',name:'Hello'}],views:[{id:'panel',name:'Archived view'}]}}));
 await fs.writeFile(path.join(source,'dist/extension.cjs'),`exports.activate=async c=>{
  await c.commands.register('hello',async input=>{await c.configuration.update({key:'saved',value:input});return {input,node:typeof require('node:fs').readFileSync,saved:await c.configuration.get('saved')};});
  const view=await c.ui.registerView({id:'panel',title:'Archived view',entry:'assets/view.html'});
  view.onMessage(async value=>{await view.postMessage({kind:'reply',value:value.value+1});});
 };`);
 await fs.writeFile(path.join(source,'assets/view.html'),'<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="view.css"><h1>Archived view</h1><output id="result">Waiting</output><script src="view.js"></script>');
 await fs.writeFile(path.join(source,'assets/view.css'),'output{color:rgb(24,145,83)}');
 await fs.writeFile(path.join(source,'assets/view.js'),`window.clipcraftView.onMessage(value=>{document.querySelector('#result').textContent=JSON.stringify(value);});window.clipcraftView.getInfo().then(info=>{window.fixtureInfo=info;return window.clipcraftView.postMessage({value:41});}).catch(error=>{window.fixtureError=String(error);});`);
 const runner=path.join(dir,'runner.cjs');await fs.copyFile(path.join(root,'tests/fixtures/extensionAsar.cjs'),runner);const archiveTool=require('@electron/asar'),results=[];
 for(const missingPreload of [false,true]){
  const label=missingPreload?'missing-preload':'complete',archive=path.join(dir,label+'.asar');if(missingPreload)await fs.unlink(path.join(payload,'electron/plugins/extensionViewPreload.cjs'));await archiveTool.createPackage(payload,archive);
  const directory=path.join(dir,label);await fs.mkdir(directory);const config=path.join(directory,'config.json');await fs.writeFile(config,JSON.stringify({directory,archive,source,missingPreload}));
  const env={...process.env};delete env.NODE_PATH;delete env.NODE_OPTIONS;delete env.ELECTRON_RUN_AS_NODE;
  const child=spawn(process.env.ELECTRON_BIN||require('electron'),['--user-data-dir='+path.join(directory,'user-data'),runner,config],{cwd:directory,env,detached:process.platform!=='win32',stdio:['ignore','pipe','pipe']});let log='',timedOut=false;child.stdout.on('data',chunk=>log+=chunk);child.stderr.on('data',chunk=>log+=chunk);
  const timer=setTimeout(()=>{timedOut=true;if(process.platform==='win32'){const killer=spawn('taskkill',['/pid',String(child.pid),'/T','/F'],{stdio:'ignore'});killer.on('error',()=>child.kill());killer.on('exit',code=>{if(code)child.kill();});}else try{process.kill(-child.pid,'SIGKILL');}catch{child.kill();}},60000);
  const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);}).finally(()=>clearTimeout(timer));await fs.writeFile(path.join(directory,'runtime.log'),log);assert.equal(timedOut,false,directory+'\n'+log);assert.equal(code,0,directory+'\n'+log);
  const result=JSON.parse(await fs.readFile(path.join(directory,'result.json')));assert.ok(result.ok);assert.equal(result.missingPreload,missingPreload);assert.equal(result.userData,path.join(directory,'user-data'));assert.equal(result.nodePath,null);assert.equal(result.noSandbox,false);results.push({label,archive,sha256:crypto.createHash('sha256').update(await fs.readFile(archive)).digest('hex'),result});
 }
 await fs.writeFile(path.join(dir,'result.json'),JSON.stringify({ok:true,dependencies,results,scope:'Self-contained archived worker/native view; not installed-release acceptance'},null,2));console.log('Self-contained ASAR worker/view and missing-preload refusal verified: '+dir);
})().catch(error=>{console.error(error);process.exitCode=1;});
