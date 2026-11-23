import {useEffect,useState} from 'react';
import {t} from '../../../i18n/index.js';
export default function PreviewRenderErrors({root,issues=[]}){
 const [error,setError]=useState('');
 useEffect(()=>{
  const element=root.current;if(!element)return;
  const refresh=()=>{const failures=[...issues,...[...element.querySelectorAll('canvas[data-render-error]')].filter(canvas=>canvas.dataset.renderError&&(!canvas.closest('.slot')||canvas.closest('.slot').style.visibility==='visible')&&(canvas.classList.contains('fx-transition')||getComputedStyle(canvas).display!=='none')).map(canvas=>canvas.dataset.renderError)];setError([...new Set(failures)].join('\n').slice(0,4000));};
  const observer=new MutationObserver(refresh);observer.observe(element,{subtree:true,attributes:true,attributeFilter:['data-render-error','style']});refresh();return()=>observer.disconnect();
 },[root,issues]);
 return error?<p className="preview-render-error" role="alert" data-preview-render-error><b>{t('preview.effect_render_failed')}</b> {error}</p>:null;
}
