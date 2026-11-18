import {setPluginCreative} from './creativeRegistry.js';
import {setPluginTransitions,subscribePluginTransitions,assertPluginTransitions} from './transitionRegistry.js';
// Renderer-owned read-only definitions. Project files carry references/parameters, never expressions.
import {validateEffectDefinition,effectExpression,effectParameters,effectId,isPluginEffect} from '../../../shared/pluginEffects.mjs';
export {isPluginEffect};
let definitions=new Map(),revision=0;
const listeners=new Set();
subscribePluginTransitions(()=>{revision++;listeners.forEach(fn=>fn());});
export const subscribePluginEffects=fn=>{listeners.add(fn);return ()=>listeners.delete(fn);};
export const pluginEffectsRevision=()=>revision;
export function setPluginEffects(rows=[]) {
  const next=new Map();
  for(const row of rows){
    if(!/^[a-f0-9]{64}$/.test(row.digest)||typeof row.pluginId!=='string'||row.contributionId!==`${row.pluginId}/${row.id}`)throw Error('Invalid effect dependency identity.');
    const def=validateEffectDefinition({id:row.id,name:row.name,expression:row.expression,parameters:row.parameters});
    const item={...def,pluginId:row.pluginId,contributionId:row.contributionId,version:row.version,digest:row.digest,preferred:row.preferred===true};
    next.set(effectId(item),item);
  }
  if(JSON.stringify([...definitions])===JSON.stringify([...next]))return;
  definitions=next;revision++;listeners.forEach(fn=>fn());
}
export const pluginEffectDefinition=id=>definitions.get(id);
export const preferredPluginEffects=()=>[...definitions].filter(([,d])=>d.preferred).map(([id,d])=>({id,name:d.name,icon:'◈',group:'Plugins',plugin:true}));
export function pluginEffectInstance(id,params) {
  const d=definitions.get(id);if(!d)return undefined;
  return {pluginId:d.pluginId,contributionId:d.contributionId,version:d.version,digest:d.digest,name:d.name,params:effectParameters(d,params)};
}
export function pluginEffectProblem(id,instance) {
  if(!isPluginEffect(id)||instance?.disabled)return null;
  const d=definitions.get(id);
  if(!d)return 'Required plugin version is unavailable or disabled. Check Settings → Plugins; review recovery if the inventory is damaged.';
  if(!instance||['pluginId','contributionId','version','digest'].some(k=>instance[k]!==d[k]))return 'Saved effect dependency does not match its installed version.';
  try{effectParameters(d,instance.params);}catch(e){return e.message;}
  return null;
}
export function pluginEffectSource(id,instance) {
  if(!isPluginEffect(id)||instance?.disabled||pluginEffectProblem(id,instance))return null;
  return effectExpression(definitions.get(id),instance.params);
}
export function preferredEffectUpgrade(instance) {
  return [...definitions].find(([,d])=>d.preferred&&d.contributionId===instance?.contributionId)?.[0];
}
export function projectPluginProblems(project) {
  const out=[];
  const check=(id,instance,location)=>{const reason=pluginEffectProblem(id,instance);if(reason)out.push({id,name:instance?.name||id,location,reason});};
  for(const track of ['videoClips','overlayClips'])for(const clip of project[track]||[]){
    if(clip.disabled||clip.gap)continue;
    for(const id of clip.effects||[])if(clip.fxStrength?.[id]!==0)check(id,clip.pluginEffects?.[id],clip.id);
  }
  for(const clip of project.effectClips||[])if(!clip.disabled&&clip.strength!==0)check(clip.fx,clip.pluginEffect,clip.id);
  return out;
}
export function assertPluginEffects(project) {
  assertPluginTransitions(project);
  const issues=projectPluginProblems(project);
  if(issues.length)throw Error(`Plugin effects need attention before export: ${issues.map(i=>`${i.name}: ${i.reason}`).join(' ')} Reinstall the required version, explicitly upgrade, or disable the affected effect in the inspector.`);
}
let refreshQueue=Promise.resolve();
export function refreshPluginEffects() {
  const job=refreshQueue.then(async()=>{
    const api=globalThis.window?.api;if(!api)return;
    try{
      const [effects,transitions,creative]=await Promise.all([api.pluginEffects?.(),api.pluginTransitions?.(),api.pluginCreative?.()]);
      if(effects)setPluginEffects(effects);if(transitions)setPluginTransitions(transitions);if(creative)setPluginCreative(creative);
    }catch(error){setPluginEffects([]);setPluginTransitions([]);setPluginCreative();throw error;}
  });
  refreshQueue=job.catch(()=>{});return job;
}
