import React,{useCallback,useEffect,useRef,useState} from 'react';
import ExtensionViewSurface from './ExtensionViewSurface.jsx';
import {extensionShortcutCombos,subscribeShortcuts} from '../../../app/keymap.js';
import {obscured,theme} from '../extensionViewLayout.js';
import {t} from '../../../i18n/index.js';
function useCatalog(){
 const [items,setItems]=useState([]);
 useEffect(()=>{let live=true,sequence=0;const refresh=()=>{const request=++sequence;window.api.pluginsExtensionViews().then(value=>{if(live&&sequence===request)setItems(value.items);}).catch(()=>{});};refresh();const off=window.api.onExtensionViewEvent(refresh),changed=window.api.onExtensionUiChanged(refresh);return()=>{live=false;off();changed();};},[]);
 return items;
}
export function ExtensionBottomViews(){
 const entries=useCatalog().filter(row=>row.open&&row.placement==='bottom'),[selected,setSelected]=useState(''),[height,setHeight]=useState(150),[error,setError]=useState(''),drag=useRef(null);
 const entry=entries.find(row=>row.id===selected)||entries[0];
 useEffect(()=>{const move=event=>{if(drag.current)setHeight(Math.max(80,Math.min(window.innerHeight*.5,drag.current.height+drag.current.y-event.clientY)));},end=()=>{drag.current=null;document.body.classList.remove('resizing-row');};window.addEventListener('pointermove',move);window.addEventListener('pointerup',end);return()=>{end();window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',end);};},[]);
 if(!entry)return null;
 return <section className="extension-bottom-dock" data-extension-bottom style={{height}}>
  <div className="extension-bottom-resize" role="separator" aria-label={t('plugins.view_resize')} aria-orientation="horizontal" tabIndex={0} onKeyDown={event=>{if(['ArrowUp','ArrowDown'].includes(event.key)){event.preventDefault();setHeight(h=>Math.max(80,Math.min(window.innerHeight*.5,h+(event.key==='ArrowUp'?20:-20))));}}} onPointerDown={event=>{event.currentTarget.setPointerCapture(event.pointerId);drag.current={height,y:event.clientY};document.body.classList.add('resizing-row');}}/>
  {entries.length>1&&<div className="extension-view-tabs" role="tablist" aria-label={t('plugins.extension_views')}>{entries.map(row=><button role="tab" type="button" key={row.id} aria-selected={entry.id===row.id} onClick={()=>setSelected(row.id)}>{row.title}</button>)}</div>}
  {error&&<p role="alert">{error}</p>}
  <ExtensionViewSurface entry={entry} onClose={()=>setSelected('')} onError={setError}/>
 </section>;
}
export function ExtensionOverlayViews(){
 const entries=useCatalog().filter(row=>row.open&&['player-overlay','timeline-overlay','floating','modal'].includes(row.placement)),latest=useRef(entries),sent=useRef(new Map());latest.current=entries;
 const layout=useCallback(()=>{
  const current=new Set(latest.current.map(row=>row.id));for(const id of sent.current.keys())if(!current.has(id))sent.current.delete(id);
  for(const row of latest.current){
   const target=document.querySelector(row.placement==='player-overlay'?'.player .stage':'.timeline .tl-scroll'),r=target?.getBoundingClientRect(),bounds=row.bounds??{x:0,y:0,width:1,height:1};
   const input={x:r?r.x+r.width*bounds.x:0,y:r?r.y+r.height*bounds.y:44,width:r?r.width*bounds.width:1,height:r?r.height*bounds.height:1,visible:!!r&&!!target.getClientRects().length&&!obscured(r),placement:row.placement,instance:row.instance,theme:theme(),shortcuts:extensionShortcutCombos()},key=JSON.stringify(input);
   if(sent.current.get(row.id)===key)continue;sent.current.set(row.id,key);window.api.pluginsExtensionViewLayout(row.id,input).catch(()=>sent.current.delete(row.id));
  }
 },[]);
 useEffect(()=>{layout();},[entries,layout]);
 useEffect(()=>{
  const mutation=new MutationObserver(layout);mutation.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['class','style']});
  const colours=new MutationObserver(layout);colours.observe(document.documentElement,{attributes:true,attributeFilter:['style','class']});
  const resize=new ResizeObserver(layout);for(const selector of ['.player .stage','.timeline .tl-scroll']){const node=document.querySelector(selector);if(node)resize.observe(node);}
  const off=window.api.onExtensionViewEvent(event=>{if(event.type==='layout'){sent.current.delete(event.id);layout();}}),keys=subscribeShortcuts(layout);window.addEventListener('resize',layout);window.addEventListener('scroll',layout,true);
  return()=>{for(const row of latest.current)window.api.pluginsExtensionViewLayout(row.id,{x:0,y:44,width:1,height:1,visible:false,placement:row.placement,instance:row.instance}).catch(()=>{});mutation.disconnect();colours.disconnect();resize.disconnect();off();keys();window.removeEventListener('resize',layout);window.removeEventListener('scroll',layout,true);};
 },[layout]);
 return null;
}
