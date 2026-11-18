import {samePreparationDocument} from './extensionDraft.js';
// Only the renderer's agent context creates these sessions. Extension-authored
// data cannot choose an agentToken or supply a reducer action/publisher.
export class ExtensionAgentSession{
 constructor({agentToken,isCanceled,commit,getHistory,hasProject,epoch,isBusy}){Object.assign(this,{agentToken,isCanceled,commitValidated:commit,getHistory,hasProject,epoch,isBusy});this.project=getHistory().present;this.receipts=[];this.writes=0;}
 check(){const state=this.getHistory();if(this.isCanceled()||!this.hasProject()||state.agentEdit?.token!==this.agentToken||state.gestureStart||this.isBusy()||!samePreparationDocument(this.project,state.present))throw Error('CraftAI no longer owns this extension command edit');return state;}
 commit(action,next,publish){this.check();if(this.writes>=128)throw Error('Extension command exceeds 128 document edits');this.commitValidated(action,next,publish);this.project=this.getHistory().present;this.writes++;}
 receipt(method,value,extensionId){if(this.receipts.length<128)this.receipts.push({method,extensionId,...value});}
}
