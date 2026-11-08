const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
module.exports=async(win,app,dir)=>{
 const q=s=>{new (require('node:vm').Script)(s);return win.webContents.executeJavaScript(s);},wait=ms=>new Promise(r=>setTimeout(r,ms));
 const until=async s=>{for(let i=0;i<200;i++){if(await q(s))return;await wait(50);}throw Error('Timeout: '+s);};
 const click=s=>q(`document.querySelector(${JSON.stringify(s)}).click()`);
 const result={surfaces:[],scrolls:[],checks:[],errors:[]};
 const check=(name,ok)=>{assert.ok(ok,name);result.checks.push(name);};
 win.webContents.setBackgroundThrottling(false);win.show();win.focus();win.webContents.focus();win.webContents.on('console-message',(_e,n,s)=>{if(n>=3)result.errors.push(s);});
 require('../../electron/system/settings.cjs').save({provider:'ollama'});
 const image=path.join(dir,'source.png');fs.writeFileSync(image,require('electron').nativeImage.createFromBitmap(Buffer.from([74,84,120,255]),{width:1,height:1}).resize({width:180,height:320}).toPNG());
 const project={id:'ux-layout',name:'مشروع طويل — Editor usability and scrolling check',ratio:'9:16',width:1080,height:1920,fps:30,
 media:Array.from({length:50},(_,i)=>({id:'m'+i,type:'image',path:image,poster:image,name:'Source '+i+' — a long filename to check truncation',width:180,height:320})),
 videoClips:[{id:'v',mediaId:'m0',in:0,out:120}],overlayClips:[],audioClips:[],effectClips:[],
 textClips:Array.from({length:30},(_,i)=>({id:'t'+i,text:'Caption '+i,start:i*3,duration:3,layer:i%5})),layers:{text:5,overlay:2,audio:2},
 craftAI:{version:1,activeSessionId:'chat',sessions:[{id:'chat',title:'Editing conversation',draft:'Refine the pacing of this section.',contents:[],messages:Array.from({length:40},(_,i)=>({role:i%2?'assistant':'user',text:'Message '+i+' — '+('A longer editing discussion with meaningful details. '.repeat(4))}))}]}};
 const capture=async (label,screenshot=true)=>{
  await wait(150);
  const data=await q(`(()=>{
   const rect=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height,right:r.right,bottom:r.bottom}};
   const selectors=['.topbar','.workspace-switch','.project-meta','.top-actions','.top-workspace-actions','.left','.player','.transport','.timeline','.tl-toolbar','.inspector','.inspector-body','.tab-frame','.tab-content','.pilot-shell','.pilot-list','.pilot-composer','.settings2','.set2-pane','.export-modal'];
   return {width:innerWidth,height:innerHeight,rootOverflow:document.querySelector('.app').scrollWidth>document.querySelector('.app').clientWidth+1,
    panels:selectors.flatMap(s=>{const e=document.querySelector(s);return e&&e.getBoundingClientRect().width?[{selector:s,...rect(e),client:e.clientWidth,scroll:e.scrollWidth}]:[]}),
    clippedControls:[...document.querySelectorAll('.tl-toolbar button,.transport button,.topbar button,.agent-workspace-tools button,.head-btns button,.src-seg button')].filter(e=>{const r=e.getBoundingClientRect();if(!r.width)return false;const p=e.closest('.tl-toolbar,.player,.topbar,.agent-workspace-tools,.left').getBoundingClientRect();return r.left<p.left-1||r.right>p.right+1||r.top<p.top-1||r.bottom>p.bottom+1}).map(e=>e.getAttribute('aria-label')||e.textContent)};
  })()`);
  result.surfaces.push({label,...data});
  check(label+': controls stay inside their panel',!data.clippedControls.length);
  check(label+': no horizontal panel overflow',data.panels.every(p=>p.scroll<=p.client+1));
  check(label+': workspace fits window',!data.rootOverflow&&data.panels.filter(p=>['.topbar','.left','.player','.timeline','.inspector','.pilot-shell','.settings2','.export-modal'].includes(p.selector)).every(p=>p.x>=0&&p.right<=data.width+1&&p.y>=0&&p.bottom<=data.height+1));
  if(screenshot)fs.writeFileSync(path.join(dir,label+'.png'),(await win.capturePage()).toPNG());
 };
 const scroll=async selector=>{
  const point=await q(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return null;const r=e.getBoundingClientRect();e.scrollTop=0;return {x:Math.round(r.x+r.width*.7),y:Math.round(r.y+r.height*.6),max:e.scrollHeight-e.clientHeight}})()`);if(!point||point.max<=0)return;
  win.webContents.sendInputEvent({type:'mouseMove',x:point.x,y:point.y});await wait(600);
  win.webContents.sendInputEvent({type:'mouseWheel',x:point.x,y:point.y,deltaY:-300,deltaX:0,canScroll:true});await wait(250);
  const top=await q(`document.querySelector(${JSON.stringify(selector)}).scrollTop`);
  result.scrolls.push({selector,max:point.max,top});check(selector+': native wheel scrolls content',top>0);
  win.webContents.sendInputEvent({type:'mouseWheel',x:point.x,y:point.y,deltaY:300,deltaX:0,canScroll:true});await wait(250);
  check(selector+': wheel scrolls back up',await q(`document.querySelector(${JSON.stringify(selector)}).scrollTop`)<top);
  check(selector+': scrolling does not move the app',await q('document.documentElement.scrollTop===0&&document.body.scrollTop===0'));

 };
 try{
  await until('!!window.__fve&&!!document.querySelector(".home-frame-card")');await click('.home-frame-card');await until('!!document.querySelector(".topbar")');await q('document.querySelector(".welcome-go")?.click()');await q(`window.__fve.load(${JSON.stringify(project)})`);
  for(const [w,h] of [[1000,640],[1400,860],[1920,1080]]){
   win.setContentSize(w,h);await wait(150);
   await click('.workspace-switch button:first-child');await capture('edit-'+w);await scroll('.tl-scroll');
   for(const tab of ['Media','Audio','Assets','Text','Effects','Transitions','Captions','Filters','Adjust']){await q(`window.__fve.tab(${JSON.stringify(tab.toLowerCase())})`);await capture('edit-'+w+'-'+tab);await scroll('.tab-content');}
   if(w===1000) {
    await q(`(()=>{const e=document.querySelector('.workspace .splitter.col');for(let n=0;n<6;n++)e.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',shiftKey:true,bubbles:true,cancelable:true}))})()`);
    for(const tab of ['Media','Audio','Assets','Text','Effects','Transitions','Captions','Filters','Adjust']){await q(`window.__fve.tab(${JSON.stringify(tab.toLowerCase())})`);await capture('narrow-'+tab,false);}
    await q(`document.querySelector('.workspace .splitter.col').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}))`);
   }
   await click('.workspace-switch button:last-child');await capture('agent-'+w);await scroll('.pilot-list');
   for(const n of [1,2]){await click('.agent-workspace-tools button:nth-child('+n+')');await capture('agent-'+w+'-tool'+n);if(n===2)await scroll('.inspector-body');}
   await click('.agent-workspace-tools button:last-child');
  }
  win.setContentSize(1000,640);await click('button[aria-label=Settings]');await until('!!document.querySelector(".settings2")');
  check('Settings receives keyboard focus',await q('document.querySelector(".settings2").contains(document.activeElement)'));
  await q('document.querySelector(".settings-head button").dispatchEvent(new KeyboardEvent("keydown",{key:"Delete",bubbles:true}))');
  check('dialog keys cannot edit the underlying timeline',await q('window.__fve.rawProject().videoClips.length===1&&window.__fve.history().past.length===0'));
  await q('document.activeElement.dispatchEvent(new KeyboardEvent("keydown",{key:"Tab",shiftKey:true,bubbles:true,cancelable:true}))');
  check('Shift-Tab stays inside Settings',await q('document.querySelector(".settings2").contains(document.activeElement)'));
  const settingsBounds=await q('(()=>{const r=document.querySelector(".settings2").getBoundingClientRect();return {top:r.top,height:r.height}})()');
  const pages=await q('document.querySelectorAll(".set2-rail button[data-section]").length');check('Settings lists its pages',pages>=6);
  for(let n=1;n<=pages;n++){await q(`document.querySelectorAll('.set2-rail button[data-section]')[${n-1}].click()`);await capture('settings-'+n);check('Settings stays aligned while changing sections',await q(`(()=>{const r=document.querySelector('.settings2').getBoundingClientRect();return Math.abs(r.top-${settingsBounds.top})<1&&Math.abs(r.height-${settingsBounds.height})<1})()`));check('Settings section starts at top',await q('document.querySelector(".set2-pane").scrollTop===0'));await scroll('.set2-pane');}
  await click('button[aria-label="Close settings"]');
  for(const w of [1000,1400]){win.setContentSize(w,640);await click('.top-export > button:first-child');await until('!!document.querySelector(".export-modal")');await capture('export-'+w);check('export action stays visible',await q('(()=>{const r=document.querySelector(".x-foot").getBoundingClientRect(),m=document.querySelector(".export-modal").getBoundingClientRect();return r.bottom<=m.bottom&&r.top>=m.top})()'));await scroll('.export-ready .x-body');await click('.export-modal button[aria-label=Close]');}
  check('no renderer exceptions',!result.errors.length);
 }catch(e){result.error=e.stack;result.overflow=await q('(()=>{const e=document.querySelector(".tab-content");if(!e)return [];const r=e.getBoundingClientRect();return [...e.querySelectorAll("*")].filter(n=>n.getBoundingClientRect().right>r.right-8).map(n=>({tag:n.tagName,cls:n.className,text:n.textContent.slice(0,70),right:n.getBoundingClientRect().right,parentRight:r.right,scroll:n.scrollWidth,client:n.clientWidth})).slice(0,30)})()');fs.writeFileSync(path.join(dir,'failure.png'),(await win.capturePage()).toPNG());}
 fs.writeFileSync(path.join(dir,'result.json'),JSON.stringify(result,null,2));app.exit(result.error?1:0);
};
