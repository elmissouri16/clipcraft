import React, { useEffect, useRef, useState } from 'react';
import { AppWindow, Camera, Circle, Loader2, Mic, Monitor, Pause, Play, RefreshCw, Square, SquareDashed, Volume2, X } from 'lucide-react';
import { t } from '../../../i18n/index.js';

const pad = (v) => String(Math.floor(v)).padStart(2, '0');
const clock = (s) => `${pad(s / 60)}:${pad(s % 60)}`;

// Media > Record screen: pick a screen or a window, the sounds and the camera, then record.
export default function ScreenRecordDialog({ rec, at, onClose }) {
  const [sources, setSources] = useState(null);
  const [kind, setKind] = useState('screen');
  const [pick, setPick] = useState(null);
  const [opts, setOpts] = useState({ systemAudio: true, mic: false, micId: '', camera: false, cameraId: '', camShape: 'circle', hideApp: true,
    camStroke: 0, camStrokeColor: '#ffffff', camGlow: 0, camGlowColor: '#825cfb' });
  const [devices, setDevices] = useState({ mics: [], cams: [] });
  // Device names are only given once a device was allowed; list them again after the camera / microphone opens.
  const listDevices = () => navigator.mediaDevices.enumerateDevices().then((all) => setDevices({
    mics: all.filter((d) => d.kind === 'audioinput' && d.deviceId !== 'communications'),
    cams: all.filter((d) => d.kind === 'videoinput'),
  })).catch(() => {});
  useEffect(() => {
    listDevices();
    navigator.mediaDevices.addEventListener?.('devicechange', listDevices);
    const off = window.api.onScreenCamConfig((c) => setOpts((o) => ({ ...o, camShape: c.shape })));
    return () => { navigator.mediaDevices.removeEventListener?.('devicechange', listDevices); off(); };
  }, []);
  // Start from the last camera and shape (kept by the main process between recordings).
  const camReady = useRef(false);
  useEffect(() => {
    window.api.screenCamera(false, {}).then((c) => {
      camReady.current = true;
      setOpts((o) => ({ ...o, camShape: c.shape, cameraId: c.deviceId || '',
        camStroke: c.stroke || 0, camStrokeColor: c.strokeColor || '#ffffff', camGlow: c.glow || 0, camGlowColor: c.glowColor || '#825cfb' }));
    });
  }, []);
  // The camera bubble follows the Camera option, the chosen camera and the shape.
  useEffect(() => {
    if (rec.active || !camReady.current) return;
    window.api.screenCamera(opts.camera, {
      deviceId: opts.cameraId, shape: opts.camShape,
      stroke: opts.camStroke, strokeColor: opts.camStrokeColor, glow: opts.camGlow, glowColor: opts.camGlowColor,
    }).then(() => opts.camera && setTimeout(listDevices, 1500));
  }, [opts.camera, opts.cameraId, opts.camShape, opts.camStroke, opts.camStrokeColor, opts.camGlow, opts.camGlowColor]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { if (!rec.active) window.api.screenCamera(false); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const setO = (patch) => setOpts((o) => ({ ...o, ...patch }));
  const load = () => {
    setSources(null);
    window.api.screenSources().then((list) => {
      setSources(list);
      setPick((p) => (list.some((s) => s.id === p) ? p : list.find((s) => s.kind === 'screen')?.id || list[0]?.id || null));
    });
  };
  useEffect(load, []);
  const set = (k) => (e) => setOpts((o) => ({ ...o, [k]: e.target.checked }));
  const shown = (sources || []).filter((s) => s.kind === kind);
  const close = () => { if (!rec.active) onClose(); };

  if (rec.phase === 'countdown') {
    return (
      <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={t('record.recording_starts')}>
        <div className="modal rec-modal">
          <div className="rec-count" aria-live="assertive">{rec.count}</div>
          <p className="muted">{t('record.recording_starts_2')}</p>
          <button className="btn" onClick={rec.cancel}>{t('app.cancel')}</button>
        </div>
      </div>
    );
  }
  if (rec.phase === 'recording' || rec.phase === 'saving') {
    return (
      <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={t('record.screen_recording')}>
        <div className="modal rec-modal">
          {rec.phase === 'saving' ? (
            <>
              <Loader2 size={30} className="spin" />
              <h3>{t('record.saving_the_recording')}</h3>
              <p className="muted">{t('record.it_is_converted_to_mp4_in_videos_clipcraft')}</p>
            </>
          ) : (
            <>
              <div className={`rec-live ${rec.paused ? 'paused' : ''}`}><span className="rec-dot" /> {clock(rec.seconds)}</div>
              <p className="muted">{rec.paused ? t('record.paused_use_the_bar') : t('record.recording_use_the_bar')}</p>
              <div className="modal-actions">
                <button className="btn" onClick={rec.togglePause}>{rec.paused ? <Play size={14} /> : <Pause size={14} />} {rec.paused ? t('record.resume') : t('message-queue.pause')}</button>
                <button className="btn btn-danger" onClick={() => rec.stop()}><Square size={12} fill="currentColor" /> {t('pilot.stop')}</button>
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="rec-title" onKeyDown={(e) => e.key === 'Escape' && close()}>
      <div className="modal rec-pick">
        <div className="rec-head">
          <h3 id="rec-title">{t('home.record_screen')}</h3>
          <button className="icon-btn" aria-label={t('app.close')} onClick={close}><X size={16} /></button>
        </div>
        <div className="rec-tabs">
          <div className="seg-tabs small" role="tablist" aria-label={t('record.what_to_record')}>
            {[['screen', t('record.screens'), Monitor], ['window', t('record.windows'), AppWindow]].map(([id, name, Icon]) => (
              <button key={id} role="tab" aria-selected={kind === id} className={kind === id ? 'on' : ''} onClick={() => setKind(id)}><Icon size={14} /> {name}</button>
            ))}
          </div>
          <button className="icon-btn" aria-label={t('record.refresh_the_list')} title={t('record.refresh')} onClick={load}><RefreshCw size={15} /></button>
        </div>
        <div className="rec-sources" role="listbox" aria-label={kind === 'screen' ? t('record.screens') : t('record.windows')}>
          {!sources && <div className="lib-loading"><Loader2 size={15} className="spin" /> {t('record.looking_for_screens_and_windows')}</div>}
          {sources && !shown.length && <p className="muted">{t('record.nothing_to_show_here')}</p>}
          {shown.map((s) => (
            <button key={s.id} role="option" aria-selected={pick === s.id} className={`rec-source ${pick === s.id ? 'on' : ''}`} onClick={() => setPick(s.id)} title={s.name}>
              {s.thumb ? <img src={s.thumb} alt="" /> : <span className="rec-nothumb"><AppWindow size={22} /></span>}
              <span className="rec-name">{s.icon && <img src={s.icon} alt="" />}{s.name}</span>
            </button>
          ))}
        </div>
        <div className="rec-opts">
          <label><input type="checkbox" checked={opts.systemAudio} onChange={set('systemAudio')} /> <Volume2 size={14} /> {t('record.computer_sound')}</label>
          <label><input type="checkbox" checked={opts.hideApp} onChange={set('hideApp')} /> {t('record.hide_clipcraft_while_recording')}</label>
        </div>
        <div className="rec-devices">
          <div className="rec-device">
            <label><input type="checkbox" checked={opts.mic} onChange={(e) => { set('mic')(e); if (e.target.checked) setTimeout(listDevices, 800); }} /> <Mic size={14} /> {t('record.microphone')}</label>
            <select value={opts.micId} disabled={!opts.mic} aria-label={t('record.microphone')} onChange={(e) => setO({ micId: e.target.value })}>
              <option value="">{t('record.default_microphone')}</option>
              {devices.mics.filter((d) => d.deviceId && d.deviceId !== 'default').map((d, i) => <option key={d.deviceId} value={d.deviceId}>{d.label || t('record.microphone_n', { n: i + 1 })}</option>)}
            </select>
          </div>
          <div className="rec-device">
            <label><input type="checkbox" checked={opts.camera} onChange={set('camera')} /> <Camera size={14} /> {t('record.camera')}</label>
            <select value={opts.cameraId} disabled={!opts.camera} aria-label={t('record.camera')} onChange={(e) => setO({ cameraId: e.target.value })}>
              <option value="">{t('record.default_camera')}</option>
              {devices.cams.filter((d) => d.deviceId).map((d, i) => <option key={d.deviceId} value={d.deviceId}>{d.label || t('record.camera_n', { n: i + 1 })}</option>)}
            </select>
            <div className="seg-tabs small rec-shape" role="radiogroup" aria-label={t('record.camera_shape')}>
              {[['circle', t('record.round'), Circle], ['square', t('record.square'), SquareDashed]].map(([id, name, Icon]) => (
                <button key={id} role="radio" aria-checked={opts.camShape === id} className={opts.camShape === id ? 'on' : ''} disabled={!opts.camera}
                  onClick={() => setO({ camShape: id })}><Icon size={13} /> {name}</button>
              ))}
            </div>
          </div>
          {opts.camera && (
            <div className="rec-camstyle">
              <div className="rec-camstyle-row">
                <span>{t('record.outline')}</span>
                <input type="color" value={opts.camStrokeColor} aria-label={t('record.camera_outline_color')}
                  onChange={(e) => setO({ camStrokeColor: e.target.value, camStroke: opts.camStroke || 6 })} />
                <span className="chips">
                  {['#ffffff', '#000000', '#ec4899', '#facc15', '#22d3ee'].map((c) => (
                    <button key={c} className="chip-color" style={{ background: c }} aria-label={t('record.outline_swatch', { color: c })} onClick={() => setO({ camStrokeColor: c, camStroke: opts.camStroke || 6 })} />
                  ))}
                </span>
                <input type="range" min="0" max="20" step="1" value={opts.camStroke} aria-label={t('record.camera_outline_width')}
                  onChange={(e) => setO({ camStroke: Number(e.target.value) })} />
                <span className="rec-camstyle-val">{opts.camStroke ? t('record.px_value', { value: opts.camStroke }) : t('record.off')}</span>
              </div>
              <div className="rec-camstyle-row">
                <span>{t('clip.glow')}</span>
                <input type="color" value={opts.camGlowColor} aria-label={t('record.camera_glow_color')}
                  onChange={(e) => setO({ camGlowColor: e.target.value, camGlow: opts.camGlow || 20 })} />
                <span className="chips">
                  {['#ec4899', '#a855f7', '#22d3ee', '#22c55e', '#facc15'].map((c) => (
                    <button key={c} className="chip-color" style={{ background: c }} aria-label={t('record.glow_swatch', { color: c })} onClick={() => setO({ camGlowColor: c, camGlow: opts.camGlow || 20 })} />
                  ))}
                </span>
                <input type="range" min="0" max="60" step="1" value={opts.camGlow} aria-label={t('record.camera_glow_size')}
                  onChange={(e) => setO({ camGlow: Number(e.target.value) })} />
                <span className="rec-camstyle-val">{opts.camGlow ? t('record.px_value', { value: opts.camGlow }) : t('record.off')}</span>
              </div>
            </div>
          )}
          {opts.camera && (
            <p className="muted small">
              {t('record.camera_bubble_on_screen')} {kind === 'window' ? t('record.window_recording_camera_own_clip') : t('record.camera_recorded_with_screen')}
            </p>
          )}
        </div>
        {rec.error && <p className="error-text">{rec.error}</p>}
        <p className="muted small">{t('record.saved_as_mp4_in_videos_clipcraft_and_added')}</p>
        <div className="modal-actions">
          <button className="btn" onClick={close}>{t('app.cancel')}</button>
          <button className="btn btn-primary" disabled={!pick} onClick={() => rec.start({ ...opts, sourceId: pick, at })}>
            <span className="rec-dot" /> {t('record.start_recording')}
          </button>
        </div>
      </div>
    </div>
  );
}
