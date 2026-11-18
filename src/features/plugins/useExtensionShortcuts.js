import {useCallback,useEffect,useRef} from 'react';
import {activeKeymap,extensionShortcut,setExtensionShortcuts} from '../../app/keymap.js';
export function useExtensionShortcuts(options){
 const latest=useRef(options);latest.current=options;
 const run=useCallback(id=>{
  const action=extensionShortcut(id);if(!action||action.scope==='editor'&&!latest.current.hasProject||document.querySelector('[aria-modal="true"],.settings2,.ctx-menu,[role="menu"],.dropdown-list'))return false;
  window.api.pluginsExtensionShortcutExecute(id).catch(error=>latest.current.onError(error));return true;
 },[]);
 useEffect(()=>{
  let live=true,sequence=0,timer,stateFingerprint='',uiFingerprint='';
  const refresh=()=>{clearTimeout(timer);const version=++sequence;timer=setTimeout(()=>window.api.pluginsExtensionShortcuts().then(rows=>{if(live&&version===sequence)setExtensionShortcuts(rows);}).catch(()=>{if(live&&version===sequence)setExtensionShortcuts([]);}),20);};
  const off=[window.api.onExtensionUiChanged(rows=>{const next=JSON.stringify(rows);if(next!==uiFingerprint){uiFingerprint=next;refresh();}}),window.api.onExtensionState(rows=>{const next=JSON.stringify(rows.map(({key,generation,state})=>({key,generation,state})));if(next!==stateFingerprint){stateFingerprint=next;refresh();}}),window.api.onPluginsChanged(refresh),window.api.onExtensionViewEvent(event=>{if(event.type==='shortcut'){const id=Object.keys(activeKeymap()).find(id=>id.startsWith('extension:')&&activeKeymap()[id].includes(event.combo));if(id)run(id);}})];refresh();
  return()=>{live=false;clearTimeout(timer);sequence++;for(const dispose of off)dispose();};
 },[run]);
 return {run};
}
