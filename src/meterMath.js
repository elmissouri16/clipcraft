// Pure level-meter math: peak-to-dB conversion, bar ballistics and the clip lamp, shared by the
// meter component (src/components/AudioMeter.jsx) and its suite (scripts/test-meter.cjs).
//
// Behaviour (audited + retuned in the meter accuracy pass):
// - Calibration is identity: dbOf maps a sample peak to dBFS with no offset, and overs pass
//   through (a peak of 1.41 reads +3.0 dB) — the display never invents or hides level.
// - Attack is instant; release is 240 dB/s, so a bar falls from 0 dBFS to the -60 floor in
//   250 ms (from a typical -12 dB peak: 200 ms) instead of hanging for seconds.
// - The peak-hold tick lingers 1.2 s at the highest peak, then falls at the release rate.
// - The clip lamp means a TRUE over: it lights only at >= -0.3 dBFS, holds 1.5 s after the
//   last over (each new over re-arms it), and can be cleared early by clicking the meter or
//   by restarting playback (the component calls clearClip). Ordinary loud content peaking
//   at -3...-1 dBFS never lights it.
export const METER_FLOOR = -60;
export const CLIP_DB = -0.3;
export const CLIP_HOLD_MS = 1500;
export const HOLD_MS = 1200;
export const RELEASE_DB_S = 240;

export const dbOf = (peak) => (peak > 0 ? Math.max(METER_FLOOR, 20 * Math.log10(peak)) : METER_FLOOR);

export function createMeterState() {
  return {
    disp: [METER_FLOOR, METER_FLOOR], // displayed bar level per channel (dBFS)
    hold: [METER_FLOOR, METER_FLOOR], // peak-hold tick level per channel
    holdUntil: [0, 0],
    clip: [false, false], // clip lamp per channel
    clipUntil: [0, 0],
    raw: [METER_FLOOR, METER_FLOOR], // last measured window peak per channel (dBFS)
  };
}

export function clearClip(state) {
  state.clip = [false, false];
  state.clipUntil = [0, 0];
}

// Advance the meter one frame. peakDb: [leftDb, rightDb] measured window peaks (dBFS, may
// exceed 0). now/dtMs: millisecond clock and frame delta from the caller's rAF loop.
export function stepMeter(state, peakDb, now, dtMs) {
  const fall = (RELEASE_DB_S * Math.max(0, dtMs)) / 1000;
  for (let ch = 0; ch < 2; ch++) {
    const db = Math.max(METER_FLOOR, peakDb[ch]);
    state.raw[ch] = db;
    if (db >= CLIP_DB) { state.clip[ch] = true; state.clipUntil[ch] = now + CLIP_HOLD_MS; }
    else if (state.clip[ch] && now > state.clipUntil[ch]) state.clip[ch] = false;
    state.disp[ch] = db > state.disp[ch] ? db : Math.max(db, state.disp[ch] - fall);
    if (db >= state.hold[ch]) { state.hold[ch] = db; state.holdUntil[ch] = now + HOLD_MS; }
    else if (now > state.holdUntil[ch]) state.hold[ch] = Math.max(db, state.hold[ch] - fall);
  }
  return state;
}
