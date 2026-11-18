import type {ExtensionContext} from '@clipcraft/plugin-sdk/extension';
import {configure,renderGif,type GifInput} from './gif';
import {reviewUpload} from './upload';
export {deactivate} from './gif';
let busy=false;
export async function activate(c:ExtensionContext){
 await configure(c,[{key:'uploadUrl',label:'HTTPS PUT address',type:'string',default:''},{key:'uploadToken',label:'Optional bearer token',type:'secret'}]);
 await c.commands.register<GifInput>('export-gif',async(input,control)=>{
  if(busy)throw Error('An export or upload from this extension is already running.');busy=true;
  try{
   const file=await c.jobs.run('Export GIF',job=>renderGif(c,input,job),{signal:control.signal});
   if(!file)return {message:'No GIF was saved.'};
   let upload;
   try{upload=await c.jobs.run('Review GIF upload',job=>reviewUpload(c,file,job),{signal:control.signal});}
   catch{upload={state:'not-sent',reason:'review-not-started',bytes:0,sha256:file.sha256};}
   return {message:upload.state==='confirmed'?'GIF saved and upload acknowledged.':upload.state==='uncertain'?'GIF saved. Upload outcome is uncertain; check the service before trying again.':'GIF saved locally. No upload was sent.',file,upload};
  }finally{busy=false;}
 });
 await c.ui.registerAction({id:'export',title:"Export GIF and review upload",location:'export',command:'export-gif'});
}
