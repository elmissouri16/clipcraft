// Audio effects controls (clip.audioFx). These run in the EXPORT pipeline (ffmpeg) — the
// preview keeps playing the original sound, and the panel says so. Shared by the audio-track
// inspector and the video-clip inspector: every audio-bearing clip gets the same section.
import React from 'react';
import { AUDIO_PRESETS, activePreset } from "../../effects/audioPresets.js";
import { t } from '../../../i18n/index.js';

const Row = ({ label, children }) => (
  <div className="afx-row">
    <span className="afx-label">{label}</span>
    <span className="afx-ctl">{children}</span>
  </div>
);
const Range = ({ value, min, max, step = 1, fmt, onChange, aria }) => (
  <>
    <input type="range" min={min} max={max} step={step} value={value} aria-label={aria || t('audio-fx.value')}
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
      <div className="afx-note">{t('audio-fx.audio_effects_apply_on_export_the_preview')}</div>
      <div className="afx-presets" role="group" aria-label={t('audio-fx.audio_presets')}>
        {AUDIO_PRESETS.map((p) => (
          <button key={p.id} type="button" className={`afx-chip ${active?.id === p.id ? 'on' : ''}`}
            aria-pressed={active?.id === p.id} title={t('audio-fx.set_the_audio_effects_to_the_preset', { name: p.name })}
            onClick={() => onChange(structuredClone(p.fx))}>{p.name}</button>
        ))}
      </div>
      <div className="afx-group">
        <div className="afx-group-title">{t('audio-fx.filters')}</div>
        <Row label={t('audio-fx.high_pass')}>
          <Range value={f.highpass || 0} min={0} max={400} step={5} aria="High-pass filter cutoff"
            fmt={(v) => (v < 20 ? 'Off' : `${v} Hz`)} onChange={(v) => set({ highpass: v })} />
        </Row>
        <Row label={t('audio-fx.low_pass')}>
          <Range value={f.lowpass || 20000} min={4000} max={20000} step={500} aria="Low-pass filter cutoff"
            fmt={(v) => (v >= 20000 ? 'Off' : `${(v / 1000).toFixed(1).replace(/\.0$/, '')} kHz`)}
            onChange={(v) => set({ lowpass: v >= 20000 ? 0 : v })} />
        </Row>
      </div>
      <div className="afx-group">
        <div className="afx-group-title">{t('audio-fx.equalizer')}</div>
        <Row label={t('audio-fx.eq_low')}>
          <Range value={eq.low} min={-15} max={15} fmt={db} aria="EQ low (100 Hz)" onChange={(v) => setEq('low', v)} />
        </Row>
        <Row label={t('audio-fx.eq_mid')}>
          <Range value={eq.mid} min={-15} max={15} fmt={db} aria="EQ mid (1 kHz)" onChange={(v) => setEq('mid', v)} />
        </Row>
        <Row label={t('audio-fx.eq_high')}>
          <Range value={eq.high} min={-15} max={15} fmt={db} aria="EQ high (8 kHz)" onChange={(v) => setEq('high', v)} />
        </Row>
        <Row label={t('audio-fx.pitch')}>
          <Range value={f.pitch || 0} min={-12} max={12} fmt={(v) => `${v > 0 ? '+' : ''}${v} st`} aria="Pitch shift in semitones" onChange={(v) => set({ pitch: v })} />
        </Row>
      </div>
      <div className="afx-group">
        <div className="afx-group-title">{t('audio-fx.dynamics_cleanup')}</div>
        <Toggle label={t('audio-fx.compressor')} checked={!!f.comp} onChange={(v) => set({ comp: v })} />
        <Toggle label={t('audio-fx.limiter')} checked={!!f.limit} onChange={(v) => set({ limit: v })} />
        <Toggle label={t('audio-fx.noise_reduction')} checked={!!f.denoise} onChange={(v) => set({ denoise: v })} />
        <Toggle label={t('audio-fx.loudness_normalize')} checked={!!f.loudnorm} onChange={(v) => set({ loudnorm: v })}
          hint="Normalize loudness to −14 LUFS on export (loudnorm)" />
        <Row label={t('audio-fx.echo')}>
          <input type="checkbox" checked={!!f.echo} aria-label={t('audio-fx.echo')}
            onChange={(e) => set({ echo: e.target.checked ? { delay: 180, decay: 0.3 } : null })} />
        </Row>
        {f.echo && (
          <>
            <Row label={t('audio-fx.echo_delay')}>
              <Range value={f.echo.delay} min={20} max={900} step={10} fmt={(v) => `${v} ms`} aria="Echo delay" onChange={(v) => set({ echo: { ...f.echo, delay: v } })} />
            </Row>
            <Row label={t('audio-fx.echo_decay')}>
              <Range value={f.echo.decay} min={0.05} max={0.8} step={0.05} fmt={(v) => v.toFixed(2)} aria="Echo decay" onChange={(v) => set({ echo: { ...f.echo, decay: v } })} />
            </Row>
          </>
        )}
      </div>
    </div>
  );
}
