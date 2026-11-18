const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
module.exports=async(win,app,dir)=>{
  const q=s=>win.webContents.executeJavaScript(s),wait=ms=>new Promise(r=>setTimeout(r,ms));
  const result={checks:[],errors:[]};
  win.webContents.on('console-message',(_e,level,message)=>{if(level>=3)result.errors.push(message);});
  const until=async s=>{for(let i=0;i<400;i++){if(await q(s))return;await wait(75);}throw Error('Timeout '+s);};
  const check=(name,ok)=>{assert.ok(ok,name);result.checks.push(name);};
  const click=text=>q(`(()=>{const e=[...document.querySelectorAll('button')].find(e=>e.textContent.trim()===${JSON.stringify(text)});if(!e)throw Error('Missing button '+${JSON.stringify(text)});e.click();})()`);
  const select=async(label,value)=>{
    const labels={ 'Audio source':{library:'Library',online:'Online'},'Audio content type':{music:'Music',sfx:'Sound effects',trolls:'Memes'}, 'Photo provider':{openverse:'Openverse · no key needed',pixabay:'Pixabay'},'Photo licences':{cc0:'No credit required (CC0)',attribution:'Include credit-required media (CC BY)'},'Audio licences':{cc0:'No credit required (CC0)',attribution:'Include credit-required media (CC BY)'},'Audio provider':{sfx:'Openverse + SFXMint',soundza:'Soundza'}};
    if(!await q(`!!document.querySelector('button[aria-label="${label}"]')`)){await q('document.querySelector(".browser-filter-toggle").click()');await until(`!!document.querySelector('button[aria-label="${label}"]')`);}
    await q(`document.querySelector('button[aria-label="${label}"]').click()`);
    await until('!!document.querySelector(".dropdown.open [role=option]")');
    await q(`(()=>{const e=[...document.querySelectorAll('.dropdown.open [role=option]')].find(e=>e.textContent.trim()===${JSON.stringify(labels[label]?.[value] || value)});if(!e)throw Error('Missing option');e.click()})()`);
  };
  try{
    await until('!!document.querySelector(".home-frame-card")');await q('document.querySelector(".home-frame-card").click()');await until('!!document.querySelector(".topbar")');await q('document.querySelector(".welcome-go")?.click()');
    await q(`window.__fve.load({name:'Openverse check',width:640,height:360,fps:30,media:[],videoClips:[],overlayClips:[],audioClips:[],textClips:[],effectClips:[]});window.__fve.tab('media')`);
    await wait(250);await click('Stock');await click('Photos');
    await until('document.querySelectorAll(".stock-tile").length===1');
    check('Openverse default without Pixabay key',await q(`document.querySelector('.browser-summary').textContent.includes('Openverse')`));
    check('CC0 default and acknowledgement',await q('document.body.textContent.includes("not endorsed or certified by Openverse") && document.querySelector(".browser-summary").textContent.includes("CC0")'));
    await until('!!document.querySelector(".stock-tile img")');
    await q('document.querySelector(\'.stock-tile [aria-label="Add to the main track"]\').click()');await until('window.__fve.rawProject().videoClips.length===1');
    check('Photo imported with provenance',await q('window.__fve.rawProject().media[0].credit.origin==="openverse"'));
    await select('Photo licences','attribution');await until('document.querySelectorAll(".stock-tile").length===2');
    await q('document.querySelectorAll(\'.stock-tile [aria-label="Add as overlay"]\')[1].click()');await until('window.__fve.rawProject().overlayClips.length===1');
    check('CC BY overlay keeps attribution',await q('window.__fve.rawProject().media.some(m=>m.credit?.license==="by"&&m.credit.line.includes("CC BY 4.0"))'));
    await q('if(document.querySelector(".browser-filter-toggle").getAttribute("aria-expanded")=="true")document.querySelector(".browser-filter-toggle").click()');
    fs.writeFileSync(path.join(dir,'photos.png'),(await win.capturePage()).toPNG());
    await select('Photo provider','pixabay');await until('!!document.querySelector(".stock-key")');
    check('Pixabay remains available',await q('document.querySelector(".stock-key").textContent.includes("API key")'));
    await select('Photo provider','openverse');await until('document.querySelectorAll(".stock-tile").length===2');
    // Use the same persistent agent runner for search-result IDs and import.
    await q(`(async()=>{const {createToolRunner}=await import('/src/features/agent/tools.js');window.__ovRunner=createToolRunner({getProject:()=>window.__fve.rawProject(),dispatch:window.__fve.dispatch,settle:()=>new Promise(r=>setTimeout(r,80)),api:window.api,addProbed:res=>{const existing=window.__fve.rawProject().media.find(m=>m.path===res.path);if(existing)return existing;const m={...res,id:crypto.randomUUID()};window.__fve.dispatch({type:'addMedia',items:[m]});return m;}});})()`);
    const tool=(name,args)=>q(`window.__ovRunner.run(${JSON.stringify(name)},${JSON.stringify(args)})`);
    const sounds=await tool('search_sounds',{kind:'sfx',query:'whoosh',licenses:'attribution'});
    check('Agent finds CC BY sounds',sounds.sounds?.some(s=>s.needs_credit));
    const added=await tool('add_sound',{sound_id:sounds.sounds.find(s=>s.needs_credit).sound_id,start_sec:0});result.audioResult=added;check('Agent imports audio',!added.error);
    const photos=await tool('search_stock',{kind:'photo',query:'forest'});check('Agent photos default to CC0',photos.items.length===1&&photos.items[0].license==='CC0');
    const foundBy=await tool('search_stock',{kind:'photo',query:'forest',licenses:'attribution'});
    const photoAdded=await tool('add_stock',{stock_id:foundBy.items.find(i=>i.needs_credit).stock_id,duration_sec:1});
    check('Agent imports photo with publication credit',!photoAdded.error&&photoAdded.publication_credit.includes('https://creativecommons.org/licenses/by/4.0/'));
    const legacy=await q(`window.api.libraryAdd({id:'abefa1df-a6f9-40fb-9ef9-c471fb21cb92',provider:'freesound',license:'by',title:'Old favorite',url:'https://evil.example/tampered'})`);
    check('Legacy favorites recheck canonical record',!legacy.error&&legacy.credit.origin==='openverse'&&legacy.name==='Credit sound.wav');
    await q('window.__fve.tab("audio")');
    if(process.env.FVE_BROWSER_EMPTY_PACK){
      await until('!!document.querySelector(\'input[aria-label="Search the library"]\')');
      check('Missing music pack defaults to online search',await q('document.querySelector(".browser-destinations button.on").textContent==="Online"'));
      await click('Library');await until('document.querySelector(".empty-note")?.textContent.includes("not installed")');
      check('Missing collection is distinct from empty online search',true);
      await click('Online');await until('!!document.querySelector(\'input[aria-label="Search the library"]\')');
      check('Online remains reachable without the pack',true);check('No renderer errors',result.errors.length===0);
      fs.writeFileSync(path.join(dir,'missing-pack.png'),(await win.capturePage()).toPNG());fs.writeFileSync(path.join(dir,'result.json'),JSON.stringify(result,null,2));app.exit(0);return;
    }
    await until('!!document.querySelector(".pack-list .lib-row")');
    check('Installed music is the first Audio destination',await q('document.querySelector(".pack-list").textContent.includes("Original library music")'));
    await click('Online');await click('Sound effects');
    await until('!!document.querySelector(\'input[aria-label="Search the library"]\')');
    check('Audio UI defaults to CC0',await q(`document.querySelector('.browser-summary').textContent.includes('No credit required')`));
    await select('Audio licences','attribution');await until('document.querySelectorAll(".lib-row").length===2');
    check('Audio UI offers optional CC BY',true);
    await q('document.querySelector(".browser-filter-toggle").click()');
    fs.writeFileSync(path.join(dir,'audio-online.png'),(await win.capturePage()).toPNG());
    await select('Audio provider','soundza');await until('!!document.querySelector(".stock-key")');
    check('Soundza setup keeps provider switching reachable',await q('document.querySelector(".browser-summary").textContent.includes("Soundza")'));
    await click('Music');await until('document.querySelector(".browser-summary").textContent.startsWith("Openverse ·")');
    await click('Sound effects');await until('!!document.querySelector(".stock-key")');
    check('Sound-effects kind remembers its selected provider',await q('document.querySelector(".browser-summary").textContent.includes("Soundza")'));
    await select('Audio provider','sfx');await until('document.querySelectorAll(".lib-row").length===2');
    check('Audio source remembers its copyright filter',await q('document.querySelector(".browser-summary").textContent.includes("credit-required media")'));
    const search=async value=>{await q(`(()=>{const e=document.querySelector('input[aria-label="Search the library"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));})()`);await wait(60);await q('document.querySelector(".browser-search").requestSubmit()');};
    await select('Audio licences','cc0');await search('onlycredited');await until('!!document.querySelector(".browser-empty")');
    check('Empty filtered results explain attribution',await q('document.querySelector(".browser-empty").textContent.includes("current filters")&&!![...document.querySelectorAll("button")].find(e=>e.textContent==="Include credit-required media")'));
    await click('Include credit-required media');await until('document.querySelectorAll(".lib-row").length===1');
    check('Explicit attribution action preserves the query',await q('document.querySelector(\'input[aria-label="Search the library"]\').value==="onlycredited"'));
    await q('document.querySelector(".searchbox-clear").click()');await until('document.querySelectorAll(".lib-row").length===2');
    check('Clearing search restores the current source results',await q('document.querySelector(\'input[aria-label="Search the library"]\').value===""'));
    await search('onlycredited');await until('document.querySelectorAll(".lib-row").length===1');
    await click('Library');await until('!!document.querySelector(".pack-list .lib-row")');
    await q('document.querySelector(".pack-list .lib-play").click()');await wait(180);
    check('Installed music preview plays audio',win.webContents.isCurrentlyAudible());
    await q('document.querySelector(".pack-list .lib-play").click()');
    await q('document.querySelector(".pack-list .lib-add").click()');await until('window.__fve.rawProject().audioClips.length===2');
    check('Original music collection still adds to timeline',true);
    fs.writeFileSync(path.join(dir,'audio-library.png'),(await win.capturePage()).toPNG());
    await click('Sound effects');await until('document.querySelector(".pack-list")?.textContent.includes("Local ambient recording")');
    check('Installed SFX stay separate from online categories',true);
    await click('Online');await until('!!document.querySelector(\'input[aria-label="Search the library"]\')');
    check('Online search survives a visit to the local library',await q('document.querySelector(\'input[aria-label="Search the library"]\').value==="onlycredited"'));
    // Exercise real native parsing and UI pagination with original page records.
    // Only this source's network edge is replaced; IPC, parser and UI stay real.
    const {net}=require('electron'),nativeFetch=net.fetch,memeRequests=[];
    net.fetch=(input,...options)=>{
      const url=new URL(String(input));if(url.hostname!=='www.myinstants.com')return nativeFetch(input,...options);
      memeRequests.push(url.href);const page=Number(url.searchParams.get('page')||1),id=page===2?'22':'11';
      const html=`<div id="instants_container"><button onclick="play('/media/sounds/fixture-${id}.mp3', 'loader-${id}', 'fixture-${id}')"></button><a class="instant-link">Original page ${page}</a></div><div id="loading"></div>`;
      return Promise.resolve(new Response(page>=3?'':html,{status:page>=3?404:200,headers:{'content-type':'text/html'}}));
    };
    try{
      await click('Memes');await until('document.querySelector(".browser-summary")?.textContent.startsWith("MyInstants")&&!!document.querySelector(".lib-more")');
      await search('original pagination');await until('document.querySelectorAll(".lib-row").length===1&&!!document.querySelector(".lib-more")');
      await q('document.querySelector(".lib-more").click()');await until('document.querySelectorAll(".lib-row").length===2&&!!document.querySelector(".lib-more")');
      check('Meme Load more appends distinct parsed infinite-scroll pages',await q('document.querySelector(".lib-list").textContent.includes("Original page 1")&&document.querySelector(".lib-list").textContent.includes("Original page 2")&&document.querySelector(".browser-summary").textContent.includes("Licence unknown")'));
      await q('document.querySelector(".lib-more").click()');await until('!document.querySelector(".lib-more")&&!document.querySelector(".lib-loading")');
      check('Terminal meme page retains results and removes Load more',await q('document.querySelectorAll(".lib-row").length===2&&!document.querySelector(".lib-error")'));
      check('Meme pagination retains the submitted query at every page',[1,2,3].every(page=>memeRequests.some(value=>{const url=new URL(value);return url.searchParams.get('name')==='original pagination'&&url.searchParams.get('page')===String(page);})));result.memeRequests=memeRequests;
      await click('Sound effects');await until('document.querySelector(".browser-summary")?.textContent.startsWith("Openverse")&&document.querySelectorAll(".lib-row").length===1');
    }finally{net.fetch=nativeFetch;}
    await click('Text to speech');await until('!!document.querySelector(".tts")');check('Speech generation stays reachable',true);
    await click('Credits');
    await until('!!document.querySelector(".lib-credits pre")');
    check('Credits include image and sound',await q('document.querySelector(".lib-credits pre").textContent.includes("Credit forest")&&document.querySelector(".lib-credits pre").textContent.includes("Credit sound")'));
    await q('document.querySelector(".btn-export").click()');await until('!!document.querySelector(".export-modal .lib-credits")');
    win.show();app.focus({steal:true});win.focus();await until('document.hasFocus()');
    await q('document.querySelector(".export-modal .lib-credits button").click()');await wait(100);
    const clipboard=await require('electron').clipboard.readText();check('Export offers copyable credits',clipboard.includes('Credit forest')&&clipboard.includes('Credit sound')); // readText returns a Promise since Electron 44
    fs.writeFileSync(path.join(dir,'credits.png'),(await win.capturePage()).toPNG());
    await q('document.querySelector(".export-modal button[aria-label=Close]").click()');
    result.layouts=[];
    for(const [w,h] of [[1000,640],[1400,860],[1920,1080]]){
      win.setContentSize(w,h);await wait(150);
      await q('window.__fve.tab("media")');await wait(150);
      await q('document.querySelector(".tab-content").scrollTop=0');
      const layout=await q(`(()=>{const p=document.querySelector('.tab-content'),b=p.getBoundingClientRect(),t=document.querySelector('.browser-toolbar').getBoundingClientRect(),r=document.querySelector('.stock-tile').getBoundingClientRect();return {width:innerWidth,height:innerHeight,overflow:p.scrollWidth>p.clientWidth+1,toolbarTop:t.top,firstResultTop:r.top,panelBottom:b.bottom}})()`);
      result.layouts.push(layout);check('Stock layout fits '+w,!layout.overflow&&layout.firstResultTop<layout.panelBottom);
      fs.writeFileSync(path.join(dir,'stock-'+w+'.png'),(await win.capturePage()).toPNG());
      await q('window.__fve.tab("audio")');await wait(100);await click('Online');await wait(100);await q('document.querySelector(".tab-content").scrollTop=0');
      check('Audio layout fits '+w,await q('(()=>{const p=document.querySelector(".tab-content"),r=document.querySelector(".lib-row").getBoundingClientRect();return p.scrollWidth<=p.clientWidth+1&&r.top<p.getBoundingClientRect().bottom})()'));
      fs.writeFileSync(path.join(dir,'audio-'+w+'.png'),(await win.capturePage()).toPNG());
    }
    win.setContentSize(1000,640);await wait(100);
    await q(`(()=>{const e=document.querySelector('.workspace .splitter.col');for(let n=0;n<6;n++)e.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',shiftKey:true,bubbles:true,cancelable:true}))})()`);
    for(const tab of ['media','audio']){
      await q(`window.__fve.tab(${JSON.stringify(tab)})`);await until(tab==='audio'?'!!document.querySelector(".browser-destinations")':'!!document.querySelector(".stock-card")');await wait(150);
      const bounds=await q(`(()=>{const p=document.querySelector('.tab-content');return {client:p.clientWidth,scroll:p.scrollWidth,overflow:[...p.querySelectorAll('.browser-controls,.browser-destinations,.lib-row,.stock-card,.browser-empty,.lib-error')].map(e=>({class:e.className,width:e.clientWidth,scroll:e.scrollWidth})).filter(e=>e.scroll>e.width+1)}})()`);
      if(tab==='audio'){
        await select('Audio source','library');await until('!!document.querySelector(".pack-list .lib-row")');
        check('Compact source menu reaches the installed library',true);
        await select('Audio source','online');await until('!!document.querySelector(\'input[aria-label="Search the library"]\')');
        await select('Audio content type','Music');await until('document.querySelector(\'.browser-kind-compact .dropdown-label\').textContent==="Music"');await select('Audio content type','Sound effects');await until('!!document.querySelector(".lib-row")');
        check('Compact kind menu preserves online browsing',true);
      }
      result.layouts.push({minimum:tab,...bounds});check('Minimum-width '+tab+' has no overflow',bounds.scroll<=bounds.client+1&&!bounds.overflow.length);
      fs.writeFileSync(path.join(dir,'minimum-'+tab+'.png'),(await win.capturePage()).toPNG());
    }
    check('No renderer errors',result.errors.length===0);
    fs.writeFileSync(path.join(dir,'project.json'),JSON.stringify(await q('window.__fve.rawProject()'),null,2));
    fs.writeFileSync(path.join(dir,'result.json'),JSON.stringify(result,null,2));app.exit(0);
  }catch(e){result.error=e.stack||String(e);fs.writeFileSync(path.join(dir,'result.json'),JSON.stringify(result,null,2));app.exit(1);}
};
