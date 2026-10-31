// Audio effects controls (clip.audioFx). These run in the EXPORT pipeline (ffmpeg) — the
// preview keeps playing the original sound, and the panel says so. Shared by the audio-track
// inspector and the video-clip inspector: every audio-bearing clip gets the same section.
import React from 'react';
import { AUDIO_PRESETS, activePreset } from '../fx/audioPresets.js';

const Row = ({ label, children }) => (
  <div className="afx-row">
    <span className="afx-label">{label}</span>
    <span className="afx-ctl">{children}</span>
  </div>
);
const Range = ({ value, min, max, step = 1, fmt, onChange, aria }) => (
  <>
    <input type="range" min={min} max={max} step={step} value={value} aria-label={aria || 'value'}
      onChange={(e) => onChange(Number(e.target.value))} />
    <span className="afx-val">{fmt ? fmt(value) : value}</span>
  </>
);
const Toggle = ({ label, checked, onChange, hint }) => (
  <Row label={label}>
    <input type="checkbox" checked={checked} aria-label={label} title={hint}
      onChange={(e) => onChange(e.target.checked)} />
  </Row>
);

export default function AudioFxControls({ fx, onChange }) {
  const f = fx || {};
  const eq = f.eq || { low: 0, mid: 0, high: 0 };
  const set = (patch) => onChange({ ...f, ...patch });
  const setEq = (band, v) => set({ eq: { ...eq, [band]: v } });
  const db = (v) => `${v > 0 ? '+' : ''}${v} dB`;
  const active = activePreset(f);
  return (
    <div className="afx">
      <div className="afx-note">Audio effects apply on export — the preview plays the original sound.</div>
      <div className="afx-presets" role="group" aria-label="Audio presets">
        {AUDIO_PRESETS.map((p) => (
          <button key={p.id} type="button" className={`afx-chip ${active?.id === p.id ? 'on' : ''}`}
            aria-pressed={active?.id === p.id} title={`Set the audio effects to the ${p.name} preset`}
            onClick={() => onChange(structuredClone(p.fx))}>{p.name}</button>
        ))}
      </div>
      <div className="afx-group">
        <div className="afx-group-title">Filters</div>
        <Row label="High-pass">
          <Range value={f.highpass || 0} min={0} max={400} step={5} aria="High-pass filter cutoff"
            fmt={(v) => (v < 20 ? 'Off' : `${v} Hz`)} onChange={(v) => set({ highpass: v })} />
        </Row>
        <Row label="Low-pass">
          <Range value={f.lowpass || 20000} min={4000} max={20000} step={500} aria="Low-pass filter cutoff"
            fmt={(v) => (v >= 20000 ? 'Off' : `${(v / 1000).toFixed(1).replace(/\.0$/, '')} kHz`)}
            onChange={(v) => set({ lowpass: v >= 20000 ? 0 : v })} />
        </Row>
      </div>
      <div className="afx-group">
        <div className="afx-group-title">Equalizer</div>
        <Row label="EQ low">
          <Range value={eq.low} min={-15} max={15} fmt={db} aria="EQ low (100 Hz)" onChange={(v) => setEq('low', v)} />
        </Row>
        <Row label="EQ mid">
          <Range value={eq.mid} min={-15} max={15} fmt={db} aria="EQ mid (1 kHz)" onChange={(v) => setEq('mid', v)} />
        </Row>
        <Row label="EQ high">
          <Range value={eq.high} min={-15} max={15} fmt={db} aria="EQ high (8 kHz)" onChange={(v) => setEq('high', v)} />
        </Row>
        <Row label="Pitch">
          <Range value={f.pitch || 0} min={-12} max={12} fmt={(v) => `${v > 0 ? '+' : ''}${v} st`} aria="Pitch shift in semitones" onChange={(v) => set({ pitch: v })} />
        </Row>
      </div>
      <div className="afx-group">
        <div className="afx-group-title">Dynamics & cleanup</div>
        <Toggle label="Compressor" checked={!!f.comp} onChange={(v) => set({ comp: v })} />
        <Toggle label="Limiter" checked={!!f.limit} onChange={(v) => set({ limit: v })} />
        <Toggle label="Noise reduction" checked={!!f.denoise} onChange={(v) => set({ denoise: v })} />
        <Toggle label="Loudness normalize" checked={!!f.loudnorm} onChange={(v) => set({ loudnorm: v })}
          hint="Normalize loudness to −14 LUFS on export (loudnorm)" />
        <Row label="Echo">
          <input type="checkbox" checked={!!f.echo} aria-label="Echo"
            onChange={(e) => set({ echo: e.target.checked ? { delay: 180, decay: 0.3 } : null })} />
        </Row>
        {f.echo && (
          <>
            <Row label="Echo delay">
              <Range value={f.echo.delay} min={20} max={900} step={10} fmt={(v) => `${v} ms`} aria="Echo delay" onChange={(v) => set({ echo: { ...f.echo, delay: v } })} />
            </Row>
            <Row label="Echo decay">
              <Range value={f.echo.decay} min={0.05} max={0.8} step={0.05} fmt={(v) => v.toFixed(2)} aria="Echo decay" onChange={(v) => set({ echo: { ...f.echo, decay: v } })} />
            </Row>
          </>
        )}
      </div>
    </div>
  );
}
