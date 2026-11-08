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
   if(width===480)check('narrow search and view switch span the cards',await q('(()=>{const s=document.querySelector(".home-tools").getBoundingClientRect(),c=document.querySelector(".home-grid").getBoundingClientRect();return Math.abs(s.x-c.x)<1&&Math.abs(s.right-c.right)<1;})()'));
   check('the five formats fit without overflow at '+width,await q('(()=>{const g=document.querySelector(".home-formats");return [...g.children].length===5&&[...g.children].every(c=>c.getBoundingClientRect().right<=g.getBoundingClientRect().right+1)})()'));

  }
  win.setContentSize(1440,960);await wait(300);
  check('the header offers open, import and record, and the home has no donation link',await q(`(()=>{const a=[...document.querySelectorAll('.home-top .home-action')].map(b=>b.textContent.trim());return a.join('|')==='Open project|Import media|Record screen'&&!document.querySelector('.home img[src*="paypal"]')&&!/support the project|paypal/i.test(document.querySelector('.home').textContent)})()`));
  // The list view: one row per project with format, date and location, remembered across reloads.
  await q('document.querySelector(\'button[aria-label="List view"]\').click()');await until('document.querySelectorAll(".home-list .home-row.home-card").length===5');
  check('list view shows each project with name, format, date and location',await q(`(()=>{const r=document.querySelector('.home-list .home-row.home-card');const cells=[...r.querySelectorAll('.home-row-cell')].map(c=>c.textContent);return r.querySelector('.home-card-name').textContent==='A Good Heart — A Dark Romance'&&cells[0]==='9:16'&&cells[1]==='Today'&&cells[2]==='project-0.clipcraft.json'})()`));
  fs.writeFileSync(path.join(dir,'home-list-1440.png'),(await win.capturePage()).toPNG());
  await new Promise(resolve=>{win.webContents.once('did-finish-load',resolve);win.webContents.reload();});
  await until('document.querySelectorAll(".home-list .home-row.home-card").length===5');check('the chosen view is remembered',true);
  await q('document.querySelector(\'button[aria-label="Grid view"]\').click()');await until('document.querySelectorAll(".home-grid .home-card").length===5');
  check('one compact resume card shares the project grid',await q('document.querySelectorAll(".home-grid .home-card-latest").length===1&&!document.querySelector(".home-continue")'));
  // The broken thumbnail swaps to the placeholder once its image fails to load (lazy, after a view switch).
  await until('!!document.querySelector(".home-card:last-child .home-card-thumb > svg:not(.home-card-sprite)")');
  check('sprite framing and broken-thumbnail placeholder remain available',await q('!!document.querySelector(".home-card-sprite clipPath")&&!!document.querySelector(".home-card:last-child .home-card-thumb > svg:not(.home-card-sprite)")'));
  const setSearch=value=>q(`(()=>{const input=document.querySelector('.home-search');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await setSearch('المغرب');await until('document.querySelectorAll(".home-card").length===1');check('Arabic search retains the matching project',await q('document.querySelector(".home-card-name").textContent.includes("المغرب")'));
  await setSearch('no project has this name');await until('!document.querySelector(".home-card")');check('search empty state is shown',await q('document.querySelector(".home-recents").textContent.includes("No projects match")'));
  await setSearch('');await until('document.querySelectorAll(".home-card").length===5');
  // Remove asks first: Cancel and Escape keep the project, confirming removes it without opening it.
  await q('document.querySelector(".home-card:last-child .home-card-x").click()');await until('!!document.querySelector(\'[role="alertdialog"]\')');
  const dialog=await q(`(()=>{const d=document.querySelector('[role="alertdialog"]');return {title:d.querySelector('h3').textContent,text:d.querySelector('p').textContent,focused:document.activeElement.textContent.trim()}})()`);
  result.removeDialog=dialog;
  check('remove asks for confirmation, says the file stays and focuses Cancel',dialog.title==='Remove “Missing thumbnail” from projects?'&&/file stays on disk \(project-4\.clipcraft\.json\)/.test(dialog.text)&&dialog.focused==='Cancel');
  fs.writeFileSync(path.join(dir,'home-remove-dialog.png'),(await win.capturePage()).toPNG());
  await q('[...document.querySelectorAll(\'[role="alertdialog"] button\')].find(b=>b.textContent.trim()==="Cancel").click()');await until('!document.querySelector(\'[role="alertdialog"]\')');
  check('Cancel keeps the project',await q('document.querySelectorAll(".home-card").length===5'));
  await q('document.querySelector(".home-card:last-child .home-card-x").click()');await until('!!document.querySelector(\'[role="alertdialog"]\')');
  win.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'});await until('!document.querySelector(\'[role="alertdialog"]\')');
  check('Escape keeps the project',await q('document.querySelectorAll(".home-card").length===5'));
  await q('document.querySelector(".home-card:last-child .home-card-x").click()');await until('!!document.querySelector(\'[role="alertdialog"]\')');
  await q('[...document.querySelectorAll(\'[role="alertdialog"] button\')].find(b=>b.textContent.trim()==="Remove").click()');
  await until('document.querySelectorAll(".home-card").length===4');check('confirming removes the project and does not open it',await q('!!document.querySelector(".home")&&!document.querySelector(".topbar")'));
  // A project that was only auto-saved (no file) is deleted for good, and the dialog says so.
  await q(`window.api.slotWrite({id:'draftonly1',title:'Draft only',ratio:'9:16',updatedAt:Date.now()-864e6,projectJson:JSON.stringify({id:'draft',name:'Draft only',width:640,height:360,fps:30,ratio:'9:16',media:[],videoClips:[],overlayClips:[],audioClips:[],textClips:[],effectClips:[]})})`);
  await new Promise(resolve=>{win.webContents.once('did-finish-load',resolve);win.webContents.reload();});
  await until('[...document.querySelectorAll(".home-card-name")].some(n=>n.textContent==="Draft only")');
  await q('[...document.querySelectorAll(".home-card")].find(c=>c.querySelector(".home-card-name").textContent==="Draft only").querySelector(".home-card-x").click()');
  await until('!!document.querySelector(\'[role="alertdialog"]\')');
  const draftDialog=await q(`(()=>{const d=document.querySelector('[role="alertdialog"]');return {title:d.querySelector('h3').textContent,text:d.querySelector('p').textContent,button:[...d.querySelectorAll('button')].pop().textContent.trim()}})()`);
  result.draftDialog=draftDialog;
  check('an auto-saved-only project is announced as a permanent delete',draftDialog.title==='Delete “Draft only”?'&&/deleted permanently/.test(draftDialog.text)&&draftDialog.button==='Delete project');
  await q('[...document.querySelectorAll(\'[role="alertdialog"] button\')].find(b=>b.textContent.trim()==="Delete project").click()');
  await until('![...document.querySelectorAll(".home-card-name")].some(n=>n.textContent==="Draft only")');
  check('confirming deletes its auto-saved copy',await q('window.api.slotList().then(l=>!l.some(s=>s.id==="draftonly1"))'));
  check('the version badge shows the actual version and the footer is gone',await q(`document.querySelector(".home-ver").textContent===${JSON.stringify('Version '+version)}&&!document.querySelector(".home-foot")`));
  await q('document.querySelector(".home-card-latest .home-card-open").click()');await until('!!document.querySelector(".topbar")');check('Resume opens the selected saved project',await q('window.__fve.rawProject().name==="A Good Heart — A Dark Romance"'));
  check('no renderer exceptions',result.errors.length===0);
 }catch(error){result.error=error.stack;fs.writeFileSync(path.join(dir,'failure.png'),(await win.capturePage()).toPNG());}
 fs.writeFileSync(path.join(dir,'result.json'),JSON.stringify(result,null,2));app.exit(result.error?1:0);
};
