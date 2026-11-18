// A transition from a gap (a deleted, deactivated or hidden clip) runs against the background in the
// player, as the export's xfade with the gap's background frames does (not a hard cut).
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
  const W=320,H=180,source=path.join(dir,'white.png');
  execFileSync(ff.ffmpegPath,['-v','error','-y','-f','lavfi','-i',`color=c=white:s=${W}x${H}`,'-frames:v','1',source]);
  const media={...await ff.probe(source),id:'m',path:source,name:'White'};
  // A (2 s), a 2 s gap (B deleted with the magnet off), C fading in from the gap over 1 s (timeline 3..4),
  // then D deactivated: its fade-in becomes a fade from C into the background.
  const project={id:'gap-transition',name:'Gap transition',ratio:'16:9',width:W,height:H,fps:10,background:'#000000',media:[media],magnet:{video:false,overlay:false,audio:true,text:false},
   videoClips:[{id:'a',mediaId:'m',in:0,out:2,speed:1},{id:'g',gap:true,in:0,out:2,speed:1},{id:'c',mediaId:'m',in:0,out:3,speed:1,transition:{type:'fade',duration:1,timelineOverlap:1}},
    {id:'d',mediaId:'m',in:0,out:3,speed:1,disabled:true,transition:{type:'fade',duration:1}}],overlayClips:[],audioClips:[],textClips:[],effectClips:[]};
  await q('window.__fve.load('+JSON.stringify(project)+')');await wait(300);
  // What the stage shows, as a brightness from 0 (the black background) to 1 (the white picture):
  // the visible slots composited bottom to top at their opacity; a gap's slot is filled with the background.
  const shown=()=>q(`(()=>{let lum=0;const slots=[...document.querySelectorAll('.stage > .slot')].filter(s=>s.style.visibility==='visible').sort((a,b)=>Number(a.style.zIndex)-Number(b.style.zIndex));
   for(const s of slots){const gap=s.querySelector('.layer').style.display==='none',op=s.style.opacity===''?1:Number(s.style.opacity);lum=lum*(1-op)+(gap?0:1)*op;}return lum;})()`);
  const previews=[];
  for(const time of [3.3,3.5,3.7,5.5]){await q('window.__fve.seek('+time+')');await wait(200);previews.push({time,white:await shown()});}
  await q('window.__fve.exportNow()');check('app export completes',await q('!!document.querySelector(".modal-icon.ok")'));await q('[...document.querySelectorAll(".modal-backdrop button")].find(b=>b.textContent.trim()==="OK")?.click()');
  const file=path.join(dir,'ui-export.mp4');
  const mean=t=>{const b=execFileSync(ff.ffmpegPath,['-v','error','-ss',String(t),'-i',file,'-frames:v','1','-f','rawvideo','-pix_fmt','gray','-']);return b.reduce((s,v)=>s+v,0)/b.length;};
  // Brightness on the same 0..1 scale: the exported black (the gap) and white (clip A) frames as its ends.
  const black=mean(2.5),white=mean(1),frame=t=>(mean(t)-black)/(white-black);
  for(const {time,white} of previews){const exported=frame(time);result.measurements.push({time,preview:white,export:exported});save();
   check(`the preview at ${time} s shows the clip at the export's strength (${white.toFixed(2)} vs ${exported.toFixed(2)})`,Math.abs(white-exported)<0.12);}
  check('the fade from the gap is not a hard cut',previews[0].white<0.5&&previews[2].white>0.5);
  check('the fade into a deactivated clip runs to the background',previews[3].white>0.2&&previews[3].white<0.8);
 }catch(error){result.error=error.stack;}save();app.exit(result.error?1:0);
};
