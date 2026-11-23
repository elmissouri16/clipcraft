const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
module.exports=async(win,app,dir)=>{
  const {dialog}=require('electron'), reopen=process.env.FVE_SOURCE_REOPEN==='1', project=path.join(dir,'stock.clipcraft.json');
  const result={ok:false, checks:[]};
  const q=text=>win.webContents.executeJavaScript(text);
  const until=async expression=>{for(let i=0;i<300;i++){if(await q(expression))return;await new Promise(r=>setTimeout(r,50));}throw Error('Timed out: '+expression);};
  const check=(label,value)=>{assert.ok(value,label);result.checks.push(label);};
  win.webContents.setAudioMuted(true);
  try{
    const settingsFile=path.join(dir,'settings-test/settings.json');
    if(!reopen){
      const saved=JSON.parse(fs.readFileSync(settingsFile));
      const enc=require('electron').safeStorage.encryptString('sz_stub_key').toString('base64');
      fs.writeFileSync(settingsFile,JSON.stringify({...saved,services:{...saved.services,soundza:{enc}}}));
    }
    await until('!!document.querySelector(".home-frame-card")');await q('document.querySelector(".home-frame-card").click()');await until('!!document.querySelector(".topbar")');await q('document.querySelector(".welcome-go")?.click()');
    const catalog=await q('window.api.mediaSources()');
    check('Effects load while bundled extensions initialize',Array.isArray(await q('window.api.pluginEffects()')));
    if(reopen){
      check('Disabled video source stays disabled after restart',!catalog.some(row=>row.name==='Pixabay'));
      const opened=await q('window.api.openProjectPath('+JSON.stringify(project)+')');
      check('Saved project reopens',!opened.error);
      const saved=JSON.parse(fs.readFileSync(project));await q('window.__fve.load('+JSON.stringify(saved)+')');
      check('Project-owned footage still exists',saved.media.some(row=>row.type==='video'&&fs.existsSync(row.path)));
      await q('window.__fve.seek(0.25)');
      await until('[...document.querySelectorAll(".slot video")].some(v=>v.readyState>=2&&v.videoWidth===320)');
      const exported=await q('window.__fve.exportNow()');
      check('Footage exports with provider disabled',exported.ok&&fs.statSync(path.join(dir,'ui-export.mp4')).size>100);
      const pixels=require('node:child_process').execFileSync(require('../../electron/media/ffmpeg.cjs').ffmpegPath,['-v','error','-i',path.join(dir,'ui-export.mp4'),'-vf','scale=1:1','-frames:v','1','-pix_fmt','rgb24','-f','rawvideo','-']);
      check('Export contains the imported red video',pixels[0]>180&&pixels[1]<50&&pixels[2]<50);
      check('Saved favorite keeps source identity', (await q('window.api.favoritesList()')).some(row=>row.item.sourceId==='clipcraft.pixabay.catalog'));
    }else{
      check('All four installed packages register media services',catalog.map(row=>row.name).sort().join(',')==='MyInstants,Openverse,Pixabay,Soundza');
      await q('window.__fve.load({name:"Provider test",width:320,height:180,fps:24,media:[],videoClips:[],audioClips:[],overlayClips:[],textClips:[],effectClips:[]});window.__fve.tab("media")');
      await until('[...document.querySelectorAll("button")].some(b=>b.textContent.trim()==="Stock")');await q('[...document.querySelectorAll("button")].find(b=>b.textContent.trim()==="Stock").click()');
      await until('!!document.querySelector(".stock-key button")');
      await q('document.querySelector(".stock-key button").click()');
      await until('!!document.querySelector(`input[aria-label="Pixabay API key"]`)');
      check('Key setup opens the selected provider in Plugins',await q('document.querySelector("[data-plugin-details] h4").textContent==="Pixabay"'));
      check('Three installed Pixabay versions share one inventory row',await q(`[...document.querySelectorAll('.plugin-row b')].filter(b=>b.textContent==='Pixabay').length===1&&document.querySelector('[data-plugin-version]').options.length===3`));
      check('The provider opens on its enabled release',(await q("document.querySelector('[data-plugin-version]').value"))===catalog.find(row=>row.name==='Pixabay').key);
      await q('window.api.pluginsExtensionSettingsUpdate("clipcraft.pixabay.connection","apiKey","fixture-pix")');
      const soundza=await q('window.api.pluginsExtensionSettingsRead("clipcraft.soundza.connection")');
      check('Previously saved Soundza credential moves to the plugin',soundza.apiKey?.saved&&!JSON.parse(fs.readFileSync(settingsFile)).services?.soundza);
      await q('document.querySelector(\'button[aria-label="Close settings"]\').click()');
      await until('!!document.querySelector(".stock-tile img")');
      await q('document.querySelector(".stock-tile .tile-star").click();document.querySelector(\'.stock-tile [aria-label="Add to the main track"]\').click()');
      await until('window.__fve.rawProject().videoClips.length===1');
      const first=await q('window.__fve.rawProject().media[0]');
      check('Pixabay video inserted with credit',first.type==='video'&&first.credit.providerName==='Pixabay');
      for(const [provider,kind] of [['Soundza','sfx'],['MyInstants','trolls'],['Pixabay','photo']]){
        const page=await q('window.api.mediaSearch('+JSON.stringify({provider,kind,q:'sample'})+')');
        check(provider+' supplies '+kind,page.results?.length>0);
        const item=JSON.stringify(page.results[0]);
        const preview=await q('window.api.mediaSourcePreview('+item+')');
        check(provider+' provides a local preview',preview.path&&fs.existsSync(preview.path));
        const added=await q('window.api.mediaSourceAdd('+item+')');
        check(provider+' imports '+kind+' with credit',added.path&&fs.existsSync(added.path)&&added.credit.providerName===provider);
      }
      await q('window.__fve.tab("audio")');
      await until('!!document.querySelector(".browser-destinations")');
      await q('[...document.querySelectorAll(".browser-destinations button")].find(b=>b.textContent==="Online").click()');
      await until('[...document.querySelectorAll(".browser-kinds button")].some(b=>b.textContent==="Memes")');
      await q('[...document.querySelectorAll(".browser-kinds button")].find(b=>b.textContent==="Memes").click()');
      await until('!!document.querySelector(".lib-list .lib-play")&&document.querySelector(".browser-summary")?.textContent.includes("MyInstants")');
      // Observe the real detached player at its first call to play without changing its output settings.
      await q(`(()=>{const play=HTMLMediaElement.prototype.play;HTMLMediaElement.prototype.play=function(...args){
        if(this instanceof HTMLAudioElement){window.__audition=this;window.__firstVolume=this.volume;}
        return play.apply(this,args);
      };})()`);
      await q('document.querySelector(".lib-list .lib-play").click()');
      await until('window.__audition?.currentTime>0');
      check('MyInstants preview begins at the new project default',await q('window.__firstVolume===0.5&&!window.__audition.muted'));
      await q(`document.querySelector('.player > .transport [aria-label="Preview volume"]').click()`);
      await q(`(()=>{const el=document.querySelector('.player > .transport input[aria-label="Preview volume level"]');
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,'18');el.dispatchEvent(new Event('input',{bubbles:true}));
      })()`);
      await until('window.__audition.volume===0.18');
      await q(`document.querySelector('.player > .transport [aria-label="Mute preview"]').click()`);
      await until('window.__audition.muted');
      await q(`document.querySelector('.player > .transport [aria-label="Unmute preview"]').click()`);
      await until('!window.__audition.muted&&window.__audition.volume===0.18');
      check('Player slider and mute follow the playing meme sound',await q('!window.__audition.paused'));
      await q('document.querySelector(".lib-list .lib-play").click()');
      await until('window.__audition.paused');
      dialog.showSaveDialog=async()=>({canceled:false,filePath:project});
      await q('window.api.saveProject(JSON.stringify(window.__fve.rawProject()),null,{chat:null})');
      const pixabay=catalog.find(row=>row.name==='Pixabay');
      await q('window.api.pluginsEnable('+JSON.stringify(pixabay.key)+',false)');
      check('Video disappears from source catalog',!(await q('window.api.mediaSources()')).some(row=>row.kinds.includes('video')));
      const stopped=await q('window.api.mediaSearch({provider:"Pixabay",kind:"video",q:"sample"})');
      check('Disabled source cannot search',!!stopped.error);
    }
    result.ok=true;
  }catch(error){result.error=String(error.stack||error);}
  fs.writeFileSync(path.join(dir,reopen?'reopened.json':'initial.json'),JSON.stringify(result,null,2));app.exit(result.ok?0:1);
};
