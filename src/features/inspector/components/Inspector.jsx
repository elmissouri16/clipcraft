import {ExtensionActions} from '../../plugins/components/ExtensionNativeUi.jsx';
import PluginEffectControls from '../../plugins/components/PluginEffectControls.jsx';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useClockTime } from '../../preview/useClockTime.js';
import { Blend, Film, Layers, Music, PanelRightClose, RotateCcw, Settings2, Sparkles, Type } from 'lucide-react';
import { clipLen, formatTime, parseEffectKey, videoLayout } from "../../../state/store.js";
import { EFFECTS, RATIOS, allTransitions, effectInfo, sizeFor } from "../../effects/effects.js";
import { EXPORT_PRESETS, ENCODER_PRESETS, RES_CAPS, FPS_CHOICES, AUDIO_RATES, storedExportSettings, settingsPatch, resolveExport } from "../../export/exportQuality.js";
import Slider from "../../../components/ui/Slider.jsx";
import CurveEditor from './CurveEditor.jsx';
import NumBox from "../../../components/ui/NumBox.jsx";
import TextInspector from "../../text/components/TextInspector.jsx";
import ClipInspector from './ClipInspector.jsx';
import AudioFxControls from "../../audio/components/AudioFx.jsx";
import EnhanceVoice from "../../audio/components/EnhanceVoice.jsx";
import { isLookPatch, lookAction, selectedPictures } from "../../effects/look.js";
import { clipLenTl, clipStartTl } from "../../timeline/track.js";
import { t, tn } from '../../../i18n/index.js';
import { catalogName, effectLabel } from '../../../i18n/catalog.js';

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

const pct = (v) => `${Math.round(v * 100)}%`;

function ProjectDetails({ project, dispatch, duration }) {
  const set = (patch) => dispatch({ type: 'setProject', patch });
  const setFormat = (ratio, resolution) => set({ ratio, resolution, ratioLocked: project.ratioLocked || ratio !== project.ratio, ...sizeFor(ratio, resolution) });
  const RESOLUTIONS = [{ id: '480', name: t('inspector.480p') }, { id: '720', name: t('inspector.720p_hd') }, { id: '1080', name: t('inspector.1080p_full_hd') }, { id: '1440', name: t('inspector.1440p_2k') }, { id: '2160', name: t('inspector.2160p_4k') }];
  // Export quality: presets + Custom, all resolved by src/features/export/exportQuality.js (the same object the
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
    { id: 'high', small: t('inspector.crf_18_full_size_aac_192k') },
    { id: 'ultra', small: t('inspector.crf_14_full_size_aac_320k') },
    { id: 'custom', small: t('inspector.your_own_settings') },
  ];
  return (
    <div className="fields proj-card">
      <input className="proj-name" type="text" value={project.name} aria-label={t('topbar.project_name')}
        onChange={(e) => set({ name: e.target.value })} />
      <div className="proj-group">
        <span className="proj-label">{t('topbar.aspect_ratio')}</span>
        <div className="proj-ratios" role="radiogroup" aria-label={t('topbar.aspect_ratio')}>
          {Object.keys(RATIOS).map((r) => (
            <button key={r} type="button" role="radio" aria-checked={project.ratio === r}
              className={`proj-ratio ${project.ratio === r ? 'on' : ''}`} onClick={() => setFormat(r, project.resolution)}>
              <span className="proj-ratio-name">{r}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="proj-group">
        <span className="proj-label">{t('export.resolution')}</span>
        <div className="proj-seg" role="radiogroup" aria-label={t('export.resolution')}>
          {RESOLUTIONS.map((o) => (
            <button key={o.id} type="button" role="radio" aria-checked={String(project.resolution) === o.id}
              className={String(project.resolution) === o.id ? 'on' : ''} onClick={() => setFormat(project.ratio, Number(o.id))}>{o.name}</button>
          ))}
        </div>
      </div>
      <div className="proj-group">
        <span className="proj-label">{t('home.frame_rate')}</span>
        <div className="proj-seg" role="radiogroup" aria-label={t('home.frame_rate')}>
          {[24, 25, 30, 50, 60].map((f) => (
            <button key={f} type="button" role="radio" aria-checked={project.fps === f}
              className={project.fps === f ? 'on' : ''} onClick={() => set({ fps: f })}>{f} fps</button>
          ))}
        </div>
      </div>
      <div className="proj-group">
        <span className="proj-label">{t('inspector.export_quality')}</span>
        <div className="proj-quality" role="radiogroup" aria-label={t('inspector.export_quality')}>
          {QROWS.map((o) => (
            <button key={o.id} type="button" role="radio" aria-checked={stored.preset === o.id}
              className={`proj-qrow ${stored.preset === o.id ? 'on' : ''}`} onClick={() => setPreset(o.id)}>
              <span>{o.id === 'custom' ? t('curve-editor.custom') : EXPORT_PRESETS[o.id].name}</span><small>{o.small}</small>
            </button>
          ))}
        </div>
        {stored.preset === 'custom' && (
          <div className="export-custom">
            <div className="proj-seg" role="radiogroup" aria-label={t('export.quality_mode')}>
              {[['crf', 'CRF'], ['bitrate', t('export.bitrate')]].map(([id, name]) => (
                <button key={id} type="button" role="radio" aria-checked={custom.mode === id}
                  className={custom.mode === id ? 'on' : ''} onClick={() => setCustom({ mode: id })}>{name}</button>
              ))}
            </div>
            {custom.mode === 'crf' ? (
              <label className="field">
                <span>{t('inspector.crf_value', { value: custom.crf })}</span>
                <input type="range" min="0" max="51" step="1" value={custom.crf} aria-label={t('inspector.custom_crf')}
                  onChange={(e) => setCustom({ crf: Number(e.target.value) })} />
              </label>
            ) : (
              <label className="field">
                <span>{t('inspector.video_bitrate_mbps', { value: custom.bitrateMbps })}</span>
                <input type="range" min="1" max="60" step="1" value={custom.bitrateMbps} aria-label={t('inspector.custom_bitrate')}
                  onChange={(e) => setCustom({ bitrateMbps: Number(e.target.value) })} />
              </label>
            )}
            <div className="export-custom-row">
              <span className="export-custom-label">{t('inspector.max_size')}</span>
              <div className="proj-seg" role="radiogroup" aria-label={t('inspector.resolution_cap')}>
                {RES_CAPS.map((c) => (
                  <button key={c} type="button" role="radio" aria-checked={custom.resCap === c}
                    className={custom.resCap === c ? 'on' : ''} onClick={() => setCustom({ resCap: c })}>{c === 0 ? t('inspector.original') : c}</button>
                ))}
              </div>
            </div>
            <div className="export-custom-row">
              <span className="export-custom-label">{t('home.frame_rate')}</span>
              <div className="proj-seg" role="radiogroup" aria-label={t('inspector.export_frame_rate')}>
                {FPS_CHOICES.map((f) => (
                  <button key={f} type="button" role="radio" aria-checked={custom.fps === f}
                    className={custom.fps === f ? 'on' : ''} onClick={() => setCustom({ fps: f })}>{f === 0 ? t('inspector.project') : f}</button>
                ))}
              </div>
            </div>
            <div className="export-custom-row">
              <span className="export-custom-label">{t('export.codec')}</span>
              <div className="proj-seg" role="radiogroup" aria-label={t('export.codec')}>
                {[['h264', 'H.264'], ['h265', 'H.265']].map(([id, name]) => (
                  <button key={id} type="button" role="radio" aria-checked={custom.codec === id}
                    disabled={id === 'h265' && !caps.libx265}
                    className={custom.codec === id ? 'on' : ''} onClick={() => setCustom({ codec: id })}>{name}</button>
                ))}
              </div>
            </div>
            {!caps.libx265 && <p className="export-note-line">{t('inspector.h_265_is_not_available_in_this_build_h_264')}</p>}
            <Select label={t('inspector.encoder_preset')} value={custom.encoderPreset}
              options={ENCODER_PRESETS.map((p) => ({ id: p, name: p }))} onChange={(v) => setCustom({ encoderPreset: v })} />
            <div className="export-custom-row">
              <span className="export-custom-label">{t('inspector.audio_kbps')}</span>
              <div className="proj-seg" role="radiogroup" aria-label={t('inspector.audio_bitrate')}>
                {AUDIO_RATES.map((a) => (
                  <button key={a} type="button" role="radio" aria-checked={custom.audioKbps === a}
                    className={custom.audioKbps === a ? 'on' : ''} onClick={() => setCustom({ audioKbps: a })}>{a}</button>
                ))}
              </div>
            </div>
          </div>
        )}
        <p className="export-effective">
          {t('inspector.exports_at', { width: eff.outW, height: eff.outH, fps: eff.outFps, quality: eff.mode === 'crf' ? `CRF ${eff.crf}` : `${eff.bitrateMbps} Mbps`, codec: eff.codecLabel, audio: eff.audioKbps })}
        </p>
        {eff.notes.map((n) => <p key={n} className="export-note-line">{n}</p>)}
      </div>
      <label className="field row proj-bg">
        <span>{t('inspector.background')}</span>
        <input type="color" value={project.background} onChange={(e) => set({ background: e.target.value })} />
      </label>
      <div className="proj-stats">
        <span>{project.width}×{project.height} · {formatTime(duration)}</span>
        <span>{[tn('inspector.n_clips', project.videoClips.length), tn('inspector.n_texts', project.textClips.length), tn('inspector.n_audio', project.audioClips.length)].join(' · ')}</span>
      </div>
    </div>
  );
}

// A selected transition (its marker on the timeline), the Transition panel.
function TransitionPanel({ project, selection, dispatch }) {
  const clips = project.videoClips;
  const i = clips.findIndex((c) => c.id === selection.id);
  const clip = clips[i];
  const tr = clip && clip.transition;
  if (!tr) return <div className="fields"><div className="info dim">{t('inspector.this_transition_was_removed')}</div></div>;
  const transitions=allTransitions();
  if(!transitions.some(t=>t.id===tr.type))transitions.push({id:tr.type,name:tr.pluginTransition?.name||tr.type,duration:tr.duration,fx:!!tr.pluginTransition});
  const def = transitions.find((t) => t.id === tr.type);
  const set = (transition) => dispatch({ type: 'update', track: 'video', id: clip.id, patch: { transition } });
  // A transition can use at most half of each clip it joins.
  const max = Math.max(0.05, Math.min(clipLen(clip), clipLen(clips[i - 1]||clip)) / 2);
  const others = clips.filter((c, k) => k > 0 && !c.gap && !clips[k - 1].gap);
  const applyAll = () => {
    dispatch({ type: 'beginGesture' });
    for (const c of others) dispatch({ type: 'update', track: 'video', id: c.id, patch: { transition: { ...tr } } });
    dispatch({ type: 'endGesture' });
  };
  return (
    <div className="fields">
      <div className="fx-head"><span className="fx-icon"><Blend size={18} /></span>
        <div><b>{def ? catalogName('transition', def) : tr.type}</b><span className="dim">{t('inspector.between_clip_and_clip', { a: i, b: i + 1 })}</span></div></div>
      <div className="insp-card">
        <div className="insp-card-title">{t('inspector.transition')}</div>
      <label className="field">
        <span>{t('home.name')}</span>
        <select value={tr.type} onChange={(e) => {
          const t = transitions.find((x) => x.id === e.target.value);
          set({ type: t.id, duration: Math.min(max, t.fx ? t.duration : tr.duration), ...(t.fx && /zoom/i.test(t.id) ? { ease: 'smooth' } : {}) });
        }}>
          {transitions.map((t) => <option key={t.id} value={t.id}>{catalogName('transition', t)}</option>)}
        </select>
      </label>
      <Slider dispatch={dispatch} label={t('animation-panel.duration')} value={Math.min(tr.duration, max)} min={Math.min(0.1,max)} max={Number(max.toFixed(2))} step={0.05}
        fmt={(v) => `${v.toFixed(2)}s`} onChange={(duration) => set({ ...tr, duration })} />
      </div>
      <PluginEffectControls kind="transition" id={tr.type} instance={tr.pluginTransition} onChange={pluginTransition=>set({...tr,pluginTransition})} onUpgrade={(type,pluginTransition)=>set({...tr,type,pluginTransition})} />
      <div className="insp-card">
        <div className="insp-card-title">{t('inspector.motion_curve')}</div>
        {def?.fx ? (
          <CurveEditor value={tr.ease} onChange={(ease) => set({ ...tr, ease })} />
        ) : (
          <p className="dim small">{t('inspector.this_transition_renders_with_the_export_en')}</p>
        )}
      </div>
      <div className="row-btns">
        <button className="btn btn-sm" onClick={() => set({ ...tr, timelineOverlap: undefined, duration: Math.min(max, def?.duration || 0.5) })}><RotateCcw size={13} /> {t('hsl-curves.reset')}</button>
        <button className="btn btn-sm" onClick={applyAll} disabled={others.length < 2} title={t('inspector.use_this_transition_between_every_pair_of')}>{t('grade.apply_to_all')}</button>
      </div>
      <button className="btn btn-danger" onClick={() => set(null)}>{t('inspector.remove_transition')}</button>
    </div>
  );
}

// ---- Effect region: confine an effect to one area of the frame ----
// Stored per effect instance: on the effect clip itself (region) for Effects-track effects,
// or in the clip's fxRegions map for effects attached to a clip. The renderer applies it as
// mix(original, effected, regionMask) for shader effects (src/features/effects/apply.js) and as a masked
// layer for particle/light effects, so the same controls serve every effect in the catalog.
export const DEFAULT_FX_REGION = { x: 0.3, y: 0.3, w: 0.4, h: 0.4, feather: 0.05, shape: 'rect', invert: false };

export function RegionControls({ region, onChange, dispatch }) {
  const on = !!region;
  const r = region || DEFAULT_FX_REGION;
  const set = (p) => onChange({ ...r, ...p });
  const pct = (v) => `${Math.round(v * 100)}%`;
  const S = (p) => <Slider dispatch={dispatch} {...p} />;
  return (
    <div className="insp-card">
      <div className="insp-card-head"><span className="insp-card-title">{t('inspector.region')}</span>
        <input type="checkbox" checked={on} aria-label={t('inspector.limit_effect_to_a_region')}
          onChange={(e) => onChange(e.target.checked ? { ...DEFAULT_FX_REGION } : null)} />
      </div>
      {!on && <p className="dim small">{t('inspector.the_effect_covers_the_whole_frame_tick_to')}</p>}
      {on && (
        <>
          <div className="chips">
            {[['rect', t('inspector.rectangle')], ['ellipse', t('inspector.ellipse')]].map(([id, name]) => (
              <button key={id} className={`chip ${r.shape === id ? 'on' : ''}`} onClick={() => set({ shape: id })}>{name}</button>
            ))}
            <button className={`chip ${r.invert ? 'on' : ''}`} aria-pressed={!!r.invert} onClick={() => set({ invert: !r.invert })}>{t('clip.invert')}</button>
          </div>
          {S({ label: t('inspector.position_x'), value: r.x, min: 0, max: 0.95, step: 0.01, fmt: pct, numScale: 100, onChange: (x) => set({ x }) })}
          {S({ label: t('inspector.position_y'), value: r.y, min: 0, max: 0.95, step: 0.01, fmt: pct, numScale: 100, onChange: (y) => set({ y }) })}
          {S({ label: t('clip.width'), value: r.w, min: 0.05, max: 1, step: 0.01, fmt: pct, numScale: 100, onChange: (w) => set({ w }) })}
          {S({ label: t('clip.height'), value: r.h, min: 0.05, max: 1, step: 0.01, fmt: pct, numScale: 100, onChange: (h) => set({ h }) })}
          {S({ label: t('clip.feather'), value: r.feather, min: 0, max: 0.3, step: 0.01, fmt: pct, numScale: 100, onChange: (feather) => set({ feather }) })}
          <p className="dim small">{t('inspector.you_can_also_drag_the_dashed_box_on_the_pl')}</p>
        </>
      )}
    </div>
  );
}

// ---- Effect strength: how strongly an effect instance lands (0..1, absent = 1) ----
// Shader effects take it as a mix with the untouched picture and particle layers as
// opacity (src/features/effects/apply.js); a classic effect on a clip is routed through its shader
// form as soon as the strength drops below 1. Mirror and Flip are geometric — they
// have no in-between — so they get no strength control.
const NO_STRENGTH = ['mirror', 'flipv'];
export function StrengthControl({ value, onChange, dispatch }) {
  const pct = (v) => `${Math.round(v * 100)}%`;
  const S = (p) => <Slider dispatch={dispatch} {...p} />;
  return (
    <div className="insp-card">
      <div className="insp-card-title">{t('inspector.strength')}</div>
      {S({ label: t('grade.intensity'), value: value ?? 1, min: 0, max: 1, step: 0.01, fmt: pct, numScale: 100, onChange })}
      <p className="dim small">{t('inspector.how_strongly_the_effect_lands_0_is_the_unt')}</p>
    </div>
  );
}

// "Add text" card shared by both effect panels: puts a text clip over exactly the range the
// effect covers, via the app's single add-text path (App's onAddTextOver), which also selects
// the new clip so the text inspector opens ready to type.
function AddTextCard({ onAddTextOver, start, duration }) {
  if (!onAddTextOver) return null;
  return (
    <div className="insp-card">
      <div className="insp-card-title">{t('tts.text')}</div>
      <p className="dim small">{t('inspector.put_words_over_this_part_of_the_video_the')}</p>
      <button className="btn btn-primary" onClick={() => onAddTextOver(start, duration)}><Type size={14} /> {t('inspector.add_text')}</button>
    </div>
  );
}

function FreeEffectPanel({ project, selection, dispatch, onAddTextOver = null }) {
  const c = (project.effectClips || []).find((x) => x.id === selection.id);
  if (!c) return <div className="fields"><div className="info dim">{t('inspector.this_effect_was_removed')}</div></div>;
  const e = effectInfo(c.fx);
  const set = (patch) => dispatch({ type: 'update', track: 'effect', id: c.id, patch });
  return (
    <div className="fields">
      <div className="fx-head"><span className="fx-icon">{e?.icon || '✨'}</span><div><b>{c.pluginEffect?.name||effectLabel(e, c.fx)}</b><span className="dim">{t('inspector.on_the_effects_track')}</span></div></div>
      <div className="insp-card">
        <div className="insp-card-title">{t('inspector.timing')}</div>
      <p className="dim small">{t(e?.group === 'Filters' ? 'inspector.gives_every_picture_under_it_this_look' : 'inspector.acts_on_every_picture_under_it')}</p>
      <Num label={t('inspector.start_s')} value={c.start} min={0} onChange={(start) => set({ start: Math.max(0, start) })} />
      <Num label={t('graphic.duration_s')} value={c.duration} min={0.1} onChange={(d) => set({ duration: Math.max(0.1, d) })} />
      </div>
      <PluginEffectControls id={c.fx} instance={c.pluginEffect} onChange={pluginEffect=>set({pluginEffect})} onUpgrade={(fx,pluginEffect)=>set({fx,pluginEffect})} />
      {!NO_STRENGTH.includes(c.fx) && <StrengthControl value={c.strength} dispatch={dispatch}
        onChange={(k) => set({ strength: k >= 1 ? undefined : k })} />}
      <RegionControls region={c.region || null} dispatch={dispatch}
        onChange={(region) => set({ region: region ?? undefined })} />
      <AddTextCard onAddTextOver={onAddTextOver} start={c.start} duration={c.duration} />
      <button className="btn btn-danger" onClick={() => dispatch({ type: 'delete', track: 'effect', id: c.id })}>{t('inspector.remove_effect')}</button>
    </div>
  );
}

function EffectPanel({ project, selection, dispatch, onAddTextOver = null, onSelectEffect }) {
  if (!selection.id.includes('|')) return <FreeEffectPanel project={project} selection={selection} dispatch={dispatch} onAddTextOver={onAddTextOver} />;
  const { track, clipId, fx } = parseEffectKey(selection.id);
  const list = track === 'overlay' ? project.overlayClips || [] : project.videoClips;
  const clip = list.find((c) => c.id === clipId);
  const e = effectInfo(fx);
  const media = clip && project.media.find((m) => m.id === clip.mediaId);
  if (!clip || !(clip.effects || []).includes(fx)) return <div className="fields"><div className="info dim">{t('inspector.this_effect_was_removed')}</div></div>;
  // Region storage for a clip-attached effect: the clip's fxRegions map, keyed by effect id.
  const setRegion = (region) => {
    const next = { ...(clip.fxRegions || {}) };
    if (region) next[fx] = region; else delete next[fx];
    dispatch({ type: 'update', track, id: clipId, patch: { fxRegions: next } });
  };
  // Strength storage likewise: the clip's fxStrength map (absent = full strength).
  const setStrength = (k) => {
    const next = { ...(clip.fxStrength || {}) };
    if (k == null || k >= 1) delete next[fx]; else next[fx] = k;
    dispatch({ type: 'update', track, id: clipId, patch: { fxStrength: next } });
  };
  return (
    <div className="fields">
      <div className="fx-head"><span className="fx-icon">{e?.icon || '✨'}</span><div><b>{e ? catalogName('effect', e) : fx}</b><span className="dim">{t('inspector.on_name', { name: media?.name || t('inspector.clip') })}</span></div></div>
      <div className="insp-card">
      <p className="dim small">{t('inspector.the_effect_runs_for_the_whole_clip_and_mov')}</p>
      </div>
      <PluginEffectControls id={fx} instance={clip.pluginEffects?.[fx]}
        onChange={instance=>dispatch({type:'update',track,id:clipId,patch:{pluginEffects:{...clip.pluginEffects,[fx]:instance}}})}
        onUpgrade={(next,instance)=>{
          const pluginEffects={...clip.pluginEffects};delete pluginEffects[fx];pluginEffects[next]=instance;
          const remap=map=>{const result={...map};if(Object.hasOwn(result,fx)){result[next]=result[fx];delete result[fx];}return result;};
          dispatch({type:'update',track,id:clipId,patch:{effects:[...new Set(clip.effects.map(id=>id===fx?next:id))],pluginEffects,fxStrength:remap(clip.fxStrength),fxRegions:remap(clip.fxRegions)}});
          onSelectEffect?.({track:'effect',id:`${track}|${clipId}|${next}`});
        }} />
      {!NO_STRENGTH.includes(fx) && <StrengthControl value={clip.fxStrength?.[fx]} dispatch={dispatch} onChange={setStrength} />}
      <RegionControls region={clip.fxRegions?.[fx] || null} dispatch={dispatch} onChange={setRegion} />
      <AddTextCard onAddTextOver={onAddTextOver} start={clipStartTl(project, track, clip)} duration={clipLenTl(track, clip)} />
      <button className="btn btn-danger" onClick={() => dispatch({ type: 'removeEffect', id: selection.id })}>{t('inspector.remove_effect')}</button>
    </div>
  );
}

function InspectorHeader({ Icon, title, onCollapse }) {
  return <div className="panel-head">
    <Icon size={15} aria-hidden="true" /><span className="panel-title">{title}</span>
    <button type="button" className="icon-btn sm inspector-collapse" aria-label={t('inspector.hide_properties_panel')} title={t('inspector.hide_properties_panel')}
      aria-controls="inspector-panel" aria-expanded="true" onClick={onCollapse}><PanelRightClose size={16} aria-hidden="true" /></button>
  </div>;
}

export default function Inspector({  collapsed = false, onCollapse, project, selection, dispatch, duration, time: pausedTime = 0, clockRef, playing = false, onSeek = () => {}, onEnhance = null, onTrackPick = null, onCropEdit = null, onColorPick = null, onAddTextOver = null, onSelectEffect }) {
  const bodyRef = useRef(null);
  useLayoutEffect(() => { if (bodyRef.current) bodyRef.current.scrollTop = 0; }, [selection?.track, selection?.id]);
  const time = useClockTime(clockRef, pausedTime, playing && !collapsed);
  const multi = selection?.items && (
    <div className="multi-note" role="status">
      <b>{tn('inspector.n_clips_selected', selection.items.length)}</b> {t('inspector.delete_removes_them_all_drag_one_off_the_m')}
    </div>
  );
  if (selection?.track === 'transition') {
    return (
      <aside id="inspector-panel" className="inspector" aria-label={t('app.properties')} hidden={collapsed}>
        <InspectorHeader Icon={Blend} title={t('inspector.transition')} onCollapse={onCollapse} />
        <div className="inspector-body" ref={bodyRef}>{multi}<TransitionPanel project={project} selection={selection} dispatch={dispatch} /></div>
      </aside>
    );
  }
  if (selection?.track === 'effect') {
    return (
      <aside id="inspector-panel" className="inspector" aria-label={t('app.properties')} hidden={collapsed}>
        <InspectorHeader Icon={Sparkles} title={t('inspector.effect')} onCollapse={onCollapse} />
        <div className="inspector-body" ref={bodyRef}>{multi}{!collapsed&&<ExtensionActions location="inspector"/>}<EffectPanel onSelectEffect={onSelectEffect} project={project} selection={selection} dispatch={dispatch} onAddTextOver={onAddTextOver} /></div>
      </aside>
    );
  }
  const track = selection?.track;
  const key = { video: 'videoClips', overlay: 'overlayClips', text: 'textClips', audio: 'audioClips' }[track];
  const clip = key && project[key].find((c) => c.id === selection.id);
  // With several clips selected, a filter or color change made here goes to all of them (one undo step).
  const set = (patch) => {
    const many = selectedPictures(project, selection);
    if (many.length > 1 && isLookPatch(patch) && (track === 'video' || track === 'overlay')) dispatch(lookAction(many, clip, patch));
    else dispatch({ type: 'update', track, id: clip.id, patch });
  };
  const media = clip?.mediaId && project.media.find((m) => m.id === clip.mediaId);
  const S = (p) => <Slider dispatch={dispatch} {...p} />;

  const title = !clip ? t('inspector.project_settings') : clip.gap ? t('inspector.gap') : { video: t('inspector.video_clip'), overlay: t('inspector.overlay'), text: clip?.caption ? t('inspector.caption') : t('tts.text'), audio: t('edit-plan-card.audio') }[track];
  const Icon = !clip ? Settings2 : { video: Film, overlay: Layers, text: Type, audio: Music }[track];

  return (
    <aside id="inspector-panel" className="inspector" aria-label={t('app.properties')} hidden={collapsed}>
      <InspectorHeader Icon={Icon} title={title} onCollapse={onCollapse} />
      <div className="inspector-body" ref={bodyRef}>
      {multi}
      {!collapsed&&<ExtensionActions location="inspector"/>}
      {!clip && <ProjectDetails project={project} dispatch={dispatch} duration={duration} />}

      {clip && track === 'text' && <TextInspector key={clip.id} clip={clip} dispatch={dispatch} project={project} />}

      {clip && track === 'video' && clip.gap && (
        <div className="fields">
          <div className="insp-card">
            <div className="insp-card-title">{t('inspector.gap')}</div>
          <div className="info">{t('inspector.empty_space_on_the_main_track_it_plays_the')}</div>
          <NumBox layout="field" label={t('inspector.length_s')} step={0.1} min={0.1} value={Number((clip.out - clip.in).toFixed(2))}
            onChange={(v) => set({ out: Math.max(0.1, v) })} />
          </div>
          <button className="btn" onClick={() => { dispatch({ type: 'delete', track: 'video', id: clip.id }); }}>{t('inspector.close_gap')}</button>
        </div>
      )}

      {clip && (track === 'video' || track === 'overlay') && !clip.gap && (
        <ClipInspector key={clip.id} clip={clip} media={media} project={project} set={set} dispatch={dispatch} track={track}
          time={time} readTime={() => clockRef?.current?.time ?? time} onSeek={onSeek} onEnhance={onEnhance} onTrackPick={onTrackPick} onCropEdit={onCropEdit} onColorPick={onColorPick}
          start={track === 'overlay' ? clip.start : videoLayout(project.videoClips).find((l) => l.clip.id === clip.id)?.start ?? 0} />
      )}

      {clip && track === 'audio' && (
        <div className="fields audio-insp">
          <div className="insp-card">
            <div className="insp-card-title">{t('inspector.clip_audio')}</div>
            <div className="info">{media?.name}</div>
            {S({ label: t('clip.volume'), value: clip.volume ?? 1, max: 2, fmt: pct, numScale: 100, onChange: (volume) => set({ volume }) })}
            {S({ label: t('inspector.fade_in'), value: clip.fadeIn || 0, max: 5, step: 0.1, fmt: (v) => `${v.toFixed(1)}s`, onChange: (fadeIn) => set({ fadeIn }) })}
            {S({ label: t('inspector.fade_out'), value: clip.fadeOut || 0, max: 5, step: 0.1, fmt: (v) => `${v.toFixed(1)}s`, onChange: (fadeOut) => set({ fadeOut }) })}
            <Num label={t('inspector.timeline_start_s')} value={clip.start} min={0} onChange={(start) => set({ start: Math.max(0, start) })} />
          </div>
          <div className="insp-card">
            <div className="insp-card-title">{t('enhance.enhance_voice')}</div>
            <EnhanceVoice clip={clip} media={media} set={set} onEnhance={onEnhance} />
          </div>
          <div className="insp-card">
            <div className="insp-card-title">{t('inspector.audio_effects')}</div>
            {clip.volumeKeys?.length > 0 && <div className="afx-note">{tn('inspector.volume_automation_points', clip.volumeKeys.length)} <button className="btn btn-sm btn-ghost" onClick={() => set({ volumeKeys: undefined })}>{t('clip.clear_automation')}</button></div>}
            <AudioFxControls fx={clip.audioFx} onChange={(audioFx) => set({ audioFx })} />
          </div>
        </div>
      )}

      </div>
    </aside>
  );
}
