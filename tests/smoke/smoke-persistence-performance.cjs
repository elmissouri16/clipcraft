const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
module.exports=async(win,app,dir)=>{
 fs.mkdirSync(dir,{recursive:true});win.webContents.setBackgroundThrottling(false);
 const q=code=>win.webContents.executeJavaScript(code),wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
 const until=async(test,timeout=20000)=>{const end=Date.now()+timeout;while(Date.now()<end){if(await test())return;await wait(50);}throw Error('Persistence check timed out.');};
 const result={checks:[],errors:[]},check=(name,value)=>{assert.ok(value,name);result.checks.push(name);};
 win.webContents.on('console-message',(_e,level,message)=>{if(level>=3)result.errors.push(message);});
 const file=path.join(dir,'saved.clipcraft.json');require('electron').dialog.showSaveDialog=async()=>({canceled:false,filePath:file});
 try{
  await until(()=>q('!!window.__fve&&!!document.querySelector(".home-frame-card")'));await q('document.querySelector(".home-frame-card").click()');await until(()=>q('!!document.querySelector(".topbar")'));
  if(!process.env.VITE_DEV_SERVER_URL) {
   const assets=path.join(__dirname,'../../dist/assets'),name=fs.readdirSync(assets).find(name=>/^projectSerializer\.worker-.*\.js$/.test(name));
   assert.ok(name,'compiled serializer worker exists');
   const url=require('node:url').pathToFileURL(path.join(assets,name)).href;
   const proof=await q(`new Promise((resolve,reject)=>{const worker=new Worker(${JSON.stringify(url)},{type:'module'});const timer=setTimeout(()=>{worker.terminate();reject(new Error('Compiled worker timed out'));},5000);worker.onmessage=event=>{clearTimeout(timer);worker.terminate();resolve(event.data);};worker.onerror=event=>{clearTimeout(timer);worker.terminate();reject(new Error(event.message));};worker.postMessage({id:7,project:{name:'Compiled worker',media:[]}});})`);
   check('compiled module worker executes with normal file-origin security',proof.id===7&&JSON.parse(proof.value.compact).name==='Compiled worker');
  }
  const project={id:'persistence-smoke',name:'Worker save "quoted"\nproject',ratio:'16:9',width:640,height:360,fps:30,background:'#000000',media:[],videoClips:[{id:'gap',gap:true,in:0,out:1200,speed:1}],overlayClips:[],audioClips:[],effectClips:[],textClips:Array.from({length:1200},(_,i)=>({id:'caption'+i,text:'Caption '+i,start:i,duration:.8,layer:0}))};
  await q('window.__fve.load('+JSON.stringify(project)+')');
  await until(()=>q('JSON.parse(localStorage.getItem("clipcraft.recovery")||"null")?.project?.id==="persistence-smoke"'));
  check('worker recovery serialization preserves Unicode, quotes, newlines and complete project data',await q('(()=>{const s=JSON.parse(localStorage.getItem("clipcraft.recovery"));return s.project.name===window.__fve.rawProject().name&&s.project.textClips.length===1200&&s.unsaved===true;})()'));
  await until(()=>q('window.api.slotRead("persistence-smoke").then(s=>s?.project?.textClips.length===1200)'));
  check('autosave slot is durable before reporting completion',true);
  await q('[...document.querySelectorAll(".topbar button")].find(button=>button.textContent.trim()==="Save").click()');
  await until(()=>fs.existsSync(file)&&q('/Saved/.test(document.querySelector(".save-state")?.textContent||"")'));
  const saved=JSON.parse(fs.readFileSync(file,'utf8'));check('manual Save waits for the full atomic worker write',saved.name===project.name&&saved.textClips.length===1200&&!fs.existsSync(file+'.part'));
  const {ProjectPersistence}=require('../../electron/project/persistence.cjs'),originalWrite=ProjectPersistence.prototype.writeProject;
  let waiting=false,release;
  ProjectPersistence.prototype.writeProject=async function(...args){if(!waiting){waiting=true;await new Promise(resolve=>release=resolve);}return originalWrite.apply(this,args);};
  try{
   await q('window.__fve.dispatch({type:"setProject",patch:{name:"Snapshot being saved"}})');await wait(60);
   await q('[...document.querySelectorAll(".topbar button")].find(button=>button.textContent.trim()==="Save").click()');
   await until(()=>waiting);
   await q('window.__fve.dispatch({type:"setProject",patch:{name:"Edited during Save"}})');await wait(60);release();
   await until(()=>JSON.parse(fs.readFileSync(file,'utf8')).name==='Edited during Save');
   check('edits made during a pending Save remain scheduled and reach disk',true);
  }finally{release?.();ProjectPersistence.prototype.writeProject=originalWrite;}
  await q('window.__fve.dispatch({type:"setProject",patch:{name:"Automatically saved"}})');
  await until(()=>JSON.parse(fs.readFileSync(file,'utf8')).name==='Automatically saved');
  check('file autosave updates the chosen project',true);
  await q('window.__fve.dispatch({type:"setProject",patch:{name:"Written on close"}})');await wait(50);
  const closed=new Promise(resolve=>win.once('closed',resolve));win.close();await closed;
  const latest=JSON.parse(fs.readFileSync(file,'utf8'));check('closing flushes the latest file before the window exits',latest.name==='Written on close'&&latest.textClips.length===1200);
  const slots=require('../../electron/project/autosave.cjs'),slot=slots.readSlot(path.join(dir,'autosave-test'),'persistence-smoke');
  check('closing flushes the matching project slot',slot.project.name==='Written on close'&&slot.project.textClips.length===1200);
  check('no renderer exceptions',result.errors.length===0);result.ok=true;
 }catch(error){result.ok=false;result.error=error.stack;if(!win.isDestroyed())fs.writeFileSync(path.join(dir,'failure.png'),(await win.capturePage()).toPNG());}
 fs.writeFileSync(path.join(dir,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({...result,dir}));app.exit(result.ok?0:1);
};
