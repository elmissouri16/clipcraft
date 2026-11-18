// Motion packs reuse ClipCraft animations and source-time keyframes; there is no custom runtime.
import {ANIMATIONS} from './motionCatalog.mjs';
const properties={scale:[.05,4],x:[-2,2],y:[-2,2],rot:[-180,180],opacity:[0,1]};
const fail=message=>{throw Error('Invalid motion pack: '+message);};
const record=v=>!!v&&typeof v==='object'&&!Array.isArray(v),number=(v,lo,hi)=>Number.isFinite(v)&&v>=lo&&v<=hi;
const keys=(v,names)=>{if(!record(v)||Object.keys(v).some(k=>!names.includes(k)))fail('unknown fields');};
const ease=value=>{
 if(value===undefined)return;
 if(typeof value==='string'){if(!['linear','continuous','in','out','inout','spring','back','smooth','easeIn','easeOut','snapIn','snapOut','overshoot'].includes(value))fail('unknown ease');return;}
 keys(value,['p1x','p1y','p2x','p2y']);if(!['p1x','p2x'].every(k=>number(value[k],0,1))||!['p1y','p2y'].every(k=>number(value[k],-4,4)))fail('invalid cubic easing');
};
export function validateMotionContributions(input){
 if(input===undefined)return [];if(!Array.isArray(input)||input.length>100)fail('at most 100 presets');
 const ids=new Set();return input.map(v=>{
  keys(v,['id','name','animation','curves','transform','opacity']);if(typeof v.id!=='string'||!/^[a-z][a-z0-9-]{0,63}$/.test(v.id)||ids.has(v.id))fail('unique lowercase IDs required');ids.add(v.id);
  if(typeof v.name!=='string'||!v.name.trim()||v.name.length>160||/[\u0000-\u001f]/.test(v.name))fail('invalid name');
  if(v.animation!==undefined)keys(v.animation,['in','out','combo']);if(v.curves!==undefined)keys(v.curves,Object.keys(properties));
  const animation=v.animation||{},curves=v.curves||{};keys(animation,['in','out','combo']);keys(curves,Object.keys(properties));
  if(v.transform!==undefined){keys(v.transform,['scale','scaleX','scaleY','uniform','x','y','rot']);for(const [k,value] of Object.entries(v.transform)){if(k==='uniform'?typeof value!=='boolean':!number(value,...(k.startsWith('scale')?properties.scale:k==='rot'?properties.rot:properties.x)))fail('invalid base transform');}}
  if(v.opacity!==undefined&&!number(v.opacity,0,1))fail('invalid base opacity');
  if(!Object.keys(animation).length&&!Object.keys(curves).length&&v.transform===undefined&&v.opacity===undefined)fail('empty motion');
  if(animation.combo&&(animation.in||animation.out))fail('combo replaces entrance/exit');
  for(const [kind,a] of Object.entries(animation)){keys(a,['type','duration']);if(!ANIMATIONS[kind].some(p=>p.id===a.type)||kind==='combo'&&a.duration!==undefined||a.duration!==undefined&&!number(a.duration,.05,10))fail('unknown animation or duration');}
  for(const [prop,list] of Object.entries(curves)){
   if(!Array.isArray(list)||list.length<2||list.length>64)fail('curves require 2 to 64 points');let previous=-Infinity;
   for(const point of list){keys(point,['at','value','ease']);if(!number(point.at,-10000,10000)||point.at<=previous||!number(point.value,...properties[prop]))fail('invalid normalized curve');previous=point.at;ease(point.ease);}
  }
  return {id:v.id,name:v.name,...(v.transform!==undefined?{transform:structuredClone(v.transform)}:{}),...(v.opacity!==undefined?{opacity:v.opacity}:{}),...(Object.keys(animation).length?{animation:structuredClone(animation)}:{}),...(Object.keys(curves).length?{curves:structuredClone(curves)}:{})};
 });
}
export function motionPresetPatch(definition,clip){
 const preset=validateMotionContributions([{id:definition.id,name:definition.name,animation:definition.animation,curves:definition.curves,transform:definition.transform,opacity:definition.opacity}])[0];
 const start=clip.in??0,span=clip.out-start;if(!number(start,0,1e9)||!number(span,.001,1e9))fail('picture source range is unavailable');
 const keyframes={...(clip.keyframes||{})};for(const prop of Object.keys(properties))delete keyframes[prop];
 for(const [prop,points] of Object.entries(preset.curves||{}))keyframes[prop]=points.map(p=>({t:start+span*p.at,v:p.value,...(p.ease!==undefined?{e:structuredClone(p.ease)}:{})}));
 return {...(preset.transform!==undefined?{transform:structuredClone(preset.transform)}:{}),...(preset.opacity!==undefined?{opacity:preset.opacity}:{}),anim:structuredClone(preset.animation||{}),keyframes,packMotion:{pluginId:definition.pluginId,digest:definition.digest,version:definition.version,id:definition.id,name:definition.name}};
}
// An exact source-time normalization for the in-app authoring workflow. No timing data is rewritten.
export function motionFromClip(clip){
 const start=clip.in??0,span=clip.out-start;if(!Number.isFinite(span)||span<=0)fail('picture source range is unavailable');
 const animation=structuredClone(clip.anim||{}),curves={};
 for(const prop of Object.keys(properties))if(clip.keyframes?.[prop]?.length)curves[prop]=clip.keyframes[prop].map(p=>({at:(p.t-start)/span,value:p.v,...(p.e!==undefined?{ease:structuredClone(p.e)}:{})}));
 const validated=validateMotionContributions([{id:'motion',name:'Current motion',animation,curves,transform:structuredClone(clip.transform||{}),opacity:clip.opacity??1}])[0];return {animation:validated.animation,curves:validated.curves,transform:validated.transform,opacity:validated.opacity};
}
