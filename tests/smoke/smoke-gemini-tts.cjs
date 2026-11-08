// Isolated real renderer/IPC/settings/FFmpeg/tool loop with a simulated Gemini
// response. No real key or paid generation is used. FVE_SMOKE_MODE=gemini-tts.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { net } = require('electron');
const { fixtureWav } = require("../unit/audio/test-gemini-tts.cjs");

module.exports = async (win, app, dir) => {
  win.webContents.setBackgroundThrottling(false);
  const q = (js) => { new (require('node:vm').Script)(js); return win.webContents.executeJavaScript(js); };
  const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));
  const until = async (js) => {
    for (let i = 0; i < 200; i++) { if (await q(js)) return; await wait(100); }
    throw new Error(`Timed out: ${js}`);
  };
  const click = (selector) => q(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const chooseButton = (selector, text) => q(`[...document.querySelectorAll(${JSON.stringify(selector)})].find(el=>el.textContent.trim()===${JSON.stringify(text)}).click()`);
  const fill = (selector, value, tag = 'HTMLInputElement') => q(`(() => {
    const el=document.querySelector(${JSON.stringify(selector)});
    Object.getOwnPropertyDescriptor(${tag}.prototype,'value').set.call(el,${JSON.stringify(value)});
    el.dispatchEvent(new Event('input',{bubbles:true}));
  })()`);
  const select = (selector, value) => q(`(() => { const el=document.querySelector(${JSON.stringify(selector)});el.value=${JSON.stringify(value)};el.dispatchEvent(new Event('change',{bubbles:true})); })()`);
  const result = { checks: [], requests: [], errors: [] };
  const check = (name, ok) => { assert.ok(ok, name); result.checks.push(name); };
  const settings = require("../../electron/system/settings.cjs");
  settings.setFirstRun({ tourSeen: true, packPromptSeen: true });
  settings.save({ provider: 'ollama' });
  const oldFetch = net.fetch;
  let quota = false, generations = 0;
  const key = 'synthetic-gemini-smoke-key';
  net.fetch = async (url, opts = {}) => {
    if (!String(url).startsWith('https://generativelanguage.googleapis.com/v1beta/')) return oldFetch(url, opts);
    assert.equal(opts.headers['x-goog-api-key'], key);
    if (String(url).includes('/models/')) return new Response(JSON.stringify({ name: 'models/gemini-3.8-flash-tts' }));
    if (quota) return new Response(JSON.stringify({ error: { message: key } }), { status: 429 });
    const body = JSON.parse(opts.body);
    generations++;
    result.requests.push(body);
    return new Response(JSON.stringify({ status: 'completed', steps: [{ type: 'model_output', content: [
      { type: 'audio', mime_type: 'audio/wav', data: fixtureWav(2).toString('base64') },
    ] }] }));
  };
  const ai = require("../../electron/agents/ai.cjs");
  let turn = 0;
  ai.agentStep = async () => {
    const sequence = [
      { name: 'load_tools', args: { groups: ['audio'] } },
      { name: 'list_voices', args: {} },
      { name: 'add_voiceover', args: { text: 'A brief history of Morocco.', start_sec: 8, style: 'Warm documentary narrator.' } },
    ];
    const call = sequence[turn++];
    return call ? { calls: [call], content: { role: 'model', parts: [{ functionCall: call }] } }
      : { calls: [], text: 'Added English narration at eight seconds.', content: { role: 'model', parts: [{ text: 'Added English narration at eight seconds.' }] } };
  };
  const openSettings = async () => {
    await click('.topbar button[aria-label=Settings]');
    await until('!!document.querySelector(".set2-rail")');
    await chooseButton('.set2-rail button', 'Voice');
  };
  win.webContents.on('console-message', (_e, level, message) => { if (level >= 3) result.errors.push(message); });
  try {
    await until('!!window.__fve && !!document.querySelector(".home-frame-card")');
    await click('.home-frame-card'); await until('!!document.querySelector(".topbar")');
    await q('document.querySelector(".welcome-go")?.click();window.__fve.tab("audio")');
    await until('[...document.querySelectorAll(".src-chip")].some(b=>b.textContent.trim()==="Text to speech")');
    await chooseButton('.src-chip', 'Text to speech');
    await until('!!document.querySelector(".tts")');
    await chooseButton('.tts .seg-tabs button', 'Gemini');
    await until('document.querySelector(".tts .stock-key b")?.textContent==="Gemini TTS key needed"');
    check('missing key prevents generation', !!(await q(`window.api.ttsSpeak({engine:'gemini',text:'Hello'})`)).error);
    const before = settings.getPublic();
    await openSettings();
    await fill('input[aria-label="Gemini TTS API key"]', key);
    await chooseButton('.settings-actions button', 'Save key');
    await until('(async()=>!!(await window.api.settingsGet()).serviceKeys["gemini-tts"])()');
    const saved = settings.getPublic();
    check('TTS key is independent of chat credentials', JSON.stringify(saved.keys) === JSON.stringify(before.keys) && saved.provider === before.provider);
    const disk = fs.readFileSync(path.join(dir,'settings-test','settings.json'),'utf8');
    check('key is encrypted and only a hint is exposed', !disk.includes(key) && !JSON.stringify(saved).includes(key) && !!saved.serviceKeys['gemini-tts']);
    await chooseButton('.settings-actions button', 'Test key');
    await until('document.querySelector(".settings-section .result")?.textContent.includes("model access confirmed")');
    await click('button[aria-label="Close settings"]');
    await until(`!!document.querySelector('select[aria-label="Gemini speech model"]')`);
    check('saving a key refreshes the already-open speech panel', await q(`document.querySelectorAll('select[aria-label="Gemini voice"] option').length===30`));
    await select('select[aria-label="Gemini speech model"]', 'gemini-3.8-flash-lite-tts');
    await select('select[aria-label="Gemini voice"]', 'Puck');
    await fill('.tts textarea:not([aria-label])', 'مرحبا بكم في المغرب.', 'HTMLTextAreaElement');
    await fill('textarea[aria-label="Speech delivery"]', 'Warm Moroccan Arabic documentary narration.', 'HTMLTextAreaElement');
    await q('HTMLMediaElement.prototype.play=()=>Promise.resolve();window.__fve.seek(3.25)');
    await chooseButton('.tts .row-btns button', 'Preview');
    await until('[...document.querySelectorAll(".tts .row-btns button")].some(b=>b.textContent.trim()==="Stop")');
    await chooseButton('.tts .row-btns button', 'Stop');
    await chooseButton('.tts .row-btns button', 'Add to timeline');
    await until('window.__fve.exportData().project.audioClips.length===1');
    const manual = await q('window.__fve.exportData().project');
    const clip = manual.audioClips[0], media = manual.media.find(m=>m.id===clip.mediaId);
    check('preview and add share the cached WAV', generations === 1);
    check('manual speech is probed and placed at the playhead', clip.start === 3.25 && clip.out === 2 && media.type === 'audio' && media.origin === 'tts' && media.path.startsWith(dir));
    const exported = path.join(dir, 'speech-export.wav');
    const ff = require("../../electron/media/ffmpeg.cjs");
    await ff.exportAudio(manual, exported, 'wav');
    const exportedInfo = await ff.probe(exported);
    check('generated speech is included by the audio export engine', exportedInfo.type === 'audio' && Math.abs(exportedInfo.duration - 5.25) < 0.05);
    check('model, voice, transcript and delivery reach Gemini', result.requests[0].model === 'gemini-3.8-flash-lite-tts'
      && result.requests[0].generation_config.speech_config[0].voice === 'Puck'
      && result.requests[0].input[0].content[0].text === 'مرحبا بكم في المغرب.'
      && result.requests[0].input[0].content[0].annotations[0].style === 'Warm Moroccan Arabic documentary narration.');
    fs.writeFileSync(path.join(dir,'speech-panel.png'),(await win.capturePage()).toPNG());
    await click('.pilot-fab'); await until('!!document.querySelector(".pilot-input textarea")');
    await fill('.pilot-input textarea','Add English narration at eight seconds.','HTMLTextAreaElement');
    await until('!document.querySelector("button[aria-label=Send]").disabled');
    await click('button[aria-label=Send]');
    await until('window.__fve.exportData().project.audioClips.length===2 && !!document.querySelector(".pilot-undo")');
    check('CraftAI generates speech through the real tool loop', generations===2 && (await q('window.__fve.exportData().project.audioClips')).some(c=>c.start===8));
    check('CraftAI prefers configured Gemini', result.requests[1].model==='gemini-3.8-flash-tts');
    await click('.pilot-undo'); await until('window.__fve.exportData().project.audioClips.length===1');
    check('one Undo removes the AI speech and preserves manual audio', (await q('window.__fve.exportData().project.audioClips[0].start'))===3.25);
    await click('button[aria-label="Close assistant"]');
    quota = true;
    await fill('.tts textarea:not([aria-label])','A different passage to test quota.','HTMLTextAreaElement');
    await chooseButton('.tts .row-btns button','Add to timeline');
    await until('document.querySelector(".tts .error-text")?.textContent.includes("quota")');
    check('quota errors do not insert audio or expose keys', await q(`window.__fve.exportData().project.audioClips.length===1 && !document.querySelector('.tts').textContent.includes(${JSON.stringify(key)})`));
    await openSettings();
    await click('button[aria-label="Delete saved Gemini TTS API key"]');
    await until('(async()=>!(await window.api.settingsGet()).serviceKeys["gemini-tts"])()');
    await click('button[aria-label="Close settings"]');
    await until('document.querySelector(".tts .stock-key b")?.textContent==="Gemini TTS key needed"');
    check('removing the key disables generation again', true);
    check('no renderer errors', result.errors.length===0);
    result.ok=true;
  } catch (e) { result.error=e.stack; result.ok=false; }
  finally { net.fetch=oldFetch; }
  fs.writeFileSync(path.join(dir,'result.json'),JSON.stringify(result,null,2));
  console.log(JSON.stringify({ok:result.ok,checks:result.checks,error:result.error,dir}));
  app.exit(result.ok?0:1);
};
