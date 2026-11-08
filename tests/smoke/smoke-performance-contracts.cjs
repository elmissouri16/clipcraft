const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

module.exports = async (win, app, dir) => {
  fs.mkdirSync(dir, { recursive: true });
  win.webContents.setBackgroundThrottling(false);
  const q = code => win.webContents.executeJavaScript(code);
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const until = async (code, timeout = 20000) => {
    const end = Date.now() + timeout;
    while (Date.now() < end) { if (await q(code)) return;await wait(40); }
    throw new Error('Timed out: ' + code);
  };
  const result = { checks: [], errors: [] };
  const check = (name, value) => { assert.ok(value, name);result.checks.push(name); };
  win.webContents.on('console-message', (_event, level, message) => { if (level >= 3) result.errors.push(message); });
  try {
    await until('!!window.__fve && !!document.querySelector(".home-frame-card")');
    await q('document.querySelector(".home-frame-card").click()');
    await until('!!document.querySelector(".topbar")');
    result.gpu = await q(`(async () => {
      const { FxGL, shaderSource } = await import('/src/features/effects/gl.js');
      const { gradeExpr } = await import('/src/features/effects/grade.js');
      const { fxWrap } = await import('/src/features/effects/apply.js');
      const { applyChromaKey, chromaParams } = await import('/src/features/preview/visual.js');
      const fast = new FxGL(), reference = new FxGL(), gl = reference.gl;
      const literalFor = renderer => (src, mode) => {
        const gl = renderer.gl;
        const key = mode + src;let program = renderer.programs.get(key);
        if (!program) {
          program = gl.createProgram();const shaders = [];
          for (const [type, source] of [[gl.VERTEX_SHADER, '#version 300 es\\nin vec2 p;void main(){gl_Position=vec4(p,0.,1.);}'], [gl.FRAGMENT_SHADER, shaderSource(src, mode)]]) {
            const shader = gl.createShader(type);shaders.push(shader);gl.shaderSource(shader, source);gl.compileShader(shader);
            if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));gl.attachShader(program, shader);
          }
          gl.bindAttribLocation(program, 0, 'p');gl.linkProgram(program);shaders.forEach(shader => gl.deleteShader(shader));
          if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));renderer.programs.set(key, program);
        }
        return { program, params: null };
      };
      reference.prepared = literalFor(reference);window.__literalShaderReference = literalFor;
      const pattern = (w, h) => Uint8Array.from({ length: w*h*4 }, (_, i) => i%4 === 3 ? 128 + Math.floor(i/4)%128 : (i*13 + Math.floor(i/(w*4))*7)%256);
      const errors = [], region = { x:.1,y:.2,w:.6,h:.5,feather:.04,shape:'ellipse' };
      for (const value of [1, 10, 40, 80, 20, -20, -80]) {
        const w=48,h=24,data=pattern(w,h),expr=fxWrap(gradeExpr({exposure:value,contrast:value/2,temp:12}),region,.6);
        fast.effects({data},w,h,[{expr,T:.5}]);reference.effects({data},w,h,[{expr,T:.5}]);
        const a=fast.read(w,h),b=reference.read(w,h);errors.push(a.reduce((sum,v,i)=>sum+Math.abs(v-b[i]),0)/a.length);
      }
      const slider = new FxGL();for(let i=1;i<=300;i++)slider.effects({data:pattern(16,8)},16,8,[{expr:gradeExpr({exposure:i/10,contrast:20}),T:0}]);
      const sliderPrograms=slider.programs.size,templateEntries=slider.templates.size;
      let deleted=0;const originalDelete=slider.gl.deleteProgram.bind(slider.gl);slider.gl.deleteProgram=p=>{deleted++;originalDelete(p);};
      for(let i=1;i<=70;i++)slider.effects({data:pattern(16,8)},16,8,[{expr:'S(X,Y)'+ '+0'.repeat(i),T:0}]);
      const boundedPrograms=slider.programs.size,evicted=deleted;
      const lut={size:2,data:new Uint8Array(4*2*4)};
      for(let b=0;b<2;b++)for(let g=0;g<2;g++)for(let r=0;r<2;r++)lut.data.set([r*255,g*255,b*255,255],(g*4+b*2+r)*4);
      for(const [w,h] of [[32,16],[64,24],[32,16]]) {
        const data=pattern(w,h),passes=[{expr:'S(X+1,Y)',T:.5},{lut,K:.7},{expr:'S(X,H-1-Y)*.8+10',T:.5},{expr:'S(W-1-X,Y)',T:.5}];
        fast.effects({data},w,h,passes);reference.effects({data},w,h,passes);
        const a=fast.read(w,h),b=reference.read(w,h);errors.push(a.reduce((sum,v,i)=>sum+Math.abs(v-b[i]),0)/a.length);
      }
      fast.transition({data:pattern(32,16)},{data:pattern(32,16).map(v=>255-v)},32,16,.37,'A(X,Y)*(1-P)+B(X,Y)*P');
      reference.transition({data:pattern(32,16)},{data:pattern(32,16).map(v=>255-v)},32,16,.37,'A(X,Y)*(1-P)+B(X,Y)*P');
      const a=fast.read(32,16),b=reference.read(32,16);errors.push(a.reduce((sum,v,i)=>sum+Math.abs(v-b[i]),0)/a.length);
      const keyErrors=[];
      for(const color of ['#00ff00','#0000ff','#ff0000'])for(const spill of [0,50,100]) {
        const w=48,h=24,data=pattern(w,h),chroma={on:true,color,intensity:25,feather:15,spill};
        const custom=pattern(w,h).map((v,i)=>i%4===3?255:255-(i*3)%256);
        const expected=applyChromaKey(new Uint8ClampedArray(data),chroma);
        for(let i=3;i<expected.length;i+=4){expected[i]=expected[i]*custom[i-3]/255;}
        const value=parseInt(color.slice(1),16),p=chromaParams(chroma);
        fast.effects({data},w,h,[{key:{on:true,color:[value>>16&255,value>>8&255,value&255],params:[p.similarity,p.blend,p.spill],custom:{data:custom,width:w,height:h}}}]);
        const actual=fast.read(w,h);let max=0,sum=0;for(let i=0;i<actual.length;i++){const error=Math.abs(actual[i]-expected[i]);max=Math.max(max,error);sum+=error;}
        keyErrors.push({color,spill,max,mean:sum/actual.length});
      }
      const glErrors=[fast.gl.getError(),reference.gl.getError(),slider.gl.getError()];fast.dispose();reference.dispose();slider.dispose();
      return {errors,keyErrors,sliderPrograms,templateEntries,boundedPrograms,evicted,glErrors};
    })()`);
    check('parameterized shaders retain literal-reference pixels across adjustments, LUT chains, resize and transitions', result.gpu.errors.every(error => error < 1));
    check('slider changes reuse programs and keep expression cache bounded', result.gpu.sliderPrograms === 1 && result.gpu.templateEntries <= 256);
    check('shader eviction releases old GPU programs', result.gpu.boundedPrograms === 64 && result.gpu.evicted >= 7);
    check('GPU calls report no errors', result.gpu.glErrors.every(error => error === 0));
    check('GPU keying, spill and combined masks match the CPU reference',result.gpu.keyErrors.every(error=>error.max<=1&&error.mean<.3));
    if (process.env.FVE_PERF_CATALOG !== '0') {
      result.fx = await q('window.__fve.fxSelfTest()');
      result.literalFx = await q(`(async()=>{const {fxGL}=await import('/src/features/effects/gl.js');const renderer=fxGL(),old=renderer.prepared;renderer.prepared=window.__literalShaderReference(renderer);try{return window.__fve.fxSelfTest();}finally{renderer.prepared=old;}})()`);
      assert.deepEqual(result.fx, result.literalFx, 'every catalog case retains its literal-shader reference metrics');
      check('complete effect and transition catalog retains the literal-shader reference results', true);
    }
    const base = { id:'clock-contract',name:'Clock contract',ratio:'16:9',width:640,height:360,fps:30,background:'#000000',media:[],videoClips:[{id:'gap',gap:true,in:0,out:300,speed:1}],overlayClips:[],audioClips:[],effectClips:[],textClips:[{id:'title',text:'Title',start:0,duration:10,layer:0},{id:'late',text:'Late title',start:285,duration:2,layer:0}] };
    await q('window.__fve.load(' + JSON.stringify(base) + ')');await wait(150);
    await q('window.__fve.seek(1);window.__fve.select({track:"text",id:"title"});window.__fve.play()');
    await wait(650);
    const stepped = await q('(()=>{const before=window.__fve.currentTime();document.querySelector("[aria-label=\\"Next frame (→)\\"]").click();return {before,after:window.__fve.currentTime()};})()');
    check('transport stepping during playback uses the live clock', stepped.before > 1.4 && Math.abs(stepped.after - stepped.before - 1/30) < .001);
    await q('window.__fve.play()');await wait(100);
    const marker = await q('(()=>{const before=window.__fve.currentTime();window.dispatchEvent(new KeyboardEvent("keydown",{key:"m",bubbles:true}));return before;})()');
    await wait(80);
    check('marker uses the live playback clock', Math.abs(await q('window.__fve.rawProject().markers.at(-1).time') - marker) < .06 && marker > 1.4);
    const split = await q('(()=>{const before=window.__fve.currentTime();window.dispatchEvent(new KeyboardEvent("keydown",{key:"s",bubbles:true}));return before;})()');await wait(80);
    check('split uses the live playback clock', Math.abs(await q('window.__fve.rawProject().textClips.find(c=>c.id==="title").duration') - split) < .06);
    await q('window.__fve.pause()');await wait(100);const paused=await q('window.__fve.currentTime()');await wait(150);
    check('pause publishes and holds the latest playback position', paused > split && Math.abs(await q('window.__fve.currentTime()') - paused) < .001);
    await q('window.dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowRight",bubbles:true}))');await wait(80);
    check('keyboard stepping uses the paused clock', Math.abs(await q('window.__fve.currentTime()') - paused - 1/30) < .001);
    await q('window.__fve.seek(7)');await wait(80);
    check('explicit seeks update the shared clock', await q('window.__fve.currentTime()===7'));
    for(let i=0;i<4;i++) {
      await q('window.__fve.play()');await wait(30+i*13);
      await q('window.__fve.dispatch({type:"load",project:' + JSON.stringify({ ...base, id:'loaded-contract' }) + '})');await wait(80);
      check('production project load '+i+' stops playback and resets the clock', await q('window.__fve.currentTime()===0&&document.querySelector(".play-btn").getAttribute("aria-label").startsWith("Play")'));
    }
    check('late timeline clip starts unmounted', await q('!document.querySelector("[data-sel-id=late]")'));
    await q('document.querySelector(".tl-scroll").scrollLeft=285*60-200');
    await until('!!document.querySelector("[data-sel-id=late]")');
    check('scrolling mounts clips beyond the initial viewport', true);
    await q('(()=>{const el=document.querySelector("[data-sel-id=late]"),r=el.getBoundingClientRect();el.dispatchEvent(new PointerEvent("pointerdown",{bubbles:true,button:0,clientX:r.left+10,clientY:r.top+10}));window.dispatchEvent(new PointerEvent("pointerup",{bubbles:true,clientX:r.left+10,clientY:r.top+10}));})()');
    await wait(80);await q('window.dispatchEvent(new KeyboardEvent("keydown",{key:"Delete",bubbles:true}))');
    await wait(100);check('a clip mounted after scrolling can be selected and deleted', await q('!window.__fve.rawProject().textClips.some(c=>c.id==="late")'));
    await q('window.dispatchEvent(new KeyboardEvent("keydown",{key:"z",ctrlKey:true,bubbles:true}))');await wait(100);
    check('Undo restores the scrolled clip', await q('window.__fve.rawProject().textClips.some(c=>c.id==="late")&&!!document.querySelector("[data-sel-id=late]")'));
    const {execFileSync}=require('node:child_process'),ff=require('../../electron/media/ffmpeg.cjs'),source=path.join(dir,'pool.mp4');
    execFileSync(ff.ffmpegPath,['-v','error','-y','-f','lavfi','-i','color=c=0x00ff00:s=320x180:r=24:d=2,drawbox=x=110:y=55:w=100:h=70:color=red:t=fill','-f','lavfi','-i','sine=frequency=440:duration=2','-shortest','-c:v','libx264','-pix_fmt','yuv420p',source]);
    const media={...await ff.probe(source),path:source,id:'pool-media',name:'pool.mp4'};
    const pooled={...base,id:'pool-contract',media:[media],videoClips:[{id:'gap',gap:true,in:0,out:802,speed:1}],textClips:[],
      overlayClips:Array.from({length:400},(_,i)=>({id:'over'+i,mediaId:media.id,start:i*2,in:0,out:1,speed:1,muted:true,layer:0,chroma:{on:true,color:'#00ff00',intensity:25,feather:15,spill:0}})),
      audioClips:Array.from({length:400},(_,i)=>({id:'sound'+i,mediaId:media.id,start:i*2,in:0,out:1,speed:1,muted:true,layer:0}))};
    await q('window.__fve.load('+JSON.stringify(pooled)+')');await wait(100);
    check('preview mounts nearby media instead of the whole project',await q('document.querySelectorAll("[data-preview-clip]").length<5&&document.querySelectorAll("[data-preview-audio]").length<5'));
    await q('window.__fve.seek(350.4)');
    await until('(()=>{const v=document.querySelector("[data-preview-clip=over175] video");return v?.readyState>=2&&Math.abs(v.currentTime-.4)<.1;})()');
    check('seeking mounts and positions a distant pooled clip',true);
    result.keyedPreview=await q('(()=>{const cv=document.querySelector("[data-preview-clip=over175] .keyed"),c=cv.getContext("2d");return {corner:c.getImageData(5,5,1,1).data[3],subject:c.getImageData(160,90,1,1).data[3]};})()');
    check('GPU keying reaches the actual preview canvas',result.keyedPreview.corner<5&&result.keyedPreview.subject>250);
    await q('window.__fve.select({track:"overlay",id:"over175"});window.__fve.seek(350.1)');await wait(80);await q('window.__fve.play()');
    result.inspectorKeyTimes=[];
    for(let i=0;i<3;i++) {
      await wait(120);
      const at=await q('(()=>{const now=window.__fve.currentTime();document.querySelector("[aria-label=\\"Add position keyframe\\"]").click();return now;})()');await wait(40);
      const actual=await q('window.__fve.rawProject().overlayClips.find(c=>c.id==="over175").keyframes.x.at(-1).t');
      result.inspectorKeyTimes.push({expected:at-350,actual});
    }
    check('inspector keyframes use the live event time between display updates',result.inspectorKeyTimes.every(pair=>Math.abs(pair.actual-pair.expected)<.001));
    await q('window.__fve.pause();window.__fve.seek(350.4)');await wait(80);
    await q('(()=>{window.__poolReadbacks=0;const p=CanvasRenderingContext2D.prototype;window.__poolRead=p.getImageData;p.getImageData=function(...args){window.__poolReadbacks++;return window.__poolRead.apply(this,args);};window.__oldPoolVideo=document.querySelector("[data-preview-clip=over175] video");window.__fve.play();})()');await wait(180);
    check('masked playback avoids CPU canvas readback',await q('window.__poolReadbacks===0'));
    await q('window.__fve.seek(10.2)');
    await until('!!document.querySelector("[data-preview-clip=over5]")');
    check('a seek during playback replaces the pool and releases old media',await q('window.__oldPoolVideo.paused&&!window.__oldPoolVideo.getAttribute("src")&&!document.querySelector("[data-preview-clip=over175]")'));
    await q('window.__fve.pause();void(CanvasRenderingContext2D.prototype.getImageData=window.__poolRead)');
    const layered={...base,id:'vertical-contract',videoClips:[{id:'gap',gap:true,in:0,out:20,speed:1}],layers:{text:200},textClips:Array.from({length:200},(_,i)=>({id:'layer'+i,text:'Layer '+i,start:0,duration:10,layer:i}))};
    await q('window.__fve.load('+JSON.stringify(layered)+');document.querySelector(".tl-scroll").scrollTo({left:0,top:0})');await wait(150);
    check('vertical virtualization bounds clip and layer-control DOM',await q('document.querySelectorAll(".clip.text").length<25&&document.querySelectorAll(".tl-layer-row").length<35&&!document.querySelector("[data-sel-id=layer0]")'));
    await q('(()=>{const sc=document.querySelector(".tl-scroll"),lane=document.querySelector(".tl-lane[data-lane=text]");sc.scrollTop=lane.getBoundingClientRect().top-sc.getBoundingClientRect().top+sc.scrollTop+22+199*34-100;})()');
    await until('!!document.querySelector("[data-sel-id=layer0]")');
    check('vertical scrolling mounts the matching layer and controls',await q('document.querySelectorAll(".clip.text").length<25&&!!document.querySelector("[aria-label=\\"Layer menu for Text 1\\"]")'));
    check('no renderer exceptions', result.errors.length === 0);
    result.ok = true;
  } catch (error) { result.ok = false;result.error = error.stack;fs.writeFileSync(path.join(dir,'failure.png'),(await win.capturePage()).toPNG()); }
  fs.writeFileSync(path.join(dir,'result.json'),JSON.stringify(result,null,2));
  console.log(JSON.stringify({ok:result.ok,checks:result.checks,error:result.error,gpu:result.gpu,dir}));app.exit(result.ok?0:1);
};
