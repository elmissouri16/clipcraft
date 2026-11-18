// Authoring snapshots contain reusable appearance, never caption words or project timing.
import {resolveStyle} from '../text/style.js';
import {TEXT_STYLE_RULES} from '../../../shared/pluginStyles.mjs';
import {motionFromClip} from '../../../shared/pluginMotion.mjs';
import {packFilterLutRef} from '../../../shared/pluginColor.mjs';
export function colorSnapshot(clip){
 const grade=structuredClone(clip.grade||{}),sourceLut=grade.lut?.ref;delete grade.lut;
 const filter=clip.filter||'none',sourceFilterLut=packFilterLutRef(filter)||(filter.startsWith('lut:')?{bundled:filter.slice(4)}:undefined);
 return {settings:{filter:sourceFilterLut?'none':filter,filterIntensity:clip.filterIntensity??100,adjust:structuredClone(clip.adjust||{}),grade,...(sourceLut?{lutIntensity:clip.grade.lut.intensity??100}:{})},...(sourceLut?{sourceLut:structuredClone(sourceLut)}:{}),...(sourceFilterLut?{sourceFilterLut}: {})};
}
export function packCandidates(project,savedLooks=[]){
 const list=[];
 for(const [index,clip] of (project?.textClips||[]).entries()){
  const resolved=resolveStyle(clip),style=Object.fromEntries(Object.keys(TEXT_STYLE_RULES).filter(k=>resolved[k]!==undefined).map(k=>[k,structuredClone(resolved[k])]));
  list.push({key:'text:'+clip.id,type:'text',index:index+1,caption:!!clip.caption,preset:{kind:clip.caption?'caption':'title',style,sampleText:'Your title',duration:3}});
 }
 for(const [track,field] of [['video','videoClips'],['overlay','overlayClips']])for(const [index,clip] of (project?.[field]||[]).entries())if(!clip.gap){
  list.push({key:`color:${track}:${clip.id}`,type:'color',track,index:index+1,preset:colorSnapshot(clip)});
  if(clip.anim&&Object.keys(clip.anim).length||Object.values(clip.keyframes||{}).some(v=>Array.isArray(v)&&v.length)||Object.keys(clip.transform||{}).length||clip.opacity!==undefined&&clip.opacity!==1){
   try{list.push({key:`motion:${track}:${clip.id}`,type:'motion',track,index:index+1,preset:motionFromClip(clip)});}catch(error){list.push({key:`motion:${track}:${clip.id}`,type:'motion',track,index:index+1,error:error.message});}
  }
 }
 for(const [index,look] of savedLooks.entries())list.push({key:'saved:'+index,type:'color',savedName:look.name,index:index+1,preset:colorSnapshot(look)});
 return list;
}
