// Native-provider real app regression. FVE_NATIVE_LIVE=1 uses the installed,
// signed-in providers; otherwise a native Codex protocol fixture is used.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
module.exports=async(win,app,dir)=>{
 fs.mkdirSync(dir,{recursive:true});
 const local=require("../../electron/agents/localAgents.cjs"),settings=require("../../electron/system/settings.cjs");
 const live=process.env.FVE_NATIVE_LIVE==='1';
 let voiceStarted=false,voiceAborted=false;
 const tts=require("../../electron/audio/geminiTts.cjs"),originalSpeak=tts.speak;
 const originalStatus=local.status,originalRun=local.runEditorNative;
 const result={live,checks:[],errors:[]},q=code=>win.webContents.executeJavaScript(code),wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
 const check=(name,value)=>{assert.ok(value,name);result.checks.push(name);};
 const until=async(code,ms=180000)=>{const end=Date.now()+ms;while(Date.now()<end){if(await q(code))return;await wait(100);}throw new Error('Timeout: '+code);};
 const click=selector=>q(`document.querySelector(${JSON.stringify(selector)}).click()`);
 const send=async text=>{await q(`(()=>{const el=document.querySelector('.pilot-input textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(el,${JSON.stringify(text)});el.dispatchEvent(new Event('input',{bubbles:true}));})()`);await until('!!document.querySelector("button[aria-label=Send]")&&!document.querySelector("button[aria-label=Send]").disabled');await click('button[aria-label=Send]');await until('!!document.querySelector("button[aria-label=Stop]")');await until('!document.querySelector("button[aria-label=Stop]")');};
 settings.setFirstRun({tourSeen:true,packPromptSeen:true});
 win.webContents.setBackgroundThrottling(false);win.webContents.on('console-message',(_event,level,message)=>{if(level>=3)result.errors.push(message);});
 if(!live){
  tts.speak=async(_fetch,_key,_dir,{signal})=>{voiceStarted=true;return new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>{voiceAborted=true;reject(new Error('Stopped'));},{once:true}));};
  local.status=async()=>({ok:true,authenticated:true,version:'native-fixture'});
  const {createNativeAgents}=require("../../electron/agents/nativeAgents.cjs");
  const runtime=createNativeAgents({loadSdk:provider=>import(provider==='codex-sdk'?'@openai/codex-sdk':'@anthropic-ai/claude-agent-sdk'),resolveExecutable:()=>path.join(__dirname,"../fixtures/codex-native-stub.cjs"),childEnv:()=>({...process.env,PATH:local.searchDirectories().join(path.delimiter)})});
  local.runEditorNative=runtime.run;
  local.closeNativeSessions=runtime.close;
 }
 try{
  await until('!!window.__fve&&!!document.querySelector(".home-frame-card")');await click('.home-frame-card');await until('!!document.querySelector(".topbar")');await q('document.querySelector(".welcome-go")?.click()');
  const providers=live?['codex-sdk','claude-agent-sdk']:['codex-sdk'];
  for(const provider of providers){
   settings.save({provider,model:''});
   const p={id:require('node:crypto').randomUUID(),name:'Native verification',ratio:'16:9',width:320,height:180,fps:30,background:'#194329',media:[],videoClips:[{id:'gap',gap:true,in:0,out:10,speed:1}],overlayClips:[],audioClips:[],textClips:[],effectClips:[]};
   await q(`window.__fve.load(${JSON.stringify(p)})`);await until('!!document.querySelector(".pilot-fab")');await click('.pilot-fab');await until('!!document.querySelector(".pilot-input textarea")');
   await send('Add exactly one text title reading NATIVE CHECK at timeline second 8 for 1 second. Keep every other project setting unchanged. Use only the editor tools, and complete_edit until ready is true before finishing. Do not generate or download media or do web research.');
   const after=await q('window.__fve.rawProject()');
   check(`${provider}: native editor tools add the requested title`,after.textClips.some(c=>c.text==='NATIVE CHECK'&&c.start===8));
   check(`${provider}: native task finishes without an error`,await q('!document.querySelector(".pilot-error")'));
   check(`${provider}: editor maintains one Undo step`,await q('window.__fve.history().past.length===1&&!!document.querySelector(".pilot-undo")'));
   check(`${provider}: saved history contains no transported image bytes`,!JSON.stringify(after.craftAI).includes('inlineData')&&!JSON.stringify(after.craftAI).includes(';base64,'));
   await send('Read the current project, confirm the NATIVE CHECK title is still there, and make no changes. Call complete_edit until ready is true, then reply briefly. Do not generate media or use web research.');
   check(`${provider}: the second request reuses the conversation and preserves the title`,await q('window.__fve.rawProject().textClips.filter(c=>c.text==="NATIVE CHECK").length===1&&!document.querySelector(".pilot-error")'));
   if(!live){
    const stopped=send('CANCEL_NATIVE: generate the requested voice.');
    for(let i=0;i<100&&!voiceStarted;i++)await wait(50);
    check('native task reaches the cancellable voice job',voiceStarted);
    await click('button[aria-label=Stop]');await stopped;
    check('native cancellation aborts child speech and applies no late media',voiceAborted&&await q('window.__fve.rawProject().audioClips.length===0'));
   }
   await q('window.__fve.seek(8.5)');await wait(150);fs.writeFileSync(path.join(dir,`${provider}.png`),(await win.capturePage()).toPNG());
  }
 }catch(error){result.failure=error.stack;try{fs.writeFileSync(path.join(dir,'failure.png'),(await win.capturePage()).toPNG());result.dom=await q('document.body.innerText.slice(-2400)');}catch{}}
 finally{tts.speak=originalSpeak;local.status=originalStatus;local.runEditorNative=originalRun;local.closeNativeSessions();}
 fs.writeFileSync(path.join(dir,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));app.exit(result.failure?1:0);
};
