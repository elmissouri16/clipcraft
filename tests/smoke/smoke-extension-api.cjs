// FVE_SMOKE_MODE=extension-api: installs the API probe fixture (tests/fixtures/extensions/api-probe),
// runs its commands in the real editor and records what every public call returned, together with
// the editor's own state. The launcher (tests/unit/plugins/test-extension-api-ui.cjs) asserts on it.
const fs=require('node:fs'),path=require('node:path');
module.exports=async(win,app,dir)=>{
 const {dialog}=require('electron'),fixture=JSON.parse(fs.readFileSync(path.join(dir,'fixtures.json'))),result={ok:false,runs:{},errors:[]};
 const original={open:dialog.showOpenDialog,message:dialog.showMessageBox,save:dialog.showSaveDialog,sync:dialog.showMessageBoxSync};
 const q=source=>win.webContents.executeJavaScript('(async()=>('+source+'))()'),wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
 const until=async(predicate,ms=30000)=>{for(const end=Date.now()+ms;Date.now()<end;await wait(50)){const value=await q(predicate);if(value)return value;}throw Error('Timed out: '+predicate);};
 const save=()=>fs.writeFileSync(path.join(dir,'result.json'),JSON.stringify(result,null,2));
 const history=()=>q('window.__fve.history().past.length');
 const run=async(label,name,input={})=>{const value=await q(`window.api.pluginsExtensionExecute(${JSON.stringify(fixture.id+'.'+name)},${JSON.stringify(input)}).then(value=>({value}),error=>({error:error.message}))`);result.runs[label]={...value,history:await history()};save();return value;};
 const running=`(await window.api.pluginsExtensionStatus()).some(row=>row.id===${JSON.stringify(fixture.id)}&&row.state==="running")`;
 let pick=true;
 dialog.showOpenDialog=async()=>pick?{canceled:false,filePaths:[fixture.archive]}:{canceled:true,filePaths:[]};dialog.showMessageBox=async()=>({response:1});dialog.showMessageBoxSync=()=>0;dialog.showSaveDialog=async()=>({canceled:true});
 win.webContents.setBackgroundThrottling(false);win.webContents.on('console-message',(event,legacyLevel,legacyMessage)=>{if((event?.level??legacyLevel)==='error'||legacyLevel>=3)result.errors.push(event?.message??legacyMessage);});
 try{
  await until('!!window.__fve&&!!document.querySelector(".home-frame-card")');await q('document.querySelector(".home-frame-card").click()');await until('!!document.querySelector(".topbar")');await q('document.querySelector(".welcome-go")?.click()');
  await q(`window.__fve.load(${JSON.stringify(fixture.project)})`);await wait(800);
  const installed=await q('window.api.pluginsInstall()');await q(`window.api.pluginsExtensionTrust(${JSON.stringify(installed[0].key)})`);await until(running);

  await run('basics','basics');
  await run('edits','edits');

  // The playhead and the selection move between capturing a snapshot and applying an edit with it.
  await run('capture','capture');
  await q(`(window.__fve.seek(2),window.__fve.select({track:'video',id:${JSON.stringify(fixture.project.videoClips[0].id)}}),true)`);await wait(400);
  await run('applyCaptured','apply-captured');

  await run('media','media',{dir});
  await run('export','export',{dir});
  await run('view','view');result.viewStatus=await q('window.api.pluginsExtensionStatus()');

  await run('toolsList','tools-list');
  result.toolsBefore=await history();
  await run('toolsBatch','tools-run',{calls:[{name:'get_project'},{name:'add_text',args:{text:'From an extension',start_sec:2.5,duration_sec:1}},{name:'set_filter',args:{clip_id:fixture.project.videoClips[0].id,filter_id:'bw'}},{name:'set_project',args:{background:'#102030'}}]});
  result.afterBatch=await q(`(()=>{const p=window.__fve.rawProject();return {texts:p.textClips.map(c=>c.text),filter:p.videoClips[0].filter,background:p.background};})()`);
  await run('toolsRolledBack','tools-run',{calls:[{name:'add_text',args:{text:'Rolled back',start_sec:3.2,duration_sec:0.5}},{name:'set_filter',args:{clip_id:'missing-clip',filter_id:'bw'}}]});
  result.afterRollback=await q(`({texts:window.__fve.rawProject().textClips.map(c=>c.text),future:window.__fve.history().future.length})`);
  await run('toolsPartial','tools-run',{atomic:false,calls:[{name:'set_filter',args:{clip_id:'missing-clip',filter_id:'bw'}},{name:'add_text',args:{text:'Kept',start_sec:3.2,duration_sec:0.5}}]});
  await run('toolsRefused','tools-run',{calls:[{name:'run_plugin_command',args:{}}]});
  await run('toolsInvalid','tools-run',{calls:[{name:'add_text',args:{start_sec:1}}]});
  await q('window.__fve.dispatch({type:"undo"})');await q('window.__fve.dispatch({type:"undo"})');
  result.afterUndo=await q(`(()=>{const p=window.__fve.rawProject();return {texts:p.textClips.map(c=>c.text),filter:p.videoClips[0].filter,background:p.background,history:window.__fve.history().past.length};})()`);

  await run('seen','seen');
  // A plugin-management action (here: Install, then cancel the picker) stops every extension.
  // The ones that were running must come back, with their registrations.
  pick=false;result.canceledInstall=await q('window.api.pluginsInstall().then(value=>value,error=>({error:error.message}))');
  await until(running);
  result.afterCatalogChange={toolbar:(await q(`window.api.pluginsExtensionUi('toolbar')`)).filter(entry=>entry.location==='toolbar').map(entry=>entry.id),hello:await run('helloAfterCatalogChange','hello')};

  result.ui={};for(const location of ['toolbar','inspector','context','export','settings.plugins'])result.ui[location]=(await q(`window.api.pluginsExtensionUi(${JSON.stringify(location)})`)).filter(entry=>entry.kind==='action'&&entry.location===location).map(entry=>entry.id);
  result.status=await q('window.api.pluginsExtensionStatus()');
  fs.writeFileSync(path.join(dir,'editor.png'),(await win.webContents.capturePage({},{stayHidden:true,stayAwake:true})).toPNG());
  result.ok=true;
 }catch(error){result.error=error.stack;}
 finally{Object.assign(dialog,{showOpenDialog:original.open,showMessageBox:original.message,showSaveDialog:original.save,showMessageBoxSync:original.sync});save();app.exit(result.ok?0:1);}
};
