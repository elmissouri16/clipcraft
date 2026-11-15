import React,{useEffect,useRef,useState} from 'react';
import {X} from 'lucide-react';
import Dropdown from '../../../components/ui/Dropdown.jsx';
import {projectDuration} from '../../../state/store.js';
import {t} from '../../../i18n/index.js';
const clean=(value,max)=>String(value||'').replace(/[\u0000-\u001f\u007f]/g,' ').slice(0,max);
export function panelProjectSummary(project){
 const duration=projectDuration(project);
 return {name:clean(project.name,160),duration_sec:duration,fps:project.fps||30,width:project.width,height:project.height,
  counts:Object.fromEntries([['video','videoClips'],['overlay','overlayClips'],['audio','audioClips'],['text','textClips'],['effect','effectClips'],['media','media'],['markers','markers']].map(([name,key])=>[name,(project[key]||[]).length])),
  markers:(project.markers||[]).filter(m=>Number.isFinite(m.time)&&m.time>=0&&m.time<=duration).slice(0,1000).map(m=>({time:m.time,label:clean(m.label,80)}))};
}
const theme=()=>{const css=getComputedStyle(document.documentElement);return Object.fromEntries(Object.entries({background:'--surface-1',surface:'--surface-2',text:'--text',muted:'--text-2',accent:'--primary',border:'--border'}).map(([name,key])=>[name,css.getPropertyValue(key).trim()]));};
const masked=()=>!!document.querySelector('.modal-backdrop,.settings2,[role="dialog"],.context-menu,.ctx-menu,[role="menu"],.dropdown-list')||document.body.classList.contains('resizing-col')||document.body.classList.contains('resizing-row');
export default function PluginPanelDock({project,projectEpoch,onClose,controller,getEditorContext}){
 const latest=useRef({project,onClose,controller,getEditorContext});latest.current={project,onClose,controller,getEditorContext};
 const [rows,setRows]=useState([]),[choice,setChoice]=useState(''),[status,setStatus]=useState({phase:'idle'}),[actionStatus,setActionStatus]=useState(null);
 const action=useRef(null),active=useRef(null),viewport=useRef(null),enter=useRef(null),closeButton=useRef(null),live=useRef(true),layout=useRef(()=>{});
 const row=rows.find(r=>`${r.key}/${r.id}`===choice),chosen=useRef(null);if(row)chosen.current=row;const busy=status.phase==='permission';
 const cancelAction=()=>{const current=action.current;if(current){current.canceled=true;if(current.runId)latest.current.controller?.cancel(current.runId);}};
 const dispose=()=>{cancelAction();action.current=null;const id=active.current;active.current=null;if(id)window.api.pluginPanelClose(id).catch(()=>{});};
 useEffect(()=>{
  live.current=true;setStatus({phase:'idle'});setActionStatus(null);let timer,mask=masked(),requests=0;
  const position=()=>{const id=active.current,el=viewport.current;if(!id||!el)return;const rect=el.getBoundingClientRect();window.api.pluginPanelLayout(id,{x:rect.x,y:rect.y,width:rect.width,height:rect.height,visible:!!el.getClientRects().length&&!masked()}).catch(()=>{});};
  layout.current=position;
  const refresh=()=>{const sequence=++requests;return window.api.pluginPanels().then(items=>{if(live.current&&sequence===requests){setRows(items);if(chosen.current?.development){const previous=chosen.current,next=items.find(item=>item.sessionId===previous.sessionId&&item.id===previous.id);if(next)setChoice(`${next.key}/${next.id}`);}}}).catch(error=>{if(live.current&&sequence===requests)setStatus({phase:'failed',error:error.message});});};refresh();
  const offChanged=window.api.onPluginsChanged(refresh),offDevelopment=window.api.onPluginDevelopmentCatalogChanged?.(refresh),offEvent=window.api.onPluginPanelEvent(event=>{
   if(active.current!==event.id)return;
   if(event.type==='actionCancel'&&action.current?.actionId===event.actionId)cancelAction();
   if(event.type==='action'){
    const current={panelId:event.id,actionId:event.actionId,canceled:false};action.current=current;setActionStatus(null);
    (async()=>{
     let result={phase:'failed'};
     try{
      const request=await window.api.pluginPanelClaimAction(current.panelId,current.actionId);
      if(!request)return;current.runId=request.runId;
      if(current.canceled||!live.current||active.current!==current.panelId)result={phase:'canceled'};
      else result=await latest.current.controller.run(request.command,request.input,{runId:request.runId,panelAction:{panelId:current.panelId,actionId:current.actionId},
       isCurrent:()=>!current.canceled&&live.current&&active.current===current.panelId,
       beforeCommit:()=>window.api.pluginPanelAuthorizeAction(current.panelId,current.actionId,current.runId),
       onProgress:value=>{if(live.current&&active.current===current.panelId&&action.current===current)setActionStatus(value);window.api.pluginPanelProgressAction(current.panelId,current.actionId,{phase:value.phase,progress:value.progress}).catch(()=>{});}});
     }catch(error){result={phase:'failed',message:error.message};}
     finally{
      await window.api.pluginPanelFinishAction(current.panelId,current.actionId,{phase:result.phase,markersAdded:result.markersAdded,clipsChanged:result.clipsChanged}).catch(()=>{});
      if(action.current===current){action.current=null;if(live.current)setActionStatus(result);}
     }
    })();
   }
   if(event.type==='layout')position();
   if(event.type==='focus')(event.direction==='backward'?enter.current:closeButton.current)?.focus();
   if(event.type==='closed'){cancelAction();action.current=null;active.current=null;setStatus({phase:event.status,error:event.error});if(event.restore){latest.current.onClose();requestAnimationFrame(()=>document.querySelector('.plugin-panels-toggle')?.focus());}}
  });
  const resize=new ResizeObserver(position);if(viewport.current)resize.observe(viewport.current);window.addEventListener('resize',position);
  const obscured=new MutationObserver(()=>{const next=masked();if(next!==mask){mask=next;position();}});obscured.observe(document.body,{childList:true,subtree:true});
  const bodyClass=new MutationObserver(position);bodyClass.observe(document.body,{attributes:true,attributeFilter:['class']});
  const colours=new MutationObserver(()=>{clearTimeout(timer);timer=setTimeout(()=>{if(active.current)window.api.pluginPanelUpdate(active.current,{theme:theme()}).catch(()=>{});position();},50);});colours.observe(document.documentElement,{attributes:true,attributeFilter:['class','style','data-theme']});
  return()=>{live.current=false;dispose();clearTimeout(timer);resize.disconnect();obscured.disconnect();bodyClass.disconnect();colours.disconnect();window.removeEventListener('resize',position);offChanged();offDevelopment?.();offEvent();};
 },[project.id,projectEpoch]);
 useEffect(()=>{const id=active.current;if(!id)return;const timer=setTimeout(()=>window.api.pluginPanelUpdate(id,{summary:panelProjectSummary(project)}).catch(()=>{}),100);return()=>clearTimeout(timer);},[project,status.phase]);
 useEffect(()=>{
  if(status.phase!=='open'||!row?.permissions?.includes('editor.read'))return;
  const id=active.current;if(!id)return;let revision=0;
  const push=()=>{const editor=latest.current.getEditorContext();if(editor.revision!==revision){revision=editor.revision;window.api.pluginPanelUpdate(id,{editor}).catch(()=>{});}};
  push();const timer=setInterval(push,100);return()=>clearInterval(timer);
 },[status.phase,choice,project.id,projectEpoch]);
 const open=async()=>{
  if(!row||active.current)return;
  const id=crypto.randomUUID();active.current=id;setActionStatus(null);setStatus({phase:'permission'});
  try{const result=await window.api.pluginPanelOpen({id,key:row.key,panelId:row.id,...(row.permissions?.includes('editor.read')?{editor:latest.current.getEditorContext()}:{}),summary:panelProjectSummary(latest.current.project),theme:theme()});
   if(!live.current||active.current!==id)return;
   if(result.status==='open'){setStatus({phase:'open'});requestAnimationFrame(()=>layout.current());}
   else{active.current=null;setStatus({phase:result.status,error:result.error});}
  }catch(error){if(active.current===id){active.current=null;setStatus({phase:'failed',error:error.message});}}
 };
 return <aside className="inspector plugin-panel-dock" aria-label={t('plugins.panels')}>
  <div className="panel-head"><b>{t('plugins.panels')}</b><button ref={closeButton} className="icon-btn" aria-label={t('plugins.panel_close')} onClick={()=>{dispose();onClose();requestAnimationFrame(()=>document.querySelector('.plugin-panels-toggle')?.focus());}}><X size={15}/></button></div>
  <div className="plugin-panel-controls">
   <Dropdown ariaLabel={t('plugins.panel_choose')} value={choice} options={[{value:'',label:t('plugins.panel_choose')},...rows.map(r=>({value:`${r.key}/${r.id}`,label:`${r.name}${r.development?' · '+t('plugins.dev_badge'):''} · ${r.version}`})),...(choice&&!row?[{value:choice,label:t('plugins.unavailable')}]:[])]} disabled={busy||status.phase==='open'} onChange={value=>{dispose();chosen.current=null;setChoice(value);setStatus({phase:'idle'});}}/>
   {row&&<p className="dim small">{row.pluginName} · {t('plugins.publisher',{publisher:row.publisher})}</p>}
   {row?.development&&<p className="small plugin-dev-badge">{t('plugins.dev_session')}</p>}
   {status.phase==='open'?<div className="settings-actions"><button ref={enter} className="btn btn-sm" onClick={()=>window.api.pluginPanelFocus(active.current)}>{t('plugins.panel_focus')}</button><button className="btn btn-sm btn-ghost" onClick={()=>{dispose();setStatus({phase:'closed'});}}>{t('plugins.panel_stop')}</button></div>:<button ref={enter} className="btn btn-primary btn-sm" disabled={!row||busy} onClick={open}>{t(busy?'plugins.command_permission_pending':'plugins.panel_open')}</button>}
   {actionStatus&&<div role={actionStatus.phase==='failed'?'alert':'status'} className="plugin-command-status" data-panel-action-phase={actionStatus.phase}><p>{actionStatus.message||t(actionStatus.phase==='permission'?'plugins.command_permission_pending':'plugins.command_running')}</p>{['permission','running','applying'].includes(actionStatus.phase)&&<><progress max="1" value={actionStatus.progress||0}/><button className="btn btn-sm btn-ghost" disabled={actionStatus.phase==='applying'} onClick={()=>cancelAction()}>{t('plugins.cancel')}</button></>}</div>}
   {!rows.length&&<p className="dim small">{t('plugins.panel_empty')}</p>}
   {status.error&&<p className="error-text small" role="alert">{status.error}</p>}
   {status.phase==='denied'&&<p role="status" className="small">{t('plugins.panel_denied')}</p>}
  </div>
  <div ref={viewport} className="plugin-panel-viewport" data-panel-phase={status.phase} aria-label={t('plugins.panel_content')}>
   {status.phase!=='open'&&<p className="dim small">{t('plugins.panel_hint')}</p>}
  </div>
 </aside>;
}
