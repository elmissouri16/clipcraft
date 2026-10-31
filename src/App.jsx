import React, { useMemo, useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { recentEntryFor } from './recents.js';
import { canvasFor, emptyProject, freeLen, historyReducer, levelCopyState, markerNear, parseEffectKey, pickAttributes, projectDuration, renderable, setPlaybackQuality, toFileUrl, trimActions, uid, videoClipAt, videoLayout } from './store.js';
import HomeScreen from './components/HomeScreen.jsx';
import SequenceDialog from './components/SequenceDialog.jsx';
import { mismatchFor, sequencePatchFor } from './sequence.js';
import { sizeFor } from './effects.js';
import ContextMenu from './components/ContextMenu.jsx';
import {
  AudioLines, CircleAlert, ClipboardPaste, Copy, CopyPlus, Eraser, Eye, EyeOff, FlipHorizontal2, Layers, LayoutTemplate, Loader2, Paintbrush, PanelBottom, Repeat, Rewind, RotateCcw, RotateCw, Scissors, ScissorsLineDashed, Snowflake, Split, Trash2,
} from 'lucide-react';
import { fillSlot, slotList, templateMeta } from './templates.js';
import SlotStrip from './components/SlotStrip.jsx';
import ConfirmDialog from './components/ConfirmDialog.jsx';
import { useRecorder } from './useRecorder.js';
import { useLayout } from './useLayout.js';
import { decoImages, maskImages } from './visual.js';
import { motionData } from './anim.js';
import { isLookPatch, lookAction, selectedPictures } from './look.js';
import { loadProjectLuts, onLutLoaded } from './fx/lut.js';
import LeftPanel from './components/LeftPanel.jsx';
import Preview from './components/Preview.jsx';
import Timeline from './components/Timeline.jsx';
import Inspector from './components/Inspector.jsx';
import ExportDialog from './components/ExportDialog.jsx';
import { EXPORT_PRESETS, resolveExport, settingsPatch, storedExportSettings } from './exportQuality.js';
import CloseDialog from './components/CloseDialog.jsx';
import TopBar from './components/TopBar.jsx';
import SettingsDialog from './components/SettingsDialog.jsx';
import { AboutDialog, UpdateNotice, useUpdateCheck } from './components/About.jsx';
import ScreenRecordDialog from './components/ScreenRecordDialog.jsx';
import { useScreenRecorder } from './useScreenRecorder.js';
import CraftAI from './components/CraftPilot.jsx';
import { isFiles, isInternal } from './dnd.js';
import { renderTextFrames } from './exportText.js';
import { fxWork, renderFxPass } from './fxExport.js';
import { TEXT_TEMPLATES } from './text/catalog.js';
import { allFonts } from './fonts.js';

// Renders an emoji to a transparent PNG (color emoji come from Chromium's font stack).
function emojiPng(emoji, size = 256) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `${size * 0.8}px "Segoe UI Emoji", "Apple Color Emoji", sans-serif`;
  g.fillText(emoji, size / 2, size / 2 + size * 0.04);
  return c.toDataURL('image/png');
}

const stickerPngs = (project) =>
  Object.fromEntries(project.stickerClips.filter((s) => s.emoji).map((s) => [s.id, emojiPng(s.emoji)]));

export default function App() {
  const [state, dispatch] = useReducer(historyReducer, { past: [], present: emptyProject(), future: [] });
  const project = state.present;
  const [time, setTime] = useState(0);
  // Shared playback clock: Preview (writer) publishes { time, stamp, playing, rate } every
  // frame; the Timeline playhead reads it directly so it glides without React re-renders.
  const clockRef = useRef({ time: 0, stamp: 0, playing: false, rate: 1 });
  const [playing, setPlaying] = useState(false);
  const [selection, setSelection] = useState(null); // { track, id }
  const [exporting, setExporting] = useState(null);
  const [renderJob, setRenderJob] = useState(null); // derivative renders (Reverse): { label, fraction } | { error }
  const [tab, setTab] = useState('media');
  const { layout: panes, startDrag: startResize, reset: resetSize, nudge: nudgeSize } = useLayout();
  const [tool, setTool] = useState('select'); // timeline tool: 'select' | 'razor'
  const [clipboard, setClipboard] = useState(null); // { track, clip } for copy / cut / paste
  const [attrClipboard, setAttrClipboard] = useState(null); // copied look and placement
  const [menu, setMenu] = useState(null); // right-click menu: { x, y, track, id }
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [quality, setQuality] = useState('full'); // Playback quality: which scaled copy the player uses
  const [aboutOpen, setAboutOpen] = useState(false);
  const [update, setUpdate] = useUpdateCheck(); // manual update check state (About dialog)
  const [updateSeen, setUpdateSeen] = useState(false);
  const [settingsVersion, setSettingsVersion] = useState(0); // bumps when Settings closes so the assistant re-reads the AI setup
  const [dragOver, setDragOver] = useState(false);
  const duration = projectDuration(project);
  const [captions, setCaptions] = useState({ installed: false });

  // Autosave for crashes: the project is kept in this PC's local storage a second after each change. If the
  // interface crashes and reloads by itself, it comes back as it was (the main process says when that happened).
  const [recoveredNote, setRecoveredNote] = useState(false);
  // LUTs used by the clips are read from disk once; the player draws again when one is ready.
  const [, setLutTick] = useState(0);
  useEffect(() => onLutLoaded(() => setLutTick((n) => n + 1)), []);
  useEffect(() => { loadProjectLuts(project); }, [project]);
  // Auto save: a project that has a file is written to it 1.5 s after each change. A project that never had a file
  // is kept in local storage only; closing asks to save it, and the next start offers it back if it was lost.
  const autosave = useRef({ timer: null, project, file: null, fileTimer: null, writing: null });
  autosave.current.project = project;
  const [saveState, setSaveState] = useState('new'); // 'new' | 'saving' | 'saved' | 'error'
  const [unsavedNote, setUnsavedNote] = useState(null); // { savedAt, project } left by a session that ended unsaved
  const [closeAsk, setCloseAsk] = useState(null); // { name, resolve }: the "Save before closing?" question
  // ---- Home screen + recent projects (localStorage 'clipcraft.recents') ----
  const [screen, setScreen] = useState('home'); // 'home' | 'editor'
  const [recents, setRecents] = useState(() => {
    try { return JSON.parse(localStorage.getItem('clipcraft.recents') || '[]'); } catch { return []; }
  });
  const [seqAsk, setSeqAsk] = useState(null); // { media, mismatch, proceed }: sequence mismatch waiting for the user
  const storeRecents = (list) => {
    setRecents(list);
    try { localStorage.setItem('clipcraft.recents', JSON.stringify(list)); } catch { /* storage full: recents just don't persist */ }
  };
  const pushRecent = (entry) => {
    if (!entry?.path) return;
    setRecents((list) => {
      const next = [entry, ...list.filter((r) => r.path !== entry.path)].slice(0, 12);
      try { localStorage.setItem('clipcraft.recents', JSON.stringify(next)); } catch { /* as above */ }
      return next;
    });
  };
  const recentOf = (p, path) => recentEntryFor(p, path, toFileUrl);
  const removeRecent = (path) => storeRecents(recents.filter((r) => r.path !== path));
  const hasContent = (p) => !!(p.media.length || p.videoClips.length || p.textClips.length || p.audioClips.length
    || (p.overlayClips || []).length || (p.stickerClips || []).length);
  const keepRecovery = (unsaved) => {
    try {
      localStorage.setItem('clipcraft.recovery', JSON.stringify({
        savedAt: Date.now(), project: autosave.current.project, file: autosave.current.file, unsaved,
      }));
    } catch {
      // storage full: the next save tries again
    }
  };
  const writeFile = async () => {
    const a = autosave.current;
    clearTimeout(a.fileTimer);
    a.fileTimer = null;
    if (!a.file) return true;
    setSaveState('saving');
    const ok = await window.api.autosaveProject(a.file, JSON.stringify(a.project, null, 2));
    setSaveState(ok ? 'saved' : 'error');
    return ok;
  };
  useEffect(() => {
    const a = autosave.current;
    // At most once a second, and always the latest project (thumbnails arriving keep changing it).
    if (!a.timer) {
      a.timer = setTimeout(() => {
        a.timer = null;
        // An unsaved project offered back at start stays stored until the user answers or starts working.
        if (a.pendingRestore && !hasContent(a.project)) return;
        a.pendingRestore = false;
        keepRecovery(!a.file && hasContent(a.project));
      }, 1000);
    }
    if (a.file) {
      clearTimeout(a.fileTimer);
      a.fileTimer = setTimeout(writeFile, 1500);
    }
  }, [project]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    let saved = null;
    try {
      saved = JSON.parse(localStorage.getItem('clipcraft.recovery') || 'null');
    } catch {
      // nothing usable saved
    }
    window.api.wasRecovered?.().then((was) => {
      if (was && saved?.project) {
        // The window crashed and reloaded: same project, same file.
        autosave.current.file = saved.file || null;
        if (saved.file) setSaveState('saved');
        dispatch({ type: 'load', project: saved.project });
        setRecoveredNote(true);
        setScreen('editor');
      } else if (saved?.unsaved && saved.project && hasContent(saved.project)) {
        autosave.current.pendingRestore = true;
        setUnsavedNote(saved);
      }
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Thumbnails / waveforms are generated in the background after import.
  useEffect(() => window.api.onMediaVisuals(({ path, ...patch }) => dispatch({ type: 'mediaVisuals', path, patch })), []);
  // When a video thumbnail lands for the project that backs a recents entry, refresh that
  // entry's poster in place (no reorder, no date change). Degrades silently otherwise.
  const firstVideoThumb = (project.media || []).find((m) => m.type === 'video' && m.thumb)?.thumb || null;
  useEffect(() => {
    const f = autosave.current.file;
    if (!f || !firstVideoThumb) return;
    setRecents((list) => {
      const e = list.find((r) => r.path === f);
      if (!e) return list;
      const fresh = recentEntryFor(project, f, toFileUrl);
      if (!fresh.thumb || JSON.stringify(fresh.thumb) === JSON.stringify(e.thumb)) return list;
      const next = list.map((r) => (r.path === f ? { ...r, thumb: fresh.thumb } : r));
      try { localStorage.setItem('clipcraft.recents', JSON.stringify(next)); } catch { /* as above */ }
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firstVideoThumb]);
  // Ask for visuals that are missing (older projects, files imported before this feature, moved caches).
  // Below Full playback quality, every video also needs its copy for the level (levelCopyState 'fallback':
  // not made yet; 'failed' is not retried). While the copy is missing the player uses a fallback file.
  const mediaKey = project.media.map((m) => `${m.path}|${m.thumbCount ? 1 : 0}|${m.wave ? 1 : 0}|${m.optimizing ? 1 : 0}|${m.lightProxy == null ? 0 : 1}|${m.proxies?.[quality] == null ? 0 : 1}`).join(';') + `|${quality}`;
  useEffect(() => {
    const missing = project.media.filter((m) => (m.type === 'video' && (!m.thumbCount || m.optimizing || levelCopyState(m, quality) === 'fallback')) || (m.hasAudio && !m.wave));
    if (missing.length) {
      window.api.ensureVisuals(missing.map(({ path, type, duration, hasAudio, width, height, proxy, lightProxy, proxies }) => ({ path, type, duration, hasAudio, width, height, proxy, lightProxy, proxies })));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mediaKey]);

  useEffect(() => {
    window.api.captionsStatus().then((st) => setCaptions((c) => ({ ...c, installed: st.installed, models: st.models || {}, available: st.available })));
  }, []);

  const runCaptions = async (opts) => {
    setPlaying(false);
    setCaptions((c) => ({ ...c, busy: true, error: null, stage: 'Preparing', progress: 0 }));
    const off = window.api.onCaptionsProgress(({ stage, progress }) => setCaptions((c) => ({ ...c, stage, progress })));
    const { style, engine, ...engineOpts } = opts;
    // Cloud engines return the same segment shape, so everything after this call —
    // caption clips, styling, apply-to-all — is the one shared path.
    const res = engine === 'cloud'
      ? await window.api.runCaptionsCloud(project, engineOpts)
      : await window.api.runCaptions(project, engineOpts);
    off();
    if (res.ok) {
      dispatch({ type: 'setCaptions', style, segments: res.segments.map((s) => ({ ...s, id: uid() })) });
      if (engine === 'cloud') {
        setCaptions((c) => ({ ...c, busy: false }));
      } else {
        setCaptions((c) => ({ installed: true, available: c.available, models: { ...c.models, [engineOpts.model || 'base']: true }, busy: false }));
      }
      setTab('captions');
    } else {
      setCaptions((c) => ({ ...c, busy: false, error: res.error }));
    }
  };

  // Media item watched in the player before it is on the timeline (click a card in the Media panel). Seeking or
  // playing the project goes back to it.
  const [peekId, setPeekId] = useState(null);
  const peek = useCallback((id) => { setPlaying(false); setPeekId(id); }, []);

  const [seekVer, setSeekVer] = useState(0);
  const seek = useCallback((t) => {
    setPeekId(null);
    setTime(Math.max(0, t));
    setSeekVer((v) => v + 1);
  }, []);

  const togglePlay = useCallback(() => {
    setPeekId(null);
    if (playing) return setPlaying(false);
    if (time >= duration - 0.05) setTime(0);
    if (duration > 0) setPlaying(true);
  }, [playing, time, duration]);

  const addItems = (items) => {
    const ok = items.filter((i) => !i.error).map((i) => ({ ...i, id: uid() }));
    const bad = items.filter((i) => i.error);
    if (bad.length) alert('Could not import:\n' + bad.map((b) => `${b.name}: ${b.error}`).join('\n'));
    if (ok.length) dispatch({ type: 'addMedia', items: ok });
    return ok;
  };

  const importMedia = async () => addItems(await window.api.importMedia());

  const onDrop = async (e) => {
    e.preventDefault();
    setDragOver(false);
    if (isInternal(e)) return;
    const files = [...e.dataTransfer.files];
    if (files.length) addItems(await window.api.probeFiles(files));
  };

  // Drop from an asset panel onto the timeline (info: { lane, time, index, clipId } from Timeline).
  const applyToClip = (clipId, payload) => {
    const clip = project.videoClips.find((c) => c.id === clipId);
    if (!clip) return;
    let patch;
    if (payload.kind === 'filter') patch = { filter: payload.id };
    else if (payload.kind === 'effect') patch = { effects: clip.effects?.includes(payload.id) ? clip.effects : [...(clip.effects || []), payload.id] };
    else if (payload.kind === 'transition') {
      if (project.videoClips[0].id === clipId) return; // no clip before the first one
      patch = { transition: { type: payload.id, duration: payload.duration || 0.5 } };
    }
    dispatch({ type: 'update', track: 'video', id: clipId, patch });
    setSelection({ track: 'video', id: clipId });
  };

  const dropItem = (payload, info) => {
    if (!payload) return;
    const clipId = uid();
    const layer = (lane) => (info.layerLane === lane ? info.layer : undefined); // the layer it was dropped on
    if (payload.kind === 'media') {
      const m = project.media.find((x) => x.id === payload.id);
      if (!m) return;
      if (info.lane === 'overlay' && m.type !== 'audio') {
        dispatch({ type: 'addOverlayClip', mediaId: m.id, clipId, at: info.time, layer: layer('overlay') });
        return setSelection({ track: 'overlay', id: clipId });
      }
      guardAdd(m, () => {
        dispatch({ type: 'addToTimeline', mediaId: m.id, clipId, at: info.time, index: info.index, layer: layer('audio') });
        setSelection({ track: m.type === 'audio' ? 'audio' : 'video', id: clipId });
      });
    } else if (payload.kind === 'sticker') {
      dispatch({ type: 'addOverlay', clipId, at: info.time, clip: { emoji: payload.emoji }, layer: layer('sticker') });
      setSelection({ track: 'sticker', id: clipId });
    } else if (payload.kind === 'text') {
      dispatch({ type: 'addText', clipId, at: info.time, patch: payload.patch, layer: layer('text') });
      setSelection({ track: 'text', id: clipId });
    } else if (payload.kind === 'effect' && info.lane === 'effect') {
      dispatch({ type: 'addEffectClip', clipId, fx: payload.id, at: info.time });
      setSelection({ track: 'effect', id: clipId });
    } else if (info.clipId) {
      applyToClip(info.clipId, payload);
    }
  };

  const dropFiles = async (files, info) => {
    const items = addItems(await window.api.probeFiles(files));
    // One sequence question per drop, for the first picture/video in it (overlay drops are exempt).
    const firstPic = info.lane === 'overlay' ? null : items.find((m) => m.type === 'video' || m.type === 'image');
    guardAdd(firstPic, () => {
      let index = info.index;
      let at = info.time;
      items.forEach((m) => {
        const clipId = uid();
        if (info.lane === 'overlay' && m.type !== 'audio') {
          dispatch({ type: 'addOverlayClip', mediaId: m.id, clipId, at, layer: info.layerLane === 'overlay' ? info.layer : undefined });
          at += m.type === 'image' ? 3 : m.duration;
        } else if (m.type === 'audio') dispatch({ type: 'addToTimeline', mediaId: m.id, clipId, at: info.time, layer: info.layerLane === 'audio' ? info.layer : undefined });
        else dispatch({ type: 'addToTimeline', mediaId: m.id, clipId, index: index++ });
      });
    });
  };

  // Drop onto the player: media goes to the end of the main track, looks apply to the clip on screen.
  const dropOnPreview = (payload) => {
    if (!payload) return;
    if (payload.kind === 'media') return dropItem(payload, { time, index: undefined });
    if (payload.kind === 'sticker' || payload.kind === 'text') return dropItem(payload, { time });
    const v = videoClipAt(project, time);
    if (v) applyToClip(v.clip.id, payload);
  };

  // A sound from the audio library: one media item per file (reused), clip on the Audio track at the playhead.
  const libraryAdd = async (item) => {
    const res = await window.api.libraryAdd(item);
    if (res.error) return res;
    let m = projectRef.current.media.find((x) => x.path === res.path);
    if (!m) [m] = addItems([res]);
    if (!m) return { error: 'Could not add the sound.' };
    const clipId = uid();
    dispatch({ type: 'addToTimeline', mediaId: m.id, clipId, at: time });
    setSelection({ track: 'audio', id: clipId });
    return { ok: true };
  };

  // Text to speech: the voice goes on the Audio track where the selected text starts, or at the playhead.
  const selectedText = selection?.track === 'text' ? project.textClips.find((c) => c.id === selection.id) : null;
  const ttsAdd = (res, atText) => {
    let m = projectRef.current.media.find((x) => x.path === res.path);
    if (!m) [m] = addItems([res]);
    if (!m) return;
    const clipId = uid();
    dispatch({ type: 'addToTimeline', mediaId: m.id, clipId, at: atText ? selectedText.start : time });
    setSelection({ track: 'audio', id: clipId });
  };

  // Stock media (Pixabay): download once, then main track or overlay at the playhead.
  const [stockKey, setStockKey] = useState(false);
  useEffect(() => {
    window.api.settingsGet().then((st) => setStockKey(!!st.serviceKeys?.pixabay));
    window.api.proxyStatus?.().then((st) => { setPlaybackQuality(st.quality); setQuality(st.quality); }).catch(() => {});
  }, [settingsVersion]);
  const stockAdd = async (item, where) => {
    const res = await window.api.stockAdd(item);
    if (res.error) return res;
    let m = projectRef.current.media.find((x) => x.path === res.path);
    if (!m) [m] = addItems([res]);
    if (!m) return { error: 'Could not add the file.' };
    const clipId = uid();
    if (where === 'overlay') {
      dispatch({ type: 'addOverlayClip', mediaId: m.id, clipId, at: time });
      setSelection({ track: 'overlay', id: clipId });
    } else {
      guardAdd(m, () => {
        const index = videoLayout(projectRef.current.videoClips).filter((l) => (l.start + l.end) / 2 < time).length;
        dispatch({ type: 'addToTimeline', mediaId: m.id, clipId, index });
        setSelection({ track: 'video', id: clipId });
      });
    }
    return { ok: true };
  };

  // A favorite from disk: reuse the media item when the project has it, then add it at the playhead.
  // An animated sticker (downloaded by the main process) on the Stickers track at the playhead.
  const stickerAdd = async (s) => {
    const res = await window.api.stickersGet(s.id, s.name);
    if (res.error) return res;
    let m = projectRef.current.media.find((x) => x.path === res.path);
    if (!m) [m] = addItems([res]);
    if (!m) return { error: 'Could not add the sticker.' };
    addOverlay({ mediaId: m.id, size: 260 });
    return { ok: true };
  };

  const addFile = async (filePath, where = 'main') => {
    let m = projectRef.current.media.find((x) => x.path === filePath);
    if (!m) {
      const [res] = await window.api.probePaths([filePath]);
      if (!res || res.error) return { error: res ? `${res.name}: ${res.error}` : 'The file was not found.' };
      [m] = addItems([res]);
    }
    const clipId = uid();
    if (m.type === 'audio') {
      dispatch({ type: 'addToTimeline', mediaId: m.id, clipId, at: time });
      setSelection({ track: 'audio', id: clipId });
    } else if (where === 'overlay') {
      dispatch({ type: 'addOverlayClip', mediaId: m.id, clipId, at: time });
      setSelection({ track: 'overlay', id: clipId });
    } else {
      guardAdd(m, () => {
        const index = videoLayout(projectRef.current.videoClips).filter((l) => (l.start + l.end) / 2 < time).length;
        dispatch({ type: 'addToTimeline', mediaId: m.id, clipId, index });
        setSelection({ track: 'video', id: clipId });
      });
    }
    return { ok: true };
  };

  // Picture-in-picture at the playhead (Media panel button).
  const addAsOverlay = (mediaId) => {
    const clipId = uid();
    dispatch({ type: 'addOverlayClip', mediaId, clipId, at: time });
    setSelection({ track: 'overlay', id: clipId });
  };

  // Sequence check: placing a video/photo on the main track whose resolution, aspect ratio or
  // frame rate differs from the project sequence asks first (SequenceDialog); project settings
  // are never changed silently on these paths. The first clip of a project whose format was not
  // locked still sets the canvas through canvasFor, as before.
  const guardAdd = (media, proceed) => {
    const p = projectRef.current;
    if (media && (media.type === 'video' || media.type === 'image')) {
      const firstClip = !(p.videoClips || []).some((c) => !c.gap);
      if (!(firstClip && !p.ratioLocked)) {
        const mm = mismatchFor(p, media);
        if (mm) { setSeqAsk({ media, mismatch: mm, proceed }); return; }
      }
    }
    proceed();
  };
  const resolveSeq = (change) => {
    const ask = seqAsk;
    setSeqAsk(null);
    if (!ask) return;
    if (change) {
      const patch = sequencePatchFor(ask.media);
      if (patch) dispatch({ type: 'setProject', patch });
    }
    ask.proceed();
  };

  const addToTimeline = (mediaId) => {
    const m = project.media.find((x) => x.id === mediaId);
    guardAdd(m, () => {
      const clipId = uid();
      dispatch({ type: 'addToTimeline', mediaId, clipId, at: time });
      setSelection({ track: m && m.type === 'audio' ? 'audio' : 'video', id: clipId });
    });
  };

  // Voice-over: the clip goes where the recording started.
  const recorder = useRecorder((item, at) => {
    const m = { ...item, id: uid() };
    const clipId = uid();
    dispatch({ type: 'addMedia', items: [m] });
    dispatch({ type: 'addToTimeline', mediaId: m.id, clipId, at });
    setSelection({ track: 'audio', id: clipId });
  });
  // Remove a media item from the project; when clips use it, ask first (they go too). Ctrl+Z brings it back.
  const removeMedia = (id) => {
    const p = projectRef.current;
    const m = p.media.find((x) => x.id === id);
    if (!m) return;
    const used = [p.videoClips, p.overlayClips || [], p.audioClips, p.stickerClips].reduce((n, list) => n + list.filter((c) => c.mediaId === id).length, 0);
    if (used && !window.confirm(`"${m.name}" is used by ${used} clip${used > 1 ? 's' : ''} on the timeline.\nRemove it and ${used > 1 ? 'those clips' : 'that clip'}? (Ctrl+Z undoes it)`)) return;
    dispatch({ type: 'removeMedia', id });
  };

  const toggleRecording = () => (recorder.recording ? recorder.stop() : recorder.start(time));

  // Screen recording: the video goes on the main track at the playhead. The camera, recorded as its own clip,
  // goes on the overlay track at the same time, cut round or square and placed where its bubble was on the screen
  // (bottom-right corner when that is unknown, e.g. a window recording).
  const [screenOpen, setScreenOpen] = useState(false);
  const screenRec = useScreenRecorder(({ screen, camera, camShape, camStyle, camGeom }, at) => {
    const [m, cam] = addItems(camera ? [screen, camera] : [screen]);
    if (!m) return;
    // The frame as it will be once the screen clip is in (it can set the canvas shape), not as it was.
    const frame = { ...projectRef.current, ...canvasFor(projectRef.current, m) };
    const clipId = uid();
    const layout = videoLayout(projectRef.current.videoClips);
    const index = layout.filter((l) => (l.start + l.end) / 2 < at).length;
    dispatch({ type: 'addToTimeline', mediaId: m.id, clipId, index });
    if (cam) {
      const camId = uid();
      // Where the screen clip starts: the clip it was put before, or the end of the track.
      const start = index < layout.length ? layout[index].start : layout.length ? layout[layout.length - 1].end : 0;
      dispatch({ type: 'addOverlayClip', mediaId: cam.id, clipId: camId, at: start });
      // Mask: the centered circle / rounded square the bubble showed (the camera picture fitted in the frame,
      // cropped to its height like the bubble's "cover"), in fractions of the frame.
      const { width: W, height: H } = frame;
      const fit = (w, h) => Math.min(W / (w || W), H / (h || H));
      const k = fit(cam.width, cam.height);
      // Size the camera takes in the video (pixels): where its bubble was, or a third of the frame.
      let target = 0.35 * Math.min(W, H);
      let place = { x: 0.3, y: 0.24 };
      if (camGeom) {
        // The screen video fitted in the frame; the bubble's center and size on it.
        const ks = fit(m.width, m.height);
        const sw = (m.width || W) * ks;
        const sh = (m.height || H) * ks;
        const X = (W - sw) / 2 + camGeom.cx * sw;
        const Y = (H - sh) / 2 + camGeom.cy * sh;
        target = camGeom.d * sw;
        place = { x: (X - W / 2) / W, y: (Y - H / 2) / H };
      }
      // The shape fills the camera picture's height, minus room for the outline and the glow, which are drawn
      // around it inside the frame (their size is for the final picture, so it grows as the clip is scaled down).
      const room = ((camStyle?.stroke > 0 ? camStyle.stroke / 2 : 0) + (camStyle?.glow > 0 ? camStyle.glow * 2 : 0)) * (Math.min(W, H) / 720);
      const full = Math.min((cam.width || W) * k, (cam.height || H) * k);
      const d = Math.min(full, Math.min(W, H) / (1 + (2 * room) / Math.max(1, target)));
      const shape = camShape === 'square' ? { type: 'rectangle', w: d / W, h: d / H, round: 0.28 } : { type: 'circle', w: d / W, h: d / H };
      // The outline and glow chosen in the Record window (Mask > Outline and glow changes them later).
      const mask = { ...shape, ...(camStyle?.stroke > 0 && { stroke: camStyle.stroke, strokeColor: camStyle.strokeColor }),
        ...(camStyle?.glow > 0 && { glow: camStyle.glow, glowColor: camStyle.glowColor }) };
      const transform = { scale: target / d, ...place };
      dispatch({ type: 'update', track: 'overlay', id: camId, patch: { start, mask, transform } });
    }
    setSelection({ track: 'video', id: clipId });
    setScreenOpen(false);
  });

  const addText = (patch = {}) => {
    const clipId = uid();
    dispatch({ type: 'addText', clipId, at: time, patch });
    setSelection({ track: 'text', id: clipId });
  };

  const addOverlay = (clip) => {
    const clipId = uid();
    dispatch({ type: 'addOverlay', clipId, at: time, clip });
    setSelection({ track: 'sticker', id: clipId });
  };

  // Video clip targeted by the Effects / Filters / Transitions / Adjust tabs: selection first, else under the playhead.
  const layout = videoLayout(project.videoClips);
  const target = (selection?.track === 'video' && layout.find((l) => l.clip.id === selection.id && !l.clip.gap))
    || (selection?.items && layout.find((l) => !l.clip.gap && selection.items.some((it) => it.track === 'video' && it.id === l.clip.id)))
    || videoClipAt(project, time);
  // With several clips selected, a filter or color change goes to all of them (one undo step).
  const updateTarget = (patch) => {
    if (!target) return;
    const many = selectedPictures(project, selection);
    if (many.length > 1 && isLookPatch(patch)) dispatch(lookAction(many, target.clip, patch));
    else dispatch({ type: 'update', track: 'video', id: target.clip.id, patch });
  };

  const split = useCallback(() => {
    let tgt = selection;
    if (!tgt) {
      const v = videoClipAt(project, time);
      if (v) tgt = { track: 'video', id: v.clip.id };
    }
    if (tgt) dispatch({ type: 'split', track: tgt.track, id: tgt.id, t: time, newId: uid() });
  }, [selection, project, time]);

  // Delete everything left (or right) of the playhead in the selected clip when the playhead is inside it,
  // otherwise in the main-track clip under the playhead.
  const trimSide = useCallback((side) => {
    const targets = [];
    if (selection) targets.push(selection);
    const v = videoClipAt(project, time);
    if (v && !(selection && selection.id === v.clip.id)) targets.push({ track: 'video', id: v.clip.id });
    for (const tgt of targets) {
      const newId = uid();
      const actions = trimActions(project, { track: tgt.track, id: tgt.id, t: time, side, newId });
      if (!actions.length) continue;
      // Split + delete land as ONE undo step.
      dispatch({ type: 'beginGesture' });
      actions.forEach((a) => dispatch(a));
      dispatch({ type: 'endGesture' });
      setSelection(side === 'right' ? { track: tgt.track, id: tgt.id } : { track: tgt.track, id: newId });
      return;
    }
  }, [selection, project, time]);

  // Add a marker at the playhead, or remove the one that is already there.
  const toggleMarker = useCallback(() => {
    const near = markerNear(project.markers, time);
    if (near) dispatch({ type: 'removeMarker', id: near.id });
    else dispatch({ type: 'addMarker', id: uid(), time });
  }, [project.markers, time]);

  const remove = useCallback(() => {
    if (!selection) return;
    const removeOne = (sel) => {
      if (sel.track === 'transition') dispatch({ type: 'update', track: 'video', id: sel.id, patch: { transition: null } });
      else if (sel.track === 'effect' && sel.id.includes('|')) dispatch({ type: 'removeEffect', id: sel.id });
      else dispatch({ type: 'delete', track: sel.track, id: sel.id });
    };
    if (selection.items) {
      // Several clips: one undo step for all of them.
      dispatch({ type: 'beginGesture' });
      selection.items.forEach(removeOne);
      dispatch({ type: 'endGesture' });
    } else removeOne(selection);
    setSelection(null);
  }, [selection]);

  // What the player shows and exports: deactivated clips left out.
  const playProject = useMemo(() => renderable(project), [project]);

  // ---- Copy / cut / paste and the right-click clip menu ----
  const findClip = (p, sel) => {
    if (!sel) return null;
    const key = { video: 'videoClips', overlay: 'overlayClips', text: 'textClips', audio: 'audioClips', sticker: 'stickerClips' }[sel.track];
    return key ? p[key].find((c) => c.id === sel.id) : null;
  };
  const copy = useCallback(() => {
    const c = findClip(project, selection);
    if (c && !c.gap) setClipboard({ track: selection.track, clip: c });
    return !!(c && !c.gap);
  }, [project, selection]);
  const cut = useCallback(() => {
    if (copy()) {
      dispatch({ type: 'delete', ...selection });
      setSelection(null);
    }
  }, [copy, selection]);
  const paste = useCallback(() => {
    if (!clipboard) return;
    const newId = uid();
    dispatch({ type: 'paste', track: clipboard.track, clip: clipboard.clip, at: time, newId });
    setSelection({ track: clipboard.track, id: newId });
  }, [clipboard, time]);
  const extractAudio = useCallback((sel = selection) => {
    if (!sel) return;
    const newId = uid();
    dispatch({ type: 'extractAudio', track: sel.track, id: sel.id, newId });
  }, [selection]);

  // Sound of one clip, or of the whole timeline, as an audio file.
  const exportAudio = async (format, clipSel) => {
    let p = renderable(project);
    let name = project.name;
    if (clipSel) {
      const c = findClip(project, clipSel);
      const m = c && project.media.find((x) => x.id === c.mediaId);
      if (!c || !m) return;
      name = m.name.replace(/\.[^.]+$/, '');
      const only = { ...p, videoClips: [], overlayClips: [], audioClips: [], textClips: [], stickerClips: [] };
      p = clipSel.track === 'audio' ? { ...only, audioClips: [{ ...c, start: 0 }] } : { ...only, overlayClips: [{ ...c, start: 0, muted: false }] };
    }
    setPlaying(false);
    setExporting({ progress: 0.5, stage: 'Exporting audio' });
    const res = await window.api.exportAudio(p, format, name);
    if (res.canceled) return setExporting(null);
    setExporting(res.ok ? { done: true, file: res.file, progress: 1 } : { error: res.error });
  };

  // Freeze frame (item 12): hold the frame at the playhead (or the clip's start) as a 4-second
  // still. The original clip splits around the still; on the main track everything after shifts
  // by the still's length, on the overlay track the second part moves 4 s later. One undo step.
  const freezeClip = async (sel) => {
    const p = projectRef.current;
    const key = sel.track === 'video' ? 'videoClips' : 'overlayClips';
    const c = p[key].find((x) => x.id === sel.id);
    const m = c && p.media.find((x) => x.id === c.mediaId);
    if (!c || !m) return;
    let start;
    let len;
    if (sel.track === 'video') {
      const l = videoLayout(p.videoClips).find((x) => x.clip.id === c.id);
      if (!l) return;
      start = l.start; len = l.end - l.start;
    } else { start = c.start || 0; len = freeLen('overlay', c); }
    const t = time > start && time < start + len ? time : start;
    const srcT = (c.in || 0) + (t - start) * (c.speed || 1);
    let fm;
    try { fm = await window.api.frameImage(m.path, srcT); } catch (e) { fm = { error: e.message }; }
    if (!fm || fm.error) { setRenderJob({ error: (fm && fm.error) || 'Could not grab the frame.' }); return; }
    let media = projectRef.current.media.find((x) => x.path === fm.path);
    const stillId = uid();
    dispatch({ type: 'beginGesture' });
    if (!media) { media = { ...fm, id: uid() }; dispatch({ type: 'addMedia', items: [media] }); }
    if (sel.track === 'video') {
      const idx = videoLayout(p.videoClips).findIndex((x) => x.clip.id === c.id);
      let insertIndex = idx;
      if (t > start + 0.01) {
        if (t < start + len - 0.01) dispatch({ type: 'split', track: 'video', id: c.id, t, newId: uid() });
        insertIndex = idx + 1;
      }
      dispatch({ type: 'addToTimeline', mediaId: media.id, clipId: stillId, index: insertIndex });
    } else {
      const secondId = uid();
      const interior = t > start + 0.01 && t < start + len - 0.01;
      if (interior) {
        dispatch({ type: 'split', track: 'overlay', id: c.id, t, newId: secondId });
        dispatch({ type: 'update', track: 'overlay', id: secondId, patch: { start: t + 4 } });
      } else {
        dispatch({ type: 'update', track: 'overlay', id: c.id, patch: { start: (c.start || 0) + 4 } });
      }
      dispatch({ type: 'addOverlayClip', mediaId: media.id, clipId: stillId, at: t, layer: c.layer });
      dispatch({ type: 'update', track: 'overlay', id: stillId, patch: { transform: c.transform || undefined } });
    }
    dispatch({ type: 'endGesture' });
    setSelection({ track: sel.track, id: stillId });
  };

  // Reverse (item 12): render the clip's range backwards (electron/reverse.cjs, cached) and swap
  // the clip onto the derivative, remembering the original in clip.reversed — choosing Reverse
  // again restores it. Progress rides the same pill as other derivative renders.
  const reverseClip = async (sel) => {
    const p = projectRef.current;
    const key = sel.track === 'video' ? 'videoClips' : sel.track === 'overlay' ? 'overlayClips' : 'audioClips';
    const c = p[key].find((x) => x.id === sel.id);
    const m = c && p.media.find((x) => x.id === c.mediaId);
    if (!c || !m) return;
    if (c.reversed) {
      dispatch({ type: 'update', ...sel, patch: { mediaId: c.reversed.mediaId, in: c.reversed.in, out: c.reversed.out, reversed: null } });
      return;
    }
    setRenderJob({ label: 'Reversing clip…', fraction: 0 });
    const off = window.api.onReverseProgress((pr) => {
      if (pr.path === m.path) setRenderJob((j) => (j && !j.error ? { ...j, fraction: pr.fraction } : j));
    });
    let res;
    try {
      res = await window.api.reverseRun({ path: m.path, duration: m.duration, hdr: m.hdr, hasAudio: m.hasAudio, type: m.type }, c.in || 0, c.out ?? m.duration);
    } catch (e) { res = { error: e.message }; }
    off();
    if (res.canceled) { setRenderJob(null); return; }
    if (res.error) { setRenderJob({ error: res.error }); return; }
    setRenderJob(null);
    let media = projectRef.current.media.find((x) => x.path === res.path);
    dispatch({ type: 'beginGesture' });
    if (!media) { media = { ...res, id: uid() }; dispatch({ type: 'addMedia', items: [media] }); }
    dispatch({ type: 'update', ...sel, patch: { mediaId: media.id, in: 0, out: res.duration, reversed: { mediaId: c.mediaId, in: c.in || 0, out: c.out ?? m.duration } } });
    dispatch({ type: 'endGesture' });
  };

  const openClipMenu = (e, track, clip) => {
    setSelection({ track, id: clip.id });
    setMenu({ x: e.clientX, y: e.clientY, track, id: clip.id });
  };
  const menuItems = (sel) => {
    if (sel.track === 'effect' && !sel.id.includes('|')) {
      return [
        { label: 'Split at playhead', icon: Split, shortcut: 'S', onClick: split },
        { label: 'Duplicate', icon: CopyPlus, shortcut: 'Ctrl D', onClick: duplicate },
        { label: 'Delete', icon: Trash2, shortcut: 'Del', onClick: remove },
      ];
    }
    if (sel.track === 'effect') {
      const { track, clipId } = parseEffectKey(sel.id);
      return [
        { label: 'Delete effect', icon: Trash2, shortcut: 'Del', onClick: () => { dispatch({ type: 'removeEffect', id: sel.id }); setSelection(null); } },
        { label: 'Select its clip', icon: Layers, onClick: () => setSelection({ track, id: clipId }) },
      ];
    }
    const c = findClip(project, sel);
    if (!c) return [];
    if (c.gap) return [{ label: 'Close gap', icon: Trash2, shortcut: 'Del', onClick: () => dispatch({ type: 'delete', ...sel }) }];
    const m = c.mediaId && project.media.find((x) => x.id === c.mediaId);
    const pic = sel.track === 'video' || sel.track === 'overlay';
    const withSound = (pic && m?.type === 'video' && m.hasAudio) || sel.track === 'audio';
    const canExtract = pic && m?.type === 'video' && m.hasAudio && !c.muted && (c.speed || 1) === 1;
    const extractHint = !(pic && m?.type === 'video') ? 'Only for video clips'
      : !m.hasAudio ? 'This video has no sound' : c.muted ? 'The clip is muted (sound already extracted?)' : 'Set the speed to 1x first';
    const items = [
      { label: 'Copy', icon: Copy, shortcut: 'Ctrl C', onClick: copy },
      { label: 'Cut', icon: Scissors, shortcut: 'Ctrl X', onClick: cut },
      { label: 'Paste', icon: ClipboardPaste, shortcut: 'Ctrl V', onClick: paste, disabled: !clipboard, hint: 'Copy a clip first' },
      { label: 'Delete', icon: Trash2, shortcut: 'Del', onClick: remove },
      'sep',
      { label: 'Split at playhead', icon: Split, shortcut: 'S', onClick: split },
      { label: 'Delete left of playhead', icon: ScissorsLineDashed, shortcut: 'Q', onClick: () => trimSide('left') },
      { label: 'Delete right of playhead', icon: ScissorsLineDashed, shortcut: 'W', onClick: () => trimSide('right') },
      { label: 'Duplicate', icon: CopyPlus, shortcut: 'Ctrl D', onClick: duplicate },
    ];
    if (pic) {
      items.push('sep',
        c.slot
          ? { label: 'Not replaceable', icon: Repeat, onClick: () => dispatch({ type: 'update', ...sel, patch: { slot: false } }) }
          : { label: 'Make replaceable (template)', icon: Repeat, onClick: () => dispatch({ type: 'update', ...sel, patch: { slot: true } }) },
        { label: 'Copy attributes', icon: Paintbrush, onClick: () => setAttrClipboard(pickAttributes(c)) },
        { label: 'Paste attributes', icon: Paintbrush, disabled: !attrClipboard, hint: 'Copy the attributes of a clip first',
          onClick: () => dispatch({ type: 'update', ...sel, patch: attrClipboard }) },
        { label: 'Reset position and size', icon: RotateCcw, onClick: () => dispatch({ type: 'update', ...sel, patch: { transform: undefined } }) },
        { label: 'Remove filter', icon: Eraser, disabled: !c.filter || c.filter === 'none', hint: 'This clip has no filter',
          onClick: () => dispatch({ type: 'update', ...sel, patch: { filter: 'none' } }) },
        sel.track === 'video'
          ? { label: 'Move to overlay track', icon: Layers, onClick: () => {
            const l = videoLayout(project.videoClips).find((x) => x.clip.id === c.id);
            dispatch({ type: 'moveToOverlay', id: c.id, at: l ? l.start : time });
            setSelection({ track: 'overlay', id: c.id });
          } }
          : { label: 'Move to main track', icon: PanelBottom, onClick: () => {
            const index = videoLayout(project.videoClips).filter((l) => (l.start + l.end) / 2 < c.start).length;
            dispatch({ type: 'moveToMain', id: c.id, index });
            setSelection({ track: 'video', id: c.id });
          } });
    }
    if (pic) {
      const fx = c.effects || [];
      items.push('sep',
        { label: 'Freeze frame', icon: Snowflake, onClick: () => freezeClip(sel) },
        { label: c.reversed ? 'Reverse (restore original)' : 'Reverse', icon: Rewind, onClick: () => reverseClip(sel) },
        { label: fx.includes('mirror') ? 'Mirror (on)' : 'Mirror', icon: FlipHorizontal2,
          onClick: () => dispatch({ type: 'update', ...sel, patch: { effects: fx.includes('mirror') ? fx.filter((x) => x !== 'mirror') : [...fx, 'mirror'] } }) },
        { label: 'Rotate 90°', icon: RotateCw,
          onClick: () => { const t = c.transform || {}; dispatch({ type: 'update', ...sel, patch: { transform: { ...t, rot: ((t.rot || 0) + 90) % 360 } } }); } });
    }
    items.push('sep');
    if (pic) items.push({ label: 'Extract audio', icon: AudioLines, shortcut: 'Ctrl Shift S', onClick: () => extractAudio(sel), disabled: !canExtract, hint: extractHint });
    if (sel.track === 'audio') items.push({ label: c.reversed ? 'Reverse (restore original)' : 'Reverse', icon: Rewind, onClick: () => reverseClip(sel) });
    items.push({ label: 'Export clip audio (MP3)', icon: AudioLines, onClick: () => exportAudio('mp3', sel), disabled: !withSound, hint: 'This clip has no sound' });
    items.push(c.disabled
      ? { label: 'Activate clip', icon: Eye, onClick: () => dispatch({ type: 'update', ...sel, patch: { disabled: false } }) }
      : { label: 'Deactivate clip', icon: EyeOff, onClick: () => dispatch({ type: 'update', ...sel, patch: { disabled: true } }) });
    return items;
  };

  const duplicate = useCallback(() => {
    if (selection && selection.track !== 'transition' && !(selection.track === 'effect' && selection.id.includes('|'))) dispatch({ type: 'duplicate', ...selection, newId: uid() });
  }, [selection]);

  // Saves to the project's file (asks where the first time, or always with saveAs). Returns true once saved.
  const save = async (saveAs = false) => {
    const a = autosave.current;
    const p = projectRef.current;
    const res = await window.api.saveProject(JSON.stringify(p, null, 2), a.file, { saveAs, name: p.name });
    if (!res) return false;
    if (res.error) {
      setSaveState('error');
      alert(res.error);
      return false;
    }
    clearTimeout(a.fileTimer);
    a.file = res;
    setSaveState('saved');
    pushRecent(recentOf(p, res));
    keepRecovery(false);
    return true;
  };

  const open = async () => {
    const res = await window.api.openProject();
    if (!res) return;
    try {
      const p = JSON.parse(res.json);
      await writeFile(); // the current project keeps its last changes
      autosave.current.file = res.file;
      dispatch({ type: 'load', project: p });
      setSaveState('saved');
      setUnsavedNote(null);
      setTime(0);
      setSelection(null);
      pushRecent(recentOf(p, res.file));
      setScreen('editor');
    } catch (e) {
      alert('Invalid project file: ' + e.message);
    }
  };

  // ---- Home screen actions ----
  const startNewProject = (preset, fps) => {
    const p = {
      ...emptyProject(), name: 'Untitled', ratio: preset.ratio,
      ...sizeFor(preset.ratio, preset.short), resolution: preset.short, fps, ratioLocked: true,
    };
    autosave.current.file = null;
    autosave.current.pendingRestore = false;
    dispatch({ type: 'load', project: p });
    setSaveState('new');
    setUnsavedNote(null);
    setSelection(null);
    setTime(0);
    setScreen('editor');
  };

  // Home quick tools that genuinely work end-to-end: a template start opens a fresh project
  // on the Templates tab; Record screen opens a fresh 16:9 project with the recorder up.
  const startFromTemplate = (preset, fps) => {
    startNewProject(preset, fps);
    setTab('templates');
  };

  const startRecording = (fps) => {
    startNewProject({ ratio: '16:9', short: 1080 }, fps);
    setPlaying(false);
    setScreenOpen(true);
  };

  const openRecent = async (r) => {
    const res = await window.api.openProjectPath?.(r.path);
    if (!res) {
      storeRecents(recents.filter((x) => x.path !== r.path));
      alert('That project file could not be found any more, so it was removed from recents.');
      return;
    }
    try {
      const p = JSON.parse(res.json);
      await writeFile();
      autosave.current.file = res.file;
      dispatch({ type: 'load', project: p });
      setSaveState('saved');
      setUnsavedNote(null);
      setTime(0);
      setSelection(null);
      pushRecent(recentOf(p, res.file));
      setScreen('editor');
    } catch (e) {
      alert('Invalid project file: ' + e.message);
    }
  };

  const importFromHome = async () => {
    const ok = await importMedia();
    if (ok.length) {
      autosave.current.file = null;
      setSaveState('new');
      setScreen('editor');
    }
  };

  // Closing the window: write the project's file, or ask about a project that never had one.
  useEffect(() => window.api.onCloseRequest(async () => {
    const a = autosave.current;
    if (a.file) {
      await writeFile();
      keepRecovery(false);
      return window.api.closeNow();
    }
    if (!hasContent(a.project)) {
      keepRecovery(false);
      return window.api.closeNow();
    }
    window.api.closeCancel(); // the window waits for the answer
    if (a.asking) return; // already asking (the close button was clicked again)
    a.asking = true;
    const choice = await new Promise((resolve) => setCloseAsk({ name: a.project.name, resolve }));
    a.asking = false;
    setCloseAsk(null);
    if (choice === 'save') {
      if (await save()) return window.api.closeNow();
      return window.api.closeCancel();
    }
    if (choice === 'discard') {
      keepRecovery(false);
      return window.api.closeNow();
    }
    return window.api.closeCancel();
  }), []); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- Templates: use one from the store, fill its replaceable clips, or write a package for the store. ----
  const [tplAsk, setTplAsk] = useState(null); // { title, resolve }: replace an unsaved project?
  const [tplLoading, setTplLoading] = useState(null); // { title, fraction }
  const [tplNote, setTplNote] = useState(null); // { title, text, dir? }
  const applyTemplate = async (t) => {
    const a = autosave.current;
    if (!a.file && hasContent(a.project)) {
      const ok = await new Promise((resolve) => setTplAsk({ title: t.title, resolve }));
      setTplAsk(null);
      if (!ok) return false;
    } else {
      await writeFile(); // the current project keeps its last changes
    }
    setTplLoading({ title: t.title, fraction: 0 });
    const off = window.api.onTemplatesProgress(({ id, fraction }) => { if (id === t.id) setTplLoading((s) => s && { ...s, fraction }); });
    // Bundled templates ship with the app: no download, they open straight from disk.
    const res = t.bundled ? await window.api.templatesBundledUse(t.slug) : await window.api.templatesUse(t.id);
    off();
    setTplLoading(null);
    if (res.error) {
      setTplNote({ title: 'Could not open this template', text: res.error });
      return false;
    }
    a.file = null; // a new project: Save asks where
    setSaveState('new');
    setUnsavedNote(null);
    dispatch({ type: 'load', project: JSON.parse(res.json) });
    setTime(0);
    setSelection(null);
    return true;
  };
  const packTemplate = async () => {
    const p = projectRef.current;
    const meta = templateMeta(p);
    if (!meta.slots) {
      return setTplNote({ title: 'No replaceable clip yet', text: 'Right-click the clips people should swap for their own videos and choose “Make replaceable (template)”, then export the template package again.' });
    }
    const res = await window.api.templatesPack(JSON.stringify(p), meta);
    if (!res) return;
    if (res.error) return setTplNote({ title: 'Could not write the package', text: res.error });
    setTplNote({
      title: 'Template package ready',
      text: 'Last step: export this video into the same folder with the name “preview.mp4” (Export > Video). The folder is the finished template package — keep it or share it as files; anyone can open it from their own copy of ClipCraft. (Online template publishing is not part of ClipCraft 1.0.)',
      dir: res.dir,
    });
  };
  const slots = slotList(project);
  const pickSlot = (s) => {
    setSelection({ track: s.track, id: s.clip.id });
    seek(s.start + 0.01);
  };
  // Your video or photo takes the slot's place and length.
  const replaceSlot = async (s) => {
    pickSlot(s);
    const items = await window.api.importMedia();
    const [m] = addItems(items.filter((i) => i.error || i.type === 'video' || i.type === 'image').slice(0, 1));
    if (m) dispatch({ type: 'update', track: s.track, id: s.clip.id, patch: fillSlot(s.clip, m) });
  };

  // Export opens on a summary of the EFFECTIVE settings (src/exportQuality.js resolves the project's
  // stored export settings) — and that same resolved object is stamped onto the project the pipeline
  // receives, so the summary IS the export configuration, not a description of it.
  const startExport = async () => {
    const project = renderable(projectRef.current);
    if (!project.videoClips.length) return alert('Add a video or photo to the timeline before exporting.');
    setPlaying(false);
    let caps = { libx265: true };
    try { caps = await window.api.exportCaps(); } catch { /* the bundled build has libx265 */ }
    setExporting({ ready: true, eff: resolveExport(project, caps), project, caps, target: null, name: (project.name || 'export').replace(/[\\/:*?"<>|]+/g, '_') });
  };
  const confirmExport = () => {
    const { project, eff, target, name } = exporting;
    return runExportFlow(project, eff, target, name);
  };
  // The dialog's own Browse: pick the output file up front (the frame folder comes with it).
  const pickExportTarget = async (name) => {
    const prev = exporting?.target;
    const target = await window.api.exportBegin(name || exporting?.name);
    if (target.canceled) return;
    if (prev && prev.frameDir !== target.frameDir) window.api.exportAbort(prev.frameDir);
    const base = String(target.file).split(/[\\/]/).pop().replace(/\.mp4$/i, '');
    setExporting((e) => e && { ...e, target, name: base || e.name });
  };
  const renameExport = (name) => {
    setExporting((e) => {
      if (!e) return e;
      const clean = String(name).replace(/[\\/:*?"<>|]+/g, '_');
      let target = e.target;
      if (target) {
        const file = String(target.file);
        const dir = file.slice(0, file.length - file.split(/[\\/]/).pop().length);
        target = { ...target, file: `${dir}${clean || 'export'}.mp4` };
      }
      return { ...e, name: clean, target };
    });
  };
  // The dialog's quality controls write the same stored settings Project Settings writes;
  // the effective object is re-resolved so the dialog and the pipeline never diverge.
  const changeExportSettings = (patch) => {
    dispatch({ type: 'setProject', patch });
    setExporting((e) => {
      if (!e) return e;
      const project = { ...e.project, ...patch };
      return { ...e, project, eff: resolveExport(project, e.caps) };
    });
  };
  const changeExportResolution = (resCap) => {
    const s = storedExportSettings(exporting.project);
    if (s.preset !== 'custom') {
      const base = EXPORT_PRESETS[s.preset];
      changeExportSettings(settingsPatch(exporting.project, { preset: 'custom', custom: { ...base, resCap } }));
    } else {
      changeExportSettings(settingsPatch(exporting.project, { preset: 'custom', custom: { ...s.custom, resCap } }));
    }
  };
  const changePosterAt = (t) => {
    dispatch({ type: 'setProject', patch: { posterAt: t } });
    setExporting((e) => e && { ...e, project: { ...e.project, posterAt: t } });
  };
  const runExportFlow = async (project, eff, presetTarget, name) => {
    const target = presetTarget || await window.api.exportBegin(name);
    if (target.canceled) return; // stay on the form
    exportCanceled.current = false;
    // Text frames take the first part of the progress bar when the project has text.
    const textShare = project.textClips.length ? 0.35 : 0;
    // Keep project/eff/name/target on the state: the encoding view renders its spec list
    // from the same resolved object the pipeline consumes, so it must survive this transition.
    setExporting((e) => ({ ...(e || {}), ready: false, project, eff, target, name, progress: 0, stage: textShare ? 'Rendering text' : 'Encoding video' }));
    let textFrames = 0;
    try {
      textFrames = await renderTextFrames(project, target.frameDir,
        (p) => setExporting((e) => e && { ...e, progress: p * textShare }), () => exportCanceled.current);
    } catch (e) {
      await window.api.exportAbort(target.frameDir);
      return setExporting({ error: `Text rendering failed: ${e.message}` });
    }
    if (textFrames < 0) {
      await window.api.exportAbort(target.frameDir);
      return setExporting(null);
    }
    await loadProjectLuts(project);
    // Animated effects and transitions are drawn with the preview's WebGL shaders, frame by frame.
    let toExport = { ...project, export: eff, maskImages: maskImages(project), decoImages: decoImages(project), motion: motionData(project) };
    const fxShare = fxWork(project) ? 0.4 * (1 - textShare) : 0;
    if (fxShare) {
      setExporting((e) => e && { ...e, stage: 'Rendering effects' });
      try {
        toExport = await renderFxPass(toExport, (p) => setExporting((e) => e && { ...e, progress: textShare + p * fxShare }), () => exportCanceled.current);
      } catch (e) {
        await window.api.fxClear();
        await window.api.exportAbort(target.frameDir);
        return setExporting({ error: `Effect rendering failed: ${e.message}` });
      }
      if (!toExport) {
        await window.api.fxClear();
        await window.api.exportAbort(target.frameDir);
        return setExporting(null);
      }
    }
    setExporting((e) => e && { ...e, stage: 'Encoding video' });
    const base = textShare + fxShare;
    const off = window.api.onExportProgress((p) => setExporting((e) => e && { ...e, progress: base + p * (1 - base) }));
    const res = await window.api.exportRun(toExport, target, textFrames, stickerPngs(project));
    off();
    if (res.canceled) return setExporting(null);
    if (!res.ok) return setExporting({ error: res.error });
    // Poster cover: when the user picked a cover frame, embed it as the MP4's attached picture.
    // Best-effort by design — a failed embed never fails the export; the done card says so.
    let size = res.size;
    let coverNote = null;
    if (typeof project.posterAt === 'number') {
      try {
        const layout = videoLayout(project.videoClips);
        const slot = layout.find((l) => !l.clip.gap && project.posterAt >= l.start && project.posterAt <= l.end);
        const media = slot && project.media.find((m) => m.id === slot.clip.mediaId);
        if (media && (media.type === 'video' || media.type === 'image')) {
          const at = media.type === 'video' ? (slot.clip.in || 0) + (project.posterAt - slot.start) * (slot.clip.speed || 1) : 0;
          const cov = await window.api.exportCover(res.file, media.path, at);
          if (cov.ok) { if (cov.size) size = cov.size; }
          else coverNote = 'The cover picture could not be embedded — the video itself is complete.';
        }
      } catch { coverNote = 'The cover picture could not be embedded — the video itself is complete.'; }
    }
    setExporting({ done: true, file: res.file, size, coverNote, progress: 1 });
  };
  const exportCanceled = useRef(false);
  const cancelExport = () => {
    exportCanceled.current = true;
    window.api.cancelExport();
  };

  // Hook used by the automated smoke test (electron/smoke.cjs).
  useEffect(() => {
    window.__fve = {
      load: (p) => dispatch({ type: 'load', project: p }),
      seek,
      play: () => setPlaying(true),
      pause: () => setPlaying(false),
      select: setSelection,
      tab: setTab,
      dispatch,
      exportData: () => {
        const p = renderable(projectRef.current);
        return { project: { ...p, maskImages: maskImages(p), decoImages: decoImages(p), motion: motionData(p) }, pngs: stickerPngs(p) };
      },
      // Test hook: exports immediately (no summary gate), resolving settings the same way.
      exportNow: () => { const p = renderable(projectRef.current); return runExportFlow(p, resolveExport(p)); },
      fxSelfTest: async () => (await import('./fx/selftest.js')).fxSelfTest(),
      duration: () => projectDuration(projectRef.current),
      // Test helper: give clips that name a template the template's full style (clip values win).
      applyTemplates: () => {
        const p = projectRef.current;
        const textClips = p.textClips.map((c) => {
          const t = TEXT_TEMPLATES.find((x) => x.id === c.template);
          return t ? { ...t.patch, ...c } : c;
        });
        dispatch({ type: 'load', project: { ...p, textClips } });
      },
    };
  }, [seek]);
  const startExportRef = useRef(null);
  startExportRef.current = startExport;
  // What CraftAI can do beyond project actions: add a file it fetched (library sound, stock clip, voice-over)
  // to the media library, start the export, check font names.
  const pilotApp = {
    addProbed: (res) => {
      if (!res?.path) return null;
      const m = projectRef.current.media.find((x) => x.path === res.path);
      return m || addItems([res])[0] || null;
    },
    startExport: () => startExportRef.current(),
    fontIds: () => allFonts().map((f) => f.id),
  };
  const projectRef = useRef(project);
  projectRef.current = project;
  const historyRef = useRef(state);
  historyRef.current = state;
  // After the assistant dispatches edits, wait for React to render them so the next tool reads the new project.
  const settle = useCallback(() => new Promise((r) => setTimeout(r, 60)), []);

  // Keyboard shortcuts (CapCut-like).
  const keys = useRef({});
  keys.current = { togglePlay, split, remove, duplicate, seek, time, trimSide, toggleMarker, setTool, copy, cut, paste, extractAudio, save };
  useEffect(() => {
    const onKey = (e) => {
      const k = keys.current;
      const key = e.key.toLowerCase();
      // Ctrl+S saves (Ctrl+Alt+S: save as), even while typing in a field.
      if (e.ctrlKey && !e.shiftKey && key === 's') { e.preventDefault(); k.save(e.altKey); return; }
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
      if (e.code === 'Space') { e.preventDefault(); k.togglePlay(); }
      else if ((e.ctrlKey && key === 'b') || (key === 's' && !e.ctrlKey)) { e.preventDefault(); k.split(); }
      else if (e.ctrlKey && key === 'd') { e.preventDefault(); k.duplicate(); }
      else if (e.ctrlKey && e.shiftKey && key === 's') { e.preventDefault(); k.extractAudio(); }
      else if (e.ctrlKey && key === 'c') k.copy();
      else if (e.ctrlKey && key === 'x') k.cut();
      else if (e.ctrlKey && key === 'v') k.paste();
      else if (e.key === 'Delete' || e.key === 'Backspace') k.remove();
      else if (e.ctrlKey && key === 'z') dispatch({ type: e.shiftKey ? 'redo' : 'undo' });
      else if (e.ctrlKey && key === 'y') dispatch({ type: 'redo' });
      else if (e.key === 'ArrowLeft') k.seek(k.time - (e.shiftKey ? 1 : 1 / 30));
      else if (e.key === 'ArrowRight') k.seek(k.time + (e.shiftKey ? 1 : 1 / 30));
      else if (e.key === 'Home') k.seek(0);
      else if (key === 'q' && !e.ctrlKey) k.trimSide('left');
      else if (key === 'w' && !e.ctrlKey) k.trimSide('right');
      else if (key === 'm' && !e.ctrlKey) k.toggleMarker();
      else if (key === 'b' && !e.ctrlKey) k.setTool('razor');
      else if ((key === 'v' && !e.ctrlKey) || e.key === 'Escape') k.setTool('select');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (screen === 'home') {
    return (
      <div className="app home-app">
        <HomeScreen recents={recents} onNew={startNewProject} onOpen={open} onOpenRecent={openRecent}
          onRemoveRecent={removeRecent} onImportMedia={importFromHome}
          onStartTemplate={startFromTemplate} onRecordStart={startRecording}
          unsavedNote={unsavedNote}
          onRestoreUnsaved={() => {
            dispatch({ type: 'load', project: unsavedNote.project });
            autosave.current.pendingRestore = false;
            setUnsavedNote(null);
            setScreen('editor');
          }}
          onDiscardUnsaved={() => { autosave.current.pendingRestore = false; keepRecovery(false); setUnsavedNote(null); }} />
        {closeAsk && <CloseDialog name={closeAsk.name} onChoice={closeAsk.resolve} />}
      </div>
    );
  }

  return (
    <div className={`app ${dragOver ? 'drag-over' : ''}`} style={{ gridTemplateRows: `48px minmax(0, 1fr) ${panes.bottom}px` }}
      onDragOver={(e) => { e.preventDefault(); if (isFiles(e) && !isInternal(e)) setDragOver(true); }}
      onDragLeave={(e) => { if (e.target === e.currentTarget) setDragOver(false); }}
      onDrop={onDrop}>
      <TopBar project={project} dispatch={dispatch} onOpen={open} onSave={save} saveState={saveState} onExport={startExport} onExportAudio={(f) => exportAudio(f)} onExportTemplate={packTemplate} onSettings={() => setSettingsOpen(true)}
        onHome={() => setScreen('home')}
        onAbout={() => setAboutOpen(true)} updateReady={!!update?.newer} />

      <div className="workspace" style={{ gridTemplateColumns: `${panes.left}px minmax(0, 1fr) ${panes.right}px` }}>
        <LeftPanel tab={tab} setTab={setTab} media={project.media} dispatch={dispatch}
          onImport={importMedia} onAdd={addToTimeline} onAddAsOverlay={addAsOverlay} onLibraryAdd={libraryAdd} onStockAdd={stockAdd} onAddFile={addFile} stockKey={stockKey} onUseTemplate={applyTemplate} onTtsAdd={ttsAdd} selectedText={selectedText} onOpenSettings={() => setSettingsOpen(true)}
          onOpenSettings={() => setSettingsOpen(true)} onRemoveMedia={removeMedia} onPeek={peek} peekId={peekId}
          recorder={recorder} onStartRecord={() => recorder.start(time)} onAddText={addText} onAddOverlay={addOverlay} onAddSticker={stickerAdd}
          onRecordScreen={() => { setPlaying(false); setScreenOpen(true); }}
          target={target} updateTarget={updateTarget} selectedCount={selectedPictures(project, selection).length}
          onApplyLookToAll={(clip) => dispatch({ type: 'updateMany', updates: [
            ...project.videoClips.filter((c) => !c.gap).map((c) => ({ track: 'video', id: c.id, patch: { grade: { ...(clip.grade || {}) }, adjust: { ...(clip.adjust || {}) } } })),
            ...(project.overlayClips || []).map((c) => ({ track: 'overlay', id: c.id, patch: { grade: { ...(clip.grade || {}) }, adjust: { ...(clip.adjust || {}) } } })),
          ] })}
          clipSelected={selection?.track === 'video' || selection?.track === 'overlay'}
          onAddFreeEffect={(fx) => { const clipId = uid(); dispatch({ type: 'addEffectClip', clipId, fx, at: time }); setSelection({ track: 'effect', id: clipId }); }}
          project={project} captions={{ ...captions, run: runCaptions }} />
        <Preview project={playProject} editProject={project} selection={selection} onSelect={setSelection} dispatch={dispatch} time={time} seekVer={seekVer} playing={playing} duration={duration}
          onTime={setTime} onEnd={() => setPlaying(false)} onTogglePlay={togglePlay} onSeek={seek} onDropItem={dropOnPreview}
          peek={project.media.find((m) => m.id === peekId)} onClosePeek={() => setPeekId(null)}
          onAddPeek={(id) => { setPeekId(null); addToTimeline(id); }}
          quality={quality} onQualityChange={async (q) => { const st = await window.api.qualitySet(q); setPlaybackQuality(st.quality); setQuality(st.quality); }}
          clockRef={clockRef} />
        <Inspector project={project} selection={selection} dispatch={dispatch} duration={duration} time={time} onSeek={seek} />
        <Splitter which="left" style={{ left: panes.left }} onStart={startResize} onReset={resetSize} onNudge={nudgeSize} label="Resize the left panel" />
        <Splitter which="right" style={{ right: panes.right }} onStart={startResize} onReset={resetSize} onNudge={nudgeSize} label="Resize the properties panel" />
      </div>
      <Splitter which="bottom" style={{ bottom: panes.bottom + 6 }} onStart={startResize} onReset={resetSize} onNudge={nudgeSize} label="Resize the timeline" />

      <Timeline project={project} time={time} duration={duration} selection={selection} clockRef={clockRef} playing={playing}
        onSelect={setSelection} onSeek={seek} dispatch={dispatch}
        onSplit={split} onDelete={remove} onDuplicate={duplicate}
        tool={tool} setTool={setTool} onTrimSide={trimSide} onMarker={toggleMarker} recorder={recorder} onToggleRecord={toggleRecording}
        onDropItem={dropItem} onDropFiles={dropFiles} canUndo={!!state.past.length} canRedo={!!state.future.length} onClipMenu={openClipMenu} onAddText={addText}
        overlay={slots.length > 0 && <SlotStrip slots={slots} media={project.media} selection={selection} onPick={pickSlot} onReplace={replaceSlot} title={project.template?.title} />} />
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems(menu)} onClose={() => setMenu(null)} />}

      {(screenOpen || screenRec.active) && <ScreenRecordDialog rec={screenRec} at={time} onClose={() => setScreenOpen(false)} />}
      {recoveredNote && (
        <div className="recovered-note" role="status">
          <b>ClipCraft had a problem and restarted its window.</b> Your project was restored as it was a second before.
          <button className="btn btn-sm" onClick={() => window.api.openCrashLog()}>Show crash log</button>
          <button className="icon-btn" aria-label="Close" onClick={() => setRecoveredNote(false)}>×</button>
        </div>
      )}
      {unsavedNote && !recoveredNote && (
        <div className="recovered-note" role="status">
          <span><b>Your last project was not saved.</b> It was kept on this PC ({new Date(unsavedNote.savedAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}).</span>
          <button className="btn btn-primary btn-sm" onClick={() => {
            dispatch({ type: 'load', project: unsavedNote.project });
            autosave.current.pendingRestore = false;
            setUnsavedNote(null);
          }}>Restore</button>
          <button className="btn btn-sm" onClick={() => { autosave.current.pendingRestore = false; keepRecovery(false); setUnsavedNote(null); }}>Discard</button>
        </div>
      )}
            {!updateSeen && !aboutOpen && <UpdateNotice update={update} onDismiss={() => setUpdateSeen(true)} />}
      {aboutOpen && <AboutDialog update={update} onUpdate={setUpdate} onClose={() => { setAboutOpen(false); setUpdateSeen(true); }} />}
      {closeAsk && <CloseDialog name={closeAsk.name} onChoice={closeAsk.resolve} />}
      {seqAsk && <SequenceDialog media={seqAsk.media} mismatch={seqAsk.mismatch}
        onChangeSettings={() => resolveSeq(true)} onKeepSettings={() => resolveSeq(false)} />}
      {tplAsk && (
        <ConfirmDialog icon={LayoutTemplate} title={`Use “${tplAsk.title}”?`} confirmLabel="Use template"
          text="Your current project was never saved. The template replaces it, and its changes are lost."
          onConfirm={() => tplAsk.resolve(true)} onCancel={() => tplAsk.resolve(false)} />
      )}
      {tplLoading && (
        <div className="modal-backdrop close-backdrop" role="dialog" aria-modal="true" aria-label="Opening the template">
          <div className="modal">
            <div className="modal-icon"><Loader2 size={26} className="spin" /></div>
            <h3>Opening “{tplLoading.title}”…</h3>
            <div className="progress big" aria-live="polite"><div style={{ width: `${(tplLoading.fraction * 100).toFixed(1)}%` }} /></div>
            <p className="pct">{Math.round(tplLoading.fraction * 100)}%</p>
          </div>
        </div>
      )}
      {tplNote && (
        <ConfirmDialog icon={LayoutTemplate} title={tplNote.title} text={tplNote.text} onConfirm={() => setTplNote(null)}
          extra={tplNote.dir && <p className="muted path">{tplNote.dir}</p>}
          cancelLabel="Show folder" onCancel={tplNote.dir ? () => { window.api.openFolder(tplNote.dir); setTplNote(null); } : undefined} />
      )}
      {settingsOpen && <SettingsDialog onClose={() => { setSettingsOpen(false); setSettingsVersion((v) => v + 1); }}
        onProxiesCleared={(deleted) => projectRef.current.media.forEach((m) => {
          if (m.lightProxy && deleted.includes(m.lightProxy)) dispatch({ type: 'mediaVisuals', path: m.path, patch: { lightProxy: null } });
          if (m.proxies) {
            const proxies = Object.fromEntries(Object.entries(m.proxies).map(([k, v]) => [k, deleted.includes(v) ? null : v]));
            if (JSON.stringify(proxies) !== JSON.stringify(m.proxies)) dispatch({ type: 'mediaVisuals', path: m.path, patch: { proxies } });
          }
        })} />}
      <CraftAI getProject={() => projectRef.current} getHistoryLength={() => historyRef.current.past.length}
        dispatch={dispatch} settle={settle} onOpenSettings={() => setSettingsOpen(true)} settingsVersion={settingsVersion}
        app={pilotApp} />
      {dragOver && <div className="drop-overlay"><div>Drop files to import them</div></div>}
      {renderJob && (
        <div className="render-job" role="status">
          {renderJob.error ? (
            <><CircleAlert size={15} /><span>{renderJob.error}</span>
              <button className="btn btn-sm" onClick={() => setRenderJob(null)}>Dismiss</button></>
          ) : (
            <><Loader2 size={15} className="spin" /><span>{renderJob.label}</span>
              <div className="progress render-job-bar"><div style={{ width: `${Math.round((renderJob.fraction || 0) * 100)}%` }} /></div>
              <button className="btn btn-sm btn-ghost" onClick={() => window.api.reverseCancel()}>Cancel</button></>
          )}
        </div>
      )}
      {exporting && <ExportDialog state={exporting} onCancel={cancelExport} onStart={confirmExport}
        onClose={() => setExporting(null)} onShow={() => window.api.showInFolder(exporting.file)}
        onOpen={() => window.api.openFile(exporting.file)} onPickTarget={pickExportTarget}
        onRename={renameExport} onSettings={changeExportSettings} onResolution={changeExportResolution}
        onPosterAt={changePosterAt} />}
    </div>
  );
}

// Draggable border between panels (double-click: default size, arrow keys: move).
function Splitter({ which, style, onStart, onReset, onNudge, label }) {
  const vertical = which !== 'bottom';
  return (
    <div className={`splitter ${vertical ? 'col' : 'row'}`} style={style} role="separator" tabIndex={0}
      aria-orientation={vertical ? 'vertical' : 'horizontal'} aria-label={label} title={`${label}\nDrag to resize, double-click to reset`}
      onPointerDown={(e) => onStart(which, e)} onDoubleClick={() => onReset(which)} onKeyDown={(e) => onNudge(which, e)} />
  );
}
