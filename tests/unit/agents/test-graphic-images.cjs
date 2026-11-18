// Library pictures for motion graphics (electron/graphics/images.cjs, service.cjs): a picture is
// prepared once from its file (shrunk to the canvas, JPEG, or PNG when transparent), reused by file
// identity, refused when it is not a picture, and bounded; the render key follows the picture's
// content; the editor's references pick only library pictures the inputs name.
// Usage: node tests/unit/agents/test-graphic-images.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { execFileSync } = require('node:child_process');
const { GraphicImages, validateImages, imageSize, IMAGE_LIMITS } = require('../../../electron/graphics/images.cjs');
const { GraphicsService, validate } = require('../../../electron/graphics/service.cjs');
const ff = require('../../../electron/media/ffmpeg.cjs');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-graphic-images-'));
const checks = [];
const check = async (name, fn) => { await fn(); checks.push(name); };
const make = (name, args) => { const file = path.join(dir, name); execFileSync(ff.ffmpegPath, ['-v', 'error', '-y', ...args, file]); return file; };
const size = (b64) => imageSize(Buffer.from(b64, 'base64'));

(async () => { try {
  const { graphicImageRefs, libraryPictures } = await import('../../../src/features/graphics/graphicImages.js');
  // A big opaque photo, a small transparent logo, and a video.
  const photo = make('photo.jpg', ['-f', 'lavfi', '-i', 'color=c=0xd62828:s=4000x3000', '-frames:v', '1', '-q:v', '2']);
  const logo = make('logo.png', ['-f', 'lavfi', '-i', 'color=c=0x00000000@0.0:s=300x200,format=rgba', '-frames:v', '1', '-c:v', 'png']);
  const clip = make('clip.mp4', ['-f', 'lavfi', '-i', 'color=c=red:s=64x64:r=10:d=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p']);
  const images = new GraphicImages({ ffmpegPath: ff.ffmpegPath, probe: ff.probe });

  let first;
  await check('a photo larger than the canvas is shrunk to the canvas side and encoded as JPEG', async () => {
    [first] = await images.prepare([{ id: 'photo', path: photo }], { side: 1920 });
    assert.equal(first.type, 'image/jpeg'); assert.equal(first.width, 1920); assert.equal(first.height, 1440);
    assert.deepEqual(size(first.data), { width: 1920, height: 1440 });
    assert.ok(first.data.length < 400000, `a flat 1920 px JPEG stays small (${first.data.length} base64 chars)`);
  });
  await check('a transparent picture keeps its alpha as PNG and is never enlarged', async () => {
    const [p] = await images.prepare([{ id: 'logo', path: logo }], { side: 1920 });
    assert.equal(p.type, 'image/png'); assert.equal(p.width, 300); assert.equal(p.height, 200);
  });
  await check('the same file prepares once; a changed file prepares again', async () => {
    const entries = () => images.cache.size;
    assert.equal(entries(), 2);
    const [again] = await images.prepare([{ id: 'photo', path: photo }], { side: 1920 });
    assert.equal(again.data, first.data); assert.equal(entries(), 2, 'a cache hit prepares nothing');
    const t = new Date(Date.now() + 5000); fs.utimesSync(photo, t, t);
    const [changed] = await images.prepare([{ id: 'photo', path: photo }], { side: 1920 });
    assert.equal(changed.data, first.data); assert.equal(entries(), 3, 'a changed file prepares again');
    const [small] = await images.prepare([{ id: 'photo', path: photo }], { side: 640 });
    assert.equal(small.width, 640, 'another canvas side is another preparation'); assert.equal(entries(), 4);
  });
  await check('a video, a missing file, too many pictures and bad references are refused readably', async () => {
    await assert.rejects(images.prepare([{ id: 'v', path: clip }]), /is not an image; graphics take pictures/);
    await assert.rejects(images.prepare([{ id: 'x', path: path.join(dir, 'gone.png') }]), /Picture not found: gone.png/);
    await assert.rejects(images.prepare(Array.from({ length: IMAGE_LIMITS.count + 1 }, (_, i) => ({ id: `p${i}`, path: photo }))), /at most 8 pictures/);
    await assert.rejects(images.prepare([{ id: '', path: photo }]), /needs the library media id/);
    await assert.rejects(images.prepare('photo'), /must be a list/);
    assert.deepEqual(await images.prepare(undefined), []);
    assert.equal((await images.prepare([{ id: 'photo', path: photo }, { id: 'photo', path: photo }])).length, 1, 'duplicates once');
  });
  await check('validate accepts prepared pictures only, and the render key follows their content', async () => {
    const base = { code: 'export default function render(){}', width: 1080, height: 1920, fps: 30, duration_sec: 2 };
    assert.deepEqual(validate(base).images, []);
    assert.throws(() => validate({ ...base, images: [{ id: 'photo', path: photo }] }), /prepared by the graphics service/);
    assert.throws(() => validateImages([{ id: 'p', data: 'x', type: 'image/gif', width: 1, height: 1 }]), /prepared/);
    const service = new GraphicsService({ root: path.join(dir, 'cache'), ffmpegPath: ff.ffmpegPath, probe: ff.probe, renderGraphic: async () => { throw Error('not used'); } });
    const plain = service.key(validate(base));
    const withPhoto = service.key(validate(await service.prepare({ ...base, images: [{ id: 'photo', path: photo }] })));
    const withLogo = service.key(validate(await service.prepare({ ...base, images: [{ id: 'photo', path: logo }] })));
    assert.notEqual(plain, withPhoto); assert.notEqual(withPhoto, withLogo);
    assert.equal(service.key(validate(await service.prepare({ ...base, images: [{ id: 'photo', path: photo }] }))), withPhoto, 'the same picture gives the same key');
    const prepared = await service.prepare({ ...base, images: [{ id: 'photo', path: photo }] });
    assert.equal((await service.prepare(prepared)), prepared, 'prepared pictures pass through');
    assert.equal(prepared.images[0].width, 1920, 'prepared to the canvas long side');
  });
  await check('the editor references only library pictures the inputs name, top level and in rows', () => {
    const project = { media: [{ id: 'pic', type: 'image', path: '/p/a.jpg', name: 'a.jpg' }, { id: 'pic2', type: 'image', path: '/p/b.png', name: 'b.png' }, { id: 'vid', type: 'video', path: '/p/v.mp4' }, { id: 'nopath', type: 'image' }] };
    assert.deepEqual(libraryPictures(project), [{ id: 'pic', name: 'a.jpg' }, { id: 'pic2', name: 'b.png' }]);
    const refs = graphicImageRefs(project, { photo: 'pic', title: 'pic is not here', other: 'vid', missing: 'nopath', rows: [{ label: 'x', image: 'pic2' }, 'pic'], n: 3 });
    assert.deepEqual(refs, [{ id: 'pic', path: '/p/a.jpg' }, { id: 'pic2', path: '/p/b.png' }]);
    assert.deepEqual(graphicImageRefs(project, { scenes: [{ cast: { portraits: [['pic2'], { photo: 'pic' }] } }] }),
      [{ id: 'pic2', path: '/p/b.png' }, { id: 'pic', path: '/p/a.jpg' }], 'nested schema images resolve without flattening their inputs');
    const cyclic = { photo: 'pic' }; cyclic.self = cyclic;
    assert.deepEqual(graphicImageRefs(project, cyclic), [{ id: 'pic', path: '/p/a.jpg' }], 'malformed cycles cannot loop forever');
    assert.deepEqual(graphicImageRefs(project, {}), []); assert.deepEqual(graphicImageRefs({}, { photo: 'pic' }), []);
    const many = { media: Array.from({ length: 12 }, (_, i) => ({ id: `p${i}`, type: 'image', path: `/p/${i}.jpg` })) };
    assert.equal(graphicImageRefs(many, Object.fromEntries(many.media.map((m, i) => [`k${i}`, m.id]))).length, 8, 'at most 8');
  });
  console.log(`GRAPHIC IMAGES OK (${checks.length} checks: ${checks.join('; ')})`);
} catch (error) { console.error(error); process.exitCode = 1; }
finally { fs.rmSync(dir, { recursive: true, force: true }); } })();
