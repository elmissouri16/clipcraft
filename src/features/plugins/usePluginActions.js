import {useEffect,useRef,useState} from 'react';
import {actionState} from '../../../shared/pluginActions.mjs';
import {projectDuration} from '../../state/store.js';
import {actionSelection,actionSelectionKey} from './actionContext.js';
import {t} from '../../i18n/index.js';
const identity=a=>`${a.key}/${a.id}`;
export function usePluginActions(controller,options){
 const latest=useRef(null);latest.current={controller,options};
 const catalog=useRef({items:[],total:0,truncated:false}),[registry,setRegistry]=useState(catalog.current),[request,setRequest]=useState(null),active=useRef(null),live=useRef(true),sequence=useRef(0);
 const publish=value=>{catalog.current=value;if(live.current)setRegistry(value);};
 const environment=()=>{const {controller,options:o}=latest.current,h=o.getHistory();return {selection:actionSelection(h.present,o.getSelection()),hasProject:o.hasProject&&projectDuration(h.present)>0,busy:controller.busy||o.isBusy()||!!h.agentEdit||!!h.gestureStart};};
 const contextCurrent=current=>{const o=latest.current.options,h=o.getHistory();return live.current&&active.current===current&&!current.closed&&o.hasProject&&h.present===current.base&&o.getVersion()===current.epoch&&actionSelectionKey(o.getSelection())===current.selectionKey;};
 const show=(current,status)=>{current.status=status;if(live.current&&active.current===current&&!current.closed)setRequest({...current});};
 const close=()=>{const current=active.current;if(!current)return;if(current.status?.phase==='applying')return;current.closed=true;active.current=null;if(current.started&&!current.finished)latest.current.controller.cancel(current.runId);if(live.current)setRequest(null);};
 const revoke=developmentOnly=>{
  publish({...catalog.current,items:catalog.current.items.filter(item=>developmentOnly&&!item.development)});
  const current=active.current;if(current&&(!developmentOnly||current.entry.development)){current.closed=true;active.current=null;if(current.started&&!current.finished)latest.current.controller.cancel(current.runId);if(live.current)setRequest(null);}
 };
 useEffect(()=>{
  live.current=true;
  const refresh=async()=>{const n=++sequence.current;try{
   if(!window.api.pluginsActions)throw Error(t('plugins.actions_restart'));
   const result=await window.api.pluginsActions();if(!live.current||n!==sequence.current)return;publish(result);
  }catch(error){if(live.current&&n===sequence.current)publish({items:[],total:0,truncated:false,error:error.message});}};
  refresh();const changed=window.api.onPluginsChanged(()=>{revoke(false);refresh();}),development=window.api.onPluginDevelopmentCatalogChanged?.(()=>{revoke(true);refresh();});
  return()=>{live.current=false;++sequence.current;const current=active.current;if(current){current.closed=true;if(current.started&&!current.finished)latest.current.controller.cancel(current.runId);}active.current=null;changed();development?.();};
 },[]);
 useEffect(()=>{
  const current=active.current;if(!current)return;
  if(!options.hasProject||current.epoch!==options.getVersion()||current.base.id!==options.project.id){current.closed=true;active.current=null;if(current.started&&!current.finished)controller.cancel(current.runId);setRequest(null);return;}
  if(!current.started&&!current.finished&&!contextCurrent(current)){current.finished=true;show(current,{phase:'failed',message:t('plugins.action_context_changed')});}
 },[options.project,options.selection,options.epoch,options.hasProject]);
 const execute=async(current,input)=>{
  if(current.started||current.finished||current.closed||active.current!==current)return;
  current.started=true;show(current,{phase:'permission',progress:0,message:t('plugins.command_permission_pending')});
  try{
   const fresh=await window.api.pluginsActions();
   if(!contextCurrent(current))throw Error(t('plugins.action_context_changed'));
   const entry=fresh.items.find(item=>identity(item)===identity(current.entry));
   if(!entry)throw Error(t('plugins.action_unavailable'));
   const state=actionState(entry,current.location,environment());
   if(!state.visible||!state.enabled)throw Error(t('plugins.action_'+(state.reason||'unavailable')));
   const result=await latest.current.controller.run({id:entry.command.id,key:entry.key,permissions:entry.permissions,development:!!entry.development},input,{
    runId:current.runId,isCurrent:()=>contextCurrent(current),
    onProgress:value=>show(current,value),
   });
   current.finished=true;show(current,result);
  }catch(error){current.finished=true;show(current,{phase:'failed',message:error.message});}
 };
 const invoke=(entry,location)=>{
  if(active.current&&!active.current.finished)return;
  const found=catalog.current.items.find(item=>identity(item)===identity(entry)),o=latest.current.options,state=found&&actionState(found,location,environment());
  if(!state?.visible||!state.enabled)return;
  const current={id:crypto.randomUUID(),runId:crypto.randomUUID(),entry:found,location,base:o.getHistory().present,epoch:o.getVersion(),selectionKey:actionSelectionKey(o.getSelection()),started:false,finished:false,closed:false,status:{phase:'configure'},restore:document.activeElement};
  active.current=current;setRequest({...current});
  if(!found.command.parameters.length)execute(current,{});
 };
 const items=(location,anchor)=>{
  const env=environment();
  // Locked clips cannot become the editor's selection. Never target the old selection instead.
  const aligned=!anchor||env.selection.some(s=>s.lane===anchor.track&&s.id===anchor.id);
  const selection=aligned?env.selection:actionSelection(options.project,anchor);
  return registry.items.flatMap(entry=>{
   const state=actionState(entry,location,{...env,selection});if(!state.visible)return [];
   return [{entry,disabled:!state.enabled||!aligned,hint:state.reason?t('plugins.action_'+state.reason):!aligned?t(selection.some(s=>s.locked)?'plugins.action_locked':'plugins.action_selection'):undefined,onClick:()=>invoke(entry,location)}];
  });
 };
 return {registry,request,items,submit:input=>active.current&&execute(active.current,input),close};
}
