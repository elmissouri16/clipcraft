// Selecting on the timeline while CraftAI works must not stop it: a real mouse click on a clip during
// an open agent edit leaves the edit running (no interruption, no manual Undo step); a real drag that
// moves the clip still ends it, reported as the move.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');

module.exports = async (win, app, dir) => {
  const ff = require('../../electron/media/ffmpeg.cjs');
  const q = (s) => win.webContents.executeJavaScript(s), wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (s, ms = 30000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await q(s)) return; await wait(60); } throw Error('Timeout: ' + s); };
  const result = { checks: [], errors: [] };
  const check = (name, ok) => { assert.ok(ok, name); result.checks.push(name); };
  win.webContents.on('console-message', (_e, level, message) => { if (level >= 3) result.errors.push(message); });
  const mouse = async (type, x, y) => { win.webContents.sendInputEvent({ type, x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1 }); await wait(40); };
  try {
    const clipFile = path.join(dir, 'clip.mp4');
    execFileSync(ff.ffmpegPath, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=640x360:r=30:d=6', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', clipFile]);
    const media = { ...await ff.probe(clipFile), id: 'm', name: 'clip.mp4', path: clipFile };
    win.setContentSize(1440, 900); win.show();
    await until('!!window.__fve&&!!document.querySelector(".home-frame-card")');
    await q('document.querySelector(".home-frame-card").click()'); await until('!!document.querySelector(".topbar")');
    await q('document.querySelector(".welcome-go")?.click()');
    await q(`window.__fve.load(${JSON.stringify({ id: 'selection', name: 'Selection', width: 640, height: 360, ratio: '16:9', fps: 30, media: [media],
      videoClips: [{ id: 'v', mediaId: 'm', in: 0, out: 6, speed: 1 }], overlayClips: [{ id: 'o', mediaId: 'm', start: 1, in: 0, out: 3, speed: 1 }], audioClips: [], textClips: [], effectClips: [] })})`);
    await until('!!document.querySelector(".clip.overlay")');
    const state = () => q('(()=>{const h=window.__fve.history();return {owner:h.agentEdit?.token||null,interruption:h.agentInterruption||null,past:h.past.length,start:window.__fve.rawProject().overlayClips[0].start}})()');
    const centre = async () => q('(()=>{const r=document.querySelector(".clip.overlay").getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()');

    // An open agent edit with one agent change, like CraftAI mid-request.
    await q(`window.__fve.dispatch({type:'beginAgentEdit',token:'smoke-owner'});window.__fve.dispatch({type:'setProject',patch:{name:'Agent working'},agentToken:'smoke-owner'})`);
    let s = await state(); const pastBefore = s.past;
    check('an agent edit is open', s.owner === 'smoke-owner');

    // A real click on the overlay clip: selects it, changes nothing.
    let c = await centre();
    await mouse('mouseDown', c.x, c.y); await mouse('mouseUp', c.x, c.y); await wait(200);
    s = await state(); result.afterClick = s;
    check('the click selected the clip', await q('!!document.querySelector(".clip.overlay.selected")'));
    check('selecting a clip leaves the agent edit running', s.owner === 'smoke-owner' && !s.interruption && s.past === pastBefore);

    // A real drag that moves the clip: that is an edit, and ends the request.
    c = await centre();
    await mouse('mouseDown', c.x, c.y);
    for (let i = 1; i <= 8; i++) await mouse('mouseMove', c.x + i * 15, c.y);
    await mouse('mouseUp', c.x + 120, c.y); await wait(250);
    s = await state(); result.afterDrag = s;
    check('dragging the clip moved it and ended the agent edit, reported as the move', s.start > 1 && s.owner === null && !!s.interruption && s.interruption.action !== 'beginGesture');
    check('no renderer exceptions', !result.errors.length);
  } catch (error) { result.error = error.stack; try { fs.writeFileSync(path.join(dir, 'failure.png'), (await win.capturePage()).toPNG()); } catch {} }
  fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify(result, null, 2)); app.exit(result.error ? 1 : 0);
};
