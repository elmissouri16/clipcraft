import {validateMotionContributions} from '../../../shared/pluginMotion.mjs';
import {validateColorSettings,colorPresetPatch} from '../../../shared/pluginColor.mjs';
import {useSyncExternalStore} from 'react';
import {validateTextStyle,textStylePatch} from '../../../shared/pluginStyles.mjs';
let catalog={textStyles:[],luts:[],colorPresets:[],motionPresets:[]},revision=0;
const listeners=new Set();
export const subscribeCreative=fn=>{listeners.add(fn);return()=>listeners.delete(fn);};
export const creativeRevision=()=>revision;
export function setPluginCreative(value={}){
 const textStyles=(value.textStyles||[]).map(s=>{if(!/^[a-f0-9]{64}$/.test(s.digest)||typeof s.pluginId!=='string'||s.contributionId!==`${s.pluginId}/${s.id}`)throw Error('Invalid creative pack identity.');return {...s,style:validateTextStyle(s.style,{runtime:true})};});
 const luts=value.luts||[],colorPresets=(value.colorPresets||[]).map(s=>({...s,settings:validateColorSettings(s.settings,{localLuts:luts.filter(l=>l.digest===s.digest).map(l=>l.id)})}));
 const motionPresets=(value.motionPresets||[]).map(p=>({...p,...validateMotionContributions([{id:p.id,name:p.name,animation:p.animation,curves:p.curves,transform:p.transform,opacity:p.opacity}])[0]}));
 const next={textStyles,luts,colorPresets,motionPresets};if(JSON.stringify(next)===JSON.stringify(catalog))return;
 catalog=next;revision++;listeners.forEach(fn=>fn());
}
export function useCreativePacks(){useSyncExternalStore(subscribeCreative,creativeRevision,creativeRevision);return catalog;}
export const packTextTemplates=()=>catalog.textStyles.filter(s=>s.preferred).map(s=>({
 id:`pack-style:${s.digest}:${s.id}`,name:s.name,cat:s.kind==='caption'?'Captions':s.kind==='lower-third'?'Labels':'Titles',caption:s.kind==='caption',tags:['Plugins',s.kind==='caption'?'Captions':s.kind==='lower-third'?'Labels':'Titles'],
 previewText:s.sampleText,duration:s.duration,patch:textStylePatch(s),pluginName:s.pluginName,
}));

export const preferredPackLuts=()=>catalog.luts.filter(s=>s.preferred).map(s=>({...s,ref:{pluginDigest:s.digest,assetId:s.id}}));
export const preferredPackColors=()=>catalog.colorPresets.filter(s=>s.preferred);
export {colorPresetPatch};

export const preferredPackMotions=()=>catalog.motionPresets.filter(p=>p.preferred);
