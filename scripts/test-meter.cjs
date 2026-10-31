// Level-meter math: calibration identity, ballistics and clip-lamp semantics.
// The meter component (src/components/AudioMeter.jsx) advances src/meterMath.js with the
// analysers' window peaks; this suite drives the same module with synthetic peak sequences
// on a stepped 10 ms clock and asserts the behaviour the accuracy pass specified:
// - dbOf is identity across the calibration sweep (no offset, overs pass through);
// - attack is instant; release falls 0 dBFS -> floor in ~250 ms (240 dB/s);
// - the peak-hold tick lingers ~1.2 s, then falls at the release rate;
// - the clip lamp means a true over: silent at -1.0 and -0.4 dBFS, lit at -0.2 dBFS,
//   held ~1.5 s after the last over, re-armed by new overs, cleared by clearClip().
let failures = 0;
const ok = (cond, label, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${extra ? ` — ${extra}` : ''}`);
  if (!cond) failures++;
};
const near = (a, b, tol) => Math.abs(a - b) <= tol;

(async () => {
  const M = await import('../src/meterMath.js');
  const { dbOf, createMeterState, stepMeter, clearClip, METER_FLOOR: FLOOR, CLIP_DB } = M;

  // --- Calibration sweep: dbOf(10^(dB/20)) == dB across the range, both directions of travel.
  for (const db of [-40, -20, -12, -6, -3, -1, -0.4, 0]) {
    ok(near(dbOf(Math.pow(10, db / 20)), db, 0.001), `dbOf identity at ${db} dBFS`, `got ${dbOf(Math.pow(10, db / 20)).toFixed(4)}`);
  }
  ok(dbOf(0) === FLOOR, 'dbOf silence is the floor');
  ok(near(dbOf(1.5), 3.522, 0.001), 'dbOf passes overs through (1.5x -> +3.52 dB)', `got ${dbOf(1.5).toFixed(3)}`);
  ok(CLIP_DB === -0.3, 'clip threshold is -0.3 dBFS');

  // A stepped clock: advance the state with a constant per-channel peak.
  const run = (state, peakDb, ms, stepMs = 10) => {
    let now = state._now || 0;
    for (let t = 0; t < ms; t += stepMs) { now += stepMs; stepMeter(state, peakDb, now, stepMs); }
    state._now = now;
    return state;
  };

  // --- Attack is instant, per channel independently.
  {
    const s = createMeterState();
    run(s, [-12, -30], 10);
    ok(s.disp[0] === -12 && s.disp[1] === -30, 'attack: one frame reaches the peak on each channel', `disp=${s.disp}`);
    ok(s.raw[0] === -12 && s.raw[1] === -30, 'raw peak passthrough');
  }

  // --- Release: from 0 dBFS into silence, floor (-59) reached in 150-320 ms, monotone fall.
  {
    const s = createMeterState();
    run(s, [0, 0], 10);
    let prev = 0; let mono = true; let floorAt = null;
    for (let t = 0; t < 600; t += 10) {
      run(s, [FLOOR, FLOOR], 10);
      if (s.disp[0] > prev + 1e-9) mono = false;
      prev = s.disp[0];
      if (floorAt === null && s.disp[0] <= -59) floorAt = (s._now || 0);
    }
    ok(mono, 'release: bar falls monotonically');
    ok(floorAt !== null && floorAt >= 150 && floorAt <= 320, 'release: 0 dBFS -> floor in 150-320 ms', `at ${floorAt} ms (240 dB/s -> 250 ms)`);
    // From a typical -12 dB peak the same fall lands in ~200 ms.
    const s2 = createMeterState();
    run(s2, [-12, -12], 10);
    let at = null;
    for (let t = 0; t < 600; t += 10) { run(s2, [FLOOR, FLOOR], 10); if (at === null && s2.disp[0] <= -59) at = s2._now; }
    ok(at !== null && at >= 120 && at <= 280, 'release: -12 dB -> floor in ~200 ms', `at ${at} ms`);
  }

  // --- Peak hold: lingers ~1.2 s at the peak, then falls at the release rate.
  {
    const s = createMeterState();
    run(s, [-6, -6], 500);
    run(s, [FLOOR, FLOOR], 1000);
    ok(s.hold[0] >= -6.5, 'hold: tick still at the peak 1.0 s after the sound stops', `hold=${s.hold[0].toFixed(2)}`);
    run(s, [FLOOR, FLOOR], 500);
    ok(s.hold[0] < -6.5, 'hold: tick falls after the ~1.2 s linger', `hold=${s.hold[0].toFixed(2)} at 1.5 s`);
  }

  // --- Clip lamp: threshold, hold, re-arm, clear.
  {
    const s = createMeterState();
    run(s, [-1, -1], 800);
    ok(!s.clip[0] && !s.clip[1], 'lamp: -1.0 dBFS (loud master) never lights');
    run(s, [-0.4, -0.4], 800);
    ok(!s.clip[0], 'lamp: -0.4 dBFS never lights (the old -0.5 threshold lit here)');
    run(s, [-0.2, -6], 100);
    ok(s.clip[0] === true && s.clip[1] === false, 'lamp: -0.2 dBFS lights its channel only');
    run(s, [FLOOR, FLOOR], 1000);
    ok(s.clip[0] === true, 'lamp: still lit 1.0 s after the over (1.5 s hold)');
    run(s, [-0.2, FLOOR], 50); // a fresh over re-arms the hold
    run(s, [FLOOR, FLOOR], 1200);
    ok(s.clip[0] === true, 'lamp: re-armed over extends the hold');
    run(s, [FLOOR, FLOOR], 600);
    ok(s.clip[0] === false, 'lamp: clears ~1.5 s after the last over');
    run(s, [-0.2, -0.2], 50);
    ok(s.clip[0] && s.clip[1], 'lamp: lit again on a new over');
    clearClip(s);
    ok(!s.clip[0] && !s.clip[1], 'lamp: clearClip() (click / playback start) clears immediately');
  }

  console.log(failures ? `\n${failures} FAILURE(S)` : '\nMETER OK');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error('ERR', e); process.exit(1); });
