// Reference videos in the real app: attach a video to CraftAI through the composer's
// attach button (the native file dialog is stubbed), see its chip, then run the
// analyze_reference tool through the real tool runner and IPC: the edit fingerprint
// and the contact sheets. Speech pacing is checked when the local speech model and
// the macOS `say` voice are available.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { makeReference } = require('../fixtures/editReference.cjs');

module.exports = async (win, app, dir) => {
  const q = (s) => win.webContents.executeJavaScript(s), wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (s, ms = 20000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await q(s)) return; await wait(50); } throw Error('Timeout: ' + s); };
  const result = { checks: [], errors: [] };
  const check = (name, ok) => { assert.ok(ok, name); result.checks.push(name); };
  win.webContents.on('console-message', (_e, level, message) => { if (level >= 3) result.errors.push(message); });
  try {
    // Speech for the reference when the system can speak; the local speech model when installed.
    let speech = null;
    const installed = path.join(os.homedir(), 'Library/Application Support/ClipCraft/whisper');
    if (process.platform === 'darwin' && fs.existsSync('/usr/bin/say') && fs.existsSync(installed)) {
      const aiff = path.join(dir, 'speech.aiff');
      try {
        execFileSync('/usr/bin/say', ['-o', aiff, 'Welcome back to the channel. Today we cut a fast vlog. Every pause goes, every shot earns its place, and the music drives the pace.']);
        speech = aiff;
        const test = path.join(dir, 'whisper-test');
        if (!fs.existsSync(test)) fs.symlinkSync(installed, test, 'dir');
      } catch { speech = null; }
    }
    result.speech = !!speech;
    const ref = makeReference(dir, { speech });

    // The attach button opens one dialog for images and videos: answer it with the reference.
    const { dialog } = require('electron');
    const original = dialog.showOpenDialog;
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [ref.file] });

    win.setContentSize(1440, 900); win.show();
    await until('!!window.__fve&&!!document.querySelector(".home-frame-card")', 30000);
    await q('document.querySelector(".home-frame-card").click()'); await until('!!document.querySelector(".topbar")');
    await q('document.querySelector(".welcome-go")?.click()');
    await q('document.querySelector(".workspace-switch button:last-child").click()'); await until('!!document.querySelector(".pilot-input")');
    await q('document.querySelector("button[aria-label=\'Attach images or reference videos\']").click()');
    await until('!!document.querySelector(".pilot-video img")');
    dialog.showOpenDialog = original;
    const chip = await q('(()=>{const c=document.querySelector(".pilot-video");return {name:c.querySelector(".pilot-image-name").textContent,duration:c.querySelector(".pilot-video-duration").textContent,title:c.title}})()');
    result.chip = chip;
    check('the attached video shows as a reference chip with its poster and length', chip.name === 'reference.mp4' && chip.duration.includes('0:17') && /Reference video/.test(chip.title));
    fs.writeFileSync(path.join(dir, 'reference-chip.png'), (await win.capturePage()).toPNG());
    const session = await q('(()=>{const p=window.__fve.rawProject();const s=p.craftAI.sessions.find(x=>x.id===p.craftAI.activeSessionId);return {videos:s.videos,images:s.images}})()');
    check('the session stores the reference by ID and metadata, without its path', session.videos.length === 1 && /^[a-f0-9]{64}$/.test(session.videos[0].id) && !JSON.stringify(session.videos).includes(dir));
    const id = session.videos[0].id;
    const part = await q(`import('/src/features/agent/videoAttachments.js').then(m=>m.videoMessagePart(${JSON.stringify(session.videos)}))`);
    check('the message tells the model the reference ID and how to use it', part.includes(`reference_id=${id}`) && part.includes('analyze_reference'));

    // The tool, through the real runner and main process.
    const t0 = Date.now();
    const out = await q(`(async()=>{
      const { createToolRunner } = await import('/src/features/agent/tools.js');
      const runner = createToolRunner({ getProject: () => window.__fve.rawProject(), dispatch: window.__fve.dispatch, settle: async () => {}, api: window.api, requestId: 'reference-smoke' });
      const r = await runner.run('analyze_reference', { reference_id: ${JSON.stringify(id)} });
      return JSON.parse(JSON.stringify(r));
    })()`);
    result.ms = Date.now() - t0;
    result.analysis = { error: out.error, contact_sheet_error: out.contact_sheet_error, transitions: out.transitions, transition_times: out.transition_times, pacing: out.pacing, speech: out.speech, sheet_ids: out.sheet_ids, frames: out.frames?.length, limitations: out.limitations };
    check('the reference is analysed: every known transition with its kind', !out.error && JSON.stringify(out.transition_times.map(([, kind]) => kind)) === JSON.stringify(ref.truth.map((t) => t.kind)));
    check('the model gets numbered contact sheets of the sample shots', out.frames.length >= 6 && out.sheet_ids.length === 2 && out.sheet_cells.length === out.frames.length);
    check('the result carries no file path for the model', !JSON.stringify(out).includes(ref.file));
    result.transcript = out.transcript; result.sound = out.audio?.sound;
    if (speech) {
      check('speech pace is measured with the local speech model', out.speech?.words_per_min > 60 && out.speech.words > 10);
      const text = (out.transcript?.segments || []).map((seg) => seg[2]).join(' ').toLowerCase();
      check('clear speech comes with a timed transcript', out.transcript?.reliability === 'clear' && /channel/.test(text) && /vlog/.test(text)
        && out.transcript.segments.every(([a, b]) => a >= 0 && b > a && b <= 17.5));
      check('the voice is measured against its pauses, or the lack of pauses is stated', Number.isFinite(out.audio?.sound?.voice_balance?.difference_db) || /no pauses/.test(out.audio?.sound?.voice_balance?.note || ''));
    }
    else check('without a speech model the fingerprint says speech was not measured', out.speech === null && out.transcript === null && out.limitations.some((l) => /Speech/.test(l)));

    // Library videos work too, and the second analysis is cached.
    const again = await q(`(async()=>{const r=await window.api.agentAnalyzeReference({reference_id:${JSON.stringify(id)},speech:${!!speech},requestId:'reference-smoke-2'});return {ok:r.ok,cached:r.cached}})()`);
    check('a second analysis of the same video is served from the cache', again.ok && again.cached === true);
    const bad = await q(`window.api.agentAnalyzeReference({reference_id:'${'0'.repeat(64)}',requestId:'reference-smoke-3'})`);
    check('an unknown reference is refused', bad.ok === false && /no longer known/.test(bad.error));

    // Removing the chip removes the reference from the composer.
    await q('document.querySelector("button[aria-label^=\'Remove reference video\']").click()'); await wait(200);
    check('removing the chip clears the reference', await q('!document.querySelector(".pilot-video")'));
    check('no renderer exceptions', !result.errors.length);
  } catch (error) { result.error = error.stack; try { fs.writeFileSync(path.join(dir, 'failure.png'), (await win.capturePage()).toPNG()); } catch {} }
  fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify(result, null, 2)); app.exit(result.error ? 1 : 0);
};
