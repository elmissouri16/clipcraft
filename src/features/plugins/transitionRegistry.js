import {validateTransitionDefinition,transitionExpression,transitionId,isPluginTransition,CROSSFADE_EXPRESSION} from '../../../shared/pluginTransitions.mjs';
import {effectParameters} from '../../../shared/pluginEffects.mjs';
export {isPluginTransition};
let definitions=new Map();
const listeners=new Set();
export const subscribePluginTransitions=fn=>{listeners.add(fn);return()=>listeners.delete(fn);};
export function setPluginTransitions(rows=[]) {
  const next=new Map();
  for(const row of rows){
    if(!/^[a-f0-9]{64}$/.test(row.digest)||typeof row.pluginId!=='string'||row.contributionId!==`${row.pluginId}/${row.id}`)throw Error('Invalid transition dependency identity.');
    const definition=validateTransitionDefinition({id:row.id,name:row.name,...(row.fragment!==undefined?{fragment:row.fragment}:{expression:row.expression}),parameters:row.parameters,duration:row.duration});
    const item={...definition,pluginId:row.pluginId,contributionId:row.contributionId,version:row.version,digest:row.digest,preferred:row.preferred===true};
    next.set(transitionId(item),item);
  }
  if(JSON.stringify([...definitions])===JSON.stringify([...next]))return;
  definitions=next;listeners.forEach(fn=>fn());
}
export const pluginTransitionDefinition=id=>definitions.get(id);
export const preferredPluginTransitions=()=>[...definitions].filter(([,d])=>d.preferred).map(([id,d])=>({id,name:d.name,duration:d.duration,fx:true,plugin:true}));
export function pluginTransitionInstance(id,params) {
  const d=definitions.get(id);if(!d)return undefined;
  return {pluginId:d.pluginId,contributionId:d.contributionId,version:d.version,digest:d.digest,name:d.name,params:effectParameters(d,params)};
}
export function pluginTransitionProblem(id,instance) {
  if(!isPluginTransition(id)||instance?.disabled)return null;
  const d=definitions.get(id);if(!d)return 'Required transition plugin version is unavailable or disabled. Check Settings → Plugins; review recovery if the inventory is damaged.';
  if(!instance||['pluginId','contributionId','version','digest'].some(k=>instance[k]!==d[k]))return 'Saved transition dependency does not match its installed version.';
  try{effectParameters(d,instance.params);}catch(error){return error.message;}
  return null;
}
export function pluginTransitionSpec(transition) {
  if(!isPluginTransition(transition?.type))return null;
  const d=definitions.get(transition.type),instance=transition.pluginTransition;
  const problem=pluginTransitionProblem(transition.type,instance);
  return {id:transition.type,name:instance?.name||d?.name||'Plugin transition',duration:d?.duration||transition.duration,
    unavailable:!!problem,expr:instance?.disabled||problem?CROSSFADE_EXPRESSION:transitionExpression(d,instance.params)};
}
export const preferredTransitionUpgrade=instance=>[...definitions].find(([,d])=>d.preferred&&d.contributionId===instance?.contributionId)?.[0];
export function assertPluginTransitions(project) {
  const issues=[];
  for(let i=1;i<(project.videoClips||[]).length;i++){
    const clip=project.videoClips[i],tr=clip.transition;
    if(!tr)continue;
    const duration=Number.isFinite(tr.timelineOverlap)?tr.timelineOverlap:tr.duration;
    if(duration<=0)continue;
    const problem=pluginTransitionProblem(tr.type,tr.pluginTransition);
    if(problem)issues.push(`${tr.pluginTransition?.name||tr.type}: ${problem}`);
  }
  if(issues.length)throw Error(`Plugin transitions need attention before export: ${issues.join(' ')} Reinstall the required version, explicitly upgrade, remove the transition, or choose its crossfade bypass in the inspector.`);
}
