// Agent evaluation: run CraftAI on real footage with a real provider, score the
// result, and compare runs. Each case gets an isolated Electron profile.
//
//   node scripts/agent-eval.cjs --cases cases.json [--out dir] [--compare old/summary.json]
//                               [--provider codex-sdk] [--model id] [--use-my-ai-settings] [--build]
//   node scripts/agent-eval.cjs --make-sample <dir>   (macOS: synthesizes a talking-head case with `say`)
//
// cases.json: [{ id, brief, media: [absolute paths], platform?, language?, provider?, model?,
//   approve_plan? (default true), follow_ups?: [text], timeout_sec?, speech_metrics? (default true),
//   expect?: { ratio, min_duration_sec, max_duration_sec, target_duration_sec, captions, hook_title,
//              music, max_fillers, max_retakes, min_score, plan_proposed } }]
// Real provider runs use the account behind that provider; nothing is pushed or uploaded by this script.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), net = require('node:net');
const { spawn, execFileSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const args = process.argv.slice(2);
const opt = name => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const flag = name => args.includes(`--${name}`);

function makeSample(dir) {
  if (process.platform !== 'darwin') throw Error('--make-sample uses the macOS `say` voice. Provide your own footage elsewhere.');
  const { ffmpegPath } = require('../electron/media/ffmpeg.cjs');
  fs.mkdirSync(dir, { recursive: true });
  // A rambling take with hesitations, a false start and long pauses: the raw
  // material a good edit should tighten into a short.
  const script = [
    'So, um, hi everyone. Today I want to, uh, talk about editing.', '[[slnc 1600]]',
    'The biggest mistake is... The biggest mistake most people make is a slow start.', '[[slnc 1200]]',
    'Why do most videos lose viewers in the first three seconds?', '[[slnc 900]]',
    'Because, um, they open with a long, uh, introduction instead of the point.', '[[slnc 2000]]',
    'So here is the fix. Start with your strongest line, cut every pause, and, uh, add captions.', '[[slnc 1000]]',
    'Try it on your next video and, um, you will see the difference.',
  ].join(' ');
  const aiff = path.join(dir, 'voice.aiff'), video = path.join(dir, 'talking-head.mp4');
  execFileSync('say', ['-o', aiff, script]);
  execFileSync(ffmpegPath, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=30', '-i', aiff,
    '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'veryfast', '-c:a', 'aac', '-b:a', '128k', video]);
  const cases = [{ id: 'sample-talking-short', platform: 'tiktok', language: 'en', media: [video],
    brief: 'Turn this into a tight 9:16 short for TikTok: open on the strongest line, remove the ums, false starts and pauses, add captions and a hook title.',
    expect: { ratio: '9:16', max_duration_sec: 40, captions: true, hook_title: true, max_fillers: 1, max_retakes: 0, plan_proposed: true } }];
  fs.writeFileSync(path.join(dir, 'cases.json'), JSON.stringify(cases, null, 2));
  console.log(`Sample footage: ${video}\nCases: ${path.join(dir, 'cases.json')}`);
}

// Score a finished run from its saved project, transcript and loudness.
async function scoreRun(dir, res, testCase) {
  const load = file => import(require('node:url').pathToFileURL(path.join(root, file)).href);
  const [{ scoreEvalCase, toolProfile }, { transcriptWords }] = await Promise.all([load('src/features/agent/evalScore.js'), load('src/features/agent/editorial.js')]);
  const project = JSON.parse(fs.readFileSync(path.join(dir, 'final-project.json'), 'utf8')), steps = res.step_list || [];
  const words = Array.isArray(res.final_segments) ? transcriptWords(res.final_segments) : null;
  return { ...scoreEvalCase(project, { words, loudness: res.loudness || null, expect: testCase.expect || {}, steps, platform: testCase.platform }), tools: toolProfile(steps), steps: steps.length };
}

const freePort = () => new Promise(resolve => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });

async function runCases() {
  const casesFile = opt('cases');
  if (!casesFile) throw Error('Give --cases <file>, or --make-sample <dir> to create one.');
  const cases = JSON.parse(fs.readFileSync(casesFile, 'utf8'));
  if (!Array.isArray(cases) || !cases.length) throw Error('The cases file must be a non-empty array.');
  for (const c of cases) {
    if (!c.id || !c.brief || !Array.isArray(c.media) || !c.media.length) throw Error(`Case ${c.id || '?'} needs id, brief and media.`);
    for (const file of c.media) if (!fs.existsSync(file)) throw Error(`Case ${c.id}: missing media ${file}`);
  }
  if (flag('build') || !fs.existsSync(path.join(root, 'dist', 'index.html'))) execFileSync(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), 'build'], { cwd: root, stdio: 'inherit' });
  const out = path.resolve(opt('out') || fs.mkdtempSync(path.join(os.tmpdir(), 'clipcraft-eval-')));
  fs.mkdirSync(out, { recursive: true });
  // AI settings: the user's provider/model choice (and its locally encrypted
  // keys) only when asked; SDK providers need no key.
  const userData = process.platform === 'darwin' ? path.join(os.homedir(), 'Library/Application Support/ClipCraft')
    : process.platform === 'win32' ? path.join(process.env.APPDATA || '', 'ClipCraft') : path.join(os.homedir(), '.config/ClipCraft');
  let ai = null;
  if (flag('use-my-ai-settings')) ai = JSON.parse(fs.readFileSync(path.join(userData, 'settings.json'), 'utf8')).ai || null;
  // Reuse the installed speech model instead of downloading it into every case profile.
  const model = path.join(userData, 'whisper', 'ggml-base.bin');
  const port = await freePort(), url = `http://127.0.0.1:${port}`;
  const viteLog = fs.openSync(path.join(out, 'vite.log'), 'w');
  const vite = spawn(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: root, stdio: ['ignore', viteLog, viteLog] });
  const results = [];
  try {
    for (let i = 0; i < 100; i++) { try { if ((await fetch(url)).ok) break; } catch {} await new Promise(r => setTimeout(r, 100)); }
    for (const c of cases) {
      const dir = path.join(out, c.id.replace(/[^\w.-]+/g, '_'));
      fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(path.join(dir, 'settings-test'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'settings-test/settings.json'), JSON.stringify({ firstRun: { tourSeen: true, packPromptSeen: true }, ...(ai ? { ai } : {}) }));
      if (fs.existsSync(model)) { fs.mkdirSync(path.join(dir, 'whisper-test'), { recursive: true }); fs.symlinkSync(model, path.join(dir, 'whisper-test', 'ggml-base.bin')); }
      const caseFile = path.join(dir, 'case.json');
      fs.writeFileSync(caseFile, JSON.stringify({ ...c, provider: opt('provider') || c.provider, model: opt('model') || c.model }));
      console.log(`▶ ${c.id}`);
      const log = fs.openSync(path.join(dir, 'runtime.log'), 'w');
      const electron = spawn(require('electron'), ['--no-sandbox', root], { cwd: root, stdio: ['ignore', log, log],
        env: { ...process.env, FVE_SMOKE: dir, FVE_SMOKE_MODE: 'agent-eval', FVE_EVAL_CASE: caseFile, VITE_DEV_SERVER_URL: url } });
      const limit = ((c.timeout_sec || 900) * (2 + (c.follow_ups?.length || 0)) + 180) * 1000;
      await new Promise(resolve => { const timer = setTimeout(() => { electron.kill('SIGKILL'); resolve(); }, limit); electron.once('exit', () => { clearTimeout(timer); resolve(); }); });
      fs.closeSync(log);
      const file = path.join(dir, 'result.json');
      const res = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { id: c.id, error: 'The run produced no result (timeout or crash). See runtime.log.' };
      if (!res.error && fs.existsSync(path.join(dir, 'final-project.json'))) Object.assign(res, await scoreRun(dir, res, c));
      fs.writeFileSync(file, JSON.stringify(res, null, 2));
      results.push({ ...res, dir });
      console.log(res.error ? `  ✗ ${res.error.split('\n')[0]}` : `  score ${res.score} (critique ${res.critique_score}, expectations ${res.expectations_passed}/${res.expectations_total}) · ${res.seconds}s · ${res.steps} steps`);
    }
  } finally { vite.kill(); fs.closeSync(viteLog); }
  const scored = results.filter(r => Number.isFinite(r.score));
  const summary = { created: new Date().toISOString(), out, mean_score: scored.length ? Math.round(scored.reduce((n, r) => n + r.score, 0) / scored.length * 10) / 10 : null,
    cases: results.map(r => ({ id: r.id, score: r.score ?? null, critique_score: r.critique_score ?? null, expectations: r.expectations_total ? `${r.expectations_passed}/${r.expectations_total}` : null,
      seconds: r.seconds ?? null, steps: r.steps ?? null, provider: r.provider, model: r.model, error: r.error ? r.error.split('\n')[0] : undefined, failed_checks: (r.checks || []).filter(c => !c.pass).map(c => c.name), dir: r.dir })) };
  fs.writeFileSync(path.join(out, 'summary.json'), JSON.stringify(summary, null, 2));
  console.log(`\nMean score: ${summary.mean_score ?? 'n/a'} · summary: ${path.join(out, 'summary.json')}`);
  const previous = opt('compare');
  if (previous) {
    const { compareRuns } = await import(require('node:url').pathToFileURL(path.join(root, 'src/features/agent/evalScore.js')).href);
    for (const row of compareRuns(summary, JSON.parse(fs.readFileSync(previous, 'utf8'))))
      console.log(`${row.id}: ${row.previous ?? '—'} → ${row.score ?? '—'}${row.delta === null ? '' : ` (${row.delta >= 0 ? '+' : ''}${row.delta})`}`);
  }
  if (results.some(r => r.error)) process.exitCode = 1;
}

(async () => {
  if (opt('make-sample')) return makeSample(path.resolve(opt('make-sample')));
  await runCases();
})().catch(error => { console.error(error.message || error); process.exitCode = 1; });
