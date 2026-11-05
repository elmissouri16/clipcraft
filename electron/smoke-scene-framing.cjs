const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
module.exports=async(win,app,dir)=>{
  fs.mkdirSync(dir,{recursive:true});
  const result={checks:[],errors:[]},q=js=>win.webContents.executeJavaScript(js),wait=ms=>new Promise(r=>setTimeout(r,ms));
  const check=(name,ok)=>{assert.ok(ok,name);result.checks.push(name);};
  const until=async js=>{const end=Date.now()+30000;while(Date.now()<end){if(await q(js))return;await wait(60);}throw new Error(`Timed out: ${js}`);};
  const click=s=>q(`document.querySelector(${JSON.stringify(s)}).click()`);
  win.webContents.setBackgroundThrottling(false);win.webContents.on('console-message',(_e,level,text)=>{if(level>=3)result.errors.push(text);});
  try{
    assert.ok(process.env.FVE_FRAMING_PROJECT,'Provide an isolated project fixture through FVE_FRAMING_PROJECT.');
    const project=JSON.parse(fs.readFileSync(process.env.FVE_FRAMING_PROJECT,'utf8'));
    await until('!!window.__fve&&!!document.querySelector(".home-frame-card")');await click('.home-frame-card');await until('!!document.querySelector(".topbar")');await q('document.querySelector(".welcome-go")?.click()');
    await q(`window.__fve.load(${JSON.stringify(project)})`);
    const before=(await q('window.__fve.exportData()')).project;
    const clips=before.overlayClips.filter(c=>before.media.find(m=>m.id===c.mediaId)?.type==='video');
    check('the fixture reproduces uncropped landscape scene strips',clips.length>0&&clips.every(c=>!c.crop?.l&&!c.crop?.r&&(c.transform?.scale||1)===1));
    for(const [i,clip]of clips.entries()){
      await q(`window.__fve.select({track:'overlay',id:${JSON.stringify(clip.id)}});window.__fve.seek(${clip.start+Math.min(3,(clip.out-clip.in)/2)});`);
      await until('!!document.querySelector(".fitfill-row button")');
      await wait(200);fs.writeFileSync(path.join(dir,`before-${i}.png`),(await win.capturePage()).toPNG());
      await click('button[title="Cover the whole frame with the picture (the overflow is cropped)"]');
      await until(`window.__fve.exportData().project.overlayClips.find(c=>c.id===${JSON.stringify(clip.id)}).crop.l>0`);
      await wait(200);fs.writeFileSync(path.join(dir,`after-${i}.png`),(await win.capturePage()).toPNG());
    }
    let after=(await q('window.__fve.exportData()')).project;
    check('Fill reframes every scene as a cropped base at scale one',clips.every(c=>{const f=after.overlayClips.find(x=>x.id===c.id);return f.crop.l>0.3&&f.crop.r>0.3&&f.transform.scale===1;}));
    for(const key of ['media','textClips','audioClips','videoClips'])check(`${key} stay unchanged`,JSON.stringify(before[key])===JSON.stringify(after[key]));
    check('scene timing and lengths stay unchanged',clips.every(c=>{const f=after.overlayClips.find(x=>x.id===c.id);return f.start===c.start&&f.in===c.in&&f.out===c.out;}));
    const first=clips[0];await q(`window.__fve.select({track:'overlay',id:${JSON.stringify(first.id)}});`);
    await click('button[title="Show the whole picture inside the frame"]');await until(`window.__fve.exportData().project.overlayClips.find(c=>c.id===${JSON.stringify(first.id)}).crop.l===0`);
    check('Fit explicitly restores the whole source',(await q(`window.__fve.exportData().project.overlayClips.find(c=>c.id===${JSON.stringify(first.id)}).transform.scale`))===1);
    await q('window.__fve.dispatch({type:"undo"})');await until(`window.__fve.exportData().project.overlayClips.find(c=>c.id===${JSON.stringify(first.id)}).crop.l>0.3`);
    check('Undo restores full-frame framing',true);
    await q('window.__fve.dispatch({type:"redo"})');await until(`window.__fve.exportData().project.overlayClips.find(c=>c.id===${JSON.stringify(first.id)}).crop.l===0`);
    check('Redo restores explicit whole-picture fit',true);
    check('no renderer errors',result.errors.length===0);result.ok=true;
  }catch(error){result.ok=false;result.error=error.stack;fs.writeFileSync(path.join(dir,'failure.png'),(await win.capturePage()).toPNG());}
  fs.writeFileSync(path.join(dir,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({...result,dir}));app.exit(result.ok?0:1);
};
