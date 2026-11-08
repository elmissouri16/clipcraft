const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const version=require('../../package.json').version.split('.').slice(0,2).join('.');
module.exports=async(win,app,dir)=>{
 const q=s=>win.webContents.executeJavaScript(s),wait=ms=>new Promise(r=>setTimeout(r,ms)),result={checks:[],layouts:[],errors:[]};
 const until=async(code)=>{const end=Date.now()+20000;while(Date.now()<end){if(await q(code))return;await wait(40);}throw Error('Timed out: '+code);};
 const check=(name,value)=>{assert.ok(value,name);result.checks.push(name);};
 win.webContents.on('console-message',(_e,level,text)=>{if(level>=3&&!/ERR_FILE_NOT_FOUND|Failed to load resource/.test(text))result.errors.push(text);});
 try{
  await until('!!window.__fve&&!!document.querySelector(".home-frame-card")');
  const names=['A Good Heart — A Dark Romance','Untitled','هل تعلم؟ اقتصاد المغرب في دقيقة واحدة مع عنوان طويل لاختبار المحاذاة','A landscape project with a longer title that wraps cleanly','Missing thumbnail'];
  const paths=names.map((name,i)=>{const file=path.join(dir,'project-'+i+'.clipcraft.json');fs.writeFileSync(file,JSON.stringify({id:'home-'+i,name,width:640,height:360,fps:30,ratio:'16:9',media:[],videoClips:[],overlayClips:[],audioClips:[],textClips:[],effectClips:[]}));return file;});
  await q(`(()=>{
   const names=${JSON.stringify(names)},paths=${JSON.stringify(paths)};
   const image=(w,h,color,label)=>{const c=document.createElement('canvas');c.width=w;c.height=h;const x=c.getContext('2d');x.fillStyle=color;x.fillRect(0,0,w,h);x.fillStyle='white';x.font='bold 22px sans-serif';x.fillText(label,12,Math.round(h/2));return c.toDataURL();};
   const sprite=document.createElement('canvas');sprite.width=360;sprite.height=320;const sx=sprite.getContext('2d');sx.fillStyle='#d93648';sx.fillRect(0,0,180,320);sx.fillStyle='#285bdd';sx.fillRect(180,0,180,320);sx.fillStyle='white';sx.font='22px sans-serif';sx.fillText('Frame 1',12,160);sx.fillText('Frame 2',192,160);
   const thumbs=[{kind:'image',src:image(180,320,'#5e397f','Portrait')},{kind:'image',src:image(180,320,'#426c48','Portrait')},{kind:'sprite',src:sprite.toDataURL(),w:180,h:320,count:2,at:1},{kind:'image',src:image(320,180,'#806035','Landscape')},{kind:'image',src:'file:///clipcraft-fixture-missing.png'}];
   localStorage.setItem('clipcraft.recents',JSON.stringify(names.map((name,i)=>({name,path:paths[i],ratio:i===3?'16:9':'9:16',modifiedAt:Date.now()-i*1000,thumb:thumbs[i]}))));
  })()`);
  await new Promise(resolve=>{win.webContents.once('did-finish-load',resolve);win.webContents.reload();});
  await until('document.querySelectorAll(".home-card").length===5');
  win.setMinimumSize(360,400);
  for(const width of [1440,1080,720,480]){
   win.setContentSize(width,960);await wait(350);await q('document.querySelector(".home-recents").scrollIntoView({block:"start"})');await wait(300);
   const layout=await q(`(()=>{const rect=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height}};const cards=[...document.querySelectorAll('.home-card')];return {width:innerWidth,overflow:document.querySelector('.home').scrollWidth>document.querySelector('.home').clientWidth+1,cards:cards.map(c=>({card:rect(c),thumb:rect(c.querySelector('.home-card-thumb')),name:rect(c.querySelector('.home-card-name')),meta:rect(c.querySelector('.home-card-meta')),remove:rect(c.querySelector('.home-card-x'))}))};})()`);
   result.layouts.push(layout);check('no horizontal overflow at '+width,!layout.overflow);
   const first=layout.cards[0];check('uniform card and preview sizes at '+width,layout.cards.every(c=>Math.abs(c.card.w-first.card.w)<1&&Math.abs(c.card.h-first.card.h)<1&&Math.abs(c.thumb.h-first.thumb.h)<1));
   check('consistent preview proportions at '+width,layout.cards.every(c=>Math.abs(c.thumb.w/c.thumb.h-1.6)<.01));
   check('titles and dates align within each row at '+width,layout.cards.every(c=>layout.cards.filter(o=>Math.abs(o.card.y-c.card.y)<1).every(o=>Math.abs(o.name.y-c.name.y)<1&&Math.abs(o.meta.y-c.meta.y)<1)));
   check('remove controls remain inside thumbnails at '+width,layout.cards.every(c=>c.remove.x>=c.thumb.x&&c.remove.x+c.remove.w<=c.thumb.x+c.thumb.w+1&&c.remove.y+c.remove.h<=c.thumb.y+c.thumb.h));
   const screenshot=await win.capturePage();fs.writeFileSync(path.join(dir,'home-'+width+'.png'),screenshot.toPNG());
   if(width===1440){
    const pixels=screenshot.toBitmap(),size=screenshot.getSize(),scale=size.width/layout.width,thumb=layout.cards[2].thumb;
    const pixel=(x,y)=>{const i=4*(Math.floor(y*scale)*size.width+Math.floor(x*scale));return [...pixels.subarray(i,i+3)].reverse();};
    result.spritePixels={frame:pixel(thumb.x+thumb.w*.5,thumb.y+thumb.h*.25),margin:pixel(thumb.x+thumb.w*.1,thumb.y+thumb.h*.25)};
    check('sprite shows the chosen frame with no neighboring-frame bleed',result.spritePixels.frame[2]>result.spritePixels.frame[0]+60&&result.spritePixels.margin[0]<80);
   }
   if(width===480)check('narrow search aligns with the cards',await q('(()=>{const s=document.querySelector(".home-search-wrap").getBoundingClientRect(),c=document.querySelector(".home-card").getBoundingClientRect();return Math.abs(s.x-c.x)<1&&Math.abs(s.right-c.right)<1;})()'));

  }
  check('one compact resume card shares the project grid',await q('document.querySelectorAll(".home-grid .home-card-latest").length===1&&!document.querySelector(".home-continue")'));
  check('sprite framing and broken-thumbnail placeholder remain available',await q('!!document.querySelector(".home-card-sprite clipPath")&&!!document.querySelector(".home-card:last-child .home-card-thumb > svg:not(.home-card-sprite)")'));
  const setSearch=value=>q(`(()=>{const input=document.querySelector('.home-search');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await setSearch('المغرب');await until('document.querySelectorAll(".home-card").length===1');check('Arabic search retains the matching project',await q('document.querySelector(".home-card-name").textContent.includes("المغرب")'));
  await setSearch('no project has this name');await until('!document.querySelector(".home-card")');check('search empty state is shown',await q('document.querySelector(".home-recents").textContent.includes("No projects match")'));
  await setSearch('');await until('document.querySelectorAll(".home-card").length===5');
  await q('document.querySelector(".home-card:last-child .home-card-x").click()');await until('document.querySelectorAll(".home-card").length===4');check('remove does not open the project',await q('!!document.querySelector(".home")&&!document.querySelector(".topbar")'));
  check('the version badge shows the actual version and the footer is gone',await q(`document.querySelector(".home-ver").textContent===${JSON.stringify('Version '+version)}&&!document.querySelector(".home-foot")`));
  await q('document.querySelector(".home-card-latest .home-card-open").click()');await until('!!document.querySelector(".topbar")');check('Resume opens the selected saved project',await q('window.__fve.rawProject().name==="A Good Heart — A Dark Romance"'));
  check('no renderer exceptions',result.errors.length===0);
 }catch(error){result.error=error.stack;fs.writeFileSync(path.join(dir,'failure.png'),(await win.capturePage()).toPNG());}
 fs.writeFileSync(path.join(dir,'result.json'),JSON.stringify(result,null,2));app.exit(result.error?1:0);
};
