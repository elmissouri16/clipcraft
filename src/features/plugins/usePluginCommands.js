import {gifProjectSnapshot} from '../../../shared/pluginGif.mjs';
import {projectRevision} from '../agent/context.js';
import {renderable} from '../../state/store.js';
import {useEffect,useRef,useState} from 'react';
import {preparePluginEdits,pluginEditsApplied,projectDuration,layerCount,isLayerLocked} from '../../state/store.js';
import {uniqueCommandMarkers} from '../../../shared/pluginCommands.mjs';
import {t,tn} from '../../i18n/index.js';
import {captionSnapshot,translationSnapshot,reviewedCaptionResult} from '../../../shared/pluginAi.mjs';
const waitForCommit=async(getHistory,ids,key='markers')=>{const deadline=performance.now()+1000;do{if(ids.every(id=>(getHistory().present[key]||[]).some(m=>m.id===id)))return true;await new Promise(resolve=>setTimeout(resolve,10));}while(performance.now()<deadline);return ids.every(id=>(getHistory().present[key]||[]).some(m=>m.id===id));};
export function usePluginCommands(options){
 const latest=useRef(options);latest.current=options;
 const active=useRef(null),live=useRef(true);
 const [status,setStatus]=useState(null);
 const update=value=>{if(live.current)setStatus(value);};
 const cancel=runId=>{const run=active.current;if(!run||run.committing||(typeof runId==='string'&&run.id!==runId))return;run.canceled=true;window.api.pluginsCancelCommand(run.id).catch(()=>{});run.report({phase:'canceled',message:t('plugins.command_canceled')});};
 useEffect(()=>{live.current=true;const off=window.api.onPluginCommandProgress?.(event=>{if(active.current?.id===event.runId&&!active.current.canceled)active.current.report(event);});return()=>{live.current=false;cancel();off?.();};},[]);
 const run=async(command,input,runOptions={})=>{
  const report=value=>{const result={...value,key:command.key,commandId:command.id};update(result);runOptions.onProgress?.(result);return result;};
  if(active.current)return {phase:'failed',message:t('plugins.command_busy')};
  const owned=()=>live.current&&(!runOptions.isCurrent||runOptions.isCurrent());
  const app=latest.current,history=app.getHistory(),base=history.present,version=app.getVersion();
  if(!owned()||!app.hasProject||projectDuration(base)<=0||app.isBusy()||history.agentEdit||history.gestureStart){return report({phase:'failed',message:t('plugins.command_busy')});}
  const gif=command.permissions?.includes('export.gif'),revision=gif?projectRevision(base):null;
  const stale=state=>gif?projectRevision(state.present)!==revision:state.present!==base;
  const execution={id:runOptions.runId||crypto.randomUUID(),source:runOptions.panelAction?'panel':'manual',report,key:command.key,commandId:command.id,canceled:false,committing:false};active.current=execution;
  let watch;
  report({phase:'permission',runId:execution.id,progress:0,message:''});
  try{
   const snapshot={duration_sec:projectDuration(base),fps:base.fps||30,markers:(base.markers||[]).slice(0,1000).map(m=>({time:m.time,label:String(m.label||'').replace(/[\u0000-\u001f]/g,' ').slice(0,80)})),markers_total:(base.markers||[]).length};
   const clipWriting=command.permissions?.some(p=>['clips.write','timeline.reorder','timeline.edit','clips.linked'].includes(p)),editContext=clipWriting?app.getEditContext():null;
   const editor=editContext?.snapshot||(command.permissions?.includes('editor.read')?app.getEditorContext():undefined);
   const captionWriting=command.permissions?.includes('captions.write');
   if(captionWriting&&(layerCount(base,'text')>=128||isLayerLocked(base,'text',layerCount(base,'text'))))throw Error(t('plugins.translation_no_track'));
   const captions=command.permissions?.includes('captions.read')?(captionWriting?translationSnapshot(base,snapshot.duration_sec,input.source_track):captionSnapshot(base,snapshot.duration_sec)):undefined;
   watch=setInterval(()=>{if(execution.committing)return;const current=latest.current,state=current.getHistory();if(!owned()||!current.hasProject||stale(state)||current.getVersion()!==version||current.isBusy()||state.agentEdit||state.gestureStart){execution.canceled=true;execution.stale=true;window.api.pluginsCancelCommand(execution.id).catch(()=>{});}},40);
   const result=await window.api.pluginsRunCommand({runId:execution.id,key:command.key,commandId:command.id,input,snapshot,...(editor?{editor}:{}),...(runOptions.panelAction?{panelAction:runOptions.panelAction}:{}),...(captions?{captions}:{}),...(gif?{exportProject:gifProjectSnapshot(renderable(base))}:{})});
   if(gif&&result.status==='completed'&&result.key===command.key&&result.artifact?.format==='gif'){return report({phase:'completed',progress:1,message:t('plugins.gif_saved'),artifact:result.artifact});}
   if(execution.canceled||result.status==='canceled'){return report({phase:execution.stale?'failed':'canceled',message:t(execution.stale?'plugins.command_stale':'plugins.command_canceled')});}
   if(result.status==='denied'){return report({phase:'denied',message:t('plugins.command_denied')});}
   if(result.status!=='completed')throw Error(result.error||t('plugins.command_failed'));
   if(result.key!==command.key)throw Error(t('plugins.command_failed'));
   if(command.permissions?.includes('ai.chapters')&&result.reviewed!==true)throw Error(t('plugins.command_failed'));
   const current=latest.current,state=current.getHistory();
   if(!owned()||!current.hasProject||stale(state)||current.getVersion()!==version||current.isBusy()||state.agentEdit||state.gestureStart)throw Error(t('plugins.command_stale'));
   if(command.development&&!runOptions.beforeCommit&&!clipWriting){
    execution.committing=true;
    if(!await window.api.pluginsAuthorizeDevelopmentCommit(execution.id,command.key))return report({phase:'canceled',message:t('plugins.command_canceled')});
    const finalApp=latest.current,finalState=finalApp.getHistory();
    if(execution.canceled||!owned()||!finalApp.hasProject||stale(finalState)||finalApp.getVersion()!==version||finalApp.isBusy()||finalState.agentEdit||finalState.gestureStart)throw Error(t('plugins.command_stale'));
   }
   if(clipWriting){
    const plan=preparePluginEdits(base,editor,editContext.targets,result.edits,command.permissions);
    if(!await window.api.pluginsAuthorizeClipEdits({runId:execution.id,key:command.key,token:result.editCommit,edits:result.edits}))return report({phase:'canceled',message:t('plugins.command_canceled')});
    if(runOptions.beforeCommit&&!await runOptions.beforeCommit())return report({phase:'canceled',message:t('plugins.command_canceled')});
    const finalApp=latest.current,finalState=finalApp.getHistory();
    if(execution.canceled||!owned()||!finalApp.hasProject||stale(finalState)||finalApp.getVersion()!==version||finalApp.isBusy()||finalState.agentEdit||finalState.gestureStart)throw Error(t('plugins.command_stale'));
    execution.committing=true;
    if(plan.action){
     report({phase:'applying',progress:1,message:t('plugins.clips_applying')});finalApp.dispatch(plan.action);
     const deadline=performance.now()+1000;while(!pluginEditsApplied(latest.current.getHistory(),plan.action)&&performance.now()<deadline)await new Promise(resolve=>setTimeout(resolve,10));
     if(!pluginEditsApplied(latest.current.getHistory(),plan.action))throw Error(t('plugins.command_stale'));
    }
    return report({phase:'completed',clipsChanged:plan.clipsChanged,progress:1,message:tn('plugins.clips_completed',plan.clipsChanged),pluginMessage:result.message});
   }
   if(captionWriting){
    const {proposal,sourceTrack}=reviewedCaptionResult(base,snapshot.duration_sec,input,result),ids=proposal.translations.map(()=>crypto.randomUUID());
    execution.committing=true;report({phase:'applying',progress:1,message:t('plugins.command_applying')});
    current.dispatch({type:'pluginCaptionTrack',base,translation:proposal,sourceTrack,ids});
    if(!await waitForCommit(()=>latest.current.getHistory(),ids,'textClips'))throw Error(t('plugins.command_stale'));
    const clip=latest.current.getHistory().present.textClips.find(c=>c.id===ids[0]);
    return report({phase:'completed',progress:1,message:t('plugins.translation_completed',{count:ids.length,track:clip.layer+1}),pluginMessage:result.message});
   }
   const markers=uniqueCommandMarkers(base,result.markers,snapshot.duration_sec);
   const ids=markers.map(()=>crypto.randomUUID());
   execution.committing=true;
   if(runOptions.beforeCommit&&!await runOptions.beforeCommit())return report({phase:'canceled',message:t('plugins.command_canceled')});
   const finalApp=latest.current,finalState=finalApp.getHistory();
   if(execution.canceled||!owned()||!finalApp.hasProject||stale(finalState)||finalApp.getVersion()!==version||finalApp.isBusy()||finalState.agentEdit||finalState.gestureStart)throw Error(t('plugins.command_stale'));
   if(markers.length){
    report({phase:'applying',progress:1,message:t('plugins.command_applying')});
    current.dispatch({type:'pluginMarkers',base,markers,ids});
    if(!await waitForCommit(()=>latest.current.getHistory(),ids))throw Error(t('plugins.command_stale'));
   }
   return report({phase:'completed',markersAdded:markers.length,progress:1,message:t('plugins.command_completed',{count:markers.length}),pluginMessage:result.message});
  }catch(error){return report({phase:execution.canceled?'canceled':'failed',message:execution.canceled?t('plugins.command_canceled'):error.message});}
  finally{clearInterval(watch);if(active.current===execution)active.current=null;}
 };
 const cancelManual=key=>{if(active.current?.source==='manual'&&active.current.key===key)cancel(active.current.id);};
 return {run,cancel,cancelManual,status,get busy(){return !!active.current;},hasProject:options.hasProject};
}
