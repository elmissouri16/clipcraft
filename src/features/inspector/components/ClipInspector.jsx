import React, { useEffect, useRef, useState } from 'react';
import {
  Crop, Pipette, RotateCcw,
} from 'lucide-react';
import { clipLen, findClipIn, formatTime, uid } from "../../../state/store.js";
import { originalWindow, stabilizeOffUpdates, stabilizeUpdates } from '../stabilize.js';
import { FILTERS, TRANSITIONS } from "../../effects/effects.js";
import { directionGroupFor } from "../../effects/collections.js";
import {
  BLEND_MODES, DEFAULT_CHROMA, DEFAULT_CROP, DEFAULT_MASK, DEFAULT_TRANSFORM, MASK_SHAPES, chromaOf, cropOf, framingPatch, maskOf, scaleXY, transformOf,
} from "../../preview/visual.js";
import { CROP_ASPECTS, aspectRatioOf, cropForAspect } from "../../preview/cropMath.js";
import { hasCustomMask } from "../../preview/customMask.js";
import CustomMaskEditor from './CustomMaskEditor.jsx';
import Slider from "../../../components/ui/Slider.jsx";
import NumBoxBase from "../../../components/ui/NumBox.jsx";
import KeyNav from "../../../components/ui/KeyNav.jsx";
import AnimationPanel from './AnimationPanel.jsx';
import GradePanel from "../../effects/components/GradePanel.jsx";
import AudioFxControls from "../../audio/components/AudioFx.jsx";
import EnhanceVoice from "../../audio/components/EnhanceVoice.jsx";
import { baseAt, editAt, hasAnyKeys, localTime, nextArrival, segmentEase, setSegmentEase } from "../../timeline/anim.js";
import { findClipAnywhere, trackedClips } from "../../timeline/track.js";
import CurveEditor from './CurveEditor.jsx';
import GraphicPanel from './GraphicPanel.jsx';
import { t, tn } from '../../../i18n/index.js';
import { catalogLabel, catalogName } from '../../../i18n/catalog.js';

const pct = (v) => `${Math.round(v * 100)}%`;
const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];

function Section({ title, onReset, children, check, keys }) {
  return (
    <section className="ci-section">
      <div className="ci-head">
        {check}
        <b>{title}</b>
        {keys}
        {onReset && <button className="icon-btn sm" aria-label={t('inspector.reset_name', { name: title })} title={t('hsl-curves.reset')} onClick={onReset}><RotateCcw size={13} /></button>}
      </div>
      {children}
    </section>
  );
}

function MaskIcon({ type }) {
  const p = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.6 };
  const shapes = {
    none: <path d="M6 6l20 20" {...p} />,
    split: <><rect x="4" y="4" width="24" height="24" rx="2" {...p} /><path d="M4 16h24" {...p} /></>,
    filmstrip: <><rect x="4" y="4" width="24" height="24" rx="2" {...p} /><path d="M4 11h24M4 21h24" {...p} /></>,
    circle: <circle cx="16" cy="16" r="10" {...p} />,
    rectangle: <rect x="7" y="9" width="18" height="14" rx="1" {...p} />,
    star: <path d="M16 5l3.2 7 7.3.6-5.6 4.8 1.8 7.3L16 20.8 9.3 24.7l1.8-7.3-5.6-4.8 7.3-.6z" {...p} />,
    heart: <path d="M16 26C5 18 6 9 11 8c3-.6 4.4 1.6 5 3 .6-1.4 2-3.6 5-3 5 1 6 10-5 18z" {...p} />,
    text: <path d="M9 8h14M16 8v17" {...p} />,
  };
  return <svg viewBox="0 0 32 32" width="26" height="26" aria-hidden="true">{shapes[type]}</svg>;
}

// Stabilize: the clip's part of the video is steadied by the main process (vid.stab) into a new file,
// which the clip then plays. clip.stabilize keeps the level and the original { mediaId, in, out }, so Off (or
// another level) starts again from the original (src/features/inspector/stabilize.js keeps source-time data
// and a linked partner in step, and derives the original window from the clip's current one).
const STAB_LEVELS = [['off', t('clip.off')], ['minimal', t('clip.minimal_crop')], ['recommended', t('clip.recommended')], ['most', t('clip.most_stable')]];
function Stabilize({ clip, media, project, track, dispatch, readLive }) {
  const [job, setJob] = useState(null); // { fraction } while working
  const [error, setError] = useState('');
  const st = clip.stabilize || null;
  const orig = st ? project.media.find((m) => m.id === st.mediaId) : media;
  useEffect(() => window.api.onStabilizeProgress((p) => { if (p.path === orig?.path) setJob({ fraction: p.fraction }); }), [orig?.path]);
  if (!orig || orig.type !== 'video') return null;
  const choose = async (level) => {
    setError('');
    if (level === 'off') {
      if (st) dispatch({ type: 'updateMany', updates: stabilizeOffUpdates(project, track, clip) });
      return;
    }
    const w = originalWindow(clip);
    const started = readLive?.();
    setJob({ fraction: 0 });
    const res = await window.api.stabilizeRun({ path: orig.path, duration: orig.duration, hdr: orig.hdr }, w.in, w.out, level);
    setJob(null);
    if (res.canceled) return;
    if (res.error) return setError(res.error);
    // The render applies only to the project load it started in, and to the clip as it was.
    const live = readLive?.() || { project };
    if (started && (live.version !== started.version || live.project.id !== started.project.id)) return;
    const now = findClipIn(live.project, track, clip.id);
    if (!now || now.mediaId !== clip.mediaId || (now.in || 0) !== (clip.in || 0) || now.out !== clip.out || (now.speed || 1) !== (clip.speed || 1)) return;
    let m = live.project.media.find((x) => x.path === res.path);
    const items = m ? [] : [m = { ...res, id: uid(), origin: 'stabilize' }]; // Media tree: Generated ▸ Processed
    const updates = stabilizeUpdates(live.project, track, now, m, level);
    dispatch(items.length ? { type: 'batch', actions: [{ type: 'addMedia', items }, { type: 'updateMany', updates }] } : { type: 'updateMany', updates });
  };
  return (
    <Section title={t('clip.stabilize')}>
      <p className="dim small">{t('clip.steadies_shaky_camera_footage_like_a_gimba')}</p>
      <div className="seg-tabs small stab-levels" role="radiogroup" aria-label={t('clip.stabilize')}>
        {STAB_LEVELS.map(([id, name]) => (
          <button key={id} role="radio" aria-checked={(st?.level || 'off') === id} className={(st?.level || 'off') === id ? 'on' : ''}
            disabled={!!job} onClick={() => choose(id)}>{name}</button>
        ))}
      </div>
      {job && (
        <div className="progress-block" aria-live="polite">
          <span>{t(job.fraction < 0.5 ? 'clip.analyzing_the_camera_shake_percent' : 'clip.stabilizing_percent', { percent: Math.round(job.fraction * 100) })}</span>
          <div className="progress"><div style={{ width: `${Math.round(job.fraction * 100)}%` }} /></div>
          <button className="btn btn-sm" onClick={() => window.api.stabilizeCancel()}>{t('app.cancel')}</button>
        </div>
      )}
      {error && <p className="error-text">{error}</p>}
    </Section>
  );
}

// Motion tracking: the point is picked on the player (App drives the pick mode), the engine follows it
// through the clip in the main process, and the path is stored on the clip (clip.track). Followers pin
// to it with PinToTrack below. Progress and cancel live in App's render-job pill, like the other renders.
function MotionTracking({ clip, media, set, onTrackPick, track }) {
  if (!media || media.type !== 'video') return null;
  const tr = clip.track && clip.track.points && clip.track.points.length ? clip.track : null;
  const low = tr ? tr.points.filter((p) => (p.c ?? 1) < 0.35).length : 0;
  return (
    <Section title={t('clip.motion_tracking')}>
      <p className="dim small">{t('clip.follow_a_moving_point_in_this_clip_a_face')}</p>
      {tr ? (
        <>
          <p className="dim small">{low ? tn('clip.tracked_points_some_uncertain', tr.points.length, { low }) : tn('clip.tracked_points_across_the_clip', tr.points.length)}</p>
          <div className="row">
            <button className="btn btn-sm" disabled={!onTrackPick} onClick={() => onTrackPick({ track, id: clip.id })}>{t('clip.track_again')}</button>
            <button className="btn btn-sm btn-ghost" onClick={() => set({ track: null })}>{t('clip.remove_track')}</button>
          </div>
        </>
      ) : (
        <button className="btn btn-sm" disabled={!onTrackPick} onClick={() => onTrackPick({ track, id: clip.id })}>{t('clip.track_motion')}</button>
      )}
    </Section>
  );
}

// Pin to track: this clip keeps its position relative to a tracked point in another clip and follows
// it (src/features/timeline/track.js evaluates the offset live, in the preview and the export alike). Rendered as a
// Section inside ClipInspector and as a card in the text inspector (card prop).
export function PinToTrack({ clip, project, set, card = false }) {
  const sources = trackedClips(project).filter((s) => s.clip.id !== clip.id);
  const pinnedTo = clip.pin && clip.pin.to ? findClipAnywhere(project, clip.pin.to) : null;
  const nameOf = (ref) => {
    const m = ref && project.media.find((x) => x.id === ref.clip.mediaId);
    return m?.name || t('clip.a_clip');
  };
  const body = pinnedTo ? (
    <>
      <p className="dim small">{t('clip.following_the_motion_tracked_in', { name: nameOf(pinnedTo) })}</p>
      <button className="btn btn-sm" onClick={() => set({ pin: null })}>{t('clip.unpin')}</button>
    </>
  ) : sources.length ? (
    <>
      <p className="dim small">{t('clip.make_this_clip_follow_a_moving_point_track')}</p>
      {sources.map((s) => (
        <button key={s.clip.id} className="btn btn-sm" onClick={() => set({ pin: { to: s.clip.id } })}>{t('clip.pin_to_name', { name: nameOf(s) })}</button>
      ))}
    </>
  ) : (
    <p className="dim small">{t('clip.no_tracked_clips_yet_select_a_video_clip_a')}</p>
  );
  if (card) return <div className="insp-card"><div className="insp-card-title">{t('clip.pin_to_track')}</div>{body}</div>;
  return <Section title={t('clip.pin_to_track')}>{body}</Section>;
}

// Properties of a picture clip (main track or overlay), the clip properties panel.
// time: playhead; start: where the clip starts on the timeline (values and keyframes follow the playhead).
export default function ClipInspector({ clip, media, project, set, dispatch, track, readLive = null, resetLook = null, time = 0, readTime = () => time, start = 0, onSeek = () => {}, onEnhance = null, onTrackPick = null, onCropEdit = null, onColorPick = null }) {
  // A motion graphic opens on its own fields.
  const [tab, setTab] = useState(media?.graphic ? 'graphic' : 'video');
  const [sub, setSub] = useState('basic');
  const [maskEdit, setMaskEdit] = useState(false);
  const S = (p) => <Slider dispatch={dispatch} {...p} />;
  // The shared scrub field, with a scrub wrapped in a single undo gesture. The wrapper's identity
  // must be STABLE across renders (useRef), or React remounts the field mid-scrub and kills the drag.
  const numBoxRef = useRef(null);
  if (!numBoxRef.current) {
    numBoxRef.current = (p) => <NumBoxBase {...p}
      onDragStart={() => dispatch({ type: 'beginGesture' })} onDragEnd={() => dispatch({ type: 'endGesture' })} />;
  }
  const NumBox = numBoxRef.current;
  const W = project.width;
  const H = project.height;
  const isVideo = media?.type === 'video';

  const len = clipLen(clip);
  const fps = project.fps || 30;
  const inside = time >= start - 1e-6 && time <= start + len + 1e-6;
  const lt = inside ? Math.min(len, Math.max(0, time - start)) : null;
  const localNow = () => { const now = readTime();return now >= start - 1e-6 && now <= start + len + 1e-6 ? Math.min(len,Math.max(0,now-start)) : null; };
  // Values at the playhead (keyframes applied); an edit of a keyframed value adds a keyframe there.
  const at = baseAt(clip, lt ?? 0);
  const tf = { ...transformOf(clip), scale: at.scale, x: at.x, y: at.y, rot: at.rot };
  const { sx } = scaleXY(tf);
  const setT = (patch) => set(editAt(clip, patch, localNow() ?? 0));
  const keys = (props, label) => (
    <KeyNav clip={clip} props={props} lt={lt} getLt={localNow} start={start} fps={fps} set={set} onSeek={onSeek} label={label} />
  );
  const dropKeys = (props) => {
    const k = { ...(clip.keyframes || {}) };
    props.forEach((p) => delete k[p]);
    return k;
  };
  const chroma = chromaOf(clip);
  const setC = (patch) => set({ chroma: { ...chroma, ...patch } });
  const mask = maskOf(clip);
  const setM = (patch) => set({ mask: { ...mask, ...patch } });

  // Align the scaled picture to a frame edge or center (rotation ignored).
  const cropNow = cropOf(clip);
  const fitW = media?.width ? Math.min(1, (media.width / media.height) / (W / H)) : 1;
  const fitH = media?.width ? Math.min(1, (media.height / media.width) / (H / W)) : 1;
  const { sx: ex, sy: ey } = scaleXY(tf);
  // Align pad anchors for one axis, from the scaled picture's size on it as a fraction of the
  // frame (w). Smaller than the frame: flush inside it (left cell = picture's left edge on the
  // frame's left edge). Larger: pan, so the chosen edge of the picture meets the frame's edge
  // and the picture keeps covering the frame. Exactly filling the axis (|w − 1| within half a
  // percent): edge alignment is vacuous — the picture already touches both edges at once, so
  // every flush anchor collapses to the centred position and the pad could never move the clip
  // (the dead pad on a full-frame clip at 100%). There the centre snaps to the frame's
  // third-points instead, so the cells still take the clip where their labels say.
  const axisAnchors = (w) => {
    if (w > 1.005) { const a = (w - 1) / 2; return [a, 0, -a]; }
    if (w < 0.995) { const a = (1 - w) / 2; return [-a, 0, a]; }
    return [-1 / 3, 0, 1 / 3];
  };
  const anchorsX = axisAnchors(fitW * ex);
  const anchorsY = axisAnchors(fitH * ey);
  // The pad reflects the current anchor only when BOTH axes sit on one (within a rounding pixel).
  const matchAxis = (v, anchors, eps) => {
    for (let i = 0; i < 3; i++) if (Math.abs(v - anchors[i]) <= eps) return i;
    return -1;
  };
  const acol = matchAxis(tf.x, anchorsX, 0.6 / W);
  const arow = matchAxis(tf.y, anchorsY, 0.6 / H);
  const activeAnchor = acol >= 0 && arow >= 0 ? arow * 3 + acol : -1;
  const PAD_LABELS = [t('clip.align_top_left'), t('clip.align_top'), t('clip.align_top_right'), t('text.align_left'), t('text.align_center'), t('text.align_right'), t('clip.align_bottom_left'), t('clip.align_bottom'), t('clip.align_bottom_right')];
  const alignPad = PAD_LABELS.map((label, i) => ({
    label,
    patch: { x: anchorsX[i % 3], y: anchorsY[Math.floor(i / 3)] },
    dot: { left: `${[14, 50, 86][i % 3]}%`, top: `${[18, 50, 82][Math.floor(i / 3)]}%` },
  }));

  // Pick samples a color from the player itself (an App stage mode, like track-pick): the
  // OS EyeDropper it used before silently rejects under Electron on Linux, so the button
  // did nothing there. The in-app sampler behaves the same on every platform.

  // Framing is a new base picture, not an oversized transform. Later scale 1
  // zoom keys must still cover the canvas, and Fit must restore the whole source.
  const fitFill = (mode) => {
    if (!media?.width || !media?.height || !W || !H) return;
    set(framingPatch(clip, media, W, H, mode));
  };

  const graphic = !!media?.graphic;
  const tabs = [...(graphic ? [['graphic', t('library.graphic')]] : []), ['video', t('pack.video')], ['animation', t('clip.animation')], ...(isVideo && !graphic ? [['audio', t('edit-plan-card.audio')], ['speed', t('tts.speed')]] : []), ['adjust', t('grade.adjust')]];

  return (
    <div className="clip-inspector">
      <div className="ci-tabs" role="tablist">
        {tabs.map(([id, name]) => (
          <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>{name}</button>
        ))}
      </div>
      <div className="info">{media?.name}<br />
        <span className="dim">{graphic
          ? t('clip.size_graphic_on_timeline', { width: media?.width ?? '', height: media?.height ?? '', length: clipLen(clip).toFixed(2) })
          : isVideo
            ? t('clip.size_duration_on_timeline', { width: media?.width ?? '', height: media?.height ?? '', duration: formatTime(media.duration), length: clipLen(clip).toFixed(2) })
            : t('clip.size_photo_on_timeline', { width: media?.width ?? '', height: media?.height ?? '', length: clipLen(clip).toFixed(2) })}</span>
      </div>

      {tab === 'graphic' && graphic && <GraphicPanel key={clip.id} clip={clip} media={media} project={project} track={track} dispatch={dispatch} />}

      {tab === 'video' && (
        <>
          <div className="seg-tabs small" role="tablist">
            {[['basic', t('clip.basic')], ['key', t('clip.chroma_brush')], ['mask', t('clip.mask')]].map(([id, name]) => (
              <button key={id} role="tab" aria-selected={sub === id} className={sub === id ? 'on' : ''} onClick={() => setSub(id)}>{name}</button>
            ))}
          </div>

          {sub === 'basic' && (
            <>
              <Section title={t('clip.transform')} keys={keys(['scale', 'x', 'y', 'rot'], 'transform')}
                onReset={() => set({ transform: { ...DEFAULT_TRANSFORM }, keyframes: dropKeys(['scale', 'x', 'y', 'rot']) })}>
                {S({ label: t('clip.scale'), value: tf.scale, min: 0.05, max: 4, step: 0.01, fmt: pct, numScale: 100, onChange: (scale) => setT({ scale }), extra: keys(['scale'], 'scale') })}
                <div className="fitfill-row">
                  <button type="button" className="btn btn-sm" onClick={() => fitFill('fit')}
                    title={t('clip.show_the_whole_picture_inside_the_frame')}>{t('clip.fit')}</button>
                  <button type="button" className="btn btn-sm" onClick={() => fitFill('fill')}
                    title={t('clip.cover_the_whole_frame_with_the_picture_the')}>{t('clip.fill')}</button>
                  <span className="dim small">{t('clip.fit_whole_picture_visible_fill_frame_cover')}</span>
                </div>
                <label className="field row">
                  <span>{t('clip.uniform_scale')}</span>
                  <input type="checkbox" className="switch" checked={tf.uniform} onChange={(e) => setT({ uniform: e.target.checked })} />
                </label>
                {!tf.uniform && (
                  <>
                    {S({ label: t('clip.scale_width'), value: tf.scaleX, min: 0.05, max: 4, step: 0.01, fmt: pct, numScale: 100, onChange: (scaleX) => setT({ scaleX }) })}
                    {S({ label: t('clip.scale_height'), value: tf.scaleY, min: 0.05, max: 4, step: 0.01, fmt: pct, numScale: 100, onChange: (scaleY) => setT({ scaleY }) })}
                  </>
                )}
                <div className="numrow keyed">
                  <span className="numrow-label">{t('clip.position')}</span>
                  <NumBox label="X" value={Number((tf.x * W).toFixed(1))} precision={1} suffix="px" onChange={(v) => setT({ x: v / W })} />
                  <NumBox label="Y" value={Number((tf.y * H).toFixed(1))} precision={1} suffix="px" onChange={(v) => setT({ y: v / H })} />
                  {keys(['x', 'y'], 'position')}
                </div>
                <div className="numrow keyed">
                  <span className="numrow-label">{t('clip.rotate')}</span>
                  <NumBox label="" value={tf.rot} step={1} precision={1} suffix="°" onChange={(rot) => setT({ rot })} />
                  <input type="range" className="rot-range" min="-180" max="180" step="1" value={tf.rot} aria-label={t('clip.rotate')}
                    onPointerDown={() => dispatch({ type: 'beginGesture' })} onPointerUp={() => dispatch({ type: 'endGesture' })}
                    onChange={(e) => setT({ rot: Number(e.target.value) })} />
                  {keys(['rot'], 'rotation')}
                </div>
                <div className="align-wrap">
                  <div className="align-pad" role="group" aria-label={t('clip.align_to_frame')}>
                    {alignPad.map((cell, i) => (
                      <button key={cell.label} type="button" className={i === activeAnchor ? 'on' : ''}
                        aria-label={cell.label} aria-pressed={i === activeAnchor} title={cell.label}
                        onClick={() => setT(cell.patch)}><i style={cell.dot} /></button>
                    ))}
                  </div>
                  <span className="dim small">{t('clip.snap_the_clip_to_a_corner_edge_or_the_cent')}</span>
                </div>
                <span className="dim small">{t('clip.scale_keyframe_hint', { scale: pct(sx) })}</span>
              </Section>
              {hasAnyKeys(clip) && lt !== null && nextArrival(clip, lt, fps) !== null && (
                <Section title={t('clip.segment_easing')}>
                  <span className="dim small">{t('clip.how_the_motion_travels_into_the_keyframe', { time: localTime(clip, nextArrival(clip, lt, fps)).toFixed(2) })}</span>
                  <CurveEditor compact continuous value={segmentEase(clip, lt, fps)} resetValue="smooth"
                    onChange={(ease) => { const now=localNow();if(now!==null)set(setSegmentEase(clip,now,ease,fps)); }} />
                </Section>
              )}
              {media && <Stabilize clip={clip} media={media} project={project} track={track} dispatch={dispatch} readLive={readLive} />}
              {media && <MotionTracking clip={clip} media={media} set={set} onTrackPick={onTrackPick} track={track} />}
              {track === 'overlay' && <PinToTrack clip={clip} project={project} set={set} />}
              <Section title={t('clip.blend')} onReset={() => set({ blend: 'normal', opacity: 1, keyframes: dropKeys(['opacity']) })}>
                <label className="field">
                  <span>{t('export.mode')}</span>
                  <select value={clip.blend || 'normal'} onChange={(e) => set({ blend: e.target.value })}>
                    {BLEND_MODES.map((b) => <option key={b.id} value={b.id}>{catalogName('blend', b)}</option>)}
                  </select>
                </label>
                {S({ label: t('clip.opacity'), value: at.opacity, min: 0, max: 1, step: 0.01, fmt: pct, numScale: 100, onChange: (opacity) => setT({ opacity }), extra: keys(['opacity'], 'opacity') })}
                {['mirror', 'flipv'].map((id) => (
                  <label className="field row" key={id}>
                    <span>{t(id === 'mirror' ? 'clip.flip_horizontal' : 'clip.flip_vertical')}</span>
                    <input type="checkbox" className="switch" aria-label={t(id === 'mirror' ? 'clip.flip_horizontal' : 'clip.flip_vertical')}
                      checked={(clip.effects || []).includes(id)}
                      onChange={(e) => {
                        const fx = clip.effects || [];
                        set({ effects: e.target.checked ? [...fx.filter((x) => x !== id), id] : fx.filter((x) => x !== id) });
                      }} />
                  </label>
                ))}
              </Section>
              <Section title={t('clip.crop')} onReset={() => set({ crop: { ...DEFAULT_CROP }, cropAspect: 'free' })}>
                <p className="dim small">{t('clip.cut_away_the_edges_of_the_picture_in_perce')}</p>
                <div className="chips pad-x" role="group" aria-label={t('app.crop_aspect')}>
                  {CROP_ASPECTS.map((a) => {
                    const cur = (clip.cropAspect || 'free') === a.id;
                    return (
                      <button key={a.id} type="button" className={`chip ${cur ? 'on' : ''}`} aria-pressed={cur}
                        onClick={() => {
                          if (a.id === 'free') { set({ cropAspect: 'free' }); return; }
                          const R = aspectRatioOf(a.id, media?.width, media?.height);
                          if (!R) return;
                          set({ crop: cropForAspect(cropNow, media.width, media.height, R), cropAspect: a.id });
                        }}>{catalogName('crop_aspect', a)}</button>
                    );
                  })}
                </div>
                {[['l', t('clip.left')], ['t', t('clip.top')], ['r', t('clip.right')], ['b', t('clip.bottom')]].map(([k, name]) => (
                  <div className="numrow" key={k}>
                    <span className="numrow-label">{name}</span>
                    <NumBox label="" value={Number((cropNow[k] * 100).toFixed(1))} step={1} precision={1} min={0} max={90} suffix="%"
                      onChange={(v) => set({ crop: { ...cropNow, [k]: Math.min(90, Math.max(0, v)) / 100 }, cropAspect: 'free' })} />
                  </div>
                ))}
                <button type="button" className="btn btn-sm" disabled={!onCropEdit || !media}
                  onClick={() => onCropEdit && onCropEdit({ track, id: clip.id })}>
                  <Crop size={13} /> {t('clip.crop_on_the_player')}
                </button>
                <p className="dim small">{t('clip.drag_the_frame_on_the_player_itself_you_ca')}</p>
              </Section>
            </>
          )}

          {sub === 'key' && (
            <Section title={t('clip.chroma_key')} onReset={() => set({ chroma: { ...DEFAULT_CHROMA } })}
              check={<input type="checkbox" aria-label={t('clip.chroma_key')} checked={chroma.on} onChange={(e) => setC({ on: e.target.checked })} />}>
              <p className="dim small">{t('clip.removes_a_solid_background_color_such_as_a')}</p>
              <div className="numrow">
                <span className="numrow-label">{t('clip.color')}</span>
                <input type="color" value={chroma.color} aria-label={t('clip.key_color')} onChange={(e) => setC({ on: true, color: e.target.value })} />
                <button className="btn btn-sm" disabled={!onColorPick} onClick={() => onColorPick && onColorPick({ track, id: clip.id })} title={t('clip.pick_a_color_from_the_player')}><Pipette size={13} /> {t('clip.pick')}</button>
                <span className="chips">
                  {['#00ff00', '#00b140', '#0047bb', '#ffffff', '#000000'].map((c) => (
                    <button key={c} className="swatch" style={{ background: c }} aria-label={t('clip.key_swatch', { color: c })} onClick={() => setC({ on: true, color: c })} />
                  ))}
                </span>
              </div>
              {S({ label: t('grade.intensity'), value: chroma.intensity, min: 0, max: 100, step: 1, onChange: (intensity) => setC({ intensity }) })}
              {S({ label: t('clip.feather_edge'), value: chroma.feather, min: 0, max: 100, step: 1, onChange: (feather) => setC({ feather }) })}
              {S({ label: t('clip.remove_color_spill'), value: chroma.spill, min: 0, max: 100, step: 1, onChange: (spill) => setC({ spill }) })}
            </Section>
          )}
          {sub === 'key' && (
            <Section title={t('clip.custom_removal')}>
              <p className="dim small">{t('clip.paint_over_the_parts_to_remove_by_hand_or')}</p>
              {hasCustomMask(clip) && <p className="dim small">{tn('clip.strokes_painted', clip.customMask.strokes.length)}</p>}
              <div className="fitfill-row">
                <button type="button" className="btn btn-sm" onClick={() => setMaskEdit(true)}>{t('clip.paint_removal')}</button>
                {hasCustomMask(clip) && <button type="button" className="btn btn-sm" onClick={() => set({ customMask: null })}>{t('settings.clear')}</button>}
              </div>
            </Section>
          )}

          {sub === 'mask' && (
            <>
              <Section title={t('clip.mask')} onReset={() => set({ mask: { ...DEFAULT_MASK } })}>
                <div className="mask-grid">
                  {[{ id: 'none', name: t('grade.none') }, ...MASK_SHAPES].map((m) => (
                    <button key={m.id} className={`mask-tile ${mask.type === m.id ? 'on' : ''}`} aria-pressed={mask.type === m.id}
                      onClick={() => setM(['circle', 'star', 'heart'].includes(m.id)
                        ? { type: m.id, h: Math.min(2, (mask.w * W) / H) } // square in pixels
                        : { type: m.id })}>
                      <MaskIcon type={m.id} /><span>{m.id === 'none' ? m.name : catalogName('mask_shape', m)}</span>
                    </button>
                  ))}
                </div>
              </Section>
              {mask.type !== 'none' && (
                <Section title={t('clip.mask_settings')}>
                  {mask.type === 'text' && (
                    <label className="field">
                      <span>{t('tts.text')}</span>
                      <input type="text" value={mask.text} onChange={(e) => setM({ text: e.target.value })} />
                    </label>
                  )}
                  <div className="numrow">
                    <span className="numrow-label">{t('clip.position')}</span>
                    <NumBox label="X" value={Number((mask.x * W).toFixed(1))} precision={1} suffix="px" onChange={(v) => setM({ x: v / W })} />
                    <NumBox label="Y" value={Number((mask.y * H).toFixed(1))} precision={1} suffix="px" onChange={(v) => setM({ y: v / H })} />
                  </div>
                  {S({ label: t('clip.rotate'), value: mask.rot, min: -180, max: 180, step: 1, fmt: (v) => `${v}°`, onChange: (rot) => setM({ rot }) })}
                  {mask.type !== 'split' && S({ label: mask.type === 'filmstrip' ? t('clip.band_height') : t('clip.height'), value: mask.h, min: 0.02, max: 2, step: 0.01, fmt: pct, numScale: 100, onChange: (h) => setM({ h }) })}
                  {!['split', 'filmstrip', 'text'].includes(mask.type) && S({ label: t('clip.width'), value: mask.w, min: 0.02, max: 2, step: 0.01, fmt: pct, numScale: 100, onChange: (w) => setM({ w }) })}
                  {mask.type === 'rectangle' && S({ label: t('clip.round_corners'), value: mask.round, min: 0, max: 1, step: 0.01, fmt: pct, numScale: 100, onChange: (round) => setM({ round }) })}
                  {S({ label: t('clip.feather'), value: mask.feather, min: 0, max: 100, step: 1, onChange: (feather) => setM({ feather }) })}
                  <label className="field row">
                    <span>{t('clip.invert')}</span>
                    <input type="checkbox" checked={mask.invert} onChange={(e) => setM({ invert: e.target.checked })} />
                  </label>
                </Section>
              )}
              {mask.type !== 'none' && (
                <Section title={t('clip.outline_and_glow')} onReset={() => setM({ stroke: 0, strokeColor: DEFAULT_MASK.strokeColor, glow: 0, glowColor: DEFAULT_MASK.glowColor, glowStrength: DEFAULT_MASK.glowStrength })}>
                  <div className="numrow">
                    <span className="numrow-label">{t('clip.stroke')}</span>
                    <input type="color" value={mask.strokeColor} aria-label={t('clip.stroke_color')} onChange={(e) => setM({ strokeColor: e.target.value, stroke: mask.stroke || 6 })} />
                    <span className="chips">
                      {['#ffffff', '#000000', '#ec4899', '#facc15', '#22d3ee'].map((c) => (
                        <button key={c} className="chip-color" style={{ background: c }} aria-label={t('clip.stroke_swatch', { color: c })} onClick={() => setM({ strokeColor: c, stroke: mask.stroke || 6 })} />
                      ))}
                    </span>
                  </div>
                  {S({ label: t('clip.stroke_width'), value: mask.stroke, min: 0, max: 40, step: 1, fmt: (v) => (v ? `${v}px` : t('clip.off')), onChange: (stroke) => setM({ stroke }) })}
                  <div className="numrow">
                    <span className="numrow-label">{t('clip.glow')}</span>
                    <input type="color" value={mask.glowColor} aria-label={t('clip.glow_color')} onChange={(e) => setM({ glowColor: e.target.value, glow: mask.glow || 20 })} />
                    <span className="chips">
                      {['#ec4899', '#a855f7', '#22d3ee', '#22c55e', '#facc15', '#ffffff'].map((c) => (
                        <button key={c} className="chip-color" style={{ background: c }} aria-label={t('clip.glow_swatch', { color: c })} onClick={() => setM({ glowColor: c, glow: mask.glow || 20 })} />
                      ))}
                    </span>
                  </div>
                  {S({ label: t('clip.glow_size'), value: mask.glow, min: 0, max: 80, step: 1, fmt: (v) => (v ? `${v}px` : t('clip.off')), onChange: (glow) => setM({ glow }) })}
                  {mask.glow > 0 && S({ label: t('clip.glow_strength'), value: mask.glowStrength, min: 5, max: 100, step: 1, fmt: (v) => `${v}%`, onChange: (glowStrength) => setM({ glowStrength }) })}
                </Section>
              )}
            </>
          )}
        </>
      )}

      {tab === 'animation' && <AnimationPanel clip={clip} len={len} set={set} dispatch={dispatch} />}

      {tab === 'audio' && (
        <>
          <Section title={t('clip.basic')}>
            {S({ label: t('clip.volume'), value: clip.volume ?? 1, max: 2, fmt: pct, numScale: 100, onChange: (volume) => set({ volume }) })}
            {clip.volumeKeys?.length > 0 && <div className="afx-note">{tn('inspector.volume_automation_points', clip.volumeKeys.length)} <button className="btn btn-sm btn-ghost" onClick={() => set({ volumeKeys: undefined })}>{t('clip.clear_automation')}</button></div>}
            <AudioFxControls fx={clip.audioFx} onChange={(audioFx) => set({ audioFx })} />
            <label className="field row">
              <span>{t('clip.mute')}</span>
              <input type="checkbox" checked={!!clip.muted} onChange={(e) => set({ muted: e.target.checked })} />
            </label>
          </Section>
          <Section title={t('enhance.enhance_voice')}>
            <EnhanceVoice clip={clip} media={media} set={set} onEnhance={onEnhance} />
          </Section>
        </>
      )}

      {tab === 'speed' && (
        <Section title={t('clip.standard')}>
          <label className="field">
            <span>{t('tts.speed')} <b>{clip.speed || 1}×</b></span>
            <div className="chips">
              {SPEEDS.map((s) => (
                <button key={s} className={`chip ${(clip.speed || 1) === s ? 'on' : ''}`} onClick={() => set({ speed: s })}>{s}×</button>
              ))}
            </div>
          </label>
          <div className="numrow">
            <span className="numrow-label">{t('clip.source')}</span>
            <NumBox label={t('clip.in')} step={0.1} value={clip.in} onChange={(v) => set({ in: Math.max(0, Math.min(v, clip.out - 0.1)) })} />
            <NumBox label={t('clip.out')} step={0.1} value={clip.out} onChange={(v) => set({ out: Math.max(clip.in + 0.1, Math.min(v, media?.duration ?? v)) })} />
          </div>
        </Section>
      )}

      {maskEdit && media && (
        <CustomMaskEditor clip={clip} media={media}
          onClose={() => setMaskEdit(false)}
          onSave={(strokes) => { set({ customMask: strokes.length ? { strokes } : null }); setMaskEdit(false); }} />
      )}
      {tab === 'adjust' && (
        <>
          {track === 'overlay' && (
            <Section title={t('clip.timeline')}>
              <div className="numrow">
                <span className="numrow-label">{t('home.start')}</span>
                <NumBox label="" step={0.1} suffix="s" value={clip.start} onChange={(v) => set({ start: Math.max(0, v) })} />
              </div>
            </Section>
          )}
          {!isVideo && (
            <Section title={t('clip.photo')}>
              <div className="numrow">
                <span className="numrow-label">{t('animation-panel.duration')}</span>
                <NumBox label="" step={0.1} suffix="s" value={clip.out} onChange={(v) => set({ in: 0, out: Math.max(0.1, v) })} />
              </div>
            </Section>
          )}
          <Section title={t('clip.filter')} onReset={() => set({ filter: 'none' })}>
            <select value={clip.filter || 'none'} aria-label={t('clip.filter')} onChange={(e) => set({ filter: e.target.value })}>
              {FILTERS.map((f) => <option key={f.id} value={f.id}>{catalogName('filter', f)}</option>)}
            </select>
          </Section>
          <Section title={t('clip.basic')}>
            <GradePanel grade={clip.grade} adjust={clip.adjust} dispatch={dispatch} autoFrom={media ? { media, clip } : undefined}
              onGrade={(grade) => set({ grade })} onAdjust={(adjust) => set({ adjust })} onReset={resetLook || undefined}
              onApplyAll={() => dispatch({ type: 'updateMany', updates: [
                ...project.videoClips.filter((c) => !c.gap).map((c) => ({ track: 'video', id: c.id, patch: { grade: { ...(clip.grade || {}) }, adjust: { ...(clip.adjust || {}) } } })),
                ...(project.overlayClips || []).map((c) => ({ track: 'overlay', id: c.id, patch: { grade: { ...(clip.grade || {}) }, adjust: { ...(clip.adjust || {}) } } })),
              ] })} />
          </Section>
          {track === 'video' && (
            <Section title={t('clip.transition_in')}>
              <select value={clip.transition?.type || 'none'} aria-label={t('clip.transition_in')}
                onChange={(e) => set({ transition: e.target.value === 'none' ? null : { type: e.target.value, duration: clip.transition?.duration || 0.5, ...(/zoom/i.test(e.target.value) ? { ease: 'smooth' } : {}) } })}>
                {[{ id: 'none', name: t('grade.none') }, ...TRANSITIONS].map((o) => <option key={o.id} value={o.id}>{o.id === 'none' ? o.name : catalogName('transition', o)}</option>)}
              </select>
              {clip.transition && S({
                label: t('animation-panel.duration'), value: clip.transition.duration, min: 0.2, max: 2, step: 0.1, fmt: (v) => `${v.toFixed(1)}s`,
                onChange: (d) => set({ transition: { ...clip.transition, timelineOverlap: undefined, duration: d } }),
              })}
              {clip.transition && directionGroupFor(clip.transition.type) && (() => {
                const { group, dir } = directionGroupFor(clip.transition.type);
                const arrows = { left: '←', right: '→', up: '↑', down: '↓' };
                const dirs = { left: t('clip.dir_left'), right: t('clip.dir_right'), up: t('clip.dir_up'), down: t('clip.dir_down') };
                return (
                  <div className="dir-seg" role="group" aria-label={t('clip.name_direction', { name: catalogLabel('direction_group', group.name) })}>
                    {['left', 'right', 'up', 'down'].map((d) => (
                      <button key={d} className={`btn btn-sm ${d === dir ? 'btn-primary' : ''}`} aria-pressed={d === dir}
                        title={t('clip.transition_direction_title', { name: catalogLabel('direction_group', group.name), direction: dirs[d] })} onClick={() => set({ transition: { ...clip.transition, type: group.ids[d] } })}>{arrows[d]} {dirs[d]}</button>
                    ))}
                  </div>
                );
              })()}
            </Section>
          )}
          {!!clip.effects?.length && <div className="dim">{t('clip.effects_list', { list: clip.effects.join(', ') })}</div>}
        </>
      )}
    </div>
  );
}
