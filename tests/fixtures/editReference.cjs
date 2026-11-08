// A reference video whose editing is known exactly, for the edit fingerprint tests:
// hard cuts, a 1.5x punch-in, a zoom-in move, a dissolve, a fade through black, a
// jump cut, moving content and a black-and-white shot. Audio: a 120 BPM click track,
// or a given speech file. Test-only (tests/unit/media/test-edit-style.cjs, smoke).
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.join(__dirname, '../..');
const { ffmpegPath } = require(path.join(root, 'electron/media/ffmpeg.cjs'));

const ff = (args) => execFileSync(ffmpegPath, ['-v', 'error', '-y', ...args]);
const photo = (name) => path.join(root, 'public/preview', name);

// A reference with known editing (bundled photos for real texture, test patterns for motion).
function makeReference(dir, { W = 640, H = 360, speech = null } = {}) {
  const fps = 30;
  const seg = (name, args) => { const f = path.join(dir, `${name}.mp4`); ff([...args, '-r', String(fps), '-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-an', f]); return f; };
  const fit = `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H}`;
  const still = (img, sec, extra = '') => ['-loop', '1', '-framerate', String(fps), '-t', String(sec), '-i', img, '-vf', fit + extra];
  const A = seg('a', still(photo('p1015.jpg'), 2));
  const B = seg('b', still(photo('p1016.jpg'), 1.5));
  // Punch-in: the same picture 1.5x tighter, centred a little left of the middle.
  const Bz = seg('bz', still(photo('p1016.jpg'), 1.5, `,crop=${Math.round(W / 1.5)}:${Math.round(H / 1.5)}:${Math.round(W * 0.4 - W / 3)}:${Math.round(H / 2 - H / 3)},scale=${W}:${H}`));
  // A zoom-in move across the whole shot.
  const C = seg('c', ['-loop', '1', '-framerate', String(fps), '-t', '2.5', '-i', photo('p1018.jpg'), '-vf',
    `scale=${W * 2}:${H * 2}:force_original_aspect_ratio=increase,crop=${W * 2}:${H * 2},zoompan=z='1+0.4*on/75':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${W}x${H}:fps=${fps}`]);
  const D = seg('d', still(photo('p1025.jpg'), 2, ',fade=t=out:st=1.7:d=0.3'));
  const E = seg('e', still(photo('p1060.jpg'), 2, ',fade=t=in:st=0:d=0.3'));
  const T1 = seg('t1', ['-f', 'lavfi', '-i', `testsrc2=s=${W}x${H}:r=${fps}:d=2`]);
  // The same moving picture, 7 seconds later: a jump cut.
  const T2 = seg('t2', ['-f', 'lavfi', '-i', `testsrc2=s=${W}x${H}:r=${fps}:d=22`, '-ss', '20']);
  const G = seg('g', still(photo('p292.jpg'), 2, ',hue=s=0'));
  const file = path.join(dir, 'reference.mp4');
  // 120 BPM click track: a 20 ms tick every 0.5 s.
  ff(['-i', A, '-i', B, '-i', Bz, '-i', C, '-i', D, '-i', E, '-i', T1, '-i', T2, '-i', G,
    ...(speech ? ['-i', speech] : ['-f', 'lavfi', '-i', "aevalsrc='if(lt(mod(t,0.5),0.02),0.8*sin(2*PI*1000*t),0)':s=44100:d=17"]),
    '-filter_complex', '[3:v][4:v]xfade=transition=dissolve:duration=0.5:offset=2[cd];[0:v][1:v][2:v][cd][5:v][6:v][7:v][8:v]concat=n=8:v=1:a=0,format=yuv420p[v];[9:a]apad=whole_dur=17[a]',
    '-map', '[v]', '-map', '[a]', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-c:a', 'aac', '-t', '17', file]);
  return { file, truth: [{ t: 2, kind: 'cut' }, { t: 3.5, kind: 'punch_in' }, { t: 5, kind: 'cut' }, { t: 7.25, kind: 'dissolve' },
    { t: 9, kind: 'fade_black' }, { t: 11, kind: 'cut' }, { t: 13, kind: 'jump' }, { t: 15, kind: 'cut' }] };
}

module.exports = { makeReference };
