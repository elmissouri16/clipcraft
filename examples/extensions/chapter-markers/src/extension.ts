import type {ExtensionContext} from '@clipcraft/plugin-sdk/extension';
import {addChapters} from './chapters';
export async function activate(c:ExtensionContext){
 await c.ui.registerSettings({id:'chapters',title:'Chapter markers',location:'settings.plugins',fields:[{key:'count',label:'Chapter count',type:'number',min:1,max:20,step:1,default:5}]});
 await c.commands.register<{count?:number}>('add-chapter-markers',async input=>{
  const saved=await c.configuration.get('count');return addChapters(c,input?.count??(typeof saved==='number'?saved:5));
 });
 await c.ui.registerAction({id:'chapters',title:'Add chapter markers',location:'toolbar',command:'add-chapter-markers'});
}
