import type {ExtensionContext,ExtensionView} from '@clipcraft/plugin-sdk/extension';
export async function activate(context:ExtensionContext){
 const views=new Map<string,ExtensionView>();
 let lastChange='No project change has been observed.';
 context.events.on('project.changed',(project,event)=>{lastChange='Project revision '+project.projectRevision+' observed from '+event.source.kind+(event.source.extensionId?' ('+event.source.extensionId+')':'')+'.';},{replay:true});
 await context.commands.register('changes',()=>({message:lastChange}));
 await context.ui.registerShortcut({id:'notes-key',title:'Open session notes',command:'notes',keys:['Ctrl+Alt+J']});
 await context.commands.register('message',async()=>{const action=await context.ui.showMessage({message:'Your extension workspace is ready.',detail:'Views keep their local state while you switch between them.',actions:[{id:'notes',title:'Open session notes'}]});if(action==='notes')await views.get('notes')!.reveal();});
 await context.commands.register('render',()=>context.jobs.run('Render the current project',async({signal,progress})=>{
  const document=await context.workspace.read();
  const result=await context.exports.render({documentId:document.documentId,name:document.name.trim().slice(0,200)||'Video'},{signal,onProgress:update=>{void progress(update.progress,update.stage||'Rendering video').catch(()=>{});}});
  return {message:'Video saved to '+result.file};
 }));
 for(const [id,title] of [['overview','Project overview'],['notes','Session notes']]){
  let count=0;
  const view=await context.ui.registerView({id,title,entry:'assets/view.html'});views.set(id,view);
  view.onMessage(async value=>{
   if(!value||typeof value!=='object'||Array.isArray(value))return;
   const input=value as {type?:string};
   if(input.type==='count')await view.postMessage({type:'count',count:++count});
   if(input.type==='inspect')await view.postMessage({type:'project',project:await context.workspace.read()});
  });
  await context.commands.register(id,()=>views.get(id)!.reveal());
  await context.ui.registerAction({id,location:'toolbar',title,command:id});
 }
}
