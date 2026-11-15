import {createPortal} from 'react-dom';
import React,{useRef,useState} from 'react';
import {Command,Sparkles,Scissors,ArrowUpFromLine,Type,AudioLines,Layers,Info,ChevronDown,Settings,Puzzle} from 'lucide-react';
import ContextMenu from '../../../components/ui/ContextMenu.jsx';
import {t} from '../../../i18n/index.js';
const icons={command:Command,sparkles:Sparkles,scissors:Scissors,export:ArrowUpFromLine,text:Type,audio:AudioLines,layers:Layers,info:Info};
export function pluginActionMenuItem({entry,disabled,hint,onClick}){
 return {id:`plugin-action-${entry.key}-${entry.id}`,label:entry.label,icon:icons[entry.icon||'command'],detail:`${entry.pluginName} · ${entry.version}${entry.development?' · '+t('plugins.dev_badge'):''}`,disabled,hint,onClick};
}
export default function PluginActionsMenu({actions,onManage}){
 const [position,setPosition]=useState(null),button=useRef(null);
 const rows=actions.items('plugins-menu').map(pluginActionMenuItem);
 const close=reason=>{setPosition(null);if(['escape','choose'].includes(reason))requestAnimationFrame(()=>{if(!document.querySelector('[data-plugin-action-dialog]'))button.current?.focus();});};
 return <>
  <button ref={button} type="button" className="btn btn-sm plugin-actions-toggle" aria-label={t('plugins.actions_menu')} aria-haspopup="menu" aria-expanded={!!position} onClick={event=>{const r=event.currentTarget.getBoundingClientRect();setPosition(position?null:{x:r.right-300,y:r.bottom+6});}}><Puzzle size={16}/><span className="plugin-actions-label">{t('plugins.actions_menu')}</span><ChevronDown size={12}/></button>
  {position&&createPortal(<ContextMenu className="plugin-actions-menu" {...position} label={t('plugins.actions_menu')} onClose={close} items={[
   ...(rows.length?rows:[{label:actions.registry.error||t('plugins.actions_empty'),disabled:true,onClick:()=>{}}]),
   ...(actions.registry.truncated?[{label:t('plugins.actions_truncated'),disabled:true,onClick:()=>{}}]:[]),
   'sep',{label:t('plugins.actions_manage'),icon:Settings,onClick:onManage},
  ]}/>,document.body)}
 </>;
}
