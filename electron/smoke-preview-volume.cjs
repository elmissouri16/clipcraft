// Measures actual decoded media through the preview's Web Audio graph. Fixtures,
// preferences and screenshots stay in FVE_SMOKE, away from the user's projects.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
module.exports = async (win, app, dir) => {
  win.webContents.setBackgroundThrottling(false);
  const result = { errors: [] };
  const q = async (js) => {
    new (require('node:vm').Script)(js);
    try { return await win.webContents.executeJavaScript(js); }
    catch (error) { throw new Error(`${js}\n${error.message}`); }
  };
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const until = async (js) => {
    for (let i = 0; i < 200; i++) { if (await q(js)) return; await wait(100); }
    throw new Error(`Timed out: ${js}`);
  };
  const click = (selector) => q(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const volume = async (percent, scope = '.player > .transport') => {
    await q(`(() => {
      const el = document.querySelector(${JSON.stringify(`${scope} input[aria-label="Preview volume level"]`)});
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, ${JSON.stringify(String(percent))});
      el.dispatchEvent(new Event('input', {bubbles:true}));
    })()`);
    await wait(100);
  };
  const sample = () => q(`(() => {
    const rms = (analyser) => {
      const buf = new Float32Array(analyser.fftSize); analyser.getFloatTimeDomainData(buf);
      return Math.sqrt(buf.reduce((sum, value) => sum + value * value, 0) / buf.length);
    };
    return { mix: rms(window.__previewGraph.left), output: rms(window.__previewOutput),
      gain: window.__previewGraph.monitor.gain.value };
  })()`);
  const clips = () => q(`(() => {const p = window.__fve.exportData().project;
    return JSON.stringify([p.videoClips,p.overlayClips,p.audioClips]);})()`);
  win.webContents.on('console-message', (_e, level, text) => { if (level >= 3) result.errors.push(text); });
  try {
    require('./settings.cjs').setFirstRun({ tourSeen: true });
    const ff = require('./ffmpeg.cjs').ffmpegPath;
    const video = path.join(dir, 'tone.mp4');
    const sound = path.join(dir, 'tone.wav');
    if (!fs.existsSync(video)) execFileSync(ff, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=0x30204f:size=160x90:rate=15:duration=45',
      '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=45', '-af', 'volume=0.12', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', video]);
    if (!fs.existsSync(sound)) execFileSync(ff, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=660:sample_rate=48000:duration=45', '-af', 'volume=0.12', sound]);
    await until('!!window.__fve && !!document.querySelector(".home-frame-card")');
    await click('.home-frame-card'); await until('!!document.querySelector(".topbar")');
    await q('document.querySelector(".welcome-go")?.click()');
    const media = await q(`window.api.probePaths(${JSON.stringify([video, sound])})`);
    const project = { id: 'preview-volume-test', name: 'Preview volume verification', ratio: '16:9', width: 1280, height: 720, fps: 30,
      media: media.map((m, i) => ({ ...m, id: `m${i}` })),
      videoClips: [{ id: 'main', mediaId: 'm0', in: 0, out: 45, speed: 1, volume: 0.8 }],
      overlayClips: [{ id: 'overlay', mediaId: 'm0', in: 0, out: 45, start: 0, speed: 1, volume: 0.6,
        enhance: { on: true, path: sound, from: 0, to: 45 } }],
      audioClips: [{ id: 'audio', mediaId: 'm1', in: 0, out: 45, start: 0, volume: 0.4 }], textClips: [] };
    await q(`window.__fve.load(${JSON.stringify(project)})`);
    await until(`!!document.querySelector('.player > .transport button[aria-label="Preview volume"]')`);
    const originalClips = await clips();
    await q(`(async () => {
      const url = performance.getEntriesByType('resource').map(e => e.name).find(name => name.includes('/src/audioTap.js'));
      window.__previewAudio = await import(url);
      window.__previewAudio.setPreviewAudio({volume:1,muted:false});
      window.__previewGraph = window.__previewAudio.ensureAudioGraph();
      window.__previewOutput = window.__previewGraph.ctx.createAnalyser();
      window.__previewOutput.fftSize = 2048;
      window.__previewGraph.monitor.connect(window.__previewOutput);
    })()`);
    await click('.player > .transport .play-btn');
    await until('window.__previewGraph.ctx.state === "running" && [...document.querySelectorAll(".player video,.player audio")].filter(el => !el.paused && el.readyState >= 2).length >= 4');
    await wait(300);
    result.full = await sample();
    assert.ok(result.full.mix > 0.0005, 'real video, audio and enhanced overlay reach the mix');
    assert.ok(Math.abs(result.full.output / result.full.mix - 1) < 0.05);
    await click('.player > .transport button[aria-label="Preview volume"]');
    await volume(50);
    result.half = await sample();
    assert.ok(Math.abs(result.half.output / result.half.mix - 0.5) < 0.05);
    await click('.player > .transport button[aria-label="Mute preview"]');
    await wait(100);
    result.muted = await sample();
    assert.ok(result.muted.mix > 0.0005 && result.muted.output < 0.000001);
    await click('.player > .transport button[aria-label="Unmute preview"]');
    await wait(100);
    assert.equal((await sample()).gain, 0.5, 'unmute restores previous listening level');
    assert.equal(await clips(), originalClips, 'preview control does not change exported clip gains');
    result.mixUnchanged = true;
    const bounds = await q(`(() => { const p=document.querySelector('.player').getBoundingClientRect();
      const m=document.querySelector('.preview-volume-menu').getBoundingClientRect();
      return {inside:m.left>=p.left && m.right<=p.right && m.top>=p.top};})()`);
    assert.equal(bounds.inside, true);
    fs.writeFileSync(path.join(dir, 'preview-volume.png'), (await win.capturePage()).toPNG());
    // Media library preview shares the same listening control and audio graph.
    await q(`[...document.querySelectorAll('.asset')].find(el => el.title.startsWith('tone.mp4')).click()`);
    await until('!!document.querySelector(".peek video") && !document.querySelector(".peek video").paused');
    await click('.peek button[aria-label="Preview volume"]');
    assert.equal(await q(`document.querySelector('.peek input[aria-label="Preview volume level"]').value`), '50');
    await volume(25, '.peek');
    assert.equal((await sample()).gain, 0.25);
    await click('.peek button[aria-label="Mute preview"]'); await wait(100);
    result.peekMuted = await sample();
    assert.ok(result.peekMuted.mix > 0.0005 && result.peekMuted.output < 0.000001);
    await click('.peek button[aria-label="Unmute preview"]');
    await q(`document.querySelector('.peek button[aria-label="Mute preview"]').dispatchEvent(new KeyboardEvent('keydown', {key:'Escape',code:'Escape',bubbles:true}))`);
    assert.ok(await q(`!!document.querySelector('.peek') && !document.querySelector('.peek .preview-volume-menu')`));
    result.keyboardMenuIsolation = true;
    await click('.peek button[aria-label="Back to the project (Esc)"]');
    await until('!document.querySelector(".peek")');
    assert.ok(await q(`document.querySelector('.player > .transport button[aria-label="Preview volume"]').title.includes('25%')`));
    result.mediaPeekShared = true;
    win.webContents.reload();
    await until('!!window.__fve && !!document.querySelector(".home-frame-card")');
    await click('.home-frame-card'); await until('!!document.querySelector(".topbar")');
    assert.ok(await q(`document.querySelector('.player > .transport button[aria-label="Preview volume"]').title.includes('25%')`));
    result.preferenceRestored = true;
    result.ok = result.errors.length === 0;
  } catch (error) {
    result.ok = false; result.error = error.stack;
    fs.writeFileSync(path.join(dir, 'failure.png'), (await win.capturePage()).toPNG());
  }
  fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify(result, null, 2));
  app.exit(result.ok ? 0 : 1);
};
