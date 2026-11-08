const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
module.exports=async(win,app,dir)=>{
 const q=code=>win.webContents.executeJavaScript(code),wait=ms=>new Promise(r=>setTimeout(r,ms));
 const until=async(code)=>{for(let i=0;i<400;i++){if(await q(code))return;await wait(50);}throw Error('Timeout: '+code);};
 const ff=require('../../electron/media/ffmpeg.cjs'),result={checks:[],measurements:[]};
 const check=(name,value)=>{assert.ok(value,name);result.checks.push(name);};
 const save=()=>fs.writeFileSync(path.join(dir,'result.json'),JSON.stringify(result,null,2));
 try{
  await until('!!window.__fve&&!!document.querySelector(".home-frame-card")');await q('document.querySelector(".home-frame-card").click()');await until('!!document.querySelector(".topbar")');
  const gpu=await q(`(async()=>{
   const {FxGL}=await import('/src/features/effects/gl.js'),{FX_TRANSITIONS,fxTransition}=await import('/src/features/effects/catalog.js');
   const gl=new FxGL(),W=48,H=32,a=Uint8Array.from({length:W*H*4},(_,i)=>i%4===3?255:(i*13+Math.floor(i/(W*4))*17)%256),b=a.map((v,i)=>i%4===3?255:255-v);
   let failures=[];for(const tr of [...FX_TRANSITIONS,fxTransition('dissolve')])for(const p of [0,1]){gl.transition({data:a},{data:b},W,H,p,tr.expr);const out=gl.read(W,H),ref=p?b:a;if(out.some((v,i)=>v!==ref[i]))failures.push(tr.id+':'+p);}
   const key={key:{on:true,color:[0,255,0],params:[.1,.1,0],crop:[.2,.1,.6,.8]}};
   gl.effects({data:a},W,H,[{expr:'255-S(X,H-1-Y)',T:0}]);const effected=gl.read(W,H);
   gl.effects({data:effected},W,H,[key]);const expected=gl.read(W,H);
   gl.effects({data:a},W,H,[{expr:'255-S(X,H-1-Y)',T:0},key]);const actual=gl.read(W,H);
   const maxKeyError=actual.reduce((m,v,i)=>Math.max(m,Math.abs(v-expected[i])),0);gl.dispose();return {failures,maxKeyError,count:FX_TRANSITIONS.length};
  })()`);
  result.gpu=gpu;check('all GPU transition endpoints preserve exact source pixels',!gpu.failures.length);check('effects followed by cropped keying preserve orientation and pixels',gpu.maxKeyError<=1);
  const W=320,H=180,source=path.join(dir,'pattern.png');
  execFileSync(ff.ffmpegPath,['-v','error','-y','-f','lavfi','-i',`testsrc2=s=${W}x${H}:r=10:d=1`,'-frames:v','1',source]);
  const media={...await ff.probe(source),id:'m',path:source,name:'Pattern'};
  const base={id:'effect-parity',name:'Effect parity',ratio:'16:9',width:W,height:H,fps:10,background:'#111827',media:[media],videoClips:[{id:'a',mediaId:'m',in:0,out:1,speed:1}],overlayClips:[],audioClips:[],textClips:[],effectClips:[]};
  const exportNow=async()=>{await q('window.__fve.exportNow()');check('app export completes',await q('!!document.querySelector(".modal-icon.ok")'));await q('[...document.querySelectorAll(".modal-backdrop button")].find(b=>b.textContent.trim()==="OK")?.click()');};
  const frame=(file,t)=>execFileSync(ff.ffmpegPath,['-v','error','-ss',String(t),'-i',file,'-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','-']);
  const error=(rgba,rgb,block=1)=>{
   let sum=0,n=0;
   // Dissolve switches individual pixels. YUV 4:2:0 necessarily mixes their
   // chroma; compare local color averages there, while retaining exact-size
   // comparisons for smooth transitions and effects.
   for(let y=0;y<H;y+=block)for(let x=0;x<W;x+=block)for(let c=0;c<3;c++){
    let a=0,b=0,count=0;for(let yy=y;yy<Math.min(H,y+block);yy++)for(let xx=x;xx<Math.min(W,x+block);xx++){const i=yy*W+xx;a+=rgba[i*4+c];b+=rgb[i*3+c];count++;}
    sum+=Math.abs(a-b)/count;n++;
   }return sum/n;
  };
  for(const effects of [['grain'],['pixel'],['blur','mirror','vignette'],['fx_invert']]){
   let clip={...base.videoClips[0],effects};if(effects[0]==='fx_invert')clip={...clip,crop:{l:.25,r:.25,t:0,b:0},chroma:{on:true,color:'#00ff00',intensity:10,feather:10,spill:0}};
   await q('window.__fve.load('+JSON.stringify({...base,videoClips:[clip]})+')');await wait(200);await q('window.__fve.seek(.2)');await wait(150);
   const preview=await q('(()=>{const cv=[...document.querySelectorAll(".slot:not(.ov) canvas.keyed")].find(c=>c.style.display==="block"&&c.closest(".slot").style.visibility==="visible");const out=document.createElement("canvas");out.width=320;out.height=180;const ctx=out.getContext("2d");ctx.fillStyle="#111827";ctx.fillRect(0,0,320,180);const k=Math.min(320/cv.width,180/cv.height);ctx.drawImage(cv,(320-cv.width*k)/2,(180-cv.height*k)/2,cv.width*k,cv.height*k);return {data:Array.from(ctx.getImageData(0,0,320,180).data)};})()');
   check(effects.join('+')+' has a rendered preview',preview.data.some((v,i)=>i%4!==3&&v>0));
   await exportNow();const file=path.join(dir,'ui-export.mp4');fs.copyFileSync(file,path.join(dir,effects.join('-')+'.mp4'));
   {const diff=error(preview.data,frame(file,.2));result.measurements.push({effects,error:diff});save();check(effects.join('+')+' preview agrees with exported pixels',diff<9);}
  }
  // Colour-only looks export through one baked 3D LUT applied by FFmpeg (src/features/export/colorLut.js);
  // posterize's hard steps fail the bake check and keep the frame-by-frame shader path.
  for (const [label,patch,route] of [['vivid+grade',{filter:'vivid',grade:{exposure:15,contrast:20,saturation:10,curves:{master:[[0,0],[0.4,0.32],[1,1]]}}},'lut'],['posterize',{filter:'posterize'},'shader']]){
   await q('window.__fve.load('+JSON.stringify({...base,videoClips:[{...base.videoClips[0],...patch}]})+')');await wait(200);await q('window.__fve.seek(.2)');await wait(150);
   const preview=await q('(()=>{const cv=[...document.querySelectorAll(".slot:not(.ov) canvas.keyed")].find(c=>c.style.display==="block"&&c.closest(".slot").style.visibility==="visible");const out=document.createElement("canvas");out.width=320;out.height=180;const ctx=out.getContext("2d");ctx.fillStyle="#111827";ctx.fillRect(0,0,320,180);const k=Math.min(320/cv.width,180/cv.height);ctx.drawImage(cv,(320-cv.width*k)/2,(180-cv.height*k)/2,cv.width*k,cv.height*k);return {data:Array.from(ctx.getImageData(0,0,320,180).data)};})()');
   await exportNow();fs.copyFileSync(path.join(dir,'ui-export.mp4'),path.join(dir,label+'.mp4'));
   const stats=await q('import("/src/features/export/fxExport.js").then(m=>m.lastFxStats)');
   check(label+' exports through the '+route+' path',route==='lut'?stats.lutClips===1&&stats.shaderClips===0:stats.lutClips===0&&stats.shaderClips===1);
   const diff=error(preview.data,frame(path.join(dir,'ui-export.mp4'),.2));result.measurements.push({look:label,route,error:diff});save();check(label+' preview agrees with exported pixels',diff<9);
  }
  const incoming={...base.videoClips[0],id:'b',transform:{scale:.7,x:.18,y:-.1,rot:15,uniform:true,scaleX:1,scaleY:1},opacity:.6,mask:{type:'circle',w:.8,h:.8,stroke:36,strokeColor:'#00ff00'},effects:['mirror'],transition:{type:'fx_zoomin',duration:.4}};
  const outgoing={...base.videoClips[0],transform:{scale:1.15,x:-.03,y:0,rot:0,uniform:true,scaleX:1,scaleY:1}};
  for(const type of ['fx_zoomin','dissolve']) {
   const top={...incoming,transition:{...incoming.transition,type}};
   await q('window.__fve.load('+JSON.stringify({...base,videoClips:[outgoing,top]})+')');await wait(250);
   const previews=[];for(const time of [.6,.8,.9]){await q('window.__fve.seek('+time+')');await wait(150);previews.push({time,data:await q('(()=>{const c=document.querySelector("canvas.fx-transition");return Array.from(c.getContext("2d").getImageData(0,0,c.width,c.height).data);})()')});}
   await exportNow();fs.copyFileSync(path.join(dir,'ui-export.mp4'),path.join(dir,'styled-'+type+'.mp4'));
   for(const {time,data} of previews){const diff=error(data,frame(path.join(dir,'ui-export.mp4'),time),type==='dissolve'?8:1);result.measurements.push({type,styledTransition:time,error:diff});save();check(type+' styled transition preview matches export at '+time,diff<12);}
  }
  fs.writeFileSync(path.join(dir,'done.png'),(await win.capturePage()).toPNG());
 }catch(error){result.error=error.stack;}save();app.exit(result.error?1:0);
};
