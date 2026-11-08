// Real renderer/main-process regression for loop safety. FVE_SMOKE_MODE=agent-loop.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
module.exports=async(win,app,dir)=>{
 const root=path.join(__dirname,"../.."),ai=require("../../electron/agents/ai.cjs"),tts=require("../../electron/audio/geminiTts.cjs");
 const originalStep=ai.agentStep,originalSpeak=tts.speak;
 let plan=[],calls=[],imageBytes,voiceStarted=false,voiceAborted=false;
 const reply=(toolCalls=[],text='Done.')=>({calls:toolCalls,text:toolCalls.length?'':text,content:{role:'model',parts:toolCalls.length?toolCalls.map(functionCall=>({functionCall})):[{text}]}});
 ai.agentStep=async(_cfg,req)=>{calls.push(req);const step=plan.shift();return typeof step==='function'?step(req):step||reply();};
 tts.speak=async(_fetch,_key,_dir,{signal})=>{voiceStarted=true;return new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>{voiceAborted=true;reject(new Error('Stopped'));},{once:true}));};
 fs.mkdirSync(dir,{recursive:true});const q=js=>win.webContents.executeJavaScript(js),wait=ms=>new Promise(r=>setTimeout(r,ms));
 const until=async(js,ms=30000)=>{const end=Date.now()+ms;while(Date.now()<end){if(await q(js))return;await wait(60);}throw Error('Timeout: '+js);};
 const click=selector=>q(`document.querySelector(${JSON.stringify(selector)}).click()`);
 const result={checks:[],errors:[]},check=(name,value)=>{assert.ok(value,name);result.checks.push(name);};
 const capture=async name=>fs.writeFileSync(path.join(dir,name+'.png'),(await win.capturePage()).toPNG());
 require(root+'/electron/system/settings.cjs').setFirstRun({tourSeen:true,packPromptSeen:true});require(root+'/electron/system/settings.cjs').save({provider:'ollama'});
 require(root+'/electron/system/settings.cjs').setMcpServers([{name:'Loop Test',command:process.env.FVE_SMOKE_NODE||'node',args:[path.join(root,"./tests/fixtures/mcp-loop-stub.cjs"),dir]}]);
 win.webContents.setBackgroundThrottling(false);win.webContents.on('console-message',(_e,level,message)=>{if(level>=3)result.errors.push(message);});
 const base=()=>({id:require('node:crypto').randomUUID(),name:'Loop verification',ratio:'16:9',width:320,height:180,fps:10,media:[{id:'m',type:'image',name:'Frame',path:path.join(dir,'green.png'),width:320,height:180}],videoClips:[{id:'v',mediaId:'m',in:0,out:10,speed:1}],overlayClips:[],audioClips:[],textClips:[],effectClips:[]});
 const load=async()=>{await q(`window.__fve.load(${JSON.stringify(base())})`);await until('!!document.querySelector(".pilot-fab")');await click('.pilot-fab');await until('!!document.querySelector(".pilot-input textarea")');};
 const send=async steps=>{plan=steps;calls=[];await q(`(()=>{const el=document.querySelector('.pilot-input textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(el,'Verify the requested edit.');el.dispatchEvent(new Event('input',{bubbles:true}));})()`);await until('!document.querySelector("button[aria-label=Send]").disabled');await click('button[aria-label=Send]');};
 const done=()=>until('!document.querySelector("button[aria-label=Stop]")');
 try{
  require('node:child_process').execFileSync(require(root+'/electron/media/ffmpeg.cjs').ffmpegPath,['-v','error','-y','-f','lavfi','-i','color=green:s=320x180','-frames:v','1',path.join(dir,'green.png')]);imageBytes=fs.readFileSync(path.join(dir,'green.png')).toString('base64');
  await until('!!window.__fve&&!!document.querySelector(".home-frame-card")');await click('.home-frame-card');await until('!!document.querySelector(".topbar")');await q('document.querySelector(".welcome-go")?.click()');
  await load();await send([reply([{name:'load_tools',args:{groups:['text','media']}}]),reply([{name:'add_text',args:{text:'LATE TITLE',start_sec:8,duration_sec:1}}]),reply([{name:'inspect_frames',args:{times_sec:[0]}}]),reply(),req=>{check('verification presents the edited title interval to the model',req.images.some(image=>/timeline 8\./.test(image.label)));return reply();}]);await done();
  check('late-title verification completes in the actual renderer',await q('!!window.__fve.rawProject().textClips.find(c=>c.text==="LATE TITLE")&&!document.querySelector(".pilot-error")'));
  await q('window.__fve.seek(8.5)');await wait(200);await capture('late-title-verified');
  check('request exposes one-click Undo after editing',await q('!!document.querySelector(".pilot-undo")'));await click('.pilot-undo');await until('!window.__fve.rawProject().textClips.length');
  await load();await send([reply([{name:'set_project',args:{name:'Partial edit retained'}}]),()=>{throw Error('Injected provider failure');}]);await done();
  check('partial failure preserves chat Undo',await q('window.__fve.rawProject().name==="Partial edit retained"&&!!document.querySelector(".pilot-undo")'));
  check('failure persists recovery outcomes without unfinished call pairs',await q('JSON.stringify(window.__fve.rawProject().craftAI).includes("Host recovery checkpoint")'));
  await load();await send([reply([{name:'load_tools',args:{groups:['audio']}}]),reply([{name:'add_voiceover',args:{text:'Never insert after Stop',engine:'gemini'}}])]);
  for(let i=0;i<100&&!voiceStarted;i++)await wait(30);check('voice request starts under the agent owner',voiceStarted);await click('button[aria-label=Stop]');await done();check('Stop aborts synthesis and leaves timeline audio unchanged',voiceAborted&&await q('window.__fve.rawProject().audioClips.length===0'));
  await load();await send([reply([{name:'load_tools',args:{groups:['external']}}]),reply([{name:'mcp_loop-test_image',args:{}}]),req=>{check('MCP image reaches the configured model as a real image attachment',req.images.length===1&&fs.existsSync(req.images[0].path));const tool=req.contents.at(-1).parts[0].functionResponse.response.result;check('MCP structured data survives the main-process bridge',tool.structuredContent.clip_id==='v');return reply();}]);await done();
  check('saved MCP conversation contains frame handles without base64',await q('!JSON.stringify(window.__fve.rawProject().craftAI).includes("'+imageBytes.slice(0,60)+'")'));
  await load();await send([reply([{name:'load_tools',args:{groups:['external']}}]),reply([{name:'mcp_loop-test_wait',args:{}}])]);for(let i=0;i<100&&!fs.existsSync(path.join(dir,'mcp-started.json'));i++)await wait(30);check('MCP request starts under the agent owner',fs.existsSync(path.join(dir,'mcp-started.json')));await click('button[aria-label=Stop]');await done();for(let i=0;i<100&&!fs.existsSync(path.join(dir,'mcp-canceled.json'));i++)await wait(30);check('Stop sends cancellation to the actual MCP server',fs.existsSync(path.join(dir,'mcp-canceled.json'))&&JSON.parse(fs.readFileSync(path.join(dir,'mcp-canceled.json'))).requestId===JSON.parse(fs.readFileSync(path.join(dir,'mcp-started.json'))).id);
 }catch(error){result.failure=error.stack;try{await capture('failure');result.dom=await q('document.body.innerText.slice(-1800)');}catch{}}
 ai.agentStep=originalStep;tts.speak=originalSpeak;
 fs.writeFileSync(path.join(dir,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));app.exit(result.failure?1:0);

};
