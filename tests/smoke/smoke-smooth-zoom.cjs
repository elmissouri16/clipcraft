// Real renderer, effect pass and encoder. Optional saved-project input is read
// only; the test profile, project copy and export all live under FVE_SMOKE.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');

function motion(ff, file) {
  const w = 270, h = 250, size = w * h;
  // Keep the title and changing captions outside the measurement area. Blur
  // suppresses film grain; least-squares flow measures background movement.
  const frames = execFileSync(ff.ffmpegPath, ['-v','error','-i',file,'-t','9','-an',
    '-vf','format=gray,gblur=sigma=1.5,crop=270:250:420:30',
    '-f','rawvideo','-pix_fmt','gray','pipe:1'], { maxBuffer: 32 * 1024 * 1024 });
  const steps = [];
  for (let f = 25; f < Math.min(204, frames.length / size); f++) {
    const p = (f - 1) * size, q = f * size;
    let xx = 0, yy = 0, xy = 0, xt = 0, yt = 0;
    for (let y = 2; y < h - 2; y++) for (let x = 2; x < w - 2; x++) {
      const i = y * w + x;
      const gx = (frames[p+i+1] - frames[p+i-1] + frames[q+i+1] - frames[q+i-1]) / 4;
      const gy = (frames[p+i+w] - frames[p+i-w] + frames[q+i+w] - frames[q+i-w]) / 4;
      const dt = frames[q+i] - frames[p+i];
      xx += gx*gx; yy += gy*gy; xy += gx*gy; xt += gx*dt; yt += gy*dt;
    }
    const det = xx*yy - xy*xy;
    const dx = (-yy*xt + xy*yt) / det, dy = (xy*xt - xx*yt) / det;
    assert.ok(Number.isFinite(dx) && Number.isFinite(dy), 'source patch contains trackable texture');
    steps.push({ frame: f, dx, dy, magnitude: Math.hypot(dx,dy) });
  }
  return { comparisons: steps.length, nearStationary: steps.filter(s => s.magnitude < .05).length,
    maxStep: Math.max(...steps.map(s => s.magnitude)), steps };
}

module.exports = async (win, app, dir) => {
  const ff = require('../../electron/media/ffmpeg.cjs');
  const result = { checks: [], errors: [] };
  const q = code => win.webContents.executeJavaScript(code);
  const check = (name, value) => { assert.ok(value, name); result.checks.push(name); };
  const until = async code => {
    for (let i = 0; i < 500; i++) {
      if (await q(code)) return;
      await new Promise(resolve => setTimeout(resolve,40));
    }
    throw Error('Timeout: ' + code);
  };
  win.webContents.setBackgroundThrottling(false);
  win.webContents.on('console-message', (_e, level, message) => { if (level >= 3) result.errors.push(message); });
  try {
    let saved;
    if (process.env.FVE_ZOOM_PROJECT) {
      const input = JSON.parse(fs.readFileSync(process.env.FVE_ZOOM_PROJECT,'utf8'));
      saved = input.project || input;
    } else {
      const source = path.join(dir,'texture.png');
      execFileSync(ff.ffmpegPath,['-v','error','-y','-f','lavfi','-i','testsrc2=s=1920x1080','-frames:v','1',source]);
      saved = { width:1920, height:1080, fps:24, media:[{...await ff.probe(source),id:'m',path:source}], videoClips:[
        {id:'in',mediaId:'m',in:0,out:9,speed:1,keyframes:{scale:[{t:0,v:1,e:'inout'},{t:8.96,v:1.065,e:'inout'}]},effects:['vignette','fx_grainfine']},
        {id:'out',mediaId:'m',in:0,out:11,speed:1,keyframes:{scale:[{t:0,v:1.065,e:'inout'},{t:10.96,v:1,e:'inout'}]},effects:['vignette','fx_grainfine']},
      ] };
    }
    const clips = saved.videoClips.slice(0,2);
    const duration = clips.reduce((s,c) => s+(c.out-c.in)/(c.speed||1),0);
    const fixture = { ...saved, id:'smooth-zoom-regression', name:'Smooth image zoom check', craftAI:undefined,
      media:saved.media.filter(m => clips.some(c => c.mediaId===m.id)), videoClips:clips,
      overlayClips:[],audioClips:[],stickerClips:[],effectClips:[],
      textClips:(saved.textClips||[]).filter(c => c.start+c.duration<=duration),
      exportSettings:{preset:'custom',custom:{mode:'crf',crf:18,codec:'h264',encoderPreset:'ultrafast',resCap:720,fps:0,audioKbps:192}} };
    await until('!!window.__fve&&!!document.querySelector(".home-frame-card")');
    await q('document.querySelector(".home-frame-card").click()');
    await until('!!document.querySelector(".topbar")');
    await q(`window.__fve.load(${JSON.stringify(fixture)})`);
    await q('window.__fve.exportNow()');
    check('real editor exports both image zooms with effects and captions',await q('!!document.querySelector(".modal-icon.ok")'));
    const file = path.join(dir,'ui-export.mp4'), meta = await ff.probe(file);
    result.output = { file, ...meta };
    check('output retains the requested dimensions, frame rate and duration',meta.width===720&&meta.height===406&&meta.fps===24&&Math.abs(meta.duration-duration)<.05);
    execFileSync(ff.ffmpegPath,['-v','error','-i',file,'-f','null','-']);
    check('completed export decodes without errors',true);
    result.motion = motion(ff,file);
    check('slow zoom advances between resize boundaries',result.motion.nearStationary/result.motion.comparisons<.45);
    check('slow zoom avoids the old half-pixel snaps',result.motion.maxStep<.35);
    if (process.env.FVE_ZOOM_BASELINE) {
      result.before = motion(ff,process.env.FVE_ZOOM_BASELINE);
      check('same source moves more consistently than the reported export',result.motion.nearStationary<result.before.nearStationary*.65);
      check('same source has smaller movement spikes than the reported export',result.motion.maxStep<result.before.maxStep/2);
    }
    fs.writeFileSync(path.join(dir,'success.png'),(await win.capturePage()).toPNG());
    await q('[...document.querySelectorAll(".modal-backdrop button")].find(b=>b.textContent.trim()==="OK").click()');
    await q('window.__fve.seek(4);window.__fve.play()');
    await until('window.__fve.currentTime()>4.2');
    await q('window.__fve.pause()');
    check('the editor still plays the image timeline after export',true);
    fs.writeFileSync(path.join(dir,'preview.png'),(await win.capturePage()).toPNG());
    check('renderer has no runtime errors',!result.errors.length);
  } catch (error) {
    result.error = error.stack;
    result.dom = await q('document.body.innerText.slice(-1400)');
  }
  fs.writeFileSync(path.join(dir,'result.json'),JSON.stringify(result,null,2));
  app.exit(result.error ? 1 : 0);
};
