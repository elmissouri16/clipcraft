// Real editor/IPC/store/export. Offline by default; opt into native Codex image
// generation with FVE_CODEX_IMAGES_LIVE=1 and an optional character reference.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
module.exports = async (win, app, dir) => {
  const live = process.env.FVE_CODEX_IMAGES_LIVE === '1';
  const ff = require('./ffmpeg.cjs');
  const agents = require('./localAgents.cjs'), ai = require('./ai.cjs'), settings = require('./settings.cjs');
  const originalGenerate = agents.generateImage;
  const result = { live, checks: [], errors: [] };
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
  let calls = 0, phase = 0, imagePending = false, cancelMode = false;
  agents.generateImage = async (cfg, req) => {
    calls++;
    assert.equal(cfg.provider, 'codex-sdk');
    if (cancelMode) {
      imagePending = true;
      return new Promise((resolve, reject) => req.signal.addEventListener('abort', () => reject(Object.assign(new Error('Stopped'), { name: 'AbortError' })), { once: true }));
    }
    assert.deepEqual(req.referencePaths, [reference]);
    assert.equal(req.ratio, '1:1');
    if (live) return originalGenerate(cfg, req);
    fs.mkdirSync(req.outputDir, { recursive: true });
    const file = path.join(req.outputDir, 'offline-scene.png');
    fs.copyFileSync(reference, file);
    return { path: file, source: 'codex-imagegen', prompt: req.prompt };
  };
  ai.agentStep = async (_cfg, req) => {
    const reply = call => ({ calls: [call], content: { role: 'model', parts: [{ functionCall: call }] } });
    if (cancelMode) {
      if (phase++ === 0) return reply({ name: 'load_tools', args: { groups: ['media'] } });
      return reply({ name: 'generate_image', args: { prompt: 'Cancellation test character', start_sec: 1, duration_sec: 2 } });
    }
    if (phase++ === 0) return reply({ name: 'get_project', args: { scope: 'media' } });
    if (phase === 2) return reply({ name: 'load_tools', args: { groups: ['media','motion'] } });
    if (phase === 3) {
      assert.ok(req.tools.some(t => t.name === 'generate_image'));
      return reply({ name: 'generate_image', args: { prompt: 'Create a new still scene of the exact same original paper robot character from the reference, now standing with both arms stretched out to its sides, full body, lavender studio backdrop. Preserve its blue square face, folded cardboard construction, yellow antenna and chest gear, orange feet and friendly expression. No text or logos.',
        reference_media_ids: ['character'], start_sec: 2, duration_sec: 4 } });
    }
    if (phase === 4) {
      const response = req.contents.at(-1).parts.find(p => p.functionResponse?.name === 'generate_image').functionResponse.response.result;
      assert.ok(response.clip_id && !response.error);
      return reply({ name: 'add_keyframes', args: { clip_id: response.clip_id, property: 'scale', easing: 'inout',
        keyframes: [{ time_sec: 2, value: 1 }, { time_sec: 5.9, value: 1.1 }] } });
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
    await draft('Generate a new scene with the existing character, at two seconds for four seconds, with a slow zoom.');
    await until('!document.querySelector("button[aria-label=Send]").disabled');
    await click('button[aria-label=Send]');
    await until('!!document.querySelector(".pilot-undo") && !document.querySelector("button[aria-label=Stop]")', live ? 660000 : 30000);
    const project = await q('window.__fve.exportData().project');
    const clip = project.overlayClips[0], image = project.media.find(m => m.id === clip?.mediaId);
    check('chat tool generates and inserts the scene at its requested time', calls===1 && clip.start===2 && clip.out===4 && clip.in===0);
    check('generated image is persistent and registered in media', image.type==='image' && image.origin==='codex-image' && image.path.startsWith(path.join(dir,'codex-images')) && fs.existsSync(image.path));
    check('subsequent motion tool animates the generated scene', clip.keyframes?.scale?.length===2);
    check('a new project gains background covering the full generated scene',project.videoClips.length===1 && project.videoClips[0].gap && project.videoClips[0].out===6);
    result.image = { path:image.path,width:image.width,height:image.height };
    await q('window.__fve.seek(3)'); await wait(200);
    await click('button[aria-label="Close assistant"]');
    fs.writeFileSync(path.join(dir,'scene.png'),(await win.capturePage()).toPNG());
    const movie = path.join(dir,'scene-export.mp4');
    await ff.runExport({...project,width:320,height:320,fps:10},movie,()=>{}).promise;
    const info = await ff.probe(movie);
    check('generated scene and animation export through FFmpeg', info.type==='video' && info.duration>=5.9);
    await click('.pilot-fab'); await until('!!document.querySelector(".pilot-undo")');
    await click('.pilot-undo'); await until('window.__fve.exportData().project.overlayClips.length===0');
    check('one Undo restores the project and keeps its character reference', (await q('window.__fve.exportData().project.media')).length===1 && (await q('window.__fve.exportData().project.videoClips')).length===0);
    await q('window.__fve.dispatch({type:"redo"})'); await until('window.__fve.exportData().project.overlayClips.length===1');
    check('Redo reuses the persistent generated image', fs.existsSync((await q('window.__fve.exportData().project.media')).find(m=>m.origin==='codex-image').path));
    cancelMode=true; phase=0;
    await draft('Cancel this image generation.'); await click('button[aria-label=Send]');
    for (let n=0;!imagePending && n<200;n++) await wait(100);
    check('image generation exposes an in-flight request to Stop',imagePending);
    await click('button[aria-label=Stop]'); await until('!document.querySelector("button[aria-label=Stop]")');
    check('Stop cancels the image job without inserting another scene',(await q('window.__fve.exportData().project.overlayClips')).length===1);
    const apiCfg = settings.getPublic();
    settings.save({provider:'ollama'});
    const unavailable = await q(`window.api.agentGenerateImage({prompt:'x',ratio:'1:1',requestId:'wrong-provider'})`);
    check('other providers cannot silently launch Codex image jobs',/Codex SDK/.test(unavailable.error) && calls===2);
    settings.save({provider:apiCfg.provider,model:apiCfg.models[apiCfg.provider]});
    check('no renderer errors',result.errors.length===0);
    result.ok=true;
  } catch(error) { result.ok=false;result.error=error.stack; }
  finally { agents.generateImage=originalGenerate; }
  fs.writeFileSync(path.join(dir,'result.json'),JSON.stringify(result,null,2));
  console.log(JSON.stringify({ok:result.ok,live,checks:result.checks,error:result.error,dir}));
  app.exit(result.ok?0:1);
};
