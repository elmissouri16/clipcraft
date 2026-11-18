import type {ExtensionContext} from '@clipcraft/plugin-sdk/extension';
import {configure,renderGif,type GifInput} from './gif';
export {deactivate} from './gif';
export async function activate(c:ExtensionContext){
 await configure(c);
 await c.commands.register<GifInput>('export-gif',(input,control)=>c.jobs.run('Export GIF',async job=>{
  const result=await renderGif(c,input,job);return result?{message:'GIF saved: '+result.path,file:result}:{message:'No GIF was saved.'};
 },{signal:control.signal}));
 await c.ui.registerAction({id:'export',title:"Export GIF",location:'export',command:'export-gif'});
}
