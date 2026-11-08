// Built-renderer proof: every bundled font decodes without access to raw npm font packages.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{execFileSync}=require('node:child_process');
module.exports=async(win,app,dir)=>{
 const result={checks:[],rawFontRequests:[],fontRequests:[]},check=(name,value)=>{assert.ok(value,name);result.checks.push(name);};
 const q=s=>win.webContents.executeJavaScript(s),wait=ms=>new Promise(r=>setTimeout(r,ms));
 const until=async(code)=>{const end=Date.now()+30000;while(Date.now()<end){if(await q(code))return;await wait(30);}throw Error('Timed out: '+code);};
 const session=win.webContents.session;
 session.webRequest.onBeforeRequest({urls:['*://*/*']},(details,done)=>{const raw=/node_modules\/\@fontsource/.test(details.url);if(raw)result.rawFontRequests.push(details.url);done({cancel:raw});});
 session.webRequest.onCompleted({urls:['*://*/*']},details=>{if(/\.woff2?(?:\?|$)/.test(details.url))result.fontRequests.push({url:details.url,status:details.statusCode});});
 const ff=require('../../electron/media/ffmpeg.cjs');
 try{
  await until('!!window.__fve&&!!document.querySelector(".home-frame-card")');await q('document.querySelector(".home-frame-card").click()');await until('!!document.querySelector(".topbar")');
  result.fonts=await q('(async()=>{const faces=[...document.fonts];await Promise.all(faces.map(face=>face.load()));await document.fonts.ready;return {registered:faces.length,loaded:faces.filter(f=>f.status==="loaded").length,families:[...new Set(faces.map(f=>f.family))]};})()');
  check('every registered bundled font loads from the built renderer',result.fonts.registered>100&&result.fonts.loaded===result.fonts.registered);
  check('Latin, Arabic and variable UI fonts remain available',await q('document.fonts.check(\'900 32px "Montserrat"\',"Hello")&&document.fonts.check(\'700 32px "Cairo"\',"مرحبا")&&document.fonts.check(\'400 32px "Inter Variable"\',"Hello")'));
  const style={start:0,duration:1,size:48,x:.5,bold:true,color:'#ffffff',stroke:{width:0},shadow:{on:false},animIn:{id:'none'},animOut:{id:'none'}};
  const p={id:'font-packaging',name:'Font packaging',width:640,height:360,fps:30,ratio:'16:9',background:'#000000',media:[],videoClips:[{id:'gap',gap:true,in:0,out:1,speed:1}],overlayClips:[],audioClips:[],effectClips:[],textClips:[{...style,id:'latin',text:'ClipCraft Fonts',font:'montserrat',y:.3},{...style,id:'arabic',text:'مرحبا بالعالم',font:'cairo',y:.7}]};
  await q('window.__fve.load('+JSON.stringify(p)+')');await q('window.__fve.seek(.5)');await wait(200);
  const rect=await q('(()=>{const r=document.querySelector(".stage").getBoundingClientRect();return {x:Math.round(r.x),y:Math.round(r.y),width:Math.floor(r.width),height:Math.floor(r.height)}})()');
  const image=await win.capturePage(rect),bitmap=image.toBitmap(),size=image.getSize();fs.writeFileSync(path.join(dir,'preview.png'),image.toPNG());
  const bright=(data,w,h,channels)=>{const counts=[0,0];for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=channels*(y*w+x);if(data[i]>180&&data[i+1]>180&&data[i+2]>180)counts[y<h/2?0:1]++;}return counts;};
  result.previewPixels=bright(bitmap,size.width,size.height,4);check('Latin and Arabic text are visible in the actual preview',result.previewPixels.every(n=>n>100));
  await q('window.__fve.exportNow()');check('text export completes in the real app',await q('!!document.querySelector(".modal-icon.ok")'));
  const output=path.join(dir,'ui-export.mp4'),frame=execFileSync(ff.ffmpegPath,['-v','error','-i',output,'-ss','0.5','-frames:v','1','-pix_fmt','rgb24','-f','rawvideo','pipe:1']);result.exportPixels=bright(frame,640,360,3);
  check('export retains Latin and Arabic text pixels',result.exportPixels.every(n=>n>100));
  check('bundled fonts use WOFF2 exclusively',result.fontRequests.every(r=>/\.woff2(?:\?|$)/.test(r.url)));
  check('no raw dependency font is requested',result.rawFontRequests.length===0);
  check('font requests use packaged renderer assets',result.fontRequests.length>0&&result.fontRequests.every(r=>r.url.includes('/assets/')&&r.status===200));
 }catch(error){result.error=error.stack;}
 session.webRequest.onBeforeRequest(null);session.webRequest.onCompleted(null);
 fs.writeFileSync(path.join(dir,'result.json'),JSON.stringify(result,null,2));app.exit(result.error?1:0);
};
