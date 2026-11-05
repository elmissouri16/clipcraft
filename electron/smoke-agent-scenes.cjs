const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
module.exports=async(win,app,dir)=>{
 fs.mkdirSync(dir,{recursive:true});const ff=require('./ffmpeg.cjs'),ai=require('./ai.cjs'),settings=require('./settings.cjs'),original=ai.agentStep;
 const result={checks:[],errors:[]},q=js=>win.webContents.executeJavaScript(js),wait=ms=>new Promise(r=>setTimeout(r,ms));
 const check=(name,value)=>{assert.ok(value,name);result.checks.push(name);};
 const until=async(js,ms=60000)=>{const end=Date.now()+ms;while(Date.now()<end){if(await q(js))return;await wait(60);}throw new Error(`Timed out: ${js}`);};
 const click=selector=>q(`document.querySelector(${JSON.stringify(selector)}).click()`);
 const reply=(calls,text='')=>({calls,text,content:{role:'model',parts:[...calls.map(functionCall=>({functionCall})),...(text?[{text}]:[])]}});
 const tool=(req,name)=>req.contents.flatMap(t=>t.parts.filter(p=>p.functionResponse?.name===name).map(p=>p.functionResponse.response.result)).at(-1);
 let phase=0,blue,frames;
 ai.agentStep=async(_cfg,req)=>{
  switch(phase++){
   case 0:return reply([{name:'load_tools',args:{groups:['media','timeline']}}]);
   case 1:return reply([{name:'analyze_scenes',args:{}}]);
   case 2:{const analysis=tool(req,'analyze_scenes');check('scene detection maps actual source shots onto trimmed timeline',analysis.scenes.length===2&&analysis.scenes[0].start_sec===0&&analysis.scenes[0].end_sec===1&&analysis.scenes[1].start_sec===1);blue=analysis.scenes[0];return reply([{name:'get_storyboard',args:{source:'clip',limit:2}}]);}
   case 3:{frames=tool(req,'get_storyboard').frames;check('storyboard attaches source images to a non-Codex provider',req.images.length===2&&frames.length===2);const pixels=req.images.map(image=>execFileSync(ff.ffmpegPath,['-v','error','-i',image.path,'-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','-']));check('storyboard source samples are the requested blue and red moments',pixels[0][2]>180&&pixels[0][0]<50&&pixels[1][0]>180&&pixels[1][2]<50);return reply([{name:'annotate_scene',args:{analysis_id:blue.analysis_id,shot_id:blue.shot_id,media_id:'m',description:'A solid blue frame',tags:['blue'],frame_ids:[frames[0].id]}}]);}
   case 4:check('scene observation accepts only already presented source evidence',!!tool(req,'annotate_scene').shot?.observation);return reply([{name:'analyze_scenes',args:{query:'blue'}}]);
   case 5:{const found=tool(req,'analyze_scenes');check('observed scene description is searchable with current timeline times',found.scenes.length===1&&found.scenes[0].shot_id===blue.shot_id);return reply([{name:'keep_ranges',args:{ranges:[{start_sec:found.scenes[0].start_sec,end_sec:found.scenes[0].end_sec}]}}]);}
   case 6:return reply([],'Kept the observed blue shot.');
   default:check('agent must inspect the edited composition before finishing',req.images.length===1&&req.images[0].label.includes('timeline'));return reply([],'Kept the observed blue shot and checked the edited composition.');
  }
 };
 settings.setFirstRun({tourSeen:true,packPromptSeen:true});settings.save({provider:'ollama'});win.webContents.setBackgroundThrottling(false);win.webContents.on('console-message',(_e,level,text)=>{if(level>=3)result.errors.push(text);});
 try{
  const source=path.join(dir,'shots.mp4');execFileSync(ff.ffmpegPath,['-v','error','-y','-f','lavfi','-i','color=blue:s=160x90:r=10:d=2','-f','lavfi','-i','color=red:s=160x90:r=10:d=2','-filter_complex','[0:v][1:v]concat=n=2:v=1:a=0[out]','-map','[out]','-pix_fmt','yuv420p',source]);const media=await ff.probe(source);
  await until('!!window.__fve&&!!document.querySelector(".home-frame-card")');await click('.home-frame-card');await until('!!document.querySelector(".topbar")');await q('document.querySelector(".welcome-go")?.click()');
  const p={id:'agent-scene-test',name:'Scene understanding regression',ratio:'16:9',width:320,height:180,fps:10,media:[{...media,id:'m',path:source,name:'source.mp4'}],videoClips:[{id:'v',mediaId:'m',in:1,out:4,speed:1}],overlayClips:[],audioClips:[],textClips:[],effectClips:[]};
  await q(`window.__fve.load(${JSON.stringify(p)})`);await until('!!document.querySelector(".pilot-fab")');await click('.pilot-fab');await until('!!document.querySelector(".pilot-input textarea")');
  await q(`(()=>{const el=document.querySelector('.pilot-input textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(el,'Find the blue shot, inspect it, and keep only that shot.');el.dispatchEvent(new Event('input',{bubbles:true}));})()`);await until('!document.querySelector("button[aria-label=Send]").disabled');await click('button[aria-label=Send]');await until('!!document.querySelector("button[aria-label=Stop]")');await until('!document.querySelector("button[aria-label=Stop]")');
  const after=await q('window.__fve.rawProject()');check('semantic scene selection edits the correct source range',after.videoClips.length===1&&after.videoClips[0].in===1&&after.videoClips[0].out===2);
  check('saved context contains handles and metadata without base64',!JSON.stringify(after).includes(';base64,')&&!JSON.stringify(after).includes('inlineData'));
  const forged=await q(`window.api.agentAnnotateScene(${JSON.stringify({project:{media:p.media},analysis_id:blue.analysis_id,shot_id:blue.shot_id,media_id:'m',description:'unseen',frame_ids:[frames[0].id],requestId:'another-request'})})`);check('new request cannot reuse unpresented historical evidence',!!forged.error);
  const history=await q('window.__fve.history()');check('analysis metadata does not add Undo steps',history.past.length===1);
  await q('window.__fve.dispatch({type:"setProject",patch:{name:"Manual later edit"}})');await until('!document.querySelector(".pilot-undo")');check('agent Undo button cannot undo a newer manual edit',true);
  check('no renderer exceptions',!result.errors.length);result.ok=true;fs.writeFileSync(path.join(dir,'editor.png'),(await win.capturePage()).toPNG());
 }catch(error){result.ok=false;result.error=error.stack;result.body=await q('document.body.textContent').catch(()=>null);fs.writeFileSync(path.join(dir,'failure.png'),(await win.capturePage()).toPNG());}
 finally{ai.agentStep=original;}
 fs.writeFileSync(path.join(dir,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({ok:result.ok,checks:result.checks,error:result.error,dir}));app.exit(result.ok?0:1);
};
