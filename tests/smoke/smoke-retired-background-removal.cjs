const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
module.exports=async(win,app,dir)=>{
 const q=async s=>{try{return await win.webContents.executeJavaScript(s);}catch(e){throw Error(e.message+'\nScript: '+s);}},wait=ms=>new Promise(r=>setTimeout(r,ms));
 const until=async(code)=>{const end=Date.now()+20000;while(Date.now()<end){if(await q(code))return;await wait(30);}throw Error('Timeout '+code);};
 const result={checks:[]},check=(name,value)=>{assert.ok(value,name);result.checks.push(name);};
 const ff=require('../../electron/media/ffmpeg.cjs');
 try{
  await until('!!window.__fve&&!!document.querySelector(".home-frame-card")');await q('document.querySelector(".home-frame-card").click()');await until('!!document.querySelector(".topbar")');
  const make=(name,color)=>{const file=path.join(dir,name+'.mp4');execFileSync(ff.ffmpegPath,['-v','error','-y','-f','lavfi','-i',`color=c=${color}:s=160x90:r=30:d=1`,'-c:v','libx264','-pix_fmt','yuv420p',file]);return file;};
  const red=make('red','red'),green=make('green','0x00ff00'),matte=make('old-matte','black');
  const media=await Promise.all([red,green].map(async(file,i)=>({...await ff.probe(file),id:'m'+i,path:file,matte,name:'Legacy '+i})));
  const p={id:'retired-removal',name:'Legacy removal compatibility',width:160,height:90,fps:30,ratio:'16:9',background:'#0000ff',media,videoClips:[{id:'v',mediaId:'m0',in:0,out:1,speed:1,bgRemove:true}],overlayClips:[{id:'o',mediaId:'m1',start:0,in:0,out:1,speed:1,bgRemove:true,transform:{scale:.5}}],audioClips:[],textClips:[],effectClips:[]};
  await q('window.__fve.load('+JSON.stringify(p)+')');await q('window.__fve.seek(.3)');
  await until('[...document.querySelectorAll(".stage video")].filter(v=>v.src).length>=2&&[...document.querySelectorAll(".stage video")].filter(v=>v.src).every(v=>v.readyState>=2&&!v.seeking)');await wait(300);
  const loaded=await q('window.__fve.exportData().project');
  check('old media matte references and main/overlay flags are discarded',loaded.media.every(m=>!Object.hasOwn(m,'matte'))&&[...loaded.videoClips,...loaded.overlayClips].every(c=>!Object.hasOwn(c,'bgRemove')));
  check('automatic removal preload methods are absent',await q('["mattingStatus","mattingRun","mattingCancel","onMattingProgress"].every(k=>!(k in window.api))'));
  check('no hidden matte decoders are mounted',await q('!document.querySelector(".matte-src")'));
  const rect=await q('(()=>{const r=document.querySelector(".stage").getBoundingClientRect();return {x:Math.round(r.x),y:Math.round(r.y),width:Math.floor(r.width),height:Math.floor(r.height)}})()');
  const image=await win.capturePage(rect);fs.writeFileSync(path.join(dir,'legacy-preview.png'),image.toPNG());const bitmap=image.toBitmap(),{width,height}=image.getSize();
  const preview=(x,y)=>{const at=4*(Math.floor(y*height)*width+Math.floor(x*width));return [...bitmap.subarray(at,at+3)].reverse();};
  result.preview={center:preview(.5,.5),edge:preview(.1,.5)};
  check('preview renders the original main video and overlay despite black legacy mattes',result.preview.center[1]>result.preview.center[0]+80&&result.preview.center[1]>result.preview.center[2]+80&&result.preview.edge[0]>result.preview.edge[1]+80&&result.preview.edge[0]>result.preview.edge[2]+80);
  await q('window.__fve.exportNow()');check('legacy project exports in the real app',await q('!!document.querySelector(".modal-icon.ok")'));
  const file=path.join(dir,'ui-export.mp4'),pixels=execFileSync(ff.ffmpegPath,['-v','error','-i',file,'-ss','0.3','-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','pipe:1']);
  const at=(x,y)=>[...pixels.subarray(3*(y*160+x),3*(y*160+x)+3)];result.export={center:at(80,45),edge:at(16,45)};
  check('export renders both original sources without applying retired mattes',result.export.center[1]>180&&result.export.center[0]<70&&result.export.edge[0]>180&&result.export.edge[1]<70);
  await q('[...document.querySelectorAll(".modal-backdrop button")].find(b=>b.textContent.trim()==="OK")?.click()');
  await until('!document.querySelector(".modal-backdrop")');
  await q('window.__fve.select({track:"overlay",id:"o"})');await until('!!document.querySelector(".clip-inspector")');
  await until('[...document.querySelectorAll(".clip-inspector button")].some(b=>b.textContent.trim()==="Chroma & Brush")');
  await q('[...document.querySelectorAll(".clip-inspector button")].find(b=>b.textContent.trim()==="Chroma & Brush").click()');
  await until('[...document.querySelectorAll("input")].some(el=>el.getAttribute("aria-label")==="Chroma key")');
  check('automatic removal controls are absent',await q('![...document.querySelectorAll("input")].some(el=>el.getAttribute("aria-label")==="Auto removal")&&![...document.querySelectorAll("button")].some(b=>b.textContent.trim()==="Remove BG")'));
  await q('[...document.querySelectorAll("input")].find(el=>el.getAttribute("aria-label")==="Chroma key").click()');
  await until('window.__fve.exportData().project.overlayClips[0].chroma?.on');
  check('chroma key remains editable',await q('window.__fve.exportData().project.overlayClips[0].chroma.on'));
  await q('[...document.querySelectorAll(".clip-inspector button")].find(b=>b.textContent.includes("Paint removal")).click()');
  await until('!!document.querySelector(".cmask-overlay")');
  check('manual removal brush opens',await q('!!document.querySelector(".cmask-overlay")'));
  result.keyPixels=await q(`(async()=>{
    const {FxGL}=await import('/src/features/effects/gl.js');
    const {applyChromaKey,chromaParams}=await import('/src/features/preview/visual.js');
    const renderer=new FxGL(),errors=[];
    try {for(const color of ['#00ff00','#0000ff','#ff0000'])for(const spill of [0,50,100]) {
      const w=48,h=24,data=Uint8Array.from({length:w*h*4},(_,i)=>i%4===3?128+Math.floor(i/4)%128:(i*13+Math.floor(i/(w*4))*7)%256);
      const custom=Uint8Array.from(data,(v,i)=>i%4===3?255:255-(i*3)%256),chroma={on:true,color,intensity:25,feather:15,spill};
      const expected=applyChromaKey(new Uint8ClampedArray(data),chroma);
      for(let i=3;i<expected.length;i+=4)expected[i]=expected[i]*custom[i-3]/255;
      const c=parseInt(color.slice(1),16),p=chromaParams(chroma);
      renderer.effects({data},w,h,[{key:{on:true,color:[c>>16&255,c>>8&255,c&255],params:[p.similarity,p.blend,p.spill],custom:{data:custom,width:w,height:h}}}]);
      const actual=renderer.read(w,h);let max=0;for(let i=0;i<actual.length;i++)max=Math.max(max,Math.abs(actual[i]-expected[i]));errors.push(max);
    }return {maxErrors:errors,glError:renderer.gl.getError()};}finally{renderer.dispose();}
  })()`);
  check('retained GPU chroma and custom masks match CPU reference pixels',result.keyPixels.maxErrors.every(n=>n<=1)&&result.keyPixels.glError===0);
 }catch(error){result.error=error.stack;}
 fs.writeFileSync(path.join(dir,'result.json'),JSON.stringify(result,null,2));app.exit(result.error?1:0);
};
