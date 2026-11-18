import type {ExtensionContext} from '@clipcraft/plugin-sdk/extension';
type Preferences={label:string;accent:'violet'|'amber'|'teal';density:'comfortable'|'compact'};
function preferences(value:unknown):Preferences{
 if(value===undefined)return {label:'My editing desk',accent:'violet',density:'comfortable'};const p=value as Preferences;
 if(!p||typeof p.label!=='string'||!p.label.trim()||p.label.length>80||!['violet','amber','teal'].includes(p.accent)||!['comfortable','compact'].includes(p.density))throw Error('Choose a label, accent and spacing from the available options.');
 return {label:p.label,accent:p.accent,density:p.density};
}
export async function activate(c:ExtensionContext){
 const view=await c.ui.registerView({id:'preferences',title:'Preference workbench',entry:'assets/view.html'});
 await c.commands.register('open',()=>view.reveal());
 view.onMessage(async(value:unknown)=>{const message=value as {type?:string;preferences?:unknown};try{
  if(message?.type==='ready')await view.postMessage({type:'preferences',preferences:preferences(await c.configuration.get('preferences'))});
  else if(message?.type==='save'){const saved=preferences(message.preferences);await c.configuration.update({key:'preferences',value:saved});await view.postMessage({type:'saved',preferences:saved});}
 }catch(error){await view.postMessage({type:'error',message:error instanceof Error?error.message:String(error)});}});
}
