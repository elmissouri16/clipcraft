import { withShortcut } from '../../../app/keymap.js';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeftRight, ArrowLeftToLine, ArrowRightToLine, AudioLines, Copy, CopyPlus, Eye, EyeOff, Film, Flag, GripVertical, Layers, Link2, Lock, LockOpen, Magnet, Mic, MoreHorizontal, MousePointer2, Music, Pencil, Plus, Scissors, Slice,
  Sparkles, Square, StretchHorizontal, Target, Trash2, Type, Undo2, Unlink, Volume2, VolumeX, Redo2, X, ZoomIn, ZoomOut, Captions, ScanLine, MessageSquarePlus, ChevronRight, Loader2,
} from 'lucide-react';
import { LAYERED, MIN_CLIP, clipLayer, effectObjects, findClipIn, findLinkPartner, formatTime, freeLen, isLayerLocked, layerCount, layerFree, layerName, layerOf, layerStateOf, toFileUrl, trimActions, uid, videoClipAt, videoLayout } from "../../../state/store.js";
import { animById, animOf, keyTimes, moveKeys } from '../anim.js';
import { filterName } from "../../effects/filters.js";
import { TRANSITIONS, effectInfo } from "../../effects/effects.js";
import { clipCss } from "../../effects/effects.js";
import { activeDrag, isFiles, isInternal, laneFor, readPayload } from '../dnd.js';
import { followScrollTarget, interpolateTime, playheadX } from "../../preview/playbackClock.js";
import AudioMeter from "../../audio/components/AudioMeter.jsx";
import ContextMenu from "../../../components/ui/ContextMenu.jsx";
import { useClockTime } from '../../preview/useClockTime.js';
import { timelineViewport, intersectsViewport, filmstripTiles, timelineClipBox, boxesIntersect } from '../viewport.js';
import { stackRows, visibleRowRange } from '../rows.js';
import { t, tn } from '../../../i18n/index.js';
import { catalogName, effectLabel, filterLabel } from '../../../i18n/catalog.js';

// Agent spotlight and trail on the timeline (App's agentFocus, docs/agents/agent-editing.md): the clips
// and ranges the running tool works on (live) and the clips this request changed (done), as Maps/Sets the
// Clip component checks by 'track:id'. One shared empty object when the agent is idle. agent names who
// is editing: CraftAI, or an outside MCP agent by its client name.
const NO_MARKS = { any: false, live: new Map(), done: new Set(), liveRanges: [], doneRanges: [], liveCaptions: false, doneCaptions: false, liveTitle: '', liveFirstKey: null, agent: 'CraftAI' };
function buildAgentMarks(focus) {
  if (!focus) return NO_MARKS;
  const live = new Map(), done = new Set(), liveRanges = [], doneRanges = [];
  const liveTitle = focus.live?.title || '';
  let liveFirstKey = null;
  for (const ref of focus.live?.targets?.clips || []) { const key = `${ref.track}:${ref.id}`; if (!live.has(key)) { live.set(key, liveTitle); liveFirstKey ??= key; } }
  for (const r of focus.live?.targets?.ranges || []) liveRanges.push(r);
  for (const step of focus.trail || []) {
    for (const ref of [...(step.targets?.clips || []), ...(step.targets?.created || [])]) { const key = `${ref.track}:${ref.id}`; if (!live.has(key)) done.add(key); }
    for (const r of step.targets?.ranges || []) doneRanges.push(r);
  }
  return { any: true, live, done, liveRanges, doneRanges: doneRanges.slice(-24), liveCaptions: !!focus.live?.targets?.captions,
    doneCaptions: (focus.trail || []).some((step) => step.targets?.captions), liveTitle, liveFirstKey, agent: focus.agent || 'CraftAI' };
}

const HEADER = 192; // lane-head width: title + layer rows share one control grid (lock/eye/speaker/solo/more) and names get 60px
const HEAD_TITLE_H = 22; // height of a lane head's title strip; layer control rows stack below it
const ROW = 34; // height of one stacked row on the Effects / Text tracks
const ROW_H = { overlay: 44, audio: 40 }; // taller layers for pictures and waveforms
const rowOf = (lane) => ROW_H[lane] || ROW;
// Overlay and text layers are shown above the main track, so their layer 0 is the bottom row; audio
// layers are below it, layer 0 on top.
const ABOVE = { overlay: true, text: true };
const rowToLayer = (lane, row, count) => (ABOVE[lane] ? count - 1 - row : row);

// Overlapping clips on a free track get their own row (first row that is free at the clip's start).
const LANES = [
  { id: 'effect', name: t('library.effects'), icon: Sparkles, noMagnet: true },
  { id: 'text', name: t('tts.text'), icon: Type },
  { id: 'overlay', name: t('timeline.overlay'), icon: Layers },
  { id: 'video', name: t('timeline.main'), icon: Film, main: true },
  { id: 'audio', name: t('edit-plan-card.audio'), icon: Music },
];

export default function Timeline({
  project, time: pausedTime, duration, selection, onSelect, onSeek, dispatch, onSplit, onDelete, onDuplicate,
  onDropItem, onDropFiles, canUndo, canRedo, tool, setTool, onTrimSide, onMarker, recorder, onToggleRecord, onClipMenu, overlay, onAddText, clockRef, playing,
  onDetach, detachOk, onLinkToggle, linkMode, onAttachContext, contextVersion,
  agentRun, agentOwnsEdit, agentHasChanges, onShowAgent, agentFocus,
}) {
  // No clock subscription here: a 10 Hz sample would re-render every mounted clip during playback
  // for a readout and three buttons. Those subscribe on their own (ClockReadout and
  // PlayheadEditButtons, below); handlers read the live clock through readTime().
  const time = playing ? (clockRef?.current?.time ?? pausedTime) : pausedTime;
  const readTime = () => clockRef?.current.time ?? time;
  const [pps, setPps] = useState(60); // pixels per second (zoom)
  const [drop, setDrop] = useState(null); // { lane, time, index, clipId }
  const [snapAt, setSnapAt] = useState(null); // timeline time of the active snap guide
  const [trimHud, setTrimHud] = useState(null); // { x, text } readout chip while an edge is dragged
  const [dragging, setDragging] = useState(null);
  const playheadRef = useRef(null);
  const projectRef = useRef(project);
  projectRef.current = project;
  const timeRef = useRef(time);
  timeRef.current = time;
  const ppsRef = useRef(pps);
  ppsRef.current = pps;
  const [razorAt, setRazorAt] = useState(null); // where the razor would cut (hover guide)
  const [layerMenu, setLayerMenu] = useState(null); // { x, y, track, layer } — layer (track) header menu, item 13
  const [folded, setFolded] = useState({});
  useEffect(() => { setFolded({}); }, [project.id, contextVersion]);
  useEffect(() => {
    const selectedTracks = new Set((selection?.items || (selection ? [selection] : [])).map(s => s.track));
    setFolded(current => Object.keys(current).some(track => current[track] && selectedTracks.has(track))
      ? Object.fromEntries(Object.entries(current).map(([track, value]) => [track, selectedTracks.has(track) ? false : value])) : current);
  }, [selection]);
  const unfold = track => setFolded(current => current[track] ? { ...current, [track]: false } : current);
  const [contextRange, setContextRange] = useState(null);
  const [rangeTool, setRangeTool] = useState(false);
  const [rangeMenu, setRangeMenu] = useState(null);
  const rangeDragCleanup = useRef(null);
  useEffect(() => {
    setContextRange(null);setRangeMenu(null);setRangeTool(false);
    return () => rangeDragCleanup.current?.();
  }, [project.id, contextVersion]);
  useEffect(() => {
    const key = e => {
      if (e.key !== 'Escape') return;
      rangeDragCleanup.current?.();setContextRange(null);setRangeMenu(null);setRangeTool(false);
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);
  const [renaming, setRenaming] = useState(null); // { track, layer, draft } — inline layer rename
  // Right-click on a lane header: the layer under the pointer (header rows share the lane's
  // geometry), or the main track itself for the Main lane.
  const openLayerMenu = (e, lane) => {
    e.preventDefault();
    let layer = 0;
    if (LAYERED[lane]) {
      const count = layerCount(project, lane);
      const rect = e.currentTarget.getBoundingClientRect();
      const row = Math.floor((e.clientY - rect.top - HEAD_TITLE_H) / rowOf(lane));
      layer = rowToLayer(lane, Math.max(0, Math.min(count - 1, row)), count);
    }
    setLayerMenu({ x: e.clientX, y: e.clientY, track: lane, layer });
  };
  // Layer state toggles dispatch setLayerState: applied by the history reducer WITHOUT an
  // undo step (a lock is not a document edit), and undo never reverts them.
  const setLayer = (track, layer, patch) => dispatch({ type: 'setLayerState', track, layer, patch });
  const layerMenuItems = (m) => {
    const st = layerStateOf(project, m.track, m.layer);
    const name = layerName(project, m.track, m.layer);
    const audioCap = m.track === 'audio' || m.track === 'video' || m.track === 'overlay';
    const items = [
      { label: t(st.locked ? 'timeline.menu_unlock_layer' : 'timeline.menu_lock_layer', { name }), icon: st.locked ? LockOpen : Lock,
        onClick: () => setLayer(m.track, m.layer, { locked: !st.locked }) },
      { label: t(st.hidden ? 'timeline.menu_show_layer' : 'timeline.menu_hide_layer', { name }), icon: st.hidden ? Eye : EyeOff,
        onClick: () => setLayer(m.track, m.layer, { hidden: !st.hidden }) },
    ];
    if (audioCap) {
      items.push(
        { label: t(st.muted ? 'timeline.menu_unmute_layer' : 'timeline.menu_mute_layer', { name }), icon: st.muted ? Volume2 : VolumeX,
          onClick: () => setLayer(m.track, m.layer, { muted: !st.muted }) },
        { label: t(st.solo ? 'timeline.menu_solo_off' : 'timeline.menu_solo_layer', { name }), icon: AudioLines,
          onClick: () => setLayer(m.track, m.layer, { solo: !st.solo }) },
      );
    }
    if (m.track === 'effect') return items; // the Effects lane is one row: state toggles only
    const srcCount = m.track === 'video'
      ? project.videoClips.filter((c) => !c.gap).length
      : project[LAYERED[m.track]].filter((c) => layerOf(c) === m.layer).length;
    items.push('sep',
      { label: t('timeline.menu_duplicate_layer', { name }), icon: CopyPlus,
        onClick: () => dispatch({ type: 'duplicateLayer', track: m.track, layer: m.layer, newIds: Array.from({ length: srcCount }, () => uid()) }) },
      { label: t('timeline.rename_layer'), icon: Pencil,
        onClick: () => setRenaming({ track: m.track, layer: m.layer, draft: layerName(project, m.track, m.layer) }) },
      'sep',
      { label: t('timeline.delete_layer'), icon: Trash2, disabled: st.locked, hint: t('timeline.unlock_the_layer_first'),
        onClick: () => dispatch({ type: 'deleteLayer', track: m.track, layer: m.layer }) });
    return items;
  };
  // ---- Reorder layers by dragging a header row (Stage C) ----
  const [layerDrag, setLayerDrag] = useState(null); // { track, overRow } while a header row is dragged
  const startLayerDrag = (e, lane, layer) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const count = layerCount(project, lane);
    const fromRow = ABOVE[lane] ? count - 1 - layer : layer;
    const stackEl = e.currentTarget.closest('.tl-layer-stack');
    let overRow = fromRow;
    setLayerDrag({ track: lane, overRow });
    const move = (ev) => {
      if (!stackEl) return;
      const r = stackEl.getBoundingClientRect();
      overRow = Math.max(0, Math.min(count - 1, Math.floor((ev.clientY - r.top) / rowOf(lane))));
      setLayerDrag({ track: lane, overRow });
    };
    const up = (ev) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      setLayerDrag(null);
      if (ev?.type !== 'pointercancel' && overRow !== fromRow) dispatch({ type: 'moveLayer', track: lane, from: layer, to: rowToLayer(lane, overRow, count) });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };
  // One header control row per layer (below the lane's title strip): lock, visibility,
  // mute + solo on sound-carrying lanes, and the layer menu — the reference's pattern in
  // our icon language. Rows line up with the layer bands in the lane body.
  const layerCtlRow = (lane, layer, displayRow) => {
    const st = layerStateOf(project, lane, layer);
    const audioCap = lane === 'audio' || lane === 'video' || lane === 'overlay';
    const name = layerName(project, lane, layer);
    const dragHere = layerDrag && layerDrag.track === lane && layerDrag.overRow === displayRow;
    return (
      <div key={layer} className={`tl-layer-row ${st.locked ? 'locked' : ''} ${st.hidden ? 'is-hidden' : ''} ${dragHere ? 'drop-hint' : ''}`}
        style={{ height: rowOf(lane), ...(LAYERED[lane] ? {position:'absolute',top:displayRow*rowOf(lane),width:'100%'} : {}) }}>
        {LAYERED[lane] && layerCount(project, lane) > 1 ? (
          <span className="tl-grip" role="button" aria-label={t('timeline.reorder_layer_name', { name })} title={t('timeline.drag_to_reorder_this_layer')}
            onPointerDown={(e) => startLayerDrag(e, lane, layer)}><GripVertical size={11} /></span>
        ) : (
          <span className="tl-grip-slot" aria-hidden="true" />
        )}
        <span className="tl-layer-name" title={name}>{name}</span>
        <button className={`tl-ctl ${st.locked ? 'on lock' : ''}`} aria-pressed={st.locked}
          aria-label={t(st.locked ? 'timeline.unlock_layer_name' : 'timeline.lock_layer_name', { name })} title={st.locked ? t('timeline.unlock_layer') : t('timeline.lock_layer_clips_cannot_be_edited')}
          onClick={() => setLayer(lane, layer, { locked: !st.locked })}>{st.locked ? <Lock size={12} /> : <LockOpen size={12} />}</button>
        <button className={`tl-ctl ${st.hidden ? 'on hide' : ''}`} aria-pressed={st.hidden}
          aria-label={t(st.hidden ? 'timeline.show_layer_name' : 'timeline.hide_layer_name', { name })} title={st.hidden ? t('timeline.show_layer') : t('timeline.hide_layer_left_out_of_preview_export')}
          onClick={() => setLayer(lane, layer, { hidden: !st.hidden })}>{st.hidden ? <EyeOff size={12} /> : <Eye size={12} />}</button>
        {audioCap ? (
          <button className={`tl-ctl ${st.muted ? 'on mute' : ''}`} aria-pressed={st.muted}
            aria-label={t(st.muted ? 'timeline.unmute_layer_name' : 'timeline.mute_layer_name', { name })} title={st.muted ? t('timeline.unmute_layer') : t('timeline.mute_layer')}
            onClick={() => setLayer(lane, layer, { muted: !st.muted })}>{st.muted ? <VolumeX size={12} /> : <Volume2 size={12} />}</button>
        ) : (
          <span className="tl-ctl-slot" aria-hidden="true" />
        )}
        {audioCap ? (
          <button className={`tl-ctl solo ${st.solo ? 'on' : ''}`} aria-pressed={st.solo}
            aria-label={t('timeline.solo_layer_name', { name })} title={st.solo ? t('timeline.solo_off_every_layer_sounds_again') : t('timeline.solo_only_soloed_layers_sound')}
            onClick={() => setLayer(lane, layer, { solo: !st.solo })}>S</button>
        ) : (
          <span className="tl-ctl-slot" aria-hidden="true" />
        )}
        <button className="tl-ctl" aria-label={t('timeline.layer_menu_for_name', { name })} title={t('timeline.layer_menu')}
          onClick={(e) => setLayerMenu({ x: e.clientX, y: e.clientY, track: lane, layer })}><MoreHorizontal size={12} /></button>
      </div>
    );
  };
  // The layers of a lane in display order (top row first), as control rows for the head.
  const layerCtlRows = (lane) => {
    if (!LAYERED[lane]) return [layerCtlRow(lane, 0, 0)];
    const count = layerCount(project, lane);
    return rowIndices(lane,count).map(row => layerCtlRow(lane,rowToLayer(lane,row,count),row));
  };
  // The inline rename field (a plain render helper, not a component, so the input keeps focus
  // across keystrokes). Enter/blur commits, Esc cancels; an empty name restores the default.
  const layerRenameInput = (track, layer) => (
    <input className="layer-rename" autoFocus value={renaming.draft} aria-label={t('timeline.layer_name')}
      onPointerDown={(e) => e.stopPropagation()}
      onChange={(e) => setRenaming({ ...renaming, draft: e.target.value })}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') { dispatch({ type: 'renameLayer', track, layer, name: renaming.draft }); setRenaming(null); }
        if (e.key === 'Escape') setRenaming(null);
      }}
      onBlur={() => { dispatch({ type: 'renameLayer', track, layer, name: renaming.draft }); setRenaming(null); }} />
  );
  const markers = project.markers || [];
  const magnet = project.magnet || {};
  const scrollRef = useRef(null);
  const [view, setView] = useState({ left:0,width:1000,top:0,height:300,lanes:{} });
  const measureView = useRef(() => {}), observeRows = useRef(() => {});
  useEffect(() => {
    const el = scrollRef.current;if (!el) return;
    let raf;
    const measure = () => {
      const left=Math.floor(el.scrollLeft/64)*64,top=Math.floor(el.scrollTop/32)*32,width=el.clientWidth,height=el.clientHeight;
      const outer=el.getBoundingClientRect(),lanes={};
      el.querySelectorAll('.tl-lane[data-lane]').forEach(lane=>{lanes[lane.dataset.lane]=Math.round(lane.getBoundingClientRect().top-outer.top+el.scrollTop);});
      const signature=JSON.stringify([left,top,width,height,lanes]);
      setView(old=>old.signature===signature?old:{left,top,width,height,lanes,signature});
    };
    const schedule = () => { cancelAnimationFrame(raf);raf = requestAnimationFrame(measure); };
    const observer = new ResizeObserver(measure), observed=new Set();observer.observe(el);
    const rows=()=>{
      const current=new Set(el.querySelectorAll('.tl-row'));
      for(const row of observed)if(!current.has(row)){observer.unobserve(row);observed.delete(row);}
      for(const row of current)if(!observed.has(row)){observer.observe(row);observed.add(row);}
      measure();
    };
    measureView.current=measure;observeRows.current=rows;
    el.addEventListener('scroll', schedule, { passive: true });rows();
    return () => { cancelAnimationFrame(raf);observer.disconnect();el.removeEventListener('scroll', schedule);measureView.current=observeRows.current=()=>{}; };
  }, []);
  const viewport = useMemo(() => timelineViewport(view.left, view.width, pps, HEADER), [view, pps]);
  const visible = (id, start, length) => dragging === id || intersectsViewport(start, length, viewport);
  const mediaById = useMemo(() => Object.fromEntries(project.media.map((m) => [m.id, m])), [project.media]);
  const layout = useMemo(() => videoLayout(project.videoClips), [project.videoClips]);
  // Room after the last clip is a fixed width in pixels, so zooming out to fit does not leave a huge empty tail.
  const width = Math.max(duration * pps + 600, 900);
  const overlays = project.overlayClips || [];
  const empty = !project.videoClips.length && !overlays.length && !project.audioClips.length && !project.textClips.length;

  const timeFromEvent = (e) => {
    const rect = scrollRef.current.getBoundingClientRect();
    return Math.max(0, (e.clientX - rect.left - HEADER + scrollRef.current.scrollLeft) / pps);
  };

  // Layer at a height on a layered lane; one past the last (a new layer) just outside its rows.
  const layerAtY = (lane, laneEl, y) => {
    if (folded[lane]) return 0;
    const count = layerCount(project, lane);
    const row = Math.floor((y - laneEl.getBoundingClientRect().top - 4 - HEAD_TITLE_H) / rowOf(lane));
    if (ABOVE[lane] ? row < 0 : row >= count) return count;
    return rowToLayer(lane, Math.max(0, Math.min(count - 1, row)), count);
  };

  // ---- Drop from the asset panels / Explorer ----
  const dropInfo = (e) => {
    const t = timeFromEvent(e);
    const laneEl = e.target.closest?.('[data-lane]');
    const overLane = laneEl?.dataset.lane;
    const lane = isFiles(e) && !isInternal(e) ? 'files' : laneFor(activeDrag());
    if (!lane) return null;
    // The layer under the pointer, for what lands on that lane's own kind of clips.
    const at = LAYERED[overLane] ? { layerLane: overLane, layer: layerAtY(overLane, laneEl, e.clientY) } : {};
    // Videos and photos dropped on the Overlay lane become picture-in-picture clips.
    if ((lane === 'video' || lane === 'files') && overLane === 'overlay') return { lane: 'overlay', time: t, ...at };
    const info = { lane, time: t, ...at };
    if (lane === 'video' || lane === 'files') {
      info.index = layout.filter((l) => (l.start + l.end) / 2 < t).length;
      info.at = info.index < layout.length ? layout[info.index].start : layout.length ? layout[layout.length - 1].end : 0;
    }
    if (lane === 'clip') {
      // An effect dropped on the Effects lane becomes a free effect there.
      // An effect or a filter tile dropped on the Effects lane becomes a layer there (a filter layer acts on every picture under it).
      if (['effect', 'filter'].includes(activeDrag()?.kind) && overLane === 'effect') return { lane: 'effect', time: t };
      if (overLane !== 'video') return { lane, time: t };
      const hit = layout.filter((l) => t >= l.start && t < l.end).pop();
      if (hit) info.clipId = hit.clip.id;
    }
    return info;
  };

  const onDragOver = (e) => {
    if (!isInternal(e) && !isFiles(e)) return;
    e.preventDefault();
    e.stopPropagation();
    const info = dropInfo(e);
    e.dataTransfer.dropEffect = info && (info.lane !== 'clip' || info.clipId) ? 'copy' : 'none';
    setDrop(info);
  };

  const onDrop = (e) => {
    const info = dropInfo(e);
    setDrop(null);
    if (!info) return;
    e.preventDefault();
    e.stopPropagation();
    const lane = e.target.closest?.('[data-lane]')?.dataset.lane;
    if (lane) unfold(lane);
    if (info.lane === 'files') onDropFiles([...e.dataTransfer.files], info);
    else onDropItem(readPayload(e), info);
  };

  // ---- Pointer editing ----
  // Generic pointer drag: calls onMove(deltaSeconds, event) until release, wrapped in one undo step.
  // A press is not an edit: the gesture (and its undo step) only begins once the pointer has
  // travelled a few pixels, so a click with a little jitter never nudges or trims the clip.
  const DRAG_THRESHOLD = 3;
  const drag = (e, onMove, onEnd) => {
    e.stopPropagation();
    e.preventDefault();
    setDragging(e.currentTarget.closest('.clip')?.dataset.selId || null);
    const x0 = e.clientX, y0 = e.clientY;
    let started = false;
    const move = (ev) => {
      if (!started) {
        if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < DRAG_THRESHOLD) return;
        started = true;
        dispatch({ type: 'beginGesture' });
      }
      onMove((ev.clientX - x0) / pps, ev);
    };
    const up = (ev) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      setDragging(null);
      if (!started) return;
      onEnd?.(ev); // inside the gesture, so a move to another track is part of the same undo step
      dispatch({ type: 'endGesture' });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };

  // Drag a keyframe diamond along its clip (all the properties keyed at that moment move together).
  // Lands on whole frames and snaps to the playhead; a click without moving puts the playhead on it.
  const startKeyDrag = (e, track, clip, t, length, start) => {
    if (e.button !== 0) return;
    if (trackLocked(track, clip)) return;
    const fps = project.fps || 30;
    let moved = false;
    drag(e, (d) => {
      if (!moved && Math.abs(d * pps) < 3) return;
      moved = true;
      let to = clamp(Math.round((t + d) * fps) / fps, 0, length);
      const now = readTime();
      if (project.snapping && Math.abs((start + to - now) * pps) < 6) to = clamp(now - start, 0, length);
      setSnapAt(Math.abs(start + to - now) < 1e-6 ? now : null);
      dispatch({ type: 'update', track, id: clip.id, patch: moveKeys(clip, t, to, fps) });
    }, () => {
      setSnapAt(null);
      if (!moved) onSeek(start + t);
    });
  };

  // Snapping: pull a dragged clip's start or end (or a razor cut) to a nearby edge: other clips, markers, the playhead, zero.
  // `exclude` names the dragged clip (and its linked partner, which moves with it): their own
  // edges, read from the project as it was at pointer-down, are never snap targets.
  // `playhead: false` leaves the playhead out while a trim is dragging it along.
  const excludedIds = (exclude) => {
    const ids = new Set([].concat(exclude ?? []));
    for (const id of [...ids]) {
      const partner = findLinkPartner(project, ['video', 'overlay', 'audio'].map((tr) => findClipIn(project, tr, id)).find(Boolean));
      if (partner) ids.add(partner.clip.id);
    }
    return ids;
  };
  const edgeTimes = (exclude, { playhead = true } = {}) => {
    const skip = excludedIds(exclude);
    const edges = [0, ...(playhead ? [readTime()] : []), ...markers.map((m) => m.time)];
    layout.forEach((l) => !skip.has(l.clip.id) && edges.push(l.start, l.end));
    project.audioClips.forEach((c) => !skip.has(c.id) && edges.push(c.start, c.start + freeLen('audio', c)));
    project.textClips.forEach((c) => !skip.has(c.id) && edges.push(c.start, c.start + c.duration));
    (project.effectClips || []).forEach((c) => !skip.has(c.id) && edges.push(c.start, c.start + c.duration));
    overlays.forEach((c) => !skip.has(c.id) && edges.push(c.start, c.start + freeLen('overlay', c)));
    return edges;
  };
  const snapMove = (start, len, excludeId) => {
    const thr = 10 / pps;
    let best = null;
    for (const e of edgeTimes(excludeId)) {
      for (const pos of [start, start + len]) {
        const dd = e - pos;
        if (Math.abs(dd) < thr && (!best || Math.abs(dd) < Math.abs(best.dd))) best = { dd, at: e };
      }
    }
    return best ? { start: Math.max(0, start + best.dd), at: best.at } : { start, at: null };
  };
  const snapPoint = (t, exclude = null, opts) => {
    const thr = 10 / pps;
    let best = t, dist = thr;
    for (const e of edgeTimes(exclude, opts)) {
      const dd = Math.abs(e - t);
      if (dd < dist) { best = e; dist = dd; }
    }
    return best;
  };

  // Where a clip starts and how long it is, per track — the same expressions the lanes render with.
  const TRACK_ARRAY = { text: 'textClips', effect: 'effectClips', audio: 'audioClips', overlay: 'overlayClips' };
  const clipSpan = (p, track, id) => {
    if (track === 'video') {
      const l = videoLayout(p.videoClips).find((x) => x.clip.id === id);
      return l ? { start: l.start, len: l.end - l.start } : null;
    }
    const c = (p[TRACK_ARRAY[track]] || []).find((x) => x.id === id);
    if (!c) return null;
    if (track === 'audio') return { start: c.start, len: freeLen('audio', c) };
    if (track === 'overlay') return { start: c.start, len: freeLen('overlay', c) };
    return { start: c.start, len: c.duration };
  };

  const agentMarks = useMemo(() => buildAgentMarks(agentFocus), [agentFocus]);
  // Reveal the spotlight: scroll (never zoom) so the running tool's clips and ranges are in view, unless
  // playback follow-scroll owns the scroller or the user wheeled or pressed in the timeline in the last 2 s
  // (programmatic scrolls — layout, fit, follow — are not the user's and do not count).
  const userScrollAt = useRef(-1e9); // far in the past: a fresh page has no recent user scroll
  const liveSpan = useMemo(() => {
    if (!agentMarks.any || (!agentMarks.live.size && !agentMarks.liveRanges.length)) return null;
    let start = Infinity, end = -Infinity;
    for (const key of agentMarks.live.keys()) {
      const i = key.indexOf(':'), s = clipSpan(project, key.slice(0, i), key.slice(i + 1));
      if (s) { start = Math.min(start, s.start); end = Math.max(end, s.start + s.len); }
    }
    for (const r of agentMarks.liveRanges) { start = Math.min(start, r.start); end = Math.max(end, r.end); }
    return Number.isFinite(start) ? { start, end } : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentMarks, layout, project]);
  useEffect(() => {
    const sc = scrollRef.current, span = liveSpan;
    if (!sc || !span || clockRef?.current?.playing) return;
    if (performance.now() - userScrollAt.current < 2000) return; // the newest live target always wins otherwise
    const width = sc.clientWidth - HEADER, x0 = span.start * pps, x1 = span.end * pps, left = sc.scrollLeft, right = left + width;
    if (x0 >= left + 24 && x1 <= right - 24) return;
    const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    sc.scrollTo({ left: Math.max(0, x0 - width * 0.15), behavior: reduced ? 'auto' : 'smooth' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentFocus?.live?.id]);

  // Trim wrapper: while an edge is dragged, the preview/playhead follows the edge being
  // trimmed and a readout chip shows the edge time + the clip's resulting length; the snap
  // guide lights when the edge lands on a snap target (playhead, neighbour, marker, zero).
  // The drag itself — values, clamping, undo — is exactly the existing handler.
  // The readout is taken on the next frame: a dispatch from a window listener is rendered
  // asynchronously, so reading the project right after it would show the previous move.
  const trimRaf = useRef(0);
  const trimAware = (track, clip, mode, onMove) => (d, ev) => {
    onMove(d, ev);
    cancelAnimationFrame(trimRaf.current);
    trimRaf.current = requestAnimationFrame(() => {
      trimRaf.current = 0;
      const span = clipSpan(projectRef.current, track, clip.id);
      if (!span) return;
      const edgeTime = mode === 'left' ? span.start : span.start + span.len;
      onSeek(edgeTime);
      setTrimHud({ x: playheadX(edgeTime, pps, HEADER), text: t('timeline.time_and_length', { time: formatTime(edgeTime), seconds: span.len.toFixed(2) }) });
      if (projectRef.current.snapping) {
        const targets = edgeTimes(clip.id, { playhead: false }).filter((e) => Math.abs(e - span.start) > 1e-9 && Math.abs(e - (span.start + span.len)) > 1e-9);
        const hit = targets.find((e) => Math.abs(e - edgeTime) * pps < 2);
        setSnapAt(hit ?? null);
      }
    });
  };
  const endTrim = (onEnd) => (ev) => {
    cancelAnimationFrame(trimRaf.current);
    trimRaf.current = 0;
    setTrimHud(null); setSnapAt(null); onEnd?.(ev);
  };

  // Locked layers refuse every pointer edit (the reducer guard is the backstop; the UI
  // never starts a gesture it knows will be refused).
  const trackLocked = (track, clip) => isLayerLocked(project, track, clipLayer(track, clip));

  // Razor tool: a click on a clip cuts it at the pointer.
  const razorSplit = (e, track, clip) => {
    e.stopPropagation();
    e.preventDefault();
    if (trackLocked(track, clip)) return;
    const raw = timeFromEvent(e);
    dispatch({ type: 'split', track, id: clip.id, t: project.snapping ? snapPoint(raw) : raw, newId: uid() });
    onSelect(null);
  };

  // Scrubbing stays inside the project (a free drop or drag may still go past its end).
  const seekTime = (e) => Math.min(Math.max(0, duration), timeFromEvent(e));
  const scrub = (e) => {
    if (e.button !== 0 || e.target.closest?.('.tl-head')) return;
    onSelect(null);
    onSeek(seekTime(e));
    const move = (ev) => onSeek(seekTime(ev));
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };

  const selectContextRange = (e) => {
    if (e.button !== 0) return;
    if (!rangeTool && !e.shiftKey) return scrub(e);
    if (e.target.closest('.tl-head') || !duration) return;
    e.preventDefault();
    rangeDragCleanup.current?.();
    const fps = project.fps || 30;
    const at = ev => Math.min(duration, Math.max(0, Math.round(timeFromEvent(ev) * fps) / fps));
    const anchor = at(e);
    let range = null;
    const move = ev => {
      const edge = at(ev);
      range = Math.abs(edge - anchor) >= 0.5 / fps ? { start_sec: Math.min(anchor, edge), end_sec: Math.max(anchor, edge) } : null;
      setContextRange(range);
    };
    const cleanup = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('blur', cancel);
      rangeDragCleanup.current = null;
    };
    const up = ev => { move(ev);cleanup();setRangeTool(false);if (range) setRangeMenu({ x: ev.clientX, y: ev.clientY }); };
    const cancel = () => { cleanup();setContextRange(null);setRangeTool(false); };
    rangeDragCleanup.current = cleanup;
    setContextRange(null);setRangeMenu(null);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('blur', cancel);
  };
  const openRangeMenu = e => {
    if (e.target.closest('.tl-head')) return;
    e.preventDefault();setRangeMenu({ x: e.clientX, y: e.clientY });
  };
  const attachRange = () => onAttachContext?.({ kind: 'range', ...contextRange });
  const rangeMenuItems = contextRange ? [
    { label: t('timeline.add_selected_range_to_craftai'), icon: MessageSquarePlus, onClick: attachRange },
    { label: t('timeline.clear_selected_range'), icon: X, onClick: () => setContextRange(null) },
  ] : [{ label: t('timeline.select_range_for_craftai'), icon: ScanLine, onClick: () => setRangeTool(true) }];

  // Box selection: drag on an empty part of the tracks to select every clip the box touches (Ctrl / Shift keeps
  // the clips already selected). A plain click still moves the playhead and clears the selection.
  const [box, setBox] = useState(null); // { x, y, w, h } in timeline content pixels
  const contentRef = useRef(null);
  const startBox = (e) => {
    if (e.button !== 0 || tool === 'razor') return scrub(e);
    e.preventDefault();
    const keep = e.ctrlKey || e.shiftKey || e.metaKey;
    const base = keep && selection ? (selection.items || [{ track: selection.track, id: selection.id }]) : [];
    const x0 = e.clientX;
    const y0 = e.clientY;
    let moved = false;
    const rectOf = (ev) => ({ left: Math.min(x0, ev.clientX), right: Math.max(x0, ev.clientX), top: Math.min(y0, ev.clientY), bottom: Math.max(y0, ev.clientY) });
    const move = (ev) => {
      if (!moved && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 4) return;
      moved = true;
      const r = rectOf(ev);
      const c = contentRef.current.getBoundingClientRect();
      setBox({ x: r.left - c.left, y: r.top - c.top, w: r.right - r.left, h: r.bottom - r.top });
      // Select by project geometry, including unmounted clips. Virtualization
      // must not change marquee selection when the viewport scrolls.
      const hit = [], laneRects = {};
      for (const lane of LANES) laneRects[lane.id] = contentRef.current.querySelector(`.tl-lane[data-lane="${lane.id}"]`)?.getBoundingClientRect();
      const add = (track, id, start, length, row) => {
        if (folded[track]) return;
        const lane = laneRects[track];if (!lane) return;
        if (boxesIntersect(timelineClipBox(lane, start, length, pps, row, rowOf(track), HEAD_TITLE_H), r)) hit.push({ track, id });
      };
      layout.forEach(l => add('video', l.clip.id, l.start, l.end - l.start));
      overlays.forEach(c => add('overlay', c.id, c.start, freeLen('overlay', c), stacks.overlay.rows[c.id]));
      project.textClips.forEach(c => add('text', c.id, c.start, c.duration, stacks.text.rows[c.id]));
      project.audioClips.forEach(c => add('audio', c.id, c.start, freeLen('audio', c), stacks.audio.rows[c.id]));
      fxObjects.forEach(o => add('effect', o.key, o.start, o.duration, stacks.effect.rows[o.key]));
      const items = [...base];
      hit.forEach((h) => { if (!items.some((x) => x.track === h.track && x.id === h.id)) items.push(h); });
      onSelect(makeSelection(items));
    };
    const up = (ev) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      setBox(null);
      if (!moved && ev.type !== 'pointercancel') {
        if (!keep) onSelect(null);
        onSeek(seekTime(ev));
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };

  const laneAt = (ev) => document.elementFromPoint(ev.clientX, ev.clientY)?.closest?.('[data-lane]')?.dataset.lane;

  const startVideoDrag = (e, clip, mode) => {
    if (tool === 'razor') return razorSplit(e, 'video', clip);
    if (isLayerLocked(project, 'video', 0)) return;
    onSelect({ track: 'video', id: clip.id });
    if (clip.gap) {
      // Gaps only resize (and cannot be moved). The press still belongs to the gap: letting it
      // reach the lane would clear the selection it just made.
      if (mode === 'move') { e.stopPropagation(); e.preventDefault(); return; }
      drag(e, trimAware('video', clip, mode, (d) => dispatch({ type: 'trimClip', track: 'video', id: clip.id, edge: mode, delta: mode === 'left' ? d : -d })), endTrim());
      return;
    }
    const media = mediaById[clip.mediaId];
    const isImage = media?.type === 'image';
    const mediaEnd = media?.type === 'video' ? media.duration : clip.out;
    const o = { ...clip };
    const sp = clip.speed || 1;
    const grab = timeFromEvent(e) - (layout.find((l) => l.clip.id === clip.id)?.start ?? 0);
    let toOverlay = null; // time where the clip lands when dropped on the Overlay lane
    const videoMove = (d, ev) => {
      if (mode === 'move' && laneAt(ev) === 'overlay') {
        // Dragged up onto the Overlay lane: show where it will land.
        toOverlay = Math.max(0, timeFromEvent(ev) - grab);
        setDrop({ lane: 'overlay', time: toOverlay });
        return;
      }
      if (toOverlay !== null) { toOverlay = null; setDrop(null); }
      if (mode === 'left' || (!magnet.video && mode !== 'move')) {
        // Left edge (either magnet state) and every magnet-off trim go through trimClip:
        // it anchors the edge that is NOT dragged — a left trim keeps the clip's right edge
        // fixed, moves the start and advances the source in-offset by the same delta (the
        // frame under any fixed timeline point does not change), and the removed head
        // becomes a gap before the clip. (This branch used to patch `in` alone for the
        // magnet-on left edge: the start stayed put, the right edge rushed in and the
        // content slipped — the clip collapsed instead of trimming.)
        dispatch({ type: 'trimClip', track: 'video', id: clip.id, edge: mode, delta: mode === 'left' ? d : -d });
      } else if (mode === 'right') {
        dispatch({ type: 'update', track: 'video', id: clip.id, patch: { out: clamp(o.out + d * sp, o.in + MIN_CLIP * sp, isImage ? 3600 : mediaEnd) } });
      } else {
        // Reorder on the magnetic main track: drop index from the pointer position among the other clips.
        const others = videoLayout(project.videoClips.filter((c) => c.id !== clip.id));
        const pos = timeFromEvent(ev);
        const toIndex = others.filter((l) => (l.start + l.end) / 2 < pos).length;
        dispatch({ type: 'moveVideo', id: clip.id, toIndex });
      }
    };
    const videoEnd = () => {
      if (toOverlay === null) return;
      setDrop(null);
      dispatch({ type: 'moveToOverlay', id: clip.id, at: toOverlay });
      onSelect({ track: 'overlay', id: clip.id });
    };
    if (mode === 'move') drag(e, videoMove, videoEnd);
    else drag(e, trimAware('video', clip, mode, videoMove), endTrim(videoEnd));
  };

  const startFreeDrag = (e, track, clip, mode) => {
    if (tool === 'razor') return razorSplit(e, track, clip);
    if (trackLocked(track, clip)) return;
    // Moving one clip of a multiple selection moves every selected clip off the main track by the same time.
    // Members on locked layers stay behind (their updates would be refused anyway).
    const group = mode === 'move' && selection?.items && isSelected(selection, track, clip.id)
      ? selection.items.map((it) => ({ ...it, clip: findFree(it) })).filter((it) => it.clip && !trackLocked(it.track, it.clip)) : null;
    if (group && group.length > 1) {
      const minStart = Math.min(...group.map((g) => g.clip.start));
      drag(e, (d) => {
        const dd = Math.max(-minStart, d);
        // One action for the whole group: the store places layers and syncs links once per move, not once per clip.
        dispatch({ type: 'updateMany', updates: group.map((g) => ({ track: g.track, id: g.id, patch: { start: g.clip.start + dd } })) });
      });
      return;
    }
    onSelect({ track, id: clip.id });
    const o = { ...clip };
    // Audio linked to a main-track clip follows the picture, whose position is its place in the
    // sequence: the sound cannot be moved on its own, and trimming its head is the picture's trim.
    const mainPartner = track === 'audio' && clip.linkId ? findLinkPartner(project, clip) : null;
    if (mainPartner?.track === 'video') {
      if (mode === 'move') { e.stopPropagation(); e.preventDefault(); return; }
      if (mode === 'left') {
        if (trackLocked('video', mainPartner.clip)) return;
        drag(e, trimAware(track, clip, mode, (d) => dispatch({ type: 'trimClip', track: 'video', id: mainPartner.clip.id, edge: 'left', delta: d })), endTrim());
        return;
      }
    }
    let toMain = null; // overlay clip dragged down onto the main track: insert index
    const freeMove = (d, ev) => {
      if (track === 'overlay' && mode === 'move' && laneAt(ev) === 'video') {
        const t = timeFromEvent(ev);
        toMain = layout.filter((l) => (l.start + l.end) / 2 < t).length;
        setDrop({ lane: 'video', time: t, at: toMain < layout.length ? layout[toMain].start : layout.length ? layout[layout.length - 1].end : 0 });
        return;
      }
      if (toMain !== null) { toMain = null; setDrop(null); }
      if (mode === 'move') {
        let start = Math.max(0, o.start + d);
        if (project.snapping) {
          const r = snapMove(start, freeLen(track, o), clip.id);
          setSnapAt(r.at);
          start = r.start;
        }
        const patch = { start };
        // Up or down to another layer of the same lane (or a new one past the last), when the clip fits there.
        const laneEl = LAYERED[track] && scrollRef.current?.querySelector(`[data-lane="${track}"]`);
        if (laneEl) {
          const want = layerAtY(track, laneEl, ev.clientY);
          if (want !== layerOf(o) && !isLayerLocked(project, track, want) && layerFree(project, track, want, start, freeLen(track, o), clip.id)) {
            patch.layer = want;
            o.layer = want;
          }
        }
        dispatch({ type: 'update', track, id: clip.id, patch });
        return;
      }
      if (magnet[track]) {
        // Magnet on: trimming closes up the space (later clips shift with the edit).
        dispatch({ type: 'trimClip', track, id: clip.id, edge: mode, delta: mode === 'left' ? d : -d });
        return;
      }
      if (project.snapping && (track === 'text' || track === 'effect')) {
        // Duration-based clips: pull the dragged edge onto a snap target, like moves do.
        const edge0 = mode === 'left' ? o.start + d : o.start + o.duration + d;
        const snapped = snapPoint(edge0, clip.id, { playhead: false });
        if (snapped !== edge0) { d += snapped - edge0; setSnapAt(snapped); }
      }
      let patch;
      if (track === 'text' || track === 'effect') {
        if (mode === 'left') {
          const start = clamp(o.start + d, 0, o.start + o.duration - MIN_CLIP);
          patch = { start, duration: o.start + o.duration - start };
        } else patch = { duration: Math.max(MIN_CLIP, o.duration + d) };
      } else {
        // Audio and overlay clips: timeline seconds times speed give source seconds; photos have no end.
        const sp = o.speed || 1;
        const m = mediaById[o.mediaId];
        const len = m?.type === 'image' ? Infinity : m?.duration ?? o.out;
        if (mode === 'left') {
          const dd = clamp(d, -Math.min(o.in / sp, o.start), (o.out - o.in) / sp - MIN_CLIP);
          patch = { in: o.in + dd * sp, start: o.start + dd };
        } else patch = { out: clamp(o.out + d * sp, o.in + MIN_CLIP * sp, len) };
      }
      dispatch({ type: 'update', track, id: clip.id, patch });
    };
    const freeEnd = () => {
      setSnapAt(null);
      if (toMain === null) return;
      setDrop(null);
      dispatch({ type: 'moveToMain', id: clip.id, index: toMain });
      onSelect({ track: 'video', id: clip.id });
    };
    if (mode === 'move') drag(e, freeMove, freeEnd);
    else drag(e, trimAware(track, clip, mode, freeMove), endTrim(freeEnd));
  };

  // Zoom keeping one moment of the timeline under the same spot on screen (the mouse for Ctrl + wheel, the
  // playhead for the zoom buttons and slider). The scroll is fixed after the new width is laid out.
  const zoomAnchor = useRef(null);
  const zoomTo = (next, at, x) => {
    const el = scrollRef.current;
    const n = clamp(next, 2, 300);
    if (n === pps) { zoomAnchor.current = null; return; } // nothing to lay out: no anchor may linger for a later Fit
    if (el) {
      const t = at ?? readTime();
      zoomAnchor.current = { t, x: x ?? t * pps - el.scrollLeft };
    }
    setPps(n);
  };
  useLayoutEffect(() => {
    const a = zoomAnchor.current;
    const el = scrollRef.current;
    if (!a || !el) return;
    zoomAnchor.current = null;
    el.scrollLeft = Math.max(0, a.t * pps - a.x);
  }, [pps]);

  // The playhead is painted from the shared playback clock on rAF, straight to the DOM:
  // it glides at display rate (interpolated from the media anchor) even when React renders
  // drop frames, and its x comes from the same playheadX mapping as the ruler and clips.
  // While playing it also keeps itself in view (followScrollTarget never fights a manual
  // scroll that keeps the playhead visible).
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const el = playheadRef.current;
      const sc = scrollRef.current;
      if (!el) return;
      const c = clockRef?.current;
      const t = c?.playing ? interpolateTime(c.time, c.stamp, performance.now(), c.rate || 1) : timeRef.current;
      const x = playheadX(t, ppsRef.current, HEADER);
      el.style.transform = `translateX(${x}px)`;
      // Scrolled past the playhead: it must not show through the sticky lane headers.
      el.style.visibility = sc && x < sc.scrollLeft + HEADER ? 'hidden' : '';
      if (c?.playing && sc) {
        const target = followScrollTarget(x, sc.scrollLeft, sc.clientWidth, HEADER);
        // This loop already runs at display rate. Starting a new smooth-scroll
        // animation each frame makes follow lag and continue moving after Pause.
        if (target !== null && Math.abs(target - sc.scrollLeft) > 2) sc.scrollLeft = target;
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Mouse wheel: Ctrl + wheel (or a touchpad pinch) zooms around the mouse, Shift + wheel scrolls
  // left / right. A plain wheel keeps scrolling the tracks up and down.
  const wheelState = useRef({});
  wheelState.current = { pps, zoomTo };
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return undefined;
    const onWheel = (e) => {
      userScrollAt.current = performance.now();
      const unit = e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? el.clientWidth : 1;
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault(); // also stops the window from zooming
        const { pps: cur, zoomTo: zoom } = wheelState.current;
        const r = el.getBoundingClientRect();
        const x = Math.max(0, e.clientX - r.left - HEADER);
        const t = (x + el.scrollLeft) / cur;
        zoom(cur * Math.exp(-e.deltaY * unit * 0.002), t, x);
      } else if (e.shiftKey) {
        e.preventDefault();
        el.scrollLeft += (Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY) * unit;
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // Zoom so the whole project fits the visible timeline.
  const fit = () => {
    const w = (scrollRef.current?.clientWidth || 900) - HEADER - 32;
    zoomAnchor.current = null;
    setPps(clamp(w / Math.max(duration, 1), 2, 300));
    scrollRef.current?.scrollTo({ left: 0 });
  };

  const visibleMarkers = markers.filter(m=>intersectsViewport(m.time,0,viewport));
  const markerEls = visibleMarkers.map((m) => (
    <button key={m.id} className="marker" style={{ left: m.time * pps }} aria-label={t('timeline.marker_at_time', { time: formatTime(m.time) })}
      title={t(m.label ? 'timeline.marker_title_labeled' : 'timeline.marker_title', { time: formatTime(m.time), label: m.label })}
      onPointerDown={(e) => e.stopPropagation()} onClick={() => onSeek(m.time)}
      onDoubleClick={() => dispatch({ type: 'removeMarker', id: m.id })}>
      <Flag size={11} fill="currentColor" />
    </button>
  ));

  // Ruler ticks: pick a step that keeps labels ~90px apart.
  const step = [0.5, 1, 2, 5, 10, 15, 30, 60].find((s) => s * pps >= 90) || 120;
  const ticks = [];
  for (let t = Math.floor(viewport.from / step) * step; t * pps < width && t <= viewport.to; t += step) ticks.push(t);
  // Labels show what the step needs: tenths below a one-second step, hours past the first.
  const tickLabel = (t) => {
    const h = Math.floor(t / 3600), rest = formatTime(t - h * 3600);
    const mmss = step < 1 ? rest.slice(0, 7) : rest.slice(0, 5);
    return h ? `${h}:${mmss}` : mmss;
  };

  // A selected clip that lives on a free track (everything but the main track), with its current values.
  const findFree = (it) => {
    const key = { overlay: 'overlayClips', text: 'textClips', audio: 'audioClips', effect: 'effectClips' }[it.track];
    return key ? (project[key] || []).find((c) => c.id === it.id) : null;
  };
  const laneClass = (id) => `tl-lane ${drop && (drop.lane === id || (drop.lane === 'files' && id === 'video')) ? 'drop-target' : ''}`;
  // Several clips selected (box selection, Ctrl + click): selection.items lists them all; selection.track / id is
  // the first one, shown in the properties panel.
  const toggleSel = (track, id) => {
    const items = selection ? (selection.items || [{ track: selection.track, id: selection.id }]) : [];
    const has = items.some((x) => x.track === track && x.id === id);
    onSelect(makeSelection(has ? items.filter((x) => !(x.track === track && x.id === id)) : [...items, { track, id }]));
  };
  const common = { pps, selection, onMenu: onClipMenu, onToggle: toggleSel, agentMarks,
    layerStateFor: (track, clip) => layerStateOf(project, track, clipLayer(track, clip)) };
  // The filter of a picture clip as a chip on the clip, removable from the timeline.
  // Badges on a picture clip for what it carries: its filter, then each effect by name (the way a
  // modern editor marks an fx clip), each with × to remove it. An effect badge opens that effect in the
  // inspector (the same object the Effects lane shows as "<name> · on clip").
  const lookTags = (track, clip) => {
    const tags = [];
    if (clip.filter && clip.filter !== 'none') {
      const name = filterLabel(clip.filter, filterName(clip.filter));
      tags.push({ key: 'filter', label: name, title: t('timeline.filter_name', { name }), onRemove: () => dispatch({ type: 'update', track, id: clip.id, patch: { filter: 'none' } }) });
    }
    for (const id of clip.effects || []) {
      const e = effectInfo(id);
      const name = effectLabel(e, id);
      tags.push({ key: `fx:${id}`, kind: 'fx', label: name, icon: e?.icon, title: t('timeline.effect_name_click_to_adjust', { name }),
        onOpen: () => onSelect({ track: 'effect', id: `${track}|${clip.id}|${id}` }),
        onRemove: () => dispatch({ type: 'update', track, id: clip.id, patch: { effects: (clip.effects || []).filter((x) => x !== id) } }) });
    }
    return tags.length ? tags : null;
  };
  // Keyed on the lists it reads, so a chat or caption edit does not rebuild the effect rows (and the layout measure that follows).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const fxObjects = useMemo(() => effectObjects(project), [project.effectClips, project.videoClips, project.overlayClips]);
  // Rows of a layered lane: one per layer, empty ones included.
  const layerRows = (lane, clips) => {
    const count = layerCount(project, lane);
    const rows = {};
    clips.forEach((c) => { rows[c.id] = rowToLayer(lane, layerOf(c), count); });
    return { rows, count, occupied:new Set(clips.map(layerOf)) };
  };
  const stacks = useMemo(() => ({
    effect: stackRows(fxObjects.map((o) => ({ id: o.key, start: o.start, duration: o.duration }))),
    text: layerRows('text', project.textClips),
    overlay: layerRows('overlay', overlays),
    audio: layerRows('audio', project.audioClips),
  }), [fxObjects, project.textClips, overlays, project.audioClips, project.layers]);
  useLayoutEffect(()=>{observeRows.current();},[stacks,folded]);
  const rowWindow = lane => visibleRowRange(view.top,view.height,view.lanes[lane]||0,rowOf(lane),stacks[lane]?.count||1);
  const rowIndices = (lane,count) => {
    const {first,end}=rowWindow(lane),indices=Array.from({length:end-first},(_,i)=>first+i);
    if(renaming?.track===lane)indices.push(rowToLayer(lane,renaming.layer,count));
    if(layerDrag?.track===lane)indices.push(layerDrag.overRow);
    return [...new Set(indices)].filter(row=>row>=0&&row<count).sort((a,b)=>a-b);
  };
  const visibleInRow = (lane,id,start,length,row) => dragging===id || (visible(id,start,length) && row>=rowWindow(lane).first && row<rowWindow(lane).end);
  const rowHeight = (id) => folded[id] ? 32 : (stacks[id] ? Math.max(46, HEAD_TITLE_H + stacks[id].count * rowOf(id) + 8) : undefined);
  const laneCount = id => id === 'effect' ? fxObjects.length : (project[LAYERED[id]] || []).length;
  const foldedSummary = id => {
    const items = tn(id === 'effect' ? 'timeline.n_effects' : 'timeline.n_clips', laneCount(id));
    if (!LAYERED[id]) return t('timeline.folded_summary', { items });
    return t('timeline.folded_summary_layers', { items, layers: tn('timeline.n_layers', layerCount(project, id)) });
  };
  // The layers of a lane as faint bands; an empty one can be removed. Locked bands get the
  // diagonal treatment, hidden ones fade back — the state is readable without the header.
  const layerBands = (lane) => {
    if (!LAYERED[lane]) return null;
    const { count } = stacks[lane];
    const clips = project[LAYERED[lane]];
    return rowIndices(lane,count).map(row => {
      const layer = rowToLayer(lane, row, count);
      const empty = !stacks[lane].occupied.has(layer);
      const st = layerStateOf(project, lane, layer);
      return (
        <div key={`band-${row}`} className={`layer-band ${st.locked ? 'locked' : ''} ${st.hidden ? 'is-hidden' : ''}`} style={{ top: HEAD_TITLE_H + row * rowOf(lane), height: rowOf(lane) - 4 }}>
          {empty && count > 1 && (
            <button className="layer-remove" title={t('timeline.remove_this_empty_layer')} aria-label={t('timeline.remove_this_empty_layer')}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => { e.stopPropagation(); dispatch({ type: 'removeLayer', track: lane, layer }); }}><X size={11} /></button>
          )}
          {renaming && renaming.track === lane && renaming.layer === layer
            ? layerRenameInput(lane, layer)
            : (count > 1 || (project.layerNames && project.layerNames[lane] && project.layerNames[lane][layer])) && (
              <span className="layer-band-name">{layerName(project, lane, layer)}</span>
            )}
        </div>
      );
    });
  };

  const renderLane = (id) => {
    if (id === 'effect') {
      // One bar per effect applied to a clip; it follows the clip. Select it to see it in the panel, Delete removes it.
      return fxObjects.filter(o => visibleInRow('effect',o.key,o.start,o.duration,stacks.effect.rows[o.key])).map((o) => {
        const e = effectInfo(o.fx);
        return (
          <Clip {...common} key={o.key} track={o.free ? 'effect free' : 'effect bound'} selTrack="effect" clip={o.free ? o.clip : { id: o.key }}
            start={o.start} length={o.duration} row={stacks.effect.rows[o.key]}
            icon={<span className="clip-emoji">{e?.icon || '✨'}</span>} label={o.free ? effectLabel(e, o.fx) : t('timeline.name_on_clip', { name: effectLabel(e, o.fx) })}
            onDown={o.free ? (ev, mode) => startFreeDrag(ev, 'effect', o.clip, mode)
              : (ev, mode) => { ev.stopPropagation(); if (mode === 'move') onSelect({ track: 'effect', id: o.key }); }} />
        );
      });
    }
    if (id === 'overlay') {
      return overlays.filter(c => visibleInRow('overlay',c.id,c.start,freeLen('overlay',c),stacks.overlay.rows[c.id])).map((c) => {
        const m = mediaById[c.mediaId];
        const len = freeLen('overlay', c);
        return (
          <Clip {...common} key={c.id} track="overlay" clip={c} start={c.start} length={len} row={stacks.overlay.rows[c.id]} rowH={rowOf('overlay')}
            icon={<Layers size={12} />} label={m?.name ?? '?'} tags={lookTags('overlay', c)} onDown={(e, mode) => startFreeDrag(e, 'overlay', c, mode)}
            onKeyDrag={(e, t) => startKeyDrag(e, 'overlay', c, t, len, c.start)}>
            <Filmstrip m={m} clip={c} width={len * pps} pps={pps} start={c.start} viewport={viewport} />
          </Clip>
        );
      });
    }
    if (id === 'text') {
      return project.textClips.filter(c => visibleInRow('text',c.id,c.start,c.duration,stacks.text.rows[c.id])).map((c) => (
        <Clip {...common} key={c.id} track={c.caption ? 'text caption' : 'text'} selTrack="text" clip={c} start={c.start} length={c.duration} row={stacks.text.rows[c.id]}
          icon={c.caption ? <Captions size={12} /> : <Type size={12} />} label={c.text}
          onDown={(e, mode) => startFreeDrag(e, 'text', c, mode)} />
      ));
    }
    if (id === 'video') {
      return (
        <>
          {layout.filter(l => visible(l.clip.id, l.start, l.end - l.start)).map((l) => {
            if (l.clip.gap) {
              return (
                <Clip {...common} key={l.clip.id} track="video gap" selTrack="video" clip={l.clip} start={l.start} length={l.end - l.start}
                  label={t('inspector.gap')} onDown={(e, mode) => startVideoDrag(e, l.clip, mode)} />
              );
            }
            const m = mediaById[l.clip.mediaId];
            return (
              <Clip {...common} key={l.clip.id} track="video" clip={l.clip} start={l.start} length={l.end - l.start}
                label={videoLabel(l.clip, m)} dropHere={drop?.clipId === l.clip.id} tags={lookTags('video', l.clip)}
                onDown={(e, mode) => startVideoDrag(e, l.clip, mode)}
                onKeyDrag={(e, t) => startKeyDrag(e, 'video', l.clip, t, l.end - l.start, l.start)}>
                <Filmstrip m={m} clip={l.clip} width={(l.end - l.start) * pps} pps={pps} start={l.start} viewport={viewport} />
                {m?.wave && !l.clip.muted && <ClipWave m={m} clip={l.clip} pps={pps} />}
              </Clip>
            );
          })}
          {layout.filter((l) => l.trans > 0 && visible(l.clip.id, l.start, l.trans)).map((l) => {
            const sel = selection?.track === 'transition' && selection.id === l.clip.id;
            const def = TRANSITIONS.find((t) => t.id === l.clip.transition.type);
            const name = def ? catalogName('transition', def) : l.clip.transition.type;
            return (
              <button key={'tr' + l.clip.id} className={`tr-pill ${sel ? 'on' : ''}`}
                style={{ left: l.start * pps, width: Math.max(22, l.trans * pps) }}
                title={t('timeline.transition_title', { name, seconds: l.trans.toFixed(1) })}
                aria-label={t('timeline.transition_name', { name })} aria-pressed={sel}
                onPointerDown={(e) => { e.stopPropagation(); onSelect({ track: 'transition', id: l.clip.id }); }}>
                <ArrowLeftRight size={11} />
                {l.trans * pps >= 74 && <span className="tr-pill-name">{name}</span>}
              </button>
            );
          })}
          {drop && (drop.lane === 'video' || drop.lane === 'files') && (
            <div className="insert-line" style={{ left: drop.at * pps }} />
          )}
        </>
      );
    }
    return project.audioClips.filter(c => visibleInRow('audio',c.id,c.start,freeLen('audio',c),stacks.audio.rows[c.id])).map((c) => {
      const m = mediaById[c.mediaId];
      const bg = m?.wave ? {
        backgroundImage: `url("${toFileUrl(m.wave)}")`, backgroundRepeat: 'no-repeat',
        backgroundSize: `${(m.duration / (c.speed || 1)) * pps}px 70%`, backgroundPosition: `${(-c.in / (c.speed || 1)) * pps}px center`,
      } : null;
      return (
        <Clip {...common} key={c.id} track="audio" clip={c} start={c.start} length={freeLen('audio', c)} bg={bg} row={stacks.audio.rows[c.id]} rowH={rowOf('audio')}
          icon={<Music size={12} />} label={m?.name ?? '?'} onDown={(e, mode) => startFreeDrag(e, 'audio', c, mode)} />
      );
    });
  };

  return (
    <section className={`timeline${agentRun ? ' is-agent-working' : ''}${agentFocus?.fading ? ' agent-fading' : ''}`} aria-label={t('clip.timeline')} aria-description={agentRun ? t('timeline.craftai_is_working_manual_edits_interrupt') : undefined}>
      <div className="tl-main">
      {overlay}
      <div className="tl-toolbar">
        <div className="tool-group">
          <div className="seg-icons" role="group" aria-label={t('timeline.timeline_tool')}>
            <IconBtn label={withShortcut(t('timeline.select'), 'selectTool')} active={tool === 'select'} onClick={() => setTool('select')}><MousePointer2 size={16} /></IconBtn>
            <IconBtn label={withShortcut(t('timeline.razor_click_a_clip_to_cut_it'), 'razorTool')} active={tool === 'razor'} onClick={() => setTool('razor')}><Slice size={16} /></IconBtn>
          </div>
          <div className="tool-cluster" role="group" aria-label={t('timeline.history')}>
            <IconBtn label={withShortcut(t('keymap.undo'), 'undo')} onClick={() => dispatch({ type: 'undo' })} disabled={!canUndo}><Undo2 size={16} /></IconBtn>
            <IconBtn label={withShortcut(t('keymap.redo'), 'redo')} onClick={() => dispatch({ type: 'redo' })} disabled={!canRedo}><Redo2 size={16} /></IconBtn>
          </div>
          <div className="tool-cluster" role="group" aria-label={t('timeline.edit')}>
            <PlayheadEditButtons clockRef={clockRef} pausedTime={pausedTime} playing={playing} project={project} selection={selection} onSplit={onSplit} onTrimSide={onTrimSide} />
            <IconBtn label={withShortcut(t('keymap.duplicate'), 'duplicate')} onClick={onDuplicate} disabled={!selection}><Copy size={16} /></IconBtn>
            <IconBtn label={withShortcut(t('keymap.delete'), 'delete')} onClick={onDelete} disabled={!selection}><Trash2 size={16} /></IconBtn>
          </div>
          {(detachOk || linkMode) && (
            <div className="tool-cluster" role="group" aria-label={t('timeline.clip_sound_and_link')}>
              {detachOk && <IconBtn label={t('timeline.detach_audio_put_the_clips_sound_on_the_au')} onClick={onDetach}><AudioLines size={16} /></IconBtn>}
              {linkMode === 'unlink' && <IconBtn label={t('timeline.unlink_audio_and_video')} onClick={onLinkToggle}><Unlink size={16} /></IconBtn>}
              {linkMode === 'link' && <IconBtn label={t('timeline.link_the_selected_video_and_audio_clips')} onClick={onLinkToggle}><Link2 size={16} /></IconBtn>}
            </div>
          )}
          <div className="tool-cluster" role="group" aria-label={t('timeline.mark')}>
            <IconBtn label={t('timeline.marker_press_again_to_remove', { label: withShortcut(t('keymap.marker_at_playhead'), 'marker') })} onClick={onMarker}><Flag size={16} /></IconBtn>
          </div>
          {onAttachContext && <div className="tool-cluster" role="group" aria-label={t('timeline.timeline_context')}>
            <IconBtn label={t('timeline.select_range_for_craftai_shift_drag_ruler')} active={rangeTool} onClick={() => setRangeTool(v => !v)}><ScanLine size={16} /></IconBtn>
            <IconBtn label={t('timeline.add_selected_range_to_craftai')} disabled={!contextRange} onClick={attachRange}><MessageSquarePlus size={16} /></IconBtn>
          </div>}
        </div>
        <div className="tool-group">
          <div className="tool-cluster" role="group" aria-label={t('timeline.record_and_snap')}>
          {recorder.recording ? (
            <button className="rec-pill" onClick={onToggleRecord} aria-pressed="true"
              title={t('timeline.stop_recording_and_place_the_voice_over_on')}>
              <span className="rec-dot" aria-hidden="true" />
              <Square size={12} fill="currentColor" aria-hidden="true" />
              <span className="rec-stop-label">{t('pilot.stop')}</span>
              <span className="rec-time">{formatTime(recorder.seconds).slice(0, 5)}</span>
              <RecMeter analyserRef={recorder.analyserRef} />
            </button>
          ) : (
            <button className="rec-btn" onClick={onToggleRecord}
              aria-pressed="false" title={t('timeline.record_a_voice_over_from_the_playhead')}>
              <Mic size={15} />
            </button>
          )}
          <IconBtn label={t(project.snapping ? 'timeline.auto_snapping_on' : 'timeline.auto_snapping_off')} active={project.snapping}
            onClick={() => dispatch({ type: 'setProject', patch: { snapping: !project.snapping }, transient: true })}><Target size={16} /></IconBtn>
          </div>
          <ClockReadout clockRef={clockRef} pausedTime={pausedTime} playing={playing} duration={duration} />
          <div className="tool-cluster" role="group" aria-label={t('timeline.view')}>
            <IconBtn label={t('timeline.fit_the_project_in_the_timeline')} onClick={fit}><StretchHorizontal size={16} /></IconBtn>
            <IconBtn label={t('timeline.zoom_out_ctrl_mouse_wheel')} onClick={() => zoomTo(pps / 1.4)}><ZoomOut size={16} /></IconBtn>
            <input className="zoom" type="range" min="2" max="300" value={pps} aria-label={t('timeline.zoom_timeline')}
              title={t('timeline.ctrl_mouse_wheel_zoom_shift_mouse_wheel_sc')} onChange={(e) => zoomTo(Number(e.target.value))} />
            <IconBtn label={t('timeline.zoom_in_ctrl_mouse_wheel')} onClick={() => zoomTo(pps * 1.4)}><ZoomIn size={16} /></IconBtn>
          </div>
        </div>
      </div>
      {agentRun && <div className="tl-agent-status" data-phase={agentRun.stopping ? 'stopping' : !agentOwnsEdit ? 'interrupted' : agentHasChanges ? 'editing' : 'working'}>
        <Loader2 size={13} className="spin" aria-hidden="true" />
        <strong role="status">{t(agentRun.stopping ? 'timeline.agent_stopping' : !agentOwnsEdit ? 'timeline.agent_interrupted' : agentHasChanges ? 'timeline.agent_editing' : 'timeline.agent_working')}</strong>
        <span className="tl-agent-detail">{agentOwnsEdit ? agentRun.label : t('timeline.your_manual_edit_takes_priority')}</span>
        <button type="button" className="pilot-text-btn" onClick={onShowAgent}>{t('timeline.view_chat')}</button>
        <button type="button" className="pilot-text-btn" onClick={agentRun.onStop} disabled={agentRun.stopping}>{t('pilot.stop')}</button>
      </div>}
      <div className={`tl-scroll ${tool === 'razor' ? 'razor' : ''}`} ref={scrollRef}
        onPointerDownCapture={() => { userScrollAt.current = performance.now(); }}
        onPointerMove={(e) => { if (tool === 'razor') { const t = timeFromEvent(e); setRazorAt(project.snapping ? snapPoint(t) : t); } }}
        onPointerLeave={() => setRazorAt(null)}
        onDragOver={onDragOver} onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setDrop(null);
      }} onDrop={onDrop}>
        <div className="tl-content" ref={contentRef} style={{ width: width + HEADER }} onContextMenu={onAttachContext ? openRangeMenu : undefined}>
          {contextRange && <div className="tl-context-range" aria-hidden="true" style={{ left: HEADER + contextRange.start_sec * pps, width: (contextRange.end_sec - contextRange.start_sec) * pps }} />}
          {agentMarks.liveRanges.map((r, i) => <div key={`agent-live-${i}`} className="tl-agent-range" aria-hidden="true" style={{ left: HEADER + r.start * pps, width: Math.max(2, (r.end - r.start) * pps) }} />)}
          {agentMarks.doneRanges.map((r, i) => <div key={`agent-seam-${i}`} className="tl-agent-seam" aria-hidden="true" style={{ left: HEADER + r.start * pps }} />)}
          {box && <div className="select-box" style={{ left: box.x, top: box.y, width: box.w, height: box.h }} />}
          <div className={`tl-row ruler ${rangeTool ? 'context-selecting' : ''}`} onPointerDown={onAttachContext ? selectContextRange : scrub}>
            <div className="tl-head" />
            <div className="tl-ruler">
              {rangeTool && <span className="tl-range-hint">{t('timeline.drag_on_the_ruler_to_attach_a_range')}</span>}
              {contextRange && <div className="tl-context-ruler" aria-label={t('timeline.selected_range_start_to_end', { start: formatTime(contextRange.start_sec), end: formatTime(contextRange.end_sec) })} style={{ left: contextRange.start_sec * pps, width: (contextRange.end_sec - contextRange.start_sec) * pps }} />}
              {agentMarks.liveRanges.map((r, i) => <div key={`agent-ruler-${i}`} className="tl-agent-ruler" aria-label={t('timeline.agent_range_start_to_end', { agent: agentMarks.agent, title: agentMarks.liveTitle, start: formatTime(r.start), end: formatTime(r.end) })} style={{ left: r.start * pps, width: Math.max(18, (r.end - r.start) * pps) }}>{(r.end - r.start) * pps > 80 ? agentMarks.liveTitle : ''}</div>)}
              {markerEls}
              {ticks.map((t) => (
                <div key={t} className="tick" style={{ left: t * pps }}><span>{tickLabel(t)}</span></div>
              ))}
            </div>
          </div>

          {LANES.filter((l) => l.id !== 'effect' || fxObjects.length || ['effect', 'filter'].includes(activeDrag()?.kind)).map((l) => {
            const Icon = l.icon;
            return (
              <div key={l.id} className={`tl-row ${l.main ? 'main' : ''} ${folded[l.id] ? 'is-folded' : ''}`} style={{ height: rowHeight(l.id) }}>
                <div className="tl-head" data-lane={l.id}
                  onContextMenu={(LAYERED[l.id] || l.id === 'video' || l.id === 'effect') ? (e) => folded[l.id] ? e.preventDefault() : openLayerMenu(e, l.id) : undefined}>
                  <div className="tl-title-row">
                    <Icon size={14} aria-hidden="true" className="tl-icon" />
                    <span className="tl-name" title={l.name}>{renaming && renaming.track === l.id && l.id === 'video' ? layerRenameInput(l.id, 0) : l.name}</span>
                    {/* The title row shares the layer rows' control grid: cell 1 = add,
                        cell 2 (the eye column) = magnet, the rest stay empty slots. */}
                    {LAYERED[l.id] ? (l.id === 'text' && onAddText ? (
                      <button className="layer-add" title={t('timeline.add_text_at_the_playhead')} aria-label={t('timeline.add_text_at_the_playhead')}
                        onClick={() => { unfold(l.id);onAddText({ text: 'Add text' }); }}><Plus size={13} /></button>
                    ) : (
                      <button className="layer-add" title={t('timeline.add_a_lane_layer', { lane: l.name.toLowerCase() })} aria-label={t('timeline.add_a_lane_layer', { lane: l.name })}
                        onClick={() => { unfold(l.id);dispatch({ type: 'addLayer', track: l.id }); }}><Plus size={13} /></button>
                    )) : (
                      <span className="tl-ctl-slot" aria-hidden="true" />
                    )}
                    {!l.noMagnet ? <button className={`magnet-btn ${magnet[l.id] ? 'on' : ''}`} aria-pressed={!!magnet[l.id]}
                      aria-label={t(magnet[l.id] ? 'timeline.lane_magnet_on' : 'timeline.lane_magnet_off', { lane: l.name })}
                      title={t(l.id === 'video'
                        ? (magnet[l.id] ? 'timeline.magnet_main_on' : 'timeline.magnet_main_off')
                        : (magnet[l.id] ? 'timeline.magnet_free_on' : 'timeline.magnet_free_off'), { lane: l.name })}
                      onClick={() => dispatch({ type: 'setMagnet', track: l.id, on: !magnet[l.id] })}>
                      <Magnet size={13} />
                    </button> : (
                      <span className="tl-ctl-slot" aria-hidden="true" />
                    )}
                    <span className="tl-ctl-slot" aria-hidden="true" />
                    <span className="tl-ctl-slot" aria-hidden="true" />
                    {!l.main ? <button type="button" className="tl-ctl tl-fold-toggle"
                      aria-label={t(folded[l.id] ? 'timeline.expand_lane_tracks' : 'timeline.collapse_lane_tracks', { lane: l.name })} aria-expanded={!folded[l.id]}
                      title={t(folded[l.id] ? 'timeline.expand_lane_tracks' : 'timeline.collapse_lane_tracks', { lane: l.name })}
                      onClick={() => { setLayerMenu(null);setFolded(current => ({ ...current, [l.id]: !current[l.id] })); }}>
                      <ChevronRight size={13} className={folded[l.id] ? '' : 'expanded'} />
                    </button> : <span className="tl-ctl-slot" aria-hidden="true" />}
                  </div>
                  {!folded[l.id] && <div className="tl-layer-stack">
                    {layerCtlRows(l.id)}
                  </div>}
                </div>
                <div className={laneClass(l.id)} data-lane={l.id} onPointerDown={folded[l.id] ? scrub : startBox}>
                  {folded[l.id] ? <button type="button" className="tl-folded-summary" onPointerDown={e => e.stopPropagation()} onClick={() => unfold(l.id)}
                    aria-label={t('timeline.expand_lane_tracks', { lane: l.name })}>
                    {foldedSummary(l.id)}
                  </button> : <>{layerBands(l.id)}{renderLane(l.id)}</>}
                  {l.main && empty && (
                    <div className="lane-empty"><Film size={16} /> {t('timeline.drag_media_here_to_start_editing')}</div>
                  )}
                </div>
              </div>
            );
          })}

          {visibleMarkers.map((m) => <div key={m.id} className="marker-line" style={{ left: HEADER + m.time * pps }} />)}
          {tool === 'razor' && razorAt != null && razorAt >= viewport.from && <div className="razor-line" style={{ left: HEADER + razorAt * pps }} />}
          {tool === 'razor' && razorAt != null && razorAt >= viewport.from && <div className="razor-time" style={{ left: HEADER + razorAt * pps }}>{formatTime(razorAt)}</div>}
          {snapAt != null && snapAt >= viewport.from && <div className="snap-line" style={{ left: HEADER + snapAt * pps }} />}
          {trimHud && trimHud.x >= HEADER + viewport.from * pps && <div className="trim-hud" style={{ left: trimHud.x }}>{trimHud.text}</div>}
          <div className="playhead" ref={playheadRef} />
          {drop && drop.time != null && drop.lane !== 'clip' && (
            <div className="drop-time" style={{ left: HEADER + (drop.at ?? drop.time) * pps }}>{formatTime(drop.at ?? drop.time)}</div>
          )}
        </div>
      </div>
      </div>
      <AudioMeter active={playing} />
      {layerMenu && <ContextMenu x={layerMenu.x} y={layerMenu.y} items={layerMenuItems(layerMenu)}
        onClose={() => setLayerMenu(null)} label={t('timeline.layer_menu')} />}
      {rangeMenu && <ContextMenu x={rangeMenu.x} y={rangeMenu.y} items={rangeMenuItems}
        onClose={() => setRangeMenu(null)} label={t('timeline.timeline_context_menu')} />}
    </section>
  );
}

function IconBtn({ label, children, active, ...rest }) {
  return <button className={`icon-btn ${active ? 'active' : ''}`} aria-label={label} aria-pressed={active === undefined ? undefined : !!active} title={label} {...rest}>{children}</button>;
}

// Live microphone level for the recording pill: an AnalyserNode tapped off the recorder's
// own stream, read on rAF and painted straight to the fill element (no React state churn).
function RecMeter({ analyserRef }) {
  const fillRef = useRef(null);
  useEffect(() => {
    let raf = 0;
    const data = new Uint8Array(256);
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const an = analyserRef?.current;
      const el = fillRef.current;
      if (!an || !el) return;
      an.getByteTimeDomainData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) { const v = (data[i] - 128) / 128; sum += v * v; }
      const rms = Math.sqrt(sum / data.length);
      el.style.width = `${Math.min(100, Math.round(rms * 280))}%`;
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [analyserRef]);
  return <span className="rec-meter" aria-hidden="true"><span className="rec-meter-fill" ref={fillRef} /></span>;
}

function Clip({ pps, selection, track, selTrack, clip, start, length, label, icon, bg, dropHere, onDown, row, rowH = ROW, children, onMenu, onToggle, tags, onKeyDrag, layerStateFor, agentMarks = NO_MARKS }) {
  const st = selTrack || track;
  const selected = isSelected(selection, st, clip.id);
  // CraftAI: 'live' while a tool works on this clip, 'done' once this request changed it.
  const agentKey = `${st}:${clip.id}`;
  const agent = agentMarks.live.has(agentKey) || (agentMarks.liveCaptions && clip.caption) ? 'live' : agentMarks.done.has(agentKey) || (agentMarks.doneCaptions && clip.caption) ? 'done' : '';
  const lst = layerStateFor ? layerStateFor(st, clip) : null;
  const stacked = row !== undefined ? { top: HEAD_TITLE_H + row * rowH, bottom: 'auto', height: rowH - 4 } : null;
  return (
    <div className={`clip ${track} ${selected ? 'selected' : ''} ${dropHere ? 'drop-here' : ''} ${agent ? `agent-${agent}` : ''} ${clip.disabled ? 'off' : ''} ${clip.slot && !clip.gap ? 'replaceable' : ''} ${lst?.locked ? 'locked' : ''} ${lst?.hidden ? 'layer-hidden' : ''}`}
      style={{ left: start * pps, width: Math.max(6, length * pps), ...stacked }}
      data-sel-track={st} data-sel-id={clip.id} data-agent={agent || undefined}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        // Ctrl / Shift + click adds the clip to the selection (or takes it out).
        if ((e.ctrlKey || e.shiftKey || e.metaKey) && onToggle) { e.stopPropagation(); onToggle(st, clip.id); return; }
        onDown(e, 'move');
      }} title={clip.disabled ? t('timeline.label_deactivated', { label }) : label}
      onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); onMenu?.(e, st, clip); }}>
      {bg && <div className="clip-bg" style={bg} />}
      {children}
      {agent === 'live' && agentKey === agentMarks.liveFirstKey && <span className="agent-chip" aria-hidden="true">{agentMarks.agent} · {agentMarks.liveTitle}</span>}
      {agent === 'done' && <span className="agent-mark" title={t('timeline.changed_by_agent', { agent: agentMarks.agent })} aria-hidden="true">✓</span>}
      <div className="handle left" onPointerDown={(e) => e.button === 0 && onDown(e, 'left')} />
      <span className="clip-label">{clip.slot && !clip.gap && <span className="rep-badge" title={t('timeline.replaceable_people_put_their_own_video_her')}>⇄</span>}{icon}<bdi>{label}</bdi>
      {tags?.length > 0 && (
        <span className="clip-tags">
          {tags.map((tag) => (
            <span key={tag.key} className={`clip-tag ${tag.kind || ''} ${tag.onOpen ? 'clickable' : ''}`} title={tag.title}
              role={tag.onOpen ? 'button' : undefined} tabIndex={tag.onOpen ? 0 : undefined}
              onPointerDown={tag.onOpen ? (e) => e.stopPropagation() : undefined}
              onClick={tag.onOpen ? (e) => { e.stopPropagation(); tag.onOpen(); } : undefined}
              onKeyDown={tag.onOpen ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); tag.onOpen(); } } : undefined}>
              {tag.icon && <span className="clip-tag-icon" aria-hidden="true">{tag.icon}</span>}{tag.label}
              <button type="button" aria-label={t('timeline.remove_name', { name: tag.label })} title={t('timeline.remove_name', { name: tag.label })}
                onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); tag.onRemove(); }}>×</button>
            </span>
          ))}
        </span>
      )}
      </span>
      {(track === 'video' || track === 'overlay') && (clip.anim || clip.keyframes) && <ClipMotion clip={clip} length={length} pps={pps} selected={selected} onKeyDrag={onKeyDrag} />}
      <div className="handle right" onPointerDown={(e) => e.button === 0 && onDown(e, 'right')} />
    </div>
  );
}

// Animations as bands at the clip's start / end (or along it for a Combo), and the keyframes of the selected
// clip as diamonds.
function ClipMotion({ clip, length, pps, selected, onKeyDrag }) {
  const a = animOf(clip, length);
  const times = selected ? keyTimes(clip).filter((t) => t >= -1e-6 && t <= length + 1e-6) : [];
  return (
    <>
      {a.in && <div className="anim-band in" style={{ width: a.in.duration * pps }} title={t('timeline.in_name', { name: catalogName('animation', animById('in', a.in.type)) })} />}
      {a.out && <div className="anim-band out" style={{ width: a.out.duration * pps }} title={t('timeline.out_name', { name: catalogName('animation', animById('out', a.out.type)) })} />}
      {a.combo && <div className="anim-band combo" title={t('timeline.combo_name', { name: catalogName('animation', animById('combo', a.combo.type)) })} />}
      {times.map((time) => (
        <span key={time} className="kf-dot" style={{ left: time * pps }} title={t('timeline.keyframe_drag_to_move_it_click_to_go_to_it')}
          onPointerDown={(e) => { e.stopPropagation(); onKeyDrag?.(e, time); }} />
      ))}
    </>
  );
}

const THUMB_H = 50; // filmstrip height inside a main-track clip
const MAX_TILES = 400;

// Filmstrip: thumbnails at their real aspect ratio, each showing the frame at its
// position on the timeline (follows trim, speed and zoom). Uses the sprite from makeVisuals.
function Filmstrip({ m, clip, width, pps, start, viewport }) {
  if (!m) return null;
  const look = { filter: clipCss(clip) || undefined, transform: clip.effects?.includes('mirror') && !clip.fxRegions?.mirror && !(clip.fxStrength?.mirror != null && clip.fxStrength.mirror < 1) ? 'scaleX(-1)' : undefined };
  if (m.type === 'image') {
    return <div className="filmstrip" style={{ ...look, backgroundImage: `url("${toFileUrl(m.path)}")`, backgroundSize: `auto ${THUMB_H}px`, backgroundRepeat: 'repeat-x' }} />;
  }
  if (!m.thumb || !m.thumbCount) return <div className="filmstrip loading" />;
  const tileW = (THUMB_H * m.thumbW) / m.thumbH;
  const { first, end } = filmstripTiles(width, tileW, start, pps, viewport, MAX_TILES);
  const sp = clip.speed || 1;
  const url = `url("${toFileUrl(m.thumb)}")`;
  const tiles = [];
  for (let k = first; k < end; k++) {
    const x = k * tileW;
    const t = clip.in + ((x + tileW / 2) / pps) * sp;
    const idx = Math.max(0, Math.min(m.thumbCount - 1, Math.floor(t / m.thumbInterval)));
    tiles.push(
      <div key={k} className="tile-frame" style={{
        left: x, width: tileW, backgroundImage: url,
        backgroundSize: `${m.thumbCount * tileW}px ${THUMB_H}px`, backgroundPosition: `${-idx * tileW}px 0`,
      }} />
    );
  }
  return <div className="filmstrip" style={look}>{tiles}</div>;
}

// Audio waveform strip under a video clip (follows trim and speed).
function ClipWave({ m, clip, pps }) {
  const sp = clip.speed || 1;
  return (
    <div className="clip-wave" style={{
      backgroundImage: `url("${toFileUrl(m.wave)}")`, backgroundRepeat: 'no-repeat',
      backgroundSize: `${(m.duration / sp) * pps}px 100%`, backgroundPosition: `${(-clip.in / sp) * pps}px 0`,
    }} />
  );
}

function videoLabel(clip, m) {
  const tags = [];
  if ((clip.speed || 1) !== 1) tags.push(`${clip.speed}×`);
  // Effects are named badges on the clip (lookTags), not a count in the label.
  if (clip.muted) tags.push(t('timeline.muted'));
  return [m?.name ?? '?', ...tags].join(' · ');
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

// Selection helpers: one clip { track, id }, several { track, id, items: [{ track, id }] }.
export function isSelected(selection, track, id) {
  if (!selection) return false;
  if (selection.items) return selection.items.some((x) => x.track === track && x.id === id);
  return selection.track === track && selection.id === id;
}
export function makeSelection(items) {
  if (!items.length) return null;
  if (items.length === 1) return { ...items[0] };
  return { ...items[0], items };
}

// The two toolbar parts that follow the playhead during playback. They subscribe to the clock
// themselves (10 Hz), so the rest of the timeline does not re-render for them.
function ClockReadout({ clockRef, pausedTime, playing, duration }) {
  const time = useClockTime(clockRef, pausedTime, playing);
  return <span className="tl-time"><b>{formatTime(time)}</b> / {formatTime(duration)}</span>;
}
// Availability mirrors App's shortcut handlers exactly — same target resolution (selection first,
// then the main-track clip under the playhead) and the same trimActions builder — so a button is
// enabled only when its shortcut would actually do something.
function PlayheadEditButtons({ clockRef, pausedTime, playing, project, selection, onSplit, onTrimSide }) {
  const time = useClockTime(clockRef, pausedTime, playing);
  const trimTargets = [];
  if (selection) trimTargets.push(selection);
  const underPlayhead = videoClipAt(project, time);
  if (underPlayhead && !(selection && selection.id === underPlayhead.clip.id)) trimTargets.push({ track: 'video', id: underPlayhead.clip.id });
  const canTrim = (side) => trimTargets.some((tgt) => trimActions(project, { track: tgt.track, id: tgt.id, t: time, side, newId: tgt.id }).length > 0);
  const canSplit = !!(selection || underPlayhead);
  return (
    <>
      <IconBtn label={withShortcut(t('keymap.split_at_playhead'), 'split')} onClick={onSplit} disabled={!canSplit}><Scissors size={16} /></IconBtn>
      <IconBtn label={withShortcut(t('keymap.delete_left_of_playhead'), 'trimLeft')} onClick={() => onTrimSide('left')} disabled={!canTrim('left')}><ArrowLeftToLine size={16} /></IconBtn>
      <IconBtn label={withShortcut(t('keymap.delete_right_of_playhead'), 'trimRight')} onClick={() => onTrimSide('right')} disabled={!canTrim('right')}><ArrowRightToLine size={16} /></IconBtn>
    </>
  );
}
