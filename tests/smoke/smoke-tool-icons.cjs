// Render the actual component and stylesheet in an isolated editor. The chat
// contains display fixtures; this check never invokes a model or editing tools.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const Module=require('node:module');
module.exports=async(win,app,dir)=>{
  const q=code=>win.webContents.executeJavaScript(code),wait=ms=>new Promise(r=>setTimeout(r,ms));
  const until=async code=>{for(let i=0;i<300;i++){if(await q(code))return;await wait(50);}throw Error('Timeout: '+code);};
  const result={checks:[],errors:[]},check=(name,value)=>{assert.ok(value,name);result.checks.push(name);};
  win.webContents.setBackgroundThrottling(false);win.setSize(1440,1100);
  win.webContents.on('console-message',(_e,level,message)=>{if(level>=3)result.errors.push(message);});
  try{
    const filename=path.resolve(__dirname,'../../src/features/agent/components/ToolCallIcon.jsx');
    const compiled=new Module(filename,module);compiled.filename=filename;compiled.paths=Module._nodeModulePaths(path.dirname(filename));
    compiled._compile(require('esbuild').transformSync(fs.readFileSync(filename,'utf8'),{loader:'jsx',format:'cjs'}).code,filename);
    const {default:Icon,TOOL_ICONS}=compiled.exports,React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
    const markup=name=>renderToStaticMarkup(React.createElement(Icon,{name}));
    await until('!!window.__fve&&!!document.querySelector(".home-frame-card")');
    await q('document.querySelector(".home-frame-card").click()');await until('!!document.querySelector(".topbar")');
    await until('!!document.querySelector(".welcome-go")');await q('document.querySelector(".welcome-go").click()');
    const ff=require('../../electron/media/ffmpeg.cjs'),{execFileSync}=require('node:child_process');
    const wave=path.join(dir,'wave.png');
    execFileSync(ff.ffmpegPath,['-v','error','-y','-f','lavfi','-i','aevalsrc=0.25*sin(440*2*PI*t)*(0.3+0.7*sin(2*PI*0.8*t)^2):s=16000:d=8','-filter_complex','showwavespic=s=320x100:colors=0xc6c8df','-frames:v','1',wave]);
    const steps=[
      {name:'set_volume',title:'Adjusting narration volume',description:'Voice-over.wav · 00:00.0 · 85% level'},
      {name:'set_volume_envelope',title:'Shaping volume over time',description:'Voice-over.wav · 00:00.0 · 2 volume points'},
      {name:'duck_audio',title:'Making room for the narration',description:'Background music · lower during speech'},
    ].map((s,i)=>({id:'s'+i,name:s.name,label:s.title,status:'done',activity:{title:s.title,description:s.description,outcome:'Applied to the timeline',visuals:[{src:wave,label:'Voice-over.wav',type:'audio',at_sec:0,duration_sec:8}]}}));
    const fixture={id:'tool-artwork',name:'Tool artwork review',width:1920,height:1080,fps:24,ratio:'16:9',media:[],videoClips:[],overlayClips:[],audioClips:[],textClips:[],effectClips:[],craftAI:{version:1,activeSessionId:'icons',sessions:[{id:'icons',title:'Audio finishing',draft:'',contents:[],messages:[{role:'user',text:'Balance the narration and soften the music underneath it.'},{role:'assistant',text:'The narration levels and music are balanced.',steps}]}]}};
    await q(`window.__fve.load(${JSON.stringify(fixture)})`);await q('document.querySelector(".pilot-fab").click()');
    await until('document.querySelectorAll(".pilot-panel [data-tool-icon]").length===3');
    await until('[...document.querySelectorAll(".pilot-panel .pilot-media-tile img")].every(i=>i.complete&&i.naturalWidth>0)');
    await q('(()=>{const list=document.querySelector(".pilot-list"),row=list.querySelector(".pilot-activity");list.scrollTop+=row.getBoundingClientRect().top-list.getBoundingClientRect().top-8;})()');await wait(120);
    check('saved chat displays the new volume, envelope and ducking glyphs',await q('[...document.querySelectorAll(".pilot-panel [data-tool-icon]")].map(i=>i.dataset.glyph).join() === "volume,envelope,duck"'));
    const rect=await q('(()=>{const r=document.querySelector(".pilot-panel").getBoundingClientRect();return {x:Math.floor(r.x),y:Math.floor(r.y),width:Math.ceil(r.width),height:Math.ceil(r.height)};})()');
    fs.writeFileSync(path.join(dir,'audio-in-chat.png'),(await win.capturePage(rect)).toPNG());
    const names=Object.keys(TOOL_ICONS),unique=names.filter((name,i)=>names.findIndex(n=>TOOL_ICONS[n]===TOOL_ICONS[name])===i);
    const items=unique.map(name=>`<li class="pilot-activity">${markup(name)}<div><b>${name.replaceAll('_',' ')}</b><small>${TOOL_ICONS[name]}</small></div></li>`).join('');
    const gallery=`<section id="tool-art-review"><h1>ClipCraft · Tool glyphs</h1><p>Original vector artwork · 32-unit grid · contextual outline + action accent</p><ul class="pilot-steps">${items}</ul></section>`;
    await q(`(()=>{const style=document.createElement('style');style.textContent='#tool-art-review{position:fixed;inset:0;z-index:99999;background:#101019;padding:28px 32px;overflow:auto;color:#f1effa}#tool-art-review h1{font:600 22px Inter,system-ui;margin:0 0 8px}#tool-art-review>p{color:#9293a7;font:12px Inter,system-ui;margin:0 0 22px}#tool-art-review .pilot-steps{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px;margin:0;padding:0}#tool-art-review li.pilot-activity{display:flex;gap:12px;align-items:center;padding:9px 10px;border:1px solid #ffffff0b;border-radius:10px;background:#ffffff02;min-width:0}#tool-art-review b{display:block;font-size:11px;font-weight:500;color:#e2dfea}#tool-art-review small{display:block;font-size:10px;margin-top:3px;color:#7d7f96}';document.head.append(style);document.body.insertAdjacentHTML('beforeend',${JSON.stringify(gallery)});})()`);
    const bounds=await q('[...document.querySelectorAll("#tool-art-review svg")].map(s=>{const r=s.getBBox();return {name:s.parentElement.dataset.toolIcon,x:r.x,y:r.y,right:r.x+r.width,bottom:r.y+r.height};})');
    check('every unique tool glyph renders',bounds.length===unique.length);
    check('all glyphs fit their viewBox with room for the stroke',bounds.every(b=>b.x>=1&&b.y>=1&&b.right<=31&&b.bottom<=31));
    result.glyphs=unique.length;result.toolNames=names.length;result.bounds=bounds;
    for(const name of [...names,'mcp_example_tool','unknown_future_tool'])check(name+' renders without external assets',markup(name).includes('<svg')&&!markup(name).includes('<image'));
    check('glyphs share a consistent square tile and stroke',await q('[...document.querySelectorAll("#tool-art-review [data-tool-icon]")].every(e=>{const r=e.getBoundingClientRect();return r.width===34&&r.height===34&&e.querySelector("svg").getAttribute("stroke-width")==="1.8";})'));
    await wait(120);fs.writeFileSync(path.join(dir,'icon-gallery.png'),(await win.capturePage()).toPNG());
    check('renderer has no runtime errors',!result.errors.length);
  }catch(error){result.error=error.stack;}
  fs.writeFileSync(path.join(dir,'result.json'),JSON.stringify(result,null,2));app.exit(result.error?1:0);
};
