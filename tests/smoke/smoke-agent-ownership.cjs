// Real reducer, native callbacks, image batching, source probing and preview
// capture. Only provider reasoning/image/speech inference is deterministic.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
module.exports = async (win, app, dir) => {
  const local = require('../../electron/agents/localAgents.cjs'), speech = require('../../electron/audio/geminiTts.cjs'), settings = require('../../electron/system/settings.cjs');
  const ff = require('../../electron/media/ffmpeg.cjs'), { execFileSync } = require('node:child_process');
  const original = { run: local.runEditorNative, image: local.generateImage, status: local.status, speak: speech.speak };
  const result = { checks: [], errors: [] }, q = code => win.webContents.executeJavaScript(code);
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const until = async code => { for (let i = 0; i < 250; i++) { if (await q(code)) return;await wait(50); }throw Error('Timeout: ' + code); };
  const check = (label, value) => { assert.ok(value, label);result.checks.push(label); };
  const click = selector => q(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const image = path.join(dir, 'source.png'), wav = path.join(dir, 'source.wav');
  execFileSync(ff.ffmpegPath, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=blue:s=320x180', '-frames:v', '1', image]);
  execFileSync(ff.ffmpegPath, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', wav]);
  const fixture = id => ({ id, name: 'Ownership regression', ratio: '16:9', width: 320, height: 180, fps: 12,
    media: [{ id: 'source', path: image, type: 'image', width: 320, height: 180 }], videoClips: [{ id: 'v', mediaId: 'source', in: 0, out: 4 }], overlayClips: [], audioClips: [], textClips: [], effectClips: [] });
  let manual = false, continuing = false, speechCalls = 0, imageCalls = 0;
  const background = async () => {
    await q('(()=>{const p=window.__fve.rawProject();window.__fve.dispatch({type:"setProject",patch:{name:p.name},transient:true});window.__fve.dispatch({type:"endGesture"});window.__fve.dispatch({type:"addMedia",items:[]});})()');
    win.webContents.send('media:visuals', { path: image, poster: image });
    await wait(90);
  };
  speech.speak = async (_fetch, _key, outputDir) => {
    fs.mkdirSync(outputDir, { recursive: true });const file = path.join(outputDir, `voice-${++speechCalls}.wav`);fs.copyFileSync(wav, file);
    if (manual) { await q('window.__fve.dispatch({type:"setProject",patch:{name:"Actual manual edit"}})');await wait(90); }
    else await background();
    return file;
  };
  local.generateImage = async (_config, req) => {
    const file = path.join(req.outputDir, `image-${++imageCalls}.png`);fs.mkdirSync(req.outputDir, { recursive: true });fs.copyFileSync(image, file);
    await background();await wait(250);return { path: file, source: 'fixture', prompt: req.prompt };
  };
  local.status = async () => ({ ok: true, authenticated: true, version: 'ownership-fixture' });
  local.runEditorNative = async (_config, options) => {
    const call = async (name, args) => {
      const output = await options.onTool(name, args), data = JSON.parse(output.content[0].text);
      if (data.error) throw Error(data.error);return data;
    };
    try {
      if (continuing) {
        check('Continue reads the retained current timeline', (await call('get_project', { scope: 'overview' })).name === 'Actual manual edit');
        await call('add_voiceover', { text: 'Continue remaining work', engine: 'gemini', start_sec: 2 });
      } else {
        await call('set_project', { name: 'Agent owns this edit' });
        await call('add_voiceover', { text: 'First narration', engine: 'gemini', start_sec: 0 });
        if (!manual) {
          const images=call('generate_images', { scenes: [{ prompt: 'A quiet Edinburgh alley at dusk, rain glistening on cobblestones.', as:'overlay',start_sec: 0, duration_sec: 1 }, { prompt: 'A handwritten note beside an old brass key in warm window light.',as:'overlay', start_sec: 1, duration_sec: 1 }] });
          await until('!!document.querySelector(".pilot-activity-progress progress")');
          check('image activity shows real job progress',await q('document.querySelector(".pilot-activity-progress progress").max===2'));
          fs.writeFileSync(path.join(dir,'activity-running.png'),(await win.capturePage()).toPNG());
          await images;
          check('image batch retains ownership despite no-op callbacks', await q('!!window.__fve.history().agentEdit'));
          await call('add_voiceover', { text: 'Narration after images', engine: 'gemini', start_sec: 2 });
        }
      }
      let ready = false;
      for (let i = 0; i < 8 && !ready; i++) ready = (await call('complete_edit', {})).ready;
      assert.ok(ready);return { text: 'Ownership regression completed.' };
    } catch (error) { if (manual) return { text: '' };throw error; }
  };
  win.webContents.setBackgroundThrottling(false);win.setSize(1440, 1000);
  win.webContents.on('console-message', (_event, level, message) => { if (level >= 3) result.errors.push(message); });
  settings.setFirstRun({ tourSeen: true, packPromptSeen: true });settings.save({ provider: 'codex-sdk' });
  try {
    await until('!!window.__fve&&!!document.querySelector(".home-frame-card")');await click('.home-frame-card');await until('!!document.querySelector(".topbar")');await q('document.querySelector(".welcome-go")?.click()');
    const send = async text => {
      await q(`(()=>{const e=document.querySelector('.pilot-input textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,${JSON.stringify(text)});e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
      await until('!document.querySelector("button[aria-label=Send]").disabled');await click('button[aria-label=Send]');
    };
    await q(`window.__fve.load(${JSON.stringify(fixture('ownership-background'))})`);await click('.pilot-fab');await send('Add narration, generate the scenes, then add the remaining narration.');
    await until('!document.querySelector("button[aria-label=Stop]")&&[...document.querySelectorAll(".pilot-msg.assistant .bubble")].some(e=>e.textContent.includes("Ownership regression completed."))');
    check('narration after the image batch completes without false interruption', await q('!document.querySelector(".pilot-error")&&window.__fve.rawProject().audioClips.length===2&&window.__fve.rawProject().overlayClips.length===2'));
    check('background visuals survive while the edit stays one Undo step', await q('window.__fve.rawProject().media[0].poster&&window.__fve.history().past.length===1'));
    check('custom artwork replaces generic library icons for all visible tools',await q('![...document.querySelectorAll("[data-tool-icon] svg")].some(e=>e.classList.contains("lucide"))&&!!document.querySelector("[data-tool-icon=generate_images] path")&&!!document.querySelector("[data-tool-icon=complete_edit] path")'));
    check('activity shows narration content and verified results',await q('[...document.querySelectorAll(".pilot-activity-content")].some(e=>e.textContent.includes("First narration"))&&[...document.querySelectorAll(".pilot-activity-outcome")].some(e=>e.textContent.includes("Narration added"))'));
    await q('[...document.querySelectorAll(".pilot-activity-content")].find(e=>e.textContent.includes("Edinburgh")).open=true;void 0');
    check('scene prompts expand without raw tool JSON',await q('[...document.querySelectorAll(".pilot-activity-content[open] p")].some(e=>e.textContent.includes("cobblestones")&&e.textContent.includes("brass key"))'));
    await q('[...document.querySelectorAll(".pilot-activity-content[open]")].find(e=>e.textContent.includes("Edinburgh")).scrollIntoView({block:"center"});void 0');
    await wait(150);
    fs.writeFileSync(path.join(dir,'activity-completed.png'),(await win.capturePage()).toPNG());
    await click('button[aria-label="Close assistant"]');await click('.pilot-fab');await wait(300);
    check('tool context and custom icons survive reopening without a new call',await q('!!document.querySelector("[data-tool-icon=generate_images] path")&&[...document.querySelectorAll(".pilot-activity-outcome")].some(e=>e.textContent.includes("2 scene images added"))'));
    check('activity fits the chat width',await q('[...document.querySelectorAll(".pilot-activity-body")].every(e=>e.scrollWidth<=e.clientWidth+1)'));
    await q('window.__fve.dispatch({type:"undo"})');check('Undo restores the initial timeline', await q('!window.__fve.rawProject().audioClips.length&&!window.__fve.rawProject().overlayClips.length'));
    manual = true;
    await q(`window.__fve.load(${JSON.stringify(fixture('ownership-manual'))})`);await click('.pilot-fab');await send('Add a voiceover.');
    await until('!document.querySelector("button[aria-label=Stop]")&&!!document.querySelector(".pilot-error")');
    check('a real separate edit still stops stale narration', await q('window.__fve.rawProject().name==="Actual manual edit"&&!window.__fve.rawProject().audioClips.length'));
    check('interruption records its actual action without content', await q('window.__fve.history().agentInterruption.action==="setProject"&&window.__fve.history().agentInterruption.fields.join(",")==="name"'));
    check('edit interruptions use recovery UI instead of connection settings', await q('document.querySelector(".pilot-error b").textContent==="Editing was interrupted"&&!document.querySelector(".pilot-error").textContent.includes("Open Settings")'));
    fs.writeFileSync(path.join(dir, 'interruption.png'), (await win.capturePage()).toPNG());
    manual = false;continuing = true;
    await q('[...document.querySelectorAll(".pilot-error button")].find(b=>b.textContent==="Continue from current timeline").click()');
    await until('!document.querySelector("button[aria-label=Stop]")&&[...document.querySelectorAll(".pilot-msg.assistant .bubble")].some(e=>e.textContent.includes("Ownership regression completed."))');
    check('Continue resumes using retained work', await q('window.__fve.rawProject().name==="Actual manual edit"&&window.__fve.rawProject().audioClips.length===1'));
    check('renderer has no runtime errors', !result.errors.length);
  } catch (error) { result.error = error.stack;result.dom = await q('document.body.innerText.slice(-1600)');fs.writeFileSync(path.join(dir, 'failure.png'), (await win.capturePage()).toPNG()); }
  finally { local.runEditorNative = original.run;local.generateImage = original.image;local.status = original.status;speech.speak = original.speak; }
  fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify(result, null, 2));app.exit(result.error ? 1 : 0);
};
