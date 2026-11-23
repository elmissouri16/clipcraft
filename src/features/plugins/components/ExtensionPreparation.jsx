import React from 'react';
import {t} from '../../../i18n/index.js';
export default function ExtensionPreparation({value,onCancel}){
 if(!value)return null;
 return <div className="render-job extension-preparation" role="status" data-extension-preparation><span>{t(value.kind==='save'?'plugins.preparing_save':value.kind==='export'?'plugins.preparing_export':value.kind==='close'?'plugins.preparing_close':'plugins.notifying_project_hooks')}</span><button type="button" className="btn btn-sm" onClick={()=>onCancel(value.id)}>{t('app.cancel')}</button></div>;
}
