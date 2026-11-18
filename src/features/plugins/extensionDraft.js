import {clipTransaction} from '../../../shared/pluginEdits.mjs';
import {projectConfiguration} from '../../../shared/extensionConfiguration.mjs';
import {historyReducer,preparePluginEdits,projectDuration,exportDuration,renderable,pluginEditsApplied} from '../../state/store.js';
import {createEditorContext} from './editorContext.js';
import {mediaInsertion,captionRead,captionWrite,editContextInput,markerApply} from './extensionOperations.js';
import {pluginEffectsRevision} from './effectRegistry.js';
export const extensionEditPermissions=['editor.read','clips.write','clips.retime','clips.automation','clips.effects','clips.properties','clips.manage','tracks.write','timeline.ripple','clips.links','clips.linked','timeline.edit','timeline.reorder'];
const carriedFields=new Set(['craftAI','posterImage','posterImageAt']);
const mediaVisualFields=new Set(['thumb','thumbCount','thumbInterval','thumbW','thumbH','poster','wave','proxy','proxies','lightProxy','proxyRequired','proxyFailed','optimizing']);
const sameFields=(a,b,ignored)=>{if(a===b)return true;if(!a||!b)return false;const keys=Object.keys(a).filter(key=>!ignored.has(key));return keys.length===Object.keys(b).filter(key=>!ignored.has(key)).length&&keys.every(key=>Object.hasOwn(b,key)&&a[key]===b[key]);};
const sameMedia=(a,b)=>a===b||Array.isArray(a)&&Array.isArray(b)&&a.length===b.length&&a.every((item,index)=>sameFields(item,b[index],mediaVisualFields));
// Chat progress and a completed cover preview do not change the prepared
// timeline. Carry their latest values forward instead of clobbering them or
// rejecting an otherwise current draft.
export function samePreparationDocument(a,b){
 if(a===b)return true;if(!a||!b)return false;
 const keys=Object.keys(a).filter(key=>!carriedFields.has(key)),other=Object.keys(b).filter(key=>!carriedFields.has(key));
 return keys.length===other.length&&keys.every(key=>Object.hasOwn(b,key)&&(key==='media'?sameMedia(a[key],b[key]):a[key]===b[key]));
}
export function carryPreparationMetadata(draft,current){
 const currentMedia=new Map(current.media.map(item=>[item.id,item]));
 const merged=draft.media.map(item=>{const latest=currentMedia.get(item.id);if(!latest||latest===item||latest.path!==item.path||[...mediaVisualFields].every(key=>Object.hasOwn(item,key)===Object.hasOwn(latest,key)&&item[key]===latest[key]))return item;if(sameFields(item,latest,mediaVisualFields))return latest;return {...Object.fromEntries(Object.entries(item).filter(([key])=>!mediaVisualFields.has(key))),...Object.fromEntries(Object.entries(latest).filter(([key])=>mediaVisualFields.has(key)))};});
 const media=merged.length===current.media.length&&merged.every((item,index)=>item===current.media[index])?current.media:merged.every((item,index)=>item===draft.media[index])?draft.media:merged;
 return {...Object.fromEntries(Object.entries(draft).filter(([key])=>!carriedFields.has(key))),media,...Object.fromEntries([...carriedFields].filter(key=>Object.hasOwn(current,key)).map(key=>[key,current[key]]))};
}
// One private document scope for every participant in an explicit save/export.
// Native reads stay on the real editor; only calls carrying the operation grant
// see this draft. Its intermediate reducer results never enter editor history.
export class ExtensionDraft {
 constructor(history,{selection=null,playhead={time_sec:0,playing:false}}={}){Object.assign(this,{base:history,project:history.present,selection,playhead,steps:0,effectRevision:pluginEffectsRevision(),usesEffects:false});this.reader=createEditorContext();this.actions=[];}
 valid(){return !this.usesEffects||this.effectRevision===pluginEffectsRevision();}
 capture(input){const snapshot=this.reader(this.project,this.selection,this.playhead,input);return {snapshot,targets:this.reader.targets(snapshot)};}
 read(method,input,extensionId){
  if(method==='workspace.inspect')return this.reader.inspect(this.project,this.selection,this.playhead,input);
  if(method==='workspace.readValue')return this.reader.readValue(this.project,this.selection,this.playhead,input);
  const {snapshot,targets}=this.capture(method==='editor.read'?input:undefined);
  if(method==='configuration.get')return projectConfiguration(this.project,snapshot.documentId,extensionId,method,input).value;
  if(method==='editor.read')return snapshot;
  if(method==='workspace.read')return {documentId:snapshot.documentId,name:this.project.name,width:this.project.width,height:this.project.height,fps:this.project.fps,duration_sec:projectDuration(this.project),export_duration_sec:exportDuration(renderable(this.project))};
  if(method==='captions.read')return captionRead(this.project,snapshot,targets,input);
  throw Error('Unsupported draft read');
 }
 write(method,input,extensionId){
  if(this.steps>=128)throw Error('Save/export preparation exceeds 128 document edits');
  const {snapshot,targets}=this.capture(method==='editor.apply'?editContextInput(input):undefined);let action,value,verify;
  if(method==='configuration.update'){
   const plan=projectConfiguration(this.project,snapshot.documentId,extensionId,method,input);action=plan.action;value=plan.value;verify=state=>state.present.extensionSettings===action.settings;
  }else if(method==='editor.apply'){
   if(input?.operations?.some(operation=>operation.type?.includes('effect')))this.usesEffects=true;
   const transaction=clipTransaction(input,snapshot,projectDuration(this.project),extensionEditPermissions),plan=preparePluginEdits(this.project,snapshot,targets,transaction,extensionEditPermissions);action=plan.action;value={applied:transaction.operations.length};verify=state=>pluginEditsApplied(state,action);
  }else if(method==='markers.apply'){
   const targets=this.reader.markerTargets(this.project,this.selection,this.playhead,input),plan=markerApply(this.project,this.reader.scope(),input,targets);action=plan.action;value={applied:plan.applied};verify=state=>state.present.markers===action.markers;
  }else if(method==='media.insert'){
   if(input.documentId&&input.documentId!==snapshot.documentId)throw Error('Draft media context is stale');
   const plan=mediaInsertion(this.project,snapshot,input.item,input);action=plan.action;value={mediaId:plan.mediaId,clipId:plan.clipId,lane:plan.lane};verify=state=>state.present[plan.key].some(clip=>clip.id===plan.clipId);
  }else if(method==='captions.write'){
   const plan=captionWrite(this.project,snapshot,input,extensionId,this.reader.scope());action=plan.action;value={written:plan.ids.length,...(plan.trackId?{trackId:plan.trackId}:{})};verify=state=>plan.ids.every(id=>state.present.textClips.some(clip=>clip.id===id))&&(plan.action.ids||[]).every(id=>!state.present.textClips.some(clip=>clip.id===id));
  }else throw Error('Unsupported draft edit');
  if(action){const next=historyReducer({past:[],present:this.project,future:[]},action);if(next.present===this.project||!verify(next))throw Error('Draft edit was refused by the editor');this.project=next.present;this.steps++;this.actions.push(action);}
  return value;
 }
}
