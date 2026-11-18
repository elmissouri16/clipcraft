import React,{useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import MediaPeek from '../../preview/components/MediaPeek.jsx';
import {t} from '../../../i18n/index.js';

export default function ExtensionMediaPreview({preview,onClose,onInsert}) {
 const root=useRef(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 useEffect(()=>{
  const restore=document.activeElement;root.current?.querySelector('button')?.focus();
  return()=>{if(restore?.isConnected)restore.focus({preventScroll:true});};
 },[]);
 const keys=event=>{
  if(event.key==='Escape'){event.preventDefault();event.stopPropagation();onClose();}
  if(event.key==='Tab'){
   const nodes=[...root.current.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),[tabindex="0"]')].filter(n=>n.getClientRects().length);
   const index=nodes.indexOf(document.activeElement),next=event.shiftKey?(index<=0?nodes.length-1:index-1):(index+1)%nodes.length;
   if(nodes.length){event.preventDefault();nodes[next].focus();}
  }
 };
 const insert=async()=>{if(busy)return;setBusy(true);setError('');try{await onInsert();onClose();}catch(e){setError(e.message);setBusy(false);}};
 return createPortal(<div className="modal-backdrop" onMouseDown={event=>{if(event.target===event.currentTarget&&!busy)onClose();}}>
  <section ref={root} className="modal extension-media-dialog" data-extension-media-preview role="dialog" aria-modal="true" aria-label={preview.item.name} onKeyDownCapture={keys}>
   <div className="panel-head"><h3>{preview.item.name}</h3><span className="dim small">{t('plugins.extension_preview')}</span></div>
   <div className={'extension-media-stage'+(busy?' busy':'')} inert={busy?'':undefined}>
    <MediaPeek m={preview.item} fps={preview.fps||30} onClose={onClose} onAdd={insert} autoplay={preview.autoplay}/>
   </div>
   {error&&<p className="error-text" role="alert">{error}</p>}
   {busy&&<p role="status">{t('plugins.media_applying')}</p>}
  </section>
 </div>,document.body);
}
