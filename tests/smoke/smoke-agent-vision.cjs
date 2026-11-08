const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
module.exports=async(win,app,dir)=>{
  fs.mkdirSync(dir,{recursive:true});
  const live=process.env.FVE_CODEX_VISION_LIVE==='1';
  const ff=require("../../electron/media/ffmpeg.cjs"),ai=require("../../electron/agents/ai.cjs"),settings=require("../../electron/system/settings.cjs");
  const original=ai.agentStep;
  const result={live,checks:[],errors:[]};
  const check=(name,ok)=>{assert.ok(ok,name);result.checks.push(name);};
  const q=js=>win.webContents.executeJavaScript(js),wait=ms=>new Promise(r=>setTimeout(r,ms));
  const until=async(js,ms=30000)=>{const end=Date.now()+ms;while(Date.now()<end){if(await q(js))return;await wait(80);}throw new Error(`Timed out: ${js}`);};
  const click=s=>q(`document.querySelector(${JSON.stringify(s)}).click()`);
  const draft=text=>q(`(()=>{const el=document.querySelector('.pilot-input textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(el,${JSON.stringify(text)});el.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  const movie=path.join(dir,'colors.mp4');
  execFileSync(ff.ffmpegPath,['-y','-v','error','-f','lavfi','-i','color=blue:s=640x360:r=10:d=2','-f','lavfi','-i','color=red:s=640x360:r=10:d=2',
    '-filter_complex','[0:v][1:v]concat=n=2:v=1:a=0[out]','-map','[out]','-pix_fmt','yuv420p',movie]);
  const green=path.join(dir,'green.png');
  execFileSync(ff.ffmpegPath,['-y','-v','error','-f','lavfi','-i','color=0x00ff00:s=100x100','-frames:v','1',green]);
  settings.setFirstRun({tourSeen:true,packPromptSeen:true});settings.save({provider:'codex-sdk',model:'gpt-6.1-sol'});
  win.webContents.setBackgroundThrottling(false);
  win.webContents.on('console-message',(_e,level,text)=>{if(level>=3)result.errors.push(text);});
  let phase=0,cancel=false,created=false;
  ai.agentStep=async(cfg,req)=>{
    const reply=(calls,text='')=>({calls,text,content:{role:'model',parts:[...calls.map(functionCall=>({functionCall})),...(text?[{text}]:[])]}});
    if(cancel){if(phase++===0)return reply([{name:'load_tools',args:{groups:['media']}}]);return reply([{name:'inspect_frames',args:{times_sec:[0.25]}}]);}
    if(phase++===0)return reply([{name:'load_tools',args:{groups:['media']}}]);
    if(phase===2)return reply([{name:'inspect_frames',args:{times_sec:[0.25,1.75]}}]);
    if(phase===3)return reply([{name:'inspect_frames',args:{source:'clip',clip_id:'main',times_sec:[0.25,1.75]}}]);
    check('actual frame files reach the next Codex turn',req.images?.length===4&&req.images.every(image=>fs.existsSync(image.path)));
    result.images=[];
    req.images.forEach((image,index)=>{const file=path.join(dir,`seen-${index}.jpg`);fs.copyFileSync(image.path,file);result.images.push({file,label:image.label});});
    const bytes=index=>execFileSync(ff.ffmpegPath,['-v','error','-i',result.images[index].file,'-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','-'],{maxBuffer:6*1024*1024});
    const rawBlue=bytes(0),rawRed=bytes(1),composition=bytes(2),later=bytes(3);
    check('source inspection maps trimmed timeline moments to the correct decoded frames',rawBlue[2]>180&&rawBlue[0]<50&&rawRed[0]>180&&rawRed[2]<50);
    const corner=(5*360+5)*3;
    check('composed captures seek to the requested video moments',composition[corner+2]>180&&composition[corner]<50&&later[corner]>180&&later[corner+2]<50);
    let greenPixels=0,whitePixels=0;
    for(let i=0;i<composition.length;i+=3){if(composition[i+1]>180&&composition[i]<60&&composition[i+2]<60)greenPixels++;if(composition[i]>210&&composition[i+1]>210&&composition[i+2]>210)whitePixels++;}
    check('composed captures include overlay pixels and rendered title text',greenPixels>1000&&whitePixels>100);
    const native=live?await original(cfg,{...req,tools:[],system:req.system+'\nFor this visual test, return no tool calls. Describe the colors in the source frames and composed frames and quote the visible title. Read the actual images; do not infer from filenames or tool metadata.'}):reply([],'The source changes from blue to red. The composition has a green square and the title FRAME CHECK.');
    result.answer=native.text;
    if(live)check('live Codex recognizes image content and reads the rendered title',/blue/i.test(native.text)&&/red/i.test(native.text)&&/green/i.test(native.text)&&/FRAME\s+CHECK/i.test(native.text));
    return native;
  };
  try{
    await until('!!window.__fve&&!!document.querySelector(".home-frame-card")');await click('.home-frame-card');await until('!!document.querySelector(".topbar")');
    await q('document.querySelector(".welcome-go")?.click()');
    const media=await q(`window.api.probePaths(${JSON.stringify([movie,green])})`);
    const project={id:'vision-test',name:'Visual inspection',ratio:'9:16',ratioLocked:true,width:360,height:640,fps:10,
      media:media.map((m,i)=>({...m,id:i?'green':'video'})),
      videoClips:[{id:'main',mediaId:'video',in:1,out:3,speed:1,crop:{l:0.341796875,r:0.341796875,t:0,b:0}}],
      overlayClips:[{id:'box',mediaId:'green',start:0,in:0,out:2,speed:1,transform:{scale:0.35,x:0,y:0}}],
      textClips:[{id:'title',text:'FRAME CHECK',start:0,duration:2,x:0.5,y:0.15,size:30,color:'#ffffff',font:'inter',bold:true}],audioClips:[]};
    await q(`window.__fve.load(${JSON.stringify(project)})`);await q('window.__fve.seek(0.9)');
    const before=await q('window.__fve.exportData()');
    const beforeTime=await q('document.querySelector(".transport .tc").textContent');
    await click('.pilot-fab');await until('!!document.querySelector(".pilot-input textarea")');
    await draft('Inspect the edited video and its raw source at 0.25 and 1.75 seconds. Describe the colors and read the visible title.');await until('!document.querySelector("button[aria-label=Send]").disabled');await click('button[aria-label=Send]');
    await until('!!document.querySelector("button[aria-label=Stop]")');
    await until('!document.querySelector("button[aria-label=Stop]")',live?180000:60000);
    check('inspection completed with source and composed images',result.images?.length===4&&!!result.answer);
    check('frame inspection changes neither the playhead nor media and clip edits',await q(`(()=>{const p=window.__fve.exportData();return document.querySelector('.transport .tc').textContent===${JSON.stringify(beforeTime)}&&JSON.stringify(p.project.videoClips)===${JSON.stringify(JSON.stringify(before.project.videoClips))}&&p.project.media.length===2;})()`));
    check('read-only inspection creates no Undo entry',!await q('!!document.querySelector(".pilot-undo")'));
    check('offscreen composition windows close after capture',require('electron').BrowserWindow.getAllWindows().length===1);
    fs.writeFileSync(path.join(dir,'chat.png'),(await win.capturePage()).toPNG());
    cancel=true;phase=0;
    const onCreated=(_event,window)=>{if(window!==win)created=true;};
    app.on('browser-window-created',onCreated);
    await draft('Inspect another frame.');await click('button[aria-label=Send]');
    for(let i=0;!created&&i<200;i++){created=require('electron').BrowserWindow.getAllWindows().some(window=>window!==win);if(!created)await wait(10);}
    check('Stop can reach an in-flight composition capture',created);
    await click('button[aria-label=Stop]');await until('!document.querySelector("button[aria-label=Stop]")');
    for(let i=0;require('electron').BrowserWindow.getAllWindows().length>1&&i<100;i++)await wait(20);
    app.removeListener('browser-window-created',onCreated);
    check('Stop closes the capture window and leaves the project unchanged',require('electron').BrowserWindow.getAllWindows().length===1&&(await q('window.__fve.exportData().project.media.length'))===2);
    settings.save({provider:'ollama'});
    const unavailable=await q('window.api.agentInspectFrames({times_sec:[0],project:{}})');
    check('non-Codex providers validate frame requests instead of hiding vision support',!!unavailable.error&&!/Codex SDK/.test(unavailable.error));
    check('no main renderer errors',result.errors.length===0);result.ok=true;
  }catch(error){result.ok=false;result.error=error.stack;result.body=await q('document.body.textContent').catch(()=>null);fs.writeFileSync(path.join(dir,'failure.png'),(await win.capturePage()).toPNG());}
  finally{ai.agentStep=original;}
  fs.writeFileSync(path.join(dir,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({ok:result.ok,live,checks:result.checks,error:result.error,dir}));app.exit(result.ok?0:1);
};
