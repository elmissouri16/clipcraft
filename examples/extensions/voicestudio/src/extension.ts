import type {ExtensionContext} from '@clipcraft/plugin-sdk/extension';
import {cloneVoice,cloneAndVoiceover,setVoiceTranscript,type CloneInput,type CloneVoiceoverInput,type TranscriptInput} from './clone';
const studio=require('./studio.cjs');
export async function activate(context:ExtensionContext){
 const savedAddress=await context.configuration.get<string>('address');
 if(savedAddress==null||!savedAddress.trim())await context.configuration.update({key:'address',value:studio.STUDIO_URL});
 const address=async()=>await context.configuration.get<string>('address')||studio.STUDIO_URL;
 const enabled=async()=>await context.configuration.get<boolean>('enabled')===true;
 const inspect=async(signal?:AbortSignal)=>{
  if(!await enabled())return {enabled:false,running:false,voices:[],error:'Enable VoiceStudio in Voice settings.'};
  const state=await studio.studioStatus(fetch,await address(),{signal});
  return {...state,enabled:true,supportsStyle:true,supportsSpeed:true,voices:state.voices.map((voice:any)=>({id:voice.id,name:voice.name,language:voice.language,styleRequired:voice.id.startsWith('design:'),description:[voice.needsTranscript?'Reference transcript missing: use set-voice-transcript with the exact reference words before speech generation.':'',voice.id.startsWith('design:')?'Describe the speaker in style.':state.activeEngine==='omnivoice'?'OmniVoice accepts speaker attributes (gender, age, pitch, accent, whisper), not free-form delivery prose. Omit style to preserve the saved voice.':''].filter(Boolean).join(' ')}))};
 };
 await context.commands.register('validate-setting',(input:any)=>({value:input.key==='address'?studio.studioUrl(input.value):input.value}));
 await context.commands.register('test-connection',async()=>{
  const state=await studio.studioStatus(fetch,await address());
  return {...state,...(state.running?{message:`VoiceStudio ${state.version||''} is running · ${state.voices.length} voices.`}:{})};
 });
 let cloning=false;
 const cloneCommand=async<T extends CloneInput>(input:T,signal:AbortSignal,run:(c:ExtensionContext,input:T,signal:AbortSignal)=>Promise<unknown>)=>{
  if(cloning)throw Error('A voice cloning request is already running.');cloning=true;
  try{return await run(context,input,signal);}finally{cloning=false;}
 };
 await context.commands.register<CloneInput>('clone-voice',(input,control)=>cloneCommand(input,control.signal,cloneVoice));
 await context.commands.register<CloneVoiceoverInput>('clone-and-voiceover',(input,control)=>cloneCommand(input,control.signal,cloneAndVoiceover));
 await context.commands.register<TranscriptInput>('set-voice-transcript',(input,control)=>setVoiceTranscript(context,input,control.signal));
 await context.services.register('speech',{
  status:(_input:any,request:{signal:AbortSignal})=>inspect(request.signal),
  generate:async(input:any,request:{signal:AbortSignal})=>context.jobs.run('VoiceStudio speech',async job=>{
   const signal=AbortSignal.any([job.signal,request.signal]);
   if(!await enabled())throw Error('Enable VoiceStudio in Voice settings.');
   const base=await address(),state=await studio.studioStatus(fetch,base,{signal});
   if(!state.running)throw Error(state.error||'VoiceStudio is not running');
   const voice=state.voices.find((v:any)=>v.id===input.voiceId);if(!voice)throw Error('Choose an available VoiceStudio voice');
   if(voice.id.startsWith('design:')&&!String(input.style||'').trim())throw Error('Describe the speaker in the style field first.');
   if(voice.needsTranscript&&state.activeEngine==='omnivoice')throw Error('Voice '+voice.id+' needs its exact reference transcript. Use set-voice-transcript, then reuse this voice ID; do not clone again.');
   const style=await studio.studioStyle(fetch,base,input.style,{engine:voice.engine||state.activeEngine,signal});
   const file=await studio.studioSpeak(fetch,base,context.extension.storagePath,{...input,style,voiceId:voice.wire||voice.id,model:voice.engine||'',signal});
   if(signal.aborted)throw Error('Voice generation canceled');
   const artifact=await context.media.import({path:file,name:'VoiceStudio speech.wav'});
   if(signal.aborted){await context.media.release({id:artifact.id});throw Error('Voice generation canceled');}
   return artifact;
  })
 },{name:'VoiceStudio'});
 await context.ui.registerSettings({id:'settings',title:'VoiceStudio',location:'settings.voice',validate:'validate-setting',fields:[
  {key:'enabled',label:'Use VoiceStudio',type:'boolean',default:false,description:'Connect to the VoiceStudio app installed separately on this computer.'},
  {key:'address',label:'VoiceStudio address',type:'string',default:studio.STUDIO_URL,description:'Voices and models are managed in VoiceStudio.'}
 ]});
 await context.ui.registerAction({id:'test',title:'Test VoiceStudio connection',location:'settings.voice',command:'test-connection'});
 await context.ui.registerIntegration({id:'voice',title:'VoiceStudio',point:'voice.engines',service:'speech',order:20,aliases:['voicestudio']});
}
