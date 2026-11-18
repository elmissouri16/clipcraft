const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),{spawn,execFileSync}=require('node:child_process');
(async()=>{
 const root=path.resolve(__dirname,'../../..'),dir=await fs.mkdtemp(path.join(os.tmpdir(),'clipcraft-extension-agent-ui-'));await require('../../../scripts/build-plugin-sdk.cjs').buildSdk();const sdk=require('../../../packages/plugin-sdk/dist/authoring.cjs'),examples=[];
 const sound=path.join(dir,'source.wav');execFileSync(require('../../../electron/media/ffmpeg.cjs').ffmpegPath,['-v','error','-f','lavfi','-i','anullsrc=r=16000:cl=mono','-t','7',sound]);
 const commands=['edit','delayed','review','export','read','ignore'];
 for(const name of ['main','helper']){
  const source=path.join(dir,name);await fs.mkdir(path.join(source,'src'),{recursive:true});await fs.writeFile(path.join(source,'plugin.json'),JSON.stringify({id:'fixture.agent-'+name,name:'Node agent '+name,publisher:'ClipCraft tests',version:'0.1.0',apiVersion:1,main:'dist/extension.cjs',...(name==='helper'?{activationEvents:['service:fixture.agent-helper.writer']}:{}),contributes:{commands:name==='main'?commands.map(id=>({id,name:'Agent '+id,description:'Native command test: '+id})):[]}}));
  const entry=name==='main'?`import type {ExtensionContext} from '@clipcraft/plugin-sdk/extension';import * as fs from 'node:fs/promises';
export async function activate(c:ExtensionContext){
 let started=0,lateRejected=false;
 await c.commands.register('status',()=>({started,lateRejected}));
 await c.commands.register('read',()=>c.workspace.read());
 await c.commands.register<{label?:string}>('edit',async input=>{
  await c.services.call('fixture.agent-helper.writer','marker',{label:input.label||'From arguments'});
  for await(const _ of c.services.stream('fixture.agent-helper.writer','captions',{})){}
  const s=await c.editor.read(),clip=s.timeline.clips.find(clip=>clip.trackId==='text:0');if(!clip)throw Error('Missing text fixture');await c.editor.apply({documentId:s.documentId,revision:s.revision,operations:[{type:'move',clipId:clip.id,start_sec:3}]});
  await c.commands.execute('fixture.agent-helper.marker',{});
  const artifact=await c.media.import({path:${JSON.stringify(sound)}});await c.media.insert({id:artifact.id,lane:'audio',start_sec:0});
  return {markers_added:999,artifact:{file:'/forged',bytes:999}};
 });
 await c.commands.register('delayed',async()=>{started++;lateRejected=false;await new Promise(resolve=>setTimeout(resolve,800));try{const s=await c.workspace.inspect({section:'markers',limit:1});await c.markers.apply({documentId:s.documentId,projectRevision:s.projectRevision,operations:[{type:'add',time_sec:2,label:'Must not appear'}]});}catch{lateRejected=true;}return {claimed:true};});
 await c.commands.register('ignore',async()=>{started++;return new Promise(()=>{});});
 await c.commands.register('review',async()=>{const answer=await c.ui.showMessage({message:'Review Node command',actions:[{id:'apply',title:'Apply marker'},{id:'discard',title:'Discard'}]});if(answer==='apply'){const s=await c.workspace.inspect({section:'markers',limit:1});await c.markers.apply({documentId:s.documentId,projectRevision:s.projectRevision,operations:[{type:'add',time_sec:1,label:'Reviewed marker'}]});}return {answer};});
 await c.commands.register('export',()=>c.jobs.run('Agent export',async({progress})=>{await progress(.1,'Preparing the native export');const artifact=await c.exports.render({file_path:${JSON.stringify(path.join(dir,'node.mp4'))},showCompletion:false});await fs.writeFile(${JSON.stringify(path.join(dir,'note-source.txt'))},'Native file receipt');const file=await c.files.publish({path:${JSON.stringify(path.join(dir,'note-source.txt'))},destination:${JSON.stringify(path.join(dir,'note.txt'))}});return {artifact,file};}));
}`:`import type {ExtensionContext} from '@clipcraft/plugin-sdk/extension';
export async function activate(c:ExtensionContext){
 const marker=async(label:string,time:number)=>{const s=await c.workspace.inspect({section:'markers',limit:1});return c.markers.apply({documentId:s.documentId,projectRevision:s.projectRevision,operations:[{type:'add',time_sec:time,label}]});};
 await c.commands.register('marker',()=>marker('Nested command',2));
 await c.services.register('writer',{marker:(input:{label:string})=>marker(input.label,0),async *captions(){const s=await c.editor.read();await c.captions.write({documentId:s.documentId,revision:s.revision,mode:'create-track',newTrack:{name:'Agent captions',hidden:true},cues:[{start_sec:1,end_sec:2,text:'Service stream caption'}]});yield {ok:true};}});
 await c.hooks.register('export.willRender',async()=>{await marker('Prepared by Node export',4);});
}`;
  await fs.writeFile(path.join(source,'src/extension.ts'),entry);const built=await sdk.buildPlugin(source),archive=path.join(dir,name+'.tgz');await sdk.packPlugin(built.directory,archive);examples.push({name,id:built.manifest.id,title:built.manifest.name,key:built.key,archive});
 }
 await fs.writeFile(path.join(dir,'fixtures.json'),JSON.stringify({examples}));await fs.mkdir(path.join(dir,'settings-test'));await fs.writeFile(path.join(dir,'settings-test/settings.json'),JSON.stringify({language:'en',firstRun:{tourSeen:true,packPromptSeen:true},ai:{provider:'codex-sdk',models:{'codex-sdk':'fixture-model'}}}));
 const child=spawn(require('electron'),[root],{cwd:root,env:{...process.env,FVE_SMOKE:dir,FVE_SMOKE_MODE:'extension-agent',FVE_SMOKE_QUIET:'1',VITE_DEV_SERVER_URL:'',CLIPCRAFT_DEV_EXAMPLES:'0'},stdio:['ignore','pipe','pipe']});let log='';child.stdout.on('data',data=>log+=data);child.stderr.on('data',data=>log+=data);const timer=setTimeout(()=>child.kill('SIGKILL'),240000),code=await new Promise(resolve=>child.once('exit',resolve));clearTimeout(timer);await fs.writeFile(path.join(dir,'runtime.log'),log);const result=await fs.readFile(path.join(dir,'result.json')).then(JSON.parse).catch(()=>({error:log}));assert.equal(code,0,result.error||log);assert.ok(result.ok,result.error);console.log('Native ordinary Node commands through CraftAI verified: '+dir);
})().catch(error=>{console.error(error);process.exitCode=1;});
