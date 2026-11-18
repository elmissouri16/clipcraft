import {useCallback,useEffect,useState} from 'react';
export function extensionUiError(error){return String(error?.message||error).replace(/^(?:Error invoking remote method '[^']+': )?(?:Error: )*/, '').split(/\n\s*at /)[0].slice(0,1000);}
export function extensionUiMessage(result,fallback){const value=typeof result==='string'?result:typeof result?.message==='string'?result.message:fallback;return String(value||fallback).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'').slice(0,2000);}
export function useExtensionUi(location,extensionId,extensionKey){
 const [items,setItems]=useState([]),[error,setError]=useState('');
 const refresh=useCallback(()=>window.api.pluginsExtensionUi?.(location,extensionKey).then(value=>{setItems(value);setError('');}).catch(e=>setError(extensionUiError(e))),[location,extensionKey]);
 useEffect(()=>{let live=true;window.api.pluginsExtensionUi?.(location,extensionKey).then(value=>{if(live)setItems(value);}).catch(e=>{if(live)setError(extensionUiError(e));});const off=window.api.onExtensionUiChanged?.(value=>{if(live)setItems(value);});return()=>{live=false;off?.();};},[location,extensionKey]);
 return {items:items.filter(entry=>(!location||entry.location===location||entry.point===location)&&(!extensionId||entry.extensionId===extensionId)),error,refresh};
}
