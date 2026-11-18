const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict'),{spawn}=require('node:child_process');
(async()=>{
 const root=path.resolve(__dirname,'../../..'),dir=await fs.mkdtemp(path.join(os.tmpdir(),'clipcraft-extension-shortcuts-ui-')),source=path.join(dir,'source');await fs.cp(path.join(root,'examples/extensions/workbench'),source,{recursive:true});await fs.rm(path.join(source,'dist'),{recursive:true,force:true});await require('../../../scripts/build-plugin-sdk.cjs').buildSdk();
 const entry=path.join(source,'src/extension.ts');let body=await fs.readFile(entry,'utf8');body=body.slice(0,body.lastIndexOf('}'))+`
 let hits=Number(await context.configuration.get('hits')||0);
 await context.commands.register('hit',async()=>{await context.configuration.update({key:'hits',value:++hits});return hits;});
 await context.commands.register('hits',()=>hits);
 const transient=await context.ui.registerShortcut({id:'transient',title:'Temporary shortcut',command:'hit',keys:['Ctrl+Shift+Y']});
 await context.commands.register('drop-shortcut',async()=>{await transient.dispose();await transient.dispose();return true;});
 await context.ui.registerShortcut({id:'conflict',title:'Conflicting default',command:'hit',keys:['S']});
}\n`;await fs.writeFile(entry,body);
 const mp=path.join(source,'plugin.json'),manifest=JSON.parse(await fs.readFile(mp,'utf8'));manifest.contributes.commands.push({id:'hit',name:'Count a shortcut'});manifest.contributes.shortcuts.push({id:'hit-key',name:'Count a shortcut',command:'hit',keys:['Ctrl+Shift+H']},{id:'app-key',name:'Count from Home',command:'hit',keys:['Ctrl+Alt+G'],scope:'app'});await fs.writeFile(mp,JSON.stringify(manifest));
 const sdk=require('../../../packages/plugin-sdk/dist/authoring.cjs'),built=await sdk.buildPlugin(source),archive=path.join(dir,'workbench.tgz');await sdk.packPlugin(built.directory,archive);await fs.writeFile(path.join(dir,'fixtures.json'),JSON.stringify({archive}));await fs.mkdir(path.join(dir,'settings-test'));await fs.writeFile(path.join(dir,'settings-test/settings.json'),JSON.stringify({language:'en',firstRun:{tourSeen:true,packPromptSeen:true},shortcuts:{'extension:missing.package.hidden':['Ctrl+K']}}));
 for(const phase of ['initial','restart']){
  const child=spawn(require('electron'),[root],{cwd:root,env:{...process.env,FVE_SMOKE:dir,FVE_SMOKE_MODE:'extension-shortcuts',FVE_SHORTCUTS_PHASE:phase,FVE_SMOKE_QUIET:'1',VITE_DEV_SERVER_URL:'',CLIPCRAFT_DEV_EXAMPLES:'0'},stdio:['ignore','pipe','pipe']});let log='';child.stdout.on('data',d=>log+=d);child.stderr.on('data',d=>log+=d);const timer=setTimeout(()=>child.kill('SIGKILL'),120000),code=await new Promise(resolve=>child.once('exit',resolve));clearTimeout(timer);await fs.writeFile(path.join(dir,phase+'.log'),log);const result=JSON.parse(await fs.readFile(path.join(dir,phase+'.json')));assert.equal(code,0,result.error||log);assert.ok(result.ok);
 }
 console.log('Native extension shortcuts, remapping, sandbox focus and cold restart passed: '+dir);
})().catch(error=>{console.error(error);process.exitCode=1;});
