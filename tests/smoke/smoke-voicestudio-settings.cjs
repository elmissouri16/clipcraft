// The VoiceStudio connector in the real app (electron/audio/tts.cjs), against a stand-in VoiceStudio served by this
// test (the discovery document, voices, engine and speech endpoints as VoiceStudio 0.5.5 answers them). A fresh
// install has the connector off and Audio > Text to speech says so; Settings > Voice turns it on, takes the address
// and tests it; VoiceStudio can be the default voice; the panel speaks with a listed voice onto the timeline, with
// its credit; when the app stops answering the panel says it is not running.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict'), http = require('node:http');

// `seconds` of a quiet tone as VoiceStudio returns it: WAV, 24 kHz, mono, 16-bit.
function wav(seconds) {
  const rate = 24000, n = Math.round(rate * seconds), b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.sin((i / rate) * 2 * Math.PI * 220) * 6000), 44 + i * 2);
  return b;
}
// The stand-in VoiceStudio on a free port of this computer.
function standIn() {
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
      requests.push({ method: req.method, path: req.url, body });
      const json = (code, o) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
      if (req.url === '/.well-known/voicestudio-speech') return json(200, { schema: 'voicestudio.speech-capabilities', protocol: 'voicestudio.speech.v1', service: 'VoiceStudio', service_version: '0.5.5', local_first: true });
      if (req.url === '/v1/audio/voices') return json(200, { voices: [{ voice_id: 'alloy', name: 'Alloy', type: 'openai_alias' }, { voice_id: 'nova', name: 'Nova', type: 'openai_alias' }, { voice_id: 'demo0001', name: 'Demo Narrator', type: 'profile', language: 'English' }] });
      if (req.url === '/engines/tts') return json(200, { active: 'omnivoice', backends: [{ id: 'omnivoice', display_name: 'VoiceStudio (OmniVoice)', available: true, supports_cloning: true }, { id: 'kittentts', display_name: 'KittenTTS', available: true }, { id: 'mlx-audio', display_name: 'MLX-Audio', available: true }, { id: 'cosyvoice', display_name: 'CosyVoice 3', available: false }] });
      if (req.url === '/models') return json(200, [{ repo_id: 'mlx-community/Qwen3-TTS-12Hz-1.7B-VoiceDesign-4bit', label: 'Qwen3-TTS 1.7B 4bit (voice design, mlx-audio)', engines: ['mlx-audio'], installed: true }]);
      if (req.url === '/v1/audio/speech' && req.method === 'POST') {
        const b = JSON.parse(body || '{}');
        if (!b.input) return json(500, { detail: 'omnivoice sidecar synthesize error: missing text' });
        res.writeHead(200, { 'Content-Type': 'audio/wav' });
        return res.end(wav(Math.max(1.2, b.input.length / 15)));
      }
      json(404, { detail: 'Not Found' });
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ requests, url: `127.0.0.1:${server.address().port}`,
    close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(() => r()); }) })));
}

module.exports = async (win, app, dir) => {
  const q = (s) => win.webContents.executeJavaScript(s), wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const result = { checks: [], errors: [] };
  const check = (name, value) => { assert.ok(value, name); result.checks.push(name); };
  const until = async (code, ms = 20000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await q(code)) return; await wait(60); } throw Error('Timed out: ' + code); };
  const shot = async (name) => fs.writeFileSync(path.join(dir, name), (await win.capturePage()).toPNG());
  const click = (selector, text) => q(`[...document.querySelectorAll(${JSON.stringify(selector)})].find(b=>b.textContent.trim().startsWith(${JSON.stringify(text)})).click()`);
  const setValue = (selector, value, proto = 'HTMLInputElement', event = 'input') => q(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(${proto}.prototype,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event(${JSON.stringify(event)},{bubbles:true}));})()`);
  win.webContents.on('console-message', (_e, level, text) => { if (level >= 3 && !/ERR_FILE_NOT_FOUND|Failed to load resource/.test(text)) result.errors.push(text); });
  const openTts = async () => {
    await q(`window.__fve.tab('audio')`);
    await until('!!document.querySelector(\'.audio-browser-actions button[aria-label="Text to speech"]\')');
    await q(`document.querySelector('.audio-browser-actions button[aria-label="Text to speech"]').click()`);
    await until('!!document.querySelector(".tts")');
    await click('.tts .seg-tabs button', 'VoiceStudio');
  };
  let studio = null;
  try {
    studio = await standIn();
    win.setContentSize(1440, 900); win.show();
    await until('!!window.__fve&&!!document.querySelector(".home-frame-card")');
    await q('document.querySelector(".home-frame-card").click()');
    await until('!!document.querySelector(".topbar")');
    await openTts();
    await until('!!document.querySelector(\'.tts [data-studio-missing="off"]\')');
    check('a fresh install has the connector off and the panel says so', await q(`document.querySelector('.tts [data-studio-missing]').textContent.includes('VoiceStudio is off')&&[...document.querySelectorAll('.tts button')].find(b=>b.textContent.includes('Add to timeline')).disabled`));
    await wait(400);
    await shot('voicestudio-1-off.png');

    // Settings > Voice: the switch, the address, Test.
    await click('.tts [data-studio-missing] button', 'Open Settings');
    await until('!!document.querySelector(\'input.switch[aria-label="Use VoiceStudio"]\')');
    check('Open Settings goes straight to Voice with the connector switch off', await q(`document.querySelector('[data-section="speech"]').getAttribute('aria-current')==='true'&&!document.querySelector('input.switch[aria-label="Use VoiceStudio"]').checked&&!document.querySelector('input[aria-label="VoiceStudio address"]')`));
    await q(`document.querySelector('input.switch[aria-label="Use VoiceStudio"]').click()`);
    // The default address may or may not have a real VoiceStudio behind it on this computer: either way the
    // state is reported, and the stand-in's address is what the rest of the test uses.
    await until('!!document.querySelector(\'[data-studio-state]\')', 30000);
    result.defaultState = await q(`document.querySelector('[data-studio-state]').getAttribute('data-studio-state')+': '+document.querySelector('[data-studio-state]').textContent`);
    check('switched on, the address field and the state at the default address appear', await q(`document.querySelector('input[aria-label="VoiceStudio address"]').placeholder==='127.0.0.1:3900'&&/not running|is running/.test(document.querySelector('[data-studio-state]').textContent)`));
    await setValue('input[aria-label="VoiceStudio address"]', studio.url);
    await q(`document.querySelector('input[aria-label="VoiceStudio address"]').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))`);
    await until(`document.querySelector('[data-studio-state="running"]')?.textContent.includes('Demo Narrator')`, 30000);
    result.state = await q(`document.querySelector('[data-studio-state]').textContent`);
    check('the saved address answers: version, engine and the voices, the described one included', /VoiceStudio 0\.5\.5 is running: VoiceStudio \(OmniVoice\), 3 voices\./.test(result.state) && result.state.includes('Default voice, Demo Narrator, Describe a voice (Qwen3-TTS)'));
    await click('button', 'Test connection');
    await until('!!document.querySelector("[data-studio-test]")');
    check('Test connection reports the same', await q(`document.querySelector('[data-studio-test]').classList.contains('ok')&&document.querySelector('[data-studio-test]').textContent.includes('3 voices')`));
    check('the connector is saved', await q(`window.api.ttsStatus().then(s=>s.studio.enabled&&s.studio.running&&s.studio.url==='http://${studio.url}')`));
    await shot('voicestudio-2-settings.png');

    // The default voice (Settings > Voice): VoiceStudio with one of its voices.
    check('the default starts automatic and names what it uses now', await q(`document.querySelector('select[aria-label="Default voice engine"]').value==='auto'&&document.querySelector('[data-default-voice-note]').textContent.includes('Now: VoiceStudio · Default voice')`));
    check('engines that are not set up say what they need', await q(`[...document.querySelectorAll('select[aria-label="Default voice engine"] option')].find(o=>o.value==='gemini').textContent==='Gemini (add key in API keys)'`));
    await setValue('select[aria-label="Default voice engine"]', 'voicestudio', 'HTMLSelectElement', 'change');
    await until(`document.querySelector('select[aria-label="Default voice"]')?.value==='alloy'`);
    await setValue('select[aria-label="Default voice"]', 'demo0001', 'HTMLSelectElement', 'change');
    await until(`document.querySelector('[data-default-voice-note]').textContent.startsWith('Now: VoiceStudio · Demo Narrator. CraftAI uses it')`);
    check('choosing VoiceStudio saves it with the chosen voice', (await q('window.api.ttsStatus()')).voiceDefault.voice === 'demo0001');
    await shot('voicestudio-2b-default.png');
    await q(`document.querySelector('button[aria-label="Close settings"]').click()`);
    await until(`document.querySelector('.tts .seg-tabs button[aria-selected="true"]')?.textContent.startsWith('VoiceStudio')`);
    check('closing Settings puts the panel on the default voice', true);

    // Speak with a listed voice onto the timeline.
    await until(`document.querySelectorAll('.tts select[aria-label="Voice"] option').length===3&&document.querySelector('.tts select[aria-label="Voice"]').value==='demo0001'`);
    check('the panel offers the voices VoiceStudio lists, on the default one', true);
    // One Voice list carries the engines: the default voice names VoiceStudio's active engine, the profile, and a
    // "Describe a voice" entry for the voice-design engine, which needs a description in Style before it speaks.
    check('the voice list: default voice with the active engine, the profile, and the voice-design entry', await q(`[...document.querySelectorAll('.tts select[aria-label="Voice"] option')].map(o=>o.textContent).join('|')==='Default voice · VoiceStudio (OmniVoice)|Demo Narrator · English|Describe a voice (Qwen3-TTS)'`));
    await setValue('.tts textarea', 'Hello from ClipCraft, spoken by VoiceStudio.', 'HTMLTextAreaElement');
    await setValue('.tts select[aria-label="Voice"]', 'design:mlx-audio', 'HTMLSelectElement', 'change');
    await until(`[...document.querySelectorAll('.tts button')].find(b=>b.textContent.includes('Add to timeline')).disabled&&document.querySelector('.tts input[aria-label="Speech style"]').required`);
    check('a described voice needs its description first', await q(`document.querySelector('.tts .error-text')?.textContent==='Describe the voice first: this engine needs it.'`));
    await setValue('.tts select[aria-label="Voice"]', 'demo0001', 'HTMLSelectElement', 'change');
    await until(`!document.querySelector('.tts input[aria-label="Speech style"]').required&&![...document.querySelectorAll('.tts button')].find(b=>b.textContent.includes('Add to timeline')).disabled`);
    const before = await q('window.__fve.rawProject().audioClips.length');
    await click('.tts button', 'Add to timeline');
    await until(`window.__fve.rawProject().audioClips.length>${before}`, 120000);
    const added = await q(`(()=>{const p=window.__fve.rawProject(),c=p.audioClips.at(-1),m=p.media.find(x=>x.id===c.mediaId);return {len:c.out-c.in,name:m.name,credit:m.credit?.line,license:m.credit?.license,path:m.path}})()`);
    result.added = added;
    check('the voice is spoken onto the timeline with its credit', added.len > 1 && added.credit === 'Voice generated with VoiceStudio (Demo Narrator)' && added.license === 'voicestudio' && fs.existsSync(added.path));
    let speech = studio.requests.filter((r) => r.path === '/v1/audio/speech');
    result.speech = speech.map((r) => JSON.parse(r.body));
    check('one speech request, as the OpenAI-style API expects it, through the active engine', speech.length === 1 && result.speech[0].model === 'tts-1' && result.speech[0].voice === 'demo0001' && result.speech[0].response_format === 'wav' && result.speech[0].input === 'Hello from ClipCraft, spoken by VoiceStudio.');
    check('no error in the panel', !(await q(`document.querySelector('.tts .error-text')?.textContent||''`)));
    await shot('voicestudio-3-spoken.png');
    // The described voice: its description goes as the style, the request names the voice-design engine.
    await setValue('.tts select[aria-label="Voice"]', 'design:mlx-audio', 'HTMLSelectElement', 'change');
    await setValue('.tts input[aria-label="Speech style"]', 'A sad woman, almost crying, speaking slowly');
    await setValue('.tts textarea', 'Please, just listen to me for one second.', 'HTMLTextAreaElement');
    await until(`![...document.querySelectorAll('.tts button')].find(b=>b.textContent.includes('Add to timeline')).disabled`);
    await click('.tts button', 'Add to timeline');
    await until(`window.__fve.rawProject().audioClips.length>${before + 1}`, 120000);
    speech = studio.requests.filter((r) => r.path === '/v1/audio/speech'); result.speech = speech.map((r) => JSON.parse(r.body));
    const designed = await q(`(()=>{const p=window.__fve.rawProject(),c=p.audioClips.at(-1),m=p.media.find(x=>x.id===c.mediaId);return m.credit?.line})()`);
    check('a described voice speaks through the voice-design engine with the description as its style', speech.length === 2 && result.speech[1].model === 'mlx-audio' && result.speech[1].voice === 'alloy' && result.speech[1].instruct === 'A sad woman, almost crying, speaking slowly' && designed === 'Voice generated with VoiceStudio (Qwen3-TTS voice design)');
    await shot('voicestudio-3b-described.png');

    // VoiceStudio stops: the panel says so, and the saved default stays saved but is not used.
    await studio.close(); const closed = studio; studio = null;
    await q(`window.__fve.tab('media')`); await wait(200); await openTts();
    await until('!!document.querySelector(\'.tts [data-studio-missing="down"]\')', 30000);
    check('when VoiceStudio stops answering the panel says it is not running', await q(`document.querySelector('.tts [data-studio-missing]').textContent.includes('VoiceStudio is not running')`));
    const after = await q('window.api.ttsStatus()');
    check('a default that is no longer answering stays saved but is not used', after.voiceDefault.engine === 'voicestudio' && after.studio.enabled && !after.studio.running && !after.studio.voices.length);
    check('ClipCraft never asked the stand-in for anything but discovery, voices, engines, models and speech', closed.requests.every((r) => ['/.well-known/voicestudio-speech', '/v1/audio/voices', '/engines/tts', '/models', '/v1/audio/speech'].includes(r.path)));
    await shot('voicestudio-4-stopped.png');
    check('no interface errors', !result.errors.length);
  } catch (error) {
    result.error = error.stack || error.message;
    await shot('voicestudio-failure.png').catch(() => {});
  } finally {
    await studio?.close().catch(() => {});
    fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify(result, null, 2));
    app.exit(result.error ? 1 : 0);
  }
};
