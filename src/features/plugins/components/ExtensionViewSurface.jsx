import React,{useCallback,useEffect,useRef,useState} from 'react';
import ExtensionViewPlacement from './ExtensionViewPlacement.jsx';
import {X} from 'lucide-react';
import {obscured,theme} from '../extensionViewLayout.js';
import {extensionUiError} from '../useExtensionUi.js';
import {extensionShortcutCombos,subscribeShortcuts} from '../../../app/keymap.js';
import {t} from '../../../i18n/index.js';
export default function ExtensionViewSurface({entry,onClose}){
 const viewport=useRef(null),exit=useRef(null),ready=useRef(false),instance=useRef(null),live=useRef(false),last=useRef(''),[error,setError]=useState('');
 const layout=useCallback(()=>{
  const element=viewport.current;if(!element||!ready.current)return;
  const rect=element.getBoundingClientRect(),input={x:rect.x,y:rect.y,width:rect.width,height:rect.height,placement:entry.placement??'workbench',...(instance.current?{instance:instance.current}:{}),visible:!!element.getClientRects().length&&!obscured(rect),theme:theme(),shortcuts:extensionShortcutCombos()},key=JSON.stringify(input);
  if(last.current===key)return;last.current=key;
  window.api.pluginsExtensionViewLayout(entry.id,input).catch(error=>{last.current='';if(live.current)setError(extensionUiError(error));});
 },[entry.id,entry.placement,entry.instance]);
 useEffect(()=>{
  live.current=true;ready.current=false;last.current='';setError('');
  window.api.pluginsExtensionViewOpen(entry.id).then(()=>window.api.pluginsExtensionViews()).then(catalog=>{if(live.current){instance.current=catalog.items.find(row=>row.id===entry.id)?.instance??null;ready.current=true;layout();}}).catch(error=>{if(live.current)setError(extensionUiError(error));});
  const resize=new ResizeObserver(layout);if(viewport.current)resize.observe(viewport.current);
  const mutation=new MutationObserver(layout);mutation.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['class']});
  const colours=new MutationObserver(layout);colours.observe(document.documentElement,{attributes:true,attributeFilter:['class','style','data-theme']});
  const offShortcuts=subscribeShortcuts(()=>{last.current='';layout();});
  const off=window.api.onExtensionViewEvent(event=>{if(event.id!==entry.id)return;if(event.type==='layout'){last.current='';layout();}if(event.type==='focus')exit.current?.focus();if(event.type==='closed'){ready.current=false;if(event.error)setError(event.error);}});
  window.addEventListener('resize',layout);window.addEventListener('scroll',layout,true);
  return()=>{live.current=false;ready.current=false;window.api.pluginsExtensionViewLayout(entry.id,{x:0,y:44,width:1,height:1,visible:false,placement:entry.placement??'workbench',...(instance.current?{instance:instance.current}:{})}).catch(()=>{});resize.disconnect();mutation.disconnect();colours.disconnect();off();offShortcuts();window.removeEventListener('resize',layout);window.removeEventListener('scroll',layout,true);};
 },[entry.id,entry.generation,layout]);
 return <section className="extension-embedded-view" data-extension-surface={entry.id} aria-label={entry.title}>
  <div className="panel-head"><b>{entry.title}</b><ExtensionViewPlacement entry={entry} onError={setError}/><button ref={exit} className="icon-btn" type="button" aria-label={t('plugins.extension_close_view',{name:entry.title})} onClick={()=>{window.api.pluginsExtensionViewClose(entry.id).catch(()=>{});onClose();}}><X size={14}/></button></div>
  {error&&<p role="alert" className="error-text small">{error}</p>}
  <div ref={viewport} className="extension-view-viewport" aria-label={entry.title}/>
 </section>;
}
