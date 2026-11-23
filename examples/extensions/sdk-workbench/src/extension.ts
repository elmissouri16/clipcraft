import type {HookContract,ExtensionContext,ManagedProcess,ExtensionView,ExtensionViewDestination} from '@clipcraft/plugin-sdk/extension';
export async function activate(context:ExtensionContext){
 for(const name of ['project.didCreate','project.didOpen','project.didClose'] as const)await context.hooks.register(name,async event=>{
  const document=await context.workspace.read();
  await context.log(`${name}: ${document.name} (${event.transition?.reason??'unknown'})`);
 });
 const sceneContract={version:1,input:{type:'object',properties:{label:{type:'string',maxLength:160}},required:['label']},output:{type:'object',properties:{approved:{type:'boolean'},note:{type:'string',maxLength:160}},required:['approved','note']}} as const satisfies HookContract;
 const sceneReview=await context.hooks.define('scene-review',sceneContract);
 await context.hooks.register(sceneReview.id,sceneContract,async()=>({approved:true,note:'Built-in scene check'}),{order:20});

 await context.commands.register('shader',async()=>{const definition=(await context.rendering.list({pluginId:context.extension.id,preferred:true})).items.find(row=>row.pluginId===context.extension.id&&row.kind==='effect'&&row.program==='glsl'&&row.preferred);if(!definition)throw Error('Shader definition is unavailable');await context.rendering.validate({id:definition.id});return context.editor.tools.run({name:'add_effect',args:{effect_id:definition.id,start_sec:0,duration_sec:2}});});
 await context.commands.register('custom-scene',async()=>{const review=await sceneReview.run({label:'Signal field'});const refusal=review.results.find(result=>!result.value.approved);if(refusal)throw Error(refusal.value.note);const types=await context.timeline.types({pluginId:context.extension.id});const track=types.items.find(row=>row.category==='track'&&row.id==='signals'&&row.preferred),clip=types.items.find(row=>row.category==='clip'&&row.id==='signal'&&row.preferred);if(!track||!clip)throw Error('Custom types unavailable');const scope=await context.timeline.read({section:'tracks'}),trackId='xt-'+crypto.randomUUID(),clipId='xc-'+crypto.randomUUID();await context.timeline.apply({documentId:scope.documentId,projectRevision:scope.projectRevision,operations:[{type:'create-track',id:trackId,typeId:track.typeId},{type:'create-clip',id:clipId,typeId:clip.typeId,trackId,start_sec:0,duration_sec:2}]});return {trackId,clipId};});
 let server:ManagedProcess|undefined;const views=new Map<string,ExtensionView>();
 await context.commands.register('move-view',async(input:ExtensionViewDestination&{id:string})=>{const view=views.get(input.id);if(!view)throw Error('Unknown view');const {id,...destination}=input;return view.setPlacement(destination);});
 const status=await context.ui.registerStatus({id:'status',title:'Workbench ready',command:'prompt',tooltip:'Choose a label',alignment:'right',order:10});
 await context.ui.registerSettings({id:'helper',title:'Local helper',location:'settings.plugins',fields:[
  {key:'node',label:'Node executable',type:'string',default:'node'},
  {key:'port',label:'Helper port',type:'number',min:1024,max:65535,step:1,default:32179},
 ]});
 await context.commands.register('prompt',async()=>{
  const value=await context.ui.showInput({title:'Workbench label',prompt:'A label shown in the editor status bar.',minLength:2,maxLength:80,value:await context.configuration.get<string>('label')??'Workbench'});
  if(value!==undefined){await context.configuration.update({key:'label',value});await status.update({title:value});}
  return {value:value??null};
 });
 await context.commands.register('binary',async()=>{
  const host=await context.host.read(),process=await context.processes.spawn({file:host.tools.ffmpeg,args:['-v','error','-f','lavfi','-i','sine=frequency=440:duration=0.2','-f','wav','pipe:1'],output:'both',encoding:'bytes'});
  let bytes=0;for await(const chunk of process.output)if(chunk.stream==='stdout')bytes+=chunk.data.byteLength;
  const result=await process.result;await status.update({title:`Streamed ${bytes} bytes`});return {bytes,captured:result.stdout.byteLength,code:result.code};
 });
 await context.commands.register('start-server',async()=>{
  await server?.kill();const port=await context.configuration.get<number>('port')??32179,file=await context.configuration.get<string>('node')??'node';
  server=await context.processes.startServer({file,args:['-e',`require('node:http').createServer((request,response)=>response.end('ClipCraft helper')).listen(${port},'127.0.0.1')`],ready:{url:`http://127.0.0.1:${port}/health`}});
  return {url:(server as ManagedProcess&{url:string}).url};
 });
 await context.commands.register('stop-server',async()=>({stopped:await server?.kill()??false}));
 await context.commands.register('new-project',async()=>context.projects.create({documentId:(await context.projects.status()).documentId,name:'Extension project',format:'16:9',fps:24}));
 await context.commands.register('save-project',async(input:{path?:string})=>context.projects.save({documentId:(await context.workspace.read()).documentId,...(input?.path?{path:input.path}:{})}));
 await context.commands.register('open-project',async(input:{path?:string})=>context.projects.open({documentId:(await context.projects.status()).documentId,...(input?.path?{path:input.path}:{})}));
 await context.commands.register('close-project',async()=>context.projects.close({documentId:(await context.workspace.read()).documentId}));
 await context.commands.register('undo',async()=>{const scope=await context.workspace.inspect({section:'project'});return context.editor.undo({documentId:scope.documentId,projectRevision:scope.projectRevision});});
 await context.commands.register('captions',async()=>{const snapshot=await context.editor.read();return context.captions.write({documentId:snapshot.documentId,revision:snapshot.revision,mode:'create-track',newTrack:{name:'Styled captions'},style:{font:'poppins',size:40,color:'#ffffff',bold:true,shadow:{on:true,color:'#000000',blur:4},bg:{on:true,color:'#153452',opacity:.8},animIn:{id:'fade',dur:.2}},cues:[{text:'An extension caption',start_sec:0,end_sec:1},{text:'A different accent',start_sec:1,end_sec:2,style:{color:'#74d9c6',italic:true}}]});});
 for(const placement of ['left-rail','library'] as const){const id=placement==='left-rail'?'rail':'library',view=await context.ui.registerView({id,title:id==='rail'?'Extension tools':'Extension library',entry:'assets/view.html',placement,icon:{paths:['M4 4 L20 4 L20 20 L4 20 Z M4 10 L20 10 M10 10 L10 20']}});views.set(id,view);view.onMessage(async value=>{if(value&&typeof value==='object'&&'ready' in value)await view.postMessage({label:await context.configuration.get('label')??'Workbench'});});}
 for(const location of ['menu.project','menu.timeline'] as const)await context.ui.registerAction({id:location.replace('.','-'),title:'Ask for a workbench label',location,command:'prompt'});
}
