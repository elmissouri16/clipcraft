const crypto=require('node:crypto');
const {SCHEME}=require('./extensionViewProtocol.cjs');

// Slots are exclusive to a live view. A released slot may be reserved while its
// renderer/storage cleanup runs, but its session is not returned before success.
class ExtensionViewSessions{
 constructor(session,{limit=16,cleanupMs=15000}={}){
  if(!Number.isInteger(limit)||limit<1||limit>16||!Number.isFinite(cleanupMs)||cleanupMs<=0)throw Error('Invalid view session limits');
  Object.assign(this,{session,limit,cleanupMs});this.slots=[];
 }
 async acquire(){
  let slot=this.slots.find(row=>!row.leased&&!row.failed&&!row.cleaning)||this.slots.find(row=>!row.leased&&!row.failed);
  if(!slot){
   if(this.slots.length>=this.limit)throw Error(this.slots.every(row=>row.failed)?'Private view session cleanup failed. Restart ClipCraft to recover.':'Close an extension view before opening another');
   slot={session:this.session.fromPartition('extension-view-'+crypto.randomUUID(),{cache:false}),leased:false,cleaning:false,failed:null,ready:Promise.resolve()};this.slots.push(slot);
  }
  const token=Symbol();slot.leased=true;slot.token=token;
  try{await slot.ready;if(slot.failed)throw Error('Private view session cleanup failed. Restart ClipCraft to recover.');}
  catch(error){if(slot.token===token)slot.leased=false;throw error;}
  let released=false,releaseResult;
  return {session:slot.session,release:shutdown=>{
   if(released)return releaseResult;released=true;
   if(slot.token!==token)return Promise.resolve();
   slot.leased=false;slot.cleaning=true;
   let timer;const work=Promise.resolve(shutdown).then(async()=>{
    const ses=slot.session;
    if(await ses.protocol.isProtocolHandled(SCHEME))throw Error('Closed view protocol is still registered');
    await ses.closeAllConnections();await ses.clearStorageData();await ses.clearData();
    await ses.clearCache();await ses.clearAuthCache();await ses.clearCodeCaches({urls:[]});
   });
   const deadline=new Promise((_resolve,reject)=>{timer=setTimeout(()=>reject(Error('Private view session cleanup timed out')),this.cleanupMs);});
   releaseResult=slot.ready=Promise.race([work,deadline]).catch(error=>{slot.failed=error;}).finally(()=>{clearTimeout(timer);slot.cleaning=false;});return releaseResult;
  }};
 }
 snapshot(){return {created:this.slots.length,leased:this.slots.filter(row=>row.leased).length,cleaning:this.slots.filter(row=>row.cleaning).length,failed:this.slots.filter(row=>row.failed).length};}
 settle(){return Promise.all(this.slots.map(row=>row.ready));}
}
module.exports={ExtensionViewSessions};
