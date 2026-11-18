import React,{useState} from 'react';
import {flushExtensionSettings} from './ExtensionNativeUi.jsx';
import {t} from '../../../i18n/index.js';
import {extensionUiError,extensionUiMessage} from '../useExtensionUi.js';
export default function ExtensionCommands({row}){
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 const run=async id=>{setBusy(true);setError('');setMessage('');try{if(!await flushExtensionSettings())throw Error(t('plugins.extension_settings_failed'));const result=await window.api.pluginsExtensionExecute(row.manifest.id+'.'+id,{},row.key);if(result?.error)throw Error(result.error);setMessage(extensionUiMessage(result,t('plugins.extension_completed')));}catch(e){setError(extensionUiError(e));}finally{setBusy(false);}};
 return <section className="plugin-commands"><h5 className="set2-group-label">{t('plugins.commands')}</h5>{row.manifest.contributes.commands.map(command=><div key={command.id} className="plugin-command" data-extension-command={command.id}><b>{command.name}</b><button type="button" className="btn btn-sm" disabled={busy||!row.enabled} onClick={()=>run(command.id)}>{t('plugins.run_command')}</button></div>)}{error&&<p role="alert">{error}</p>}{message&&<p role="status" className="plugin-license">{message.slice(0,2000)}</p>}</section>;
}
