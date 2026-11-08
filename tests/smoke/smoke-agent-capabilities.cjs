// Both agent transports execute the new controls in the real editor. Media jobs
// and frame verification are real; only model reasoning is deterministic.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
module.exports = async (win, app, dir) => {
  const ai = require('../../electron/agents/ai.cjs'), local = require('../../electron/agents/localAgents.cjs');
  const settings = require('../../electron/system/settings.cjs'), mediaJobs = require('../../electron/agents/editorMedia.cjs');
  const reviewService = require('../../electron/agents/renderReview.cjs');
  const original = { step: ai.agentStep, run: local.runEditorNative, status: local.status, mediaJob: mediaJobs.runEditorMediaJob, review: reviewService.inspectRenderedVideo };
  const ffmpeg = require('../../electron/media/ffmpeg.cjs'), { execFileSync } = require('node:child_process');
  const result = { checks: [], providers: [], errors: [] }, q = js => win.webContents.executeJavaScript(js);
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const until = async js => { for (let n = 0; n < 300; n++) { if (await q(js)) return;await wait(100); }throw Error('Timeout: ' + js); };
  const check = (name, value) => { assert.ok(value, name);result.checks.push(name); };
  const click = selector => q(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const send = async text => {
    await q(`(()=>{const el=document.querySelector('.pilot-input textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(el,${JSON.stringify(text)});el.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await until('!document.querySelector("button[aria-label=Send]").disabled');await click('button[aria-label=Send]');
  };
  const source = path.join(dir, 'source.mp4');
  execFileSync(ffmpeg.ffmpegPath, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=160x96:r=12:d=4', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=4', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', source]);
  const sourceInfo = await ffmpeg.probe(source);
  const extra = path.join(dir, 'additional.png'), subtitleInput = path.join(dir, 'input.srt');
  execFileSync(ffmpeg.ffmpegPath, ['-v', 'error', '-y', '-i', source, '-frames:v', '1', extra]);
  const subtitleText = '1\n00:00:03,000 --> 00:00:03,750\nImported subtitle\n';
  fs.writeFileSync(subtitleInput, subtitleText);
  const fixture = id => ({ id, name: 'Agent capability verification', ratio: '16:9', width: 320, height: 180, fps: 12,
    media: [{ ...sourceInfo, id: 'source', path: source, name: 'Test source' }],
    videoClips: [{ id: 'v', mediaId: 'source', in: 0, out: 4 }],
    overlayClips: [{ id: 'o', mediaId: 'source', start: 0, in: 0, out: 4, muted: true }],
    audioClips: [], textClips: [{ id: 't', text: 'Timed title', start: .5, duration: 2, layer: 0 },
      { id: 'c1', caption: true, text: 'Hello there', start: 0, duration: 1, layer: 1, words: [{ text: 'Hello', start: 0, end: .4 }, { text: 'there', start: .5, end: 1 }] },
      { id: 'c2', caption: true, text: 'Next cue', start: 1.2, duration: 1, layer: 1 }], effectClips: [],
  });
  let plan = [], responses = [], position = 0, currentProvider = '';
  const previewed = new Set();
  const verifyPreview = async () => {
    if (previewed.has(currentProvider)) return;
    await until('document.querySelector("video.review-video")?.readyState>=1');
    check(`${currentProvider}: section preview loads the actual video`, await q('document.querySelector("video.review-video").videoWidth===320&&Math.abs(document.querySelector("video.review-video").duration-2)<.1'));
    const playback = await q('(async()=>{const video=document.querySelector("video.review-video");video.muted=true;try{await video.play();return {ok:true};}catch(error){return {error:error.message,name:error.name};}})()');
    assert.ok(playback.ok, JSON.stringify(playback));
    await until('document.querySelector("video.review-video").currentTime>.1');
    await q('document.querySelector("video.review-video").pause()');
    fs.writeFileSync(path.join(dir, `${currentProvider}-review-preview.png`), (await win.capturePage()).toPNG());
    previewed.add(currentProvider);
  };
  const record = (name, value) => {
    assert.ok(!value.error, `${name}: ${value.error}`);responses.push({ name, result: value });
  };
  const latest = name => responses.filter(r => r.name === name).at(-1)?.result;
  const steps = () => [
    ['load_tools', () => ({ groups: ['timeline', 'layers', 'files', 'captions', 'audio', 'motion', 'media', 'export'] })],
    ['get_project', () => ({ details: true })],
    ['layer_tools', () => ({ track: 'overlay', action: 'add', name: 'B-roll' })],
    ['clip_tools', () => ({ clip_id: 'o', action: 'set_layer', layer: 1 })],
    ['split_at', () => ({ clip_id: 'o', time_sec: 2 })],
    ['set_speed', () => ({ clip_id: latest('split_at').clip_ids[1], speed: 2 })],
    ['clip_tools', () => ({ clip_id: 'v', action: 'freeze', time_sec: 1, duration_sec: 1 })],
    ['clip_tools', () => ({ clip_id: 'o', action: 'link', partner_clip_id: latest('clip_tools').preserved_audio_clip_id })],
    ['clip_tools', () => ({ clip_id: 'o', action: 'unlink' })],
    ['clip_tools', () => ({ clip_id: 'o', action: 'reverse' })],
    ['inspect_frames', () => ({ source: 'clip', clip_id: 'o', times_sec: [0] })],
    ['track_subject', () => ({ clip_id: 'o', frame_id: latest('inspect_frames').frames[0].id, pick: { x: .5, y: .5 }, allow_low_confidence: true })],
    ['pin_to_subject', () => ({ clip_id: 'c1', target_clip_id: 'o' })],
    ['set_audio_effects', () => ({ clip_id: 'o', preset: 'clear-voice', limit: true })],
    ['set_volume_envelope', () => ({ clip_id: 'o', points: [{ time_sec: 0, value: 1 }, { time_sec: 1, value: .5 }, { time_sec: 2, value: 1 }] })],
    ['duck_audio', () => ({ target_clip_ids: [latest('clip_tools').preserved_audio_clip_id || responses.find(r => r.result.preserved_audio_clip_id).result.preserved_audio_clip_id], speech_clip_ids: ['v'], duck_volume: .2 })],
    ['list_local_media', () => ({ paths: [dir], limit: 64 })],
    ['import_media', () => ({ paths: [extra], as: 'library' })],
    ['edit_caption_words', () => ({ clip_id: 'c1', words: [{ text: 'Hello', start_sec: .1, end_sec: .4 }, { text: 'there', start_sec: .6, end_sec: .9 }] })],
    ['caption_tools', () => ({ action: 'split', clip_id: 'c1', time_sec: .5 })],
    ['caption_tools', () => ({ action: 'merge', clip_ids: latest('caption_tools').clip_ids })],
    ['caption_tools', () => ({ action: 'import_srt', file_path: subtitleInput })],
    ['export_subtitles', () => ({ source: 'srt', file_path: path.join(dir, `${currentProvider}-subtitles.srt`) })],
    ['review_section', () => ({ start_sec: .5, end_sec: 2.5, sample_times_sec: [.5, 1, 1.5, 2] })],
    ['export_video', () => ({ file_path: path.join(dir, `${currentProvider}-video.mp4`), quality: 'low', encoder_preset: 'ultrafast', fps: 24 })],
  ];
  ai.agentStep = async (_cfg, req) => {
    // Record the prior real renderer response before choosing the next tool.
    for (const turn of req.contents.slice(-2)) for (const part of turn.parts || []) if (part.functionResponse) {
      const response = part.functionResponse;
      const value = response.response?.result;
      if (value && !responses.some(r => r.result.operation_id && r.result.operation_id === value.operation_id)) {
        if (!(response.name === 'load_tools' && responses.some(r => r.name === 'load_tools'))) record(response.name, value);
      }
    }
    if (latest('review_section') && !previewed.has(currentProvider)) {
      check('API review receives actual encoded image handles', req.images.filter(image => image.label.startsWith('Encoded section image')).length === 4);
      await verifyPreview();
    }
    const step = plan[position++];
    if (step) return { ok: true, provider: 'ollama', calls: [{ name: step[0], args: step[1]() }], content: { role: 'model', parts: [{ functionCall: { name: step[0], args: step[1]() } }] } };
    return { ok: true, provider: 'ollama', calls: [], text: 'Capabilities completed.', content: { role: 'model', parts: [{ text: 'Capabilities completed.' }] } };
  };
  local.status = async () => ({ ok: true, authenticated: true, version: 'capability-fixture' });
  local.runEditorNative = async (_cfg, options) => {
    check('native transport registers layer controls', options.tools.some(tool => tool.name === 'layer_tools'));
    for (const [name, args] of plan) {
      const output = await options.onTool(name, args());
      assert.ok(!output.isError, JSON.stringify(output.content).slice(0, 1000));
      if (name === 'review_section') { check('native review attaches actual encoded images', output.content.filter(block => block.type === 'image').length === 4);await verifyPreview(); }
      if (name === 'export_video') check('native export returns sampled images of the delivered file', output.content.filter(block => block.type === 'image').length === 6);
      record(name, JSON.parse(output.content[0].text));
    }
    let ready = false;
    for (let n = 0; n < 12 && !ready; n++) {
      const output = await options.onTool('complete_edit', {}), value = JSON.parse(output.content[0].text);
      assert.ok(!value.error, value.error);ready = value.ready;
      // Not ready means: review returned images, or an editorial review listing issues this edit introduced.
      if (!ready) assert.ok(value.editorial_review_required ? value.editorial_issues.length > 0 : output.content.some(block => block.type === 'image'), 'changed regions return real preview images');
      if (value.editorial_review_required) result.editorial_review = value.editorial_issues.map(issue => issue.code);
    }
    assert.ok(ready && await options.isComplete(), 'completion validates the actual edited project');
    return { text: 'Capabilities completed.' };
  };
  settings.setFirstRun({ tourSeen: true, packPromptSeen: true });win.webContents.setBackgroundThrottling(false);win.setSize(1440, 1000);
  win.webContents.on('console-message', (_e, level, message) => { if (level >= 3) result.errors.push(message); });
  try {
    await until('!!window.__fve&&!!document.querySelector(".home-frame-card")');await click('.home-frame-card');await until('!!document.querySelector(".topbar")');await q('document.querySelector(".welcome-go")?.click()');
    for (const provider of ['ollama', 'codex-sdk', 'claude-agent-sdk']) {
      currentProvider = provider;settings.save({ provider });plan = steps();responses = [];position = 0;
      await q(`window.__fve.load(${JSON.stringify(fixture('capabilities-' + provider))})`);await until('!!document.querySelector(".pilot-fab")');await click('.pilot-fab');
      await send(`Execute the editing checks. Import ${extra} and subtitles from ${subtitleInput}; export the imported subtitles and the completed video to the supplied test destinations. Inspect the result and finish.`);
      await until('!document.querySelector("button[aria-label=Stop]")&&[...document.querySelectorAll(".pilot-msg.assistant .bubble")].some(e=>e.textContent.includes("Capabilities completed."))');
      const p = await q('window.__fve.rawProject()');
      fs.writeFileSync(path.join(dir, `${provider}-edited-project.json`), JSON.stringify(p));
      check(`${provider}: no failed tool results`, !await q('document.querySelector(".pilot-error")'));
      check(`${provider}: layers, split and speed edits reached the actual project`, p.layerNames.overlay[1] === 'B-roll' && p.overlayClips.length === 2 && p.overlayClips.some(c => c.speed === 2));
      check(`${provider}: frame hold preserves the timeline and source audio`, p.videoClips.length === 3 && p.videoClips[1].out === 1 && p.audioClips.length === 1 && p.textClips[0].start === .5);
      check(`${provider}: real reverse output is imported and placed`, !!p.overlayClips.find(c => c.id === 'o').reversed && fs.existsSync(p.media.find(m => m.id === p.overlayClips.find(c => c.id === 'o').mediaId).path));
      check(`${provider}: audio finishing and automation reach the real project`, p.overlayClips.find(c => c.id === 'o').audioFx.limit && p.overlayClips.find(c => c.id === 'o').volumeKeys.length === 3 && p.audioClips[0].volumeKeys.length > 0);
      check(`${provider}: inspected-frame tracking, reframe and subject pin reach the editor`, p.overlayClips.find(c => c.id === 'o').track.points.length > 0 && p.overlayClips.find(c => c.id === 'o').keyframes.x.length > 0 && p.textClips.find(c => c.id === 'c1').pin.to === 'o');
      check(`${provider}: local file import uses real probing and reaches the library`, p.media.some(m => fs.realpathSync(m.path) === fs.realpathSync(extra) && m.type === 'image'));
      check(`${provider}: caption repairs preserve edited word timing and cue duration`, p.textClips.find(c => c.id === 'c1').word_timing === 'edited' && p.textClips.find(c => c.id === 'c1').words[1].start === .6 && p.textClips.find(c => c.id === 'c1').duration === 1);
      check(`${provider}: subtitle files import/export with exact cue timing`, fs.readFileSync(path.join(dir, `${provider}-subtitles.srt`), 'utf8') === subtitleText);
      const reviewed = latest('review_section');
      result.lastReview = reviewed;
      check(`${provider}: local section review decodes sound and video and returns encoded frames`, reviewed.ok && reviewed.frames.length === 4 && reviewed.video.decoded_frames === 24 && reviewed.audio.decoded_seconds > 1.9 && reviewed.semantic_audio_review === false && reviewed.frames.every(frame => frame.source === 'rendered' && frame.time_sec >= .5));
      const exported = latest('export_video');
      check(`${provider}: video export waits for a real encoded file and actual metadata`, exported.ok && fs.existsSync(exported.file) && exported.size > 0 && exported.metadata.width === 320 && exported.metadata.height === 180 && exported.metadata.fps === 24 && Math.abs(exported.metadata.duration_sec - 4) < .1);
      check(`${provider}: final delivered file is locally decoded and inspected`, exported.frames.length === 6 && exported.output_review.video.decoded_frames === 96 && exported.output_review.partial === false && exported.output_review.semantic_audio_review === false);
      check(`${provider}: agent exports stay in chat without a screen-covering dialog`,await q('!document.querySelector(".modal-backdrop[aria-labelledby=export-title]")&&!!document.querySelector(".pilot-output-actions")'));
      check(`${provider}: one Undo restores the original timeline`, await q('window.__fve.history().past.length===1'));
      result.providers.push({ provider, operations: responses.map(r => r.name), media: p.media.length });
      await q('window.__fve.dispatch({type:"undo"})');
      check(`${provider}: Undo restores clip count, speed, audio and captions`, await q('window.__fve.rawProject().videoClips.length===1&&window.__fve.rawProject().overlayClips.length===1&&!window.__fve.rawProject().audioClips.length&&window.__fve.rawProject().textClips.length===3'));
    }
    const forged = await q('window.api.agentMediaJob({requestId:"forged-frame-check",action:"track",frame_ids:["not-an-inspected-frame"]})');
    check('tracking rejects invented frame evidence before processing', /Inspect and present/.test(forged.error));
    // Stop an actual encode through its inline chat card.
    settings.save({ provider: 'ollama' });currentProvider = 'cancel-export';responses = [];position = 0;
    const cancelFile = path.join(dir, 'canceled-video.mp4');
    plan = [['load_tools', () => ({ groups: ['export'] })], ['export_video', () => ({ file_path: cancelFile, quality: 'medium', encoder_preset: 'slow' })]];
    const long = { ...fixture('cancel-export'), width: 1280, height: 720, fps: 60, media: [{ id: 'still', path: extra, type: 'image', width: 160, height: 96 }], videoClips: [{ id: 'still', mediaId: 'still', in: 0, out: 120 }], textClips: [], overlayClips: [], audioClips: [] };
    await q(`window.__fve.load(${JSON.stringify(long)})`);await click('.pilot-fab');
    await q('window.__encodeStarted=false;window.__offEncode=window.api.onExportProgress(()=>window.__encodeStarted=true);void 0');
    await send('Export this long video to the supplied test path.');await until('window.__encodeStarted');
    await click('.pilot-export-cancel');
    await until('!document.querySelector("button[aria-label=Stop]")');await q('window.__offEncode();void 0');
    check('Cancel export aborts encoding without publishing a partial video', !fs.existsSync(cancelFile));
    // The render is real; hold only the diagnostic decoder to exercise Stop.
    let reviewWaiting = false, reviewAborted = false;
    reviewService.inspectRenderedVideo = async (_file, { signal }) => { reviewWaiting = true;return new Promise((_resolve, reject) => signal.addEventListener('abort', () => { reviewAborted = true;reject(Error('Stopped review fixture')); }, { once: true })); };
    plan = [['load_tools', () => ({ groups: ['export'] })], ['review_section', () => ({ start_sec: 0, end_sec: 2 })]];responses = [];position = 0;
    await q(`window.__fve.load(${JSON.stringify(fixture('cancel-review'))})`);await click('.pilot-fab');await send('Check this section locally.');
    for (let n = 0; n < 200 && !reviewWaiting; n++) await wait(50);
    check('local diagnostics reach the request-owned decoder', reviewWaiting);
    check('local review stays in chat',await q('!document.querySelector(".modal-backdrop[aria-labelledby=export-title]")'));
    await click('button[aria-label=Stop]');
    await until('!document.querySelector("button[aria-label=Stop]")');
    check('Stop cancels local review and preserves the edit', reviewAborted && await q('window.__fve.rawProject().videoClips.length===1&&window.__fve.history().past.length===0'));
    reviewService.inspectRenderedVideo = original.review;
    // Heavy work is canceled through the same request owner as the native/API loop.
    let waiting = false, aborted = false;
    mediaJobs.runEditorMediaJob = async (_req, { signal }) => { waiting = true;return new Promise((_resolve, reject) => signal.addEventListener('abort', () => { aborted = true;reject(Error('Stopped fixture')); }, { once: true })); };
    settings.save({ provider: 'ollama' });plan = [['load_tools', () => ({ groups: ['timeline'] })], ['clip_tools', () => ({ clip_id: 'o', action: 'reverse' })]];responses = [];position = 0;
    await q(`window.__fve.load(${JSON.stringify(fixture('cancel-capability'))})`);await click('.pilot-fab');await send('Reverse the overlay.');
    for (let n = 0; n < 100 && !waiting; n++) await wait(50);
    check('media processing reaches its request-owned job', waiting);await click('button[aria-label=Stop]');
    await until('!document.querySelector("button[aria-label=Stop]")');
    check('Stop aborts the media job and leaves the project intact', aborted && await q('window.__fve.rawProject().media.length===1&&!window.__fve.rawProject().overlayClips[0].reversed'));
    await q('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');fs.writeFileSync(path.join(dir, 'capabilities.png'), (await win.capturePage()).toPNG());
    check('renderer has no runtime errors', result.errors.length === 0);
  } catch (error) { result.error = error.stack;fs.writeFileSync(path.join(dir, 'failure.png'), (await win.capturePage()).toPNG());result.dom = await q('document.body.innerText.slice(-2500)'); }
  finally { ai.agentStep = original.step;local.runEditorNative = original.run;local.status = original.status;mediaJobs.runEditorMediaJob = original.mediaJob;reviewService.inspectRenderedVideo = original.review; }
  fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify(result, null, 2));console.log(JSON.stringify({ checks: result.checks, error: result.error, evidence: dir }));app.exit(result.error ? 1 : 0);
};
