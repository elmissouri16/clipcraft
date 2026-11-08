// Real editor/IPC/FFmpeg; speech inference alone is injected to avoid downloads.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
module.exports = async (win, app, dir) => {
  fs.mkdirSync(dir, { recursive: true });
  const ff = require("../../electron/media/ffmpeg.cjs"), ai = require("../../electron/agents/ai.cjs"), settings = require("../../electron/system/settings.cjs"), whisper = require("../../electron/audio/whisper.cjs");
  const original = { step: ai.agentStep, install: whisper.install, transcribe: whisper.transcribe };
  const result = { checks: [], errors: [] }, q = js => win.webContents.executeJavaScript(js), wait = ms => new Promise(r => setTimeout(r, ms));
  const check = (name, ok) => { assert.ok(ok, name); result.checks.push(name); };
  const until = async (js, ms = 30000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await q(js)) return; await wait(50); } throw new Error(`Timed out: ${js}`); };
  const click = selector => q(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const reply = (calls, text = '') => ({ calls, text, content: { role: 'model', parts: [...calls.map(functionCall => ({ functionCall })), ...(text ? [{ text }] : [])] } });
  let plan = [], responses = [], inference = 0, stopped = false, started = false;
  ai.agentStep = async (_cfg, req) => { responses.push(...req.contents.at(-1)?.parts?.filter(p => p.functionResponse).map(p => p.functionResponse) || []); return plan.shift() || reply([], 'Verified.'); };
  whisper.install = async () => {};
  whisper.transcribe = async (_dir, _wav, opts) => {
    inference++;
    if (opts.language === 'fr') { started = true; return new Promise((_resolve, reject) => opts.signal.addEventListener('abort', () => { stopped = true; reject(Object.assign(new Error('Stopped'), { name: 'AbortError' })); }, { once: true })); }
    return Array.from({ length: 450 }, (_, i) => ({ text: `word${i}`, start: i * .02, end: i * .02 + .018,
      words: [{ text: `word${i}`, start: i * .02, end: i * .02 + .018, timing: 'measured' }], word_timing: 'measured' }));
  };
  settings.setFirstRun({ tourSeen: true, packPromptSeen: true }); settings.save({ provider: 'ollama' }); win.webContents.setBackgroundThrottling(false);
  win.webContents.on('console-message', (_event, level, text) => { if (level >= 3) result.errors.push(text); });
  const send = async (steps, finish = true) => {
    plan = [reply([{ name: 'load_tools', args: { groups: ['timeline', 'text'] } }]), ...steps.map(calls => reply(calls))]; responses = [];
    await q(`(()=>{const el=document.querySelector('.pilot-input textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(el,'Run the audio regression edit.');el.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await until('!document.querySelector("button[aria-label=Send]").disabled'); await click('button[aria-label=Send]');
    await until('!!document.querySelector("button[aria-label=Stop]")'); if (finish) { await until('!document.querySelector("button[aria-label=Stop]")'); responses = await q('window.__fve.rawProject().craftAI.sessions.flatMap(s=>s.contents.flatMap(t=>t.parts.filter(p=>p.functionResponse).map(p=>p.functionResponse)))'); }
  };
  let id = 0;
  const load = async p => { await q(`window.__fve.load(${JSON.stringify({ ...p, id: `agent-audio-${++id}` })})`); await until('!!document.querySelector(".pilot-fab")'); await click('.pilot-fab'); await until('!!document.querySelector(".pilot-input textarea")'); };
  try {
    const source = path.join(dir, 'speech-source.mp4');
    execFileSync(ff.ffmpegPath, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=blue:s=160x90:r=10:d=10', '-f', 'lavfi', '-i', "aevalsrc='if(between(t,3,4),0,0.2*sin(2*PI*440*t))':s=16000:d=10", '-shortest', '-pix_fmt', 'yuv420p', source]);
    await until('!!window.__fve&&!!document.querySelector(".home-frame-card")'); await click('.home-frame-card'); await until('!!document.querySelector(".topbar")'); await q('document.querySelector(".welcome-go")?.click()');
    const media = await ff.probe(source);
    const base = () => ({ name: 'Audio analysis regression', ratio: '16:9', width: 320, height: 180, fps: 10,
      media: [{ ...media, id: 'm', path: source, name: 'speech-source.mp4' }], videoClips: [{ id: 'v', mediaId: 'm', in: 0, out: 10, speed: 1, muted: true }],
      audioClips: [{ id: 'a', mediaId: 'm', in: 0, out: 10, start: 0, speed: 1 }], overlayClips: [], textClips: [], effectClips: [] });
    await load(base()); await send([[{ name: 'remove_silences', args: { keep_padding_sec: 0 } }]]);
    let after = await q('window.__fve.rawProject()');
    check('detached audio survives silence removal through real IPC', Math.abs(after.videoClips.reduce((sum, c) => sum + (c.out - c.in) / (c.speed || 1), 0) - 9) < .11);
    check('audio follows the removed pause', after.audioClips.length === 2 && after.audioClips[1].start === 3);
    await load({ ...base(), audioClips: [], overlayClips: [{ id: 'ov', mediaId: 'm', in: 0, out: 10, start: 0, speed: 1 }] });
    await send([[{ name: 'transcribe', args: { limit: 100 } }], [{ name: 'transcribe', args: { offset: 400, limit: 100 } }],
      [{ name: 'set_project', args: { name: 'Renamed without changing speech' } }], [{ name: 'add_captions', args: { words_per_caption: 3 } }]]);
    after = await q('window.__fve.rawProject()');
    const reads = responses.filter(r => r.name === 'transcribe').map(r => r.response.result), caption = responses.find(r => r.name === 'add_captions')?.response.result;
    check('overlay speech uses the real audio pipeline', after.textClips.length === 450);
    check('long transcript tail is accessible by page', reads[1]?.segments.at(-1)?.text === 'word449' && reads[0]?.next_offset === 100);
    check('visual edits and caption creation reuse one inference', inference === 1 && caption?.cached_transcript === true);
    check('caption words preserve measured boundaries', after.textClips[1].start === .02 && Math.abs(after.textClips[1].words[0].end - .018) < 1e-8);
    check('project and chat contain no image/audio payload', !/data:(?:image|audio)\/[^;]+;base64/.test(JSON.stringify(after)));
    await send([[{ name: 'transcribe', args: { language: 'fr' } }]], false);
    for (let i = 0; i < 500 && !started; i++) await wait(20);
    assert.ok(started, 'cancel fixture started'); await click('button[aria-label=Stop]'); await until('!document.querySelector("button[aria-label=Stop]")');
    check('Stop aborts the inference job without changing captions', stopped && (await q('window.__fve.rawProject().textClips.length')) === 450);
    check('no renderer exceptions', result.errors.length === 0); result.ok = true; result.inference = inference;
    fs.writeFileSync(path.join(dir, 'editor.png'), (await win.capturePage()).toPNG());
  } catch (error) { result.ok = false; result.error = error.stack; fs.writeFileSync(path.join(dir, 'failure.png'), (await win.capturePage()).toPNG()); }
  finally { ai.agentStep = original.step; whisper.install = original.install; whisper.transcribe = original.transcribe; }
  fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify({ ok: result.ok, checks: result.checks, error: result.error, dir })); app.exit(result.ok ? 0 : 1);
};
