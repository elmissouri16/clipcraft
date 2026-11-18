import type {ExtensionContext} from '@clipcraft/plugin-sdk/extension';
export async function activate(c:ExtensionContext){
 await c.ui.registerSettings({id:'controls',title:'Picture opacity',location:'settings.plugins',fields:[{key:'opacity',label:'Opacity',type:'number',min:0,max:1,step:.05,default:.7}]});
 await c.commands.register<{opacity?:number;clipId?:string;location?:string}>('opacity',async input=>{
  const snapshot=await c.editor.read(input?.clipId?{clipIds:[input.clipId]}:undefined),ids=input?.clipId?[input.clipId]:snapshot.selection.clipIds;
  if(ids.length!==1)throw Error('Select one unlinked picture clip.');
  const clip=snapshot.timeline.clips.find(clip=>clip.id===ids[0]),track=snapshot.timeline.tracks.find(track=>track.id===clip?.trackId);
  if(!clip||!track||!['video','overlay'].includes(track.lane)||clip.link)throw Error('Choose one unlinked picture clip.');
  const saved=await c.configuration.get('opacity'),opacity=input?.opacity??(typeof saved==='number'?saved:.7);
  if(!Number.isFinite(opacity)||opacity<0||opacity>1)throw Error('Opacity must be between zero and one.');
  await c.editor.apply({documentId:snapshot.documentId,revision:snapshot.revision,operations:[{type:'set-opacity',clipId:clip.id,partnerClipId:null,opacity}]});
  return {message:'Picture opacity updated.'};
 });
 for(const location of ['toolbar','inspector','context'] as const)await c.ui.registerAction({id:'opacity-'+location,title:'Picture opacity demo',location,command:'opacity'});
}
