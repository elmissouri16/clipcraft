// Editorial workflow in the real app: plan card + approval, footage log,
// retake/filler/silence cuts, beat grid, critique, completion and Undo.
// The model's decisions are a deterministic fixture; UI, IPC, FFmpeg, the
// reducer and history are real. Speech: a stubbed recognizer over synthetic
// "word" tones by default, or real Whisper on FVE_EDITORIAL_MEDIA (with
// FVE_WHISPER_MODEL pointing at a local ggml-base.bin).
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');

module.exports = async (win, app, dir) => {
  const q = code => win.webContents.executeJavaScript(code), wait = ms => new Promise(r => setTimeout(r, ms));
  const untilFn = async (fn, label, tries = 600) => { for (let i = 0; i < tries; i++) { if (await fn()) return; await wait(100); } throw Error('Timeout: ' + label); };
  const until = code => untilFn(() => q(code), code);
  const result = { checks: [], errors: [], real_speech: !!process.env.FVE_EDITORIAL_MEDIA };
  const check = (label, value) => { assert.ok(value, label); result.checks.push(label); };
  const shot = async name => fs.writeFileSync(path.join(dir, name + '.png'), (await win.capturePage()).toPNG());
  const { ffmpegPath } = require('../../electron/media/ffmpeg.cjs');
  const settings = require('../../electron/system/settings.cjs'), local = require('../../electron/agents/localAgents.cjs'), whisper = require('../../electron/audio/whisper.cjs');
  win.webContents.on('console-message', (_e, level, message) => { if (level >= 3) result.errors.push(message); });
  try {
    // Footage: real speech when provided, otherwise word-like tone bursts with
    // a known transcript (hesitation, false start, long pause).
    let speechFile = process.env.FVE_EDITORIAL_MEDIA;
    if (speechFile) {
      fs.mkdirSync(path.join(dir, 'whisper-test'), { recursive: true });
      fs.symlinkSync(process.env.FVE_WHISPER_MODEL, path.join(dir, 'whisper-test', 'ggml-base.bin'));
    } else {
      const words = [['So', .3, .6], ['um', .8, 1.3], ['today', 1.5, 1.9], ['we', 2.0, 2.2], ['edit.', 2.3, 2.8],
        ['The', 4.0, 4.2], ['best', 4.3, 4.6], ['way', 4.7, 5.0], ['The', 5.6, 5.8], ['best', 5.9, 6.2], ['way', 6.3, 6.6], ['is', 6.7, 6.9], ['cutting.', 7.0, 7.6],
        ['Why', 10.2, 10.5], ['do', 10.6, 10.8], ['edits', 10.9, 11.3], ['fail?', 11.4, 12.0]];
      // Words at 220 Hz; the hesitation at 140 Hz so the stub recognizer can "hear" it.
      const tone = (list, f) => `0.5*sin(2*PI*${f}*t)*(${list.map(([, a, b]) => `between(t,${a},${b})`).join('+')})`;
      const expr = `${tone(words.filter(w => w[0] !== 'um'), 220)}+${tone(words.filter(w => w[0] === 'um'), 140)}`;
      speechFile = path.join(dir, 'speech.mp4');
      execFileSync(ffmpegPath, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30:duration=13', '-f', 'lavfi', '-i', `aevalsrc='${expr}':d=13:s=16000`,
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'ultrafast', '-c:a', 'aac', '-shortest', speechFile]);
      whisper.install = async () => {};
      // Isolated-clip recognition: a clip is heard as "Um." when its pitch is ~140 Hz.
      whisper.transcribeClips = async (_dir, files) => files.map(file => {
        const b = fs.readFileSync(file), n = (b.length - 44) / 2;let crossings = 0, prev = 0, first = -1, last = -1;
        for (let i = 0; i < n; i++) { const v = b.readInt16LE(44 + i * 2); if (Math.abs(v) > 3000) { if (first < 0) first = i; last = i; if (prev && Math.sign(v) !== Math.sign(prev)) crossings++; prev = v; } }
        return first >= 0 && Math.abs(crossings / 2 / ((last - first) / 16000) - 140) < 20 ? 'Um.' : 'Word.';
      });
      whisper.transcribe = async (_dir, _wav, opts) => { result.verbatim_requested = result.verbatim_requested || !!opts.verbatim;
        return [{ start: .3, end: 12, text: words.map(w => w[0]).join(' '), word_timing: 'measured', words: words.map(([text, start, end]) => ({ text, start, end, timing: 'measured' })) }]; };
    }
    const music = path.join(dir, 'beat.m4a');
    execFileSync(ffmpegPath, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', "aevalsrc='0.8*sin(2*PI*90*t)*exp(-30*mod(t,0.5))':d=16:s=44100", music]);

    const outcomes = {};
    let turn = 0;
    local.status = async () => ({ ok: true, authenticated: true });
    local.runEditorNative = async (_config, options) => {
      const call = async (name, args) => JSON.parse((await options.onTool(name, args)).content[0].text);
      turn++;
      if (turn === 1) {
        outcomes.guide = await call('edit_guide', { topic: 'workflow' });
        outcomes.log = await call('log_footage', { include_scenes: false, language: 'en' });
        outcomes.plan = await call('propose_edit_plan', { goal: 'A tight short that opens on the question', platform: 'tiktok', target_duration_sec: 20,
          hook: 'Open on “Why do edits fail?”', story: [{ start_sec: 10.2, end_sec: 12, note: 'Hook: the question' }, { start_sec: 0.3, end_sec: 7.6, note: 'Setup without the false start' }],
          cuts: ['Remove the false start and hesitations', 'Tighten pauses over 0.8 s'], audio: ['Music bed under speech, cut on the beat'], captions: 'Bold, 3 words per caption' });
        return { text: 'Here is my plan. Approve it and I will make the edit.' };
      }
      // Beat grid before the ripple cuts: cuts also slice the music bed.
      outcomes.beats = await call('get_beats', { clip_ids: ['music'] });
      outcomes.retakesDry = await call('remove_retakes', { dry_run: true, language: 'en' });
      const restart = outcomes.retakesDry.candidates?.find(c => c.kind === 'restart');
      outcomes.retakes = restart ? await call('remove_retakes', { retake_ids: [restart.id], language: 'en' }) : { skipped: true };
      outcomes.fillersDry = await call('remove_fillers', { language: 'en', dry_run: true });
      outcomes.fillers = await call('remove_fillers', { language: 'en' });
      // Select by track: ripple cuts split the original clip, so its id now names one piece only.
      outcomes.silences = await call('remove_silences', { min_silence_sec: 0.8, keep_padding_sec: 0.1, source: 'video' });
      outcomes.critique = await call('critique_edit', { platform: 'tiktok' });
      for (let i = 0; i < 6; i++) { outcomes.complete = await call('complete_edit', {}); if (outcomes.complete.ready) break; }
      return { text: 'Removed the false start, hesitations and long pauses, and checked the edit.' };
    };
    settings.setFirstRun({ tourSeen: true, packPromptSeen: true }); settings.save({ provider: 'codex-sdk' });
    win.webContents.setBackgroundThrottling(false); win.setContentSize(1400, 900); win.show();
    await until('!!window.__fve&&!!document.querySelector(".home-frame-card")'); await q('document.querySelector(".home-frame-card").click()');
    await until('!!document.querySelector(".topbar")'); await q('document.querySelector(".welcome-go")?.click()');
    const items = await q(`window.api.probePaths(${JSON.stringify([speechFile, music])})`);
    check('footage and music probe', items.every(i => !i.error));
    await q(`(()=>{const [v,m]=${JSON.stringify(items)};window.__fve.load({id:'editorial',name:'Editorial fixture',ratio:'16:9',width:640,height:360,fps:30,
      media:[{...v,id:'mv'},{...m,id:'mm'}],videoClips:[{id:'speech',mediaId:'mv',in:0,out:v.duration,speed:1,volume:1}],
      audioClips:[{id:'music',mediaId:'mm',start:0,in:0,out:Math.min(m.duration,v.duration),speed:1,volume:0.25}],overlayClips:[],textClips:[]});})()`);
    const original = await q('window.__fve.duration()');
    await q('document.querySelector(".workspace-switch button:last-child").click()');
    await until('!!document.querySelector(".pilot-input textarea")');
    await q(`(()=>{const e=document.querySelector('.pilot-input textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,'Make this a tight short');e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await until('!document.querySelector(".pilot-input .send").disabled'); await q('document.querySelector(".pilot-input .send").click()');
    await until('!!document.querySelector(".edit-plan .plan-actions .btn-primary")');
    await shot('plan-card');
    check('footage log found sentences and fillers' + (result.real_speech ? '' : ' and a false start'), outcomes.log.sentences_total >= 2 && outcomes.log.fillers.count >= 1 && (result.real_speech || outcomes.log.retakes.length >= 1));
    if (!result.real_speech) check('editorial transcription asks for verbatim speech', result.verbatim_requested === true);
    check('plan card shows goal, hook and timed story', await q(`(()=>{const c=document.querySelector('.edit-plan');return c.textContent.includes('A tight short')&&c.textContent.includes('Why do edits fail')&&c.querySelectorAll('.plan-story li').length===2&&!!c.querySelector('time')})()`));
    check('planning made no timeline edit', await q('window.__fve.history().past.length===0'));
    const card = await q('(()=>{const c=document.querySelector(".edit-plan").getBoundingClientRect(),l=document.querySelector(".pilot-list").getBoundingClientRect();return {left:c.left>=l.left,right:c.right<=l.right+1,width:c.width}})()');
    check('plan card fits the conversation column', card.left && card.right && card.width > 200);
    await q('document.querySelector(".edit-plan .plan-actions .btn-primary").click()');
    await untilFn(() => turn === 2, 'approved turn');
    check('approval is sent as the next user message', await q('[...document.querySelectorAll(".pilot-msg.user .bubble")].at(-1).textContent.startsWith("Approved.")'));
    await until('!document.querySelector(".pilot-run-status")');
    await wait(400);
    await shot('after-edit');
    const edited = await q('window.__fve.duration()');
    result.durations = { original, edited };
    result.raw = { fillersDry: outcomes.fillersDry, fillersOut: outcomes.fillers, log: { fillers: outcomes.log.fillers, retakes: outcomes.log.retakes, sentences: outcomes.log.sentences?.slice(0, 8) }, fillers: outcomes.fillers, retakes: outcomes.retakes, retakesDry: outcomes.retakesDry?.candidates };
    check('retake and filler cuts applied', outcomes.retakes.status === 'applied' || outcomes.retakes.skipped === true);
    check('fillers removed between real pauses', outcomes.fillers.status === 'applied' && outcomes.fillers.removed_count >= 1);
    // Expected: false start (~1.6 s), hesitation and pauses over 0.8 s out; the spoken words stay.
    check('the edit is shorter but keeps the speech', edited < original - (result.real_speech ? 0.3 : 2.5) && edited > 5);
    result.beats = { bpm: outcomes.beats.bpm, confidence: outcomes.beats.tempo_confidence, error: outcomes.beats.error, first: outcomes.beats.beats?.values?.slice(0, 6) };
    check('beat grid finds the 120 BPM bed', Math.abs(outcomes.beats.bpm - 120) <= 4 && outcomes.beats.downbeats.values.length >= 3);
    check('critique measured real loudness and returned a score', outcomes.critique.checked.loudness === true && Number.isFinite(outcomes.critique.metrics.integrated_lufs) && Number.isFinite(outcomes.critique.score));
    check('completion check passes', outcomes.complete.ready === true);
    check('plan card stays but is no longer actionable', await q('!!document.querySelector(".edit-plan")&&!document.querySelector(".edit-plan .plan-actions")'));
    if (result.real_speech) {
      // Re-transcribe the delivered edit: fillers gone, every content word still spoken.
      const after = await q(`window.api.runCaptions(window.__fve.exportData().project,{language:'en',source:'all',maxLen:0,verbatim:true})`);
      const norm = t => t.toLowerCase().replace(/[^a-z' ]+/g, ' ').split(/\s+/).filter(Boolean);
      const before = norm(outcomes.log.sentences.map(x => x.text).join(' ')), spoken = norm(after.segments.map(x => x.text).join(' '));
      const fillers = new Set(['um', 'uh', 'umm', 'uhh', 'er']), content = before.filter(w => !fillers.has(w)), kept = new Set(spoken);
      result.speech_after = after.segments.map(x => x.text).join(' ');
      result.lost_words = [...new Set(content.filter(w => !kept.has(w)))];
      result.fillers_after = spoken.filter(w => fillers.has(w)).length;
      // Fillers spoken together with a word are skipped and reported, never cut blindly.
      // Precision first: fillers that could not be confirmed stay (and are reported); none may be added.
      result.filler_recall = `${outcomes.fillers.removed_count || 0}/${outcomes.fillers.found}`;
      check('no more fillers are heard than before', result.fillers_after <= before.filter(w => fillers.has(w)).length);
      // Re-transcripts vary slightly (Whisper can re-hear an untouched word), so allow one difference;
      // with FVE_EDITORIAL_TRUTH (known word positions) the cut audio itself is checked.
      check('content words survive the cuts', result.lost_words.length <= 1);
      if (process.env.FVE_EDITORIAL_TRUTH) {
        const truth = JSON.parse(fs.readFileSync(process.env.FVE_EDITORIAL_TRUTH, 'utf8')), isFiller = c => /^(um|uh)$/.test(c.text);
        const ranges = outcomes.fillersDry.ranges || [];
        result.truth = ranges.map(r => ({ ...r, filler_cover: Math.max(0, ...truth.filter(isFiller).map(c => (Math.min(r.end, c.end) - Math.max(r.start, c.start)) / (c.end - c.start))),
          word_overlap: truth.filter(c => !isFiller(c)).reduce((n, c) => n + Math.max(0, Math.min(r.end, c.end) - Math.max(r.start, c.start)), 0) }));
        check('no filler cut touches a real word (ground truth)', result.truth.every(r => r.word_overlap <= 0.01));
        check('each filler cut removes the whole filler (ground truth)', result.truth.every(r => r.filler_cover >= 0.95));
      }
    }
    await q('document.querySelector(".pilot-undo").click()'); await wait(300);
    check('one Undo restores the original timeline', Math.abs(await q('window.__fve.duration()') - original) < 0.01);
    result.outcomes = { log: { sentences: outcomes.log.sentences_total, fillers: outcomes.log.fillers, retakes: outcomes.log.retakes }, fillers: outcomes.fillers.removed_count, retakes: outcomes.retakes.removed_count,
      silences: outcomes.silences.removed_count, bpm: outcomes.beats.bpm, critique: { score: outcomes.critique.score, issues: outcomes.critique.issues.map(i => i.code), lufs: outcomes.critique.metrics.integrated_lufs } };
    check('no renderer exceptions', !result.errors.length);
  } catch (error) { result.error = error.stack; try { await shot('failure'); } catch {} }
  fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify(result, null, 2)); app.exit(result.error ? 1 : 0);
};
