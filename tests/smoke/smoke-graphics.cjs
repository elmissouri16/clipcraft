// Motion graphics in the real app: CraftAI's graphics tools through the real tool runner, the real
// sandbox render (electron/graphics/), the preview and the export.
// - A button graphic over a background video: rendered, placed, sample frames returned as a sheet;
//   transparent where nothing is drawn (the video shows through) in both the preview and the export.
// - edit_graphic re-renders in place; a broken component returns a readable error.
// - The request that exposed the gap: an animated chart of US state populations on an empty project.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');

module.exports = async (win, app, dir) => {
  const ff = require('../../electron/media/ffmpeg.cjs');
  const q = (s) => win.webContents.executeJavaScript(s), wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (s, ms = 30000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await q(s)) return; await wait(60); } throw Error('Timeout: ' + s); };
  const result = { checks: [], errors: [] };
  const check = (name, ok) => { assert.ok(ok, name); result.checks.push(name); };
  win.webContents.on('console-message', (_e, level, message) => { if (level >= 3) result.errors.push(message); });
  const W = 1080, H = 1920;
  // RGB of one decoded pixel of a video at a time.
  const pixel = (file, t, x, y) => [...execFileSync(ff.ffmpegPath, ['-v', 'error', '-ss', String(t), '-i', file, '-vf', `scale=in_color_matrix=bt709:in_range=tv,format=rgb24,crop=1:1:${x}:${y}`, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'])];
  const near = (a, b, tol) => a.every((v, i) => Math.abs(v - b[i]) <= tol);
  try {
    // A background video: a saturated green with a moving test pattern, easy to tell from the button.
    // Written as a well-formed BT.709 file (matrix + tags): the export reads untagged HD as BT.709 like
    // players do, so an untagged file converted with FFmpeg's BT.601 default would decode to a different green.
    const bg = path.join(dir, 'background.mp4');
    execFileSync(ff.ffmpegPath, ['-v', 'error', '-y', '-f', 'lavfi', '-i', `color=c=0x1faa59:s=${W}x${H}:r=30:d=5`, '-vf', 'scale=out_color_matrix=bt709:out_range=tv',
      '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', bg]);
    const fixture = { id: 'graphics-smoke', name: 'Graphics', width: W, height: H, ratio: '9:16', fps: 30, media: [{ ...await ff.probe(bg), id: 'bg', name: 'background.mp4', path: bg }],
      videoClips: [{ id: 'v', mediaId: 'bg', in: 0, out: 5, speed: 1 }], overlayClips: [], audioClips: [], textClips: [], effectClips: [],
      exportSettings: { preset: 'custom', custom: { mode: 'crf', crf: 16, codec: 'h264', encoderPreset: 'ultrafast', resCap: 0, fps: 0, audioKbps: 128 } } };
    win.setContentSize(1440, 900); win.show();
    await until('!!window.__fve&&!!document.querySelector(".home-frame-card")');
    await q('document.querySelector(".home-frame-card").click()'); await until('!!document.querySelector(".topbar")');
    await q('document.querySelector(".welcome-go")?.click()');
    await q(`window.__fve.load(${JSON.stringify(fixture)})`); await wait(400);
    const tool = (name, args) => q(`(async()=>{const { createToolRunner } = await import('/src/features/agent/tools.js');
      const runner = createToolRunner({ getProject: () => window.__fve.rawProject(), dispatch: window.__fve.dispatch, settle: () => new Promise((r) => setTimeout(r, 60)), api: window.api, requestId: 'graphics-smoke-' + Math.random() });
      return JSON.parse(JSON.stringify(await runner.run(${JSON.stringify(name)}, ${JSON.stringify(args)})));})()`);
    const examples = await q(`import('/src/features/agent/graphicsGuide.js').then(m=>m.GRAPHICS_EXAMPLES)`);

    // 1. A button graphic over the video.
    const guide = await tool('graphics_guide', { topic: 'toolkit' });
    check('the agent can read the graphics toolkit', /export default function render/.test(guide.text));
    const t0 = Date.now();
    const added = await tool('add_graphic', { code: examples.button, inputs: { label: 'SUBSCRIBE', pressAt: 1.5 }, fonts: ['Montserrat 900'], start_sec: 0.5, duration_sec: 3, name: 'Subscribe button' });
    result.add = { ...added, frames: added.frames?.length, ms: Date.now() - t0 };
    check('add_graphic renders the component in the sandbox and places it as an overlay', added.ok && !!added.clip_id && !added.font_warning);
    check('the agent gets sample frames of what it drew, as one contact sheet', added.frames?.length >= 3 && !!added.sheet_id);
    const media = await q(`(()=>{const p=window.__fve.rawProject(),c=p.overlayClips.find(x=>x.id===${JSON.stringify(added.clip_id)}),m=p.media.find(x=>x.id===c.mediaId);return {clip:c,media:m}})()`);
    result.media = { path: media.media.path, proxy: media.media.proxy, vcodec: media.media.vcodec, fonts: media.media.graphic?.fonts };
    check('the graphic is transparent media: an RLE file for export and a VP9 copy for the preview', fs.existsSync(media.media.path) && /\.mov$/.test(media.media.path) && /\.webm$/.test(media.media.proxy) && fs.existsSync(media.media.proxy) && !!media.media.graphic?.code);

    // Preview: the button where it is drawn, the video everywhere else. At 1.6 s the button has popped
    // in and is not pressed yet (red); the press is 1.5 s into the graphic, at 2 s.
    await q('window.__fve.seek(1.6)'); await wait(1200);
    const stage = await q('(()=>{const r=document.querySelector(".stage").getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height}})()');
    const shot = await win.capturePage(); fs.writeFileSync(path.join(dir, 'preview-button.png'), shot.toPNG());
    const scale = shot.getSize().width / (await q('window.innerWidth'));
    const sampleAt = (fx, fy) => { const img = shot.crop({ x: Math.round((stage.x + stage.w * fx) * scale), y: Math.round((stage.y + stage.h * fy) * scale), width: 1, height: 1 }).toBitmap(); return [img[2], img[1], img[0]]; };
    result.preview = { corner: sampleAt(0.15, 0.2), button: sampleAt(0.5, 0.597) };
    // The player's colours are display-managed, so compare by dominant channel, not exact values.
    const green = ([r, g, b]) => g > r + 40 && g > b + 30, red = ([r, g, b]) => r > g + 80 && r > b + 80;
    check('the preview shows the video through the transparent parts', green(result.preview.corner));
    check('the preview shows the drawn button', red(result.preview.button));

    // Export: the same, decoded from the file.
    await q('window.__fve.exportNow()'); await until('!!document.querySelector(".modal-icon.ok")', 120000);
    const exported = path.join(dir, 'ui-export.mp4');
    result.export = { corner: pixel(exported, 1.6, Math.round(W * 0.15), Math.round(H * 0.2)), button: pixel(exported, 1.6, Math.round(W * 0.5), Math.round(H * 0.597)), pressed: pixel(exported, 3, Math.round(W * 0.5), Math.round(H * 0.597)) };
    check('the export composites the graphic over the video with transparency', near(result.export.corner, [31, 170, 89], 12) && red(result.export.button));
    check('the export shows the animation: the button is pressed later', near(result.export.pressed, [58, 58, 58], 14));
    await q('[...document.querySelectorAll(".modal-backdrop button")].find(b=>b.textContent.trim()==="OK")?.click()');

    // 2. edit_graphic and errors.
    const edited = await tool('edit_graphic', { clip_id: added.clip_id, inputs: { color: '#1e88e5', label: 'FOLLOW' } });
    const after = await q(`(()=>{const p=window.__fve.rawProject(),c=p.overlayClips.find(x=>x.id===${JSON.stringify(added.clip_id)});return {media:p.media.find(x=>x.id===c.mediaId)?.graphic?.inputs,count:p.media.filter(m=>m.graphic).length}})()`);
    result.edit = { ok: edited.ok, error: edited.error, inputs: after.media, graphics_in_library: after.count };
    check('edit_graphic re-renders in place with merged inputs and drops the old render', edited.ok && after.media.color === '#1e88e5' && after.media.pressAt === 1.5 && after.count === 1);
    const broken = await tool('add_graphic', { code: 'export default function render({ inputs, kit }) {\n  const rows = inputs.data;\n  return kit.svg`<svg>${rows.map(r => r.x)}</svg>`;\n}', duration_sec: 1 });
    result.broken = broken.error;
    check('a broken component returns a readable error with its line', /Frame 0: .*rows|undefined/.test(broken.error || '') && /component line 3/.test(broken.error || ''));

    // 3. A graphic is a graphic in the editor, not a plain video.
    const tree = await q('(()=>{const n=[...document.querySelectorAll(".mt-node")].find(b=>b.textContent.startsWith("Graphics"));return n?n.querySelector(".mt-count").textContent:null})()');
    const badge = await q('[...document.querySelectorAll(".asset")].some(a=>a.querySelector(".asset-badge.graphic")&&a.textContent.includes("Subscribe button"))');
    check('the media library lists it under Graphics, with a Graphic badge', tree === '1' && badge);
    const before3 = await q('(()=>{const p=window.__fve.rawProject();return {main:p.videoClips.length,overlay:p.overlayClips.length,past:window.__fve.history().past.length}})()');
    await q('document.querySelector("button[aria-label=\'Add Subscribe button to the timeline\']").click()'); await wait(300);
    const added3 = await q('(()=>{const p=window.__fve.rawProject(),c=p.overlayClips.at(-1);return {main:p.videoClips.length,overlay:p.overlayClips.length,scale:c.transform?.scale}})()');
    result.libraryAdd = { before3, added3 };
    check('"+ Add" puts a graphic over the whole frame, never on the main track', added3.main === before3.main && added3.overlay === before3.overlay + 1 && added3.scale === 1);
    await q('window.__fve.dispatch({type:"undo"})'); await wait(200);

    // The inspector's Graphic tab: its own fields; Update draws it again as one Undo step.
    await q(`window.__fve.select({ track: 'overlay', id: ${JSON.stringify(added.clip_id)} })`);
    await until('!!document.querySelector(".graphic-panel")');
    const panel = await q('(()=>({tab:document.querySelector(".ci-tabs button[aria-selected=true]")?.textContent,fields:[...document.querySelectorAll(".graphic-field > span")].map(s=>s.textContent)}))()');
    result.panel = panel;
    await wait(400); fs.writeFileSync(path.join(dir, 'inspector-graphic.png'), (await win.capturePage()).toPNG());
    check('selecting the graphic opens its Graphic tab with the fields it declares', panel.tab === 'Graphic' && ['Label', 'Color', 'Press At', 'Duration (s)'].every(f => panel.fields.includes(f)));
    const pastBefore = await q('window.__fve.history().past.length');
    await q('(()=>{const e=document.querySelector("input[aria-label=Label]");Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(e,"JOIN");e.dispatchEvent(new Event("input",{bubbles:true}));})()');
    await until(`(()=>{const p=window.__fve.rawProject(),c=p.overlayClips.find(x=>x.id===${JSON.stringify(added.clip_id)});return p.media.find(m=>m.id===c.mediaId)?.graphic?.inputs?.label==='JOIN'})()`, 60000);
    const pastAfter = await q('window.__fve.history().past.length');
    await q('window.__fve.dispatch({type:"undo"})'); await wait(300);
    const undone = await q(`(()=>{const p=window.__fve.rawProject(),c=p.overlayClips.find(x=>x.id===${JSON.stringify(added.clip_id)});return p.media.find(m=>m.id===c.mediaId)?.graphic?.inputs?.label})()`);
    result.inspector = { pastBefore, pastAfter, undone };
    check('editing automatically re-draws the graphic in place, as one Undo step', pastAfter === pastBefore + 1 && undone === 'FOLLOW');

    // Graphics follow the canvas: a new resolution draws them again at the new size.
    await q('window.__fve.dispatch({type:"setProject",patch:{width:720,height:1280}})');
    await until('window.__fve.rawProject().media.filter(m=>m.graphic).every(m=>m.width===720&&m.height===1280)', 60000);
    check('changing the resolution re-draws the graphic at the new size', true);
    // Lost cached files are drawn again when the project opens.
    const lost = await q('(()=>{const m=window.__fve.rawProject().media.find(m=>m.graphic);return {path:m.path,proxy:m.proxy}})()');
    fs.rmSync(path.dirname(lost.path), { recursive: true, force: true });
    await q('window.__fve.load(window.__fve.rawProject())');
    await until(`window.__fve.rawProject().media.filter(m=>m.graphic).length===1`, 10000);
    const deadline = Date.now() + 60000; let restored = null;
    while (Date.now() < deadline) { restored = await q('(()=>{const m=window.__fve.rawProject().media.find(m=>m.graphic);return {path:m.path,proxy:m.proxy}})()'); if (fs.existsSync(restored.path) && fs.existsSync(restored.proxy)) break; await wait(300); }
    result.restored = { lost, restored, exists: fs.existsSync(restored.path) && fs.existsSync(restored.proxy) };
    check('a graphic whose cached files are gone is drawn again on open', result.restored.exists);

    // 4. The original request: an animated chart of US state populations on an empty project.
    await q(`window.__fve.load(${JSON.stringify({ ...fixture, id: 'graphics-empty', media: [], videoClips: [] })})`); await wait(400);
    const chart = await tool('add_graphic', { code: examples.chart, fonts: ['Montserrat 700', 'Montserrat 800', 'Montserrat 900'], duration_sec: 5, name: 'US state populations',
      inputs: { title: 'Most populous US states (2024)', data: [{ label: 'California', value: 39.4 }, { label: 'Texas', value: 31.3 }, { label: 'Florida', value: 23.4 }, { label: 'New York', value: 19.9 }, { label: 'Pennsylvania', value: 13.1 }] } });
    result.chart = { ok: chart.ok, error: chart.error, render_ms: chart.render_ms, duration: chart.duration_sec };
    check('an animated chart on an empty project renders and the timeline covers it', chart.ok && chart.duration_sec >= 5 - 1e-6);
    check('the reference chart passes its own design checks', !chart.design_warnings);

    // 5. The graphic CraftAI first wrote for that request: Inter (bundled as "Inter Variable") must
    // resolve, and the render must report what made it weak.
    const first = JSON.parse(fs.readFileSync(path.join(__dirname, '../fixtures/graphics/agentPopulationTable.json'), 'utf8'));
    const table = await tool('add_graphic', { code: fs.readFileSync(path.join(__dirname, '../fixtures/graphics/agentPopulationTable.js'), 'utf8'), inputs: first.inputs, fonts: first.fonts, duration_sec: first.duration_sec, name: 'Agent table' });
    result.table = { ok: table.ok, error: table.error, design_warnings: table.design_warnings, render_ms: table.render_ms };
    check('Inter resolves, and the weak first chart gets design warnings (small text, still pages, length)', table.ok && table.design_warnings?.length === 3);
    const unknown = await tool('add_graphic', { code: examples.chart, fonts: ['Comic Neue 700'], duration_sec: 2 });
    result.unknown_font = unknown.error;
    check('a font that is not bundled is refused with the available families', /Fonts not bundled: Comic Neue 700/.test(unknown.error || '') && /Montserrat/.test(unknown.error || ''));
    await q('window.__fve.seek(6)'); await wait(1200);
    fs.writeFileSync(path.join(dir, 'preview-table.png'), (await win.capturePage()).toPNG());
    await q('window.__fve.seek(3.5)'); await wait(1200);
    fs.writeFileSync(path.join(dir, 'preview-chart.png'), (await win.capturePage()).toPNG());
    // 6. The cache in Settings > Performance: its size, and Clear keeping what the open project uses.
    const graphicsRoot = path.join(dir, 'graphics');
    const cacheDirs = () => fs.readdirSync(graphicsRoot).filter((n) => !n.includes('.part-'));
    const cacheBefore = cacheDirs();
    const used = await q('window.__fve.rawProject().media.filter(m=>m.graphic).map(m=>m.graphic.key)');
    await wait(300); // the in-use report is sent from an effect
    await q('document.querySelector(".topbar button[aria-label=Settings]").click()');
    await until('[...document.querySelectorAll(".set2-rail button")].some(b=>b.textContent.trim()==="Performance")');
    await q('[...document.querySelectorAll(".set2-rail button")].find(b=>b.textContent.trim()==="Performance").click()');
    await until('!!document.querySelector(\'[aria-label="Motion graphics cache size"]\')');
    const shown = await q('document.querySelector(\'[aria-label="Motion graphics cache size"]\').textContent');
    result.cache = { before: cacheBefore.length, used, shown };
    check('Settings show the motion graphics cache size', new RegExp(`^${cacheBefore.length} graphics · `).test(shown));
    await q('[...document.querySelectorAll(".set2-pane button")].find(b=>b.textContent.trim()==="Clear").click()');
    await until(`!document.querySelector('[aria-label="Motion graphics cache size"]').textContent.startsWith(${JSON.stringify(shown.split(' ·')[0])})`);
    const cacheAfter = cacheDirs();
    result.cache.after = cacheAfter.length;
    check('Clear removes graphics no open project uses and keeps the open project\'s', used.length > 0 && used.every((k) => cacheAfter.includes(k)) && cacheAfter.length === new Set(used).size && cacheBefore.length > cacheAfter.length);
    fs.writeFileSync(path.join(dir, 'settings-graphics-cache.png'), (await win.capturePage()).toPNG());
    await q('document.querySelector(\'button[aria-label="Close settings"]\').click()');

    // 7. Arbitrary component settings, edited through real controls without calling the agent.
    // Measure the rendered pixels as well as saved inputs: a control that merely saves a value
    // but does not alter the animation must not pass.
    await q(`window.__fve.load(${JSON.stringify({ ...fixture, id: 'editable-graphic', width: 360, height: 360, ratio: '1:1' })})`); await wait(300);
    const orbit = await tool('add_graphic', { code: fs.readFileSync(path.join(__dirname, '../fixtures/graphics/editableOrbit.js'), 'utf8'), duration_sec: 2, name: 'Editable orbit' });
    check('a new component declares arbitrary editable settings', orbit.ok && orbit.editable_inputs?.rate?.unit === 'turns/s');
    await q(`window.__fve.select({ track: 'overlay', id: ${JSON.stringify(orbit.clip_id)} })`);
    await until('!!document.querySelector(\'input[aria-label="Orbit rate"]\')');
    const settings = await q(`(()=>{const e=document.querySelector('input[aria-label="Orbit rate"]');return {
      min:e.min,max:e.max,step:e.step,slider:!!document.querySelector('input[aria-label="Orbit rate slider"]'),
      groups:[...document.querySelectorAll('.graphic-group legend')].map(e=>e.textContent),
      help:document.querySelector('.graphic-panel').textContent.includes('Changes the rotation rate, not the clip length.'),
      choices:[...document.querySelector('select[aria-label="Direction"]').options].map(o=>o.textContent)
    }})()`);
    check('schema metadata creates bounded sliders, exact values, groups, hints and choices', settings.min === '0.25' && settings.max === '4' && settings.step === '0.25' && settings.slider && settings.help && settings.groups.join(',') === 'Motion,Appearance,Advanced' && settings.choices.join(',') === 'Clockwise,Counterclockwise');
    const readOrbit = () => q(`(()=>{const p=window.__fve.rawProject(),c=p.overlayClips.find(c=>c.id===${JSON.stringify(orbit.clip_id)}),m=p.media.find(m=>m.id===c.mediaId);return {clip:c,media:m}})()`);
    const originalOrbit = await readOrbit();
    check('the original rate renders a dot at its expected position', red(pixel(originalOrbit.media.path, .25, 180, 240)));
    const changeField = (label, value, tag = 'input') => q(`(()=>{const e=document.querySelector(${JSON.stringify(`${tag}[aria-label="${label}"]`)});
      Object.getOwnPropertyDescriptor(${tag === 'textarea' ? 'HTMLTextAreaElement' : tag === 'select' ? 'HTMLSelectElement' : 'HTMLInputElement'}.prototype,'value').set.call(e,${JSON.stringify(String(value))});
      e.dispatchEvent(new Event(${JSON.stringify(tag === 'select' ? 'change' : 'input')},{bubbles:true}));})()`);
    await changeField('Orbit rate', 8);
    check('out-of-range values cannot start a render', await q('!window.__fve.rawProject().overlayClips.some(c=>c.graphicDraft?.inputs?.rate===8) && document.querySelector(".graphic-panel").textContent.includes("Use 4 or less.")'));
    await changeField('Orbit rate', 2);
    await changeField('Geometry', '{', 'textarea');
    check('invalid JSON is identified without applying it', await q('document.querySelector(".graphic-panel").textContent.includes("Enter valid JSON.")'));
    await q('[...document.querySelectorAll(".graphic-actions button")].find(b=>b.textContent.trim()==="Reset").click()');
    check('Reset restores numeric and JSON drafts', await q('document.querySelector(\'input[aria-label="Orbit rate"]\').value === "1" && JSON.parse(document.querySelector(\'textarea[aria-label="Geometry"]\').value).radius === 60 && !document.querySelector(".graphic-json.bad")'));
    await q('window.__fve.seek(.25)');
    await q('document.querySelector(\'input[aria-label="Orbit rate slider"]\').dispatchEvent(new PointerEvent("pointerdown",{bubbles:true}))');
    await changeField('Orbit rate slider', 2);
    await until('document.querySelector("[data-live-graphic]")?.dataset.ready === "true"');
    const liveSession = await q('document.querySelector("[data-live-graphic]").dataset.session');
    const liveTimings = await q(`(async()=>{
      const times=[],e=document.querySelector('input[aria-label="Orbit rate slider"]');
      for(const value of [1.25,1.5,1.75,2.25,2]){
        const image=document.querySelector('[data-live-graphic]'),old=image.src,start=performance.now();
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,String(value));e.dispatchEvent(new Event('input',{bubbles:true}));
        await new Promise((resolve,reject)=>{const tick=()=>{if(image.src!==old&&image.complete)return resolve();if(performance.now()-start>5000)return reject(Error('Live frame did not change'));requestAnimationFrame(tick)};tick()});
        times.push(performance.now()-start);
      }
      return times;
    })()`);
    check('slider changes reuse one live sandbox before the full render finishes', await q('document.querySelector("[data-live-graphic]").dataset.session') === liveSession && (await readOrbit()).media.path === originalOrbit.media.path);
    check('controls remain usable during live preview, with no Update button', await q('!document.querySelector(\'input[aria-label="Orbit rate"]\').disabled && ![...document.querySelectorAll(".graphic-actions button")].some(b=>b.textContent.includes("Update graphic"))'));
    // Scrubbing/playing use the same source clock, not a separate animation clock.
    await q('window.__fve.play()');
    await until('Number(document.querySelector("[data-live-graphic]")?.dataset.frame) > 12');
    await q('window.__fve.pause()'); await q('window.__fve.seek(.25)');
    await changeField('Direction', 1, 'select'); // second option = numeric -1, not a string
    await changeField('Center X', .6);
    await changeField('Accent value', '#00ccff');
    await changeField('Note', 'Changed locally');
    await q('document.querySelector(\'input[aria-label="Show Track"]\').click()');
    const orbitPast = await q('window.__fve.history().past.length');
    const pendingOrbit = await q('window.__fve.rawProject()');
    await q('window.dispatchEvent(new PointerEvent("pointerup"))');
    await until(`(()=>{const p=window.__fve.rawProject(),c=p.overlayClips.find(c=>c.id===${JSON.stringify(orbit.clip_id)});return p.media.find(m=>m.id===c.mediaId)?.graphic?.inputs?.rate===2})()`, 60000);
    const updatedOrbit = await readOrbit(), values = updatedOrbit.media.graphic.inputs;
    result.editable = { settings, inputs: values, liveSession, liveTimings, original: originalOrbit.media.path, updated: updatedOrbit.media.path,
      dot: pixel(updatedOrbit.media.path, .25, 156, 180), oldDot: pixel(updatedOrbit.media.path, .25, 180, 240) };
    check('local edits keep numeric choice types, coordinates, colours, toggles and text', values.rate === 2 && values.direction === -1 && values.center.x === .6 && values.accent === '#00ccff' && !values.showTrack && values.note === 'Changed locally');
    check('rate and direction change the actual animation without changing clip duration', near(result.editable.dot, [0, 204, 255], 8) && !red(result.editable.oldDot) && updatedOrbit.clip.out - updatedOrbit.clip.in === 2);
    check('multiple field edits apply in one undo step', await q('window.__fve.history().past.length') === orbitPast + 1);
    await q('window.__fve.seek(.25)'); await wait(700);
    fs.writeFileSync(path.join(dir, 'inspector-editable.png'), (await win.capturePage()).toPNG());
    await q('window.__fve.dispatch({type:"undo"})'); await wait(200);
    check('Undo restores the previous render and displayed settings', (await readOrbit()).media.path === originalOrbit.media.path && await q('document.querySelector(\'input[aria-label="Orbit rate"]\').value === "1"'));
    await q('window.__fve.dispatch({type:"redo"})'); await wait(200);
    const savedOrbit = await q('window.__fve.rawProject()');
    await q(`window.__fve.load(${JSON.stringify(savedOrbit)})`); await wait(300);
    await q(`window.__fve.select({ track: 'overlay', id: ${JSON.stringify(orbit.clip_id)} })`);
    await until('document.querySelector(\'input[aria-label="Orbit rate"]\')?.value === "2"');
    check('reopening preserves edited values and their control declarations', (await readOrbit()).media.graphic.schema.rate.max === 4);

    // Export immediately after an edit, before its debounce/bake has finished.
    await changeField('Orbit rate', .5);
    await until('window.__fve.rawProject().overlayClips.some(c=>c.graphicDraft?.inputs?.rate===.5)');
    await q('window.__fve.exportNow()');
    await until('!!document.querySelector(".modal-icon.ok")', 120000);
    const flushedOrbit = await readOrbit();
    check('export waits for the newest graphic settings', !flushedOrbit.clip.graphicDraft && flushedOrbit.media.graphic.inputs.rate === .5 && near(pixel(path.join(dir, 'ui-export.mp4'), .25, 258, 138), [0, 204, 255], 20));
    await q('[...document.querySelectorAll(".modal-backdrop button")].find(b=>b.textContent.trim()==="OK")?.click()');
    await q(`window.__fve.load(${JSON.stringify(pendingOrbit)})`);
    await until('window.__fve.rawProject().overlayClips.every(c=>!c.graphicDraft)', 60000);
    check('reopening a saved pending edit automatically prepares its full-quality media', (await readOrbit()).media.graphic.inputs.rate === 2);

    // A portrait HD chart with embedded fonts exercises a more representative live frame path.
    result.liveHD = await q(`(async()=>{
      const { resolveGraphicFonts }=await import('/src/features/graphics/graphicFonts.js');
      const { GRAPHICS_EXAMPLES }=await import('/src/features/agent/graphicsGuide.js');
      const fonts=await resolveGraphicFonts(['Montserrat 700','Montserrat 800','Montserrat 900']),owner='live-hd-check';
      const opened=await window.api.openLiveGraphic({owner,code:GRAPHICS_EXAMPLES.chart,fonts:fonts.fonts,inputs:{},width:1080,height:1920,fps:30,duration_sec:5});
      if(opened.error)throw Error(opened.error);
      try{
        const samples=[];let last;
        for(const frame of [12,18,24,30,36,42,48,54]){
          const t=performance.now(),out=await window.api.drawLiveGraphic({owner,frame,frames:150,inputs:{},side:960});
          if(out.error)throw Error(out.error);
          samples.push({frame,round_trip_ms:performance.now()-t,render_ms:out.render_ms,session:out.session});last=out;
        }
        const img=new Image();img.src=last.image;await img.decode();const cv=document.createElement('canvas');cv.width=img.width;cv.height=img.height;
        const ctx=cv.getContext('2d');ctx.drawImage(img,0,0);
        return {logical:[1080,1920],raster:[last.width,last.height],samples,corner:[...ctx.getImageData(0,0,1,1).data]};
      }finally{await window.api.closeLiveGraphic(owner);}
    })()`);
    check('HD live preview reuses its sandbox, caps raster size and preserves transparency', new Set(result.liveHD.samples.map(s=>s.session)).size === 1 && result.liveHD.raster.join('x') === '540x960' && result.liveHD.corner[3] === 0);

    // 8. Library pictures inside a graphic: the project keeps the media id, the picture travels
    // prepared to the sandbox, the inspector picks it, and it shows in the preview and the export.
    const photo = path.join(dir, 'photo.jpg'), blue = path.join(dir, 'blue.png');
    execFileSync(ff.ffmpegPath, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=0xd400d4:s=3200x2400', '-frames:v', '1', '-q:v', '2', photo]);
    execFileSync(ff.ffmpegPath, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=0x1e5bd4:s=800x800', '-frames:v', '1', '-c:v', 'png', blue]);
    const withPictures = { ...fixture, id: 'graphics-pictures', media: [...fixture.media, { ...await ff.probe(photo), id: 'pic', name: 'photo.jpg', path: photo }, { ...await ff.probe(blue), id: 'pic2', name: 'blue.png', path: blue }] };
    await q(`window.__fve.load(${JSON.stringify(withPictures)})`); await wait(400);
    const toolkit = await tool('graphics_guide', { topic: 'toolkit' });
    check('the toolkit lists the library pictures the agent may use, by media id', toolkit.pictures_available?.map(p => `${p.media_id}:${p.name}`).join(',') === 'pic:photo.jpg,pic2:blue.png' && /kit\.image\(/.test(toolkit.text));
    const t1 = Date.now();
    const card = await tool('add_graphic', { code: examples.photo_card, inputs: { photo: 'pic', caption: 'Rabat' }, fonts: ['Montserrat 700'], duration_sec: 3, name: 'Photo card' });
    result.card = { ...card, frames: card.frames?.length, ms: Date.now() - t1 };
    check('a graphic shows a library picture, declared as an image input, with no design warnings', card.ok && card.editable_inputs?.photo?.type === 'image' && !card.design_warnings);
    const readCard = () => q(`(()=>{const p=window.__fve.rawProject(),c=p.overlayClips.find(c=>c.id===${JSON.stringify(card.clip_id)}),m=p.media.find(m=>m.id===c.mediaId);return {clip:c,media:m,size:JSON.stringify(m.graphic).length}})()`);
    const cardMedia = await readCard();
    check('the project keeps the picture by media id, never its bytes', cardMedia.media.graphic.inputs.photo === 'pic' && cardMedia.size < 20000);
    const meta = JSON.parse(fs.readFileSync(path.join(dir, 'graphics', cardMedia.media.graphic.key, 'meta.json'), 'utf8')).stats;
    result.cardStats = { frames: meta.frames, repeated: meta.repeated, render_ms: meta.render_ms, raster_ms: meta.raster_ms, total_ms: meta.total_ms, per_frame_raster_ms: meta.raster_ms / Math.max(1, meta.frames - meta.repeated) };
    check('frames carrying a canvas-size picture rasterise well inside the frame budget', result.cardStats.per_frame_raster_ms < 100);
    // Where the picture is: the card is 0.62 of the width, 4:3, centred on (0.5, 0.45).
    const px = Math.round(W * 0.5), py = Math.round(H * 0.45);
    const magenta = ([r, g, b]) => r > 150 && b > 150 && g < 90, blueish = ([r, g, b]) => b > 150 && r < 90 && g < 130;
    check('the rendered graphic carries the picture (the magenta photo at its centre)', magenta(pixel(cardMedia.media.path, 2, px, py)));
    await q('window.__fve.seek(2)'); await wait(1200);
    const shot2 = await win.capturePage(); fs.writeFileSync(path.join(dir, 'preview-photo-card.png'), shot2.toPNG());
    const stage2 = await q('(()=>{const r=document.querySelector(".stage").getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height}})()');
    const sample2 = (fx, fy) => { const img = shot2.crop({ x: Math.round((stage2.x + stage2.w * fx) * scale), y: Math.round((stage2.y + stage2.h * fy) * scale), width: 1, height: 1 }).toBitmap(); return [img[2], img[1], img[0]]; };
    result.cardPreview = { photo: sample2(0.5, 0.45), corner: sample2(0.1, 0.1) };
    check('the preview shows the picture inside the graphic, over the video', magenta(result.cardPreview.photo) && green(result.cardPreview.corner));
    await q('window.__fve.exportNow()'); await until('!!document.querySelector(".modal-icon.ok")', 120000);
    result.cardExport = pixel(path.join(dir, 'ui-export.mp4'), 2, px, py);
    check('the export shows the picture inside the graphic', magenta(result.cardExport));
    await q('[...document.querySelectorAll(".modal-backdrop button")].find(b=>b.textContent.trim()==="OK")?.click()');
    // The inspector: a picker of the library's pictures; choosing another one re-draws the graphic.
    await q(`window.__fve.select({ track: 'overlay', id: ${JSON.stringify(card.clip_id)} })`);
    await until('!!document.querySelector(\'select[aria-label="Picture"]\')');
    const picker = await q('[...document.querySelector(\'select[aria-label="Picture"]\').options].map(o=>o.textContent+"="+o.value)');
    check('the Graphic tab offers the library pictures by name', picker.join(',') === 'None=,photo.jpg=pic,blue.png=pic2' && await q('document.querySelector(\'select[aria-label="Picture"]\').value') === 'pic');
    const cardPast = await q('window.__fve.history().past.length');
    await changeField('Picture', 'pic2', 'select');
    await until(`(()=>{const p=window.__fve.rawProject(),c=p.overlayClips.find(c=>c.id===${JSON.stringify(card.clip_id)});return p.media.find(m=>m.id===c.mediaId)?.graphic?.inputs?.photo==='pic2'})()`, 60000);
    const swapped = await readCard();
    result.cardSwap = { past: [cardPast, await q('window.__fve.history().past.length')], pixel: pixel(swapped.media.path, 2, px, py) };
    check('choosing another picture re-draws the graphic with it, as one Undo step', blueish(result.cardSwap.pixel) && result.cardSwap.past[1] === cardPast + 1 && swapped.media.path !== cardMedia.media.path);
    await wait(500); fs.writeFileSync(path.join(dir, 'inspector-photo-card.png'), (await win.capturePage()).toPNG());
    await changeField('Picture', '', 'select');
    await until(`(()=>{const p=window.__fve.rawProject(),c=p.overlayClips.find(c=>c.id===${JSON.stringify(card.clip_id)});return p.media.find(m=>m.id===c.mediaId)?.graphic?.inputs?.photo===''})()`, 60000);
    result.cardNone = pixel((await readCard()).media.path, 2, px, py);
    check('without a picture the component draws its placeholder', near(result.cardNone, [51, 65, 85], 12));
    await wait(200);
    check('live graphics sandboxes are released after editing', require('electron').BrowserWindow.getAllWindows().length === 1);
    check('no renderer exceptions', !result.errors.length);
  } catch (error) { result.error = error.stack; try { fs.writeFileSync(path.join(dir, 'failure.png'), (await win.capturePage()).toPNG()); } catch {} }
  fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify(result, null, 2)); app.exit(result.error ? 1 : 0);
};
