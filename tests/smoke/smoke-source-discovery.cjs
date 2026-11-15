const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
module.exports = async (win, app, dir) => {
  fs.mkdirSync(dir, { recursive: true });
  const ff = require('../../electron/media/ffmpeg.cjs'), ai = require('../../electron/agents/ai.cjs'), local = require('../../electron/agents/localAgents.cjs'), settings = require('../../electron/system/settings.cjs');
  const original = { step: ai.agentStep, native: local.runEditorNative, status: local.status };
  const result = { ok: false, checks: [], providers: [], errors: [] }, q = js => win.webContents.executeJavaScript(js), wait = ms => new Promise(r => setTimeout(r, ms));
  const until = async js => { for (let n = 0; n < 600; n++) { if (await q(js)) return;await wait(100); }throw Error('Timeout: ' + js); };
  const check = (name, value) => { assert.ok(value, name);result.checks.push(name); };
  const click = selector => q(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const send = async text => { await q(`(()=>{const el=document.querySelector('.pilot-input textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(el,${JSON.stringify(text)});el.dispatchEvent(new Event('input',{bubbles:true}));})()`);await until('!document.querySelector("button[aria-label=Send]").disabled');await click('button[aria-label=Send]'); };
  const source = path.join(dir, 'recording.mp4');
  execFileSync(ff.ffmpegPath, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=320x180:r=12:d=24', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=24', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', source]);
  const media = { ...await ff.probe(source), path: source, id: 'recording', name: 'Gameplay session.mp4' };
  const fixture = name => ({ id: 'discovery-' + name, name: 'Source discovery check', ratio: '16:9', width: 320, height: 180, fps: 12, media: [media], videoClips: [{ id: 'existing', mediaId: media.id, in: 0, out: 2, speed: 1 }], overlayClips: [], audioClips: [], textClips: [], effectClips: [] });
  let steps = [], position = 0, responses = [], provider = '', indexId, candidate, review, pick, adding = false;
  const latest = name => responses.filter(r => r.name === name).at(-1)?.result;
  const discoverySteps = () => [
    ['load_tools', () => ({ groups: ['discovery'] })],
    ['index_video', () => ({ media_id: media.id, speech: false, chunk_sec: 10, max_chunks: 1 })],
    ['index_video', () => ({ media_id: media.id, speech: false, chunk_sec: 10, max_chunks: 8 })],
    ['find_video_moments', () => ({ media_id: media.id, index_id: indexId, kind: 'gameplay', clip_length_sec: 6, start_sec: 10, limit: 3 })],
    ['review_video_moment', () => ({ media_id: media.id, index_id: indexId, moment_id: candidate.moment_id, start_sec: candidate.start_sec, end_sec: candidate.end_sec })],
    ['propose_video_clips', () => ({ media_id: media.id, index_id: indexId, picks: [{ review_id: review.review_id, frame_ids: review.frame_ids, title: 'An active gameplay passage', reason: 'The sampled frames show continuous visual activity with space before and after the candidate. This fixture does not establish a specific game event.', confidence: 'low' }] })],
  ];
  const record = (name, value) => {
    assert.ok(!value.error, `${name}: ${value.error}`);responses.push({ name, result: value });
    if (name === 'index_video') indexId = value.index_id;
    if (name === 'find_video_moments') { candidate = value.candidates[0] || value.exploration[0];check(`${provider}: source candidates use the requested late source range`, candidate.start_sec >= 10); }
    if (name === 'review_video_moment') { review = value;check(`${provider}: real source review returns preview and ordered raw frames`, !!review.file && review.frames.length === 6 && review.frames[0].source_time_sec >= 10); }
    if (name === 'propose_video_clips') pick = value.picks[0];
  };
  ai.agentStep = async (_cfg, req) => {
    for (const turn of req.contents.slice(-2)) for (const part of turn.parts || []) if (part.functionResponse) {
      const { name, response } = part.functionResponse, value = response.result;
      if (value && !responses.some(r => r.result === value || r.result.operation_id && r.result.operation_id === value.operation_id)) record(name, value);
    }
    if (latest('review_video_moment') && !latest('propose_video_clips') && !adding) check('API provider receives all actual review images', req.images.length === 6);
    const step = steps[position++];if (step) { const call = { name: step[0], args: step[1]() };return { calls: [call], content: { role: 'model', parts: [{ functionCall: call }] } }; }
    const text = adding ? 'Selected clip added.' : 'Clip suggestions ready.';return { calls: [], text, content: { role: 'model', parts: [{ text }] } };
  };
  local.status = async () => ({ ok: true, authenticated: true, version: 'source-discovery-fixture' });
  local.runEditorNative = async (_cfg, opts) => {
    for (const [name, args] of steps) {
      const output = await opts.onTool(name, args());assert.ok(!output.isError, output.content[0].text);
      record(name, JSON.parse(output.content[0].text));
      if (name === 'review_video_moment') check(`${provider}: native transport presents actual source images`, output.content.filter(b => b.type === 'image').length === 6);
    }
    for (let n = 0; n < 8; n++) { const output = await opts.onTool('complete_edit', {}), value = JSON.parse(output.content[0].text);assert.ok(!value.error, value.error);if (value.ready && await opts.isComplete()) return { text: adding ? 'Selected clip added.' : 'Clip suggestions ready.' }; }
    throw Error('Native source discovery did not settle.');
  };
  settings.setFirstRun({ tourSeen: true, packPromptSeen: true });win.setSize(1440, 1000);win.webContents.setBackgroundThrottling(false);
  win.webContents.on('console-message', (_e, level, text) => { if (level >= 3) result.errors.push(text); });
  try {
    await until('!!window.__fve&&!!document.querySelector(".home-frame-card")');await click('.home-frame-card');await until('!!document.querySelector(".topbar")');await q('document.querySelector(".welcome-go")?.click()');
    if (process.env.SOURCE_DISCOVERY_WHISPER_MODEL && process.platform === 'darwin') {
      const whisperDir = path.join(dir, 'whisper-test');fs.mkdirSync(whisperDir, { recursive: true });
      fs.symlinkSync(process.env.SOURCE_DISCOVERY_WHISPER_MODEL, path.join(whisperDir, 'ggml-base.bin'));
      const speechFile = path.join(dir, 'speech.aiff'), spoken = path.join(dir, 'spoken.mp4');
      execFileSync('/usr/bin/say', ['-r', '145', '-o', speechFile, 'The quiet mountain trail is beautiful. We walk slowly beside the river. The most exciting moment is reaching the waterfall.']);
      execFileSync(ff.ffmpegPath, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=blue:s=160x90:r=10:d=36', '-i', speechFile, '-af', 'adelay=12000:all=1,apad', '-t', '36', '-c:v', 'libx264', '-c:a', 'aac', spoken]);
      const spokenMedia = { ...await ff.probe(spoken), id: 'spoken', path: spoken, name: 'Original speech fixture.mp4' };
      const status = await q(`window.api.agentSourceDiscovery(${JSON.stringify({ action: 'index', requestId: 'real-speech', project: { media: [spokenMedia] }, media_id: 'spoken', options: { chunk_sec: 10, language: 'en' } })})`);
      assert.ok(status.ok, status.error);
      const found = await q(`window.api.agentSourceDiscovery(${JSON.stringify({ action: 'find', requestId: 'real-speech-find', project: { media: [spokenMedia] }, media_id: 'spoken', index_id: status.index_id, options: { query: 'mountain', clip_length_sec: 8 } })})`);
      check('real local Whisper retrieves late source speech after a silent chunk at correct source times', status.complete && found.ok && found.candidates.some(c => /mountain/i.test(c.transcript) && c.start_sec >= 8));
      result.real_speech = { complete: status.complete, retrieved: found.candidates.map(c => ({ start_sec: c.start_sec, end_sec: c.end_sec, transcript: c.transcript })) };
    }
    for (const name of ['ollama', 'codex-sdk', 'claude-agent-sdk']) {
      provider = name;settings.save({ provider });position = 0;responses = [];steps = discoverySteps();adding = false;
      await q(`window.__fve.load(${JSON.stringify(fixture(name))})`);await until('!!document.querySelector(".pilot-fab")');await click('.pilot-fab');await send('Find and review clip candidates from the library recording. Suggest clips without changing my edit.');
      await until('[...document.querySelectorAll(".pilot-msg.assistant .bubble")].some(e=>e.textContent.includes("Clip suggestions ready."))&&!document.querySelector("button[aria-label=Stop]")');
      check(`${provider}: source discovery leaves the existing timeline and Undo untouched`, await q('window.__fve.rawProject().videoClips.length===1&&window.__fve.rawProject().videoClips[0].out===2&&window.__fve.history().past.length===0'));
      check(`${provider}: suggestion card contains title, reason, source times and confidence`, await q('!!document.querySelector(".video-clip-pick .video-pick-reason")&&document.querySelector(".video-pick-source time").textContent.length>5&&document.querySelector(".video-pick-confidence").textContent==="Low confidence"'));
      await until('document.querySelector(".video-clip-pick video")?.readyState>=1');
      check(`${provider}: source preview loads the correct encoded range`, await q(`Math.abs(document.querySelector('.video-clip-pick video').duration-${pick.end_sec - pick.start_sec})<.2`));
      await q('(async()=>{const v=document.querySelector(".video-clip-pick video");v.muted=true;await v.play()})()');await until('document.querySelector(".video-clip-pick video").currentTime>.1');await q('document.querySelector(".video-clip-pick video").pause()');
      check(`${provider}: source preview plays`, true);fs.writeFileSync(path.join(dir, `${provider}-suggestions.png`), (await win.capturePage()).toPNG());
      const forged = await q(`window.api.agentSourceDiscovery(${JSON.stringify({ action: 'propose', requestId: 'foreign', project: { media: [media] }, media_id: media.id, index_id: indexId, picks: [{ review_id: review.review_id, frame_ids: review.frame_ids, title: 'Forged', reason: 'Unseen', confidence: 'high' }] })})`);
      check(`${provider}: another request cannot reuse review proof`, !!forged.error);
      adding = true;position = 0;responses = [];steps = [['load_tools', () => ({ groups: ['discovery'] })], ['add_video_clip', () => ({ media_id: media.id, index_id: indexId, pick_id: pick.pick_id })]];
      await click('.video-pick-add');await until('[...document.querySelectorAll(".pilot-msg.assistant .bubble")].some(e=>e.textContent.includes("Selected clip added."))&&!document.querySelector("button[aria-label=Stop]")');
      const edited = await q('window.__fve.rawProject()');check(`${provider}: Add to timeline appends the chosen exact source range`, edited.videoClips.length === 2 && edited.videoClips[0].id === 'existing' && Math.abs(edited.videoClips[1].in - pick.start_sec) < .001 && Math.abs(edited.videoClips[1].out - pick.end_sec) < .001);
      check(`${provider}: the chosen clip is a single Undo`, await q('window.__fve.history().past.length===1'));await q('window.__fve.dispatch({type:"undo"})');check(`${provider}: Undo preserves the original edit`, await q('window.__fve.rawProject().videoClips.length===1&&window.__fve.rawProject().videoClips[0].out===2'));
      check(`${provider}: no failed tool cards`, !await q('!!document.querySelector(".pilot-error")'));result.providers.push(name);
    }
    // Stop a real long source scan after a completed chunk; resume through IPC.
    settings.save({ provider: 'ollama' });provider = 'cancel';adding = false;position = 0;responses = [];
    const longFile = path.join(dir, 'long.mp4');execFileSync(ff.ffmpegPath, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=320x180:r=24:d=120', '-c:v', 'libx264', '-preset', 'ultrafast', longFile]);
    const longMedia = { ...await ff.probe(longFile), id: 'long', path: longFile, name: 'Long recording.mp4' };
    await q(`window.__fve.load(${JSON.stringify({ ...fixture('cancel'), media: [longMedia], videoClips: [] })})`);await click('.pilot-fab');
    steps = [['load_tools', () => ({ groups: ['discovery'] })], ['index_video', () => ({ media_id: 'long', speech: false, chunk_sec: 10, max_chunks: 32 })]];
    await q('window.__sourceChunk=null;window.__offSource=window.api.onAgentSourceProgress(p=>{if(p.completed_chunks>0)window.__sourceChunk=p});void 0');
    await send('Index this source video.');await until('!!window.__sourceChunk');await click('button[aria-label=Stop]');await until('!document.querySelector("button[aria-label=Stop]")');
    const partial = await q('window.__sourceChunk');await q('window.__offSource();void 0');
    const resumed = await q(`window.api.agentSourceDiscovery(${JSON.stringify({ action: 'index', requestId: 'resume', project: { media: [longMedia] }, media_id: 'long', options: { speech: false, chunk_sec: 10, max_chunks: 32 } })})`);
    check('UI Stop cancels indexing and a new request resumes committed chunks', partial.completed_chunks > 0 && partial.completed_chunks < partial.total_chunks && resumed.ok && resumed.complete && resumed.processed_chunks < resumed.total_chunks);
    check('indexing cancellation never changes the timeline', await q('window.__fve.rawProject().videoClips.length===0&&window.__fve.history().past.length===0'));
    check('no renderer exceptions', !result.errors.length);result.ok = true;
  } catch (error) { result.error = error.stack;result.body = await q('document.body.textContent').catch(() => '');fs.writeFileSync(path.join(dir, 'failure.png'), (await win.capturePage()).toPNG()); }
  finally { ai.agentStep = original.step;local.runEditorNative = original.native;local.status = original.status; }
  fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify(result, null, 2));console.log(JSON.stringify({ ok: result.ok, checks: result.checks, error: result.error, dir }));app.exit(result.ok ? 0 : 1);
};
