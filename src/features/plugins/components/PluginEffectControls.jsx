import {isPluginTransition,pluginTransitionDefinition,pluginTransitionProblem,preferredTransitionUpgrade,pluginTransitionInstance} from '../transitionRegistry.js';
import React from 'react';
import NumBox from '../../../components/ui/NumBox.jsx';
import {t} from '../../../i18n/index.js';
import {isPluginEffect,pluginEffectDefinition,pluginEffectProblem,preferredEffectUpgrade,pluginEffectInstance} from '../effectRegistry.js';

export default function PluginEffectControls({id,instance,onChange,onUpgrade,kind='effect'}) {
  const transition=kind==='transition';
  if(!(transition?isPluginTransition(id):isPluginEffect(id)))return null;
  const getDefinition=transition?pluginTransitionDefinition:pluginEffectDefinition;
  const createInstance=transition?pluginTransitionInstance:pluginEffectInstance;
  const definition=getDefinition(id),problem=(transition?pluginTransitionProblem:pluginEffectProblem)(id,{...instance,disabled:false});
  const upgrade=(transition?preferredTransitionUpgrade:preferredEffectUpgrade)(instance);
  const upgrading=upgrade&&upgrade!==id;
  return <div className={`insp-card plugin-effect-controls ${transition?'plugin-transition-controls':''}`}>
    <div className="insp-card-title">{instance?.name||definition?.name||t(transition?'plugins.transition':'plugins.effect')}</div>
    <p className="dim small">{instance?.pluginId} · {instance?.version}</p>
    {problem&&!instance?.disabled&&<p role="alert" className="error-text">{t(transition?'plugins.transition_unavailable':'plugins.effect_unavailable')}</p>}
    <label className="field"><span>{t(transition?'plugins.transition_enabled':'plugins.effect_enabled')}</span><input type="checkbox" checked={!instance?.disabled} onChange={event=>onChange({...instance,disabled:!event.target.checked})} /></label>
    {transition&&<p className="dim small">{t('plugins.transition_bypass_hint')}</p>}
    {!problem&&definition.parameters.map(p=><NumBox key={p.id} layout="field" label={p.name} value={instance?.params?.[p.id]??p.default} min={p.min} max={p.max} step={p.step}
      onChange={value=>{if(Number.isFinite(value))onChange({...instance,params:{...instance.params,[p.id]:Math.max(p.min,Math.min(p.max,value))}});}} />)}
    {upgrading&&<button type="button" className="btn btn-sm" onClick={()=>{
      const next=getDefinition(upgrade),params={};
      for(const p of next.parameters){const value=instance?.params?.[p.id];if(Number.isFinite(value))params[p.id]=Math.max(p.min,Math.min(p.max,value));}
      onUpgrade(upgrade,createInstance(upgrade,params));
    }}>{t(transition?'plugins.upgrade_transition':'plugins.upgrade_effect')}</button>}
  </div>;
}
