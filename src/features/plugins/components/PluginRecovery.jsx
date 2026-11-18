import React, {useState} from 'react';
import {t} from '../../../i18n/index.js';

const message=error=>String(error.message||error).replace(/^Error invoking remote method 'plugins:[^']+': (?:Error: )?/,'');
export default function PluginRecovery({busy,setBusy,onRecovered}) {
  const [review,setReview]=useState(null),[error,setError]=useState(''),[archive,setArchive]=useState(null);
  const prepare=async()=>{
    setBusy(true);setError('');setReview(null);
    try{setReview(await window.api.pluginsPrepareRecovery());}catch(error){setError(message(error));}finally{setBusy(false);}
  };
  const recover=async()=>{
    setBusy(true);setError('');
    try{const result=await window.api.pluginsRecover(review.token);onRecovered(result.rows);setArchive(result.archiveId);}
    catch(error){setError(message(error));try{onRecovered(await window.api.pluginsList());}catch{}}
    finally{setReview(null);setBusy(false);}
  };
  return <div className="plugin-recovery">
    <button type="button" className="btn btn-ghost" data-review-recovery disabled={busy} onClick={prepare}>{t('plugins.review_recovery')}</button>
    {error&&<p className="error-text" role="alert">{error}</p>}
    {archive&&<p role="status" data-recovery-complete>{t('plugins.recovery_complete')} <button type="button" className="btn btn-ghost" onClick={async()=>{try{const error=await window.api.pluginsShowRecoveryArchive(archive);if(error)setError(error);}catch(error){setError(message(error));}}}>{t('plugins.recovery_show_archive')}</button></p>}
    {review&&<div role="group" data-recovery-review aria-label={t('plugins.review_recovery')}>
      <p>{t('plugins.recovery_explanation')}</p>
      <p>{t('plugins.recovery_state',{state:t('plugins.recovery_state_'+review.state),backup:t('plugins.recovery_state_'+review.backupState)})}</p>
      {review.blocked&&<p role="alert">{t('plugins.recovery_blocked')}</p>}
      {!review.needed&&!review.blocked&&<p>{t('plugins.recovery_not_needed')}</p>}
      <ul>{review.packages.map(item=><li key={item.key} data-recovery-candidate={item.key}>
        {item.name?`${item.name} ${item.version} · ${item.id} · ${item.key.slice(0,12)}`:item.key.slice(0,12)} — {t('plugins.recovery_package_'+item.status)}
        {item.reason&&` (${t('plugins.recovery_reason_'+item.reason)})`}
      </li>)}</ul>
      <p>{t('plugins.recovery_archive_count',{count:review.archive.length})}</p>
      <button type="button" className="btn" data-confirm-recovery disabled={busy||review.blocked||!review.needed} onClick={recover}>{t('plugins.recovery_confirm')}</button>{' '}
      <button type="button" className="btn btn-ghost" data-cancel-recovery disabled={busy} onClick={()=>setReview(null)}>{t('plugins.cancel')}</button>
    </div>}
  </div>;
}
