// FVE_SMOKE_MODE=agent-spotlight: the timeline shows what CraftAI works on. While a tool runs, its clips carry
// agent-live (violet ring, stripe, "CraftAI · <title>" chip) and its range a tl-agent-range band; the scroller
// reveals an off-screen target unless the user scrolled; finished changes keep an agent-done trail that fades
// ~6 s after the run; a manual edit drops the spotlight and keeps the trail; Undo clears the trail at once;
// none of it touches history. Real editor, mocked reasoning (deterministic native loop with gates).
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
module.exports = async (win, app, dir) => {
  const q = (code) => win.webContents.executeJavaScript(code), wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const untilFn = async (fn, label, ticks = 240) => { for (let i = 0; i < ticks; i++) { if (await fn()) return; await wait(50); } throw Error('Timeout: ' + label); };
  const until = (code, ticks) => untilFn(() => q(code), code, ticks);
  const result = { checks: [], errors: [] };
  const check = (label, value) => { assert.ok(value, label); result.checks.push(label); };
  const click = (selector) => q(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const type = (text) => q(`(()=>{const e=document.querySelector('.pilot-input textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,${JSON.stringify(text)});e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  const send = async (text) => { await type(text); await until('!document.querySelector("button[aria-label=Send]").disabled'); await click('button[aria-label=Send]'); };
  const shot = async (name) => { await q('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))'); await wait(120); fs.writeFileSync(path.join(dir, name), (await win.capturePage()).toPNG()); };
  const settings = require('../../electron/system/settings.cjs'), local = require('../../electron/agents/localAgents.cjs'), ff = require('../../electron/media/ffmpeg.cjs');
  const original = { run: local.runEditorNative, status: local.status, image: local.generateImage };
  const gate = (signal) => { let release; const promise = new Promise((resolve, reject) => { release = resolve; if (signal.aborted) reject(Error('Stopped')); else signal.addEventListener('abort', () => reject(Error('Stopped')), { once: true }); }); promise.catch(() => {}); return { release, promise }; };
  const scenes = [0, 1, 2].map((i) => { const file = path.join(dir, `scene-${i}.png`); execFileSync(ff.ffmpegPath, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=320x180:r=12:d=1', '-frames:v', '1', file]); return file; });
  const fixture = { id: 'spotlight', name: 'Spotlight fixture', width: 320, height: 180, ratio: '16:9', fps: 12,
    media: [{ id: 'm1', type: 'image', path: scenes[0], width: 320, height: 180, name: 'Scene 1' }, { id: 'm2', type: 'image', path: scenes[1], width: 320, height: 180, name: 'Scene 2' }, { id: 'm3', type: 'image', path: scenes[2], width: 320, height: 180, name: 'Scene 3' }],
    videoClips: [{ id: 'v1', mediaId: 'm1', in: 0, out: 15 }, { id: 'v2', mediaId: 'm2', in: 0, out: 15 }, { id: 'v3', mediaId: 'm3', in: 0, out: 15 }],
    overlayClips: [], audioClips: [], effectClips: [], textClips: [{ id: 'far', text: 'Far away', start: 40, duration: 2 }] };
  const runs = [];
  local.status = async () => ({ ok: true, authenticated: true });
  let imageGate = null;
  local.generateImage = async (_cfg, req) => { if (imageGate) await imageGate.promise; fs.mkdirSync(req.outputDir, { recursive: true }); const file = path.join(req.outputDir, 'spot-scene.png'); fs.copyFileSync(scenes[2], file); return { path: file, source: 'fixture', prompt: req.prompt }; };
  local.runEditorNative = async (_cfg, options) => {
    const entry = { index: runs.length, stage: 'running', hold: gate(options.signal), error: null }; runs.push(entry);
    const call = async (name, args = {}) => { const data = JSON.parse((await options.onTool(name, args)).content[0].text); if (data.error) throw Error(data.error); return data; };
    try {
      if (entry.index === 0) {
        await call('trim_clip', { clip_id: 'v2', start_sec: 16 });
        await call('cut_range', { start_sec: 1, end_sec: 2 });
        imageGate = entry.hold;
        await call('generate_image', { prompt: 'A quiet archway at dusk.', as: 'overlay', start_sec: 40, duration_sec: 2 });
        imageGate = null;
        await call('add_text', { text: 'The end', start_sec: 40, duration_sec: 2 });
      } else if (entry.index === 1) {
        await call('trim_clip', { clip_id: 'v3', end_sec: 43 });
        entry.stage = 'held';
        await entry.hold.promise;
        await call('add_text', { text: 'Late write', start_sec: 1, duration_sec: 1 });
      } else {
        await call('add_text', { text: 'Undo me', start_sec: 10, duration_sec: 1 });
      }
      for (let i = 0; i < 8; i++) if ((await call('complete_edit', {})).ready) break;
      return { text: 'Done.' };
    } catch (error) { entry.error = error.message; throw error; }
    finally { entry.stage = 'ended'; }
  };
  settings.setFirstRun({ tourSeen: true, packPromptSeen: true }); settings.save({ provider: 'codex-sdk' });
  win.webContents.setBackgroundThrottling(false); win.setContentSize(1400, 900);
  win.webContents.on('console-message', (_e, level, message) => { if (level >= 3) result.errors.push(message); });
  try {
    await until('!!window.__fve&&!!document.querySelector(".home-frame-card")'); await click('.home-frame-card');
    await until('!!document.querySelector(".topbar")'); await q('document.querySelector(".welcome-go")?.click()');
    await q(`window.__fve.load(${JSON.stringify(fixture)})`); await wait(300);
    await click('.pilot-fab'); await until('!!document.querySelector(".pilot-input textarea")&&!document.querySelector(".pilot-input textarea").disabled');
    const pps = await q('document.querySelector(".clip[data-sel-id=v1]").getBoundingClientRect().width/15');
    check('fixture renders at a measurable zoom', pps > 10);
    // Record every timeline state the agent produces, so instant tools are caught in their running render.
    await q(`window.__spot=[];new MutationObserver(()=>{const live=[...document.querySelectorAll('.clip.agent-live')].map(e=>e.dataset.selId);const ranges=[...document.querySelectorAll('.tl-agent-range')].map(e=>[parseFloat(e.style.left),parseFloat(e.style.width)]);const s={live,ranges,chip:document.querySelector('.agent-chip')?.textContent||'',scrollLeft:document.querySelector('.tl-scroll').scrollLeft};const last=window.__spot.at(-1);if(!last||JSON.stringify(last)!==JSON.stringify(s))window.__spot.push(s);}).observe(document.querySelector('.tl-content'),{subtree:true,childList:true,attributes:true,attributeFilter:['class','style']});`);
    // ---- Run 1: trim, cut, a held image at 40 s (off-screen), then a title there ----
    await send('Tighten the opening and add an ending.');
    await untilFn(() => runs.length === 1, 'first run');
    await untilFn(() => runs[0].stage === 'running' && imageGate !== null, 'image held');
    await until('!!document.querySelector(".tl-agent-range")');
    await untilFn(() => q(`document.querySelector(".tl-scroll").scrollLeft>${Math.round(30 * pps)}`), 'reveal scroll settles', 80);
    const snaps = await q('window.__spot');
    check('spotlight marked the trimmed clip with the tool title', snaps.some((s) => s.live.includes('v2') && /CraftAI · Trimming a clip/.test(s.chip)));
    const cutBand = snaps.flatMap((s) => s.ranges).find((r) => Math.abs(r[0] - (192 + pps)) < 2 && Math.abs(r[1] - pps) < 2);
    check('the cut spotlight covered the requested second', !!cutBand);
    const revealed = await q('document.querySelector(".tl-scroll").scrollLeft');
    check('the scroller revealed the off-screen image target', revealed > pps * 10 && await q(`Math.abs(parseFloat(document.querySelector(".tl-agent-range").style.left)-(192+40*${pps}))<2`));
    check('the strip still names the running tool', await q('document.querySelector(".tl-agent-status")?.dataset.phase==="editing"'));
    await shot('spotlight-live-1400.png');
    // Back at the start (a programmatic scroll, not the user's): the early clips render again with their trail.
    await q('document.querySelector(".tl-scroll").scrollLeft=0'); await until('!!document.querySelector(".clip[data-sel-id=v2]")');
    check('trail: the trimmed and cut clips are marked, the shifted one is not', await q('document.querySelector(".clip[data-sel-id=v2]")?.dataset.agent==="done"&&document.querySelector(".clip[data-sel-id=v1]")?.dataset.agent==="done"&&!document.querySelector(".clip[data-sel-id=v3]")?.dataset.agent'));
    check('a seam line marks where the cut happened', await q(`[...document.querySelectorAll(".tl-agent-seam")].some(e=>Math.abs(parseFloat(e.style.left)-(192+${pps}))<2)`));
    await shot('spotlight-trail-live-1400.png');
    // The user scrolls back: the next reveal must yield to them.
    await q('document.querySelector(".tl-scroll").dispatchEvent(new WheelEvent("wheel",{deltaY:0,bubbles:true}))');
    await wait(100); runs[0].hold.release();
    await untilFn(() => runs[0].stage === 'ended', 'first run ends');
    await until('!document.querySelector("button[aria-label=Stop]")');
    check('a user scroll wins over the next reveal', await q('document.querySelector(".tl-scroll").scrollLeft===0'));
    check('the status strip is gone after the run', await q('!document.querySelector(".tl-agent-status")'));
    check('no extra history: the request is one Undo step', await q('window.__fve.history().past.length===1'));
    await q(`document.querySelector(".tl-scroll").scrollLeft=${Math.round(38 * pps)};`); await wait(150);
    await until('!!document.querySelector(".clip.agent-done[data-sel-track=text]")');
    check('the created title carries the trail mark', await q('[...document.querySelectorAll(".clip.agent-done[data-sel-track=text]")].some(e=>e.textContent.includes("The end"))&&!!document.querySelector(".clip.agent-done .agent-mark")'));
    await shot('spotlight-trail-1400.png');
    await until('document.querySelector(".timeline").classList.contains("agent-fading")', 180);
    await until('!document.querySelector(".clip.agent-done")&&!document.querySelector(".tl-agent-seam")', 40);
    check('the trail fades out about six seconds after the run', true);
    // ---- Run 2: a manual edit interrupts a held run ----
    await q('document.querySelector(".tl-scroll").scrollLeft=0;'); await wait(100);
    await send('Shorten the last shot.');
    await untilFn(() => runs.length === 2 && runs[1].stage === 'held', 'second run held');
    await until('document.querySelector(".clip[data-sel-id=v3]")?.dataset.agent==="done"');
    await q('window.__fve.dispatch({type:"setProject",patch:{name:"Manual edit wins"}})');
    await until('document.querySelector(".tl-agent-status")?.dataset.phase==="interrupted"');
    check('an interruption keeps the trail of real edits and shows no spotlight', await q('document.querySelector(".clip[data-sel-id=v3]")?.dataset.agent==="done"&&!document.querySelector(".clip.agent-live")&&!document.querySelector(".tl-agent-range")'));
    await shot('spotlight-interrupted-1400.png');
    runs[1].hold.release(); await untilFn(() => runs[1].stage === 'ended', 'second run ends');
    await until('!document.querySelector("button[aria-label=Stop]")');
    await untilFn(() => q('!document.querySelector(".clip.agent-done")'), 'trail after interruption fades', 200);
    // ---- Run 3: Undo right after the run clears the trail at once ----
    await send('Add a title at ten seconds.');
    await untilFn(() => runs.length === 3 && runs[2].stage === 'ended', 'third run ends');
    await until('!document.querySelector("button[aria-label=Stop]")');
    await until('!!document.querySelector(".clip.agent-done[data-sel-track=text]")');
    await q('window.__fve.dispatch({type:"undo"})'); await wait(250);
    check('Undo after the run clears the trail immediately', await q('!document.querySelector(".clip.agent-done")&&!document.querySelector(".timeline").classList.contains("agent-fading")'));
    check('no renderer errors', result.errors.length === 0);
  } catch (error) { result.error = error.stack; result.runs = runs.map((r) => ({ stage: r.stage, error: r.error })); }
  finally { local.runEditorNative = original.run; local.status = original.status; local.generateImage = original.image; }
  fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify(result, null, 2));
  app.quit();
};
