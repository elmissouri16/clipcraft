// Piper voices as optional downloads in the real app (electron/audio/tts.cjs): a fresh install offers no Piper voice
// and points to Settings > Voice; the engine and a voice download there with progress (real downloads, ~90 MB);
// a download can be canceled; Audio > Text to speech then speaks with the downloaded voice onto the timeline;
// removing the voice takes it away again. Runs this platform's runtime (Piper on Windows and Linux,
// sherpa-onnx on macOS).
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');

module.exports = async (win, app, dir) => {
  const q = (s) => win.webContents.executeJavaScript(s), wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const result = { checks: [], errors: [] };
  const check = (name, value) => { assert.ok(value, name); result.checks.push(name); };
  const until = async (code, ms = 20000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await q(code)) return; await wait(60); } throw Error('Timed out: ' + code); };
  const shot = async (name) => fs.writeFileSync(path.join(dir, name), (await win.capturePage()).toPNG());
  const click = (selector, text) => q(`[...document.querySelectorAll(${JSON.stringify(selector)})].find(b=>b.textContent.trim().startsWith(${JSON.stringify(text)})).click()`);
  win.webContents.on('console-message', (_e, level, text) => { if (level >= 3 && !/ERR_FILE_NOT_FOUND|Failed to load resource/.test(text)) result.errors.push(text); });
  const openTts = async () => {
    await q(`window.__fve.tab('audio')`);
    await until(`[...document.querySelectorAll('.src-chip')].some(b=>b.textContent.trim()==='Text to speech')`);
    await click('.src-chip', 'Text to speech');
    await until('!!document.querySelector(".tts")');
    await click('.tts .seg-tabs button', 'Piper');
  };
  try {
    win.setContentSize(1440, 900); win.show();
    await until('!!window.__fve&&!!document.querySelector(".home-frame-card")');
    await q('document.querySelector(".home-frame-card").click()');
    await until('!!document.querySelector(".topbar")');
    await openTts();
    await until('!!document.querySelector(".tts [data-piper-missing]")');
    check('a fresh install offers no Piper voice and points to Settings', await q(`document.querySelector('.tts [data-piper-missing]').textContent.includes('Download the voice engine')&&[...document.querySelectorAll('.tts button')].find(b=>b.textContent.includes('Add to timeline')).disabled`));
    await wait(400); // let the panel repaint before the screenshot
    await shot('piper-1-missing.png');

    // Settings > Voice opens from the panel.
    await click('.tts [data-piper-missing] button', 'Open Settings');
    await until('!!document.querySelector(\'[data-piper="engine"]\')');
    check('Open Settings goes straight to Voice with the engine and eight voices', await q(`document.querySelector('[data-section="speech"]').getAttribute('aria-current')==='true'&&document.querySelectorAll('[data-piper]').length===9`));
    result.rows = await q(`[...document.querySelectorAll('[data-piper]')].map(r=>r.textContent)`);
    check('each download shows its size', result.rows.every((t) => /Download · \d+ MB/.test(t)));

    // The engine, then a voice, with progress.
    await click('[data-piper="engine"] button', 'Download');
    await until('!!document.querySelector(\'[data-piper="engine"] .piper-progress\')', 10000);
    check('the engine download shows progress with Cancel', await q(`!!document.querySelector('[data-piper="engine"] .piper-progress')&&[...document.querySelectorAll('[data-piper="engine"] button')].some(b=>b.textContent==='Cancel')`));
    await until(`[...document.querySelectorAll('[data-piper="engine"] button')].some(b=>b.textContent==='Remove')`, 300000);
    check('the engine is installed', true);
    await click('[data-piper="fr_FR-gilles-low"] button', 'Download');
    await until(`[...document.querySelectorAll('[data-piper="fr_FR-gilles-low"] button')].some(b=>b.textContent==='Remove')`, 300000);
    check('a voice is downloaded', true);
    // Another voice: started, then canceled; nothing is kept.
    await click('[data-piper="en_GB-cori-medium"] button', 'Download');
    await until('!!document.querySelector(\'[data-piper="en_GB-cori-medium"] .piper-progress\')', 10000);
    await click('[data-piper="en_GB-cori-medium"] button', 'Cancel');
    await until(`[...document.querySelectorAll('[data-piper="en_GB-cori-medium"] button')].some(b=>b.textContent.startsWith('Download'))`, 30000);
    const status = await q('window.api.ttsStatus()');
    check('a canceled download keeps nothing', status.installed && status.voices.find((v) => v.id === 'fr_FR-gilles-low').downloaded && !status.voices.find((v) => v.id === 'en_GB-cori-medium').downloaded
      && !fs.readdirSync(path.join(dir, 'tts')).some((f) => /\.part$|^\.unpack-|\.tar\.|\.zip$/.test(f)));
    await shot('piper-2-settings.png');
    await q(`document.querySelector('button[aria-label="Close settings"]').click()`);
    await until('!document.querySelector(\'[data-piper="engine"]\')');

    // Speak with the downloaded voice onto the timeline.
    await openTts();
    await until(`document.querySelectorAll('.tts select[aria-label="Voice"] option').length===1`);
    check('the panel offers only the downloaded voice', await q(`document.querySelector('.tts select[aria-label="Voice"]').value==='fr_FR-gilles-low'`));
    await q(`(() => { const t = document.querySelector('.tts textarea'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(t, 'Bonjour, ceci est ClipCraft.'); t.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    const before = await q('window.__fve.rawProject().audioClips.length');
    await click('.tts button', 'Add to timeline');
    await until(`window.__fve.rawProject().audioClips.length>${before}`, 120000);
    const added = await q(`(()=>{const p=window.__fve.rawProject(),c=p.audioClips.at(-1),m=p.media.find(x=>x.id===c.mediaId);return {len:c.out-c.in,name:m.name,credit:m.credit?.line,path:m.path}})()`);
    result.added = added;
    check('the voice is spoken onto the timeline with its credit', added.len > 1 && added.credit === 'Voice: Piper fr_FR-gilles-low' && fs.existsSync(added.path));
    check('no error in the panel', !(await q(`document.querySelector('.tts .error-text')?.textContent||''`)));
    await shot('piper-3-spoken.png');

    // Removing the voice: the panel points to Settings again.
    await q(`window.api.ttsPiperRemove('fr_FR-gilles-low')`);
    await q(`window.__fve.tab('media')`); await wait(200); await openTts();
    await until('!!document.querySelector(".tts [data-piper-missing]")');
    check('after removing the voice the panel asks for a voice', await q(`document.querySelector('.tts [data-piper-missing]').textContent.includes('Download at least one voice')`));
    check('no interface errors', !result.errors.length);
  } catch (error) {
    result.error = error.stack || error.message;
    await shot('piper-failure.png').catch(() => {});
  } finally {
    fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify(result, null, 2));
    app.exit(result.error ? 1 : 0);
  }
};
