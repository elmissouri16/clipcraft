import React, { useEffect, useState } from 'react';
import { Blend, Film, Info, Layers, Music, RotateCcw, Settings2, Smile, Sparkles, Type } from 'lucide-react';
import { clipLen, formatTime, parseEffectKey, videoLayout } from '../store.js';
import { ANIMATIONS, EFFECTS, RATIOS, TRANSITIONS, sizeFor } from '../effects.js';
import { EXPORT_PRESETS, ENCODER_PRESETS, RES_CAPS, FPS_CHOICES, AUDIO_RATES, storedExportSettings, settingsPatch, resolveExport } from '../exportQuality.js';
import Slider from './Slider.jsx';
import CurveEditor from './CurveEditor.jsx';
import NumBox from './NumBox.jsx';
import TextInspector from './TextInspector.jsx';
import ClipInspector from './ClipInspector.jsx';
import AudioFxControls from './AudioFx.jsx';
import { isLookPatch, lookAction, selectedPictures } from '../look.js';

function Num({ label, value, onChange, step = 0.1, min, max }) {
  return <NumBox layout="field" label={label} value={value} step={step} min={min} max={max} onChange={onChange} />;
}

function Select({ label, value, options, onChange }) {
  return (
    <label className="field">
      <span>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
      </select>
    </label>
  );
}

function Color({ label, value, onChange }) {
  return (
    <label className="field row">
      <span>{label}</span>
      <input type="color" value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

const pct = (v) => `${Math.round(v * 100)}%`;

function ProjectDetails({ project, dispatch, duration }) {
  const set = (patch) => dispatch({ type: 'setProject', patch });
  const setFormat = (ratio, resolution) => set({ ratio, resolution, ratioLocked: project.ratioLocked || ratio !== project.ratio, ...sizeFor(ratio, resolution) });
  const RESOLUTIONS = [{ id: '480', name: '480p' }, { id: '720', name: '720p (HD)' }, { id: '1080', name: '1080p (Full HD)' }, { id: '1440', name: '1440p (2K)' }, { id: '2160', name: '2160p (4K)' }];
  // Export quality: presets + Custom, all resolved by src/exportQuality.js (the same object the
  // export pipeline consumes — see the Export dialog summary).
  const [caps, setCaps] = useState({ libx265: true });
  useEffect(() => { let on = true; window.api.exportCaps?.().then((c) => { if (on && c) setCaps(c); }).catch(() => {}); return () => { on = false; }; }, []);
  const stored = storedExportSettings(project);
  const eff = resolveExport(project, caps);
  const setPreset = (id) => set(settingsPatch(project, { preset: id, custom: stored.custom }));
  const setCustom = (patch) => set(settingsPatch(project, { preset: 'custom', custom: { ...stored.custom, ...patch } }));
  const custom = stored.custom;
  const QROWS = [
    { id: 'low', small: 'CRF 28 · ≤720 · AAC 96k' },
    { id: 'medium', small: 'CRF 23 · ≤1080 · AAC 128k' },
    { id: 'high', small: 'CRF 18 · full size · AAC 192k' },
    { id: 'ultra', small: 'CRF 14 · full size · AAC 320k' },
    { id: 'custom', small: 'Your own settings' },
  ];
  return (
    <div className="fields proj-card">
      <input className="proj-name" type="text" value={project.name} aria-label="Project name"
        onChange={(e) => set({ name: e.target.value })} />
      <div className="proj-group">
        <span className="proj-label">Aspect ratio</span>
        <div className="proj-ratios" role="radiogroup" aria-label="Aspect ratio">
          {Object.keys(RATIOS).map((r) => (
            <button key={r} type="button" role="radio" aria-checked={project.ratio === r}
              className={`proj-ratio ${project.ratio === r ? 'on' : ''}`} onClick={() => setFormat(r, project.resolution)}>
              <span className="proj-ratio-stage"><span className="proj-ratio-shape" style={{ aspectRatio: r.replace(':', ' / ') }} /></span>
              <span className="proj-ratio-name">{r}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="proj-group">
        <span className="proj-label">Resolution</span>
        <div className="proj-seg" role="radiogroup" aria-label="Resolution">
          {RESOLUTIONS.map((o) => (
            <button key={o.id} type="button" role="radio" aria-checked={String(project.resolution) === o.id}
              className={String(project.resolution) === o.id ? 'on' : ''} onClick={() => setFormat(project.ratio, Number(o.id))}>{o.name}</button>
          ))}
        </div>
      </div>
      <div className="proj-group">
        <span className="proj-label">Frame rate</span>
        <div className="proj-seg" role="radiogroup" aria-label="Frame rate">
          {[24, 25, 30, 50, 60].map((f) => (
            <button key={f} type="button" role="radio" aria-checked={project.fps === f}
              className={project.fps === f ? 'on' : ''} onClick={() => set({ fps: f })}>{f} fps</button>
          ))}
        </div>
      </div>
      <div className="proj-group">
        <span className="proj-label">Export quality</span>
        <div className="proj-quality" role="radiogroup" aria-label="Export quality">
          {QROWS.map((o) => (
            <button key={o.id} type="button" role="radio" aria-checked={stored.preset === o.id}
              className={`proj-qrow ${stored.preset === o.id ? 'on' : ''}`} onClick={() => setPreset(o.id)}>
              <span>{o.id === 'custom' ? 'Custom' : EXPORT_PRESETS[o.id].name}</span><small>{o.small}</small>
            </button>
          ))}
        </div>
        {stored.preset === 'custom' && (
          <div className="export-custom">
            <div className="proj-seg" role="radiogroup" aria-label="Quality mode">
              {[['crf', 'CRF'], ['bitrate', 'Bitrate']].map(([id, name]) => (
                <button key={id} type="button" role="radio" aria-checked={custom.mode === id}
                  className={custom.mode === id ? 'on' : ''} onClick={() => setCustom({ mode: id })}>{name}</button>
              ))}
            </div>
            {custom.mode === 'crf' ? (
              <label className="field">
                <span>CRF · {custom.crf}</span>
                <input type="range" min="0" max="51" step="1" value={custom.crf} aria-label="Custom CRF"
                  onChange={(e) => setCustom({ crf: Number(e.target.value) })} />
              </label>
            ) : (
              <label className="field">
                <span>Video bitrate · {custom.bitrateMbps} Mbps</span>
                <input type="range" min="1" max="60" step="1" value={custom.bitrateMbps} aria-label="Custom bitrate"
                  onChange={(e) => setCustom({ bitrateMbps: Number(e.target.value) })} />
              </label>
            )}
            <div className="export-custom-row">
              <span className="export-custom-label">Max size</span>
              <div className="proj-seg" role="radiogroup" aria-label="Resolution cap">
                {RES_CAPS.map((c) => (
                  <button key={c} type="button" role="radio" aria-checked={custom.resCap === c}
                    className={custom.resCap === c ? 'on' : ''} onClick={() => setCustom({ resCap: c })}>{c === 0 ? 'Original' : c}</button>
                ))}
              </div>
            </div>
            <div className="export-custom-row">
              <span className="export-custom-label">Frame rate</span>
              <div className="proj-seg" role="radiogroup" aria-label="Export frame rate">
                {FPS_CHOICES.map((f) => (
                  <button key={f} type="button" role="radio" aria-checked={custom.fps === f}
                    className={custom.fps === f ? 'on' : ''} onClick={() => setCustom({ fps: f })}>{f === 0 ? 'Project' : f}</button>
                ))}
              </div>
            </div>
            <div className="export-custom-row">
              <span className="export-custom-label">Codec</span>
              <div className="proj-seg" role="radiogroup" aria-label="Codec">
                {[['h264', 'H.264'], ['h265', 'H.265']].map(([id, name]) => (
                  <button key={id} type="button" role="radio" aria-checked={custom.codec === id}
                    disabled={id === 'h265' && !caps.libx265}
                    className={custom.codec === id ? 'on' : ''} onClick={() => setCustom({ codec: id })}>{name}</button>
                ))}
              </div>
            </div>
            {!caps.libx265 && <p className="export-note-line">H.265 is not available in this build — H.264 only.</p>}
            <Select label="Encoder preset" value={custom.encoderPreset}
              options={ENCODER_PRESETS.map((p) => ({ id: p, name: p }))} onChange={(v) => setCustom({ encoderPreset: v })} />
            <div className="export-custom-row">
              <span className="export-custom-label">Audio kbps</span>
              <div className="proj-seg" role="radiogroup" aria-label="Audio bitrate">
                {AUDIO_RATES.map((a) => (
                  <button key={a} type="button" role="radio" aria-checked={custom.audioKbps === a}
                    className={custom.audioKbps === a ? 'on' : ''} onClick={() => setCustom({ audioKbps: a })}>{a}</button>
                ))}
              </div>
            </div>
          </div>
        )}
        <p className="export-effective">
          Exports at {eff.outW}×{eff.outH} · {eff.outFps} fps · {eff.mode === 'crf' ? `CRF ${eff.crf}` : `${eff.bitrateMbps} Mbps`} · {eff.codecLabel} · AAC {eff.audioKbps}k
        </p>
        {eff.notes.map((n) => <p key={n} className="export-note-line">{n}</p>)}
      </div>
      <label className="field row proj-bg">
        <span>Background</span>
        <input type="color" value={project.background} onChange={(e) => set({ background: e.target.value })} />
      </label>
      <div className="proj-stats">
        <span>{project.width}×{project.height} · {formatTime(duration)}</span>
        <span>{project.videoClips.length} clips · {project.textClips.length} texts · {project.stickerClips.length} stickers · {project.audioClips.length} audio</span>
      </div>
    </div>
  );
}

// A selected transition (its marker on the timeline), like CapCut's Transition panel.
function TransitionPanel({ project, selection, dispatch }) {
  const clips = project.videoClips;
  const i = clips.findIndex((c) => c.id === selection.id);
  const clip = clips[i];
  const tr = clip && clip.transition;
  if (!tr) return <div className="fields"><div className="info dim">This transition was removed.</div></div>;
  const def = TRANSITIONS.find((t) => t.id === tr.type);
  const set = (transition) => dispatch({ type: 'update', track: 'video', id: clip.id, patch: { transition } });
  // A transition can use at most half of each clip it joins.
  const max = Math.max(0.2, Math.min(clipLen(clip), clipLen(clips[i - 1])) / 2);
  const others = clips.filter((c, k) => k > 0 && !c.gap && !clips[k - 1].gap);
  const applyAll = () => {
    dispatch({ type: 'beginGesture' });
    for (const c of others) dispatch({ type: 'update', track: 'video', id: c.id, patch: { transition: { ...tr } } });
    dispatch({ type: 'endGesture' });
  };
  return (
    <div className="fields">
      <div className="fx-head"><span className="fx-icon"><Blend size={18} /></span>
        <div><b>{def?.name || tr.type}</b><span className="dim">between clip {i} and clip {i + 1}</span></div></div>
      <div className="insp-card">
        <div className="insp-card-title">Transition</div>
      <label className="field">
        <span>Name</span>
        <select value={tr.type} onChange={(e) => {
          const t = TRANSITIONS.find((x) => x.id === e.target.value);
          set({ type: t.id, duration: Math.min(max, t.fx ? t.duration : tr.duration), ...(t.fx && /zoom/i.test(t.id) ? { ease: 'smooth' } : {}) });
        }}>
          {TRANSITIONS.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </label>
      <Slider dispatch={dispatch} label="Duration" value={Math.min(tr.duration, max)} min={0.1} max={Number(max.toFixed(2))} step={0.05}
        fmt={(v) => `${v.toFixed(2)}s`} onChange={(duration) => set({ ...tr, duration })} />
      </div>
      <div className="insp-card">
        <div className="insp-card-title">Motion curve</div>
        {def?.fx ? (
          <CurveEditor value={tr.ease} onChange={(ease) => set(ease === undefined ? { type: tr.type, duration: tr.duration } : { ...tr, ease })} />
        ) : (
          <p className="dim small">This transition renders with the export engine's built-in curve, so easing does not apply. The FX transitions (Zoom, Whip, Spin, the reveal family…) take a motion curve.</p>
        )}
      </div>
      <div className="row-btns">
        <button className="btn btn-sm" onClick={() => set({ ...tr, duration: Math.min(max, def?.duration || 0.5) })}><RotateCcw size={13} /> Reset</button>
        <button className="btn btn-sm" onClick={applyAll} disabled={others.length < 2} title="Use this transition between every pair of clips">Apply to all</button>
      </div>
      <button className="btn btn-danger" onClick={() => set(null)}>Remove transition</button>
    </div>
  );
}

function FreeEffectPanel({ project, selection, dispatch }) {
  const c = (project.effectClips || []).find((x) => x.id === selection.id);
  if (!c) return <div className="fields"><div className="info dim">This effect was removed.</div></div>;
  const e = EFFECTS.find((x) => x.id === c.fx);
  const set = (patch) => dispatch({ type: 'update', track: 'effect', id: c.id, patch });
  return (
    <div className="fields">
      <div className="fx-head"><span className="fx-icon">{e?.icon || '✨'}</span><div><b>{e?.name || c.fx}</b><span className="dim">on the Effects track</span></div></div>
      <div className="insp-card">
        <div className="insp-card-title">Timing</div>
      <p className="dim small">Acts on every picture under it. Drag it on the timeline, or its edges to change its length.</p>
      <Num label="Start (s)" value={c.start} min={0} onChange={(start) => set({ start: Math.max(0, start) })} />
      <Num label="Duration (s)" value={c.duration} min={0.1} onChange={(d) => set({ duration: Math.max(0.1, d) })} />
      </div>
      <button className="btn btn-danger" onClick={() => dispatch({ type: 'delete', track: 'effect', id: c.id })}>Remove effect</button>
    </div>
  );
}

function EffectPanel({ project, selection, dispatch }) {
  if (!selection.id.includes('|')) return <FreeEffectPanel project={project} selection={selection} dispatch={dispatch} />;
  const { track, clipId, fx } = parseEffectKey(selection.id);
  const list = track === 'overlay' ? project.overlayClips || [] : project.videoClips;
  const clip = list.find((c) => c.id === clipId);
  const e = EFFECTS.find((x) => x.id === fx);
  const media = clip && project.media.find((m) => m.id === clip.mediaId);
  if (!clip || !(clip.effects || []).includes(fx)) return <div className="fields"><div className="info dim">This effect was removed.</div></div>;
  return (
    <div className="fields">
      <div className="fx-head"><span className="fx-icon">{e?.icon || '✨'}</span><div><b>{e?.name || fx}</b><span className="dim">on {media?.name || 'clip'}</span></div></div>
      <div className="insp-card">
      <p className="dim small">The effect runs for the whole clip and moves with it. Remove it here, with Delete, or from the right-click menu.</p>
      </div>
      <button className="btn btn-danger" onClick={() => dispatch({ type: 'removeEffect', id: selection.id })}>Remove effect</button>
    </div>
  );
}

export default function Inspector({ project, selection, dispatch, duration, time = 0, onSeek = () => {} }) {
  const multi = selection?.items && (
    <div className="multi-note" role="status">
      <b>{selection.items.length} clips selected.</b> Delete removes them all; drag one (off the main track) to move them together.
      Below: the first one.
    </div>
  );
  if (selection?.track === 'transition') {
    return (
      <aside className="inspector" aria-label="Properties">
        <div className="panel-head"><Blend size={15} aria-hidden="true" /><span className="panel-title">Transition</span></div>
        <div className="inspector-body">{multi}<TransitionPanel project={project} selection={selection} dispatch={dispatch} /></div>
      </aside>
    );
  }
  if (selection?.track === 'effect') {
    return (
      <aside className="inspector" aria-label="Properties">
        <div className="panel-head"><Sparkles size={15} aria-hidden="true" /><span className="panel-title">Effect</span></div>
        <div className="inspector-body">{multi}<EffectPanel project={project} selection={selection} dispatch={dispatch} /></div>
      </aside>
    );
  }
  const track = selection?.track;
  const key = { video: 'videoClips', overlay: 'overlayClips', text: 'textClips', audio: 'audioClips', sticker: 'stickerClips' }[track];
  const clip = key && project[key].find((c) => c.id === selection.id);
  // With several clips selected, a filter or color change made here goes to all of them (one undo step).
  const set = (patch) => {
    const many = selectedPictures(project, selection);
    if (many.length > 1 && isLookPatch(patch) && (track === 'video' || track === 'overlay')) dispatch(lookAction(many, clip, patch));
    else dispatch({ type: 'update', track, id: clip.id, patch });
  };
  const media = clip?.mediaId && project.media.find((m) => m.id === clip.mediaId);
  const S = (p) => <Slider dispatch={dispatch} {...p} />;

  const title = !clip ? 'Project settings' : clip.gap ? 'Gap' : { video: 'Video clip', overlay: 'Overlay', text: clip?.caption ? 'Caption' : 'Text', audio: 'Audio', sticker: 'Sticker' }[track];
  const Icon = !clip ? Settings2 : { video: Film, overlay: Layers, text: Type, audio: Music, sticker: Smile }[track];

  return (
    <aside className="inspector" aria-label="Properties">
      <div className="panel-head"><Icon size={15} aria-hidden="true" /><span className="panel-title">{title}</span></div>
      <div className="inspector-body">
      {multi}
      {!clip && <ProjectDetails project={project} dispatch={dispatch} duration={duration} />}

      {clip && track === 'text' && <TextInspector key={clip.id} clip={clip} dispatch={dispatch} />}

      {clip && track === 'sticker' && (
        <div className="fields">
          <div className="info">{clip.emoji ? <span style={{ fontSize: 32 }}>{clip.emoji}</span> : media?.name}</div>
          <div className="insp-card">
            <div className="insp-card-title">Transform</div>
          {S({ label: 'Size', value: clip.size, min: 20, max: Math.max(project.width, project.height), step: 1, onChange: (size) => set({ size }) })}
          {S({ label: 'Rotation', value: clip.rotation || 0, min: -180, max: 180, step: 1, fmt: (v) => `${v}°`, onChange: (rotation) => set({ rotation }) })}
          {S({ label: 'Position X', value: clip.x, fmt: pct, onChange: (x) => set({ x }) })}
          {S({ label: 'Position Y', value: clip.y, fmt: pct, onChange: (y) => set({ y }) })}
          </div>
          <div className="insp-card">
            <div className="insp-card-title">Animation & timing</div>
          <Select label="Animation" value={clip.anim || 'none'} options={ANIMATIONS.filter((a) => a.id !== 'slideup')} onChange={(anim) => set({ anim })} />
          <Num label="Start (s)" value={clip.start} min={0} onChange={(start) => set({ start: Math.max(0, start) })} />
          <Num label="Duration (s)" value={clip.duration} min={0.1} onChange={(d) => set({ duration: Math.max(0.1, d) })} />
          </div>
        </div>
      )}

      {clip && track === 'video' && clip.gap && (
        <div className="fields">
          <div className="insp-card">
            <div className="insp-card-title">Gap</div>
          <div className="info">Empty space on the main track. It plays the project background in silence.</div>
          <NumBox layout="field" label="Length (s)" step={0.1} min={0.1} value={Number((clip.out - clip.in).toFixed(2))}
            onChange={(v) => set({ out: Math.max(0.1, v) })} />
          </div>
          <button className="btn" onClick={() => { dispatch({ type: 'delete', track: 'video', id: clip.id }); }}>Close gap</button>
        </div>
      )}

      {clip && (track === 'video' || track === 'overlay') && !clip.gap && (
        <ClipInspector key={clip.id} clip={clip} media={media} project={project} set={set} dispatch={dispatch} track={track}
          time={time} onSeek={onSeek}
          start={track === 'overlay' ? clip.start : videoLayout(project.videoClips).find((l) => l.clip.id === clip.id)?.start ?? 0} />
      )}

      {clip && track === 'audio' && (
        <div className="fields audio-insp">
          <div className="insp-card">
            <div className="insp-card-title">Clip audio</div>
            <div className="info">{media?.name}</div>
            {S({ label: 'Volume', value: clip.volume ?? 1, max: 2, fmt: pct, onChange: (volume) => set({ volume }) })}
            {S({ label: 'Fade in', value: clip.fadeIn || 0, max: 5, step: 0.1, fmt: (v) => `${v.toFixed(1)}s`, onChange: (fadeIn) => set({ fadeIn }) })}
            {S({ label: 'Fade out', value: clip.fadeOut || 0, max: 5, step: 0.1, fmt: (v) => `${v.toFixed(1)}s`, onChange: (fadeOut) => set({ fadeOut }) })}
            <Num label="Timeline start (s)" value={clip.start} min={0} onChange={(start) => set({ start: Math.max(0, start) })} />
          </div>
          <div className="insp-card">
            <div className="insp-card-title">Audio effects</div>
            <AudioFxControls fx={clip.audioFx} onChange={(audioFx) => set({ audioFx })} />
          </div>
        </div>
      )}

      </div>
      <details className="shortcuts">
        <summary><Info size={13} aria-hidden="true" /> Keyboard shortcuts</summary>
        <dl>
          <dt><kbd>Space</kbd></dt><dd>Play / pause</dd>
          <dt><kbd>S</kbd> <kbd>Ctrl B</kbd></dt><dd>Split</dd>
          <dt><kbd>Ctrl D</kbd></dt><dd>Duplicate</dd>
          <dt><kbd>Delete</kbd></dt><dd>Delete</dd>
          <dt><kbd>Q</kbd> <kbd>W</kbd></dt><dd>Delete left / right of playhead</dd>
          <dt><kbd>B</kbd> <kbd>V</kbd></dt><dd>Razor / select tool</dd>
          <dt><kbd>M</kbd></dt><dd>Marker at playhead</dd>
          <dt><kbd>Ctrl Z</kbd> <kbd>Ctrl Y</kbd></dt><dd>Undo / redo</dd>
          <dt><kbd>←</kbd> <kbd>→</kbd></dt><dd>Step frame (Shift: 1s)</dd>
          <dt><kbd>F</kbd></dt><dd>Full screen player (Esc to leave)</dd>
          <dt><kbd>Ctrl</kbd> + wheel</dt><dd>Zoom the timeline</dd>
        </dl>
      </details>
    </aside>
  );
}
