const path=require('node:path');
// A trusted preview renderer, separate from executable plugin renderers.
function createGifFrames({ipcMain,BrowserWindow,manager}){
 const jobs=new Map();
 const owned=event=>{const job=jobs.get(event.sender.id);if(!job||event.sender!==job.window.webContents||event.senderFrame!==job.window.webContents.mainFrame)throw Error('Unknown GIF renderer.');return job;};
 ipcMain.handle('pluginGif:frameJob',async event=>{
  const job=owned(event);if(job.taken)throw Error('GIF frame job already taken.');job.taken=true;
  await manager.ready;
  return {...job.plan,project:job.project,time_sec:job.plan.start_sec,sequence:1,gifExport:true,pluginEffects:await manager.effects(),pluginTransitions:await manager.transitions()};
 });
 ipcMain.handle('pluginGif:frameReady',(event,error,sequence)=>{
  const job=owned(event);
  if(sequence!==job.sequence&&!(sequence===undefined&&error))return false;
  if(error)job.pending?.reject(Error(String(error).slice(0,1000)));else job.pending?.resolve();return true;
 });
 return ({project,plan,signal})=>{
  const window=new BrowserWindow({width:plan.width,height:plan.height,useContentSize:true,show:false,frame:false,webPreferences:{preload:path.join(__dirname,'gifFramePreload.cjs'),sandbox:true,contextIsolation:true,nodeIntegration:false,webSecurity:!process.env.VITE_DEV_SERVER_URL,offscreen:{deviceScaleFactor:1},backgroundThrottling:false}});
  const senderId=window.webContents.id,job={window,project,plan,sequence:0};jobs.set(senderId,job);
  window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  for(const event of ['will-navigate','will-frame-navigate','will-attach-webview'])window.webContents.on(event,e=>e.preventDefault());
  const failed=()=>job.pending?.reject(Error('The GIF renderer stopped.'));
  window.webContents.on('render-process-gone',failed);window.on('closed',failed);
  const abort=()=>{job.pending?.reject(Object.assign(Error('GIF export canceled.'),{name:'AbortError'}));if(!window.isDestroyed())window.destroy();};
  signal.addEventListener('abort',abort,{once:true});
  return {
   async frame(index){
    if(signal.aborted)throw Object.assign(Error('GIF export canceled.'),{name:'AbortError'});
    job.sequence=index+1;
    let timer;
    try{
     await new Promise((resolve,reject)=>{
      job.pending={resolve,reject};timer=setTimeout(()=>reject(Error('Timed out rendering a GIF frame.')),25000);
      if(index===0){const loading=process.env.VITE_DEV_SERVER_URL?window.loadURL(process.env.VITE_DEV_SERVER_URL):window.loadFile(path.join(__dirname,'../../dist/index.html'));loading.catch(reject);}
      else window.webContents.send('pluginGif:frame',{time_sec:plan.start_sec+index/plan.fps,sequence:job.sequence});
     });
     if(signal.aborted)throw Error('GIF export canceled.');
     let picture=await window.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true});
     if(picture.isEmpty())throw Error('The GIF renderer returned an empty frame.');
     const size=picture.getSize();if(size.width!==plan.width||size.height!==plan.height)picture=picture.resize({width:plan.width,height:plan.height,quality:'best'});
     return picture.toPNG();
    }finally{clearTimeout(timer);job.pending=null;}
   },
   close(){signal.removeEventListener('abort',abort);jobs.delete(senderId);if(!window.isDestroyed())window.destroy();},
  };
 };
}
module.exports={createGifFrames};
