import React,{useEffect,useRef,useState} from 'react';
import {t} from '../../../i18n/index.js';
const timestamp=time=>{const seconds=Math.max(0,time);return `${Math.floor(seconds/60).toString().padStart(2,'0')}:${(seconds%60).toFixed(2).padStart(5,'0')}`;};
export default function PluginTranslationReview(){
 const [review,setReview]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const discard=useRef(null),root=useRef(null),answerRef=useRef(null);
 useEffect(()=>window.api.onPluginTranslationReview?.(event=>{
  if(event.closed){setReview(current=>current?.id===event.id?null:current);return;}
  setReview(event);setError('');setBusy(false);
 }),[]);
 const answer=async accept=>{
  if(!review||busy)return;setBusy(true);setError('');
  try{await window.api.pluginsAnswerTranslationReview({id:review.id,accept});setReview(current=>current?.id===review.id?null:current);}
  catch(e){setError(e.message);setBusy(false);}
 };
 answerRef.current=answer;
 useEffect(()=>{
  if(!review)return;
  const previous=document.activeElement;discard.current?.focus();
  const onKey=event=>{
   if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();answerRef.current(false);}
   if(event.key==='Tab'){
    const controls=[...root.current.querySelectorAll('button:not(:disabled),[tabindex="0"]')];if(!controls.length)return;
    if(event.shiftKey&&document.activeElement===controls[0]){event.preventDefault();controls.at(-1).focus();}
    if(!event.shiftKey&&document.activeElement===controls.at(-1)){event.preventDefault();controls[0].focus();}
   }
  };
  window.addEventListener('keydown',onKey,true);return()=>{window.removeEventListener('keydown',onKey,true);if(previous?.isConnected)previous.focus();};
 },[review?.id]);
 if(!review)return null;
 return <div className="modal-backdrop plugin-translation-backdrop" role="dialog" aria-modal="true" aria-labelledby="plugin-translation-title" ref={root}>
  <div className="modal plugin-translation-review">
   <h3 id="plugin-translation-title">{t('plugins.translation_review_title')}</h3>
   <p>{review.name} {review.version} · {review.language} · {t('plugins.translation_source_track',{track:review.sourceTrack})}{review.provider&&` · ${review.provider} / ${review.model}`}</p>
   <p className="muted">{t('plugins.translation_review_explain')}</p>
   <div className="plugin-translation-cues" tabIndex="0" aria-label={t('plugins.translation_review_title')}>
    <table><thead><tr><th>{t('plugins.translation_time')}</th><th>{t('plugins.translation_original')}</th><th>{t('plugins.translation_translated')}</th></tr></thead>
     <tbody>{review.rows.map((cue,index)=><tr key={index}><td>{timestamp(cue.start)}–{timestamp(cue.end)}</td><td dir="auto">{cue.original}</td><td dir="auto">{cue.translated}</td></tr>)}</tbody>
    </table>
   </div>
   {error&&<p role="alert">{error}</p>}
   <div className="modal-actions"><button ref={discard} className="btn btn-ghost" disabled={busy} onClick={()=>answer(false)}>{t('plugins.ai_discard')}</button><button className="btn btn-primary" disabled={busy} onClick={()=>answer(true)}>{t('plugins.translation_apply')}</button></div>
  </div>
 </div>;
}
