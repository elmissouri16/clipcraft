// Exercise editing shortcuts, clip menu operations and real disk recovery in one temporary project.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { dialog } = require('electron');
const { ffmpegPath } = require('../../electron/media/ffmpeg.cjs');

module.exports = async (win, app, dir) => {
  const q = code => win.webContents.executeJavaScript(code);
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const until = async code => {
    for (let end = Date.now() + 10000; Date.now() < end; await wait(40)) if (await q(code)) return;
    throw Error('Timed out waiting for ' + code);
  };
  const click = selector => q(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const key = async k => {
    await q(`window.dispatchEvent(new KeyboardEvent('keydown', {key:${JSON.stringify(k)},ctrlKey:true,bubbles:true}))`);
    await wait(90);
  };
  const menu = async label => {
    const code = `[...document.querySelectorAll('.ctx-menu button')].find(b => b.textContent.trim().startsWith(${JSON.stringify(label)}))`;
    await until('!!(' + code + ')');
    await q(code + '.click()');
  };
  const clipMenu = async label => {
    await q(`document.querySelector('[data-lane="video"] .clip.video:not(.gap)').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:420,clientY:260}))`);
    await menu(label);
  };
  const home = async () => {
    await wait(350); // The opened/closed lifecycle notification settles after the screen changes.
    await click('.project-menu-btn'); await menu('Projects'); await until('!!document.querySelector(".home-frame-card")'); await wait(200);
  };
  const read = () => q('window.__fve.rawProject()');
  const result = { checks: [] }, check = (name, condition) => { assert.ok(condition, name); result.checks.push(name); };
  const file = path.join(dir, 'edits.clipcraft.json'), video = path.join(dir, 'test.mp4');
  const oldOpen = dialog.showOpenDialog;
  try {
    win.webContents.setBackgroundThrottling(false);
    execFileSync(ffmpegPath, ['-v','error','-f','lavfi','-i','smptebars=size=160x90:rate=30',
      '-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','12','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac',video]);
    const media = { id:'m',path:video,name:'Fixture.mp4',type:'video',width:160,height:90,duration:12,hasAudio:true,channels:1 };
    const clip = { id:'v',mediaId:'m',in:1,out:11,speed:1,volume:.5,fadeIn:2,fadeOut:1,
      volumeKeys:[{t:0,v:.5},{t:3,v:1},{t:12,v:.25}],audioFx:{eq:{low:1}},
      crop:{l:.1,t:0,r:.2,b:0},filter:'bw',effects:['grain'],fxStrength:{grain:.35},
      keyframes:{scale:[{t:1,v:1},{t:5,v:1.4}]},transform:{x:.05},opacity:.85 };
    const fixture = { id:'fixture',name:'Editing checks',width:160,height:90,ratio:'16:9',fps:60,
      media:[media],videoClips:[clip],audioClips:[],overlayClips:[],textClips:[],effectClips:[] };
    fs.writeFileSync(file,JSON.stringify(fixture));
    dialog.showOpenDialog = async () => ({ canceled:false,filePaths:[file] });
    await until('!!window.__fve && !!document.querySelector(".home-top")');
    await q('window.alert = msg => {window.testAlert=msg}; window.confirm=()=>true; void 0');
    const openFile = async () => {
      await q(`[...document.querySelectorAll('.home-action')].find(b=>b.textContent.trim()==='Open project').click()`);
      await until('!!document.querySelector(".topbar") && window.__fve.rawProject().id==="fixture"');
      await q('document.querySelector(".welcome-go")?.click()');
    };
    await openFile();
    await home();
    let newer = {...fixture,name:'Changed outside ClipCraft'};
    fs.writeFileSync(file,JSON.stringify(newer));
    await click('.home-frame-card'); await until('!!document.querySelector(".topbar")');
    check('Starting a project from Home preserves external changes',JSON.parse(fs.readFileSync(file)).name === newer.name);
    await home(); await openFile();
    await until('window.api.readProjectRecovery().then(s => s && JSON.parse(s).project.id==="fixture")');
    await wait(1700);
    newer = {...newer,name:'Changed before renderer recovery'};
    fs.writeFileSync(file,JSON.stringify(newer));
    // Deliver Electron's renderer-loss notification. The production handler reloads the window.
    const recover = async () => {
      const reload = new Promise(resolve => win.webContents.once('did-finish-load',resolve));
      win.webContents.emit('render-process-gone',{}, {reason:'crashed',exitCode:1});
      await reload;
      await until('!!document.querySelector(".recovered-note")');
    };
    await recover();
    await wait(1700);
    check('Crash recovery loads and autosaves the newer file', (await read()).name === newer.name && JSON.parse(fs.readFileSync(file)).name === newer.name);

    await q('window.__fve.seek(8); window.__fve.play()');
    await until('window.__fve.currentTime()>8.12 && [...document.querySelectorAll(".stage video")].some(el=>!el.paused&&el.readyState>=2)');
    await q('window.__fve.seek(2)');
    await wait(280);
    const time = await q('window.__fve.currentTime()');
    check('A backwards seek while playing stays on the requested section', time>=2 && time<3);
    await q('window.__fve.pause(); window.__fve.seek(2)'); await wait(100);
    const processedPixels = () => q(`(() => {
      const canvas=[...document.querySelectorAll('.stage .slot canvas.keyed')].find(c=>c.style.display==='block' && c.closest('.slot').style.visibility==='visible');
      if (!canvas || !canvas.width || canvas.dataset.renderError) throw Error('Missing processed picture');
      return [...canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data];
    })()`);
    const beforeHold = await processedPixels();
    await clipMenu('Freeze frame');
    await until('window.__fve.rawProject().videoClips.length===3');
    let p = await read(), still = p.videoClips[1];
    check('Freeze keeps the source crop, filter, effect strength and sampled motion',still.crop.l===.1 && still.filter==='bw' && still.fxStrength.grain===.35 && Math.abs(still.transform.scale-1.2)<1e-6 && still.opacity===.85 && still.frozenEffectTime===2 && still.out===4);
    await q('window.__fve.seek(4.5)'); await wait(250);
    const duringHold = await processedPixels();
    assert.equal(beforeHold.length, duringHold.length);
    const error = beforeHold.reduce((sum,value,i)=>sum+Math.abs(value-duringHold[i]),0)/beforeHold.length;
    check('The styled source pixels match the middle of the held frame',beforeHold.some((v,i)=>i%4===0 && v>80) && error<4);
    result.freezeMeanPixelDifference = error;
    const undo = async () => { await q('window.__fve.dispatch({type:"undo"})'); await wait(100); };
    await undo();
    await clipMenu('Extract audio'); await until('window.__fve.rawProject().audioClips.length===1');
    p = await read();
    check('Extract retains the source envelope and audio processing',p.audioClips[0].fadeIn===2 && p.audioClips[0].volumeKeys[1].t===3 && p.audioClips[0].audioFx.eq.low===1);
    await undo();
    await clipMenu('Detach audio'); await until('!!window.__fve.rawProject().audioClips[0]?.linkId');
    p = await read();
    check('Detach transfers fades, effects and source-time gain to the new file',p.audioClips[0].fadeOut===1 && p.audioClips[0].audioFx.eq.low===1 && p.audioClips[0].volumeKeys[1].t===2 && Math.abs(p.audioClips[0].volumeKeys[0].v-2/3)<1e-6);
    await q('window.__fve.seek(3)'); await clipMenu('Freeze frame');
    await until('window.__fve.rawProject().videoClips.length===3');
    p=await read();
    check('Freezing a detached picture moves its linked right-hand sound past the hold',p.audioClips.some(c=>c.linkId===p.videoClips[2].linkId && c.start===7));
    await undo(); p=await read();
    const link = p.videoClips[0].linkId;
    await q('window.__fve.select({track:"video",id:"v"}); document.activeElement?.blur()'); await wait(90);
    await key('x'); p = await read(); check('Cut removes both linked clips',!p.videoClips.length&&!p.audioClips.length);
    await key('v'); p = await read();
    check('Paste restores picture and sound with a fresh link at the snapped main-track position',p.videoClips.length===1 && p.audioClips.length===1 && p.videoClips[0].linkId!==link && p.videoClips[0].linkId===p.audioClips[0].linkId && p.audioClips[0].start===0);
    await undo(); await undo();
    check('Two undos restore the original linked pair',(await read()).videoClips[0].linkId===link);
    const audioResult = await q('window.api.exportAudio(window.__fve.exportData().project,"wav","Fixture")');
    check('Audio export publishes a decodable WAV',audioResult.ok && execFileSync(ffmpegPath,['-v','error','-i',audioResult.file,'-f','null','-']).length===0);
    const bytes = fs.readFileSync(audioResult.file);
    const broken = await q(`(()=>{const p=window.__fve.exportData().project;return window.api.exportAudio({...p,media:p.media.map(m=>({...m,path:m.path+'.missing'}))},'wav','Fixture')})()`);
    check('Failed export preserves previous bytes and clears temporary output',!broken.ok && bytes.equals(fs.readFileSync(audioResult.file)) && !fs.readdirSync(dir).some(name=>name.startsWith('.clipcraft-audio-')));
    await undo(); // undo detach
    await clipMenu('Reverse'); await until('!!window.__fve.rawProject().videoClips[0].reversed');
    await q(`window.alert = message => { window.testAlert = message; }; document.querySelector('button.asset-remove[aria-label*="Fixture"]').click()`);
    check('Library removal protects the reverse original',await q('window.testAlert?.includes("original source") && window.__fve.rawProject().media.some(m=>m.id==="m")'));
    await clipMenu('Reverse'); await until('window.__fve.rawProject().videoClips[0].mediaId==="m"');

    // An unavailable extension still leaves its saved track and media clock editable by native range cuts.
    const type = (kind,id) => 'custom-'+kind+':fixture/'+id+'@'+'a'.repeat(64);
    const customTrack = {id:'lane',name:'Custom',kind:'visual',typeId:type('track','lane'),data:{},locked:false,hidden:false,muted:false,solo:false};
    const customClip = {id:'piece',name:'Media',trackId:'lane',typeId:type('clip','media'),data:{},start:1,duration:6,sourceIn:.5,speed:1.5,opacity:1,disabled:true,mediaId:'m'};
    await q(`window.__fve.load(${JSON.stringify({...fixture,customTracks:[customTrack],customClips:[customClip]})})`);
    await until('!!document.querySelector(".custom-track-name")');
    await click('.custom-track-name'); await key('d');
    check('The duplicate shortcut on a track header leaves the editor usable',await q('!!document.querySelector(".topbar") && window.__fve.rawProject().customClips.length===1'));
    const cut = async (start,end) => { await q(`window.__fve.dispatch({type:'cutRanges',ranges:[{start:${start},end:${end}}],ripple:true})`); await wait(120); };
    await cut(1+1/60,2);
    check('A one-frame custom fragment is refused without modifying history or project', await q('window.__fve.history().past.length===0 && window.__fve.rawProject().customClips[0].duration===6'));
    await cut(2,4); p=await read();
    check('A valid ripple advances the custom source clock and survives serialization',p.customClips.length===2 && p.customClips[1].sourceIn===5 && p.customClips[1].start===2 && (await q('!!window.__fve.exportData().project')));
    await wait(1800);
    const invalid = 'Externally replaced file that ClipCraft cannot read';
    fs.writeFileSync(file, invalid);
    await recover();
    await wait(1750);
    p = await read();
    check('An unreadable changed file is preserved and the recovered edit has its own autosave slot',
      p.id!==fixture.id && p.customClips.length===2 && fs.readFileSync(file,'utf8')===invalid
      && await q(`window.api.slotRead(${JSON.stringify(p.id)}).then(s=>s?.file===null && s.project.customClips.length===2)`));
  } catch (error) {
    result.error = error.stack;
    try { result.editor = await q('({alert:window.testAlert,screen:document.body.innerText.slice(0,800),id:window.__fve?.rawProject().id})'); } catch {}
  }
  finally {
    dialog.showOpenDialog = oldOpen;
    fs.writeFileSync(path.join(dir,'result.json'), JSON.stringify(result,null,2));
    app.exit(result.error ? 1 : 0);
  }
};
