const { audioFadeFilters, audioAutomationFilters } = require('../audio/fades.cjs');
const {videoFormat,formatFromPath}=require('../../shared/exportFormats.cjs');
// Builds FFmpeg arguments for exporting a project to MP4.
// Media and argument helpers also run from plain Node for standalone tests.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile, execFileSync } = require('child_process');
const { spawn } = require('../system/childProcesses.cjs');
// Temporary names in the media cache carry this process's tag: two running instances never write the same partial file.
const PART_TAG = `${process.pid}-${require('crypto').randomBytes(4).toString('hex')}`;

const {unpackedBinaryPath}=require('./nativePaths.cjs');
const ffmpegPath = unpackedBinaryPath(require('ffmpeg-static'));
// ffprobe-static ships an Intel-only macOS binary. Prefer the native platform
// package, including arm64, so a clean Apple Silicon Mac needs no Rosetta.
const ffprobePath = unpackedBinaryPath((() => {try{return require('@ffprobe-installer/ffprobe').path;}catch{return require('ffprobe-static').path;}})());

const layers = require("../export/layers.cjs");
const { audioFxFilters } = require("../audio/audiofx.cjs");
const { mediaWorkBudget } = require('./workBudget.cjs');
const { progressReader } = require('../export/ffmpegProgress.cjs');
// User-facing text (main-process dictionaries), loaded only when a message is shown.
const t = (key, params) => require('../system/i18n.cjs').t(key, params);

const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif'];

const num = (n) => Number(n).toFixed(3);
// Project values reach the filter graphs only as a finite number, a strict hex colour or a name
// from a fixed set: any other text (a crafted project file) could add filters of its own, which
// read and write files. These helpers are the only way such a value enters a graph string.
const finite = (v, def) => (typeof v === 'number' && Number.isFinite(v) ? v : def);
const positive = (v, def) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : def);
function hex(c, def = '#ffffff') {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(typeof c === 'string' ? c.trim() : '') || /^#([0-9a-f]{6})$/i.exec(def) || ['', 'ffffff'];
  return `0x${m[1].length === 3 ? [...m[1]].map((d) => d + d).join('') : m[1]}`;
}
const speedOf = (c) => positive(c && c.speed, 1);
const gainOf = (c) => Math.max(0, finite(c && c.volume, 1));
// The transitions FFmpeg's xfade draws itself; the others (animated, extension) arrive pre-rendered
// as fxSegments. An unknown name crossfades, as the player shows it.
const XFADE = new Set(['fade', 'wipeleft', 'wiperight', 'wipeup', 'wipedown', 'slideleft', 'slideright', 'slideup', 'slidedown', 'circlecrop', 'rectcrop', 'distance',
  'fadeblack', 'fadewhite', 'radial', 'smoothleft', 'smoothright', 'smoothup', 'smoothdown', 'circleopen', 'circleclose', 'vertopen', 'vertclose', 'horzopen', 'horzclose',
  'dissolve', 'pixelize', 'diagtl', 'diagtr', 'diagbl', 'diagbr', 'hlslice', 'hrslice', 'vuslice', 'vdslice', 'hblur', 'fadegrays', 'wipetl', 'wipetr', 'wipebl', 'wipebr',
  'squeezeh', 'squeezev', 'zoomin', 'fadefast', 'fadeslow']);
const xfadeName = (type) => (typeof type === 'string' && XFADE.has(type) ? type : 'fade');

// Shortest clip length the filter graphs can express: num() prints 3 decimals, and FFmpeg reads
// trim/atrim duration=0 (and apad whole_dur=0) as "no limit", so a shorter clip would play its whole
// source (or a silent source forever) instead of nothing.
const MIN_CLIP_LEN = 0.001;

// Seconds as ffprobe prints them, or a Matroska DURATION tag ("00:01:02.500000000").
const seconds = (v) => {
  if (v == null || v === '' || v === 'N/A') return NaN;
  const hms = /^(\d+):(\d{1,2}):(\d+(?:\.\d+)?)$/.exec(String(v).trim());
  return hms ? Number(hms[1]) * 3600 + Number(hms[2]) * 60 + Number(hms[3]) : parseFloat(v);
};
// A container without a duration (a browser-recorded WebM, an interrupted MKV): the streams'
// own durations first, otherwise the end of the last packet, read by demuxing (no decoding).
function containerDuration(info) {
  const own = seconds(info.format && info.format.duration);
  if (own > 0) return own;
  const streams = (info.streams || []).filter((s) => s.codec_type === 'video' || s.codec_type === 'audio');
  return Math.max(0, ...streams.map((s) => Math.max(seconds(s.duration) || 0, seconds(s.tags && (s.tags.DURATION || s.tags.duration)) || 0)));
}
function lastPacketEnd(file, startTime) {
  return new Promise((resolve) => {
    const p = spawn(ffprobePath, ['-v', 'error', '-show_entries', 'packet=pts_time,dts_time,duration_time', '-of', 'csv=p=0', file], { windowsHide: true });
    let end = 0, rest = '';
    const read = (line) => { const [pts, dts, dur] = line.split(','); const t = seconds(pts) >= 0 ? seconds(pts) : seconds(dts); if (t >= 0) end = Math.max(end, t + (seconds(dur) || 0)); };
    p.stdout.on('data', (d) => { const lines = (rest + d).split(/\r?\n/); rest = lines.pop(); lines.forEach(read); });
    p.on('error', () => resolve(0));
    p.on('close', () => { if (rest) read(rest); resolve(Math.max(0, end - Math.max(0, startTime || 0))); });
  });
}

function probe(file) {
  const ext = path.extname(file).slice(1).toLowerCase();
  return new Promise((resolve, reject) => {
    // A picture is decoded while it is probed (-count_frames costs nothing for one frame). A damaged
    // picture still reports a size from its header, and a looped still that never decodes would
    // keep the export encoder retrying forever.
    // A still also reports its decoded frame's EXIF orientation (a GIF carries none and may have many frames).
    const args = ['-v', 'error', ...(IMAGE_EXT.includes(ext) ? ['-count_frames'] : []), ...(IMAGE_EXT.includes(ext) && ext !== 'gif' ? ['-show_entries', 'frame_tags=Orientation'] : []),
      '-print_format', 'json', '-show_format', '-show_streams', file];
    const p = spawn(ffprobePath, args, { windowsHide: true });
    let out = '';
    let err = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (err += d));
    p.on('error', reject);
    p.on('close', async (code) => {
      if (code !== 0) return reject(new Error(err || `ffprobe exited with ${code}`));
      let info;
      try { info = JSON.parse(out); } catch { return reject(new Error(t('main.media_no_streams'))); }
      const streams = info.streams || [];
      const v = streams.find((s) => s.codec_type === 'video' && !(s.disposition && s.disposition.attached_pic));
      const a = streams.find((s) => s.codec_type === 'audio');
      const isImage = IMAGE_EXT.includes(ext) && !a;
      if (isImage && !(Number(v && v.nb_read_frames) >= 1)) return reject(new Error('This picture is damaged or is not a readable image.'));
      // Phones store portrait videos as landscape frames plus a rotation (display matrix): FFmpeg and the player
      // show them turned, so the size we use is the turned one.
      const rotation = v ? Math.round(Number((v.side_data_list || []).find((d) => d.rotation !== undefined)?.rotation ?? (v.tags && v.tags.rotate) ?? 0)) : 0;
      // Phone photos are stored the same way with an EXIF orientation: FFmpeg and the player show them upright, so
      // a picture's size is its displayed one too (orientations 5-8 swap width and height).
      const orientation = isImage ? (Number.parseInt((info.frames || []).find((f) => f.tags && f.tags.Orientation)?.tags.Orientation, 10) || 1) : 0;
      const turned = Math.abs(rotation) % 180 === 90 || orientation >= 5 && orientation <= 8;
      // HDR video (iPhone HLG / Dolby Vision, PQ): converted to normal (SDR) colors wherever we decode it.
      const hdr = !!v && ['arib-std-b67', 'smpte2084'].includes(v.color_transfer);
      let duration = 0;
      if (!isImage) {
        duration = containerDuration(info);
        if (!(duration > 0) && (v || a)) duration = await lastPacketEnd(file, seconds(info.format && info.format.start_time));
        // A clip of a file with no length would be cut to nothing in the preview and, in FFmpeg, play without end.
        if (!(duration >= MIN_CLIP_LEN)) return reject(new Error(t(v || a ? 'main.media_no_length' : 'main.media_no_streams')));
      }
      resolve({
        container:info.format?.format_name??'',
        type: isImage ? 'image' : v ? 'video' : 'audio',
        duration,
        hasVideo: !!v,
        hasAudio: !!a,
        // Frame rate from the stream's average (or nominal) rate, rounded (29.97 -> 30).
        fps: v ? Math.round((() => { const r = String(v.avg_frame_rate || v.r_frame_rate || '0/1').split('/'); return (parseFloat(r[0]) || 0) / (parseFloat(r[1]) || 1); })()) : 0,
        width: v ? (turned ? v.height : v.width) : 0,
        height: v ? (turned ? v.width : v.height) : 0,
        rotation,
        ...(isImage ? { orientation } : {}),
        hdr,
        // What the player needs to know to decide on a preview proxy.
        vcodec: v ? v.codec_name : '',
        acodec: a ? a.codec_name : '',
        pixFmt: v ? v.pix_fmt : '',
        profile: v ? v.profile || '' : '',
        // The stream's colour matrix tag ('' when untagged): see matrixIn for how an untagged source is read.
        colorSpace: v ? v.color_space || '' : '',
        // Audio channel count: mono sources get a unity dual-mono pan in the export chains
        // (see monoUp below); media probed before this field existed reads as undefined and
        // simply keeps the old upmix behaviour.
        channels: a ? a.channels || 0 : 0,
      });
    });
  });
}

const clipLen = (c) => (c.out - c.in) / speedOf(c);
// A clip the filter graphs can express (MIN_CLIP_LEN of source and of timeline). Shorter clips
// (a media item probed before its length could be read, a range cut to nothing) occupy no
// time on the timeline, so leaving them out changes nothing but the graph.
const timed = (c) => clipLen(c) >= MIN_CLIP_LEN && c.out - c.in >= MIN_CLIP_LEN;
// The main track without such clips. The clip after a dropped one keeps the plain cut the
// timeline showed: its transition was 0 long against a 0-long neighbour.
function timedMain(clips) {
  const out = [];
  let dropped = false;
  for (const c of clips) {
    if (!timed(c)) { dropped = true; continue; }
    out.push(dropped && c.transition ? { ...c, transition: null } : c);
    dropped = false;
  }
  return out;
}
// Where the main track ends (transitions overlap neighbours), and the whole timeline with the
// placed (overlay, audio) clips: the bound every audio render is cut to.
function mainEnd(clips) {
  let end = 0;
  clips.forEach((c, i) => { end = (i ? end - transitionDur(clips, i) : 0) + clipLen(c); });
  return end;
}
const placedEnd = (clips) => Math.max(0, ...clips.map((c) => Math.max(0, c.start || 0) + clipLen(c)));

// HDR (HLG or PQ, BT.2020) to normal BT.709 colors: to linear light, BT.709 primaries, Hable tone curve. Without it
// the picture comes out pale and yellowish, because every later step reads the HDR values as normal ones.
const TONEMAP = 'zscale=t=linear:npl=203,format=gbrpf32le,zscale=p=bt709,tonemap=tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,format=yuv420p';
const toSdr = (m) => (m && m.hdr ? `,${TONEMAP}` : '');
// The matrix an UNTAGGED SDR video is read with before the RGB compositing path. FFmpeg's own default for an
// untagged source is BT.601, which players (and the preview, through Chromium) do not share: they read untagged
// HD as BT.709. Without this the composite was decoded as 601 and re-encoded as 709 — a visible shift on
// saturated colours (measured 23.7 dB vs 35.6 dB for the same tagged source). Tagged sources keep their tag;
// HDR is handled by TONEMAP; images decode straight to RGB. Media probed before `colorSpace` existed is
// treated as untagged, which is harmless for a BT.709 tag and right for SD BT.601. Only YUV pixel formats
// take the hint: RGB sources (the graphics' ARGB qtrle, RGBA PNG sequences) have no matrix, and tagging one
// broke their alpha compositing (test-graphics-ui).
const UNTAGGED = ['', 'unknown', 'unspecified', 'reserved'];
const matrixIn = (m) => (m && m.type === 'video' && !m.hdr && /^yuv/.test(m.pixFmt || 'yuv') && UNTAGGED.includes(m.colorSpace || '')
  ? `,setparams=colorspace=${(m.height || 0) < 720 && (m.width || 0) < 1280 ? 'smpte170m' : 'bt709'}` : '');

function transitionDur(clips, i) {
  const t = clips[i] && clips[i].transition;
  if (!t || i === 0 || t.type === 'none') return 0;
  if (Number.isFinite(t.timelineOverlap)) return Math.max(0, Math.min(t.timelineOverlap, clipLen(clips[i]), clipLen(clips[i - 1])));
  return Math.max(0, Math.min(t.duration, clipLen(clips[i]) / 2, clipLen(clips[i - 1]) / 2));
}

// Main-track placement on the output grids. Each clip's first and end frame (at fps) and
// sample (at 48 kHz) are rounded from its cumulative timeline position, so every clip's
// stream holds exactly its share of the grid: joining them adds no rounding error, however
// many cuts the track has (a per-clip rounding drifted the picture a frame per cut).
const AUDIO_RATE = 48000;
function mainGrid(clips, fps) {
  let end = 0;
  return clips.map((c, i) => {
    const start = i ? end - transitionDur(clips, i) : 0;
    end = start + clipLen(c);
    return { start, end, f0: Math.round(start * fps), f1: Math.round(end * fps), s0: Math.round(start * AUDIO_RATE), s1: Math.round(end * AUDIO_RATE) };
  });
}
// Exactly n frames on the fps grid: the last picture is held when the source runs short.
const exactFrames = (n, fps) => `tpad=stop_mode=clone:stop_duration=1,trim=end_frame=${n},setpts=N/(${fps}*TB)`;
const sec6 = (s) => Number(s).toFixed(6);
// Two neighbouring main-track sounds: crossfaded over their overlap in samples (a transition), else butted.
const joinAudio = (a, b, overlap, out) => (overlap > 0 ? `[${a}][${b}]acrossfade=ns=${overlap}[${out}]` : `[${a}][${b}]concat=n=2:v=0:a=1[${out}]`);
// A source's sound from the clip's first source second (pts 0 after the input seek, or
// `from` without one), keeping where the audio stream starts: a recording whose audio
// begins after its picture (recorded WebM) plays that silence first, as the player does.
// `from`: where the clip starts in the stream (the seek residue, or clip.in for an unseeked input).
const sourceAudio = (len, from = 0) => (from < 1e-7
  ? [`atrim=start=0:end=${num(len)}`, 'aresample=async=1:min_hard_comp=0.1:first_pts=0']
  : [`atrim=start=${sec6(from)}:end=${sec6(from + len)}`, `asetpts=PTS-${sec6(from)}/TB`, 'aresample=async=1:min_hard_comp=0.1:first_pts=0']);
// Input seek point for a clip starting at t source seconds: t rounded DOWN to the millisecond.
// Rounded to nearest, a frame-aligned start such as 8/30 s (0.2667) seeked to 0.267, past
// that frame: the clip lost its first picture and ran a frame ahead of its sound. Sound
// read from such an input skips the residue (sourceAudio's `from`).
const seekTo = (t) => Math.max(0, Math.floor(Math.max(0, t) * 1000 + 1e-6) / 1000);
const seekRest = (t) => Math.max(0, t - seekTo(t));
// Clips that read the same file share one input: one input per clip put every clip's path on the command line,
// past Windows' 32,767-character limit at about a hundred clips of a long recording. A shared input is seeked to
// its first clip (seekTo) and FFmpeg decodes it once; each clip trims its own part from `base`, the input's seek
// point. A clip `gap` seconds or more past the group's furthest end opens a new input, so no long stretch is
// decoded for nothing. Groups are runs of consecutive uses whose ranges move forward (decoded frames and samples
// are not held back for a later clip). Every decoded frame of an input goes to each clip sharing it, so the
// cost grows with clips x stretch: a group holds at most `max` clips over at most `span` source seconds.
// uses: [{ key, file, from, to, lane }] in timeline order: uses in different lanes (tracks mixed at the same time)
// never share, so one is not held back waiting for the other. get(key) opens the input on first use: { idx, base }.
const SHARE_MAX = 8, SHARE_SPAN = 60;
function sharedInputs(uses, addInput, { gap, max = SHARE_MAX, span = SHARE_SPAN }) {
  const groups = [], byKey = new Map(), id = (u) => `${u.lane || ''}\n${u.file}`;
  let last = null;
  for (const use of uses) {
    const fits = last && last.id === id(use) && use.from - last.end < gap && use.from >= last.lastFrom && use.from >= last.end - 0.5
      && last.count < max && use.to - last.from <= span;
    if (!fits) groups.push(last = { id: id(use), file: use.file, from: use.from, end: use.to, lastFrom: use.from, count: 1, idx: null });
    else { last.end = Math.max(last.end, use.to); last.lastFrom = use.from; last.count++; }
    byKey.set(use.key, last);
  }
  const open = (g) => { if (g.idx === null) g.idx = addInput(['-ss', num(seekTo(g.from)), '-i', g.file]); return { idx: g.idx, base: seekTo(g.from) }; };
  return { get: (key) => (byKey.has(key) ? open(byKey.get(key)) : null), groups };
}
// A gap this long is cheaper to seek over than to decode (pictures 5 s, sound 60 s); when the gap and span
// limits still leave too many inputs for a bounded command line, forward runs share regardless of them (each
// group still holds at most SHARE_MAX clips). Inputs are only added when a clip asks for one.
function boundedInputs(uses, addInput, gap) {
  const length = (plan) => plan.groups.reduce((n, g) => n + g.file.length + 24, 0);
  const near = sharedInputs(uses, addInput, { gap });
  return length(near) <= 16000 ? near : sharedInputs(uses, addInput, { gap: Infinity, span: Infinity });
}
const sharedPictureInputs = (uses, addInput) => boundedInputs(uses, addInput, 5);
const sharedSoundInputs = (uses, addInput) => boundedInputs(uses, addInput, 60);
// Gain, effects and level automation of a clip's sound, from its (tempo-corrected) source to
// a 48 kHz stereo stream. The effects always run at 48 kHz (the pitch shift relies on it).
// Loudness normalization sets the level of the effects' output, so with it on the clip's own
// volume and fades come after it: otherwise they would be normalized away, while the player
// applies them.
function clipAudioBody(c, len, up) {
  const gain = [`volume=${gainOf(c)}`, ...audioFadeFilters(c, len, num)];
  const late = !!(c.audioFx && c.audioFx.loudnorm);
  return [...(up ? [up] : []), ...atempo(speedOf(c)), ...(late ? [] : gain), 'aresample=48000', 'aformat=sample_fmts=fltp:channel_layouts=stereo',
    ...audioFxFilters(c.audioFx), ...(late ? gain : []), ...audioAutomationFilters(c)];
}

function atempo(speed) {
  const out = [];
  let s = speed;
  while (s > 2) { out.push('atempo=2'); s /= 2; }
  while (s < 0.5) { out.push('atempo=0.5'); s /= 0.5; }
  if (Math.abs(s - 1) > 1e-9) out.push(`atempo=${Number(s.toFixed(9))}`);
  return out;
}

// Classic Adjust exactly as the player draws it: the CSS filter brightness() contrast() saturate()
// hue-rotate() (src/features/effects/effects.js clipCss), in that order on the gamma-encoded RGB
// values, each step clamped. Brightness multiplies, contrast scales about mid-grey, saturate and
// hue-rotate are the CSS colour matrices. (FFmpeg's eq adds brightness to luma instead: blacks
// came out grey, and its contrast pivots on luma, so colours drifted from the preview.)
function adjustFilters(a) {
  const f = [], k = Math.max(0, 1 + finite(a.brightness, 0)), c = Math.max(0, finite(a.contrast, 1)), s = Math.max(0, finite(a.saturation, 1));
  const d = (v) => Number(v.toFixed(6));
  if (k !== 1 || c !== 1) {
    const lift = k !== 1 ? `clip(val*${d(k)},0,maxval)` : 'val';
    const e = c !== 1 ? `clip((${lift}-maxval/2)*${d(c)}+maxval/2,0,maxval)` : lift;
    // lut values are truncated to integers: +0.5 rounds them.
    f.push(`lutrgb=r='${e}+0.5':g='${e}+0.5':b='${e}+0.5'`);
  }
  const mixer = (m) => `colorchannelmixer=${['rr', 'rg', 'rb', 'gr', 'gg', 'gb', 'br', 'bg', 'bb'].map((n, i) => `${n}=${d(m[i])}`).join(':')}`;
  if (s !== 1) f.push(mixer([0.213 + 0.787 * s, 0.715 - 0.715 * s, 0.072 - 0.072 * s, 0.213 - 0.213 * s, 0.715 + 0.285 * s, 0.072 - 0.072 * s, 0.213 - 0.213 * s, 0.715 - 0.715 * s, 0.072 + 0.928 * s]));
  const h = finite(a.hue, 0) * Math.PI / 180;
  if (h) {
    const cs = Math.cos(h), sn = Math.sin(h);
    f.push(mixer([0.213 + cs * 0.787 - sn * 0.213, 0.715 - cs * 0.715 - sn * 0.715, 0.072 - cs * 0.072 + sn * 0.928,
      0.213 - cs * 0.213 + sn * 0.143, 0.715 + cs * 0.285 + sn * 0.140, 0.072 - cs * 0.072 - sn * 0.283,
      0.213 - cs * 0.213 - sn * 0.787, 0.715 - cs * 0.715 + sn * 0.715, 0.072 + cs * 0.928 + sn * 0.072]));
  }
  return f;
}

// Filters for the look of a clip (flip, color filter, adjustments, effects) on a picture of size W x H.
function lookFilters(clip, W, H) {
  const f = [];
  const fx = clip.effects || [];
  // A classic effect carrying a region, or a strength below 1, is baked by the effects
  // pass through its shader form instead (src/features/effects/apply.js classicViaShader) — the flat
  // look filters here must not paint it a second time.
  const viaShader = (id) => !!(clip.fxRegions?.[id] || (clip.fxStrength?.[id] != null && clip.fxStrength[id] < 1));
  if (fx.includes('mirror') && !viaShader('mirror')) f.push('hflip');
  if (fx.includes('flipv') && !viaShader('flipv')) f.push('vflip');
  // clip.filter is drawn by the effects pass (GPU, src/features/effects/filters.js), like in the player.
  const a = { brightness: 0, contrast: 1, saturation: 1, hue: 0, blur: 0, ...(clip.adjust || {}) };
  f.push(...adjustFilters(a));
  const blur = Math.round((a.blur + (fx.includes('blur') && !viaShader('blur') ? 6 : 0)) * (W / 640));
  if (blur > 0) f.push(`boxblur=${Math.min(blur, Math.floor(Math.min(W, H) / 2) - 1)}`);
  if (fx.includes('vignette') && !viaShader('vignette')) f.push('vignette=PI/4');
  if (fx.includes('grain') && !viaShader('grain')) f.push('noise=alls=18:allf=t');
  if (fx.includes('pixel') && !viaShader('pixel')) f.push(`scale=iw/24:ih/24,scale=${W}:${H}:flags=neighbor`);
  return f;
}

// The plain picture path: fit in the frame over the background color, look, constant frame rate.
// A picture or video whose pixels may be transparent (PNG/WebP/GIF, ProRes 4444, VP9 alpha): the plain chain would
// drop its alpha and show the hidden colours (often black) where the preview shows the project background.
const mayHaveAlpha = (m) => !!m && /^(?:yuva|gbrap|ya\d|pal8)|rgba|argb|bgra|abgr/.test(String(m.pixFmt || ''));
function clipVideoFilters(clip, W, H, fps, background) {
  return [
    `scale=${W}:${H}:force_original_aspect_ratio=decrease`,
    `pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=${hex(background, '#000000')}`,
    'setsar=1',
    ...lookFilters(clip, W, H),
    `fps=${fps}:start_time=0`,
    'format=rgba',
    layers.TO_YUV709,
  ].join(',');
}


// The Voice Enhancer's cached file for a clip, when it is on AND was rendered for the clip's
// current range (a re-trim makes the stored render stale: it is ignored until re-run, exactly
// like the preview). The file covers [clip.in, clip.out], so chains read it from 0.
function enhancePathOf(clip) {
  const e = clip && clip.enhance;
  if (!e || !e.on || !e.path) return null;
  if (Math.abs((e.from ?? -1) - (clip.in || 0)) > 0.02 || Math.abs((e.to ?? -1) - (clip.out ?? -1)) > 0.02) return null;
  return fs.existsSync(e.path) ? e.path : null;
}

// Audio stream [a<i>] for main-track clip i (silence for photos, muted or silent clips).
// enhIdx: input index of the clip's enhanced file, when the Voice Enhancer replaces its sound.
// swresample's default mono->stereo upmix renders a mono source 3.01 dB down per channel,
// while the browser plays (and the level meter reads) the same clip at its true level on both
// channels — measured on the app's own mix render (a -1.00 dBFS mono voice rendered at
// -4.01 dBFS). Pan mono sources to dual-mono at unity so the export carries the level the
// preview presented. Only for the media file itself: enhanced renders are always stereo
// (electron/media/enhance.cjs writes -ac 2), so the enhanced path never takes the pan.
const monoUp = (m, enhanced) => (!enhanced && m && m.channels === 1 ? 'pan=stereo|c0=c0|c1=c0' : null);

// samples: the clip's exact length at 48 kHz on the main-track grid (see mainGrid).
// seeked: true when the input was seeked to the clip (seekTo(clip.in)), or the seek point of a shared input.
function clipAudioFilter(clip, m, idx, i, enhIdx = -1, seeked = false, samples = Math.round(clipLen(clip) * AUDIO_RATE)) {
  const len = clipLen(clip);
  if (clip.gap || !m || m.type === 'image' || !m.hasAudio || clip.muted) {
    return `anullsrc=r=48000:cl=stereo,atrim=end_sample=${samples},aformat=sample_fmts=fltp[a${i}]`;
  }
  // Perf B1 (2026-11-01): when the caller input-seeked this clip's input (-ss before -i),
  // the stream already starts at clip.in, so the trim runs from 0 — identical samples,
  // without decoding the skipped prefix. The enhanced branch is pre-trimmed by the
  // enhance render and always reads from 0.
  const src = sourceAudio(clip.out - clip.in, enhIdx >= 0 ? 0 : typeof seeked === 'number' ? Math.max(0, clip.in - seeked) : seeked ? seekRest(clip.in) : clip.in);
  const up = monoUp(m, enhIdx >= 0);
  return `[${enhIdx >= 0 ? enhIdx : idx}:a]` + [...src, ...clipAudioBody(clip, len, up),
    `apad=whole_len=${samples}`, `atrim=end_sample=${samples}`].join(',') + `[a${i}]`;
}

// Analysis uses the same audible sources as playback, while preserving main-track
// positions even when a source/layer is excluded. No picture data enters the key.
function analysisAudioPlan(project, selection = 'all') {
  const options = typeof selection === 'string' ? { source: selection } : (selection || {});
  const source = options.source || 'all';
  if (!['all', 'video', 'overlay', 'audio'].includes(source)) throw new Error('Audio source must be all, video, overlay or audio.');
  if (options.clip_ids !== undefined && (!Array.isArray(options.clip_ids) || !options.clip_ids.length || options.clip_ids.some(id => typeof id !== 'string'))) throw new Error('clip_ids must be a nonempty list of clip IDs.');
  const selected = options.clip_ids ? new Set(options.clip_ids) : null;
  const media = new Map((project.media || []).map(m => [m.id, m]));
  const lists = { video: project.videoClips || [], overlay: project.overlayClips || [], audio: project.audioClips || [] };
  if (selected && [...selected].some(id => !Object.values(lists).some(list => list.some(c => c.id === id)))) throw new Error('An audio clip ID no longer exists. Refresh the project.');
  const states = project.layerState || {};
  const solo = Object.entries(states).some(([key, state]) => ['video', 'overlay', 'audio'].includes(key.split(':')[0]) && state?.solo);
  const audible = (c, track) => {
    const state = states[`${track}:${track === 'video' ? 0 : c.layer || 0}`] || {};
    const m = media.get(c.mediaId);
    return !c.gap && !c.disabled && !c.muted && !state.hidden && !state.muted && (!solo || state.solo)
      && (!selected || selected.has(c.id)) && gainOf(c) > 0 && m && m.type !== 'image' && (m.hasAudio || m.type === 'audio');
  };
  const main = (source === 'all' || source === 'video') ? timedMain(lists.video).map(c => ({ ...c, muted: !audible(c, 'video') })) : [];
  const extras = [];
  for (const track of ['overlay', 'audio']) if (source === 'all' || source === track) {
    for (const c of lists[track]) if (timed(c) && audible(c, track)) extras.push({ clip: c, media: media.get(c.mediaId), track });
  }
  const sounding = [...main.filter(c => !c.muted).map(c => ({ clip: c, media: media.get(c.mediaId), track: 'video' })), ...extras];
  if (!sounding.length) throw new Error(`No audible clips in the selected ${source} source. Check mute, solo, hidden layers and clip selection.`);
  return { source, main, extras, sounding, media };
}

// Timeline intervals where a selected, audible clip actually plays (the same
// rules and placement as the analysis render). Anywhere else the rendered mix
// is silent only because nothing selected plays there.
function audibleIntervals(project, selection = 'all') {
  const plan = analysisAudioPlan(project, selection), spans = [];
  let t = 0;
  plan.main.forEach((c, i) => {
    const start = i ? t - transitionDur(plan.main, i) : 0, end = start + clipLen(c);
    if (!c.muted) spans.push({ start, end });
    t = end;
  });
  for (const { clip } of plan.extras) spans.push({ start: Math.max(0, clip.start || 0), end: Math.max(0, clip.start || 0) + clipLen(clip) });
  return spans.sort((a, b) => a.start - b.start).reduce((out, s) => { const last = out.at(-1); if (last && s.start <= last.end + 1e-6) last.end = Math.max(last.end, s.end); else out.push({ ...s }); return out; }, []);
}

function audioAnalysisKey(project, selection = 'all') {
  const plan = analysisAudioPlan(project, selection);
  const fileInfo = file => {
    const st = fs.statSync(file);
    return { path: file, size: st.size, mtime: st.mtimeMs, ctime: st.ctimeMs, ino: st.ino };
  };
  const shape = (c, m) => ({ in: c.in, out: c.out, speed: speedOf(c), start: c.start || 0, muted: !!c.muted,
    volume: c.volume ?? 1, transition: c.transition, fadeIn: c.fadeIn || 0, fadeOut: c.fadeOut || 0, fadeInOffset: c.fadeInOffset || 0, fadeOutOffset: c.fadeOutOffset || 0,
    audioFx: c.audioFx, volumeKeys: c.volumeKeys, media: c.muted ? undefined : { file: fileInfo(m.path), channels: m.channels,
      enhanced: enhancePathOf(c) ? fileInfo(enhancePathOf(c)) : undefined } });
  return require('crypto').createHash('sha256').update(JSON.stringify({ version: 3, source: plan.source,
    main: plan.main.map(c => shape(c, plan.media.get(c.mediaId))),
    extras: plan.extras.map(({ clip, media, track }) => ({ track, ...shape(clip, media) })) })).digest('hex');
}

// Render analysis audio as 16 kHz mono WAV. A selection object can additionally
// name clip_ids and a cancellation signal; string source callers stay compatible.
function buildTimelineAudioArgs(project, outWav, selection = 'all') {
  const plan = analysisAudioPlan(project, selection);
  const inputs = [], filters = [], mix = [];
  let n = 0;
  const addInput = (args) => { inputs.push(...args); return n++; };
  const users = [...plan.main.filter((c) => !c.muted).map((c) => ({ clip: c, m: plan.media.get(c.mediaId), lane: 'main' })), ...plan.extras.map(({ clip, media }, j) => ({ clip, m: media, lane: `x${j}` }))];
  const shared = sharedSoundInputs(users.filter(({ clip }) => !enhancePathOf(clip)).map(({ clip, m, lane }) => ({ key: clip, file: m.path, from: clip.in, to: clip.out, lane })), addInput);
  const input = (c) => {
    const enhanced = enhancePathOf(c);
    if (enhanced) return { index: addInput(['-i', enhanced]), enhanced, base: 0 };
    const { idx, base } = shared.get(c);
    return { index: idx, enhanced: null, base };
  };
  const grid = mainGrid(plan.main, positive(project.fps, 30));
  plan.main.forEach((clip, i) => {
    const m = plan.media.get(clip.mediaId);
    const src = !clip.muted ? input(clip) : { index: -1, base: true };
    filters.push(clipAudioFilter(clip, m, src.index, i, src.enhanced ? src.index : -1, src.base, grid[i].s1 - grid[i].s0));
  });
  if (plan.main.length) {
    let label = 'a0';
    for (let i = 1; i < plan.main.length; i++) {
      filters.push(joinAudio(label, `a${i}`, grid[i - 1].s1 - grid[i].s0, `ja${i}`));
      label = `ja${i}`;
    }
    filters.push(`[${label}]aresample=16000,aformat=sample_fmts=fltp:channel_layouts=mono[main]`);
    mix.push('[main]');
  }
  plan.extras.forEach(({ clip: c, media: m }, j) => {
    const { index, enhanced, base } = input(c), len = clipLen(c);
    const up = monoUp(m, !!enhanced);
    const chain = [...sourceAudio(c.out - c.in, enhanced ? 0 : Math.max(0, c.in - base)), ...clipAudioBody(c, len, up)];
    chain.push('aresample=16000', 'aformat=sample_fmts=fltp:channel_layouts=mono', `adelay=${Math.round(Math.max(0, c.start || 0) * 1000)}:all=1`);
    filters.push(`[${index}:a]${chain.join(',')}[x${j}]`);
    mix.push(`[x${j}]`);
  });
  if (mix.length === 1) filters.push(`${mix[0]}aformat=sample_fmts=s16:channel_layouts=mono[out]`);
  else filters.push(`${mix.join('')}amix=inputs=${mix.length}:duration=longest:normalize=0,aformat=sample_fmts=s16:channel_layouts=mono[out]`);
  // Never longer than the timeline, whatever a source stream does past its clip.
  const total = Math.max(mainEnd(plan.main), placedEnd(plan.extras.map(e => e.clip)));
  return ['-y', '-hide_banner', '-loglevel', 'error', ...inputs, '-filter_complex', filters.join(';'), '-map', '[out]', '-ar', '16000', '-t', num(total), outWav];
}

function renderTimelineAudio(project, outWav, source = 'all') {
  return new Promise((resolve, reject) => {
    let args;
    try { args = buildTimelineAudioArgs(project, outWav, source); } catch (e) { return reject(e); }
    const signal = typeof source === 'object' ? source?.signal : undefined;
    if (signal?.aborted) return reject(Object.assign(new Error('Audio analysis stopped.'), { name: 'AbortError' }));
    const run = longGraph(args);
    const p = spawn(ffmpegPath, run.args, { windowsHide: true, ...(signal ? { signal } : {}) });
    let err = '';
    p.stderr.on('data', d => { err = (err + d).slice(-3000); });
    p.on('error', error => { run.done(); if (error.name !== 'AbortError') reject(error); });
    p.on('close', code => { run.done(); code === 0 ? resolve(outWav) : reject(signal?.aborted ? Object.assign(new Error('Audio analysis stopped.'), { name: 'AbortError' }) : new Error(err)); });
  });
}
const renderMainAudio = (project, outWav) => renderTimelineAudio(project, outWav, 'video');

// Silent stretches of the main track's sound, as [{ start, end }] in timeline seconds.
// minDur: shortest silence to report; noiseDb: level below which sound counts as silence.
async function detectSilences(project, { minDur = 0.6, noiseDb = -35, source = 'all', clip_ids, signal } = {}) {
  if (!Number.isFinite(minDur) || minDur < 0.05 || minDur > 60 || !Number.isFinite(noiseDb) || noiseDb < -100 || noiseDb > 0) throw new Error('Use minDur from 0.05 to 60 seconds and noiseDb from -100 to 0.');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fve-sil-'));
  try {
    const wav = await renderTimelineAudio(project, path.join(tmp, 'a.wav'), { source, clip_ids, signal });
    const log = await new Promise((resolve, reject) => {
      const p = spawn(ffmpegPath, ['-hide_banner', '-nostats', '-i', wav, '-af', `silencedetect=noise=${noiseDb}dB:d=${minDur}`, '-f', 'null', '-'], { windowsHide: true, ...(signal ? { signal } : {}) });
      let err = '';
      p.stderr.on('data', (d) => (err += d));
      p.on('error', error => { if (error.name !== 'AbortError') reject(error); });
      p.on('close', code => signal?.aborted ? reject(Object.assign(new Error('Silence analysis stopped.'), { name: 'AbortError' })) : code === 0 ? resolve(err) : reject(new Error(err.slice(-1500))));
    });
    const total = (() => {
      const m = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(log);
      return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : Infinity;
    })();
    const out = [];
    let open = null;
    for (const line of log.split(/\r?\n/)) {
      const a = /silence_start:\s*(-?[\d.]+)/.exec(line);
      if (a) open = Math.max(0, Number(a[1]));
      const b = /silence_end:\s*([\d.]+)/.exec(line);
      if (b && open !== null) {
        out.push({ start: open, end: Number(b[1]) });
        open = null;
      }
    }
    if (open !== null) out.push({ start: open, end: total }); // silence that lasts until the end
    return out;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// project: { width, height, fps, background, media[], videoClips[], textClips[], audioClips[] }
// Size of a picture fitted inside the W x H frame (even numbers), as the layered path and the effects pass use.
function fitSize(m, W, H) {
  const mw = (m && m.width) || W;
  const mh = (m && m.height) || H;
  const k = Math.min(W / mw, H / mh);
  const even = (n) => Math.max(2, Math.round(n / 2) * 2);
  return { fw: even(mw * k), fh: even(mh * k) };
}

// Input options for a still picture shown for `len` seconds. "-loop 1" only exists for still image files; a GIF
// (often animated) is read by FFmpeg's GIF reader, which loops with -stream_loop instead (and plays its animation,
// like the player does).
function stillInput(file, fps, len) {
  if (/\.gif$/i.test(file)) return ['-stream_loop', '-1', '-t', num(len), '-i', file];
  return ['-loop', '1', '-framerate', String(fps), '-t', num(len), '-i', file];
}

// A copy of a clip limited to [from, to] seconds of its own timeline (for the frames of a transition).
function narrowClip(clip, m, from, to) {
  const c = { ...clip, transition: null };
  if (clip.gap) return { ...c, in: 0, out: to - from, speed: 1 };
  if (clip.videoOverride) return { ...c, in: clip.in + from * speedOf(clip), out: clip.in + to * speedOf(clip),
    videoOverride: { ...clip.videoOverride, start: clip.videoOverride.start + from, end: clip.videoOverride.start + to } };
  if (m.type === 'image') return { ...c, in: 0, out: to - from, speed: 1 };
  const sp = speedOf(clip);
  return { ...c, in: clip.in + from * sp, out: clip.in + to * sp };
}

// Adds the picture input of a clip and returns a filter chain prefix "[n:v]trim...," that gives its frames at
// the clip's own timing. clip.videoOverride ({ file, start, end } in timeline seconds) replaces the media by a file
// the animated-effects pass rendered.
// shift: seconds added to the clip's clock, so that its picture lies at its exact timeline time on
// the frame grid its stream starts on (the stream starts on the nearest frame, see mainGrid).
// shared: { idx, base } of an input this clip shares with its neighbours (sharedPictureInputs), else its own.
function pictureSource(clip, m, len, fps, addInput, filters, tag, W, H, shift = 0, shared = null) {
  // Perf B1: media inputs are input-seeked (-ss before -i) to the clip's first frame and
  // the trim runs from 0 — the encoder never decodes the skipped prefix (measured at
  // +48% export time for a clip starting 55 min into its source). `audioSeeked` tells
  // the caller whether THIS input also carries the clip's (already seeked) audio.
  if (clip.videoOverride) {
    const o = clip.videoOverride;
    if (o.segments) {
      const spans = [], start = o.start || 0, end = o.end;
      let at = start;
      for (const segment of [...o.segments].sort((a, b) => a.from - b.from)) {
        const from = Math.max(start, segment.from), to = Math.min(end, segment.to);
        if (to <= from) continue;
        if (from > at + 1e-7) spans.push({ from: at, to: from });
        spans.push({ ...segment, from, to, fileStart: from - segment.from });at = to;
      }
      if (at < end - 1e-7) spans.push({ from: at, to: end });
      const { fw, fh } = fitSize(m, W, H);
      const labels = [];
      let first;
      spans.forEach((span, i) => {
        const frames = Math.ceil((span.to - start) * fps - 1e-7) - Math.ceil((span.from - start) * fps - 1e-7);
        if (frames <= 0) return;
        const duration = span.to - span.from, speed = positive(o.sourceSpeed, speedOf(clip));
        const idx = span.file ? addInput(['-ss', num(seekTo(span.fileStart || 0)), '-i', span.file])
          : m.type === 'image' ? addInput(stillInput(m.path, fps, duration))
          : addInput(['-ss', num(seekTo((o.sourceIn ?? clip.in - start * speed) + span.from * speed)), '-i', m.path]);
        first ??= idx;
        const sourceDuration = span.file || m.type === 'image' ? duration : duration * speed;
        const clock = span.file || m.type === 'image' ? 'PTS-STARTPTS' : `(PTS-STARTPTS)/${speed}`;
        const label = `part${tag}_${i}`;labels.push(`[${label}]`);
        // Each concatenated interval owns explicit frame boundaries. fps alone
        // can drop its last frame at EOF (notably a two-frame source gap next
        // to an effect), shortening transition inputs and shifting later spans.
        filters.push(`[${idx}:v]trim=duration=${num(sourceDuration)},setpts=${clock}${!span.file ? matrixIn(m) + toSdr(m) : ''},fps=${fps},tpad=stop_mode=clone:stop_duration=1,trim=end_frame=${frames},setpts=N/(${fps}*TB),scale=${fw}:${fh},setsar=1,format=rgba[${label}]`);
      });
      const label = `parts${tag}`;
      filters.push(`${labels.join('')}${labels.length > 1 ? `concat=n=${labels.length}:v=1:a=0` : 'null'}[${label}]`);
      return { idx: first, chain: `[${label}]null`, own: false, audioSeeked: false };
    }
    const idx = addInput(['-ss', num(seekTo(o.start)), '-i', o.file]);
    return { idx, chain: `[${idx}:v]trim=duration=${num(o.end - o.start)},setpts=PTS-STARTPTS`, own: false, audioSeeked: false };
  }
  if (m.type === 'image') {
    const idx = addInput(stillInput(m.path, fps, len));
    return { idx, chain: `[${idx}:v]trim=duration=${num(len)},setpts=PTS-STARTPTS${colorLutFilter(clip, m, W, H)}`, own: true, audioSeeked: false };
  }
  // The source frames keep their own times from clip.in (the first one can lie after it on an
  // off-grid cut): resetting them to start at 0 moved the picture up to a frame early.
  // A shared input starts at `base` (at or before seekTo(clip.in)): the trim skips to where the clip's own seek
  // would have started it, so the same frames are kept and timed alike.
  if (shared) {
    const skip = seekTo(clip.in) - shared.base;
    return { idx: shared.idx, chain: `[${shared.idx}:v]trim=${skip > 1e-7 ? `start=${sec6(skip)}:` : ''}duration=${num(clip.out - clip.in)},setpts=(PTS-${sec6(clip.in - shared.base)}/TB)/${speedOf(clip)}+${sec6(shift)}/TB${matrixIn(m)}${toSdr(m)}${colorLutFilter(clip, m, W, H)}`, own: true, audioSeeked: shared.base };
  }
  const idx = addInput(['-ss', num(seekTo(clip.in)), '-i', m.path]);
  return { idx, chain: `[${idx}:v]trim=duration=${num(clip.out - clip.in)},setpts=(PTS-${sec6(seekRest(clip.in))}/TB)/${speedOf(clip)}+${sec6(shift)}/TB${matrixIn(m)}${toSdr(m)}${colorLutFilter(clip, m, W, H)}`, own: true, audioSeeked: true };
}

// A colour-only look baked into a 3D LUT (electron/export/fxjobs.cjs lut): applied where the
// effects pass would have shaded the frames (fitted, straight RGBA), so what follows sees the
// same picture as with a pre-rendered file. Measured identical to the GPU path on both picture
// paths; the plain one stays plain (layering it cost 15% export time for nothing).
// A path as a quoted option value. The graph parser keeps everything between quotes (a backslash
// there is literal) and the option parser then unescapes \: and \'; so a quote in the path closes
// the quoting, is escaped for both parsers, and reopens it. A bare \' would end the quoting.
const escapeFilterPath = file => String(file).replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'\\''");
function colorLutFilter(clip, m, W, H) {
  if (!clip.colorLut?.file || W == null) return '';
  const { fw, fh } = fitSize(m, W, H);
  return `,scale=${fw}:${fh},setsar=1,format=rgba,lut3d=file='${escapeFilterPath(clip.colorLut.file)}':interp=tetrahedral`;
}

// opts.raw: only the main track's picture, as raw RGBA frames on stdout (frames for the effects pass).
// opts.encoder: H.264 encoder (see pickEncoder); libx264 when not given.
function buildExportArgs(project, outFile, opts = {}) {
  for(let i=1;i<(project.videoClips||[]).length;i++){const clip=project.videoClips[i];
    if(typeof clip.transition?.type==='string'&&clip.transition.type.startsWith('plugin-transition:')&&transitionDur(project.videoClips,i)>0&&!project.fxSegments?.[clip.id])throw Error('Plugin transitions must be rendered by the effects pass before encoding.');
  }
  const eff = effectiveExport(project), W = eff.outW, H = eff.outH;
  const fps = Math.min(positive(project.fps, 30), eff.outFps);
  const bg = project.background || '#000000';
  const mediaById = Object.fromEntries(project.media.map((m) => [m.id, m]));
  const inputs = [];
  const filters = [];
  let nInputs = 0;
  const addInput = (args) => { inputs.push(...args); return nInputs++; };

  const clips = timedMain(project.videoClips.filter((c) => c.gap || mediaById[c.mediaId]));
  if (clips.length === 0) throw new Error('The video track is empty.');

  // 1) Main track: prepare each clip (trim, speed, size, look) with a matching audio stream.
  // Every clip's picture ends on exactly its frame count on the output grid, and its sound on its sample count.
  const grid = mainGrid(clips, fps);
  const sharedPictures = sharedPictureInputs(clips.filter((c) => !c.gap && !c.videoOverride && mediaById[c.mediaId].type !== 'image')
    .map((c) => ({ key: c, file: mediaById[c.mediaId].path, from: c.in, to: c.out })), addInput);
  clips.forEach((clip, i) => {
    const m = mediaById[clip.mediaId];
    const len = clipLen(clip);
    const fit = exactFrames(grid[i].f1 - grid[i].f0, fps), samples = grid[i].s1 - grid[i].s0;
    if (clip.gap) {
      // A gap on the main track: the project background, in silence.
      filters.push(`color=c=${hex(bg, '#000000')}:s=${W}x${H}:r=${fps}:d=${num(len)},format=yuv420p,${fit}[v${i}]`);
      if (!opts.raw) filters.push(clipAudioFilter(clip, null, -1, i, -1, false, samples));
      return;
    }
    // Clips with a transform, mask, chroma key, opacity or blend go through the layered render; the rest keep the plain path.
    const motion = project.motion && project.motion[clip.id];
    // Shader intermediates carry straight RGBA. Composite through the explicit
    // BT.709 layer path for both full clips and partial ranges, preserving alpha
    // and avoiding an implicit BT.601 RGB conversion before BT.709 output tags.
    // Transparent media composite over the project background there too, as the preview shows them.
    const layered = layers.isLayered(clip, motion) || !!clip.videoOverride || mayHaveAlpha(m);
    const maskFile = project.maskFiles && project.maskFiles[clip.id];
    const renderLayered = (srcLabel) => {
      const tag = `m${i}`;
      const maskIdx = maskFile ? addInput(['-loop', '1', '-framerate', String(fps), '-t', num(len), '-i', maskFile]) : null;
      const decoFile = maskFile && project.decoFiles && project.decoFiles[clip.id];
      const decoIdx = decoFile ? addInput(['-loop', '1', '-framerate', String(fps), '-t', num(len), '-i', decoFile]) : null;
      const cmFile = project.customMaskFiles && project.customMaskFiles[clip.id];
      const customMaskIdx = cmFile ? addInput(['-loop', '1', '-framerate', String(fps), '-t', num(len), '-i', cmFile]) : null;
      const layer = layers.buildLayer({ clip, media: m, W, H, fps, len, tag, srcLabel, maskIdx, decoIdx, motion, customMaskIdx }, { lookFilters, num, hex });
      filters.push(...layer.filters);
      filters.push(`color=c=${hex(bg, '#000000')}:s=${W}x${H}:r=${fps}:d=${num(len)},format=yuv420p[bg${tag}]`);
      filters.push(...layers.composite({ base: `bg${tag}`, layer: layer.out, blend: clip.blend, tag, out: `vl${i}` }));
      filters.push(`[vl${i}]${fit}[v${i}]`);
    };
    const src = pictureSource(clip, m, len, fps, addInput, filters, `m${i}`, W, H, grid[i].start - grid[i].f0 / fps, sharedPictures.get(clip));
    if (layered) {
      filters.push(`${src.chain},fps=${fps}:start_time=0,tpad=stop_mode=clone:stop=1[s${i}]`);
      renderLayered(`s${i}`);
    } else {
      filters.push(`${src.chain},${clipVideoFilters(clip, W, H, fps, bg)},${fit}[v${i}]`);
    }
    // Sound comes from the media even when the picture was pre-rendered. A dedicated
    // audio input (picture came from an override file) is input-seeked too (B1).
    const audioIdx = src.own || m.type === 'image' || !m.hasAudio || clip.muted ? src.idx : addInput(['-ss', num(seekTo(clip.in)), '-i', m.path]);
    const enhP = !opts.raw && enhancePathOf(clip);
    const enhIdx = enhP ? addInput(['-i', enhP]) : -1;
    if (!opts.raw) filters.push(clipAudioFilter(clip, m, src.own ? src.idx : audioIdx, i, enhIdx, src.own ? (typeof src.audioSeeked === 'number' ? src.audioSeeked : !!src.audioSeeked) : true, samples));
  });

  // 2) Join clips: xfade/acrossfade where a transition is set, plain concat otherwise. A transition
  // spans the frames (and samples) where the two clips' grid positions overlap.
  let cv = 'v0';
  let ca = 'a0';
  for (let i = 1; i < clips.length; i++) {
    const g = grid[i], tf = grid[i - 1].f1 - g.f0;
    const seg = tf > 0 && project.fxSegments && project.fxSegments[clips[i].id];
    if (seg) {
      // Animated transition rendered by the effects pass: what came before, the transition, the rest of the clip.
      const sIdx = addInput(['-i', seg]);
      filters.push(
        `[${cv}]trim=end_frame=${g.f0},setpts=PTS-STARTPTS,setsar=1[jA${i}]`,
        `[${sIdx}:v]trim=duration=${num(grid[i - 1].end - g.start)},setpts=PTS-STARTPTS,fps=${fps},scale=${W}:${H},setsar=1,format=rgba,${layers.TO_YUV709},${exactFrames(tf, fps)}[jT${i}]`,
        `[v${i}]trim=start_frame=${tf},setpts=PTS-STARTPTS,setsar=1[jB${i}]`,
        `[jA${i}][jT${i}][jB${i}]concat=n=3:v=1:a=0[jv${i}]`,
      );
    } else if (tf > 0) {
      // xfade needs both inputs on the same time base (after an animated transition the video so far has another one).
      filters.push(
        `[${cv}]settb=1/${fps}[xa${i}]`, `[v${i}]settb=1/${fps}[xb${i}]`,
        `[xa${i}][xb${i}]xfade=transition=${xfadeName(clips[i].transition.type)}:duration=${sec6(tf / fps)}:offset=${sec6(g.f0 / fps)}[jv${i}]`,
      );
    } else {
      filters.push(`[${cv}][v${i}]concat=n=2:v=1:a=0[jv${i}]`);
    }
    filters.push(joinAudio(ca, `a${i}`, grid[i - 1].s1 - g.s0, `ja${i}`));
    cv = `jv${i}`;
    ca = `ja${i}`;
  }
  const total = grid[grid.length - 1].end;
  if (opts.raw) {
    const frames = Math.max(1, grid[grid.length - 1].f1);
    filters.push(`[${cv}]tpad=stop_mode=clone:stop_duration=1,trim=end_frame=${frames},setpts=N/(${fps}*TB)[rawframes]`);
    return {
      args: ['-y', '-hide_banner', '-loglevel', 'error', ...inputs, '-filter_complex', filters.join(';'),
        '-map', '[rawframes]', '-frames:v', String(frames), '-f', 'rawvideo', '-pix_fmt', 'rgba', 'pipe:1'],
      total,
    };
  }
  const overlayAudio = [];
  let rgbComposited = false;

  // 3) Overlay clips (picture in picture): layered like main clips, padded in time to the whole video, composited in order.
  (project.overlayClips || []).filter((c) => timed(c) && mediaById[c.mediaId] && mediaById[c.mediaId].type !== 'audio').forEach((c, j) => {
    const m = mediaById[c.mediaId];
    const sp = speedOf(c);
    const len = (c.out - c.in) / sp;
    const start = Math.max(0, c.start);
    if (start >= total - 0.01) return;
    const tag = `o${j}`;
    const startFrame = Math.round(start * fps);
    const src = pictureSource(c, m, len, fps, addInput, filters, `o${j}`, W, H, start - startFrame / fps);
    // A trim/speed conversion can end between frame ticks (especially an EOF
    // trim of reversed media). Give the layer's timed canvas a final picture to
    // sample rather than allowing shortest=1 to truncate every following layer.
    filters.push(`${src.chain},fps=${fps}:start_time=0,tpad=stop_mode=clone:stop=1[os${j}]`);
    const idx = src.own ? src.idx : m.hasAudio && !c.muted && m.type === 'video' ? addInput(['-ss', num(seekTo(c.in)), '-i', m.path]) : src.idx;
    const maskFile = project.maskFiles && project.maskFiles[c.id];
    const maskIdx = maskFile ? addInput(['-loop', '1', '-framerate', String(fps), '-t', num(len), '-i', maskFile]) : null;
    const decoFile = maskFile && project.decoFiles && project.decoFiles[c.id];
    const decoIdx = decoFile ? addInput(['-loop', '1', '-framerate', String(fps), '-t', num(len), '-i', decoFile]) : null;
    const cmFile = project.customMaskFiles && project.customMaskFiles[c.id];
    const customMaskIdx = cmFile ? addInput(['-loop', '1', '-framerate', String(fps), '-t', num(len), '-i', cmFile]) : null;
    const motion = project.motion && project.motion[c.id];
    const layer = layers.buildLayer({ clip: c, media: m, W, H, fps, len, tag, srcLabel: `os${j}`, maskIdx, decoIdx, motion, customMaskIdx }, { lookFilters, num, hex });
    filters.push(...layer.filters);
    // Transparent frames before and after, so the layer lines up with the video frame for frame.
    const after = Math.max(0, total - start - len);
    filters.push(`[${layer.out}]tpad=start=${startFrame}:stop_duration=${num(after)}:start_mode=add:stop_mode=add:color=black@0,trim=duration=${num(total)}[op${j}]`);
    filters.push(...layers.composite({ base: cv, layer: `op${j}`, blend: c.blend, tag, out: `ov${j}`, rgb: true, active:[start,start+len] }));
    cv = `ov${j}`;
    rgbComposited = true;
    if (m.hasAudio && !c.muted && m.type === 'video') {
      const enhP = enhancePathOf(c);
      overlayAudio.push({ idx: enhP ? addInput(['-i', enhP]) : idx, c, len, start, sp, enh: !!enhP });
    }
  });

  // 4) Text layer: frames drawn by the UI's canvas text renderer (same code as the preview), packed in text.mov.
  if (project.textOverlay && project.textOverlay.count > 0) {
    const idx = addInput(['-i', project.textOverlay.file]);
    filters.push(`[${idx}:v]scale=${W}:${H},format=rgba[txt]`);
    filters.push(`[${cv}][txt]overlay=0:0:eof_action=pass:format=auto,format=rgba[tv]`);
    cv = 'tv';
    rgbComposited = true;
  }

  // 5) Music track and overlay sound: trim, fade, delay to timeline position, mix with the main audio.
  const music = project.audioClips.filter((c) => !c.muted && timed(c) && mediaById[c.mediaId]);
  const mixLabels = [`[${ca}]`];
  music.forEach((c, j) => {
    const enhP = enhancePathOf(c);
    // B1: the media input is input-seeked to c.in (the enhanced render is pre-trimmed),
    // so the trim runs from 0 in both cases.
    const idx = addInput(enhP ? ['-i', enhP] : ['-ss', num(seekTo(c.in)), '-i', mediaById[c.mediaId].path]);
    const len = (c.out - c.in) / speedOf(c); // timeline length (audio clips carry a speed, e.g. detached ones)
    const delay = Math.round(Math.max(0, c.start) * 1000);
    const up = monoUp(mediaById[c.mediaId], !!enhP);
    const chain = [...sourceAudio(c.out - c.in, enhP ? 0 : seekRest(c.in)), ...clipAudioBody(c, len, up), `adelay=${delay}|${delay}`];
    filters.push(`[${idx}:a]${chain.join(',')}[m${j}]`);
    mixLabels.push(`[m${j}]`);
  });
  overlayAudio.forEach(({ idx, c, len, start, sp, enh }, j) => {
    const delay = Math.round(Math.max(0, start) * 1000);
    const up = monoUp(mediaById[c.mediaId], !!enh);
    // B1: idx always names an input seeked to c.in (or the pre-trimmed enhanced render),
    // so the trim runs from 0.
    const chain = [...sourceAudio(c.out - c.in, enh ? 0 : seekRest(c.in)), ...clipAudioBody({ ...c, speed: sp }, len, up), `adelay=${delay}|${delay}`];
    filters.push(`[${idx}:a]${chain.join(',')}[oa${j}]`);
    mixLabels.push(`[oa${j}]`);
  });
  if (mixLabels.length > 1) {
    filters.push(`${mixLabels.join('')}amix=inputs=${mixLabels.length}:duration=first:normalize=0[amix]`);
    ca = 'amix';
  }

  // All layers were rasterized at output size/FPS. Only an explicit frame-rate
  // increase remains: duplicate the timeline frames after composition.
  let outLabel = cv;
  const stage = [];
  if (eff.outW !== W || eff.outH !== H) stage.push(`scale=${eff.outW}:${eff.outH}:flags=lanczos`);
  if (eff.outFps !== fps) stage.push(`fps=${eff.outFps}`);
  // Convert the fully composited RGB picture once. Intermediate YUV conversions
  // amplify rounding and color-matrix errors even for transparent overlays.
  if (rgbComposited) stage.push(layers.TO_YUV709);
  // Framesync can omit the final frame's duration after compositing. Sample the
  // same exact output grid as the raw render path, retaining the last picture
  // through the final tick instead of ending early while audio continues.
  const outputFrames = Math.max(1, Math.round(total * eff.outFps));
  stage.push('tpad=stop_mode=clone:stop_duration=1', `trim=end_frame=${outputFrames}`, `setpts=N/(${eff.outFps}*TB)`);
  if (stage.length) { filters.push(`[${cv}]${stage.join(',')}[ovfinal]`); outLabel = 'ovfinal'; }

  const args = [
    '-y', '-hide_banner',
    ...inputs,
    '-filter_complex', filters.join(';'),
    '-map', `[${outLabel}]`, '-map', `[${ca}]`,
    ...videoCodec2(opts.encoder, eff), '-pix_fmt', 'yuv420p',
    // The filter graph owns the exact output grid, but some FFmpeg builds lose
    // its rate metadata through framesync/setpts and otherwise encode at 25 fps.
    '-r', String(eff.outFps),
    // The pipeline works in BT.709 SDR throughout (HDR inputs are tone-mapped to BT.709 above);
    // tag it explicitly — untagged yuv420p otherwise probes as color_* "unknown".
    '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-color_range', 'tv',
    '-c:a', videoFormat(eff.format).audioCodec, '-b:a', `${eff.audioKbps}k`,
    '-t', num(total),
    ...(['mp4','mov'].includes(eff.format)?['-movflags', '+faststart']:[]),
    '-progress', 'pipe:1', '-nostats',
    '-f',videoFormat(eff.format).muxer,outFile,
  ];
  return { args, total };
}

// Audio-only export: main track (with crossfades), overlay sound and the audio track, mixed like the video export.
// format: 'mp3' | 'wav' | 'm4a'.
function buildAudioExportArgs(project, outFile, format = 'mp3') {
  const mediaById = Object.fromEntries(project.media.map((m) => [m.id, m]));
  const inputs = [];
  const filters = [];
  const mix = [];
  let n = 0;
  const addInput = (args) => { inputs.push(...args); return n++; };
  let sound = false;

  const clips = timedMain(project.videoClips.filter((c) => c.gap || mediaById[c.mediaId]));
  const overlays = (project.overlayClips || []).filter(timed), tracks = (project.audioClips || []).filter(timed);
  const mainHas = (clip) => { const m = mediaById[clip.mediaId]; return !!(m && m.type === 'video' && m.hasAudio && !clip.muted && !clip.gap); };
  const overlayHas = (c) => { const m = mediaById[c.mediaId]; return !!(m && m.type === 'video' && m.hasAudio && !c.muted); };
  // Main-track clips share inputs; each overlay or audio-track clip keeps its own (they play over the main track).
  const users = [...clips.filter(mainHas).map((c) => [c, 'main']), ...overlays.filter(overlayHas).map((c, j) => [c, `o${j}`]), ...tracks.filter((c) => !c.muted && mediaById[c.mediaId]).map((c, j) => [c, `t${j}`])].filter(([c]) => !enhancePathOf(c));
  const shared = sharedSoundInputs(users.map(([c, lane]) => ({ key: c, file: mediaById[c.mediaId].path, from: c.in, to: c.out, lane })), addInput);
  if (clips.length) {
    const grid = mainGrid(clips, positive(project.fps, 30));
    clips.forEach((clip, i) => {
      const m = mediaById[clip.mediaId];
      const has = mainHas(clip);
      if (has) sound = true;
      const enhP = has && enhancePathOf(clip);
      // B1: a shared input seeked near the clip (an enhanced clip reads only its render); the trim starts at the clip.
      const src = has && !enhP ? shared.get(clip) : null;
      filters.push(clipAudioFilter(clip, m, src ? src.idx : -1, i, enhP ? addInput(['-i', enhP]) : -1, src ? src.base : true, grid[i].s1 - grid[i].s0));
    });
    let ca = 'a0';
    for (let i = 1; i < clips.length; i++) {
      filters.push(joinAudio(ca, `a${i}`, grid[i - 1].s1 - grid[i].s0, `ja${i}`));
      ca = `ja${i}`;
    }
    mix.push(`[${ca}]`);
  }
  overlays.forEach((c, j) => {
    const m = mediaById[c.mediaId];
    if (!overlayHas(c)) return;
    sound = true;
    const delay = Math.round(Math.max(0, c.start) * 1000);
    const enhP = enhancePathOf(c);
    const upO = monoUp(m, !!enhP);
    const src = enhP ? { idx: addInput(['-i', enhP]), base: 0 } : shared.get(c);
    filters.push(`[${src.idx}:a]${[...sourceAudio(c.out - c.in, enhP ? 0 : Math.max(0, c.in - src.base)), ...clipAudioBody(c, clipLen(c), upO)].join(',')},adelay=${delay}|${delay}[oa${j}]`);
    mix.push(`[oa${j}]`);
  });
  tracks.filter((c) => !c.muted && mediaById[c.mediaId]).forEach((c, j) => {
    sound = true;
    const len = (c.out - c.in) / speedOf(c);
    const delay = Math.round(Math.max(0, c.start) * 1000);
    const enhP = enhancePathOf(c);
    const up = monoUp(mediaById[c.mediaId], !!enhP);
    const src = enhP ? { idx: addInput(['-i', enhP]), base: 0 } : shared.get(c);
    const chain = [...sourceAudio(c.out - c.in, enhP ? 0 : Math.max(0, c.in - src.base)), ...clipAudioBody(c, len, up)];
    filters.push(`[${src.idx}:a]${chain.join(',')},adelay=${delay}|${delay}[m${j}]`);
    mix.push(`[m${j}]`);
  });
  if (!sound) throw new Error('Nothing to export: no clip on the timeline has sound.');
  filters.push(mix.length === 1 ? `${mix[0]}anull[out]` : `${mix.join('')}amix=inputs=${mix.length}:duration=longest:normalize=0[out]`);
  const codec = { mp3: ['-c:a', 'libmp3lame', '-b:a', '192k'], wav: ['-c:a', 'pcm_s16le'], m4a: ['-c:a', 'aac', '-b:a', '192k'] }[format];
  if (!codec) throw new Error(`Unknown audio format: ${format}`);
  // Bounded by the timeline (main track, overlays, audio track), like the video export's -t.
  const total = Math.max(mainEnd(clips), placedEnd([...overlays, ...tracks]));
  return ['-y', '-hide_banner', '-loglevel', 'error', ...inputs, '-filter_complex', filters.join(';'), '-map', '[out]', ...codec, '-t', num(total), outFile];
}

async function exportAudio(project, outFile, format = 'mp3') {
  const { exportTargetProblem } = require('../export/exportTarget.cjs');
  const args = buildAudioExportArgs(project, outFile, format);
  const mediaPaths = [...project.media.map(m => m.path), ...args.filter((_, i) => args[i - 1] === '-i')];
  const checkTarget = () => {
    if (exportTargetProblem({ file: outFile, mediaPaths, confirmed: outFile })) {
      throw Error(t('main.export_target_is_source', { name: path.basename(outFile) }));
    }
  };
  checkTarget();
  const dir = fs.mkdtempSync(path.join(path.dirname(outFile), '.clipcraft-audio-'));
  try {
    const workingFile = path.join(dir, path.basename(outFile));
    args[args.length - 1] = workingFile;
    await runFfmpeg(graphFile(args, dir));
    checkTarget();
    fs.renameSync(workingFile, outFile);
    return outFile;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// A run's arguments with a long filter graph moved to a file (graphFile) in a folder of its own; done() removes it.
function longGraph(args) {
  const i = args.indexOf('-filter_complex');
  if (i < 0 || args[i + 1].length < 20000) return { args, done: () => {} };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clipcraft-graph-'));
  return { args: graphFile(args, dir), done: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

// Windows limits a command line to 32767 characters: a long filter graph (many clips) goes in a file.
function graphFile(args, dir = os.tmpdir()) {
  const i = args.indexOf('-filter_complex');
  if (i < 0 || args[i + 1].length < 20000) return args;
  const file = path.join(dir, `fve-graph-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.txt`);
  fs.writeFileSync(file, args[i + 1]);
  return [...args.slice(0, i), '-filter_complex_script', file, ...args.slice(i + 2)];
}

// Runs the export; onProgress receives a 0..1 fraction. Returns { promise, cancel }.
// ---- Video encoder: the graphics card's H.264 encoder when one works, else libx264 on the CPU ----
// A hardware encoder is faster and leaves the processor free, at about the same quality (its quality number is a
// few steps above the CRF to match: h264_qsv at 23 measured like libx264 veryfast at CRF 20).
// ---- Export quality: the effective settings the renderer resolved (src/features/export/exportQuality.js) and stamped
// onto the project as project.export. Consumed here verbatim (validated + clamped); projects without a
// stamp (older saves, smoke fixtures) fall back to the historical behavior: CRF (project.crf || 20),
// veryfast, AAC 192k, project size and fps.
const X264_PRESETS = ['ultrafast', 'superfast', 'veryfast', 'faster', 'fast', 'medium', 'slow', 'slower', 'veryslow'];
function effectiveExport(project) {
  const e = project.export;
  const W = Math.round(positive(project.width, 1280));
  const H = Math.round(positive(project.height, 720));
  const fps = positive(project.fps, 30);
  if (!e || typeof e !== 'object') {
    return { format:'mp4',codecFamily: 'h264', mode: 'crf', crf: Math.min(51, Math.max(0, positive(project.crf, 20))), bitrateMbps: null, encoderPreset: 'veryfast', audioKbps: 192, outW: W, outH: H, outFps: fps };
  }
  const clampN = (v, lo, hi, dflt) => (Number.isFinite(Number(v)) ? Math.min(hi, Math.max(lo, Number(v))) : dflt);
  const format=videoFormat(e.format??'mp4'),codec=e.codecFamily??format.codecs[0];
  if(!format.codecs.includes(codec))throw Error('Video codec is incompatible with the selected export format');
  return {
    format:format.id,codecFamily:codec,
    mode: e.mode === 'bitrate' ? 'bitrate' : 'crf',
    crf: clampN(e.crf, 0, codec==='vp9'?63:51, 20),
    bitrateMbps: e.bitrateMbps == null ? null : clampN(e.bitrateMbps, 0.5, 100, 12),
    encoderPreset: X264_PRESETS.includes(e.encoderPreset) ? e.encoderPreset : 'veryfast',
    audioKbps: clampN(e.audioKbps, 32, 512, 192),
    // Never upscale, whatever a stamp claims: the cap can only shrink the project frame.
    outW: Math.max(2, Math.min(W, Math.round(positive(e.outW, W)))),
    outH: Math.max(2, Math.min(H, Math.round(positive(e.outH, H)))),
    outFps: clampN(e.outFps, 1, 240, fps),
  };
}

// Which encoders the bundled FFmpeg actually has (checked once, synchronously — buildExportArgs is sync).
let encoderSet = null;
const parseEncoders = (out) => {
  const set = new Set();
  for (const line of String(out).split('\n')) {
    const m = line.trim().match(/^\S+\s+(\S+)\s/);
    if (m) set.add(m[1]);
  }
  return set;
};
// The same probe without blocking the main process: run at startup, so the first synchronous
// hasEncoder() (export settings, the encoder pick) finds the answer ready.
let warming = null;
function warmEncoders() {
  if (encoderSet) return Promise.resolve();
  warming ||= new Promise((resolve) => {
    execFile(ffmpegPath, ['-hide_banner', '-encoders'], { windowsHide: true, maxBuffer: 8 << 20 }, (error, stdout) => {
      if (!encoderSet) encoderSet = error ? new Set() : parseEncoders(stdout);
      resolve();
    });
  });
  return warming;
}
function hasEncoder(name) {
  if (!encoderSet) {
    encoderSet = new Set();
    try {
      const out = execFileSync(ffmpegPath, ['-hide_banner', '-encoders'], { windowsHide: true }).toString();
      for (const line of out.split('\n')) {
        const m = line.trim().match(/^\S+\s+(\S+)\s/);
        if (m) encoderSet.add(m[1]);
      }
    } catch { /* empty set: everything falls back to libx264 */ }
  }
  return encoderSet.has(name);
}
const hasLibx265 = () => hasEncoder('libx265');
const hasVp9=()=>hasEncoder('libvpx-vp9')&&hasEncoder('libopus');

const HW_ENCODERS = {
  h264_videotoolbox: (crf) => ['-c:v', 'h264_videotoolbox', '-allow_sw', '0', '-q:v', String(Math.max(1, Math.round((51 - crf) / 51 * 100)))],
  h264_nvenc: (crf) => ['-c:v', 'h264_nvenc', '-preset', 'p4', '-rc', 'vbr', '-cq', String(crf + 3), '-b:v', '0'],
  h264_qsv: (crf) => ['-c:v', 'h264_qsv', '-preset', 'veryfast', '-global_quality', String(crf + 3)],
  h264_amf: (crf) => ['-c:v', 'h264_amf', '-quality', 'speed', '-rc', 'cqp', '-qp_i', String(crf + 2), '-qp_p', String(crf + 2)],
};
// The full codec argument set for an effective export config. Hardware encoders get their mapped
// equivalents of the same intent: NVENC preset levels p1..p7 for the x264 speed names, QSV takes the
// names directly, AMF collapses to its three quality levels; rate control follows the mode (CQ for
// CRF intent, a plain target bitrate for bitrate intent). macOS probes VideoToolbox
// for both codec families; software HEVC uses libx265 when it is available.
const NVENC_PRESET = { ultrafast: 'p1', superfast: 'p1', veryfast: 'p2', faster: 'p2', fast: 'p3', medium: 'p4', slow: 'p5', slower: 'p6', veryslow: 'p7' };
function videoCodec2(encoder, eff) {
  if(eff.codecFamily==='vp9')return ['-c:v','libvpx-vp9','-deadline','good','-cpu-used',String({ultrafast:5,superfast:5,veryfast:4,faster:4,fast:3,medium:2,slow:1,slower:0,veryslow:0}[eff.encoderPreset]??4),'-row-mt','1',...(eff.mode==='bitrate'?['-b:v',`${eff.bitrateMbps}M`]:['-crf',String(eff.crf),'-b:v','0'])];
  if (encoder === 'h264_videotoolbox' || encoder === 'hevc_videotoolbox') {
    return ['-c:v', encoder, '-allow_sw', '0',
      ...(eff.mode === 'bitrate' ? ['-b:v', `${eff.bitrateMbps}M`] : ['-q:v', String(Math.max(1, Math.round((51 - eff.crf) / 51 * 100)))]),
      ...(encoder === 'hevc_videotoolbox' ? ['-tag:v', 'hvc1'] : [])];
  }
  if (eff.codecFamily === 'h265' && hasLibx265()) {
    const rate = eff.mode === 'bitrate' ? ['-b:v', `${eff.bitrateMbps}M`] : ['-crf', String(eff.crf)];
    return ['-c:v', 'libx265', '-preset', eff.encoderPreset, ...rate, '-tag:v', 'hvc1'];
  }
  const rate = eff.mode === 'bitrate'
    ? { hw: ['-b:v', `${eff.bitrateMbps}M`], sw: ['-b:v', `${eff.bitrateMbps}M`, '-maxrate', `${eff.bitrateMbps}M`, '-bufsize', `${eff.bitrateMbps * 2}M`] }
    : null;
  if (encoder === 'h264_nvenc') {
    return eff.mode === 'bitrate'
      ? ['-c:v', 'h264_nvenc', '-preset', NVENC_PRESET[eff.encoderPreset], '-rc', 'vbr', ...rate.hw]
      : ['-c:v', 'h264_nvenc', '-preset', NVENC_PRESET[eff.encoderPreset], '-rc', 'vbr', '-cq', String(eff.crf + 3), '-b:v', '0'];
  }
  if (encoder === 'h264_qsv') {
    return eff.mode === 'bitrate'
      ? ['-c:v', 'h264_qsv', '-preset', eff.encoderPreset, ...rate.hw]
      : ['-c:v', 'h264_qsv', '-preset', eff.encoderPreset, '-global_quality', String(eff.crf + 3)];
  }
  if (encoder === 'h264_amf') {
    const quality = ['slow', 'slower', 'veryslow'].includes(eff.encoderPreset) ? 'quality' : eff.encoderPreset === 'medium' ? 'balanced' : 'speed';
    return eff.mode === 'bitrate'
      ? ['-c:v', 'h264_amf', '-quality', quality, '-rc', 'vbr_peak', ...rate.hw]
      : ['-c:v', 'h264_amf', '-quality', quality, '-rc', 'cqp', '-qp_i', String(eff.crf + 2), '-qp_p', String(eff.crf + 2)];
  }
  return ['-c:v', 'libx264', '-preset', eff.encoderPreset, ...(eff.mode === 'bitrate' ? rate.sw : ['-crf', String(eff.crf)])];
}
function videoCodec(encoder, crf) {
  return videoCodec2(encoder, { codecFamily: 'h264', mode: 'crf', crf, bitrateMbps: null, encoderPreset: 'veryfast' });
}

// Probe a real encode once per codec family. macOS uses VideoToolbox; H.264 on
// other platforms tries NVIDIA/Intel/AMD. FVE_ENCODER overrides this for tests.
// Failed hardware exports retry with the matching software codec (see runExport).
const encoderPicks = new Map();
const softwareEncoder = family => family==='vp9'?'libvpx-vp9':family === 'h265' && hasLibx265() ? 'libx265' : 'libx264';
function pickEncoder(family = 'h264') {
  if(family==='vp9'){if(!hasEncoder('libvpx-vp9')||!hasEncoder('libopus'))return Promise.reject(Error('VP9/Opus export is unavailable in this FFmpeg build.'));return Promise.resolve('libvpx-vp9');}
  if (process.env.FVE_ENCODER) return Promise.resolve(process.env.FVE_ENCODER);
  if (!encoderPicks.has(family)) encoderPicks.set(family, (async () => {
    const names = family === 'h265' ? (process.platform === 'darwin' ? ['hevc_videotoolbox'] : [])
      : Object.keys(HW_ENCODERS).filter(name => process.platform === 'darwin' ? name === 'h264_videotoolbox' : name !== 'h264_videotoolbox');
    for (const name of names) {
      if (!hasEncoder(name)) continue;
      try {
        // A wedged hardware encoder (driver hang) must not hold every export: past the limit it counts as absent.
        await runFfmpeg(['-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30:duration=0.5', ...videoCodec2(name, { codecFamily: family, mode: 'crf', crf: 20, encoderPreset: 'veryfast' }), '-pix_fmt', 'yuv420p', '-f', 'null', '-'],
          { timeoutMs: Number(process.env.FVE_ENCODER_PROBE_MS) || 20000 });
        return name;
      } catch {
        // not on this PC
      }
    }
    return softwareEncoder(family);
  })());
  return encoderPicks.get(family);
}

// A finished render whose target could not be replaced moves next to it under a free name ("video (rendered).mp4",
// "video (rendered 2).mp4"…). If even that fails it stays where it was rendered. Returns where it is.
function keepFinishedRender(workingFile, outFile) {
  const ext = path.extname(outFile), base = outFile.slice(0, outFile.length - ext.length);
  for (let n = 1; n < 100; n++) {
    const candidate = `${base} (rendered${n > 1 ? ` ${n}` : ''})${ext || '.mp4'}`;
    if (fs.existsSync(candidate)) continue;
    try { fs.renameSync(workingFile, candidate); return candidate; } catch { break; }
  }
  return workingFile;
}

function runExport(project, outFile, onProgress, runOpts = {}) {
  const tmpDir = require('../system/workDirs.cjs').makeWorkDir('fve-');
  const maskFiles = {};
  for (const [n, [clipId, dataUrl]] of Object.entries(project.maskImages || {}).entries()) {
    const file = path.join(tmpDir, `mask_${n}.png`);
    fs.writeFileSync(file, Buffer.from(String(dataUrl).split(',')[1], 'base64'));
    maskFiles[clipId] = file;
  }
  const decoFiles = {}; // mask outline / glow pictures
  for (const [n, [clipId, dataUrl]] of Object.entries(project.decoImages || {}).entries()) {
    const file = path.join(tmpDir, `deco_${n}.png`);
    fs.writeFileSync(file, Buffer.from(String(dataUrl).split(',')[1], 'base64'));
    decoFiles[clipId] = file;
  }
  const customMaskFiles = {}; // painted removal keep-maps (grayscale, source geometry)
  for (const [n, [clipId, dataUrl]] of Object.entries(project.customMaskImages || {}).entries()) {
    const file = path.join(tmpDir, `cmask_${n}.png`);
    fs.writeFileSync(file, Buffer.from(String(dataUrl).split(',')[1], 'base64'));
    customMaskFiles[clipId] = file;
  }
  const withAssets = {
    ...project,
    maskFiles,
    decoFiles,
    customMaskFiles,
  };
  let proc = null;
  let canceled = false;
  let outputDir, workingFile;
  const stopped = () => Object.assign(new Error('Export canceled.'), {name:'AbortError'});
  const once = (encoder) => new Promise((resolve, reject) => {
    if (canceled) return reject(stopped());
    const { args, total } = buildExportArgs(withAssets, workingFile, { encoder });
    proc = spawn(ffmpegPath, graphFile(args, tmpDir), { windowsHide: true });
    onProgress?.(0,{encoder});
    // Perf mode (Low-End): run the encoder below normal priority so the PC stays
    // responsive during exports. Scheduling only — the graph and output are identical.
    if (runOpts.nice) { try { os.setPriority(proc.pid, runOpts.nice); } catch { /* not permitted on every platform */ } }
    let log = '';
    proc.stdout.on('data', progressReader(total,(fraction,detail)=>onProgress?.(fraction,{...detail,encoder})));
    proc.stderr.on('data', (d) => {
      log += d;
      if (log.length > 20000) log = log.slice(-20000);
    });
    proc.on('error', reject);
    proc.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`FFmpeg failed (code ${code}):
${log.slice(-3000)}`))));
  });
  const promise = (async () => {
    try {
      // Publish only a completed video. Cancel/failure preserves an older file
      // at the chosen destination, and the rename stays on the same filesystem.
      outputDir = fs.mkdtempSync(path.join(path.dirname(outFile),'.clipcraft-export-'));
      const format=videoFormat(effectiveExport(project).format);
      if(formatFromPath(outFile)?.id!==format.id)throw Error('Output path extension must match the selected export format');
      workingFile = path.join(outputDir,'video.'+format.extension);
      const family = effectiveExport(project).codecFamily, fallback = softwareEncoder(family);
      const encoder = await pickEncoder(family);
      if (canceled) throw stopped();
      try {
        await once(encoder);
      } catch (e) {
        if (canceled || encoder === fallback) throw e;
        // The graphics card's encoder failed on this export (driver, size limit…): redo it on the CPU, and keep
        // using the CPU from now on.
        encoderPicks.set(family, Promise.resolve(fallback));
        onProgress?.(0,{encoder:fallback,retry:true});
        await once(fallback);
      }
      if (canceled) throw stopped();
      runOpts.beforePublish?.();
      try {
        if (runOpts.noOverwrite) {
          try { fs.linkSync(workingFile, outFile); }
          catch (error) {
            if (!require('../system/hardLinks.cjs').hardLinkUnsupported(error)) throw error;
            fs.copyFileSync(workingFile, outFile, fs.constants.COPYFILE_EXCL);
          }
        } else fs.renameSync(workingFile,outFile);
      } catch (error) {
        // The render is complete but could not take the target's place (the file is open in another program, the
        // drive refused…): it is kept, never deleted, and the message says where it is.
        const kept = keepFinishedRender(workingFile, outFile);
        if (kept === workingFile) outputDir = null;
        throw Object.assign(new Error(t('main.export_publish_failed', { name: path.basename(outFile), file: kept, reason: error.code || error.message })), { code: error.code, keptFile: kept });
      }
      onProgress?.(1);
      return outFile;
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      if (outputDir) fs.rmSync(outputDir,{recursive:true,force:true});
    }
  })();
  const cancel = () => { canceled = true; proc?.kill('SIGKILL'); };
  // Quitting: the process ends before the promise settles, so the working folders go now, synchronously.
  const abandon = () => {
    cancel();
    fs.rmSync(tmpDir, { recursive: true, force: true });
    if (outputDir) fs.rmSync(outputDir, { recursive: true, force: true });
  };
  return { promise, get canceled(){return canceled;}, cancel, abandon };
}

// Converts any audio file (e.g. a MediaRecorder .webm voice-over) to .m4a so it has a proper duration.
function toM4a(input, output) {
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', '-i', input, '-c:a', 'aac', '-b:a', '160k', output], { windowsHide: true });
    let err = '';
    p.stderr.on('data', (d) => (err += d));
    p.on('error', reject); // FFmpeg could not be started: an unhandled 'error' would crash the main process
    p.on('close', (code) => (code === 0 ? resolve(output) : reject(new Error(err))));
  });
}

// timeoutMs: kill FFmpeg and reject when it has not finished by then (0: no limit).
function runFfmpeg(args, { background = false, timeoutMs = 0 } = {}) {
  return new Promise((resolve, reject) => {
    const command = background ? ['-threads','2',...args.slice(0,-1),'-threads','2',args.at(-1)] : args;
    const p = spawn(ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', ...command], { windowsHide: true });
    if (background) { try { os.setPriority(p.pid, 10); } catch { /* Best effort on platforms that restrict priorities. */ } }
    let err = '', timedOut = false;
    const timer = timeoutMs > 0 ? setTimeout(() => { timedOut = true; try { p.kill('SIGKILL'); } catch { /* already gone */ } }, timeoutMs) : null;
    p.stderr.on('data', (d) => (err += d));
    p.on('error', (error) => { clearTimeout(timer); reject(error); });
    p.on('close', (code) => { clearTimeout(timer); if (timedOut) reject(new Error(`FFmpeg did not finish within ${timeoutMs} ms.`)); else if (code === 0) resolve(); else reject(new Error(err.slice(-2000))); });
  });
}

const runBackground = (kind, args) => mediaWorkBudget.run(kind, () => runFfmpeg(args, { background: true }));

// Timeline visuals, cached in `cacheDir` by path + size + mtime:
// - a thumbnail sprite: `thumbCount` frames side by side, frame k shows time k * thumbInterval
//   (thumbW x thumbH each). A fast keyframe-only pass is reported first, then an exact pass.
// - an audio waveform image spanning the whole file.
// onUpdate(partial) is called as each piece becomes available. Failures are non-fatal.
async function makeVisuals(item, cacheDir, onUpdate = () => {}) {
  const st = fs.statSync(item.path);
  // v3 (W4, 2026-11-01): visuals now include a dedicated full-frame poster (below) — the
  // version bump makes media cached under v2 regenerate once so posters appear everywhere.
  const key = require('./quality.cjs').sourceKey(item, st, require('./quality.cjs').VISUALS_SUFFIX);
  fs.mkdirSync(cacheDir, { recursive: true });
  const metaFile = path.join(cacheDir, `${key}-visuals.json`);
  if (fs.existsSync(metaFile)) {
    const cached = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
    if ([cached.thumb, cached.wave, cached.poster].every((f) => !f || fs.existsSync(f))) {
      onUpdate(cached);
      return cached;
    }
  }
  const out = {};
  if (item.type === 'video' && item.duration > 0) {
    const count = Math.min(120, Math.max(8, Math.ceil(item.duration)));
    const interval = item.duration / count;
    const th = 90;
    const tw = Math.max(2, Math.round((th * (item.width || 16)) / (item.height || 9) / 2) * 2);
    // tpad clones the last frame so fps always produces `count` frames and the tile is complete.
    const vf = `tpad=stop_mode=clone:stop_duration=${(interval * 2).toFixed(3)},fps=1/${interval.toFixed(4)},` +
      `scale=${tw}:${th},tile=${count}x1:padding=0`;
    const meta = { thumbCount: count, thumbInterval: interval, thumbW: tw, thumbH: th };
    const fast = path.join(cacheDir, `${key}-sprite-fast.jpg`);
    await runBackground('visual', ['-skip_frame', 'nokey', '-i', item.path, '-an', '-vf', vf, '-frames:v', '1', '-q:v', '6', fast]).catch(() => {});
    if (fs.existsSync(fast)) onUpdate({ ...meta, thumb: fast });
    const exact = path.join(cacheDir, `${key}-sprite.jpg`);
    await runBackground('visual', ['-i', item.path, '-an', '-vf', vf, '-frames:v', '1', '-q:v', '5', exact]).catch(() => {});
    if (fs.existsSync(exact)) {
      Object.assign(out, meta, { thumb: exact });
      onUpdate({ ...meta, thumb: exact });
    } else if (fs.existsSync(fast)) Object.assign(out, meta, { thumb: fast });
    // W4: a dedicated POSTER frame for project cards. The sprite frames are only 90 px
    // tall (a portrait frame is ~52x90) — showing one at card size is the blurry smear
    // Hamza reported. The poster is one frame at 640 px on its long edge, taken a little
    // into the file (min(2 s, ~10% of duration), at least 0.4 s in) so it is a stable,
    // representative frame rather than a fade-in instant or a mid-transition blur.
    const poster = path.join(cacheDir, `${key}-poster.jpg`);
    const pt = Math.min(2, Math.max(0.4, item.duration * 0.1));
    await runBackground('visual', ['-ss', pt.toFixed(3), '-i', item.path, '-an', '-frames:v', '1',
      '-vf', 'scale=640:640:force_original_aspect_ratio=decrease', '-q:v', '3', poster]).catch(() => {});
    if (fs.existsSync(poster)) {
      out.poster = poster;
      onUpdate({ poster });
    }
  }
  if (item.hasAudio && item.duration > 0) {
    const wave = path.join(cacheDir, `${key}-wave.png`);
    const w = Math.min(8000, Math.max(600, Math.round(item.duration * 60)));
    await runBackground('visual', ['-i', item.path, '-vn', '-filter_complex',
      `aformat=channel_layouts=mono,compand=gain=4,showwavespic=s=${w}x96:colors=white:scale=sqrt`, '-frames:v', '1', wave]).catch(() => {});
    if (fs.existsSync(wave)) {
      out.wave = wave;
      onUpdate({ wave });
    }
  }
  fs.writeFileSync(metaFile, JSON.stringify(out), 'utf8');
  return out;
}

// The player (Chromium) only decodes 8-bit 4:2:0 H.264 / VP8 / VP9 / AV1 smoothly. 10-bit or 4:2:2 video, HEVC,
// ProRes and pictures above 1080p play with a stuck or black picture, so they get a light preview copy (proxy),
// The export always uses the original file.
function needsProxy(info) {
  if (!info || info.type !== 'video') return false;
  const okCodec = ['h264', 'vp8', 'vp9', 'av1'].includes(info.vcodec);
  const okPix = ['yuv420p', 'yuvj420p'].includes(info.pixFmt);
  const big = (info.width || 0) * (info.height || 0) > 1920 * 1088;
  return !!info.hdr || !okCodec || !okPix || big || /high 10|4:2:2|4:4:4/i.test(info.profile || '');
}

// Background picture for a scene without footage (intro, title card, end card): one color, or a gradient from
// `color` to `color2` (direction: horizontal, vertical or diagonal). Colors are #rrggbb. Cached per look and size.
async function makeScene({ color, color2, direction = 'diagonal', width, height }, cacheDir) {
  const hex = (c) => (/^#[0-9a-f]{6}$/i.test(String(c)) ? String(c).toLowerCase() : null);
  const c0 = hex(color);
  const c1 = color2 ? hex(color2) : null;
  if (!c0 || (color2 && !c1)) throw new Error('Scene colors must be #rrggbb.');
  const w = Math.max(16, Math.min(4096, Math.round(width / 2) * 2));
  const h = Math.max(16, Math.min(4096, Math.round(height / 2) * 2));
  const dir = ['horizontal', 'vertical', 'diagonal'].includes(direction) ? direction : 'diagonal';
  fs.mkdirSync(cacheDir, { recursive: true });
  const out = path.join(cacheDir, `scene-${c0.slice(1)}${c1 ? `-${c1.slice(1)}-${dir}` : ''}-${w}x${h}.png`);
  if (fs.existsSync(out)) return out;
  let vf = `color=c=${c0.replace('#', '0x')}:s=${w}x${h}`;
  if (c1) {
    // Each channel goes from c0 to c1 along the direction (geq: X, Y, W, H are the pixel and the frame size).
    const t = { horizontal: 'X/W', vertical: 'Y/H', diagonal: '(X/W+Y/H)/2' }[dir];
    const ch = (c, i) => parseInt(c.slice(1 + i * 2, 3 + i * 2), 16);
    const lerp = (i) => `${ch(c0, i)}+(${ch(c1, i) - ch(c0, i)})*${t}`;
    vf = `color=c=black:s=${w}x${h},format=rgb24,geq=r='${lerp(0)}':g='${lerp(1)}':b='${lerp(2)}'`;
  }
  const part = `${out}.${PART_TAG}.part.png`;
  try {
    await runFfmpeg(['-f', 'lavfi', '-i', vf, '-frames:v', '1', part]);
    fs.renameSync(part, out);
  } finally { fs.rmSync(part, { force: true }); }
  return out;
}

// 720p H.264 copy with a keyframe every half second (fast seeking), same timing and sound. Cached per file.
async function makeProxy(item, cacheDir) {
  return makeQualityProxy(item, cacheDir, 'high', { force: true });
}


// Playback-quality copy for one level ('high' | 'medium' | 'low'): the picture scaled so its longest
// side is at most the level's cap (1280 / 960 / 640), never upscaled — a source that already fits
// returns null and the player keeps the full-quality chain. Same recipe family as the light proxy
// (fast seeking keyframes, fastdecode); higher levels keep more bitrate. Only the player uses these
// ("-q<level>.mp4" in the cache); the export always reads the original.
const { qualityTargetSize, qualityScaleFilter, sourceKey, proxySuffix } = require('./quality.cjs');
const proxyJobs = new Map();
async function makeQualityProxy(item, cacheDir, quality, { force = false } = {}) {
  const size = qualityTargetSize(item.width, item.height, quality);
  if (!size && !force) return null;
  const st = fs.statSync(item.path);
  const key = sourceKey(item, st, proxySuffix(item, quality));
  fs.mkdirSync(cacheDir, { recursive: true });
  const out = path.join(cacheDir, `${key}-q${quality}.mp4`);
  if (fs.existsSync(out)) return out;
  if (proxyJobs.has(out)) return proxyJobs.get(out);
  const job = (async () => {
  const part = path.join(cacheDir, `${key}-q${quality}.${PART_TAG}.part.mp4`);
  const crf = { high: 23, medium: 26, low: 28 }[quality] || 26;
  await runBackground('proxy', ['-i', item.path, '-map', '0:v:0', '-map', '0:a:0?',
    '-vf', `${size ? qualityScaleFilter(quality) : `scale=${Math.max(2, Math.round(item.width / 2) * 2)}:${Math.max(2, Math.round(item.height / 2) * 2)}`}${item.hdr ? `,${TONEMAP}` : ''},format=yuv420p`,
    ...(item.hdr ? ['-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709'] : []),
    // ultrafast at every level: the copy is preview-only, and the build happens in the background
    // while the original keeps playing — a faster build is worth more than the last bit of
    // compression efficiency. Measured on a 60 s 1080p source in the dev sandbox: High 32.0 s ->
    // 19.0 s, Medium 18.5 s -> 16.4 s, Low 17.0 s -> 13.7 s (decode of the source is the floor).
    '-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'fastdecode', '-crf', String(crf), '-g', '15', '-keyint_min', '15', '-sc_threshold', '0',
    // AAC sound is copied, not re-encoded (the common case for MP4 sources); anything else is
    // re-encoded to AAC so the copy always plays.
    ...(item.acodec === 'aac' ? ['-c:a', 'copy'] : ['-c:a', 'aac', '-b:a', quality === 'high' ? '128k' : '96k']),
    '-movflags', '+faststart', part]).catch((error) => { fs.rmSync(part, { force: true }); throw error; });
  fs.renameSync(part, out);
  return out;
  })();
  proxyJobs.set(out, job);
  try { return await job; } finally { proxyJobs.delete(out); }
}

// Small frames of a clip for Adjust > Auto: `count` pictures spread over [from, to] (source seconds), 160 px wide,
// as raw RGB. HDR is mapped to normal colors first, like the export does. A photo gives one frame.
async function sampleFrames(item, from, to, count = 8) {
  const one = (t) => new Promise((resolve) => {
    const args = ['-v', 'error', ...(t != null ? ['-ss', String(Math.max(0, t))] : []), '-i', item.path, '-frames:v', '1',
      '-vf', `scale=160:-2${toSdr(item)},format=rgb24`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'];
    const p = spawn(ffmpegPath, args, { windowsHide: true });
    const chunks = [];
    p.stdout.on('data', (d) => chunks.push(d));
    p.on('error', () => resolve(null));
    p.on('close', () => {
      const data = Buffer.concat(chunks);
      const width = 160;
      const height = Math.floor(data.length / (width * 3));
      resolve(height > 0 ? { data: new Uint8Array(data.subarray(0, width * height * 3)), width, height } : null); // its own copy for IPC
    });
  });
  if (item.type === 'image') return [await one(null)].filter(Boolean);
  const a = Math.max(0, from || 0);
  const b = Math.max(a + 0.05, Math.min(to || item.duration || a + 1, (item.duration || Infinity) - 0.05));
  const times = Array.from({ length: count }, (_, i) => a + ((i + 0.5) / count) * (b - a));
  return (await Promise.all(times.map(one))).filter(Boolean);
}

module.exports = {
  sampleFrames, analysisAudioPlan, speedOf, positive, hex, xfadeName, escapeFilterPath, audioAnalysisKey, buildTimelineAudioArgs,
  toSdr, stillInput, graphFile, longGraph, pickEncoder, warmEncoders, hasLibx265, hasVp9, effectiveExport, makeScene, needsProxy, makeProxy, makeQualityProxy, ffmpegPath, ffprobePath, probe, lookFilters, fitSize, narrowClip, buildExportArgs, buildAudioExportArgs, exportAudio, runExport, toM4a, renderMainAudio, renderTimelineAudio, detectSilences, audibleIntervals, makeVisuals };
