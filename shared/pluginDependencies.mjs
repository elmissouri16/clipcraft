import {packFilterLutRef} from './pluginColor.mjs';
// Project-specific pack references and explicit native-editor replacement plans.
import {effectId,effectParameters,validateEffectDefinition} from './pluginEffects.mjs';
import {transitionId,validateTransitionDefinition} from './pluginTransitions.mjs';
import {FONT_LIST} from './fontCatalog.mjs';
const lanes={video:'videoClips',overlay:'overlayClips',text:'textClips',effect:'effectClips'};
const local=/^[a-z][a-z0-9-]{0,63}$/,digest=/^[a-f0-9]{64}$/;
const pictureRef=(value,kind)=>{
 const prefix=kind==='effect'?'plugin':'plugin-transition',match=typeof value==='string'&&value.match(new RegExp(`^${prefix}:([a-z][a-z0-9-]{0,47}\\.[a-z][a-z0-9-]{0,47})/([a-z][a-z0-9-]{0,63})@([a-f0-9]{64})$`));
 return match?{kind,pluginId:match[1],id:match[2],digest:match[3]}:null;
};
export const dependencyKey=v=>`${v.kind}:${v.digest}:${v.id}`;
export function collectPackDependencies(project){
 const refs=new Map(),copied=new Map(),invalid=[];
 const add=(ref,track,clip,metadata,active=true)=>{
  if(!ref)return;const key=dependencyKey(ref);if(!refs.has(key))refs.set(key,{...ref,name:metadata?.name||ref.id,version:metadata?.version,pluginId:ref.pluginId||metadata?.pluginId,uses:[],required:false});
  const row=refs.get(key);if(!row.uses.some(u=>u.track===track&&u.id===clip.id))row.uses.push({track,id:clip.id});row.required ||= !clip.disabled&&!clip.gap&&active;
 };
 for(const [track,field] of Object.entries(lanes))for(const clip of project?.[field]||[]){
  if(track==='video'||track==='overlay'){
   for(const id of Array.isArray(clip.effects)?clip.effects:[]){if(typeof id==='string'&&id.startsWith('plugin:')){const ref=pictureRef(id,'effect');if(!ref)invalid.push({track,id:clip.id,kind:'effect'});else add(ref,track,clip,clip.pluginEffects?.[id],clip.fxStrength?.[id]!==0&&!clip.pluginEffects?.[id]?.disabled);}}
   const tr=clip.transition;if(typeof tr?.type==='string'&&tr.type.startsWith('plugin-transition:')){const ref=pictureRef(tr.type,'transition');if(!ref)invalid.push({track,id:clip.id,kind:'transition'});else add(ref,track,clip,tr.pluginTransition,(tr.timelineOverlap??tr.duration)>0&&!tr.pluginTransition?.disabled);}
   const filterLut=packFilterLutRef(clip.filter);if(filterLut)add({kind:'lut',digest:filterLut.pluginDigest,id:filterLut.assetId},track,clip,clip.filterDependency,(clip.filterIntensity??100)>0);
   const lut=clip.grade?.lut;if(lut?.ref?.pluginDigest){const ref={kind:'lut',digest:lut.ref.pluginDigest,id:lut.ref.assetId};if(digest.test(ref.digest)&&local.test(ref.id))add(ref,track,clip,{name:lut.name,...lut.dependency},(lut.intensity??100)>0);else invalid.push({track,id:clip.id,kind:'lut'});}
  }
  if(track==='effect'&&typeof clip.fx==='string'&&clip.fx.startsWith('plugin:')){const ref=pictureRef(clip.fx,'effect');if(!ref)invalid.push({track,id:clip.id,kind:'effect'});else add(ref,track,clip,clip.pluginEffect,clip.strength!==0&&!clip.pluginEffect?.disabled);}
  if(track==='effect'&&typeof clip.fx==='string'&&clip.fx.startsWith('filter:')){const ref=packFilterLutRef(clip.fx.slice(7));if(ref)add({kind:'lut',digest:ref.pluginDigest,id:ref.assetId},track,clip,clip.filterDependency,clip.strength!==0);}
  if(track==='text'&&typeof clip.font==='string'&&clip.font.startsWith('pack-font:')){const match=clip.font.match(/^pack-font:([a-f0-9]{64}):([a-z][a-z0-9-]{0,63})$/);if(!match)invalid.push({track,id:clip.id,kind:'font'});else add({kind:'font',digest:match[1],id:match[2]},track,clip,clip.fontDependency||(clip.packStyle?.digest===match[1]?{...clip.packStyle,name:match[2]}:undefined));}
  for(const key of ['packStyle','packColor','packMotion']){const meta=clip[key];if(meta&&digest.test(meta.digest))copied.set(`${meta.digest}/${key}/${meta.id}`,{...meta,kind:key});}
 }
 const used=new Set(['videoClips','overlayClips','audioClips'].flatMap(k=>(project?.[k]||[]).map(c=>c.mediaId)));
 return {references:[...refs.values()],copied:[...copied.values()],invalid,ownedSounds:(project?.media||[]).filter(m=>m.origin==='plugin-pack'&&used.has(m.id)).length};
}
export function validateDependencyRequests(input){
 if(!Array.isArray(input)||input.length>4096)throw Error('At most 4096 unique pack references can be inspected.');const seen=new Set();
 return input.map(v=>{if(!v||typeof v!=='object'||Object.keys(v).some(k=>!['kind','digest','id','pluginId'].includes(k))||!['effect','transition','font','lut'].includes(v.kind)||typeof v.digest!=='string'||!digest.test(v.digest)||typeof v.id!=='string'||!local.test(v.id)||v.pluginId!==undefined&&(typeof v.pluginId!=='string'||!/^[a-z][a-z0-9-]{0,47}\.[a-z][a-z0-9-]{0,47}$/.test(v.pluginId))||seen.has(dependencyKey(v)))throw Error('Invalid project pack reference.');seen.add(dependencyKey(v));return {...v};});
}
export function dependencyReport(input,rows){
 return validateDependencyRequests(input).map(ref=>{
  const row=rows.find(r=>r.key===ref.digest),manifest=row?.manifest,item=manifest?.contributes[{effect:'effects',transition:'transitions',font:'fonts',lut:'luts'}[ref.kind]]?.find(v=>v.id===ref.id);
  const status=!row?'missing':row.error?'changed':!item||ref.pluginId&&manifest.id!==ref.pluginId?'invalid':!row.available?'disabled':row.enabled?'ready':'retained';
  return {...ref,status,...(manifest?{pluginId:manifest.id,pluginName:manifest.name,version:manifest.version,publisher:manifest.publisher}:{}),...(item?{name:item.name}:{}),...(row?.error?{error:row.error}:{})};
 });
}
const sanitizedParams=(definition,old={})=>Object.fromEntries(definition.parameters.map(p=>[p.id,Number.isFinite(old?.[p.id])?Math.max(p.min,Math.min(p.max,old[p.id])):p.default]));
export function dependencyReplacementUpdates(project,{from,to}){
 const [source]=validateDependencyRequests([from]);if(!to||typeof to!=='object')throw Error('Choose an installed replacement.');
 let replacement;
 if(source.kind==='effect'||source.kind==='transition'){
  if(typeof to.pluginId!=='string'||!/^[a-z][a-z0-9-]{0,47}\.[a-z][a-z0-9-]{0,47}$/.test(to.pluginId)||typeof to.version!=='string'||!/^\d+\.\d+\.\d+$/.test(to.version)||!digest.test(to.digest)||!local.test(to.id)||to.contributionId!==`${to.pluginId}/${to.id}`)throw Error('Invalid replacement identity.');
  const value=source.kind==='effect'?validateEffectDefinition({id:to.id,name:to.name,expression:to.expression,parameters:to.parameters}):validateTransitionDefinition({id:to.id,name:to.name,expression:to.expression,parameters:to.parameters,duration:to.duration});
  replacement={...value,pluginId:to.pluginId,digest:to.digest,version:to.version,contributionId:to.contributionId};
 }else if(source.kind==='font'){
  const pack=typeof to.id==='string'&&to.id.match(/^pack-font:([a-f0-9]{64}):([a-z][a-z0-9-]{0,63})$/);
  if(!FONT_LIST.some(f=>f.id===to.id)&&!/^custom-[a-z0-9.-]{1,160}$/.test(to.id)&&!pack)throw Error('Invalid replacement font.');
  if(pack&&(to.digest!==pack[1]||to.localId!==pack[2]))throw Error('Invalid font package identity.');replacement=to;
 }else{if(!digest.test(to.digest)||!local.test(to.id))throw Error('Invalid replacement LUT.');replacement=to;}
 const oldPicture=source.kind==='effect'?effectId({contributionId:`${source.pluginId}/${source.id}`,digest:source.digest}):source.kind==='transition'?transitionId({contributionId:`${source.pluginId}/${source.id}`,digest:source.digest}):null;
 const instance=old=>({pluginId:replacement.pluginId,contributionId:replacement.contributionId,version:replacement.version,digest:replacement.digest,name:replacement.name,params:effectParameters(replacement,sanitizedParams(replacement,old?.params)),...(old?.disabled?{disabled:true}:{})});
 if(source.kind==='font'&&replacement.id===`pack-font:${source.digest}:${source.id}`||source.kind==='lut'&&replacement.digest===source.digest&&replacement.id===source.id||['effect','transition'].includes(source.kind)&&replacement.digest===source.digest&&replacement.pluginId===source.pluginId&&replacement.id===source.id)return [];
 const updates=[];
 for(const [track,field] of Object.entries(lanes))for(const clip of project?.[field]||[]){let patch;
  if(source.kind==='effect'){
   const id=effectId(replacement);
   if(track==='effect'&&clip.fx===oldPicture)patch={fx:id,pluginEffect:instance(clip.pluginEffect)};
   if(['video','overlay'].includes(track)&&clip.effects?.includes(oldPicture)){
    if(id!==oldPicture&&clip.effects.includes(id))throw Error('Replacement effect is already present on a clip.');
    const pluginEffects={...(clip.pluginEffects||{})},fxStrength={...(clip.fxStrength||{})};delete pluginEffects[oldPicture];if(Object.hasOwn(fxStrength,oldPicture)){fxStrength[id]=fxStrength[oldPicture];delete fxStrength[oldPicture];}pluginEffects[id]=instance(clip.pluginEffects?.[oldPicture]);patch={effects:clip.effects.map(e=>e===oldPicture?id:e),pluginEffects,fxStrength};
   }
  }else if(source.kind==='transition'&&clip.transition?.type===oldPicture)patch={transition:{...clip.transition,type:transitionId(replacement),pluginTransition:instance(clip.transition.pluginTransition)}};
  else if(source.kind==='font'&&track==='text'&&clip.font===`pack-font:${source.digest}:${source.id}`)patch={font:replacement.id,fontDependency:replacement.source==='pack'?{pluginId:replacement.pluginId,digest:replacement.digest,version:replacement.version,id:replacement.localId,name:replacement.name}:undefined};
  else if(source.kind==='lut'){
   const meta={pluginId:replacement.pluginId,digest:replacement.digest,version:replacement.version,id:replacement.id,name:replacement.name},filter=packFilterLutRef(track==='effect'?(typeof clip.fx==='string'?clip.fx.slice(7):undefined):clip.filter);
   if(clip.grade?.lut?.ref?.pluginDigest===source.digest&&clip.grade.lut.ref.assetId===source.id)patch={grade:{...clip.grade,lut:{...clip.grade.lut,name:replacement.name,ref:{pluginDigest:replacement.digest,assetId:replacement.id},dependency:meta}}};
   if(filter?.pluginDigest===source.digest&&filter.assetId===source.id)patch={...patch,...(track==='effect'?{fx:`filter:pack-lut:${replacement.digest}:${replacement.id}`}:{filter:`pack-lut:${replacement.digest}:${replacement.id}`}),filterDependency:meta};
  }
  if(patch)updates.push({track,id:clip.id,patch});
 }
 return updates;
}
