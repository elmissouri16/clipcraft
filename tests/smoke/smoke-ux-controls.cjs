const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
module.exports=async(win,app,dir)=>{
 const q=s=>{new(require('node:vm').Script)(s);return win.webContents.executeJavaScript(s);},wait=ms=>new Promise(r=>setTimeout(r,ms));
 const until=async s=>{for(let i=0;i<200;i++){if(await q(s))return;await wait(40);}throw Error('Timeout: '+s);};
 const click=s=>q(`document.querySelector(${JSON.stringify(s)}).click()`),result={checks:[],errors:[]};
 const check=(name,ok)=>{assert.ok(ok,name);result.checks.push(name);};
 win.webContents.setBackgroundThrottling(false);win.setContentSize(1000,640);
 win.webContents.on('console-message',(_e,n,s)=>{if(n>=3)result.errors.push(s);});
 const visibleOption=()=>q('(()=>{const l=document.querySelector(".pilot-session-picker .dropdown-list").getBoundingClientRect(),e=document.querySelector(".pilot-session-picker .dropdown-item.hi").getBoundingClientRect();return e.top>=l.top&&e.bottom<=l.bottom})()');
 const key=key=>q(`document.querySelector('.pilot-session-picker .dropdown-btn').dispatchEvent(new KeyboardEvent('keydown',{key:${JSON.stringify(key)},bubbles:true,cancelable:true}))`);
 try{
  await until('!!window.__fve&&!!document.querySelector(".home-frame-card")');await click('.home-frame-card');await until('!!document.querySelector(".topbar")');await q('document.querySelector(".welcome-go")?.click()');
  await click('.workspace-switch button:last-child');
  await q(`window.__fve.load({id:'ux-controls',name:'Control ergonomics',ratio:'9:16',width:1080,height:1920,fps:30,media:[],videoClips:[{id:'gap',gap:true,in:0,out:30}],textClips:[],audioClips:[],craftAI:{version:1,activeSessionId:'s25',sessions:Array.from({length:30},(_,i)=>({id:'s'+i,title:'Conversation '+i,messages:[],contents:[],draft:''}))}})`);
  await until('!!document.querySelector(".pilot-session-picker .dropdown-btn")');await click('.pilot-session-picker .dropdown-btn');await wait(100);
  check('opening a long session list reveals the selected conversation',await visibleOption());
  await key('Home');await wait(60);check('Home scrolls to the first conversation',await visibleOption());
  await key('End');await wait(60);check('End scrolls to the last conversation',await visibleOption());
  await key('Enter');await wait(60);check('keyboard chooses the visible conversation',await q('window.__fve.rawProject().craftAI.activeSessionId==="s0"'));
  const compact=await q('document.querySelector(".timeline").getBoundingClientRect().height');
  await click('.agent-workspace-tools button:nth-child(3)');await wait(80);
  check('timeline expands explicitly without editing the project',await q(`document.querySelector('.timeline').getBoundingClientRect().height>${compact}&&window.__fve.history().past.length===0`));
  await click('.agent-workspace-tools button:nth-child(3)');await wait(80);check('timeline returns to compact height',await q(`document.querySelector('.timeline').getBoundingClientRect().height===${compact}`));
  await click('.top-export > button:first-child');await until('!!document.querySelector(".export-ready")');
  check('export fields use the visible shared surface and border',await q('(()=>{const s=getComputedStyle(document.querySelector(".x-row-ctl input"));return s.backgroundColor!=="rgba(0, 0, 0, 0)"&&s.borderTopStyle!=="none"})()'));
  await click('.export-ready button[aria-label=Quality]');await wait(100);
  check('export dropdown stays inside the scrolling settings body',await q('(()=>{const r=document.querySelector(".export-ready .dropdown-list").getBoundingClientRect(),p=document.querySelector(".export-ready .x-body").getBoundingClientRect();return r.top>=p.top&&r.bottom<=p.bottom&&r.left>=p.left&&r.right<=p.right})()'));
  fs.writeFileSync(path.join(dir,'dropdown.png'),(await win.capturePage()).toPNG());
  await q('document.querySelector(".export-ready button[aria-label=Quality]").dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true,cancelable:true}))');
  check('Escape closes a dropdown before its parent dialog',await q('!!document.querySelector(".export-ready")&&!document.querySelector(".export-ready .dropdown-list")'));
  await click('.export-ready button[aria-label=Close]');
  const image=path.join(dir,'image.png'),audio=path.join(dir,'audio.wav'),video=path.join(dir,'video.mp4');
  require('node:child_process').execFileSync(require('../../electron/media/ffmpeg.cjs').ffmpegPath,['-v','error','-y','-f','lavfi','-i','color=c=0x405070:s=320x180:r=12:d=2','-f','lavfi','-i','sine=frequency=440:duration=2','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-shortest',video]);
  fs.writeFileSync(image,require('electron').nativeImage.createFromBitmap(Buffer.from([100,80,60,255]),{width:1,height:1}).resize({width:180,height:320}).toPNG());
  const wav=Buffer.alloc(44+8000*2);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(8000,24);wav.writeUInt32LE(16000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(wav.length-44,40);fs.writeFileSync(audio,wav);
  await q(`window.__fve.load({id:'ux-properties',name:'Properties coverage',ratio:'9:16',width:1080,height:1920,fps:30,media:[{id:'m',path:${JSON.stringify(image)},type:'image',name:'Portrait',width:180,height:320},{id:'vm',path:${JSON.stringify(video)},type:'video',name:'Video source',duration:2,width:320,height:180,hasAudio:true},{id:'a',path:${JSON.stringify(audio)},type:'audio',name:'Audio',duration:1,hasAudio:true}],videoClips:[{id:'v',mediaId:'vm',in:0,out:2,effects:['vignette']}],overlayClips:[{id:'o',mediaId:'m',start:0,in:0,out:5}],audioClips:[{id:'a',mediaId:'a',start:0,in:0,out:1}],textClips:[{id:'t',text:'A title',start:0,duration:5},{id:'c',text:'A caption',caption:true,start:5,duration:2,words:[{text:'A',start:5,end:6},{text:'caption',start:6,end:7}]}]})`);
  // One row in the shared segmented container (28px options + 3px padding + border).
  for(const mode of ['edit','agent']) {
    await click('.workspace-switch button:'+ (mode==='edit'?'first-child':'last-child'));
    if(mode==='agent')await click('.agent-workspace-tools button:nth-child(2)');
    for(const [track,id] of [['video','v'],['overlay','o'],['text','t'],['text','c'],['audio','a'],['effect','video|v|vignette']]) {
      await q(`window.__fve.select(${JSON.stringify({track,id})})`);await wait(100);
      const metrics=await q('(()=>{const b=document.querySelector(".inspector-body");return {client:b.clientWidth,scroll:b.scrollWidth,title:document.querySelector(".inspector .panel-title").textContent}})()');
      check(mode+' '+id+' properties fit the panel',metrics.scroll<=metrics.client+1);
      if(id==='v'||id==='t') {
        const selector=id==='v'?'.ci-tabs > button':'.text-inspector > .seg-tabs > button';
        const count=await q(`document.querySelectorAll(${JSON.stringify(selector)}).length`);
        for(let n=0;n<count;n++) {
          await q(`document.querySelectorAll(${JSON.stringify(selector)})[${n}].click()`);await wait(100);
          check(mode+' '+id+' tab '+n+' stays inside inspector',await q('(()=>{const b=document.querySelector(".inspector-body");return b.scrollWidth<=b.clientWidth+1})()'));
        }
        if(id==='v') {
          const count=await q('document.querySelectorAll(".grade-tabs > button").length');
          for(let n=0;n<count;n++) {
            await q(`document.querySelectorAll('.grade-tabs > button')[${n}].click()`);await wait(100);
            check(mode+' color tab '+n+' fits inspector',await q('(()=>{const b=document.querySelector(".inspector-body");return b.scrollWidth<=b.clientWidth+1})()'));
          }
        }
      }
      if(id==='t'||id==='v')fs.writeFileSync(path.join(dir,mode+'-'+id+'-properties.png'),(await win.capturePage()).toPNG());
    }
  }
  await q('window.__fve.select(null)');await wait(100);
  for(const mode of ['edit','agent']) {
    await click('.workspace-switch button:'+(mode==='edit'?'first-child':'last-child'));await wait(80);
    check(mode+' aspect ratios form one compact row',await q('(()=>{const e=document.querySelector(".proj-ratios"),r=e.getBoundingClientRect(),b=[...e.querySelectorAll("button")].map(e=>e.getBoundingClientRect());return b.length===6&&r.height<=36&&b.every(x=>Math.abs(x.top-b[0].top)<1&&x.left>=r.left&&x.right<=r.right+1)})()'));
  }
  await q('document.querySelectorAll(".proj-ratio")[5].click()');await wait(80);
  check('compact ratio choices still update format and selection',await q('window.__fve.rawProject().ratio==="21:9"&&document.querySelectorAll(".proj-ratio")[5].getAttribute("aria-checked")==="true"'));
  fs.writeFileSync(path.join(dir,'compact-ratios.png'),(await win.capturePage()).toPNG());
  win.setSize(1000,640);await wait(150);
  check('native minimum window keeps editor panels on screen',await q('(()=>{return [".pilot-shell",".player",".timeline",".inspector"].every(s=>{const r=document.querySelector(s).getBoundingClientRect();return r.left>=0&&r.right<=innerWidth+1&&r.top>=0&&r.bottom<=innerHeight+1})})()'));
  fs.writeFileSync(path.join(dir,'native-minimum.png'),(await win.capturePage()).toPNG());
  check('no renderer exceptions',!result.errors.length);
 }catch(e){result.error=e.stack;result.overflow=await q('(()=>{const b=document.querySelector(".inspector-body");if(!b)return [];const r=b.getBoundingClientRect();return [...b.querySelectorAll("*")].filter(e=>e.getBoundingClientRect().right>r.right-8).map(e=>({cls:e.className,text:e.textContent.slice(0,50),width:e.getBoundingClientRect().width,right:e.getBoundingClientRect().right,edge:r.right})).slice(0,20)})()');fs.writeFileSync(path.join(dir,'failure.png'),(await win.capturePage()).toPNG());}
 fs.writeFileSync(path.join(dir,'result.json'),JSON.stringify(result,null,2));app.exit(result.error?1:0);
};
