// A Voice Enhancer render that is gone when a project opens (moved to another computer, cache cleared) must not
// leave the clip saying "enhanced" while the export uses the original sound and the player plays silence: the
// clip goes back to its original sound and is flagged so the Enhance voice section offers to render it again.
// A render that only moved into the current media cache is found there. Usage: node tests/unit/audio/test-enhance-missing.cjs
const assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const root = path.join(__dirname, '../../..');
const { checkGenerated } = require(path.join(root, 'electron/project/projectfile.cjs'));
const ff = require(path.join(root, 'electron/media/ffmpeg.cjs'));

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clipcraft-enhance-missing-'));
try {
  const cache = path.join(dir, 'media-cache'); fs.mkdirSync(cache);
  const source = path.join(dir, 'interview.mp4'); fs.writeFileSync(source, 'x');
  const gone = path.join(dir, 'elsewhere', '0123456789abcdef-enhance-strong.wav');
  const moved = path.join(dir, 'old-cache', 'fedcba9876543210-enhance-light.wav');
  fs.writeFileSync(path.join(cache, path.basename(moved)), 'x');
  const kept = path.join(cache, 'aaaaaaaaaaaaaaaa-enhance-standard.wav'); fs.writeFileSync(kept, 'x');
  const enh = (file, strength) => ({ on: true, strength, path: file, from: 0, to: 6 });
  const project = { name: 'enh', width: 320, height: 180, fps: 30, media: [{ id: 'v', type: 'video', path: source, duration: 6, hasAudio: true }],
    videoClips: [{ id: 'a', mediaId: 'v', in: 0, out: 6, enhance: enh(gone, 'strong') }, { id: 'b', mediaId: 'v', in: 0, out: 6, enhance: enh(moved, 'light') }],
    overlayClips: [], audioClips: [{ id: 'c', mediaId: 'v', in: 0, out: 6, start: 0, enhance: enh(kept, 'standard') }], textClips: [] };
  const opened = JSON.parse(checkGenerated(JSON.stringify(project), cache));
  const [a, b] = opened.videoClips, c = opened.audioClips[0];
  assert.deepEqual(a.enhance, { on: false, strength: 'strong', from: 0, to: 6, missing: true }, 'a missing render is cleared and flagged');
  assert.equal(b.enhance.path, path.join(cache, path.basename(moved)), 'a render moved into the media cache is found');
  assert.equal(b.enhance.on, true);
  assert.deepEqual(c.enhance, project.audioClips[0].enhance, 'a present render is untouched');
  assert.equal(checkGenerated(JSON.stringify(opened), cache), JSON.stringify(opened), 'the checked project is stable');

  // Preview and export now agree: neither uses an enhanced file for clip a, both use it for clip b.
  const enhancedInputs = (clip) => {
    const { args } = ff.buildExportArgs({ ...opened, videoClips: [clip], audioClips: [] }, path.join(dir, 'out.mp4'), { encoder: 'libx264' });
    return args.flatMap((value, i) => (value === '-i' && /-enhance-/.test(path.basename(args[i + 1])) ? [args[i + 1]] : []));
  };
  assert.deepEqual(enhancedInputs(a), []);
  assert.deepEqual(enhancedInputs(b), [b.enhance.path]);
  const ui = fs.readFileSync(path.join(root, 'src/features/audio/components/EnhanceVoice.jsx'), 'utf8');
  assert.match(ui, /e\?\.missing && !e\.path[\s\S]*enhance\.the_enhanced_sound_is_missing[\s\S]*enhance\.enhance_again/, 'the section tells the user and offers a new render');
  for (const lang of ['en', 'fr', 'es']) assert.ok(JSON.parse(fs.readFileSync(path.join(root, `shared/i18n/${lang}.json`), 'utf8'))['enhance.the_enhanced_sound_is_missing'], lang);
  console.log('missing Voice Enhancer renders: cleared and flagged on open, found again when moved into the cache');
} finally { fs.rmSync(dir, { recursive: true, force: true }); }
