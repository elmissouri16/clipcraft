import React,{useEffect,useState} from 'react';
import PluginContentPreview from './PluginContentPreview.jsx';
import {t} from '../../../i18n/index.js';
export default function PluginAuthorPreview({session,active=true}){
 const items=['effects','transitions','luts','colorPresets','motionPresets'].flatMap(kind=>(session?.manifest.contributes[kind]||[]).map(item=>({kind,id:item.id,name:item.name,value:`${kind}/${item.id}`}))),[choice,setChoice]=useState(''),[content,setContent]=useState(null),[error,setError]=useState('');
 const selected=items.find(i=>i.value===choice)||items[0],selectedValue=selected?.value;
 useEffect(()=>{let live=true;setContent(null);setError('');if(session?.status==='ready'&&selected){window.api.pluginsPreviewContent({key:session.key,kind:selected.kind,id:selected.id}).then(value=>live&&setContent(value)).catch(e=>live&&setError(e.message));}return()=>{live=false;};},[session?.key,session?.status,selectedValue]);
 if(!items.length)return null;
 return <section data-author-preview><h5 className="set2-group-label">{t('plugins.author_preview_title')}</h5><p className="set2-note">{t('plugins.author_preview_hint')}</p><label className="field"><span>{t('plugins.author_preview_item')}</span><select data-author-item value={selectedValue||''} onChange={e=>setChoice(e.target.value)}>{items.map(i=><option key={i.value} value={i.value}>{i.name} · {t('plugins.builder_summary_'+i.kind)}</option>)}</select></label>{error&&<p role="alert">{error}</p>}{content&&<PluginContentPreview active={active} key={session.key+'/'+selectedValue} content={content}/>}</section>;
}
