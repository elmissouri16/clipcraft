const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict'),{spawn}=require('node:child_process');
(async()=>{
 const root=path.resolve(__dirname,'../../..'),dir=await fs.mkdtemp(path.join(os.tmpdir(),'clipcraft-extension-events-ui-')),source=path.join(dir,'source');await fs.mkdir(path.join(source,'src'),{recursive:true});await require('../../../scripts/build-plugin-sdk.cjs').buildSdk();
 await fs.writeFile(path.join(source,'plugin.json'),JSON.stringify({id:'fixture.events',name:'Event observer',publisher:'ClipCraft tests',version:'0.1.0',apiVersion:1,main:'dist/extension.cjs',contributes:{commands:[{id:'status',name:'Inspect events'}]}}));
 await fs.writeFile(path.join(source,'src/extension.ts'),`import type {ExtensionContext,ExtensionEventMap} from '@clipcraft/plugin-sdk/extension';
 export async function activate(c:ExtensionContext){const events:unknown[]=[];const names=['project.opened','project.closed','project.changed','editor.changed','selection.changed','playback.changed','configuration.changed','application.configurationChanged','export.changed','extension.changed'] as const;
  const subscriptions=names.map(name=>c.events.on(name,(value,context)=>{const {signal,...event}=context;events.push({name,value,event});if(events.length>512)events.shift();},{replay:true}));await Promise.all(subscriptions.map(subscription=>subscription.ready));
  await c.commands.register('status',()=>events);await c.commands.register('clear',()=>{events.length=0;return true;});await c.commands.register('document',()=>c.workspace.read());
  await c.commands.register('caption',async()=>{const editor=await c.editor.read();return c.captions.write({documentId:editor.documentId,revision:editor.revision,mode:'append',cues:[{text:'Observed edit',start_sec:0,end_sec:.35}]});});
  await c.commands.register('settings',async()=>{await c.configuration.update({key:'mode',value:'testing'});await c.secrets.store({key:'test-token',value:'fixture-hidden-value'});return true;});
  await c.commands.register('export',()=>c.exports.render({name:'Event proof',encoder_preset:'ultrafast'}));
  c.events.on('fixture.events.try-edit',async()=>{const editor=await c.editor.read();await c.captions.write({documentId:editor.documentId,revision:editor.revision,mode:'append',cues:[{text:'Canceled callback',start_sec:1.1,end_sec:1.4}]});});await c.commands.register('emit-edit',()=>c.events.emit('try-edit',{}));
  await c.hooks.register('export.willRender',async()=>{const editor=await c.editor.read();await c.captions.write({documentId:editor.documentId,revision:editor.revision,mode:'append',cues:[{text:'Prepared event',start_sec:.6,end_sec:1}]});});
  function typeChecks(){c.events.on('playback.changed',value=>{const playing:boolean=value.playing;});
   c.events.on('project.changed',value=>{
    // @ts-expect-error project revisions are numeric
    const revision:string=value.projectRevision;
   });
  }
 }`);
 const sdk=require('../../../packages/plugin-sdk/dist/authoring.cjs'),built=await sdk.buildPlugin(source),archive=path.join(dir,'events.tgz');await sdk.packPlugin(built.directory,archive);await fs.writeFile(path.join(dir,'fixtures.json'),JSON.stringify({archive}));await fs.mkdir(path.join(dir,'settings-test'));await fs.writeFile(path.join(dir,'settings-test/settings.json'),JSON.stringify({language:'en',firstRun:{tourSeen:true,packPromptSeen:true}}));
 const child=spawn(require('electron'),[root],{cwd:root,env:{...process.env,FVE_SMOKE:dir,FVE_SMOKE_MODE:'extension-events',FVE_SMOKE_QUIET:'1',VITE_DEV_SERVER_URL:'',CLIPCRAFT_DEV_EXAMPLES:'0'},stdio:['ignore','pipe','pipe']});let log='';child.stdout.on('data',value=>log+=value);child.stderr.on('data',value=>log+=value);const timer=setTimeout(()=>child.kill('SIGKILL'),150000),code=await new Promise(resolve=>child.once('exit',resolve));clearTimeout(timer);await fs.writeFile(path.join(dir,'runtime.log'),log);const result=await fs.readFile(path.join(dir,'result.json')).then(JSON.parse).catch(()=>({ok:false,error:log||'App exited before producing UI evidence'}));assert.equal(code,0,result.error||log);assert.ok(result.ok,result.error||log);console.log('Native editor event publication verified: '+dir);
})().catch(error=>{console.error(error);process.exitCode=1;});
