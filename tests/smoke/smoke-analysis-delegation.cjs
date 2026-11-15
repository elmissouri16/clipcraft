const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
module.exports = async (win, app, dir) => {
  fs.mkdirSync(dir, { recursive: true });
  const local = require('../../electron/agents/localAgents.cjs'), settings = require('../../electron/system/settings.cjs'), ff = require('../../electron/media/ffmpeg.cjs'), ai = require('../../electron/agents/ai.cjs');
  const original = { run: local.runEditorNative, status: local.status, close: local.closeNativeOwner, models: ai.listModels, setSubagents: settings.setSubagents };
  const q = js => win.webContents.executeJavaScript(js), wait = ms => new Promise(r => setTimeout(r, ms)), result = { ok: false, checks: [], errors: [], providers: [] };
  const until = async js => { for (let n = 0; n < 900; n++) { if (await q(js)) return;await wait(60); }throw Error('Timeout: ' + js); };
  const check = (name, value) => { assert.ok(value, name);result.checks.push(name); };
  const click = selector => q(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const parse = output => { assert.ok(!output.isError, output.content[0].text);return JSON.parse(output.content[0].text); };
  const send = async text => { await q(`(()=>{const el=document.querySelector('.pilot-input textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(el,${JSON.stringify(text)});el.dispatchEvent(new Event('input',{bubbles:true}));})()`);await until('!document.querySelector("button[aria-label=Send]").disabled');await click('button[aria-label=Send]');await until('!!document.querySelector("button[aria-label=Stop]")'); };
  const source = path.join(dir, 'source.mp4');execFileSync(ff.ffmpegPath, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=320x180:r=12:d=48', '-c:v', 'libx264', source]);
  const media = { ...await ff.probe(source), path: source, name: 'Source recording.mp4', id: 'm' };
  const project = id => ({ id, name: 'Analysis subagent verification', ratio: '16:9', width: 320, height: 180, fps: 12, media: [media], videoClips: [{ id: 'existing', mediaId: 'm', in: 0, out: 2 }], overlayClips: [], audioClips: [], textClips: [], effectClips: [] });
  let active = 0, peak = 0, mode = 'normal', provider = '', children = 0, closed = 0;
  local.status = async () => ({ ok: true, authenticated: true, version: 'delegation-fixture' });
  ai.listModels = async () => ({ ok: true, models: ['fixture-model'] });local.closeNativeOwner = () => { closed++; };
  local.runEditorNative = async (cfg, options) => {
    const child = options.system.startsWith('You are a ClipCraft ');
    if (child) {
      children++;active++;peak = Math.max(peak, active);
      try {
        check(`${provider}: child inherits selected provider/model`, cfg.provider === provider && cfg.model === 'fixture-model' && !cfg.subagents && !cfg.webResearch);
        check(`${provider}: child receives only source reads and submission`, options.tools.length === 4 && !options.tools.some(t => ['add_video_clip', 'delegate_video_analysis', 'export_video'].includes(t.name)));
        check(`${provider}: child cannot invoke an editor mutation`, (await options.onTool('add_text', { text: 'Forbidden' })).isError);
        if (mode === 'cancel') await new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(Error('Stopped child')), { once: true }));
        const scope = JSON.parse(options.prompt.split('\n')[0].slice(8));
        const found = parse(await options.onTool('find_video_moments', { media_id: 'm', index_id: scope.index_id, clip_length_sec: 6, limit: 2 }));
        const c = found.candidates[0] || found.exploration[0];
        const view = await options.onTool('review_video_moment', { media_id: 'm', index_id: scope.index_id, start_sec: c.start_sec, end_sec: c.end_sec });
        const review = parse(view);check(`${provider}: child gets actual source images`, view.content.filter(b => b.type === 'image').length === 6);
        parse(await options.onTool('submit_analysis', { summary: 'Reviewed one candidate; the rest of the assigned range is not semantically verified.', findings: [{ review_id: review.review_id, start_sec: review.start_sec, end_sec: review.end_sec, title: 'A source passage', reason: 'Sampled frames show visual changes across the passage. Specific game events remain unverified.', confidence: 'low', frame_ids: review.frame_ids }] }));
        await wait(70);return { text: 'Submitted.' };
      } finally { active--; }
    }
    const available = options.tools.some(t => t.name === 'delegate_video_analysis');
    if (!cfg.subagents) { check(`${provider}: disabled setting removes the delegation tool`, !available);parse(await options.onTool('complete_edit', {}));return { text: 'Delegation off.' }; }
    assert.ok(available, 'enabled native coordinator exposes delegation');
    check(`${provider}: current concurrency travels in request context`, options.context.includes(`Configured concurrent analysis agents: ${cfg.subagentConcurrency}.`) && !options.system.includes('Configured concurrent analysis agents:'));
    const index = parse(await options.onTool('index_video', { media_id: 'm', speech: false, chunk_sec: 10 }));
    const batch = parse(await options.onTool('delegate_video_analysis', { media_id: 'm', index_id: index.index_id, tasks: Array.from({ length: 6 }, (_, i) => ({
      role: 'analyst', start_sec: i * 8, end_sec: (i + 1) * 8, task: 'Find one complete passage in this source section.',
    })) }));
    if (mode === 'cancel') throw Error('Canceled batch should not return success.');
    check(`${provider}: expanded analysis returns six evidence-backed findings`, batch.tasks.length === 6 && batch.tasks.every(t => t.status === 'completed' && t.findings[0].evidence.length === 6));
    const candidates = batch.tasks.flatMap(t => t.findings.map(({ evidence, ...finding }) => finding));
    const reviewed = parse(await options.onTool('delegate_video_analysis', { media_id: 'm', index_id: index.index_id, tasks: [{ role: 'reviewer', start_sec: 0, end_sec: 48, task: 'Compare these candidates and challenge their context: ' + JSON.stringify(candidates) }] }));
    check(`${provider}: a separate reviewer returns findings`, reviewed.tasks[0].role === 'reviewer' && reviewed.tasks[0].status === 'completed');
    const chosen = reviewed.tasks[0].findings[0];
    // The coordinator must obtain its own raw review, not reuse child evidence.
    const view = parse(await options.onTool('review_video_moment', { media_id: 'm', index_id: index.index_id, start_sec: chosen.start_sec, end_sec: chosen.end_sec }));
    const proposed = parse(await options.onTool('propose_video_clips', { media_id: 'm', index_id: index.index_id, picks: [{ review_id: view.review_id, frame_ids: view.frame_ids, title: chosen.title, reason: chosen.reason, confidence: chosen.confidence }] }));
    assert.equal(proposed.picks.length, 1);parse(await options.onTool('complete_edit', {}));return { text: 'Delegated review complete.' };
  };
  settings.setFirstRun({ tourSeen: true, packPromptSeen: true });win.setSize(1440, 1000);win.webContents.setBackgroundThrottling(false);
  win.webContents.on('console-message', (_e, level, text) => { if (level >= 3) result.errors.push(text); });
  const openSettings = async () => { await click('.settings-btn');await until('!!document.querySelector("[data-section=ai]")');await click('[data-section=ai]');await until('!!document.querySelector("input[aria-label=Subagents]")'); };
  const saveToggle = async on => {
    if (await q('document.querySelector("input[aria-label=Subagents]").checked') !== on) await click('input[aria-label=Subagents]');
    await click('.settings2 .btn-primary');await until('!!document.querySelector(".settings2 .result.ok")');
    const publicSettings = await q('window.api.settingsGet()');check(`${provider}: toggle saves the selected provider preference`, publicSettings.subagents[provider] === on);
    await click('button[aria-label="Close settings"]');
  };
  const openComposerControl = async () => { await until('!!document.querySelector(".pilot-subagents-button")&&!document.querySelector(".pilot-subagents-button").disabled');await click('.pilot-subagents-button');await until('!!document.querySelector(".pilot-subagents-menu")'); };
  const composerToggle = async on => {
    if (await q('document.querySelector(".pilot-subagents-menu input").checked') !== on) await click('.pilot-subagents-menu input');
    await until(`document.querySelector('.pilot-subagents-menu input').checked===${on}&&!document.querySelector('.pilot-subagents-menu input').disabled`);
  };
  try {
    await until('!!window.__fve&&!!document.querySelector(".home-frame-card")');await click('.home-frame-card');await until('!!document.querySelector(".topbar")');await q('document.querySelector(".welcome-go")?.click()');
    for (const p of ['codex-sdk', 'claude-agent-sdk', 'opencode-sdk']) {
      provider = p;settings.save({ provider, model: 'fixture-model', subagents: false });
      await q(`window.__fve.load(${JSON.stringify(project('delegation-' + provider))})`);await openSettings();
      check(`${provider}: settings toggle starts off`, !await q('document.querySelector("input[aria-label=Subagents]").checked'));
      await saveToggle(true);await openSettings();check(`${provider}: saved toggle survives reopening settings`, await q('document.querySelector("input[aria-label=Subagents]").checked'));
      fs.writeFileSync(path.join(dir, `${provider}-settings.png`), (await win.capturePage()).toPNG());await click('button[aria-label="Close settings"]');
      await click('.pilot-fab');await openComposerControl();
      if (provider === 'codex-sdk') {
        settings.setSubagents = () => { throw Error('Fixture preference write failed.'); };
        await click('.pilot-subagents-menu input');await until('!!document.querySelector(".pilot-subagents-menu [role=alert]")&&!document.querySelector(".pilot-subagents-menu input").disabled');
        check('failed composer save reports the error and keeps the saved enabled state', settings.getActive().subagents && await q('document.querySelector(".pilot-subagents-menu input").checked'));
        settings.setSubagents = original.setSubagents;
      }
      await composerToggle(false);await click('.pilot-subagents-button');
      const beforeOff = children;await send('Confirm delegation is disabled and make no changes.');await until('!document.querySelector("button[aria-label=Stop]")');
      check(`${provider}: composer can disable delegation for the next message`, children === beforeOff && !settings.getActive().subagents);
      await openComposerControl();await composerToggle(true);
      const concurrency = provider === 'codex-sdk' ? 6 : provider === 'claude-agent-sdk' ? 3 : 1;
      await click('.pilot-subagents-menu button[aria-label="Agents at once"]');
      await q(`[...document.querySelectorAll('.pilot-subagents-menu [role=option]')].find(e=>e.textContent.trim()===${JSON.stringify(String(concurrency))}).click()`);
      await until(`document.querySelector('.pilot-subagents-menu button[aria-label="Agents at once"]').textContent.trim()===${JSON.stringify(String(concurrency))}&&!document.querySelector('.pilot-subagents-menu input').disabled`);
      check(`${provider}: composer persists concurrency without replacing the model`, settings.getActive().subagentConcurrency === concurrency && settings.getActive().model === 'fixture-model');
      fs.writeFileSync(path.join(dir, `${provider}-composer.png`), (await win.capturePage()).toPNG());await click('.pilot-subagents-button');
      await openSettings();check(`${provider}: settings reflects the composer preference`, await q(`document.querySelector('.settings2 button[aria-label="Agents at once"]').textContent.trim()===${JSON.stringify(String(concurrency))}&&document.querySelector('.settings2 input[aria-label=Subagents]').checked`));await click('button[aria-label="Close settings"]');
      peak = 0;await send('Use analysis agents and a reviewer to find clips, then personally inspect the finalist and show a preview. Keep the timeline unchanged.');
      await until('[...document.querySelectorAll(".pilot-msg.assistant .bubble")].some(e=>e.textContent.includes("Delegated review complete."))&&!document.querySelector("button[aria-label=Stop]")');
      check(`${provider}: selected concurrency is enforced in the real app`, peak === concurrency);
      check(`${provider}: analyses and reviewer appear in activity`, await q('[...document.querySelectorAll("[data-tool-icon=subagent_analysis]")].length===7'));
      check(`${provider}: final reviewed suggestion appears`, await q('!!document.querySelector(".video-clip-pick")'));
      check(`${provider}: analysis and proposal leave the edit and Undo unchanged`, await q('window.__fve.rawProject().videoClips.length===1&&window.__fve.rawProject().videoClips[0].out===2&&window.__fve.history().past.length===0'));
      await until('document.querySelector(".video-clip-pick video")?.readyState>=1');fs.writeFileSync(path.join(dir, `${provider}-analysis.png`), (await win.capturePage()).toPNG());
      await openSettings();await saveToggle(false);const beforeChildren = children;await send('Confirm delegation is disabled and make no changes.');
      await until('[...document.querySelectorAll(".pilot-msg.assistant .bubble")].some(e=>e.textContent.includes("Delegation off."))&&!document.querySelector("button[aria-label=Stop]")');
      check(`${provider}: off prevents child sessions on the next request`, children === beforeChildren);result.providers.push(provider);
    }
    provider = 'codex-sdk';settings.save({ provider, model: 'fixture-model', subagents: true, subagentConcurrency: 2 });mode = 'cancel';
    await q(`window.__fve.load(${JSON.stringify(project('delegation-cancel'))})`);await click('.pilot-fab');await send('Analyze two source sections in parallel.');
    for (let n = 0; n < 200 && active < 2; n++) await wait(30);check('Stop test reaches both child sessions', active === 2);
    check('composer delegation controls stay disabled during a running request', await q('document.querySelector(".pilot-subagents-button").disabled'));
    await click('button[aria-label=Stop]');await until('!document.querySelector("button[aria-label=Stop]")');
    for (let n = 0; n < 100 && active; n++) await wait(20);check('Stop cancels all active child sessions', active === 0);
    check('Stop preserves the original edit and Undo history', await q('window.__fve.rawProject().videoClips.length===1&&window.__fve.history().past.length===0'));
    check('child native sessions are disposed', closed >= children);check('no renderer exceptions', !result.errors.length);result.ok = true;
  } catch (error) { result.error = error.stack;result.body = await q('document.body.textContent').catch(() => '');fs.writeFileSync(path.join(dir, 'failure.png'), (await win.capturePage()).toPNG()); }
  finally { local.runEditorNative = original.run;local.status = original.status;local.closeNativeOwner = original.close;ai.listModels = original.models;settings.setSubagents = original.setSubagents; }
  fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify(result, null, 2));console.log(JSON.stringify({ ok: result.ok, error: result.error, checks: result.checks, dir }));app.exit(result.ok ? 0 : 1);
};
