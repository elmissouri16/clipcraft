import {SettingsGroup} from '../../../app/components/SettingsLayout.jsx';
import React,{useState} from 'react';
import {t} from '../../../i18n/index.js';
const bytes=n=>`${(n/1024/1024).toFixed(2)} MiB`;
export default function PluginStorageCleanup(){
 const [review,setReview]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const act=async fn=>{setBusy(true);setError('');setNotice('');try{await fn();}catch(e){setError(String(e.message||e).replace(/^Error invoking remote method '[^']+': (?:Error: )?/,''));setReview(null);}finally{setBusy(false);}};
 return <SettingsGroup label={t('plugins.storage_title')} hint={t('plugins.storage_hint')}><section className="plugin-section-body" data-plugin-storage><button type="button" className="btn btn-sm" data-review-storage disabled={busy} onClick={()=>act(async()=>setReview(await window.api.pluginsPreviewStorage()))}>{t('plugins.storage_review')}</button>
  {error&&<p role="alert">{error}</p>}{notice&&<p role="status" data-storage-cleaned>{notice}</p>}
  {review&&<div data-storage-review><dl className="plugin-storage-totals">{['installedBytes','preferenceBytes','ownedSoundBytes','cacheBytes','removableBytes'].map(key=><React.Fragment key={key}><dt>{t('plugins.storage_'+key)}</dt><dd>{bytes(review[key])}</dd></React.Fragment>)}</dl>
   <ul>{review.entries.map(e=><li key={e.name} data-cache-file={e.name}>{e.name.slice(65)} · {bytes(e.bytes)} · {t(e.active?'plugins.storage_active':'plugins.storage_unused')}</li>)}</ul>
   <div className="settings-actions"><button type="button" className="btn" data-clean-storage disabled={busy||!review.entries.some(e=>!e.active)} onClick={()=>act(async()=>{const result=await window.api.pluginsCleanPreviewStorage(review.token);setReview(null);setNotice(t('plugins.storage_done',{count:result.count,size:bytes(result.bytes)}));})}>{t('plugins.storage_clean')}</button><button type="button" className="btn btn-ghost" disabled={busy} onClick={()=>setReview(null)}>{t('plugins.cancel')}</button></div>
  </div>}
 </section></SettingsGroup>;
}
