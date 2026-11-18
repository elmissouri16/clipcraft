import type {ExtensionContext} from '@clipcraft/plugin-sdk/extension';
import {addChapters} from './chapters';
type Preferences={note:string;count:number};
function preferences(value:unknown):Preferences{
 if(value===undefined)return {note:'',count:5};const p=value as Preferences;
 if(!p||typeof p.note!=='string'||p.note.length>2000||!Number.isInteger(p.count)||p.count<1||p.count>20)throw Error('Saved preferences are invalid. Reset this extension configuration to continue.');
 return {note:p.note,count:p.count};
}
export async function activate(c:ExtensionContext){
 const view=await c.ui.registerView({id:'dashboard',title:'Project dashboard',entry:'assets/view.html'});
 const summary=async()=>{
  const page=await c.workspace.inspect({section:'markers',limit:30}),scope={documentId:page.documentId,projectRevision:page.projectRevision},project=await c.workspace.read();
  const count=async(lane:'video'|'overlay'|'text'|'audio')=>{let page=await c.workspace.inspect({...scope,section:'clips',lane,limit:200}),total=page.items.filter(clip=>!clip.gap).length;while(page.next!==null){page=await c.workspace.inspect({...scope,section:'clips',lane,cursor:page.next,limit:200});total+=page.items.filter(clip=>!clip.gap).length;}return total;};
  const counts=await Promise.all((['video','overlay','text','audio'] as const).map(count));
  if(project.documentId!==scope.documentId)throw Error('Project changed while reading its summary.');
  return {...project,counts:{video:counts[0]+counts[1],text:counts[2],audio:counts[3],markers:page.total},markers:page.items.map(marker=>({time:marker.time_sec??0,label:typeof marker.label==='string'?marker.label:'Long marker label'}))};
 };
 const refresh=async()=>{try{await view.postMessage({type:'project',project:await summary()});}catch(error){await view.postMessage({type:'empty',message:error instanceof Error?error.message:'No project is open.'});}};
 await c.commands.register('open',()=>view.reveal());
 await c.commands.register<{count?:number}>('add-chapter-markers',async input=>addChapters(c,input?.count??preferences(await c.configuration.get('preferences')).count));
 view.onMessage(async(value:unknown)=>{
  const message=value as {type?:string;preferences?:unknown;count?:number};
  try{
   if(message?.type==='ready'){await view.postMessage({type:'preferences',preferences:preferences(await c.configuration.get('preferences'))});await refresh();}
   else if(message?.type==='refresh')await refresh();
   else if(message?.type==='save'){await c.configuration.update({key:'preferences',value:preferences(message.preferences)});await view.postMessage({type:'saved'});}
   else if(message?.type==='chapters'){const result=await addChapters(c,message.count??5);await view.postMessage({type:'chapters',message:result.message});await refresh();}
  }catch(error){await view.postMessage({type:'error',message:error instanceof Error?error.message:String(error)});}
 });
 for(const name of ['project.opened','project.changed','project.closed'] as const)c.events.on(name,refresh);
}
