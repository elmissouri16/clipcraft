import type {ExtensionContext} from '@clipcraft/plugin-sdk/extension';
export async function activate(context:ExtensionContext){
 const action=await context.ui.registerAction({id:'reset-opacity',title:'Reset picture opacity',location:'toolbar',command:'reset-opacity',order:-100,enabled:false,disabledReason:'Select a picture clip',icon:{paths:['M5 8 L5 3 L10 3','M5 3 C16 1 22 14 15 20 C9 24 2 17 4 12']}});
 const picture=await context.ui.registerInspector({id:'picture',title:'Picture properties',lanes:['video','overlay'],fields:[
  {key:'opacity',label:'Opacity',property:'opacity',type:'range'},
  {key:'scale',label:'Scale',property:'transform.scale',type:'number'},
  {key:'x',label:'Horizontal position',property:'transform.x',type:'number'},
  {key:'y',label:'Vertical position',property:'transform.y',type:'number'},
  {key:'rotation',label:'Rotation',property:'transform.rot',type:'number'},
 ]});
 const sound=await context.ui.registerInspector({id:'sound',title:'Sound properties',fields:[
  {key:'volume',label:'Volume',property:'audio.volume',type:'range'},
  {key:'muted',label:'Mute',property:'audio.muted'},
  {key:'fade-in',label:'Fade in (seconds)',property:'audio.fadeIn_sec',type:'number'},
  {key:'fade-out',label:'Fade out (seconds)',property:'audio.fadeOut_sec',type:'number'},
 ]});
 const text=await context.ui.registerInspector({id:'text',title:'Text properties',lanes:['text'],fields:[
  {key:'content',label:'Text',property:'text.content',measuredWords:'reject'},
  {key:'size',label:'Size',property:'text.style.size'},
  {key:'font',label:'Font',property:'text.style.font'},
  {key:'colour',label:'Colour',property:'text.style.color'},
  {key:'bold',label:'Bold',property:'text.style.bold'},
  {key:'align',label:'Alignment',property:'text.style.align'},
 ]});
 const motion=await context.ui.registerInspector({id:'motion',title:'Animation and speed',lanes:['video','overlay','audio'],fields:[
  {key:'speed',label:'Speed (keep timeline duration)',property:'speed'},
  {key:'opacity-curve',label:'Opacity curve',property:'curve.opacity'},
  {key:'x-curve',label:'Horizontal motion curve',property:'curve.x'},
  {key:'volume-curve',label:'Volume curve',property:'curve.volume'},
 ]});
 await context.ui.registerInspector({id:'effects',title:'First effect slot',lanes:['video','overlay'],fields:[
  {key:'enabled',label:'Enable effect',property:'effect.enabled',effect:{index:0}},
  {key:'strength',label:'Effect strength',property:'effect.strength',effect:{index:0},type:'range'},
  {key:'gain',label:'Gain parameter',property:'effect.parameter',effect:{index:0,parameter:'gain'}},
 ]});
 await context.ui.registerInspector({id:'free-effect',title:'Effects track resource',lanes:['effect'],fields:[
  {key:'enabled',label:'Enable effect',property:'effect.enabled',effect:{index:null}},
  {key:'strength',label:'Effect strength',property:'effect.strength',effect:{index:null}},
  {key:'gain',label:'Gain parameter',property:'effect.parameter',effect:{index:null,parameter:'gain'}},
 ]});
 const selected=async()=>{
  const editor=await context.editor.read(),clip=editor.timeline.clips.find(clip=>editor.selection.clipIds.includes(clip.id)&&!clip.gap&&['video','overlay'].includes(clip.trackId.split(':')[0]));
  return {editor,clip};
 };
 await context.commands.register('reset-opacity',async()=>{
  const {editor,clip}=await selected();if(!clip)throw Error('Select a picture clip');
  await context.editor.apply({documentId:editor.documentId,revision:editor.revision,operations:[{type:'set-opacity',clipId:clip.id,partnerClipId:clip.link?.partnerId??null,opacity:1}]});
  return {message:'Picture opacity reset'};
 });
 const sync=async()=>{
  try{const {editor,clip}=await selected(),partner=editor.timeline.clips.find(item=>item.id===clip?.link?.partnerId),locked=!clip||editor.timeline.tracks.some(track=>track.locked&&[clip.trackId,partner?.trackId].includes(track.id));await action.update({enabled:!locked,disabledReason:locked?'Select an unlocked picture clip':''});}
  catch{await action.update({enabled:false,disabledReason:'Select a picture clip'});}
 };
 for(const event of ['selection.changed','project.changed','project.opened','project.closed'] as const){const sub=context.events.on(event,sync);await sub.ready;context.subscriptions.push(sub);}
 await sync();
}
