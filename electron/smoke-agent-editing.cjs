const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
module.exports=async(win,app,dir)=>{
 fs.mkdirSync(dir,{recursive:true});
 const ff=require('./ffmpeg.cjs'),ai=require('./ai.cjs'),settings=require('./settings.cjs'),original=ai.agentStep;
 const result={checks:[],errors:[]},q=js=>win.webContents.executeJavaScript(js),wait=ms=>new Promise(r=>setTimeout(r,ms));
 const check=(name,ok)=>{assert.ok(ok,name);result.checks.push(name);};
 const until=async(js,ms=30000)=>{const end=Date.now()+ms;while(Date.now()<end){if(await q(js))return;await wait(60);}throw new Error(`Timed out: ${js}`);};
 const click=s=>q(`document.querySelector(${JSON.stringify(s)}).click()`);
 const reply=(calls,text='')=>({calls,text,content:{role:'model',parts:[...calls.map(functionCall=>({functionCall})),...(text?[{text}]:[])]}});
 let plan=[],responses=[];
 ai.agentStep=async(_cfg,req)=>{responses.push(...req.contents.at(-1)?.parts?.filter(p=>p.functionResponse).map(p=>p.functionResponse)||[]);const step=plan.shift();return typeof step==='function'?step(req):step||reply([],'Verified.');};
 settings.setFirstRun({tourSeen:true,packPromptSeen:true});settings.save({provider:'ollama'});win.webContents.setBackgroundThrottling(false);
 win.webContents.on('console-message',(_e,level,text)=>{if(level>=3)result.errors.push(text);});
 const send=async(steps)=>{plan=[reply([{name:'load_tools',args:{groups:['timeline','text']}}]),...steps.map(s=>typeof s==='function'?s:reply(s))];responses=[];await q(`(()=>{const el=document.querySelector('.pilot-input textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(el,'Run the requested regression edit.');el.dispatchEvent(new Event('input',{bubbles:true}));})()`);await until('!document.querySelector("button[aria-label=Send]").disabled');await click('button[aria-label=Send]');await until('!!document.querySelector("button[aria-label=Stop]")');await until('!document.querySelector("button[aria-label=Stop]")');};
 let id=0;
 const load=async p=>{await q(`window.__fve.load(${JSON.stringify({...p,id:`agent-edit-${++id}`})})`);await until('!!document.querySelector(".pilot-fab")');await click('.pilot-fab');await until('!!document.querySelector(".pilot-input textarea")');};
 try {
  const source=path.join(dir,'tone.mp4');execFileSync(ff.ffmpegPath,['-v','error','-y','-f','lavfi','-i','color=blue:s=160x90:r=10:d=10','-f','lavfi','-i','sine=frequency=440:sample_rate=16000:duration=10','-shortest','-pix_fmt','yuv420p',source]);
  await until('!!window.__fve&&!!document.querySelector(".home-frame-card")');await click('.home-frame-card');await until('!!document.querySelector(".topbar")');await q('document.querySelector(".welcome-go")?.click()');
  const media=await ff.probe(source);
  const base=()=>({name:'Agent edit regression',ratio:'16:9',width:320,height:180,fps:10,media:[{...media,id:'m',path:source,name:'tone.mp4'}],videoClips:[{id:'v',mediaId:'m',in:0,out:10,speed:1}],audioClips:[],overlayClips:[],textClips:[],effectClips:[]});
  const p=base();p.videoClips[0]={...p.videoClips[0],muted:true,linkId:'pair'};p.audioClips=[{id:'a',mediaId:'m',in:0,out:10,start:0,speed:1,linkId:'pair',linkOff:0,linkInOff:0}];p.textClips=[{id:'cap',caption:true,text:'Caption',start:6,duration:1}];p.overlayClips=[{id:'o',mediaId:'m',start:6,in:0,out:1,speed:1}];
  await load(p);await send([[{name:'cut_range',args:{start_sec:3,end_sec:5}}],[{name:'cut_range',args:{start_sec:1,end_sec:2}}]]);
  let after=await q('window.__fve.rawProject()');check('repeated cuts retain unique IDs',new Set(after.videoClips.map(c=>c.id)).size===3);
  check('range cuts preserve detached audio pairs',after.audioClips.length===3&&after.videoClips.every(c=>after.audioClips.some(a=>a.linkId===c.linkId&&a.in===c.in&&a.out===c.out)));
  check('captions and overlays follow both cuts',after.textClips[0].start===3&&after.overlayClips[0].start===3);
  await q('window.__fve.dispatch({type:"undo"})');await until('window.__fve.rawProject().videoClips.length===1');check('one Undo restores entire agent request',(await q('window.__fve.rawProject().videoClips[0].out'))===10);
  await load({...base(),layerState:{'video:0':{locked:true}}});await send([[{name:'cut_range',args:{start_sec:2,end_sec:4}}]]);after=await q('window.__fve.rawProject()');check('locked edit is reported as an error and does not mutate',responses.some(r=>r.name==='cut_range'&&r.response.result.error)&&after.videoClips[0].out===10);
  await load(base());await send([[{name:'keep_ranges',args:{ranges:[{start_sec:8,end_sec:2}]}}]]);check('invalid retained range does not delete footage',(await q('window.__fve.rawProject().videoClips.length'))===1&&responses.some(r=>r.name==='keep_ranges'&&r.response.result.error));
  await load(base());await q('window.__fve.select({track:"video",id:"v"});window.__fve.seek(2)');await send([[{name:'get_project',args:{scope:'main'}}]]);const read=responses.find(r=>r.name==='get_project')?.response.result;check('agent reads live playhead and selection',read?.editor?.playhead_sec===2&&read.editor.selection.id==='v');
  await load(base());await send([async()=>{await q('window.__fve.dispatch({type:"setProject",patch:{name:"manual"}})');return reply([{name:'set_project',args:{name:'stale'}}]);}]);check('manual edits revoke in-flight agent writes',(await q('window.__fve.rawProject().name'))==='manual');
  await load(base());await q('for(let i=0;i<105;i++)window.__fve.dispatch({type:"setProject",patch:{name:"history "+i}})');await until('window.__fve.history().past.length===100');await send([[{name:'set_project',args:{name:'agent first'}}],[{name:'set_project',args:{name:'agent second'}}]]);await q('window.__fve.dispatch({type:"undo"})');await until('window.__fve.rawProject().name==="history 104"');check('one Undo restores request at full history capacity',true);
  const tr=base();tr.videoClips=[{id:'v',mediaId:'m',in:0,out:5,speed:1},{id:'w',mediaId:'m',in:5,out:10,speed:1,transition:{type:'fade',duration:1}}];await load(tr);await send([[{name:'cut_range',args:{start_sec:4,end_sec:4.5}}]]);after=await q('window.__fve.rawProject()');const out=path.join(dir,'transition-cut.mp4');await ff.runExport(after,out,()=>{}).promise;const probed=await ff.probe(out);check('transition range cut exports the measured duration',Math.abs(probed.duration-8.5)<0.15);
  check('no renderer exceptions',result.errors.length===0);result.ok=true;fs.writeFileSync(path.join(dir,'editor.png'),(await win.capturePage()).toPNG());
 } catch(error){result.ok=false;result.error=error.stack;result.body=await q('document.body.textContent').catch(()=>null);fs.writeFileSync(path.join(dir,'failure.png'),(await win.capturePage()).toPNG());}
 finally{ai.agentStep=original;}
 fs.writeFileSync(path.join(dir,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({ok:result.ok,checks:result.checks,error:result.error,dir}));app.exit(result.ok?0:1);
};
