import {ExtensionAgentSession} from './extensionAgentSession.js';
import {projectConfiguration} from '../../../shared/extensionConfiguration.mjs';
import {sameDoc} from '../../state/projectFile.js';
import {ExtensionDraft,samePreparationDocument,carryPreparationMetadata} from './extensionDraft.js';
import {extensionUiError} from './useExtensionUi.js';
import {flushSync} from 'react-dom';
import {useCallback,useEffect,useRef,useState} from 'react';
import {clipTransaction} from '../../../shared/pluginEdits.mjs';
import {preparePluginEdits,projectDuration,exportDuration,renderable,pluginEditsApplied,historyReducer,prepareExtensionCommit,historyOrigin} from '../../state/store.js';
import {mediaInsertion,captionRead,captionWrite,editContextInput,markerApply} from './extensionOperations.js';
const permissions=['editor.read','clips.write','clips.retime','clips.automation','clips.effects','clips.properties','clips.manage','tracks.write','timeline.ripple','clips.links','clips.linked','timeline.edit','timeline.reorder'];
export function useExtensionHost(options){
 const latest=useRef(options);latest.current=options;
 const agentCommands=useRef(new Map());
 const stages=useRef(new Map()),[preparing,setPreparing]=useState(null);
 const eventDocument=useRef(undefined);
 const renders=useRef(new Map()),canceledRenders=useRef(new Set());
 useEffect(()=>window.api.onExtensionExportCanceled?.(({id})=>{const controller=renders.current.get(id);if(controller)controller.abort();else{canceledRenders.current.add(id);if(canceledRenders.current.size>32)canceledRenders.current.delete(canceledRenders.current.values().next().value);}}),[]);
 const cancelBefore=useCallback(id=>{const stage=stages.current.get(id);if(stage){stage.controller.abort();window.api.pluginsExtensionOperationCancel(id).catch(()=>{});}},[]);
 useEffect(()=>window.api.onExtensionOperationCanceled?.(event=>{const stage=stages.current.get(event.id);if(stage)stage.error=event.error;}),[]);
 const before=useCallback(async(kind,{source,signal,allowAgent=false,agentToken,agentSession,destination,operationId}={})=>{
  if(stages.current.size)throw Error('Another save/export preparation is in progress');
  const current=latest.current,base=current.getHistory();if(!current.hasProject)throw Error('No project is open');
  source??=base.present;const id=operationId||crypto.randomUUID(),controller=new AbortController(),draft=new ExtensionDraft({...base,present:source},{selection:current.selection?.(),playhead:current.capture().snapshot.playhead}),stage={id,base,source,draft,controller,epoch:current.epoch,error:null};
  stage.check=()=>{const now=latest.current,state=now.getHistory();if(controller.signal.aborted)throw Object.assign(Error('Preparation canceled'),{name:'AbortError'});if(stage.error)throw Error(stage.error);if(!now.hasProject||now.epoch!==stage.epoch||!samePreparationDocument(source,base.present)||!samePreparationDocument(base.present,state.present)||state.gestureStart||(agentToken?state.agentEdit?.token!==agentToken:state.agentEdit)||now.isPreparationBusy?.(kind,allowAgent)||!draft.valid())throw Error('Project changed or is busy during preparation');return state;};
  stages.current.set(id,stage);const preparingTimer=setTimeout(()=>setPreparing({id,kind}),180);let lease,finished=false,claimed=false,live=true;
  const abort=()=>cancelBefore(id);signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
  try{
   if(controller.signal.aborted)throw Object.assign(Error('Preparation canceled'),{name:'AbortError'});
   const document=draft.read('workspace.read');if(document.name.length>1000)delete document.name;
   const ready=await window.api.pluginsExtensionOperationBegin({id,kind,document,...(destination?{destination}:{})});
   if(!ready.participants){if(controller.signal.aborted)throw Object.assign(Error('Preparation canceled'),{name:'AbortError'});await window.api.pluginsExtensionOperationComplete(id);finished=true;return source;}
   stage.check();lease=await window.api.pluginsExtensionOperationCommit(id);stage.check();
   // Flush any already queued user updates before capturing the exact history.
   flushSync(()=>{});const history=stage.check(),next=carryPreparationMetadata(draft.project,history.present);let result;
   if(sameDoc(history.present,next)){claimed=window.api.pluginsExtensionCommitApply(lease.id);if(!claimed)throw Error('Preparation stopped before commit');result=history.present;}
   else{
    let verificationError;const action=prepareExtensionCommit(history,next,()=>{try{stage.check();claimed=live&&window.api.pluginsExtensionCommitApply(lease.id);return claimed;}catch(error){verificationError=error;return false;}},agentToken,{kind:'extension',extensionIds:ready.extensionIds,operationId:id});
    const publish=()=>{flushSync(()=>current.dispatch(action));if(!pluginEditsApplied(latest.current.getHistory(),action))throw verificationError||Error('Preparation stopped or the editor changed before commit');};if(agentSession){agentSession.commit({type:'batch',actions:draft.actions},next,publish);agentSession.receipt('export.prepare',{applied:draft.steps,changed:true,extensionIds:ready.extensionIds},undefined);}else publish();result=latest.current.getHistory().present;
   }
   await window.api.pluginsExtensionCommitFinish(lease.id,true);finished=true;if(controller.signal.aborted)throw Object.assign(Error('Preparation canceled'),{name:'AbortError'});return result;
  }catch(error){if(controller.signal.aborted)throw Object.assign(Error('Preparation canceled'),{name:'AbortError'});throw Error(stage.error||extensionUiError(error));}
  finally{live=false;clearTimeout(preparingTimer);signal?.removeEventListener('abort',abort);if(!finished){if(lease)await window.api.pluginsExtensionCommitFinish(lease.id,claimed).catch(()=>{});await window.api.pluginsExtensionOperationCancel(id).catch(()=>{});}stages.current.delete(id);setPreparing(previous=>previous?.id===id?null:previous);}
 },[cancelBefore]);

 const runAgentCommand=useCallback(async(input,{agentToken,isCanceled,commit,onProgress})=>{
  const epoch=latest.current.epoch,session=new ExtensionAgentSession({agentToken,isCanceled,commit,getHistory:()=>latest.current.getHistory(),hasProject:()=>latest.current.hasProject&&latest.current.epoch===epoch,epoch,isBusy:()=>!session.exporting&&latest.current.isAgentCommandBusy?.()});session.onProgress=onProgress;session.check();
  if(agentCommands.current.size)throw Error('Another extension command is running');
  const id=crypto.randomUUID();agentCommands.current.set(id,session);let canceled=false;
  const cancel=()=>{if(!canceled){canceled=true;window.api.pluginsExtensionAgentCancel(id).catch(()=>{});}};
  const check=()=>{try{session.check();}catch{cancel();}},timer=setInterval(check,40);
  try{const result=await window.api.pluginsExtensionAgentCommand({...input,id});check();return {...result,document_receipts:session.receipts,...(canceled?{status:'canceled',error:'CraftAI command ownership ended; completed effects and edits may remain.'}:{})};}
  finally{clearInterval(timer);agentCommands.current.delete(id);}
 },[]);
 useEffect(()=>window.api.onExtensionAgentProgress?.(event=>{const session=agentCommands.current.get(event.id);if(session)session.onProgress?.({phase:'running',stage:event.message||event.title,progress:event.fraction});}),[]);
 const [preview,setPreview]=useState(null),previewRef=useRef(null);
 previewRef.current=preview;
 const closePreview=useCallback(()=>{
  const previous=previewRef.current;previewRef.current=null;setPreview(null);
  if(previous)window.api.pluginsExtensionPreviewClosed(previous.key,previous.item.id).catch(()=>{});
 },[]);
 const insertPreview=useCallback(async()=>{
  const value=previewRef.current;if(!value)throw Error('Preview is closed');
  return window.api.pluginsExtensionInsertArtifact(value.key,{id:value.item.id,documentId:value.documentId});
 },[]);
 useEffect(()=>{
  const off=window.api.onExtensionState?.(state=>{
   const value=previewRef.current;
   if(value&&!state.some(job=>job.key===value.key&&job.generation===value.generation&&['running','activating'].includes(job.state)))closePreview();
  });return()=>{off?.();const value=previewRef.current;if(value)window.api.pluginsExtensionPreviewClosed(value.key,value.item.id).catch(()=>{});};
 },[closePreview]);
 useEffect(()=>window.api.onExtensionRequest?.(async request=>{
  try{
   const current=latest.current;if(!current.hasProject)throw Error('No project is open');
   const agentSession=request.agentScope?agentCommands.current.get(request.agentScope):undefined;if(request.agentScope&&!agentSession)throw Error('Agent command is no longer active');agentSession?.check();
   if(request.method==='exports.render'){
    const {id,input,target,title}=request.args,controller=new AbortController();renders.current.set(id,controller);if(canceledRenders.current.delete(id))controller.abort();
    try{if(agentSession)agentSession.exporting=true;const value=await current.startExport({input,target,title,extensionId:request.extensionId,operationId:id,agentSession},{signal:controller.signal,onProgress:value=>window.api.pluginsExtensionExportProgress(id,value).catch(()=>{})});await window.api.pluginsExtensionReply({id:request.id,value});}finally{if(agentSession)agentSession.exporting=false;renders.current.delete(id);}return;
   }
   if(request.operation){
    if(!await window.api.pluginsExtensionAuthorize(request.key,request.generation,request.execution,request.jobOperation))throw Error('Extension callback or job stopped');
    const stage=stages.current.get(request.operation.id);if(!stage)throw Error('Save/export preparation is no longer active');stage.check();
    const write=['editor.apply','media.insert','captions.write','markers.apply','configuration.update'].includes(request.method);if(write&&request.operation.phase!=='prepare')throw Error('Validation hooks cannot edit the document');
    const value=write?stage.draft.write(request.method,request.args,request.extensionId):stage.draft.read(request.method,request.args,request.extensionId);
    await window.api.pluginsExtensionReply({id:request.id,value});return;
   }

   let value;const base=current.capture();
   const contextInput=request.method==='editor.read'?request.args:request.method==='editor.apply'?editContextInput(request.args):undefined;
   const {snapshot,targets,rebase}=contextInput===undefined?base:current.capture(contextInput),state=current.getHistory(),project=state.present;
   if(['editor.apply','captions.write','media.insert'].includes(request.method)&&rebase)request={...request,args:rebase(request.args)};
   const canCommit=async()=>{
    if(!await window.api.pluginsExtensionAuthorize(request.key,request.generation,request.execution,request.jobOperation)||!latest.current.hasProject||!samePreparationDocument(project,latest.current.getHistory().present)||(agentSession?latest.current.isAgentCommandBusy?.():current.isBusy()||state.agentEdit)||state.gestureStart)throw Error('Editor changed, is busy, or extension stopped');
   };
   const commit=async action=>{
    if(agentSession)action={...action,coverExport:true};
    const next=historyReducer({past:[],present:project,future:[]},action).present;if(next===project)throw Error('Editor refused the prepared edit');
    const lease=await window.api.pluginsExtensionCommitAcquire(request.key,request.generation,request.execution,request.jobOperation);let live=true;
    try{
     if(!latest.current.hasProject||!samePreparationDocument(project,latest.current.getHistory().present)||(agentSession?latest.current.isAgentCommandBusy?.():current.isBusy()))throw Error('Editor changed while preparing the edit');
     agentSession?.check();const history=latest.current.getHistory(),candidate=carryPreparationMetadata(next,history.present);
     const publish=value=>{const prepared=prepareExtensionCommit(history,value,()=>{if(agentSession)agentSession.check();return live&&latest.current.hasProject&&!(agentSession?latest.current.isAgentCommandBusy?.():latest.current.isBusy())&&window.api.pluginsExtensionCommitApply(lease.id);},agentSession?.agentToken,{kind:'extension',extensionId:request.extensionId});
      flushSync(()=>current.dispatch(prepared));if(!pluginEditsApplied(latest.current.getHistory(),prepared))throw Error('Editor changed or extension stopped before the edit committed');};
     if(agentSession)agentSession.commit(action,candidate,publish);else publish(candidate);
    }finally{live=false;await window.api.pluginsExtensionCommitFinish(lease.id);}
   };
   if(request.method==='configuration.get'||request.method==='configuration.update'){
    const write=request.method==='configuration.update';if(write)await canCommit();
    const plan=projectConfiguration(project,snapshot.documentId,request.extensionId,request.method,request.args);if(plan.action)await commit(plan.action);value=plan.value;
   }else if(request.method==='editor.read')value=snapshot;
   else if(request.method==='editor.tools.list')value=current.editorTools.list();
   else if(request.method==='editor.tools.run'){
    if(agentSession)throw Error('Editor tools are not available while CraftAI runs this command; use editor.apply.');
    value=await current.editorTools.run(request.args,async()=>{if(!await window.api.pluginsExtensionAuthorize(request.key,request.generation,request.execution,request.jobOperation))throw Error('Extension callback or job stopped');});
   }else if(request.method==='workspace.inspect')value=current.inspect('inspect',request.args);
   else if(request.method==='workspace.readValue')value=current.inspect('readValue',request.args);
   else if(request.method==='workspace.read')value={documentId:snapshot.documentId,name:project.name,width:project.width,height:project.height,fps:project.fps,duration_sec:projectDuration(project),export_duration_sec:exportDuration(renderable(project))};
   else if(request.method==='editor.apply'){
    await canCommit();
    const transaction=clipTransaction(request.args,snapshot,projectDuration(project),permissions),plan=preparePluginEdits(project,snapshot,targets,transaction,permissions);
    if(plan.action)await commit(plan.action);
    value={applied:transaction.operations.length};
   }else if(request.method==='markers.apply'){
    await canCommit();const plan=markerApply(project,current.documentScope(),request.args,current.inspect('markerTargets',request.args));if(plan.action)await commit(plan.action);value={applied:plan.applied};
   }else if(request.method==='media.preview'){
    if(!await window.api.pluginsExtensionAuthorize(request.key,request.generation,request.execution,request.jobOperation))throw Error('Extension stopped');
    if(!latest.current.hasProject||latest.current.capture().snapshot.documentId!==snapshot.documentId)throw Error('Project changed while opening preview');
    closePreview();setPreview({key:request.key,generation:request.generation,item:request.args.item,documentId:snapshot.documentId,fps:project.fps,autoplay:request.args.autoplay===true});value={shown:true};
   }else if(request.method==='media.insert'){
    await canCommit();
    if(request.args.documentId&&request.args.documentId!==snapshot.documentId)throw Error('Project changed while previewing');
    const plan=mediaInsertion(project,snapshot,request.args.item,request.args);
    plan.verifyPlacement(historyReducer({past:[],present:project,future:[]},plan.action).present);
    await commit(plan.action);
    // clipId is the saved clip id; handle is the public handle editor.read/apply use for it.
    const handle=latest.current.capture().targets.find(target=>target.id===plan.clipId)?.handle;
    value={mediaId:plan.mediaId,clipId:plan.clipId,lane:plan.lane,...(handle?{handle}:{})};
   }else if(request.method==='captions.read')value=captionRead(project,snapshot,targets,request.args);
   else if(request.method==='captions.write'){
    await canCommit();const plan=captionWrite(project,snapshot,request.args,request.extensionId,current.documentScope());
    if(plan.action)await commit(plan.action);
    value={written:plan.ids.length,...(plan.trackId?{trackId:plan.trackId}:{})};
   }else throw Error('Host API is not connected: '+request.method);
   if(agentSession&&['editor.apply','markers.apply','media.insert','captions.write','configuration.update'].includes(request.method))agentSession.receipt(request.method,{...(value&&typeof value==='object'?value:{}),changed:!sameDoc(project,latest.current.getHistory().present)},request.extensionId);
   await window.api.pluginsExtensionReply({id:request.id,value});
  }catch(e){await window.api.pluginsExtensionReply({id:request.id,error:e.message});}
 }),[closePreview]);
 useEffect(()=>{
  closePreview();if(!options.hasProject){if(eventDocument.current===undefined)window.api.pluginsExtensionPublish?.('project.closed',null,{source:{kind:'system'},reason:'close'}).catch(()=>{});eventDocument.current=null;return;}
  const snapshot=options.capture().snapshot,scope=options.documentScope();
  eventDocument.current=snapshot.documentId;
  window.api.pluginsExtensionPublish?.('project.opened',snapshot,{source:{kind:'system'},reason:'open',...scope}).catch(()=>{});
  return ()=>{eventDocument.current=null;window.api.pluginsExtensionPublish?.('project.closed',null,{source:{kind:'system'},reason:'close',documentId:snapshot.documentId}).catch(()=>{});};
 },[options.hasProject,options.epoch,closePreview]);
 useEffect(()=>{
  if(!options.hasProject)return;let previous=null,previousOrigin=null,previousSettings=options.getHistory().present.extensionSettings||{};
  const publish=(name,value,metadata)=>window.api.pluginsExtensionPublish?.(name,value,metadata).catch(()=>{});
  const sample=()=>{
   const current=latest.current,snapshot=current.capture().snapshot,scope=current.documentScope(),origin=historyOrigin(current.getHistory());
   const document=!previous||origin.sequence!==previousOrigin.sequence,cache=!previous||origin.cacheSequence!==previousOrigin.cacheSequence,selection=!previous||JSON.stringify(snapshot.selection)!==JSON.stringify(previous.selection),playback=!previous||snapshot.playhead.time_sec!==previous.playhead.time_sec||snapshot.playhead.playing!==previous.playhead.playing;
   if(document)publish('project.changed',{...scope,revision:snapshot.revision},{...scope,source:origin.source,reason:origin.reason,changes:['document'],missed:previousOrigin?Math.max(0,origin.sequence-previousOrigin.sequence-1):0});
   if(!previous||snapshot!==previous){
    const changes=[...(document?['document']:[]),...(cache?['cache']:[]),...(selection?['selection']:[]),...(playback?['playback']:[])];
    publish('editor.changed',snapshot,{...scope,source:document?origin.source:cache?{kind:'system'}:{kind:'unknown'},reason:document?origin.reason:cache?'cache':selection?'selection':'playback',changes,missed:previousOrigin?Math.max(0,origin.sequence-previousOrigin.sequence-1):0});
   }
   if(selection)publish('selection.changed',{documentId:snapshot.documentId,...snapshot.selection},{...scope,source:{kind:'unknown'},reason:'selection'});
   if(playback)publish('playback.changed',{documentId:snapshot.documentId,...snapshot.playhead},{...scope,source:{kind:'unknown'},reason:'playback'});
   const settings=current.getHistory().present.extensionSettings||{};
   if(settings!==previousSettings){for(const extensionId of new Set([...Object.keys(settings),...Object.keys(previousSettings)])){const before=previousSettings[extensionId]||{},after=settings[extensionId]||{};for(const key of new Set([...Object.keys(before),...Object.keys(after)]))if(JSON.stringify(before[key])!==JSON.stringify(after[key]))publish('configuration.changed',{extensionId,key,scope:'project',documentId:scope.documentId,deleted:!Object.hasOwn(after,key)},{...scope,source:origin.source,reason:'configuration'});}previousSettings=settings;}
   previous=snapshot;previousOrigin=origin;
  };
  sample();const timer=setInterval(sample,100);return ()=>clearInterval(timer);
 },[options.hasProject,options.epoch]);

 return {preview,closePreview,insertPreview,before,preparing,cancelBefore,runAgentCommand};
}
