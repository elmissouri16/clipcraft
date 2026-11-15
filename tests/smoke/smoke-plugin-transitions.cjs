const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
module.exports=async(win,app,dir)=>{
 const q=s=>win.webContents.executeJavaScript(s),wait=ms=>new Promise(r=>setTimeout(r,ms));
 const result={checks:[],measurements:[],errors:[]},ff=require('../../electron/media/ffmpeg.cjs');
 const {dialog}=require('electron'),originalSave=dialog.showSaveDialog,originalOpen=dialog.showOpenDialog;
 const check=(name,value)=>{assert.ok(value,name);result.checks.push(name);};
 const until=async s=>{for(let i=0;i<400;i++){if(await q(s))return;await wait(40);}throw Error('Timeout '+s);};
 const click=s=>q(`document.querySelector(${JSON.stringify(s)}).click()`);
 const close=()=>q('[...document.querySelectorAll(".modal-backdrop button")].find(b=>["Close","OK"].includes(b.textContent.trim()))?.click()');
 win.webContents.setBackgroundThrottling(false);win.webContents.on('console-message',(_e,level,message)=>{if(level>=3)result.errors.push(message);});
 try{
  await until('!!window.__fve&&!!document.querySelector(".home-frame-card")');await click('.home-frame-card');await until('!!document.querySelector(".topbar")');await q('document.querySelector(".welcome-go")?.click()');
  const definition=(await q('window.api.pluginTransitions()')).find(d=>d.pluginId==='clipcraft-examples.diagonal-reveal');check('dev automatically loads transition example',!!definition);
  const id=`plugin-transition:${definition.contributionId}@${definition.digest}`;
  const W=320,H=180,a=path.join(dir,'outgoing.png'),b=path.join(dir,'incoming.png');
  for(const [file,hue] of [[a,0],[b,120]])execFileSync(ff.ffmpegPath,['-v','error','-y','-f','lavfi','-i',`testsrc2=s=${W}x${H}`,'-vf',`hue=h=${hue}`,'-frames:v','1',file]);
  const base={id:'plugin-transition-proof',name:'Transition plugin proof',width:W,height:H,fps:24,ratio:'16:9',background:'#111827',media:[{...await ff.probe(a),id:'a',path:a,name:'Outgoing'},{...await ff.probe(b),id:'b',path:b,name:'Incoming'}],
    videoClips:[{id:'a',mediaId:'a',in:0,out:1,speed:1,effects:[]},{id:'b',mediaId:'b',in:0,out:1,speed:1,effects:[]}],overlayClips:[],audioClips:[],textClips:[],effectClips:[]};
  await q(`window.__fve.load(${JSON.stringify(base)});window.__fve.select({track:'video',id:'b'});window.__fve.tab('transitions')`);
  await until(`[...document.querySelectorAll('.plugin-transitions .tile')].some(e=>e.textContent.includes('Diagonal reveal'))`);
  await q(`[...document.querySelectorAll('.plugin-transitions .tile')].find(e=>e.textContent.includes('Diagonal reveal')).click()`);
  await until('!!window.__fve.rawProject().videoClips[1].transition?.pluginTransition');
  check('library application pins exact transition version',await q(`window.__fve.rawProject().videoClips[1].transition.type===${JSON.stringify(id)}`));
  await q(`window.__fve.select({track:'transition',id:'b'})`);
  await until(`!!document.querySelector('.plugin-transition-controls input[aria-label="Tilt value"]')`);
  await q(`(()=>{const e=document.querySelector('.plugin-transition-controls input[aria-label="Tilt value"]');e.focus();Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'0.8');e.dispatchEvent(new Event('input',{bubbles:true}));})()`);await wait(60);
  await q(`document.querySelector('.plugin-transition-controls input[aria-label="Tilt value"]').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))`);
  await until('window.__fve.rawProject().videoClips[1].transition.pluginTransition.params.tilt===0.8');check('native transition inspector edits parameters',true);
  await q('window.__fve.dispatch({type:"undo"})');await wait(60);check('parameter edit is undoable',await q('window.__fve.rawProject().videoClips[1].transition.pluginTransition.params.tilt===0.5'));
  await q('window.__fve.dispatch({type:"redo"})');await wait(60);
  // Direct GPU endpoint proof includes a deliberately invalid author result at the endpoints.
  result.endpoints=await q(`(async()=>{const {FxGL}=await import('/src/features/effects/gl.js');const {fxTransition}=await import('/src/features/effects/catalog.js');const gl=new FxGL(),W=32,H=18;
    const a=Uint8Array.from({length:W*H*4},(_,i)=>i%4===3?255:(i*11)%256),b=a.map((v,i)=>i%4===3?255:255-v);
    const tr=window.__fve.rawProject().videoClips[1].transition,expr=fxTransition(tr.type,tr).expr;const checks=[];
    for(const expression of [expr,'255'])for(const P of [0,1]){gl.transition({data:a},{data:b},W,H,P,expression);const actual=gl.read(W,H),expected=P?b:a;checks.push(actual.every((v,i)=>v===expected[i]));}gl.dispose();return checks;})()`);
  check('GPU endpoints exactly preserve both input frames',result.endpoints.every(Boolean));
  const saved=path.join(dir,'transition.clipcraft.json');dialog.showSaveDialog=async()=>({canceled:false,filePath:saved});
  await q('window.api.saveProject(JSON.stringify(window.__fve.rawProject()),null,{chat:null})');
  const project=JSON.parse(fs.readFileSync(saved,'utf8'));check('real persistence stores version and parameters',project.videoClips[1].transition.pluginTransition.params.tilt===.8);
  check('real persistence reopens project',!(await q(`window.api.openProjectPath(${JSON.stringify(saved)})`)).error);
  await q(`window.__fve.load(${JSON.stringify(project)})`);
  const readFrame=async time=>{await q(`window.__fve.seek(${time})`);await wait(180);return q(`(()=>{const c=document.querySelector('canvas.fx-transition');if(c.style.display==='none')throw Error('Transition canvas hidden');return Array.from(c.getContext('2d').getImageData(0,0,320,180).data)})()`);};
  const compare=async(label,fixture)=>{
    await q(`window.__fve.load(${JSON.stringify(fixture)})`);await wait(100);
    const frames=[];for(const time of [.625,.75,.875])frames.push({time,data:await readFrame(time)});
    check(label+' visibly reveals incoming frame',frames[0].data.some((v,i)=>Math.abs(v-frames[2].data[i])>20));
    const exported=await q('window.__fve.exportNow()');check(label+' exports',exported.ok===true);
    for(const frame of frames){const rgb=execFileSync(ff.ffmpegPath,['-v','error','-ss',String(frame.time),'-i',path.join(dir,'ui-export.mp4'),'-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','-']);let error=0;
      for(let i=0;i<W*H*3;i++)error+=Math.abs(rgb[i]-frame.data[Math.floor(i/3)*4+i%3]);error/=W*H*3;
      result.measurements.push({label,time:frame.time,meanAbsoluteRgbError:error,tolerance:12});check(label+' preview/export parity at '+frame.time,error<12);}
    await close();
  };
  await compare('plain',project);
  const styled=structuredClone(project);styled.videoClips[1]={...styled.videoClips[1],transform:{scale:.8,x:.07,y:-.03,rot:8,uniform:true,scaleX:1,scaleY:1},opacity:.85,crop:{l:.1,r:.05,t:.05,b:.05},chroma:{on:true,color:'#00ff00',intensity:10,feather:10,spill:0}};
  await compare('transformed cropped keyed',styled);
  await q(`window.__fve.select({track:'transition',id:'b'});window.__fve.seek(.75)`);await wait(100);
  fs.writeFileSync(path.join(dir,'transition-inspector.png'),(await win.capturePage()).toPNG());
  const cover=await q('window.api.exportCoverFrame(window.__fve.rawProject(),0.75)');check('hidden composition receives transition definitions',cover.ok===true);
  const newer=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../../examples/plugins/diagonal-reveal/plugin.json'),'utf8'));newer.version='1.1.0';newer.contributes.transitions[0].name='Diagonal reveal next';
  const updateFolder=path.join(dir,'update');fs.mkdirSync(updateFolder);fs.writeFileSync(path.join(updateFolder,'plugin.json'),JSON.stringify(newer));dialog.showOpenDialog=async()=>({canceled:false,filePaths:[updateFolder]});
  await q('window.api.pluginsInstall(true)');await wait(120);
  check('new package leaves project pinned to old version',await q(`window.__fve.rawProject().videoClips[1].transition.type===${JSON.stringify(id)}`));
  await until(`[...document.querySelectorAll('.plugin-transition-controls button')].some(b=>b.textContent==='Upgrade transition to installed version')`);
  await q(`[...document.querySelectorAll('.plugin-transition-controls button')].find(b=>b.textContent==='Upgrade transition to installed version').click()`);await wait(80);
  check('explicit upgrade preserves timing and parameters',await q(`window.__fve.rawProject().videoClips[1].transition.type!==${JSON.stringify(id)}&&window.__fve.rawProject().videoClips[1].transition.duration===0.5&&window.__fve.rawProject().videoClips[1].transition.pluginTransition.params.tilt===0.8`));
  await q('window.__fve.dispatch({type:"undo"})');await wait(80);check('version upgrade is undoable',await q(`window.__fve.rawProject().videoClips[1].transition.type===${JSON.stringify(id)}`));
  await q(`window.api.pluginsRemove(${JSON.stringify(definition.digest)})`);await wait(100);
  const blocked=await q('window.__fve.exportNow()');check('missing exact transition version blocks export',blocked.error?.includes('Plugin transitions need attention'));await close();
  check('missing transition is marked on the timeline',await q('!!document.querySelector(".tr-pill[aria-invalid=true]")'));
  check('missing version warning is visible',await q('!!document.querySelector(".plugin-transition-controls [role=alert]")'));
  const before=await q('window.__fve.duration()');await click('.plugin-transition-controls input[type=checkbox]');await wait(60);
  check('crossfade bypass retains duration',before===await q('window.__fve.duration()'));
  check('explicit crossfade bypass exports',(await q('window.__fve.exportNow()')).ok===true);await close();
  // Restore the old example and exercise a short overlap of exactly three frames.
  dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path.resolve(__dirname,'../../examples/plugins/diagonal-reveal')]});await q('window.api.pluginsInstall(true)');await wait(100);
  const short=structuredClone(project);short.videoClips=short.videoClips.map(c=>({...c,out:.25}));await q(`window.__fve.load(${JSON.stringify(short)})`);
  check('short transition exports',(await q('window.__fve.exportNow()')).ok===true);const metadata=await ff.probe(path.join(dir,'ui-export.mp4'));
  result.shortOutput={duration:metadata.duration,fps:metadata.fps};check('short overlap keeps clamped timeline duration',Math.abs(metadata.duration-.375)<1/24);await close();
  // Change parameters to avoid a cache hit and inject an export-only GPU failure.
  await q(`window.__fve.load(${JSON.stringify(project)});window.__fve.dispatch({type:'update',track:'video',id:'b',patch:{transition:{...window.__fve.rawProject().videoClips[1].transition,pluginTransition:{...window.__fve.rawProject().videoClips[1].transition.pluginTransition,params:{tilt:.37,softness:.12}}}}})`);await wait(60);
  await q(`(async()=>{const {FxGL}=await import('/src/features/effects/gl.js');window.__originalTransition=FxGL.prototype.transition;FxGL.prototype.transition=function(a,...args){if(a?.data)throw Error('Fixture transition GPU failure');return window.__originalTransition.call(this,a,...args);};})()`);
  const failure=await q('window.__fve.exportNow()');check('uncached GPU failure fails export clearly',failure.error?.includes('Fixture transition GPU failure'));
  await q(`(async()=>{const {FxGL}=await import('/src/features/effects/gl.js');FxGL.prototype.transition=window.__originalTransition;delete window.__originalTransition;})()`);await close();
  check('no renderer errors',result.errors.length===0);
 }catch(error){result.error=error.stack;result.dom=await q('document.body.innerText.slice(-2200)');}
 finally{dialog.showSaveDialog=originalSave;dialog.showOpenDialog=originalOpen;}
 fs.writeFileSync(path.join(dir,'result.json'),JSON.stringify(result,null,2));app.exit(result.error?1:0);
};
