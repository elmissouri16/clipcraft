// Edit fingerprints of reference videos (electron/media/editStyle.cjs), measured on a
// synthetic reference whose editing is known exactly: hard cuts, a 1.5x punch-in, a
// zoom-in move, a dissolve, a fade through black, a jump cut, moving content, a
// black-and-white shot and a 120 BPM click track with the cuts on the beat.
// Continuous shots (a noisy pan, a fast zoom) must produce no cuts.
// Usage: node tests/unit/media/test-edit-style.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.join(__dirname, '../../..');
const { ffmpegPath, probe } = require(path.join(root, 'electron/media/ffmpeg.cjs'));
const { analyzeSamples } = require(path.join(root, 'electron/audio/rhythm.cjs'));
const { fileFingerprint } = require(path.join(root, 'electron/media/mediaAnalysis.cjs'));
const { createEditStyle, summarize, speechOf, audioOf, soundOf, transcriptOf } = require(path.join(root, 'electron/media/editStyle.cjs'));

const photo = (name) => path.join(root, 'public/preview', name);
const ff = (args) => execFileSync(ffmpegPath, ['-v', 'error', '-y', ...args]);
const { makeReference } = require('../../fixtures/editReference.cjs');

const checks = [];
const check = async (name, fn) => { await fn(); checks.push(name); };
const near = (a, b, tol) => Math.abs(a - b) <= tol;

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clipcraft-edit-style-'));
  try {
    const ref = makeReference(dir);
    const cacheDir = path.join(dir, 'cache');
    const svc = createEditStyle({ ffmpegPath, probe, analyzeSamples, fingerprint: fileFingerprint, cacheDir });
    const v = await svc.analyze(ref.file, { speech: false });
    const list = v.transitions.list;
    const shotAt = (t) => v.shots.find((s) => s.start_sec <= t && s.end_sec > t);

    await check('every transition is found at its time with its kind', () => {
      assert.equal(list.length, ref.truth.length, JSON.stringify(list));
      ref.truth.forEach((t, i) => {
        assert.ok(near(list[i].t, t.t, 0.1), `${t.kind} at ${t.t}: ${JSON.stringify(list[i])}`);
        assert.equal(list[i].kind, t.kind, `at ${t.t}`);
      });
    });
    await check('punch-in scale and gradual transition lengths', () => {
      assert.ok(near(list[1].scale, 1.5, 0.1), JSON.stringify(list[1]));
      assert.ok(near(list[3].duration_sec, 0.5, 0.15), JSON.stringify(list[3]));
      assert.ok(near(list[4].duration_sec, 0.6, 0.2), JSON.stringify(list[4]));
    });
    await check('camera moves, motion and colour per shot', () => {
      assert.equal(shotAt(6).move, 'zoom_in');
      assert.equal(shotAt(12).move, 'moving'); assert.equal(shotAt(14).move, 'moving');
      for (const t of [1, 2.5, 4, 8, 10]) assert.equal(shotAt(t).move, 'static', `still photo at ${t}`);
      assert.ok(shotAt(16).color.saturation < 0.04, 'black-and-white shot');
      assert.ok(shotAt(1).color.saturation > 0.2);
    });
    await check('pacing and framing summaries', () => {
      assert.equal(v.pacing.shots, 9); assert.equal(v.pacing.first_cut_sec, 2); assert.equal(v.pacing.curve_cuts_per_min.length, 10);
      assert.deepEqual([v.transitions.punch_in, v.transitions.jump, v.transitions.dissolve, v.transitions.fade_black, v.transitions.cut], [1, 1, 1, 1, 4]);
      assert.equal(v.framing.zoom_in_shots, 1); assert.ok(near(v.framing.punch_scale_median, 1.5, 0.1));
    });
    await check('music tempo and cuts on the beat', () => {
      assert.ok(near(v.audio.music.bpm, 120, 2), JSON.stringify(v.audio.music));
      assert.ok(v.audio.cuts_on_beat.ratio >= 0.85 && v.audio.cuts_on_beat.ratio > v.audio.cuts_on_beat.chance * 2, JSON.stringify(v.audio.cuts_on_beat));
    });
    await check('the summary for the model is small and keeps what matters', () => {
      const s = summarize(v), tokens = JSON.stringify(s).length / 4;
      assert.ok(tokens < 1500, `~${Math.round(tokens)} tokens`);
      assert.ok(!('shots' in s) && Array.isArray(s.transition_times) && s.samples.length >= 4 && s.samples.length <= 12);
      assert.ok(s.needs_visual_review.length && s.limitations.length);
    });
    await check('a second analysis comes from the cache', async () => {
      const again = await svc.analyze(ref.file, { speech: false });
      assert.equal(again.cached, true); assert.equal(again.analysis_id, v.analysis_id);
      assert.equal(fs.readdirSync(cacheDir).filter((f) => f.endsWith('.json')).length, 1);
    });
    await check('continuous shots produce no cuts', async () => {
      const pan = path.join(dir, 'pan.mp4'), zoom = path.join(dir, 'zoom.mp4');
      ff(['-loop', '1', '-framerate', '30', '-t', '6', '-i', photo('p1015.jpg'), '-vf', "scale=1920:-2,crop=640:360:'(iw-640)*t/6':'(ih-360)/2',noise=alls=12:allf=t,format=yuv420p", '-c:v', 'libx264', '-preset', 'veryfast', pan]);
      ff(['-loop', '1', '-framerate', '30', '-t', '4', '-i', photo('p1015.jpg'), '-vf', "scale=1280:720,zoompan=z='1+1.2*on/120':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=640x360:fps=30,noise=alls=10:allf=t,format=yuv420p", '-c:v', 'libx264', '-preset', 'veryfast', zoom]);
      const a = await svc.analyze(pan, { speech: false }), b = await svc.analyze(zoom, { speech: false });
      assert.equal(a.transitions.list.length, 0, JSON.stringify(a.transitions.list)); assert.equal(a.shots[0].move, 'moving');
      assert.equal(b.transitions.list.length, 0, JSON.stringify(b.transitions.list)); assert.equal(b.shots[0].move, 'zoom_in');
    });
    await check('speech pace, kept pauses and silence at cuts', () => {
      const words = []; let t = 0;
      for (let i = 0; i < 40; i++) { words.push({ start: t, end: t + 0.3 }); t += 0.3 + (i % 10 === 9 ? 0.8 : 0.1); }
      const s = speechOf(words, [4.3, 9.0], 20); // both cuts in the 0.8 s pauses
      assert.equal(s.words_per_min, 120); assert.ok(near(s.pause_sec.median, 0.1, 0.01)); assert.ok(s.long_pauses_per_min > 0);
      assert.equal(s.cuts_inside_words_ratio, 0); assert.equal(speechOf([], [1], 10), null);
    });
    await check('no steady tempo means no beat claims', () => {
      const out = audioOf({ beats: { bpm: 90, tempo_confidence: 0.1, beats: [] }, loudness: {}, samples: new Float32Array(11025), sr: 11025, cuts: [1] });
      assert.equal(out.music, null); assert.equal(out.cuts_on_beat, undefined);
    });
    await check('a stopped analysis rejects as aborted', async () => {
      const controller = new AbortController(); controller.abort();
      const fresh = createEditStyle({ ffmpegPath, probe, analyzeSamples });
      await assert.rejects(fresh.analyze(ref.file, { speech: false, signal: controller.signal }), (e) => e.name === 'AbortError');
    });
    await check('sound: a hit at every cut of the click track, an energy curve of ten parts', () => {
      const sound = v.audio.sound;
      assert.equal(sound.energy_curve_db.length, 10); assert.equal(sound.onset_curve_per_sec.length, 10);
      assert.ok(sound.cut_sounds.hit_ratio >= 0.85, JSON.stringify(sound.cut_sounds)); assert.equal(sound.voice_balance, null, 'no speech, no balance');
    });
    await check('sound: loud jumps, risers and the voice against its pauses', () => {
      const sr = 11025, seconds = 12, tone = (n, amp, f, from = 0) => Float32Array.from({ length: n }, (_, i) => amp * Math.sin(2 * Math.PI * f * (from + i) / sr));
      // A quiet bed for 6 s, then 20 dB louder; a riser into a cut at 10 s.
      const music = Float32Array.from({ length: sr * seconds }, (_, i) => (i < 6 * sr ? 0.025 : 0.25) * Math.sin(2 * Math.PI * 220 * i / sr));
      for (let i = Math.round(9.4 * sr); i < 10 * sr; i++) music[i] *= 0.1 + 0.9 * ((i / sr - 9.4) / 0.6);
      const a = soundOf(music, sr, [10], null, seconds);
      assert.ok(a.loud_jumps_sec.includes(6), JSON.stringify(a.loud_jumps_sec));
      assert.equal(a.cut_sounds.riser_ratio, 1, JSON.stringify(a.cut_sounds));
      // Words at 0.25 over a 0.025 bed: the voice sits ~20 dB above its pauses.
      const talk = tone(sr * seconds, 0.025, 220), words = Array.from({ length: 10 }, (_, k) => ({ start: 0.2 + k * 0.9, end: 0.6 + k * 0.9 }));
      for (const w of words) talk.set(tone(Math.round((w.end - w.start) * sr), 0.25, 300), Math.round(w.start * sr));
      const b = soundOf(talk, sr, [], words, seconds);
      assert.ok(b.voice_balance && b.voice_balance.difference_db > 15, JSON.stringify(b.voice_balance));
    });
    await check('transcript: kept with timestamps when clear, flagged when uncertain', () => {
      const seg = (start, text) => ({ start, end: start + 2, text });
      const clear = transcriptOf([seg(0, 'Welcome back to the channel today'), seg(2, 'we cut a fast vlog together'), seg(4, 'every pause goes')], { speechRatio: 0.8 });
      assert.equal(clear.reliability, 'clear'); assert.deepEqual(clear.segments[0], [0, 2, 'Welcome back to the channel today']);
      const loop = transcriptOf([seg(0, 'thank you for watching'), seg(2, 'thank you for watching'), seg(4, 'thank you for watching')]);
      assert.equal(loop.reliability, 'uncertain'); assert.match(loop.why, /repeats/);
      const lyrics = transcriptOf([seg(0, 'oh baby baby tonight we ride'), seg(2, 'under the city lights again')], { musicConfident: true, speechRatio: 0.1 });
      assert.equal(lyrics.reliability, 'uncertain'); assert.match(lyrics.why, /lyrics/);
      assert.equal(transcriptOf([seg(0, 'hi there')]), null, 'too few words');
    });
    await check('a long transcript is paged without gaps', () => {
      const segments = Array.from({ length: 400 }, (_, i) => [i * 3, i * 3 + 3, `sentence ${i} `.repeat(6).trim()]);
      const value = { ...v, transcript: { reliability: 'clear', words: 4800, segments } };
      const first = summarize(value), second = summarize(value, { transcriptFrom: first.transcript.next_from_sec });
      assert.ok(JSON.stringify(first.transcript).length < 14000 && first.transcript.next_from_sec > 0);
      assert.equal(second.transcript.segments[0][0], first.transcript.next_from_sec, 'the second page starts where the first stopped');
      assert.deepEqual(first.transcript.segments.at(-1)[1], second.transcript.segments[0][0]);
    });
    console.log(`${checks.length} edit fingerprint checks passed`);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
