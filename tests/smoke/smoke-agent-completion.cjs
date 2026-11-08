// Native callbacks, caption reducer, offscreen preview and cancellation are real.
// Provider reasoning and transcription are fixtures; no paid inference is used.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
module.exports=async(win,app,dir)=>{
  const local=require('../../electron/agents/localAgents.cjs'),whisper=require('../../electron/audio/whisper.cjs');
  const settings=require('../../electron/system/settings.cjs'),ff=require('../../electron/media/ffmpeg.cjs');
  const original={run:local.runEditorNative,status:local.status,transcribe:whisper.transcribe,install:whisper.install,timer:global.setTimeout};
  const result={checks:[],errors:[]},q=code=>win.webContents.executeJavaScript(code);
  const wait=ms=>new Promise(resolve=>original.timer(resolve,ms));
  const until=async(code,attempts=300)=>{for(let i=0;i<attempts;i++){if(await q(code))return;await wait(40);}throw Error('Timeout: '+code);};
  const check=(label,condition)=>{assert.ok(condition,label);result.checks.push(label);};
  const click=selector=>q(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const wav=path.join(dir,'source.wav');
  require('node:child_process').execFileSync(ff.ffmpegPath,['-v','error','-y','-f','lavfi','-i','sine=frequency=440:duration=4',wav]);
  const fixture=id=>({id,name:'Completion regression',ratio:'16:9',width:320,height:180,fps:12,media:[{id:'voice',path:wav,type:'audio',duration:4,hasAudio:true}],
    videoClips:[],audioClips:[{id:'a',mediaId:'voice',in:0,out:4,start:0,speed:1}],textClips:[],overlayClips:[],effectClips:[]});
  let mode='captions',shortClock=false;
  global.setTimeout=(fn,ms,...args)=>original.timer(fn,shortClock&&ms===30*60*1000?800:ms,...args);
  local.status=async()=>({ok:true,authenticated:true,version:'completion-fixture'});
  whisper.install=async()=>{};
  whisper.transcribe=async()=>[
    {start:0,end:2,text:'one two',word_timing:'measured',words:[{text:'one',start:.1,end:.1},{text:'two',start:1,end:1.5}]},
    {start:2,end:4,text:'three four',word_timing:'measured',words:[{text:'three',start:2.2,end:2.8},{text:'four',start:3,end:3.8}]},
  ];
  local.runEditorNative=async(_cfg,options)=>{
    const call=async(name,args={})=>{const data=JSON.parse((await options.onTool(name,args)).content[0].text);if(data.error)throw Error(data.error);return data;};
    if(mode==='idle'||mode==='stop'){
      await call('set_project',{name:'Retained completed work'});
      return new Promise((_resolve,reject)=>options.signal.addEventListener('abort',()=>reject(Object.assign(Error('Aborted'),{name:'AbortError'})),{once:true}));
    }
    if(mode==='cleanup'){
      options.onTool('complete_edit',{}).catch(()=>{});
      throw Error('Fixture provider disconnected during completion');
    }
    if(mode==='limit'){for(let i=0;i<241;i++)await call('get_project');}
    if(mode==='active'){
      for(let i=0;i<4;i++){await wait(450);await call('set_project',{name:'Progress '+i});}
    }else if(mode==='captions'){
      const captions=await call('add_captions',{words_per_caption:6});
      check('caption generation accepts collapsed cached word timestamps',captions.ok);
      const project=await q('window.__fve.rawProject()');
      check('invalid measurements retain cue wording with estimated timing',project.textClips[0].text==='one two'&&project.textClips[0].word_timing==='estimated'&&!project.textClips[0].words);
      check('valid spoken word timing remains measured',project.textClips[1].words[0].start===.2||Math.abs(project.textClips[1].words[0].start-.2)<1e-6);
    }
    let ready=false;
    for(let i=0;i<8&&!ready;i++){
      const verified=await call('complete_edit');ready=verified.ready;
      if(verified.review_required)check('completion reports visual review progress',verified.checked_regions>0&&verified.total_regions>=verified.checked_regions);
    }
    assert.ok(ready);return {text:'Completion verified.'};
  };
  win.webContents.setBackgroundThrottling(false);win.setSize(1440,1000);
  win.webContents.on('console-message',(_event,level,message)=>{if(level>=3)result.errors.push(message);});
  settings.setFirstRun({tourSeen:true,packPromptSeen:true});settings.save({provider:'codex-sdk'});
  try{
    await until('!!window.__fve&&!!document.querySelector(".home-frame-card")');await click('.home-frame-card');await until('!!document.querySelector(".topbar")');await q('document.querySelector(".welcome-go")?.click()');
    const longSession=id=>({id,title:id,messages:Array.from({length:24},(_,i)=>({role:i%2?'assistant':'user',text:`${id} message ${i}. `+'Saved conversation text. '.repeat(16)})),contents:[],draft:''});
    await q(`window.__fve.load(${JSON.stringify({...fixture('scroll-history'),craftAI:{version:1,activeSessionId:'first',sessions:[longSession('first'),longSession('second')]}})})`);
    const atBottom='(()=>{const e=document.querySelector(".pilot-list");return e.scrollHeight>e.clientHeight&&Math.abs(e.scrollHeight-e.clientHeight-e.scrollTop)<2;})()';
    await click('.pilot-fab');await wait(300);
    check('opening saved chat starts at the latest message',await q(atBottom));
    await q('document.querySelector(".pilot-list").scrollTop=0');await click('button[aria-label="Close assistant"]');await click('.pilot-fab');await wait(300);
    check('reopening chat jumps to the latest message without new messages',await q(atBottom));
    await q('document.querySelector(".pilot-list").scrollTop=0');await click('button[aria-label="Chat sessions"]');
    await q('[...document.querySelectorAll(".pilot-session-picker [role=option]")].find(e=>e.textContent==="second").click()');
    await wait(300);check('switching saved chats opens at the latest message',await q(atBottom));
    const send=async next=>{
      mode=next;await q(`window.__fve.load(${JSON.stringify(fixture('completion-'+next))})`);await click('.pilot-fab');
      await q(`(()=>{const e=document.querySelector('.pilot-input textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,'Run completion regression');e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
      await until('!document.querySelector("button[aria-label=Send]").disabled');await click('button[aria-label=Send]');
    };
    const ended='!document.querySelector("button[aria-label=Stop]")&&!!document.querySelector(".pilot-msg.assistant:not(.pending)")';
    await send('captions');await until(ended+'&&document.querySelector(".pilot-msg.assistant .bubble")?.textContent.includes("Completion verified.")');
    check('caption edit reaches completed validation in the actual app',await q('!document.querySelector(".pilot-error")&&window.__fve.history().past.length===1'));
    shortClock=true;await send('active');await until(ended+'&&document.querySelector(".pilot-msg.assistant .bubble")?.textContent.includes("Completion verified.")');
    check('ongoing edits survive beyond the original absolute timeout',await q('window.__fve.rawProject().name==="Progress 3"&&!document.querySelector(".pilot-error")'));
    await send('idle');await until(ended+'&&!!document.querySelector(".pilot-error")');
    check('idle timeout shows its real reason and a Continue action',await q('document.querySelector(".pilot-error").textContent.includes("no tool progress")&&document.querySelector(".pilot-error").textContent.includes("Continue from current timeline")&&window.__fve.rawProject().name==="Retained completed work"'));
    check('timeout diagnostic survives saved chat normalization',await q('window.__fve.rawProject().craftAI.sessions[0].messages.at(-1).error.code==="edit_timeout"'));
    fs.writeFileSync(path.join(dir,'timeout.png'),(await win.capturePage()).toPNG());
    shortClock=false;await send('cleanup');await until(ended+'&&!!document.querySelector(".pilot-error")');
    check('provider cleanup preserves the failure instead of reporting Stop',await q('document.querySelector(".pilot-error").textContent.includes("provider disconnected")&&!document.querySelector(".pilot-msg.assistant .bubble")?.textContent.includes("Stopped.")'));
    await send('limit');await until(ended+'&&!!document.querySelector(".pilot-error")',1000);
    check('tool-call limit is recoverable and never disguised as user Stop',await q('document.querySelector(".pilot-error").textContent.includes("tool-call limit")&&document.querySelector(".pilot-error").textContent.includes("Continue from current timeline")'));
    await send('stop');await until('!!document.querySelector("button[aria-label=Stop]")&&window.__fve.rawProject().name==="Retained completed work"');await click('button[aria-label=Stop]');
    await until(ended+'&&document.querySelector(".pilot-msg.assistant .bubble")?.textContent.includes("Stopped.")');
    check('explicit user Stop still stops the request',await q('!document.querySelector(".pilot-error")&&window.__fve.rawProject().name==="Retained completed work"'));
    check('renderer has no runtime errors',!result.errors.length);
  }catch(error){result.error=error.stack;result.dom=await q('document.body.innerText.slice(-1800)');fs.writeFileSync(path.join(dir,'failure.png'),(await win.capturePage()).toPNG());}
  finally{local.runEditorNative=original.run;local.status=original.status;whisper.transcribe=original.transcribe;whisper.install=original.install;global.setTimeout=original.timer;}
  fs.writeFileSync(path.join(dir,'result.json'),JSON.stringify(result,null,2));app.exit(result.error?1:0);
};
