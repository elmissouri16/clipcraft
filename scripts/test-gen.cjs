// AI generation against a fake ElevenLabs: request bodies, the Pro-plan answer, polling, download (the key never
// goes to the storage host), failures and the history list. Usage: node scripts/test-gen.cjs
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const gen = require('../electron/gen.cjs');

const KEY = 'el-test-key-1234';
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'fve-gen-'));
const json = (status, body) => ({ ok: status < 400, status, json: async () => body });

// A fake API: `plan` decides the POST answer, `steps` the successive GET statuses.
function fake({ plan = 'pro', steps = ['generating', 'completed'], fail } = {}) {
  const calls = [];
  let polls = 0;
  const f = async (url, opts = {}) => {
    calls.push({ url, opts });
    if (url.startsWith('https://storage.example/')) {
      return { ok: true, status: 200, arrayBuffer: async () => new Uint8Array(5000).buffer };
    }
    if (opts.headers?.['xi-api-key'] !== KEY) return json(401, { detail: { status: 'invalid_api_key' } });
    if (opts.method === 'POST') {
      if (plan !== 'pro') return json(402, { detail: { type: 'payment_required', code: 'paid_plan_required', message: 'This endpoint requires a Pro plan or above.' } });
      return json(200, { id: 'gen_abc123', status: 'pending' });
    }
    const s = steps[Math.min(polls++, steps.length - 1)];
    if (s === 'failed') return json(200, { id: 'gen_abc123', status: 'failed', failure_reason: fail || 'model_error', error_message: 'boom' });
    if (s === 'completed') {
      const video = url.includes('/flows/video/');
      return json(200, { id: 'gen_abc123', status: 'completed', content_mime_type: video ? 'video/mp4' : 'image/png', content_url: 'https://storage.example/out?sig=1' });
    }
    return json(200, { id: 'gen_abc123', status: s });
  };
  f.calls = calls;
  return f;
}

(async () => {
  // Request bodies.
  const v = gen.buildRequest('video', { prompt: ' a rocket ', model: 'veo-3.1-fast-generate-001', ratio: '9:16', duration: 6, resolution: '1080p', audio: false });
  assert.deepEqual(v, { model_id: 'veo-3.1-fast-generate-001', prompt: 'a rocket', aspect_ratio: '9:16', duration_secs: 6, resolution: '1080p', generate_audio: false });
  const i = gen.buildRequest('image', { prompt: 'a bottle', model: 'gemini-3.1-flash-image', ratio: '4:5', resolution: '2K' });
  assert.deepEqual(i, { model_id: 'gemini-3.1-flash-image', prompt: 'a bottle', aspect_ratio: '4:5', resolution: '2K' });
  assert.equal(gen.buildRequest('image', { prompt: 'x', model: 'gemini-2.5-flash-image', resolution: '2K' }).resolution, undefined);
  assert.equal(gen.buildRequest('video', { prompt: 'x', model: 'veo-3.1-generate-001', duration: 99, ratio: '1:1' }).duration_secs, 8);
  assert.throws(() => gen.buildRequest('video', { prompt: '', model: 'veo-3.1-generate-001' }), /Describe/);
  assert.throws(() => gen.buildRequest('video', { prompt: 'x', model: 'sora' }), /Unknown video model/);
  // Photos become inline frames / references; other files are refused.
  const png = path.join(out, 'ref.png');
  fs.writeFileSync(png, Buffer.from('89504e47', 'hex'));
  const inl = { type: 'inline_base64', content_base64: fs.readFileSync(png).toString('base64'), mime_type: 'image/png' };
  const frames = gen.buildRequest('video', { prompt: 'x', model: 'veo-3.1-generate-001', start: png, end: png });
  assert.deepEqual([frames.start_frame, frames.end_frame], [inl, inl]);
  assert.equal(gen.buildRequest('image', { prompt: 'x', model: 'gemini-2.5-flash-image', refs: [png] }).images.length, 1);
  assert.throws(() => gen.buildRequest('image', { prompt: 'x', model: 'gemini-2.5-flash-image', refs: [path.join(out, 'a.exe')] }), /not supported/);
  assert.throws(() => gen.buildRequest('image', { prompt: 'x', model: 'gemini-2.5-flash-image', refs: [png, png, png, png, png, png] }), /5 reference photos at most/);
  // Veo references carry a role and force 8 seconds; frames and references cannot be mixed.
  const veoRefs = gen.buildRequest('video', { prompt: 'x', model: 'veo-3.1-fast-generate-001', duration: 4, refs: [{ path: png, role: 'style' }, { path: png }] });
  assert.deepEqual(veoRefs.images, [{ image: inl, role: 'style' }, { image: inl, role: 'subject' }]);
  assert.equal(veoRefs.duration_secs, 8);
  assert.throws(() => gen.buildRequest('video', { prompt: 'x', model: 'veo-3.1-generate-001', start: png, refs: [{ path: png }] }), /not both/);
  assert.equal(gen.buildRequest('video', { prompt: 'x', model: 'veo-3.1-generate-001', negative: ' text ' }).negative_prompt, 'text');
  // Seedance: free length within its range, plain image refs, video refs, 2.5 with frames picks the format itself.
  const sd = gen.buildRequest('video', { prompt: 'x', model: 'bytedance-seedance-v2', duration: 40, ratio: '21:9', resolution: '4k', refs: [{ path: png }] });
  assert.deepEqual([sd.duration_secs, sd.aspect_ratio, sd.resolution, sd.images], [15, '21:9', '4k', [inl]]);
  assert.equal(sd.negative_prompt, undefined);
  assert.equal(gen.buildRequest('video', { prompt: 'x', model: 'bytedance-seedance-v2-fast', resolution: '1080p' }).resolution, '720p');
  assert.equal(gen.buildRequest('video', { prompt: 'x', model: 'bytedance-seedance-v2.5', duration: 30, ratio: '9:16', start: png }).aspect_ratio, 'auto');
  const mp4 = path.join(out, 'ref.mp4');
  fs.writeFileSync(mp4, Buffer.alloc(200));
  assert.equal(gen.buildRequest('video', { prompt: 'x', model: 'bytedance-seedance-v2-mini', videoRefs: [mp4] }).videos[0].mime_type, 'video/mp4');
  assert.throws(() => gen.buildRequest('video', { prompt: 'x', model: 'veo-3.1-generate-001', videoRefs: [mp4] }), /does not take reference videos/);
  // Photo models: quality, background and sizes per model.
  const gpt = gen.buildRequest('image', { prompt: 'x', model: 'gpt-image-1', ratio: '16:9', quality: 'high', background: 'transparent' });
  assert.deepEqual(gpt, { model_id: 'gpt-image-1', prompt: 'x', aspect_ratio: '1:1', quality: 'high', background: 'transparent' });
  assert.deepEqual(gen.buildRequest('image', { prompt: 'x', model: 'gpt-image-2.5-sunburst' }), { model_id: 'gpt-image-2.5-sunburst', prompt: 'x', aspect_ratio: '1:1', resolution: '1K', quality: 'high' });
  assert.equal(gen.buildRequest('image', { prompt: 'x', model: 'bytedance-seedream-5-lite' }).resolution, '2K');
  assert.equal(gen.buildRequest('image', { prompt: 'x', model: 'gemini-3-pro-image', resolution: '4K' }).resolution, '4K');
  // Talking avatar: photo + MP3/WAV speech.
  const mp3 = path.join(out, 'say.mp3');
  fs.writeFileSync(mp3, Buffer.alloc(300));
  assert.deepEqual(gen.buildRequest('avatar', { photo: png, audio: mp3, resolution: '480p' }),
    { model_id: 'creatify-aurora', image: inl, audio: { type: 'inline_base64', content_base64: fs.readFileSync(mp3).toString('base64'), mime_type: 'audio/mpeg' }, resolution: '480p' });
  assert.throws(() => gen.buildRequest('avatar', { audio: mp3 }), /photo of the person/);
  assert.throws(() => gen.buildRequest('avatar', { photo: png, audio: path.join(out, 'x.m4a') }), /not supported/);
  console.log('requests ok');

  // Plans.
  assert.equal(gen.isPro('free'), false);
  assert.equal(gen.isPro('Creator'), false);
  assert.equal(gen.isPro('pro'), true);
  assert.equal(gen.isPro(''), null);

  // Free plan: a clear Pro message, no polling.
  const free = fake({ plan: 'free' });
  await assert.rejects(gen.run(free, KEY, out, 'video', { prompt: 'x', model: 'veo-3.1-fast-generate-001' }, { pollMs: 1 }),
    (e) => e.code === 'pro_required' && /Pro plan/.test(e.message));
  assert.equal(free.calls.length, 1);
  await assert.rejects(gen.run(free, '', out, 'video', { prompt: 'x', model: 'veo-3.1-fast-generate-001' }), (e) => e.code === 'no_key');
  await assert.rejects(gen.run(fake(), 'wrong-key-9999', out, 'image', { prompt: 'x', model: 'gemini-2.5-flash-image' }, { pollMs: 1 }),
    (e) => /refused the API key/.test(e.message) && !e.message.includes('wrong-key'));
  console.log('plans ok');

  // Pro plan: POST, poll until completed, download without the key, save with a description.
  const pro = fake();
  const stages = [];
  const res = await gen.run(pro, KEY, out, 'video', { prompt: 'a rocket', model: 'veo-3.1-fast-generate-001' }, { pollMs: 1, onStatus: (s) => stages.push(s) });
  assert.ok(res.path.endsWith('.mp4') && fs.statSync(res.path).size === 5000);
  assert.deepEqual(stages, ['sending', 'pending', 'generating', 'saving']);
  assert.equal(JSON.parse(pro.calls[0].opts.body).model_id, 'veo-3.1-fast-generate-001');
  assert.ok(pro.calls[1].url.endsWith('/flows/video/gen_abc123'));
  const dl = pro.calls.find((c) => c.url.startsWith('https://storage.example/'));
  assert.ok(!dl.opts.headers || !dl.opts.headers['xi-api-key'], 'the key must not go to the storage host');
  const img = await gen.run(fake({ steps: ['completed'] }), KEY, out, 'image', { prompt: 'a bottle', model: 'gemini-2.5-flash-image' }, { pollMs: 1 });
  assert.ok(img.path.endsWith('.png'));
  // A talking avatar goes through the video flow.
  const av = fake({ steps: ['completed'] });
  const talk = await gen.run(av, KEY, out, 'avatar', { photo: png, audio: mp3, label: 'Talking avatar: hi' }, { pollMs: 1 });
  assert.ok(talk.path.endsWith('.mp4') && av.calls[0].url.endsWith('/flows/video') && JSON.parse(av.calls[0].opts.body).model_id === 'creatify-aurora');
  const hist = gen.list(out);
  assert.equal(hist.length, 3);
  assert.deepEqual(hist.map((h) => h.kind).sort(), ['avatar', 'image', 'video']);
  assert.ok(hist.some((h) => h.prompt === 'a rocket') && hist.some((h) => h.prompt === 'Talking avatar: hi'));
  console.log('generation ok');

  // My avatars: copies kept in their own folder; only files inside it can be removed.
  const adir = path.join(out, 'avatars');
  const a1 = gen.avatarAdd(adir, png, 'Jake');
  assert.ok(fs.existsSync(a1) && path.dirname(a1) === adir);
  assert.deepEqual(gen.avatarList(adir).map((a) => a.name), ['Jake']);
  assert.throws(() => gen.avatarAdd(adir, mp3), /JPG, PNG or WEBP/);
  assert.throws(() => gen.avatarRemove(adir, png), /Not an avatar/);
  assert.ok(fs.existsSync(png));
  gen.avatarRemove(adir, a1);
  assert.equal(gen.avatarList(adir).length, 0);
  const cat = gen.catalog();
  assert.ok(Object.keys(cat.video).length === 6 && Object.keys(cat.image).length === 11 && cat.avatar.model === 'creatify-aurora');
  console.log('avatars ok');

  // Failures and stopping.
  await assert.rejects(gen.run(fake({ steps: ['failed'] }), KEY, out, 'image', { prompt: 'x', model: 'gemini-2.5-flash-image' }, { pollMs: 1 }), /failed: boom.*not charged/);
  await assert.rejects(gen.run(fake({ steps: ['failed'], fail: 'moderated' }), KEY, out, 'image', { prompt: 'x', model: 'gemini-2.5-flash-image' }, { pollMs: 1 }), /declined/);
  const ctl = new AbortController();
  const stopped = gen.run(fake({ steps: ['generating'] }), KEY, out, 'video', { prompt: 'x', model: 'veo-3.1-fast-generate-001' }, { pollMs: 50, signal: ctl.signal });
  setTimeout(() => ctl.abort(), 120);
  await assert.rejects(stopped, (e) => e.code === 'stopped');
  console.log('failures ok');

  fs.rmSync(out, { recursive: true, force: true });
  console.log('GEN OK');
})().catch((e) => {
  console.error(e.stack || e.message);
  process.exit(1);
});
