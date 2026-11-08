// Smooth motion in the real app: CraftAI's move_along_path and add_keyframes through the real tool
// runner and reducer, the critique flagging stop-and-go and camera breathing, and the inspector's
// Continuous easing chip on a path keyframe (picked by hand too).
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');

module.exports = async (win, app, dir) => {
  const ff = require('../../electron/media/ffmpeg.cjs');
  const q = (s) => win.webContents.executeJavaScript(s), wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (s, ms = 20000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await q(s)) return; await wait(50); } throw Error('Timeout: ' + s); };
  const result = { checks: [], errors: [] };
  const check = (name, ok) => { assert.ok(ok, name); result.checks.push(name); };
  win.webContents.on('console-message', (_e, level, message) => { if (level >= 3) result.errors.push(message); });
  try {
    const map = path.join(dir, 'map.png'), ship = path.join(dir, 'ship.png');
    execFileSync(ff.ffmpegPath, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=1080x1920', '-frames:v', '1', map]);
    execFileSync(ff.ffmpegPath, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=0xd04030:s=1080x1920', '-frames:v', '1', ship]);
    const media = [{ ...await ff.probe(map), id: 'map', name: 'map.png', path: map }, { ...await ff.probe(ship), id: 'ship', name: 'ship.png', path: ship }];
    const fixture = { id: 'smooth-motion', name: 'Smooth motion', width: 1080, height: 1920, ratio: '9:16', fps: 30, media,
      videoClips: [{ id: 'shot', mediaId: 'map', in: 0, out: 8, speed: 1 }], overlayClips: [{ id: 'boat', mediaId: 'ship', start: 1, in: 0, out: 6, speed: 1, transform: { scale: 0.2 } }],
      audioClips: [], textClips: [], effectClips: [] };

    win.setContentSize(1440, 900); win.show();
    await until('!!window.__fve&&!!document.querySelector(".home-frame-card")', 30000);
    await q('document.querySelector(".home-frame-card").click()'); await until('!!document.querySelector(".topbar")');
    await q('document.querySelector(".welcome-go")?.click()');
    await q(`window.__fve.load(${JSON.stringify(fixture)})`); await wait(300);
    const tool = (name, args) => q(`(async()=>{const { createToolRunner } = await import('/src/features/agent/tools.js');
      const runner = createToolRunner({ getProject: () => window.__fve.rawProject(), dispatch: window.__fve.dispatch, settle: () => new Promise((r) => setTimeout(r, 60)), api: window.api, requestId: 'smooth-motion' });
      return JSON.parse(JSON.stringify(await runner.run(${JSON.stringify(name)}, ${JSON.stringify(args)})));})()`);
    const critique = () => q(`import('/src/features/agent/editorial.js').then(m=>{const r=m.critiqueProject(window.__fve.rawProject());return {codes:r.issues.map(i=>i.code),motion:r.metrics.motion}})`);

    // A ship crossing the map in one journey, facing its way.
    const path1 = await tool('move_along_path', { clip_id: 'boat', points: [{ x: -0.35, y: 0.25 }, { x: -0.1, y: 0.05 }, { x: 0.1, y: 0.1 }, { x: 0.3, y: -0.2 }], start_sec: 1.5, end_sec: 6, orient: true });
    result.path = path1;
    check('move_along_path builds one smooth journey in the real editor', path1.ok && !path1.motion.stops.length && !path1.motion.jerks.length && !path1.motion.rotation_jumps.length);
    const boat = await q('window.__fve.rawProject().overlayClips.find(c=>c.id==="boat").keyframes');
    check('the journey is ordinary keyframes at the waypoints, flowing through them', boat.x.length === 4 && boat.x.slice(1).every((k) => k.e === 'continuous') && boat.rot?.length === 4);

    // A camera that stops at every key and zooms back and forth: the critique says so.
    const stepped = await tool('add_keyframes', { clip_id: 'shot', property: 'scale', easing: 'inout', keyframes: [[0, 1.1], [2, 1.3], [4, 1.1], [6, 1.3]].map(([t, v]) => ({ time_sec: t, value: v })) });
    check('add_keyframes reports stop-and-go right away', stepped.ok && stepped.motion.stops.length >= 2);
    let c = await critique(); result.critiqueBefore = c;
    check('the critique flags stop-and-go and camera breathing', c.codes.includes('motion_stop') && c.codes.includes('motion_reversal'));
    const fixed = await tool('add_keyframes', { clip_id: 'shot', property: 'scale', easing: 'continuous', keyframes: [[0, 1.05], [2, 1.12], [4, 1.18], [6, 1.25]].map(([t, v]) => ({ time_sec: t, value: v })) });
    c = await critique(); result.critiqueAfter = c;
    check('one-direction continuous camera move: no motion issues left', fixed.ok && !fixed.motion.stops.length && !c.codes.some((x) => x.startsWith('motion_')));

    // The inspector shows the path keyframe's easing as Continuous.
    await q(`window.__fve.seek(3); window.__fve.select({ track: 'overlay', id: 'boat' }); window.__fve.tab('video')`);
    await until('!!document.querySelector(".curve-chips")');
    const chip = await q('(()=>{const on=document.querySelector(".curve-chip.on");return {active:on?.textContent.trim(),note:document.querySelector(".curve-note")?.textContent||""}})()');
    result.chip = chip;
    check('the inspector shows the segment easing as Continuous', chip.active === 'Continuous' && /without stopping/.test(chip.note));
    await q('document.querySelector(".curve-chips").scrollIntoView({block:"center"});void 0'); await wait(250);
    fs.writeFileSync(path.join(dir, 'continuous-chip.png'), (await win.capturePage()).toPNG());
    // Picking another easing by hand, then Continuous again, writes it to the keyframe.
    await q('[...document.querySelectorAll(".curve-chip")].find(b=>b.textContent.trim()==="Ease Out").click()'); await wait(150);
    const eased = await q('window.__fve.rawProject().overlayClips.find(c=>c.id==="boat").keyframes.x.map(k=>k.e||null)');
    await q('[...document.querySelectorAll(".curve-chip")].find(b=>b.textContent.trim()==="Continuous").click()'); await wait(150);
    const back = await q('window.__fve.rawProject().overlayClips.find(c=>c.id==="boat").keyframes.x.map(k=>k.e||null)');
    result.chipEdits = { eased, back };
    check('the Continuous chip edits the keyframe like the other easings', eased.includes('easeOut') && !back.includes('easeOut') && back.filter((e) => e === 'continuous').length === 3);

    // Preview plays through the journey.
    await q('window.__fve.seek(1.5);window.__fve.play()'); await until('window.__fve.currentTime()>3', 10000); await q('window.__fve.pause()');
    fs.writeFileSync(path.join(dir, 'preview.png'), (await win.capturePage()).toPNG());
    check('no renderer exceptions', !result.errors.length);
  } catch (error) { result.error = error.stack; try { fs.writeFileSync(path.join(dir, 'failure.png'), (await win.capturePage()).toPNG()); } catch {} }
  fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify(result, null, 2)); app.exit(result.error ? 1 : 0);
};
