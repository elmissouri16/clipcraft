const crypto=require('node:crypto');
function createTranslationReview(getWindow){
 let pending=null;
 const close=()=>{const item=pending;if(!item)return;pending=null;item.signal?.removeEventListener('abort',item.cancel);try{getWindow()?.webContents.send('plugins:translationReview',{id:item.id,closed:true});}catch{}item.resolve(false);};
 return {
  request(data,signal){
   close();if(signal?.aborted)return Promise.resolve(false);
   return new Promise(resolve=>{
    const id=crypto.randomUUID(),cancel=()=>close();pending={id,resolve,signal,cancel};signal?.addEventListener('abort',cancel,{once:true});
    try{getWindow().webContents.send('plugins:translationReview',{id,...data});}catch{close();}
   });
  },
  answer(request){
   if(!request||Object.keys(request).some(k=>!['id','accept'].includes(k))||typeof request.accept!=='boolean'||!pending||pending.id!==request.id)throw Error('Unknown translation review.');
   const item=pending;pending=null;item.signal?.removeEventListener('abort',item.cancel);item.resolve(request.accept);return {ok:true};
  },
 };
}
module.exports={createTranslationReview};
