// Real editor/IPC/store/export. Offline by default; opt into native Codex image
// generation with FVE_CODEX_IMAGES_LIVE=1 and an optional character reference.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
module.exports = async (win, app, dir) => {
  const live = process.env.FVE_CODEX_IMAGES_LIVE === '1';
  const parallel = process.env.FVE_SMOKE_MODE === 'codex-images-parallel';
  const sceneCount = parallel ? (live ? 2 : 5) : 1;
  const ff = require('./ffmpeg.cjs');
  const agents = require('./localAgents.cjs'), ai = require('./ai.cjs'), settings = require('./settings.cjs');
  const originalGenerate = agents.generateImage;
  const result = { live, parallel, sceneCount, checks: [], errors: [], jobs: [] };
  const check = (name, ok) => { assert.ok(ok, name); result.checks.push(name); };
  const q = (js) => { new (require('node:vm').Script)(js); return win.webContents.executeJavaScript(js); };
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const until = async (js, timeout = 30000) => {
    const end = Date.now() + timeout;
    while (Date.now() < end) { if (await q(js)) return; await wait(100); }
    throw new Error(`Timed out: ${js}`);
  };
  const click = selector => q(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const draft = text => q(`(() => { const el=document.querySelector('.pilot-input textarea');
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(el,${JSON.stringify(text)});
    el.dispatchEvent(new Event('input',{bubbles:true})); })()`);
  win.webContents.setBackgroundThrottling(false);
  win.webContents.on('console-message', (_e, level, text) => { if (level >= 3) result.errors.push(text); });
  settings.setFirstRun({ tourSeen: true, packPromptSeen: true });
  settings.save({ provider: 'codex-sdk', model: 'gpt-6.1-sol' });
  const reference = path.join(dir, 'character-reference.png');
  if (process.env.FVE_CODEX_IMAGE_REFERENCE) fs.copyFileSync(process.env.FVE_CODEX_IMAGE_REFERENCE, reference);
  else execFileSync(ff.ffmpegPath, ['-y','-loglevel','error','-f','lavfi','-i','color=c=blue:size=640x640','-frames:v','1',reference]);
  let calls = 0, phase = 0, imagePending = false, cancelMode = false, pendingCount = 0, aborted = 0, active = 0, peak = 0;
  agents.generateImage = async (cfg, req) => {
    calls++;
    assert.equal(cfg.provider, 'codex-sdk');
    if (cancelMode) {
      imagePending = true; pendingCount++;
      return new Promise((resolve, reject) => req.signal.addEventListener('abort', () => { aborted++; reject(Object.assign(new Error('Stopped'), { name: 'AbortError' })); }, { once: true }));
    }
    assert.deepEqual(req.referencePaths, [reference]);
    assert.equal(req.ratio, '1:1');
    const job = { number:calls, prompt:req.prompt, start:Date.now() };
    result.jobs.push(job); peak = Math.max(peak, ++active);
    try {
      if (live) return await originalGenerate(cfg, req);
      if (parallel) await wait(req.prompt.startsWith('Scene 1:') ? 450 : 150);
      fs.mkdirSync(req.outputDir, { recursive: true });
      const file = path.join(req.outputDir, `offline-scene-${job.number}.png`);
      fs.copyFileSync(reference, file);
      return { path: file, source: 'codex-imagegen', prompt: req.prompt };
    } finally { job.end=Date.now(); active--; }
  };
  ai.agentStep = async (_cfg, req) => {
    const reply = value => { const calls=Array.isArray(value)?value:[value]; return { calls, content: { role:'model',parts:calls.map(functionCall=>({functionCall})) } }; };
    if (cancelMode) {
      if (phase++ === 0) return reply({ name: 'load_tools', args: { groups: ['media'] } });
      return reply(Array.from({length:parallel?5:1},()=>({ name:'generate_image',args:{prompt:'Cancellation test character',start_sec:1,duration_sec:2} })));
    }
    if (phase++ === 0) return reply({ name: 'get_project', args: { scope: 'media' } });
    if (phase === 2) return reply({ name: 'load_tools', args: { groups: ['media','motion'] } });
    if (phase === 3) {
      assert.ok(req.tools.some(t => t.name === 'generate_image'));
      return reply(Array.from({length:sceneCount},(_,i)=>({ name:'generate_image',args:{
        prompt:`Scene ${i+1}: Create a new still scene of the exact same original paper robot character from the reference, now ${i===0?'standing with both arms stretched out to its sides':'waving one hand next to its head'}, full body, lavender studio backdrop. Preserve its blue square face, folded cardboard construction, yellow antenna and chest gear, orange feet and friendly expression. No text or logos.`,
        reference_media_ids:['character'],start_sec:2+4*i,duration_sec:4,
      } })));
    }
    if (phase === 4) {
      const responses=req.contents.at(-1).parts.map(p=>p.functionResponse.response.result);
      assert.equal(responses.length,sceneCount);
      return reply(responses.map((response,i)=>{
        assert.ok(response.clip_id && !response.error);
        return { name:'add_keyframes',args:{clip_id:response.clip_id,property:'scale',easing:'inout',
          keyframes:[{time_sec:2+4*i,value:1},{time_sec:5.9+4*i,value:1.1}] } };
      }));
    }
    return { calls: [], text: 'Generated the character scene and added a slow zoom.', content: { role: 'model', parts: [{ text: 'Generated the character scene and added a slow zoom.' }] } };
  };
  try {
    await until('!!window.__fve && !!document.querySelector(".home-frame-card")');
    await click('.home-frame-card'); await until('!!document.querySelector(".topbar")');
    await q('document.querySelector(".welcome-go")?.click()');
    const [media] = await q(`window.api.probePaths([${JSON.stringify(reference)}])`);
    await q(`window.__fve.load({id:'codex-image-test',name:'Character scenes',ratio:'1:1',width:720,height:720,fps:30,
      media:[{...${JSON.stringify(media)},id:'character'}],videoClips:[],audioClips:[],textClips:[],overlayClips:[]})`);
    await click('.pilot-fab'); await until('!!document.querySelector(".pilot-input textarea")');
    await draft(parallel ? `Generate ${sceneCount} independent scenes with the existing character, each four seconds, starting at two seconds. Add a slow zoom to each.` : 'Generate a new scene with the existing character, at two seconds for four seconds, with a slow zoom.');
    await until('!document.querySelector("button[aria-label=Send]").disabled');
    await click('button[aria-label=Send]');
    await until('!!document.querySelector(".pilot-undo") && !document.querySelector("button[aria-label=Stop]")', live ? 660000 : 30000);
    const project = await q('window.__fve.exportData().project');
    const clip = project.overlayClips[0], image = project.media.find(m => m.id === clip?.mediaId);
    check('chat tool generates and inserts the scene at its requested time', calls===sceneCount && project.overlayClips.length===sceneCount && project.overlayClips.every((c,i)=>c.start===2+4*i && c.out===4 && c.in===0 && project.media.find(m=>m.id===c.mediaId).generation.prompt.startsWith(`Scene ${i+1}:`)));
    check('generated image is persistent and registered in media', image.type==='image' && image.origin==='codex-image' && image.path.startsWith(path.join(dir,'codex-images')) && fs.existsSync(image.path));
    check('subsequent motion tool animates the generated scene', project.overlayClips.every(c=>c.keyframes?.scale?.length===2));
    check('a new project gains background covering the full generated scene',project.videoClips.length===1 && project.videoClips[0].gap && project.videoClips[0].out===2+4*sceneCount);
    if (parallel) {
      check('native image jobs overlap within the concurrency limit',peak===Math.min(3,sceneCount));
      if (!live) check('scene order survives out-of-order generation',result.jobs[1].end<result.jobs[0].end);
      result.peak=peak; result.generationMs=Math.max(...result.jobs.map(j=>j.end))-Math.min(...result.jobs.map(j=>j.start));
    }
    result.image = { path:image.path,width:image.width,height:image.height };
    await q('window.__fve.seek(3)'); await wait(200);
    await click('button[aria-label="Close assistant"]');
    fs.writeFileSync(path.join(dir,'scene.png'),(await win.capturePage()).toPNG());
    const movie = path.join(dir,'scene-export.mp4');
    await ff.runExport({...project,width:320,height:320,fps:10},movie,()=>{}).promise;
    const info = await ff.probe(movie);
    check('generated scene and animation export through FFmpeg', info.type==='video' && info.duration>=1.9+4*sceneCount);
    await click('.pilot-fab'); await until('!!document.querySelector(".pilot-undo")');
    await click('.pilot-undo'); await until('window.__fve.exportData().project.overlayClips.length===0');
    check('one Undo restores the project and keeps its character reference', (await q('window.__fve.exportData().project.media')).length===1 && (await q('window.__fve.exportData().project.videoClips')).length===0);
    await q('window.__fve.dispatch({type:"redo"})'); await until(`window.__fve.exportData().project.overlayClips.length===${sceneCount}`);
    check('Redo reuses the persistent generated image', fs.existsSync((await q('window.__fve.exportData().project.media')).find(m=>m.origin==='codex-image').path));
    cancelMode=true; phase=0;
    await draft('Cancel this image generation.'); await click('button[aria-label=Send]');
    for (let n=0;!imagePending && n<200;n++) await wait(100);
    check('image generation exposes an in-flight request to Stop',imagePending);
    await click('button[aria-label=Stop]'); await until('!document.querySelector("button[aria-label=Stop]")');
    check('Stop cancels the image job without inserting another scene',(await q('window.__fve.exportData().project.overlayClips')).length===sceneCount);
    check('Stop aborts every running job without starting queued images',aborted===pendingCount && pendingCount===(parallel?3:1) && calls===sceneCount+pendingCount);
    const apiCfg = settings.getPublic();
    settings.save({provider:'ollama'});
    const unavailable = await q(`window.api.agentGenerateImage({prompt:'x',ratio:'1:1',requestId:'wrong-provider'})`);
    check('other providers cannot silently launch Codex image jobs',/Codex SDK/.test(unavailable.error) && calls===sceneCount+pendingCount);
    settings.save({provider:apiCfg.provider,model:apiCfg.models[apiCfg.provider]});
    check('no renderer errors',result.errors.length===0);
    result.ok=true;
  } catch(error) { result.ok=false;result.error=error.stack; }
  finally { agents.generateImage=originalGenerate; }
  fs.writeFileSync(path.join(dir,'result.json'),JSON.stringify(result,null,2));
  console.log(JSON.stringify({ok:result.ok,live,checks:result.checks,error:result.error,dir}));
  app.exit(result.ok?0:1);
};
