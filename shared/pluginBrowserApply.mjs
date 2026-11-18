import {textStylePatch} from './pluginStyles.mjs';
import {colorPresetPatch} from './pluginColor.mjs';
import {motionPresetPatch} from './pluginMotion.mjs';
import {effectId,effectParameters} from './pluginEffects.mjs';
import {transitionId} from './pluginTransitions.mjs';
// Prepared from a freshly verified host preview, then committed through ordinary editor actions.
export function packBrowserApplication(project,selection,content){
 if(content.development)throw Error('Development previews cannot become project dependencies. Install the package first.');
 const {kind,item,key:digest,pluginId,version,params={}}=content,def={...item,digest,pluginId,version,contributionId:`${pluginId}/${item.id}`};
 const meta={pluginId,digest,version,id:item.id,name:item.name};
 if(kind==='sounds')return {soundId:`pack-sound:${digest}:${item.id}`};
 if(kind==='textStyles'&&item.kind!=='caption')return {title:{...textStylePatch(def),text:item.sampleText||'Your title',duration:item.duration||3}};
 if(kind==='textStyles'){
  const clips=(project.textClips||[]).filter(c=>c.caption);if(!clips.length)throw Error('Add captions before applying a caption style.');return {updates:clips.map(c=>({track:'text',id:c.id,patch:textStylePatch(def)}))};
 }
 const track=selection?.track,clip=!selection?.items&&(project[{video:'videoClips',overlay:'overlayClips',text:'textClips'}[track]]||[]).find(c=>c.id===selection.id&&!c.gap);if(!clip)throw Error('Select one compatible timeline clip before applying this item.');let patch;
 if(kind==='fonts'){if(track!=='text')throw Error('Select a text clip to apply a font.');patch={font:`pack-font:${digest}:${item.id}`,fontDependency:meta};}
 else{
  if(!['video','overlay'].includes(track))throw Error('Select a picture clip to apply this item.');
  if(kind==='effects'){const id=effectId(def);patch={effects:[...new Set([...(clip.effects||[]),id])],pluginEffects:{...(clip.pluginEffects||{}),[id]:{...meta,contributionId:def.contributionId,params:effectParameters(def,params)}}};}
  else if(kind==='transitions'){if(track!=='video'||project.videoClips.findIndex(c=>c.id===clip.id)<1)throw Error('Select a main-track clip with a preceding clip.');patch={transition:{type:transitionId(def),duration:item.duration,pluginTransition:{...meta,contributionId:def.contributionId,params:effectParameters(def,params)}}};}
  else if(kind==='colorPresets')patch=colorPresetPatch(def);
  else if(kind==='motionPresets')patch=motionPresetPatch(def,clip);
  else if(kind==='luts')patch={grade:{...(clip.grade||{}),lut:{ref:{pluginDigest:digest,assetId:item.id},name:item.name,intensity:100,dependency:meta}}};
  else throw Error('Unsupported pack content.');
 }
 return {updates:[{track,id:clip.id,patch}]};
}
