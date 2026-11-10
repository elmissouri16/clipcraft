import { useMemo, useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { createTimelineAttachment } from '../features/agent/timelineContext.js';
import { recentEntryFor } from './recents.js';
import { LAYERED, canvasFor, clipLayer, emptyProject, exportDuration, findClipIn, findLinkPartner, freeLen, historyReducer, isLayerLocked, layerCount, layerFree, layerName, layerOf, levelCopyState, lockedMediaUse, markerNear, normalizeProject, parseEffectKey, pickAttributes, projectDuration, renderable, setPlaybackQuality, toFileUrl, trimActions, uid, videoClipAt, videoLayout } from "../state/store.js";
import HomeScreen, { PRESETS } from './components/HomeScreen.jsx';
import { ExternalAgentApproval, ExternalAgentBadge } from './components/ExternalAgent.jsx';
import { useExternalAgent } from './useExternalAgent.js';
import SequenceDialog from "../features/timeline/components/SequenceDialog.jsx";
import { mismatchFor, sequencePatchFor } from "../features/timeline/sequence.js";
import { sizeFor } from "../features/effects/effects.js";
import { filterFx, isFilterFx } from "../features/effects/filters.js";
import ContextMenu from "../components/ui/ContextMenu.jsx";
import {
  MessageSquarePlus, ScanLine, AudioLines, CircleAlert, ClipboardPaste, Copy, CopyPlus, Crop, Crosshair, Eraser, Eye, EyeOff, FileAudio, FlipHorizontal2, Gauge, Info, Layers, Link2, ListChecks, Loader2, Paintbrush, PanelBottom, Pin, PinOff, Pipette, Repeat, Rewind, RotateCcw, RotateCw, Scissors, ScissorsLineDashed, Snowflake, Sparkles, Split, Trash2, Unlink,
} from 'lucide-react';
import { fillSlot, slotList } from "../features/templates/templates.js";
import SlotStrip from "../features/templates/components/SlotStrip.jsx";
import { useRecorder } from "../features/recording/useRecorder.js";
import { useLayout } from './useLayout.js';
import { customMaskImages, decoImages, maskImages } from "../features/preview/visual.js";
import { clipStartTl, motionDataPinned, trackedClips } from "../features/timeline/track.js";
import { CROP_ASPECTS, aspectRatioOf, cropForAspect } from "../features/preview/cropMath.js";
import { chromaOf, cropOf, transformOf } from "../features/preview/visual.js";
import { isLookPatch, lookAction, selectedPictures } from "../features/effects/look.js";
import { regroupSegments } from "../features/text/subtitles.js";
import { loadProjectLuts, onLutLoaded } from "../features/effects/lut.js";
import LeftPanel from "../features/library/components/LeftPanel.jsx";
import Preview from "../features/preview/components/Preview.jsx";
import Timeline, { makeSelection } from "../features/timeline/components/Timeline.jsx";
import SpeedDialog from "../features/timeline/components/SpeedDialog.jsx";
import Inspector from "../features/inspector/components/Inspector.jsx";
import ExportDialog from "../features/export/components/ExportDialog.jsx";
import { EXPORT_PRESETS, resolveExport, settingsPatch, storedExportSettings } from "../features/export/exportQuality.js";
import { exportRenderPlan } from '../features/export/renderPlan.js';
import { agentExportPlan } from '../features/export/agentExport.js';
import { ExportProgress, exportStages, readExportProfile } from '../features/export/exportProgress.js';
import { serializeProject } from '../state/projectSerialization.js';
import CloseDialog from './components/CloseDialog.jsx';
import TopBar from './components/TopBar.jsx';
import SettingsDialog from './components/SettingsDialog.jsx';
import { actionFor, setActiveKeymap, WORKS_IN_FIELDS } from './keymap.js';
import { showAlert, askConfirm } from './dialogs.js';
import { AboutDialog, UpdateNotice, useUpdateCheck } from './components/About.jsx';
import WelcomeCard from './components/WelcomeCard.jsx';
import ScreenRecordDialog from "../features/recording/components/ScreenRecordDialog.jsx";
import { useScreenRecorder } from "../features/recording/useScreenRecorder.js";
import CraftAI from "../features/agent/components/CraftPilot.jsx";
import { hasChatContent } from "../features/agent/chatSessions.js";
import { isFiles, isInternal } from "../features/timeline/dnd.js";
import { renderTextFrames } from "../features/export/exportText.js";
import { fxWork, renderFxPass } from "../features/export/fxExport.js";
import { TEXT_TEMPLATES } from "../features/text/catalog.js";
import { allFonts } from "../features/text/fonts.js";
import { graphicOutdated, isGraphicMedia, redrawGraphicAction, renderGraphicMedia } from '../features/graphics/graphicMedia.js';
import { graphicEdits } from '../features/graphics/graphicEdits.js';

// (The emoji-to-PNG rasterizer that lived here served only the Stickers feature, removed
// in R1 — emoji inside TEXT clips render through the text pipeline, not this helper.)

export default function App() {
  const [state, reduceDispatch] = useReducer(historyReducer, { past: [], present: emptyProject(), future: [] });
  const [projectLoadVersion, setProjectLoadVersion] = useState(0);
  const loadVersionRef = useRef(projectLoadVersion);
  loadVersionRef.current = projectLoadVersion;
  const dispatch = useCallback((action) => {
    // Opening a saved file can replace the same project id. Remount its chat too,
    // so the file's conversations win over the previous in-memory copy.
    if (action.type === 'load') {
      setProjectLoadVersion((n) => n + 1);
      setPlaying(false);setTime(0);clockRef.current.playing = false;
    }
    reduceDispatch(action);
  }, []);
  const project = state.present;
  const [time, setEditorTime] = useState(0);
  // Shared playback clock: Preview (writer) publishes { time, stamp, playing, rate } every
  // frame; the Timeline playhead reads it directly so it glides without React re-renders.
  const clockRef = useRef({ time: 0, stamp: 0, playing: false, rate: 1 });
  const readTime = useCallback(() => clockRef.current.time, []);
  const setTime = useCallback(value => {
    clockRef.current = { ...clockRef.current, time: value, stamp: performance.now(), controlVersion: (clockRef.current.controlVersion || 0) + 1 };
    setEditorTime(value);
  }, []);
  const [playing, setPlaying] = useState(false);
  const [selection, setSelection] = useState(null); // { track, id }
  // Selection as the timeline and the preview see it: linked pairs (Detach audio) select
  // together, and clips on locked layers cannot be selected at all.
  const select = useCallback((sel) => {
    if (!sel) return setSelection(null);
    const p = projectRef.current;
    const items = sel.items ? [...sel.items] : [{ track: sel.track, id: sel.id }];
    const have = new Set(items.map((i) => `${i.track}:${i.id}`));
    for (const it of [...items]) {
      const c = findClipIn(p, it.track, it.id);
      const partner = c && findLinkPartner(p, c);
      if (partner && !have.has(`${partner.track}:${partner.clip.id}`)) {
        items.push({ track: partner.track, id: partner.clip.id });
        have.add(`${partner.track}:${partner.clip.id}`);
      }
    }
    const kept = items.filter((it) => {
      const c = findClipIn(p, it.track, it.id);
      return !c || !isLayerLocked(p, it.track, clipLayer(it.track, c));
    });
    setSelection(kept.length ? makeSelection(kept) : null);
  }, []);
  const [exporting, setExporting] = useState(null);
  const [agentRendering,setAgentRendering] = useState(false);
  const [agentRun, setAgentRun] = useState(null);
  const agentRunRef = useRef(agentRun);
  agentRunRef.current = agentRun;
  // Timeline spotlight and trail (docs/agents/agent-editing.md): what CraftAI works on now and what it
  // changed this request. Outside the history reducer: it never makes an Undo step or revokes the agent.
  // The run's end starts a 6 s hold, then a fade; a history move afterwards (undo, redo, load) clears it.
  const [agentFocus, setAgentFocus] = useState(null);
  // An outside MCP agent (useExternalAgent) feeds the same state, so its edits show the same way.
  const onAgentFocus = useCallback((next) => setAgentFocus((prev) => (next ? { ...next, ended: false, fading: false } : prev && !prev.ended ? { ...prev, live: null, ended: true } : prev)), []);
  useEffect(() => {
    if (!agentFocus?.ended) return undefined;
    const fade = setTimeout(() => setAgentFocus((f) => (f && f.ended ? { ...f, fading: true } : f)), 6000);
    const clear = setTimeout(() => setAgentFocus((f) => (f && f.ended ? null : f)), 6400);
    return () => { clearTimeout(fade); clearTimeout(clear); };
  }, [agentFocus?.ended, agentFocus?.requestId]);
  const focusHistory = useRef(null), focusEnded = useRef(false);
  useEffect(() => {
    const key = `${state.past.length}:${state.future.length}:${projectLoadVersion}`, ended = !!agentFocus?.ended;
    // Only a move after the end counts: an external edit commits its Undo step in the render that ends it.
    if (ended && focusEnded.current && focusHistory.current !== null && focusHistory.current !== key) setAgentFocus(null);
    focusHistory.current = key; focusEnded.current = ended;
  }, [state.past.length, state.future.length, projectLoadVersion, agentFocus?.ended]);
  const exportBusy = agentRendering || (!!exporting && !exporting.ready && !exporting.done && !exporting.error);
  useEffect(() => {
    window.api.foregroundWork?.({ playing, exporting: exportBusy }).catch(() => {});
  }, [playing, exportBusy]);
  const [renderJob, setRenderJob] = useState(null); // derivative renders: { kind: 'reverse' | 'detach', label, fraction } | { error }
  const [trackPick, setTrackPick] = useState(null); // motion tracking pick mode: { track, id, point: {x,y} | null, box: {w,h} }
  const [cropEdit, setCropEdit] = useState(null); // visual crop mode: { track, id, snapshot: { crop, cropAspect } }
  const [tab, setTab] = useState('media');
  const [workspaceMode, setWorkspaceMode] = useState(() => {
    try { return localStorage.getItem('clipcraft.workspaceMode') === 'agent' ? 'agent' : 'edit'; } catch { return 'edit'; }
  });
  const agentMode = workspaceMode === 'agent';
  const [agentDrawer, setAgentDrawer] = useState(null);
  useEffect(() => { try { localStorage.setItem('clipcraft.workspaceMode', workspaceMode); } catch {} }, [workspaceMode]);
  const { layout: panes, startDrag: startResize, reset: resetSize, nudge: nudgeSize, setRightCollapsed, setBottom: setTimelineHeight } = useLayout(workspaceMode, !!agentDrawer);
  const [tool, setTool] = useState('select'); // timeline tool: 'select' | 'razor'
  const [clipboard, setClipboard] = useState(null); // { track, clip } for copy / cut / paste
  const [attrClipboard, setAttrClipboard] = useState(null); // copied look and placement
  const [timelineContextRequest, setTimelineContextRequest] = useState(null);
  const [menu, setMenu] = useState(null); // right-click menu: { x, y, track, id }
  const [speedAsk, setSpeedAsk] = useState(null); // clip whose Speed / Duration dialog is open: { track, id }
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [quality, setQuality] = useState('full'); // Playback quality: which scaled copy the player uses
  const [aboutOpen, setAboutOpen] = useState(false);
  // ---- First run: the welcome card shows exactly once (flag in settings.json via
  // firstrun IPC); About replays the card on demand. ----
  // B3 (2026-11-01): the multi-step tour became this single card. The persisted flag
  // keeps its name (tourSeen) so profiles that already saw the tour count as seen and
  // never get the card; the trigger and the dismissal chain are unchanged.
  const [welcomeOpen, setWelcomeOpen] = useState(false);
  // W6 (2026-11-01): the first-run surface no longer fires at app launch on the Home
  // screen. It starts the first time the user ENTERS a project (the editor), once
  // only. tourSeen stays null until the persisted flags load, so a fast first click
  // can't slip past it either way.
  const [tourSeen, setTourSeen] = useState(null);
  // The first-run flow is the Welcome card only — nothing chains after it.
  useEffect(() => {
    let alive = true;
    Promise.resolve(window.api.firstRunGet?.()).then((f) => {
      if (!alive || !f) return;
      setTourSeen(!!f.tourSeen);
    }).catch(() => {});
    return () => { alive = false; };
  }, []);
  const closeWelcome = useCallback(() => {
    setWelcomeOpen(false);
    setTourSeen(true);
    window.api.firstRunSet?.({ tourSeen: true }).catch(() => {});
  }, []);
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
  // On top of that, EVERY project is kept in its own autosave slot (electron/project/autosave.cjs, keyed by
  // project.id): Home lists the slots next to the file recents, so leaving a project — Home, a new
  // project, another open — never strands it. Switching flushes the slot first (flushAutosave).
  const autosave = useRef({ timer: null, project, file: null, fileTimer: null, writing: null, slotTimer: null });
  autosave.current.project = project;
  const [saveState, setSaveState] = useState('new'); // 'new' | 'saving' | 'saved' | 'error'
  const [unsavedNote, setUnsavedNote] = useState(null); // { savedAt, project } left by a session that ended unsaved
  const [closeAsk, setCloseAsk] = useState(null); // { name, resolve }: the "Save before closing?" question
  // ---- Home screen + recent projects (localStorage 'clipcraft.recents') ----
  const [screen, setScreen] = useState('home'); // 'home' | 'editor'
  const screenRef = useRef(screen);
  screenRef.current = screen;
  // W6 deferred welcome trigger: the first entry into the editor with the first-run
  // surface unseen opens the welcome card (declared here, after `screen`). The pack
  // prompt is NOT moved — it still chains off closeWelcome, exactly as before.
  useEffect(() => {
    if (screen === 'editor' && tourSeen === false && !welcomeOpen) setWelcomeOpen(true);
  }, [screen, tourSeen, welcomeOpen]);
  const [recents, setRecents] = useState(() => {
    try { return JSON.parse(localStorage.getItem('clipcraft.recents') || '[]'); } catch { return []; }
  });
  const recentsRef = useRef(recents);
  recentsRef.current = recents;
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
    || (p.overlayClips || []).length || hasChatContent(p));
  const keepRecovery = async (unsaved) => {
    const { project, file } = autosave.current;
    const version = autosave.current.recoveryVersion = (autosave.current.recoveryVersion || 0) + 1;
    try {
      const { compact } = await serializeProject(project);
      if (version !== autosave.current.recoveryVersion) return;
      localStorage.setItem('clipcraft.recovery', `{"savedAt":${Date.now()},"project":${compact},"file":${JSON.stringify(file || null)},"unsaved":${!!unsaved}}`);
    } catch {
      // storage full: the next save tries again
    }
  };
  const writeFile = async () => {
    const a = autosave.current;
    clearTimeout(a.fileTimer);
    a.fileTimer = null;
    if (!a.file) return true;
    const file = a.file, project = a.project;
    setSaveState('saving');
    let ok = false;
    try {
      const previous = a.writing || Promise.resolve();
      a.writing = previous.catch(() => {}).then(async () => {
        const { pretty } = await serializeProject(project);
        return window.api.autosaveProject(file, pretty);
      });
      ok = await a.writing;
    } catch { /* The save-state pill reports the failed attempt. */ }
    setSaveState(ok ? 'saved' : 'error');
    return ok;
  };
  // ---- Per-project autosave slots: Home's switchboard ----
  const [autoSlots, setAutoSlots] = useState([]);
  const refreshSlots = () => {
    window.api.slotList?.().then((l) => { if (Array.isArray(l)) setAutoSlots(l); }).catch(() => {});
  };
  useEffect(() => { refreshSlots(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (screen === 'home') refreshSlots(); }, [screen]); // eslint-disable-line react-hooks/exhaustive-deps
  // Legacy namespace: the pre-B3 tour's scratch projects carried 'tour-' ids. None are
  // created any more, but ones saved by users still exist — they never get a slot, so
  // they can never pollute the Home list.
  const isTourId = (id) => typeof id === 'string' && id.startsWith('tour-');
  // The slot record for a project (defaults: the one in the editor). A project earns a slot
  // once it has content, or from the start when it is file-backed; a pristine empty project
  // has nothing to lose and stays slotless until the first real edit.
  const slotRecord = async (p = autosave.current.project, file = autosave.current.file) => {
    if (!p || !p.id || isTourId(p.id)) return null;
    if (!file && !hasContent(p)) return null;
    const e = recentEntryFor(p, file || '', toFileUrl);
    const { compact } = await serializeProject(p);
    return { id: p.id, title: p.name || 'Untitled', file: file || null, ratio: p.ratio || '', thumb: e.thumb, updatedAt: Date.now(), projectJson: compact };
  };
  const writeSlotNow = async (p = autosave.current.project, file = autosave.current.file) => {
    const a = autosave.current;
    clearTimeout(a.slotTimer);
    a.slotTimer = null;
    try {
      a.slotWriting = (a.slotWriting || Promise.resolve()).catch(() => {}).then(async () => {
        const rec = await slotRecord(p, file);if (!rec) return;
        await window.api.slotWrite(rec);refreshSlots();
      });
      await a.slotWriting;
    } catch { /* the next change retries */ }
  };
  // Force-write everything pending for the CURRENT project (its file, then its slot) —
  // awaited before any switch (Home, new, open) so no edit hides inside a debounce window.
  const flushAutosave = async () => {
    await writeFile();
    await writeSlotNow();
  };
  // Opening a project FILE adopts the id of the slot bound to that file (if any), so the
  // file and its slot stay one identity; the caller then rewrites the slot from the file's
  // content (at open time the file wins — it is what the user chose to open).
  const adoptFileBinding = async (p, file) => {
    if (!file) return p;
    try {
      const entry = await window.api.slotForFile(file);
      return entry?.id ? { ...p, id: entry.id } : p;
    } catch { return p; }
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
    // The project's own autosave slot, a second after the last change (true debounce:
    // thumbnail arrivals keep pushing it out, the write always carries the latest state).
    clearTimeout(a.slotTimer);
    a.slotTimer = setTimeout(() => { a.slotTimer = null; writeSlotNow(); }, 1000);
  }, [project]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const startupProject = autosave.current.project;
    let saved = null;
    try {
      saved = JSON.parse(localStorage.getItem('clipcraft.recovery') || 'null');
    } catch {
      // nothing usable saved
    }
    window.api.wasRecovered?.().then(async (was) => {
      // The recovery snapshot lives in localStorage, whose commits lag behind the
      // edits (and a hard kill can lose the last one). The project's autosave slot is
      // written to disk on the same cadence, atomically — so when a slot exists for
      // the snapshot's project, the slot's state is the recovery payload: the exact
      // project that was open, at its freshest state.
      let snap = saved;
      let hasAutosavedSlot = false;
      const pid = saved?.project?.id;
      if (pid && !isTourId(pid)) {
        try {
          const slot = await window.api.slotRead?.(pid);
          if (slot?.project) {
            hasAutosavedSlot = true;
            snap = { savedAt: slot.updatedAt || saved.savedAt, project: slot.project, file: slot.file || null, unsaved: saved.unsaved };
          }
        } catch { /* slot unreadable: the snapshot stands */ }
      }
      // Startup IO must not replace or prompt over a project already opened/imported.
      if (autosave.current.project !== startupProject) return;
      if (snap?.project) {
        try { snap = { ...snap, project: normalizeProject(snap.project) }; }
        catch { return; } // A corrupt recovery record must not prevent startup.
      }
      if (was && snap?.project) {
        // The window crashed and reloaded: same project, same file.
        autosave.current.file = snap.file || null;
        if (snap.file) setSaveState('saved');
        dispatch({ type: 'load', project: snap.project });
        setRecoveredNote(true);
        setScreen('editor');
      } else if (!hasAutosavedSlot && snap?.unsaved && snap.project && hasContent(snap.project)) {
        // Normal autosaved projects already have a resumable Home card. Only an
        // older recovery copy without a disk slot needs a separate offer.
        autosave.current.pendingRestore = true;
        setUnsavedNote(snap);
      }
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Thumbnails / waveforms are generated in the background after import.
  useEffect(() => window.api.onMediaVisuals(({ path, ...patch }) => dispatch({ type: 'mediaVisuals', path, patch })), []);
  // When a video thumbnail lands for the project that backs a recents entry, refresh that
  // entry's poster in place (no reorder, no date change). Degrades silently otherwise.
  const firstVideoThumb = (project.media || []).find((m) => m.type === 'video' && m.thumb)?.thumb || null;
  const firstVideoPoster = (project.media || []).find((m) => m.type === 'video' && m.poster)?.poster || null;
  useEffect(() => {
    const f = autosave.current.file;
    if (!f || (!firstVideoThumb && !firstVideoPoster)) return;
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
  }, [firstVideoThumb, firstVideoPoster]);
  // Ask for visuals that are missing (older projects, files imported before this feature, moved caches).
  // Below Full playback quality, every video also needs its copy for the level (levelCopyState 'fallback':
  // not made yet; 'failed' is not retried). While the copy is missing the player uses a fallback file.
  const mediaKey = project.media.map((m) => `${m.path}|${m.thumbCount ? 1 : 0}|${m.poster ? 1 : 0}|${m.wave ? 1 : 0}|${m.optimizing ? 1 : 0}|${m.lightProxy == null ? 0 : 1}|${m.proxies?.[quality] == null ? 0 : 1}|${m.proxyRequired ? 1 : 0}|${m.proxyFailed ? 1 : 0}`).join(';') + `|${quality}`;
  useEffect(() => {
    const missing = project.media.filter((m) => (m.type === 'video' && (!m.thumbCount || !m.poster || m.optimizing || levelCopyState(m, quality) === 'fallback')) || (m.hasAudio && !m.wave));
    if (missing.length) {
      window.api.ensureVisuals(missing.map(({ path, type, duration, hasAudio, width, height, proxy, lightProxy, proxies, proxyRequired, proxyFailed, pixFmt, hdr, vcodec, acodec, profile }) => ({ path, type, duration, hasAudio, width, height, proxy, lightProxy, proxies, proxyRequired, proxyFailed, pixFmt, hdr, vcodec, acodec, profile })));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mediaKey]);

  // Graphics follow the canvas: a new size or frame rate draws them again, and so does opening a
  // project whose cached graphic files are gone. Not a separate Undo step (the change that caused it
  // is); during an agent request it belongs to the agent's edit instead of interrupting it.
  const graphicsKey = project.media.filter(isGraphicMedia).map((m) => m.id).join(',');
  // The cache never removes the graphics this project uses.
  const graphicCacheKeys = project.media.filter(isGraphicMedia).map((m) => m.graphic?.key).filter(Boolean).join(',');
  useEffect(() => { window.api.graphicsInUse?.(graphicCacheKeys ? graphicCacheKeys.split(',') : []); }, [graphicCacheKeys]);
  const redrawing = useRef(new Set());
  useEffect(() => graphicEdits.connect({ getProject: () => projectRef.current, getGesture: () => !!historyRef.current.gestureStart,
    dispatch, api: window.api }), []);
  const graphicDraftKey = [...project.videoClips, ...(project.overlayClips || [])].filter(c => c.graphicDraft)
    .map(c => `${c.id}:${c.mediaId}:${c.in}:${c.out}:${c.speed || 1}:${JSON.stringify(c.graphicDraft)}`).join('|');
  useEffect(() => { graphicEdits.sync(); }, [project.id, projectLoadVersion, project.width, project.height, project.fps, graphicDraftKey, !!state.gestureStart]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const graphics = projectRef.current.media.filter(isGraphicMedia);
      if (!graphics.length || !window.api.renderGraphic) return;
      const missing = new Set((await window.api.graphicsMissing?.(graphics.map((m) => ({ id: m.id, path: m.path, preview: m.proxy })))) || []);
      for (const m of graphics) {
        if (cancelled || redrawing.current.has(m.id) || !(missing.has(m.id) || graphicOutdated(m, projectRef.current))) continue;
        redrawing.current.add(m.id);
        try {
          const out = await renderGraphicMedia({ api: window.api, project: projectRef.current, code: m.graphic.code, inputs: m.graphic.inputs || {},
            fonts: m.graphic.fonts || [], duration_sec: m.duration, name: m.name, requestId: `auto-${m.id}` });
          if (out.error || !projectRef.current.media.some((x) => x.id === m.id)) continue;
          const token = historyRef.current.agentEdit?.token;
          dispatch({ ...redrawGraphicAction(projectRef.current, m, out.media), transient: true, ...(token ? { agentToken: token } : {}) });
        } finally { redrawing.current.delete(m.id); }
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id, projectLoadVersion, project.width, project.height, project.fps, graphicsKey]);

  useEffect(() => {
    window.api.captionsStatus().then((st) => setCaptions((c) => ({ ...c, installed: st.installed, models: st.models || {}, available: st.available })));
  }, []);

  const runCaptions = async (opts) => {
    setPlaying(false);
    setCaptions((c) => ({ ...c, busy: true, error: null, stage: 'Preparing', progress: 0 }));
    const off = window.api.onCaptionsProgress(({ stage, progress }) => setCaptions((c) => ({ ...c, stage, progress })));
    const { style, engine, wordsPerLine, ...engineOpts } = opts;
    // Cloud engines return the same segment shape, so everything after this call —
    // caption clips, styling, apply-to-all — is the one shared path.
    const res = engine === 'cloud'
      ? await window.api.runCaptionsCloud(project, engineOpts)
      : await window.api.runCaptions(project, engineOpts);
    off();
    if (res.ok) {
      // Words-per-line (when set) regroups the segments here, once, for every engine.
      dispatch({ type: 'setCaptions', style, segments: regroupSegments(res.segments, wordsPerLine).map((s) => ({ ...s, id: uid() })) });
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
  // Library (pack / Generated) item watched in the player before adding it — the same
  // MediaPeek surface, fed a media-shaped object that carries its own add target
  // (assetPath + assetWhere) instead of a media id (QA K2, Hamza 2026-11-01).
  const [assetPeek, setAssetPeek] = useState(null);
  const peekAsset = useCallback((item) => { setPlaying(false); setPeekId(null); setAssetPeek(item); }, []);

  const [seekVer, setSeekVer] = useState(0);
  const seek = useCallback((t) => {
    setPeekId(null);
    setTime(Math.max(0, t));
    setSeekVer((v) => v + 1);
  }, []);

  const togglePlay = useCallback(() => {
    setPeekId(null);
    if (playing) return setPlaying(false);
    if (readTime() >= duration - 0.05) setTime(0);
    if (duration > 0) setPlaying(true);
  }, [playing, time, duration]);

  const addItems = (items, agentToken) => {
    const ok = items.filter((i) => !i.error).map((i) => ({ ...i, id: uid() }));
    const bad = items.filter((i) => i.error);
    if (bad.length) showAlert('Could not import:\n' + bad.map((b) => `${b.name}: ${b.error}`).join('\n'));
    if (ok.length) dispatch({ type: 'addMedia', items: ok, ...(agentToken ? { agentToken } : {}) });
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
    const vClip = project.videoClips.find((c) => c.id === clipId);
    const clip = vClip || (project.overlayClips || []).find((c) => c.id === clipId);
    if (!clip) return;
    const track = vClip ? 'video' : 'overlay';
    let patch;
    if (payload.kind === 'filter') patch = { filter: payload.id };
    else if (payload.kind === 'effect') patch = { effects: clip.effects?.includes(payload.id) ? clip.effects : [...(clip.effects || []), payload.id] };
    else if (payload.kind === 'transition') {
      if (!vClip || project.videoClips[0].id === clipId) return; // transitions live between main-track clips only
      patch = { transition: { type: payload.id, duration: payload.duration || 0.5 } };
    }
    dispatch({ type: 'update', track, id: clipId, patch });
    setSelection({ track, id: clipId });
  };

  const dropItem = (payload, info) => {
    if (!payload) return;
    const clipId = uid();
    const layer = (lane) => (info.layerLane === lane ? info.layer : undefined); // the layer it was dropped on
    if (payload.kind === 'media') {
      const m = project.media.find((x) => x.id === payload.id);
      if (!m) return;
      if ((info.lane === 'overlay' || m.graphic) && m.type !== 'audio') {
        dispatch({ type: 'addOverlayClip', mediaId: m.id, clipId, at: info.time, layer: layer('overlay') });
        return setSelection({ track: 'overlay', id: clipId });
      }
      guardAdd(m, () => {
        dispatch({ type: 'addToTimeline', mediaId: m.id, clipId, at: info.time, index: info.index, layer: layer('audio') });
        setSelection({ track: m.type === 'audio' ? 'audio' : 'video', id: clipId });
      });
    } else if (payload.kind === 'text') {
      dispatch({ type: 'addText', clipId, at: info.time, patch: payload.patch, layer: layer('text') });
      setSelection({ track: 'text', id: clipId });
    } else if (payload.kind === 'effect' && info.lane === 'effect') {
      dispatch({ type: 'addEffectClip', clipId, fx: payload.id, at: info.time });
      setSelection({ track: 'effect', id: clipId });
    } else if (payload.kind === 'filter' && info.lane === 'effect') {
      // A filter tile on the Effects lane: a filter layer over every picture under it.
      dispatch({ type: 'addEffectClip', clipId, fx: filterFx(payload.id), at: info.time });
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
    if (payload.kind === 'media') return dropItem(payload, { time: readTime(), index: undefined });
    if (payload.kind === 'text') return dropItem(payload, { time: readTime() });
    const v = videoClipAt(project, readTime());
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
    dispatch({ type: 'addToTimeline', mediaId: m.id, clipId, at: readTime() });
    setSelection({ track: 'audio', id: clipId });
    return { ok: true };
  };

  // Text to speech: the voice goes on the Audio track where the selected text starts, or at the playhead.
  const selectedText = selection?.track === 'text' ? project.textClips.find((c) => c.id === selection.id) : null;
  const ttsAdd = (res, atText) => {
    let m = projectRef.current.media.find((x) => x.path === res.path);
    if (!m) [m] = addItems([{ ...res, origin: 'tts' }]); // Media tree: Generated ▸ Speech
    if (!m) return;
    const clipId = uid();
    dispatch({ type: 'addToTimeline', mediaId: m.id, clipId, at: atText ? selectedText.start : readTime() });
    setSelection({ track: 'audio', id: clipId });
  };

  // Stock media (Pixabay): download once, then main track or overlay at the playhead.
  const [stockKey, setStockKey] = useState(false);
  useEffect(() => {
    window.api.settingsGet().then((st) => { setStockKey(!!st.serviceKeys?.pixabay); setActiveKeymap(st.shortcuts); });
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
      dispatch({ type: 'addOverlayClip', mediaId: m.id, clipId, at: readTime() });
      setSelection({ track: 'overlay', id: clipId });
    } else {
      guardAdd(m, () => {
        const index = videoLayout(projectRef.current.videoClips).filter((l) => (l.start + l.end) / 2 < readTime()).length;
        dispatch({ type: 'addToTimeline', mediaId: m.id, clipId, index });
        setSelection({ track: 'video', id: clipId });
      });
    }
    return { ok: true };
  };

  // A favorite from disk: reuse the media item when the project has it, then add it at the playhead.
  const addFile = async (filePath, where = 'main') => {
    let m = projectRef.current.media.find((x) => x.path === filePath);
    if (!m) {
      const [res] = await window.api.probePaths([filePath]);
      if (!res || res.error) return { error: res ? `${res.name}: ${res.error}` : 'The file was not found.' };
      [m] = addItems([res]);
    }
    const clipId = uid();
    if (m.type === 'audio') {
      dispatch({ type: 'addToTimeline', mediaId: m.id, clipId, at: readTime() });
      setSelection({ track: 'audio', id: clipId });
    } else if (where === 'overlay') {
      dispatch({ type: 'addOverlayClip', mediaId: m.id, clipId, at: readTime() });
      setSelection({ track: 'overlay', id: clipId });
    } else {
      guardAdd(m, () => {
        const index = videoLayout(projectRef.current.videoClips).filter((l) => (l.start + l.end) / 2 < readTime()).length;
        dispatch({ type: 'addToTimeline', mediaId: m.id, clipId, index });
        setSelection({ track: 'video', id: clipId });
      });
    }
    return { ok: true };
  };

  // Picture-in-picture at the playhead (Media panel button).
  const addAsOverlay = (mediaId) => {
    const clipId = uid();
    dispatch({ type: 'addOverlayClip', mediaId, clipId, at: readTime() });
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
    // A motion graphic always goes over the whole frame at the playhead, never onto the main track.
    if (m?.graphic) return addAsOverlay(mediaId);
    guardAdd(m, () => {
      const clipId = uid();
      dispatch({ type: 'addToTimeline', mediaId, clipId, at: readTime() });
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
    const lockedUse = lockedMediaUse(p, id);
    if (lockedUse) { showAlert(`"${m.name}" is used by a clip on the locked layer "${layerName(p, lockedUse.track, lockedUse.layer)}".\nUnlock that layer to remove it.`); return; }
    const used = [p.videoClips, p.overlayClips || [], p.audioClips].reduce((n, list) => n + list.filter((c) => c.mediaId === id).length, 0);
    if (used && !askConfirm(`"${m.name}" is used by ${used} clip${used > 1 ? 's' : ''} on the timeline.\nRemove it and ${used > 1 ? 'those clips' : 'that clip'}? (Ctrl+Z undoes it)`, 'Remove')) return;
    dispatch({ type: 'removeMedia', id });
  };

  const toggleRecording = () => (recorder.recording ? recorder.stop() : recorder.start(readTime()));

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
    dispatch({ type: 'addText', clipId, at: readTime(), patch });
    setSelection({ track: 'text', id: clipId });
  };

  // "Add text" from an effect's panel: a text clip spanning exactly the clip / effect range
  // it was invoked from, selected so its inspector opens ready to type. Same addText action
  // and selection flow as the Text tab — no parallel text path.
  const addTextOver = (start, duration) => {
    const clipId = uid();
    dispatch({ type: 'addText', clipId, at: start, patch: { duration } });
    setSelection({ track: 'text', id: clipId });
  };

  // Contextual timeline tools (reference pattern): Detach audio and Link / Unlink appear
  // in the toolbar when the selection can use them, calling the same handlers as the menu.
  const selSingle = selection && !selection.items ? findClipIn(project, selection.track, selection.id) : null;
  const selMedia = selSingle?.mediaId && project.media.find((x) => x.id === selSingle.mediaId);
  const detachOk = !!(selSingle && (selection.track === 'video' || selection.track === 'overlay')
    && selMedia?.type === 'video' && selMedia.hasAudio && !selSingle.muted && !selSingle.linkId);
  const linkMode = selSingle?.linkId ? 'unlink'
    : (selection?.items?.length === 2 && selection.items.some((i) => i.track === 'audio')
      && selection.items.some((i) => i.track === 'video' || i.track === 'overlay')) ? 'link' : null;

  // Picture clip targeted by the Effects / Filters / Transitions / Adjust tabs: selection first, else under the playhead.
  // An overlay selection targets the overlay itself (tagged track: 'overlay'); the main-track
  // fallbacks stay video-only, and Transitions simply finds no index on an overlay target.
  const layout = videoLayout(project.videoClips);
  const overlaySel = selection?.track === 'overlay' ? (project.overlayClips || []).find((c) => c.id === selection.id) : null;
  const target = (overlaySel && { track: 'overlay', clip: overlaySel, start: overlaySel.start, end: overlaySel.start + freeLen('overlay', overlaySel) })
    || (selection?.track === 'video' && layout.find((l) => l.clip.id === selection.id && !l.clip.gap))
    || (selection?.items && layout.find((l) => !l.clip.gap && selection.items.some((it) => it.track === 'video' && it.id === l.clip.id)))
    || videoClipAt(project, readTime());
  // The whole-video filter: a filter layer on the Effects track that starts at 0 and covers the
  // timeline (src/features/effects/filters.js filterFx). The Filters tab's "Whole video" scope edits
  // it — the look everything gets, overlays and graphics included — where a clip filter touches
  // one clip only (the main track is often just a background behind overlay content).
  const wholeFilter = (() => {
    const dur = projectDuration(project);
    return (project.effectClips || []).find((e) => isFilterFx(e.fx) && e.start <= 1e-3 && e.start + e.duration >= dur - 1e-3) || null;
  })();
  const setWholeVideoFilter = (patch) => {
    const p = projectRef.current, dur = projectDuration(p);
    const existing = (p.effectClips || []).find((e) => isFilterFx(e.fx) && e.start <= 1e-3 && e.start + e.duration >= dur - 1e-3) || null;
    const strength = patch.filterIntensity == null ? undefined : Math.max(0, Math.min(1, patch.filterIntensity / 100));
    if ('filter' in patch) {
      if (!patch.filter || patch.filter === 'none') { if (existing) dispatch({ type: 'delete', track: 'effect', id: existing.id }); return; }
      if (existing) { dispatch({ type: 'update', track: 'effect', id: existing.id, patch: { fx: filterFx(patch.filter), ...(strength != null ? { strength: strength >= 1 ? undefined : strength } : {}) } }); return; }
      const clipId = uid();
      dispatch({ type: 'addEffectClip', clipId, fx: filterFx(patch.filter), at: 0, duration: Math.max(0.1, dur) });
      if (strength != null && strength < 1) dispatch({ type: 'update', track: 'effect', id: clipId, patch: { strength } });
    } else if (strength != null && existing) {
      dispatch({ type: 'update', track: 'effect', id: existing.id, patch: { strength: strength >= 1 ? undefined : strength } });
    }
  };
  // With several clips selected, a filter or color change goes to all of them (one undo step).
  const updateTarget = (patch) => {
    const current = selection ? target : videoClipAt(projectRef.current, readTime());
    if (!current) return;
    const many = selectedPictures(project, selection);
    if (many.length > 1 && isLookPatch(patch)) dispatch(lookAction(many, current.clip, patch));
    else dispatch({ type: 'update', track: current.track || 'video', id: current.clip.id, patch });
  };

  const split = useCallback(() => {
    let tgt = selection;
    if (!tgt) {
      const v = videoClipAt(project, readTime());
      if (v) tgt = { track: 'video', id: v.clip.id };
    }
    if (tgt) dispatch({ type: 'split', track: tgt.track, id: tgt.id, t: readTime(), newId: uid() });
  }, [selection, project, time]);

  // Delete everything left (or right) of the playhead in the selected clip when the playhead is inside it,
  // otherwise in the main-track clip under the playhead.
  const trimSide = useCallback((side) => {
    const targets = [];
    if (selection) targets.push(selection);
    const v = videoClipAt(project, readTime());
    if (v && !(selection && selection.id === v.clip.id)) targets.push({ track: 'video', id: v.clip.id });
    for (const tgt of targets) {
      const newId = uid();
      const actions = trimActions(project, { track: tgt.track, id: tgt.id, t: readTime(), side, newId });
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
    const near = markerNear(project.markers, readTime());
    if (near) dispatch({ type: 'removeMarker', id: near.id });
    else dispatch({ type: 'addMarker', id: uid(), time: readTime() });
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
    const key = { video: 'videoClips', overlay: 'overlayClips', text: 'textClips', audio: 'audioClips' }[sel.track];
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
    dispatch({ type: 'paste', track: clipboard.track, clip: clipboard.clip, at: readTime(), newId });
    setSelection({ track: clipboard.track, id: newId });
  }, [clipboard, time]);
  // Detach audio: render the clip's sound to its own file (electron/media/detach.cjs, cached),
  // put it on the Audio track at the clip's position and LINK the pair — the store keeps
  // linked clips in sync (select / move / trim / split / speed together). One undo step.
  const detachAudio = useCallback(async (sel = selection) => {
    const p = projectRef.current;
    const c = sel && findClip(p, sel);
    const m = c && p.media.find((x) => x.id === c.mediaId);
    if (!c || !m || m.type !== 'video' || !m.hasAudio || c.muted || c.linkId) return;
    setRenderJob({ kind: 'detach', label: 'Detaching audio…', fraction: 0 });
    const off = window.api.onDetachProgress((pr) => {
      if (pr.path === m.path) setRenderJob((j) => (j && !j.error ? { ...j, fraction: pr.fraction } : j));
    });
    let res;
    try {
      res = await window.api.detachRun({ path: m.path, duration: m.duration, hasAudio: m.hasAudio, type: m.type }, c.in || 0, c.out ?? m.duration);
    } catch (e) { res = { error: e.message }; }
    off();
    if (res.canceled) { setRenderJob(null); return; }
    if (res.error) { setRenderJob({ error: res.error }); return; }
    setRenderJob(null);
    const start = sel.track === 'video'
      ? (videoLayout(projectRef.current.videoClips).find((l) => l.clip.id === c.id)?.start ?? 0)
      : c.start;
    const linkId = uid();
    const audioId = uid();
    let media = projectRef.current.media.find((x) => x.path === res.path);
    dispatch({ type: 'beginGesture' });
    if (!media) { media = { ...res, id: uid(), origin: 'detach' }; dispatch({ type: 'addMedia', items: [media] }); } // Media tree: Generated ▸ Processed
    dispatch({ type: 'update', track: sel.track, id: sel.id, patch: { muted: true, linkId } });
    dispatch({ type: 'insertAudioClip', clip: {
      id: audioId, mediaId: media.id, start, in: 0, out: Math.min(c.out - c.in, res.duration || (c.out - c.in)),
      speed: c.speed || 1, volume: c.volume ?? 1, fadeIn: 0, fadeOut: 0,
      linkId, linkOff: 0, linkInOff: -(c.in || 0),
    } });
    dispatch({ type: 'endGesture' });
    select({ track: 'audio', id: audioId });
  }, [selection, select]);

  // Voice Enhancer: render the clip's range cleaned (electron/media/enhance.cjs, cached) and point
  // the clip at the result (clip.enhance = { on, strength, path, from, to }). Preview and export
  // both substitute that file for the clip's sound. Re-running with another strength re-renders.
  const enhanceClip = useCallback(async (sel, strength) => {
    const p = projectRef.current;
    const c = sel && findClip(p, sel);
    const m = c && p.media.find((x) => x.id === c.mediaId);
    if (!c || !m || !m.hasAudio || m.type === 'image') return;
    setRenderJob({ kind: 'enhance', label: 'Enhancing voice…', fraction: 0 });
    const off = window.api.onEnhanceProgress((pr) => {
      if (pr.path === m.path) setRenderJob((j) => (j && !j.error ? { ...j, fraction: pr.fraction } : j));
    });
    let res;
    try {
      res = await window.api.enhanceRun({ path: m.path, duration: m.duration, hasAudio: m.hasAudio, type: m.type }, c.in || 0, c.out ?? m.duration, strength);
    } catch (e) { res = { error: e.message }; }
    off();
    if (res.canceled) { setRenderJob(null); return; }
    if (res.error) { setRenderJob({ error: res.error }); return; }
    setRenderJob(null);
    dispatch({ type: 'update', track: sel.track, id: sel.id, patch: { enhance: { on: true, strength, path: res.path, from: c.in || 0, to: c.out ?? m.duration } } });
  }, []);

  // Unlink a linked pair: both clips become independent (one undo step).
  const unlinkClip = useCallback((sel = selection) => {
    const p = projectRef.current;
    const c = sel && findClip(p, sel);
    if (!c || !c.linkId) return;
    const partner = findLinkPartner(p, c);
    dispatch({ type: 'beginGesture' });
    dispatch({ type: 'update', track: sel.track, id: sel.id, patch: { linkId: undefined, linkOff: undefined, linkInOff: undefined } });
    if (partner) dispatch({ type: 'update', track: partner.track, id: partner.clip.id, patch: { linkId: undefined, linkOff: undefined, linkInOff: undefined } });
    dispatch({ type: 'endGesture' });
  }, [selection]);

  // Link the two selected clips (one picture + one audio) into a synced pair. The audio
  // clip's offsets are taken from the current positions, and its speed / window end are
  // matched to the picture clip so the sync invariants hold from the start.
  const linkPair = useCallback(() => {
    const p = projectRef.current;
    const items = selection?.items || [];
    const pic = items.find((it) => it.track === 'video' || it.track === 'overlay');
    const aud = items.find((it) => it.track === 'audio');
    if (items.length !== 2 || !pic || !aud) return;
    const pc = findClip(p, pic);
    const ac = findClip(p, aud);
    if (!pc || !ac || pc.linkId || ac.linkId) return;
    const vStart = pic.track === 'video'
      ? (videoLayout(p.videoClips).find((l) => l.clip.id === pc.id)?.start ?? 0)
      : pc.start;
    const linkId = uid();
    dispatch({ type: 'beginGesture' });
    dispatch({ type: 'update', track: pic.track, id: pic.id, patch: { linkId } });
    dispatch({ type: 'update', track: 'audio', id: ac.id, patch: {
      linkId, linkOff: ac.start - vStart, linkInOff: ac.in - pc.in,
      speed: pc.speed || 1, out: ac.in + (pc.out - pc.in),
    } });
    dispatch({ type: 'endGesture' });
  }, [selection]);

  // Select every clip on the layer of the given clip (Select all in the clip menu).
  const selectAllOnLayer = useCallback((sel) => {
    const p = projectRef.current;
    const c = sel && findClip(p, sel);
    if (!c) return;
    const key = { video: 'videoClips', overlay: 'overlayClips', text: 'textClips', audio: 'audioClips' }[sel.track];
    if (!key) return;
    const layer = clipLayer(sel.track, c);
    const items = p[key].filter((x) => !x.gap && clipLayer(sel.track, x) === layer).map((x) => ({ track: sel.track, id: x.id }));
    if (items.length) select(makeSelection(items));
  }, [select]);

  // Move the selected clip(s) of one layered lane to another layer of that lane (one undo
  // step). Targets that would overlap are disabled in the menu, so this always fits.
  const moveSelectionToLayer = useCallback((sel, layer) => {
    const items = (selection?.items && selection.items.some((it) => it.track === sel.track && it.id === sel.id))
      ? selection.items.filter((it) => it.track === sel.track)
      : [sel];
    dispatch({ type: 'beginGesture' });
    items.forEach((it) => dispatch({ type: 'update', track: it.track, id: it.id, patch: { layer } }));
    dispatch({ type: 'endGesture' });
    return items;
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
      const only = { ...p, videoClips: [], overlayClips: [], audioClips: [], textClips: [] };
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
    const t = readTime() > start && readTime() < start + len ? readTime() : start;
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

  // Reverse (item 12): render the clip's range backwards (electron/media/reverse.cjs, cached) and swap
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
    setRenderJob({ kind: 'reverse', label: 'Reversing clip…', fraction: 0 });
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
    if (!media) { media = { ...res, id: uid(), origin: 'reverse' }; dispatch({ type: 'addMedia', items: [media] }); } // Media tree: Generated ▸ Processed
    dispatch({ type: 'update', ...sel, patch: { mediaId: media.id, in: 0, out: res.duration, reversed: { mediaId: c.mediaId, in: c.in || 0, out: c.out ?? m.duration } } });
    dispatch({ type: 'endGesture' });
  };

  const openClipMenu = (e, track, clip) => {
    const clicked = { track, id: clip.id };
    const existing = selection?.items || (selection ? [{ track: selection.track, id: selection.id }] : []);
    const included = existing.some(r => r.track === track && r.id === clip.id);
    if (!included) setSelection(clicked);
    setMenu({ x: e.clientX, y: e.clientY, ...clicked, clip_refs: included ? existing : [clicked] });
  };

  // ---- Motion tracking: the user picks a point on the player (Preview reports it in media fractions),
  // the engine follows it through the clip (electron/media/track.cjs) and the path lands on the clip; overlay,
  // text clips can then be pinned to it (clip.pin — see src/features/timeline/track.js). ----
  const startTrackPick = (sel) => {
    const c = findClip(project, sel);
    if (!c || c.gap) return;
    select(sel);
    setPlaying(false);
    seek(clipStartTl(project, sel.track, c) + 0.01);
    setTrackPick({ track: sel.track, id: sel.id, point: null, box: { w: 0.055, h: 0.095 } });
  };
  // ---- Visual crop: an on-player mode (like track-pick). The whole mode is ONE undo step:
  // a gesture opens on entry, drags in the player dispatch transient updates inside it,
  // Done folds it into a single history entry, Cancel puts the entry snapshot back first.
  // Playback and scrubbing stay live while the mode is open. ----
  // ---- Chroma color pick: an on-player sampler (stage mode like track-pick). Replaces the
  // OS EyeDropper, which silently rejects under Electron on Linux — the old Pick button did
  // nothing there (K6). The player maps the click into the clip's source frame and reads
  // the pixel; a successful sample is the only thing that changes the project. ----
  const [colorPick, setColorPick] = useState(null); // { track, id }
  const startColorPick = (sel) => {
    const c = findClip(project, sel);
    if (!c || c.gap) return;
    select(sel);
    setPlaying(false);
    const start = clipStartTl(project, sel.track, c);
    const len = ((c.out ?? 0) - (c.in ?? 0)) / (c.speed || 1);
    if (readTime() < start - 1e-6 || readTime() > start + len + 1e-6) seek(start + 0.01);
    setColorPick({ track: sel.track, id: sel.id });
  };
  const finishColorPick = (hex) => {
    if (colorPick && hex) {
      const c = findClip(projectRef.current, colorPick);
      if (c) dispatch({ type: 'update', track: colorPick.track, id: colorPick.id, patch: { chroma: { ...chromaOf(c), on: true, color: hex } } });
    }
    setColorPick(null);
  };
  useEffect(() => {
    if (!colorPick) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); setColorPick(null); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [colorPick]);

  // CROP-3: the crop mode is a BUFFERED edit. Entering snapshots the clip's crop, aspect
  // and rotation into a draft held here; every control in the mode (frame drags, centre
  // move, aspect chips, the rotation control) edits only the draft, and Preview renders
  // the draft (its project override below carries the draft rotation). The store — and
  // with it autosave, the inspector and any export — sees nothing until Done commits the
  // draft as exactly ONE undo step; Cancel (or Esc) just drops the draft.
  const startCropEdit = (sel) => {
    const c = findClip(project, sel);
    if (!c || c.gap) return;
    select(sel);
    const start = clipStartTl(project, sel.track, c);
    const len = ((c.out ?? 0) - (c.in ?? 0)) / (c.speed || 1);
    if (readTime() < start - 1e-6 || readTime() > start + len + 1e-6) seek(start + 0.01);
    const snap = { crop: cropOf(c), cropAspect: c.cropAspect || 'free', rot: transformOf(c).rot || 0 };
    setCropEdit({ track: sel.track, id: sel.id, snapshot: snap, draftCrop: snap.crop, draftAspect: snap.cropAspect, draftRot: snap.rot });
  };
  const doneCropEdit = () => {
    if (!cropEdit) return;
    const { snapshot: snap, draftCrop, draftAspect, draftRot } = cropEdit;
    const c = findClip(projectRef.current, cropEdit);
    const changed = c && (JSON.stringify(draftCrop) !== JSON.stringify(snap.crop)
      || draftAspect !== snap.cropAspect || draftRot !== snap.rot);
    if (changed) {
      dispatch({ type: 'beginGesture' });
      dispatch({ type: 'update', track: cropEdit.track, id: cropEdit.id, patch: { crop: draftCrop, cropAspect: draftAspect, transform: { ...transformOf(c), rot: draftRot } } });
      dispatch({ type: 'endGesture' });
    }
    setCropEdit(null);
  };
  const cancelCropEdit = () => { setCropEdit(null); };
  const applyCropAspect = (id) => {
    if (!cropEdit) return;
    const c = findClip(projectRef.current, cropEdit);
    const m = c && projectRef.current.media.find((x) => x.id === c.mediaId);
    if (!c || !m) return;
    if (id === 'free') { setCropEdit((e) => e && { ...e, draftAspect: 'free' }); return; }
    const R = aspectRatioOf(id, m.width, m.height);
    if (!R) return;
    setCropEdit((e) => e && { ...e, draftCrop: cropForAspect(e.draftCrop, m.width, m.height, R), draftAspect: id });
  };
  const setCropDraft = useCallback((crop) => { setCropEdit((e) => (e ? { ...e, draftCrop: crop } : e)); }, []);
  const setCropRot = (rot) => { const r = Math.round(Math.min(180, Math.max(-180, Number(rot) || 0)) * 10) / 10; setCropEdit((e) => (e ? { ...e, draftRot: r } : e)); };
  // While cropping, Preview shows the DRAFT rotation on the target clip (the crop itself
  // is suppressed there as before). Everything else about the project is untouched.
  const cropPreviewProject = useMemo(() => {
    if (!cropEdit) return playProject;
    const patchList = (list) => (list || []).map((c) => (c.id === cropEdit.id ? { ...c, transform: { ...transformOf(c), rot: cropEdit.draftRot } } : c));
    return { ...playProject, videoClips: patchList(playProject.videoClips), overlayClips: patchList(playProject.overlayClips) };
  }, [playProject, cropEdit]);
  useEffect(() => {
    if (!cropEdit) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); cancelCropEdit(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [cropEdit]); // eslint-disable-line react-hooks/exhaustive-deps

  const runTrack = async () => {
    const pick = trackPick;
    if (!pick || !pick.point) return;
    const p = projectRef.current;
    const c = findClip(p, pick);
    const m = c && p.media.find((x) => x.id === c.mediaId);
    setTrackPick(null);
    if (!c || !m) return;
    setRenderJob({ kind: 'track', label: `Tracking motion in "${m.name || 'clip'}"`, fraction: 0 });
    const off = window.api.onTrackProgress(({ fraction }) => setRenderJob((j) => (j && j.kind === 'track' ? { ...j, fraction } : j)));
    let res = null;
    try { res = await window.api.trackRun(m, c.in || 0, c.out ?? m.duration, pick.point, pick.box); } catch { /* reported below */ }
    off();
    if (res && res.points && res.points.length) {
      dispatch({ type: 'beginGesture' });
      dispatch({ type: 'update', track: pick.track, id: pick.id, patch: { track: { points: res.points, box: pick.box, fps: res.fps } } });
      dispatch({ type: 'endGesture' });
      setRenderJob(null);
    } else if (res && res.canceled) setRenderJob(null);
    else setRenderJob({ error: (res && res.error) || 'Tracking failed.' });
  };
  const attachTimelineContext = (input) => {
    const request = { id: uid(), projectId: projectRef.current.id, loadVersion: projectLoadVersion };
    try { request.attachment = createTimelineAttachment(projectRef.current, input); }
    catch (error) { request.error = error.message; }
    setTimelineContextRequest(request);
  };
  const menuItems = (sel) => [
    { label: (sel.clip_refs?.length || 1) > 1 ? 'Add selected clips to CraftAI' : 'Add clip to CraftAI', icon: MessageSquarePlus,
      onClick: () => attachTimelineContext({ kind: 'clips', clip_refs: sel.clip_refs || [{ track: sel.track, id: sel.id }] }) },
    { label: 'Add clip time range to CraftAI', icon: ScanLine, onClick: () => {
      try {
        const clip = createTimelineAttachment(projectRef.current, { kind: 'clips', clip_refs: [{ track: sel.track, id: sel.id }] });
        attachTimelineContext({ kind: 'range', start_sec: clip.start_sec, end_sec: clip.end_sec });
      } catch (error) { setTimelineContextRequest({ id: uid(), projectId: projectRef.current.id, loadVersion: projectLoadVersion, error: error.message }); }
    } },
    'sep', ...clipEditingMenuItems(sel),
  ];
  const clipEditingMenuItems = (sel) => {
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
    const canDetach = pic && m?.type === 'video' && m.hasAudio && !c.muted && !c.linkId;
    const detachHint = !(pic && m?.type === 'video') ? 'Only for video clips'
      : !m.hasAudio ? 'This video has no sound' : c.linkId ? 'The sound is already detached' : 'The clip is muted — its sound is off';
    // Extract audio: an independent, unlinked copy of the sound (the extractAudio action) —
    // same availability as Detach, minus the link condition.
    const canExtract = pic && m?.type === 'video' && m.hasAudio && !c.muted;
    const extractHint = !(pic && m?.type === 'video') ? 'Only for video clips'
      : !m.hasAudio ? 'This video has no sound' : 'The clip is muted — its sound is off';
    const items = [
      { label: 'Copy', icon: Copy, shortcut: 'Ctrl C', onClick: copy },
      { label: 'Cut', icon: Scissors, shortcut: 'Ctrl X', onClick: cut },
      { label: 'Paste', icon: ClipboardPaste, shortcut: 'Ctrl V', onClick: paste, disabled: !clipboard, hint: 'Copy a clip first' },
      { label: 'Delete', icon: Trash2, shortcut: 'Del', onClick: remove },
      { label: 'Select all on this layer', icon: ListChecks, onClick: () => selectAllOnLayer(sel) },
      'sep',
      { label: 'Split at playhead', icon: Split, shortcut: 'S', onClick: split },
      { label: 'Delete left of playhead', icon: ScissorsLineDashed, shortcut: 'Q', onClick: () => trimSide('left') },
      { label: 'Delete right of playhead', icon: ScissorsLineDashed, shortcut: 'W', onClick: () => trimSide('right') },
      { label: 'Duplicate', icon: CopyPlus, shortcut: 'Ctrl D', onClick: duplicate },
    ];
    // Move to Track: the other layers of this clip's lane (multi-selection moves together).
    if (LAYERED[sel.track]) {
      const count = layerCount(project, sel.track);
      const cur = layerOf(c);
      const span = sel.track === 'audio' ? { start: c.start, len: freeLen('audio', c) }
        : sel.track === 'overlay' ? { start: c.start, len: freeLen('overlay', c) }
        : { start: c.start, len: c.duration };
      if (count > 1) {
        items.push({
          label: 'Move to layer', icon: Layers,
          submenu: Array.from({ length: count }, (_, layer) => layer).filter((layer) => layer !== cur).map((layer) => ({
            label: layerName(project, sel.track, layer),
            disabled: !layerFree(project, sel.track, layer, span.start, span.len, c.id) || isLayerLocked(project, sel.track, layer),
            hint: isLayerLocked(project, sel.track, layer) ? 'That layer is locked' : 'The clip would overlap a clip there',
            onClick: () => moveSelectionToLayer(sel, layer),
          })),
        });
      }
    }
    // Speed / Duration (constant speed — also on the inspector's Speed tab) and Properties.
    if (pic || sel.track === 'audio') {
      items.push({ label: 'Speed / Duration…', icon: Gauge, onClick: () => setSpeedAsk({ track: sel.track, id: sel.id }) });
    }
    items.push({ label: 'Properties', icon: Info, onClick: () => {
      select(sel);
      setRightCollapsed(false);
      requestAnimationFrame(() => {
        const el = document.querySelector('aside.inspector');
        if (el) { el.setAttribute('tabindex', '-1'); el.focus({ preventScroll: true }); el.scrollIntoView({ block: 'nearest' }); }
      });
    } });
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
            dispatch({ type: 'moveToOverlay', id: c.id, at: l ? l.start : readTime() });
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
    if (pic) items.push({ label: 'Detach audio', icon: AudioLines, shortcut: 'Ctrl Shift S', onClick: () => detachAudio(sel), disabled: !canDetach, hint: detachHint });
    if (pic) items.push({ label: 'Extract audio', icon: FileAudio, onClick: () => dispatch({ type: 'extractAudio', track: sel.track, id: sel.id, newId: uid() }), disabled: !canExtract, hint: extractHint });
    if (c.linkId) {
      items.push({ label: 'Unlink audio and video', icon: Unlink, onClick: () => unlinkClip(sel) });
    } else if (selection?.items?.length === 2
      && selection.items.some((it) => it.track === 'audio')
      && selection.items.some((it) => it.track === 'video' || it.track === 'overlay')) {
      items.push({ label: 'Link clips', icon: Link2, onClick: linkPair });
    }
    if (sel.track === 'audio') items.push({ label: c.reversed ? 'Reverse (restore original)' : 'Reverse', icon: Rewind, onClick: () => reverseClip(sel) });
    items.push({ label: 'Export clip audio (MP3)', icon: AudioLines, onClick: () => exportAudio('mp3', sel), disabled: !withSound, hint: 'This clip has no sound' });
    // Enhance voice on the clip's own menu too — the same render the inspector's
    // Enhance voice section drives (clip.enhance via enhanceClip), for audio clips and
    // picture clips with sound alike. Hamza, 2026-11-01: it must appear in the audio
    // context, not only in the video panel.
    if (withSound && m?.hasAudio) {
      const e = c.enhance;
      const stale = !!(e?.path && (Math.abs((e.from ?? -1) - (c.in || 0)) > 0.02 || Math.abs((e.to ?? -1) - (c.out ?? -1)) > 0.02));
      const enhOn = !!(e?.on && e?.path && !stale);
      items.push({
        label: enhOn ? `Enhance voice (on · ${e.strength})` : 'Enhance voice', icon: Sparkles,
        submenu: [
          { label: 'Off', disabled: !e?.on, hint: 'Enhance voice is already off', onClick: () => dispatch({ type: 'update', ...sel, patch: { enhance: { ...e, on: false } } }) },
          ...[['light', 'Light'], ['standard', 'Standard'], ['strong', 'Strong']].map(([s, name]) => ({
            label: enhOn && e.strength === s ? `${name} ✓` : name,
            onClick: () => enhanceClip(sel, s),
          })),
        ],
      });
    }
    items.push(c.disabled
      ? { label: 'Activate clip', icon: Eye, onClick: () => dispatch({ type: 'update', ...sel, patch: { disabled: false } }) }
      : { label: 'Deactivate clip', icon: EyeOff, onClick: () => dispatch({ type: 'update', ...sel, patch: { disabled: true } }) });
    // Motion tracking: track a video clip's moving point; pin overlay / text clips to a track.
    if (pic && m?.type === 'video') {
      items.push('sep', { label: c.track ? 'Track motion again…' : 'Track motion…', icon: Crosshair, onClick: () => startTrackPick(sel) });
    }
    if (sel.track === 'overlay' || sel.track === 'text') {
      const sources = trackedClips(project).filter((s) => s.clip.id !== c.id);
      const submenu = [];
      if (c.pin) submenu.push({ label: 'Unpin', icon: PinOff, onClick: () => dispatch({ type: 'update', ...sel, patch: { pin: null } }) });
      for (const s of sources) {
        const sm = project.media.find((x) => x.id === s.clip.mediaId);
        submenu.push({
          label: `Track in "${sm?.name || 'clip'}"`, icon: Pin,
          onClick: () => dispatch({ type: 'update', ...sel, patch: { pin: { to: s.clip.id } } }),
        });
      }
      if (!submenu.length) submenu.push({ label: 'No tracked clips yet', disabled: true, hint: 'Track motion in a video clip first' });
      items.push({ label: 'Pin to track', icon: Pin, submenu });
    }
    return items;
  };

  const duplicate = useCallback(() => {
    if (!selection) return;
    const okItem = (it) => it.track !== 'transition' && !(it.track === 'effect' && it.id.includes('|'));
    if (selection.items) {
      // Bulk duplicate: every selected clip, one undo step (locked layers refuse their own).
      const items = selection.items.filter(okItem);
      if (!items.length) return;
      dispatch({ type: 'beginGesture' });
      items.forEach((it) => dispatch({ type: 'duplicate', ...it, newId: uid() }));
      dispatch({ type: 'endGesture' });
    } else if (okItem(selection)) dispatch({ type: 'duplicate', ...selection, newId: uid() });
  }, [selection]);

  // Saves to the project's file (asks where the first time, or always with saveAs). Returns true once saved.
  const save = async (saveAs = false) => {
    const a = autosave.current;
    const p = projectRef.current;
    const previousFile = a.file;
    clearTimeout(a.fileTimer);a.fileTimer = null;
    const { pretty } = await serializeProject(p);
    await a.writing?.catch(() => {});
    const res = await window.api.saveProject(pretty, previousFile, { saveAs, name: p.name });
    if (!res) return false;
    if (res.error) {
      setSaveState('error');
      showAlert(res.error);
      return false;
    }
    if (a.project.id !== p.id || a.file !== previousFile) return true; // project switched while Save was pending
    const unchanged = a.project === p;
    clearTimeout(a.fileTimer);a.fileTimer = null;
    a.file = res;
    if (!unchanged) a.fileTimer = setTimeout(writeFile, 1500);
    setSaveState(unchanged ? 'saved' : 'saving');
    pushRecent(recentOf(a.project, res));
    await keepRecovery(false);
    await writeSlotNow(a.project, res); // closing after Save also waits for its slot
    return true;
  };

  const open = async () => {
    try {
      const res = await window.api.openProject();
      if (!res) return;
      const p = await adoptFileBinding(normalizeProject(JSON.parse(res.json)), res.file);
      await flushAutosave(); // the current project keeps its last changes (file + slot)
      autosave.current.file = res.file;
      dispatch({ type: 'load', project: p });
      setSaveState('saved');
      setUnsavedNote(null);
      setTime(0);
      setSelection(null);
      pushRecent(recentOf(p, res.file));
      writeSlotNow(p, res.file); // the slot syncs to the file's content under the shared id
      setScreen('editor');
    } catch (e) {
      showAlert('Invalid project file: ' + e.message);
    }
  };

  // ---- Home screen actions ----
  const startNewProject = async (preset, fps, name = 'Untitled') => {
    await flushAutosave(); // the project being left keeps everything, slot included
    const p = {
      ...emptyProject(), name, ratio: preset.ratio,
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

  // Home quick tool: Record screen opens a fresh 16:9 project with the recorder up.
  const startRecording = (fps) => {
    startNewProject({ ratio: '16:9', short: 1080 }, fps);
    setPlaying(false);
    setScreenOpen(true);
  };

  // Open a project from its autosave slot (the card may be slot-only or merged with the
  // file recent for the same project). The current project is flushed first, then the
  // slot's state is restored whole — media paths included, exactly like a file open.
  // Returns { error } instead of showing it, for external agents (open_project); openSlot shows it.
  const loadSlot = async (slotId) => {
    await flushAutosave(); // whatever is in the editor right now keeps its latest state
    const slot = await window.api.slotRead(slotId);
    if (!slot) {
      refreshSlots();
      return { error: 'That auto-saved project could not be found any more, so it was removed from the list.' };
    }
    let p;
    try { p = { ...normalizeProject(slot.project), id: slot.id }; }
    catch (e) { return { error: 'Invalid auto-saved project: ' + e.message }; }
    autosave.current.file = slot.file || null;
    autosave.current.pendingRestore = false;
    dispatch({ type: 'load', project: p });
    setSaveState(slot.file ? 'saved' : 'new');
    setUnsavedNote(null);
    setTime(0);
    setSelection(null);
    setScreen('editor');
    return { opened: p.id };
  };
  const openSlot = async (entry) => { const r = await loadSlot(entry.slotId); if (r?.error) showAlert(r.error); };

  // A project file by path (Home recents, external agents). Returns { error } instead of showing it.
  const loadFile = async (filePath) => {
    const res = await window.api.openProjectPath?.(filePath);
    if (!res) {
      storeRecents(recentsRef.current.filter((x) => x.path !== filePath));
      return { error: 'That project file could not be found any more, so it was removed from recents.' };
    }
    try {
      const p = await adoptFileBinding(normalizeProject(JSON.parse(res.json)), res.file);
      await flushAutosave();
      autosave.current.file = res.file;
      dispatch({ type: 'load', project: p });
      setSaveState('saved');
      setUnsavedNote(null);
      setTime(0);
      setSelection(null);
      pushRecent(recentOf(p, res.file));
      writeSlotNow(p, res.file); // the slot syncs to the file's content under the shared id
      setScreen('editor');
      return { opened: p.id };
    } catch (e) {
      return { error: 'Invalid project file: ' + e.message };
    }
  };
  const openRecent = async (r) => {
    if (r.slotId) return openSlot(r);
    const res = await loadFile(r.path);
    if (res?.error) showAlert(res.error);
  };

  const importFromHome = async () => {
    await flushAutosave(); // the project in the editor keeps its state before media lands
    const ok = await importMedia();
    if (ok.length) {
      autosave.current.pendingRestore = false;
      setUnsavedNote(null);
      autosave.current.file = null;
      setSaveState('new');
      setScreen('editor');
    }
  };

  // The startup offer (a project the last session ended on, unsaved): restoring loads it
  // with its file binding, exactly as it was left; the editor's current work is flushed
  // first. Discarding clears the recovery AND the project's slot — the user said no.
  const restoreUnsaved = async () => {
    const note = unsavedNote;
    if (!note) return;
    let p;
    try { p = normalizeProject(note.project); }
    catch (e) { showAlert('Invalid recovery project: ' + e.message); return; }
    await flushAutosave();
    autosave.current.file = note.file || null;
    autosave.current.pendingRestore = false;
    dispatch({ type: 'load', project: p });
    if (note.file) setSaveState('saved');
    setUnsavedNote(null);
    setTime(0);
    setSelection(null);
    setScreen('editor');
  };
  const discardUnsaved = () => {
    autosave.current.pendingRestore = false;
    const id = unsavedNote?.project?.id;
    keepRecovery(false);
    if (id && !isTourId(id)) window.api.slotDelete?.(id).then(refreshSlots).catch(() => {});
    setUnsavedNote(null);
  };

  // Removing a Home card: a file recent leaves the recents list (the file itself is never
  // touched); a slot entry deletes its autosave slot. A merged card does both.
  const removeHomeEntry = (entry) => {
    if (entry?.path) removeRecent(entry.path);
    if (entry?.slotId) window.api.slotDelete?.(entry.slotId).then(refreshSlots).catch(() => {});
  };

  // Home's switchboard: autosave slots and file recents merged into ONE list, newest
  // first. A file-backed project appears once — its slot and its recent describe the same
  // project, merged by path (the open then restores the slot's latest state).
  const homeProjects = useMemo(() => {
    const list = autoSlots.map((s) => ({
      slotId: s.id, path: s.file || null, file: s.file || null,
      name: s.title || 'Untitled', ratio: s.ratio || '', modifiedAt: s.updatedAt || 0, thumb: s.thumb || null,
    }));
    for (const r of recents) {
      const m = list.find((e) => e.path && e.path === r.path);
      if (m) {
        if (!m.thumb && r.thumb) m.thumb = r.thumb;
        if ((r.modifiedAt || 0) > (m.modifiedAt || 0)) m.modifiedAt = r.modifiedAt;
      } else {
        list.push({ ...r });
      }
    }
    return list.sort((a, b) => (b.modifiedAt || 0) - (a.modifiedAt || 0));
  }, [autoSlots, recents]);

  // Closing the window: write the project's file, or ask about a project that never had one.
  useEffect(() => window.api.onCloseRequest(async () => {
    const a = autosave.current;
    if (a.file) {
      await flushAutosave(); // Home restores the slot too, including the latest chat.
      await keepRecovery(false);
      return window.api.closeNow();
    }
    if (!hasContent(a.project)) {
      await keepRecovery(false);
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
      await keepRecovery(false);
      const id = a.project?.id;
      if (id && !isTourId(id)) { try { await window.api.slotDelete(id); } catch { /* closing anyway */ } }
      return window.api.closeNow();
    }
    return window.api.closeCancel();
  }), []); // eslint-disable-line react-hooks/exhaustive-deps

  // Legacy template projects retain replaceable clips through the slot strip.
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

  // Export opens on a summary of the EFFECTIVE settings (src/features/export/exportQuality.js resolves the project's
  // stored export settings) — and that same resolved object is stamped onto the project the pipeline
  // receives, so the summary IS the export configuration, not a description of it.
  const startExport = async () => {
    if (exportRunning.current) return;
    try { await graphicEdits.flush(); } catch (error) { return showAlert(error.message); }
    const project = renderable(projectRef.current);
    if (!project.videoClips.length) return showAlert('Add a video or photo to the timeline before exporting.');
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
  const exportRunning = useRef(false);
  const exportCanceled = useRef(false);
  const exportReporter = useRef(null);
  const runExportFlow = async (project, eff, presetTarget, name, review = false, presentation = {}) => {
    if (exportRunning.current) return { error: 'Another export is already running.' };
    exportRunning.current = true;exportCanceled.current = false;
    let target, timer, off;
    let viewState = null;
    const publish = next => {
      viewState = typeof next === 'function' ? next(viewState) : next;
      if (!presentation.inline) { setExporting(viewState);return; }
      if (!viewState) return;
      // The chat receives progress, not the render snapshot or temporary paths.
      const {progress,stage,phase,phaseProgress,remainingSeconds,elapsedSeconds,timingStatus,step,steps,stopping,done,error}=viewState;
      try { presentation.onProgress?.(Object.fromEntries(Object.entries({progress,stage,phase,phaseProgress,remainingSeconds,elapsedSeconds,timingStatus,step,steps,stopping,done,error}).filter(([,value])=>value!==undefined))); } catch { /* presentation cannot fail an export */ }
    };
    exportReporter.current = publish;
    const stopIfCanceled = () => { if (exportCanceled.current) throw new Error('Export canceled'); };
    try {
      target = presetTarget || await window.api.exportBegin(name);
      if (target.canceled) return { canceled: true };
      project = exportRenderPlan(project, eff);
      const stages = exportStages(project, fxWork(project));
      let storage;try { storage = window.localStorage; } catch {}
      const progress = new ExportProgress(stages, { storage, profile: readExportProfile(storage), publish: update => {
        if (exportCanceled.current) return;
        publish(e => e && !e.done && !e.error ? { ...e, ...update } : e);
  // The rendered cover (export:coverFrame's per-project poster file) is the home card's picture;
  // the timestamp lets the card reload the file when the same path holds a new render.
  const changePosterImage = (file) => {
    dispatch({ type: 'setProject', patch: { posterImage: file, posterImageAt: Date.now() } });
  };
        window.api.exportActivity?.({active:true,progress:update.progress}).catch(() => {});
      } });
      publish({ ready:false, project, eff, target, name, review, progress:0, stage:review ? 'Preparing section preview' : 'Preparing your video', startedAt:performance.now() });
      progress.start('prepare');timer = setInterval(() => progress.emit(), 1000);
      await new Promise(resolve => setTimeout(resolve, 0));stopIfCanceled();
      await loadProjectLuts(project);stopIfCanceled();
      let toExport = { ...project, export:eff, maskImages:maskImages(project), decoImages:decoImages(project), customMaskImages:customMaskImages(project), motion:motionDataPinned(project) };
      progress.update(1);let textFrames = 0;
      if (stages.some(s => s.id === 'text')) {
        progress.start('text');
        textFrames = await renderTextFrames(project,target.frameDir,(p,detail) => progress.update(p,detail),() => exportCanceled.current);
        if (textFrames < 0) throw new Error('Export canceled');stopIfCanceled();
      }
      if (stages.some(s => s.id === 'effects')) {
        progress.start('effects');
        toExport = await renderFxPass(toExport,(p,detail) => progress.update(p,detail),() => exportCanceled.current);
        if (!toExport) throw new Error('Export canceled');stopIfCanceled();
      }
      progress.start('encode');
      off = window.api.onExportProgress((fraction,detail) => progress.update(fraction,{...detail,restart:!!detail?.retry}));
      const res = await window.api.exportRun(toExport,target,textFrames);off();off = null;
      if (res.canceled) exportCanceled.current = true;stopIfCanceled();
      if (!res.ok) throw new Error(res.error || 'The video could not be exported.');
      progress.start('finish');let size = res.size, coverNote = null;
      if (typeof project.posterAt === 'number') {
        try {
          // The embedded cover is the EXPORTED frame at the chosen time — overlays, graphics and
          // text included, what a viewer sees — never a frame of the main-track source.
          const at = Math.min(Math.max(0, project.posterAt), Math.max(0, exportDuration(project) - 1 / (project.fps || 30)));
          const cov = await window.api.exportCover(res.file,res.file,at);
          if (cov.ok) { if (cov.size) size = cov.size; }
          else coverNote = 'The cover picture could not be embedded — the video itself is complete.';
        } catch { coverNote = 'The cover picture could not be embedded — the video itself is complete.'; }
      }
      // Once encoding has published the finished file, completing the optional
      // cover is best-effort. Cancel never discards a successfully saved video.
      const elapsedSeconds = progress.finish();
      publish({done:true,file:res.file,size,metadata:res.metadata,coverNote,review,progress:1,elapsedSeconds,stage:review?'Preview rendered':'Video saved'});
      return { ok: true, file: res.file, size, metadata: res.metadata, elapsed_seconds: elapsedSeconds, ...(coverNote ? { warning: coverNote } : {}) };
    } catch (error) {
      if (exportCanceled.current) publish(null);
      else publish({error:error.message,project,eff,name,review,target:null});
      return exportCanceled.current ? { canceled: true } : { error: error.message };
    } finally {
      clearInterval(timer);off?.();
      await Promise.allSettled([window.api.fxClear(),...(target?.frameDir?[window.api.exportAbort(target.frameDir)]:[])]);
      await window.api.exportActivity?.({active:false}).catch(() => {});
      exportRunning.current = false;
      if(exportReporter.current===publish)exportReporter.current=null;
    }
  };
  const cancelExport = () => {
    if (exportCanceled.current) return;
    exportCanceled.current = true;
    (exportReporter.current || setExporting)(e => e && { ...e, stopping:true, remainingSeconds:null });
    window.api.cancelExport().catch(() => {});
  };

  const startAgentExport = async (options = {}, request = {}) => {
    if (exportRunning.current || exporting?.ready) return { error: 'Finish or close the existing export first.' };
    if (request.isCanceled?.()) return { canceled: true };
    let target, watch;
    setAgentRendering(true);
    try {
      await graphicEdits.flush();
      const caps = await window.api.exportCaps();
      const { project: snapshot, effective } = agentExportPlan(projectRef.current, options, caps);
      if (request.isCanceled?.()) return { canceled: true };
      target = await window.api.agentExportBegin({ requestId: request.requestId, revision: request.revision, kind: options.review ? 'review' : 'export', start_sec: options.start_sec, file_path: options.file_path, name: options.name || snapshot.name, overwrite: options.overwrite });
      if (target.error) return target;
      if (request.isCanceled?.()) return { canceled: true };
      setPlaying(false);
      watch = setInterval(() => { if (request.isCanceled?.() && !exportCanceled.current) cancelExport(); }, 100);
      const result = await runExportFlow(snapshot, effective, target, options.name || snapshot.name, !!options.review, {inline:true,onProgress:request.onProgress});
      return { ...result, settings: effective };
    } catch (error) { return { error: error.message }; }
    finally {
      clearInterval(watch);
      if (target?.frameDir) await window.api.exportAbort(target.frameDir).catch(() => {});
      setAgentRendering(false);
    }
  };

  // Hook used by the automated smoke test (tests/smoke/index.cjs).
  useEffect(() => {
    window.__fve = {
      load: (p) => {
        setPlaying(false);setTime(0);setSelection(null);
        dispatch({ type: 'load', project: p });
      },
      seek,
      play: () => setPlaying(true),
      pause: () => setPlaying(false),
      currentTime: readTime,
      select: setSelection,
      tab: setTab,
      dispatch,
      rawProject: () => projectRef.current,
      history: () => historyRef.current,
      exportData: () => {
        const p = renderable(projectRef.current);
        return { project: { ...p, maskImages: maskImages(p), decoImages: decoImages(p), customMaskImages: customMaskImages(p), motion: motionDataPinned(p) } };
      },
      // Test hook: exports immediately (no summary gate), resolving settings the same way.
      exportNow: async () => { await graphicEdits.flush(); const p = renderable(projectRef.current); return runExportFlow(p, resolveExport(p)); },
      fxSelfTest: async () => (await import("../features/effects/selftest.js")).fxSelfTest(),
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
  // Native menu bar commands (macOS): the same actions as the buttons.
  const commandRef = useRef(null);
  commandRef.current = (command) => {
    if (command === 'settings') setSettingsOpen(true);
    else if (command === 'about') setAboutOpen(true);
    else if (command === 'open') open();
    else if (command === 'import') (screen === 'home' ? importFromHome() : importMedia());
    else if (screen === 'home') return;
    else if (command === 'save') save(false);
    else if (command === 'saveAs') save(true);
    else if (command === 'export') startExport();
    else if (command === 'home') (async () => { setPlaying(false); await flushAutosave(); refreshSlots(); setScreen('home'); })();
  };
  useEffect(() => window.api.onAppCommand?.((command) => commandRef.current?.(command)), []);
  const startExportRef = useRef(null);
  startExportRef.current = startAgentExport;
  // What CraftAI can do beyond project actions: add a file it fetched (library sound, stock clip, voice-over)
  // to the media library, start the export, check font names.
  const editorRef = useRef(null);
  editorRef.current = { playhead_sec: readTime(), selection, playing };
  const pilotApp = {
    seekTimeline: seek,
    getEditorState: () => ({ ...editorRef.current, playhead_sec: readTime() }),
    getAgentEdit: () => historyRef.current.agentEdit,
    getAgentInterruption: () => historyRef.current.agentInterruption,
    addProbed: (res, agentToken) => {
      if (!res?.path) return null;
      const m = projectRef.current.media.find((x) => x.path === res.path);
      return m || addItems([res], agentToken)[0] || null;
    },
    startExport: (...args) => startExportRef.current(...args),
    fontIds: () => allFonts().map((f) => f.id),
  };
  const projectRef = useRef(project);
  projectRef.current = project;
  const historyRef = useRef(state);
  historyRef.current = state;
  // After the assistant dispatches edits, wait for React to render them so the next tool reads the new project.
  const settle = useCallback(() => new Promise((r) => setTimeout(r, 60)), []);

  // ---- External agents over MCP (docs/design/external-agent-mcp.md): the project tools run through
  // the same functions Home and the top bar use, and return errors instead of showing them. ----
  const agentProjects = {
    status: () => ({ file: autosave.current.file || null, save_state: saveState }),
    list: async (query) => {
      const slots = await window.api.slotList?.().catch(() => []) || [];
      const list = (Array.isArray(slots) ? slots : []).map((x) => ({ id: x.id, name: x.title || 'Untitled', format: x.ratio || '', file: x.file || null, modified: x.updatedAt || 0 }));
      for (const r of recentsRef.current) {
        const same = list.find((e) => e.file && e.file === r.path);
        if (same) same.modified = Math.max(same.modified, r.modifiedAt || 0);
        else list.push({ id: r.path, name: r.name || 'Untitled', format: r.ratio || '', file: r.path, modified: r.modifiedAt || 0 });
      }
      const open = screen === 'editor' ? projectRef.current.id : null, q = String(query || '').trim().toLowerCase();
      return list.filter((e) => !q || e.name.toLowerCase().includes(q)).sort((a, b) => b.modified - a.modified).slice(0, 100)
        .map((e) => ({ ...e, modified: e.modified ? new Date(e.modified).toISOString() : null, open: e.id === open }));
    },
    create: async ({ format, fps = 30, name }) => {
      const preset = PRESETS.find((p) => p.ratio === format);
      if (!preset) return { error: `format must be one of ${PRESETS.map((p) => p.ratio).join(', ')}.` };
      setPlaying(false);
      await startNewProject(preset, fps, String(name || '').trim().slice(0, 120) || 'Untitled');
      await settle();
      return { created: projectRef.current.id };
    },
    open: async ({ id, path: filePath }) => {
      if (!id && !filePath) return { error: 'Give the id from list_projects, or the path of a .clipcraft.json file.' };
      setPlaying(false);
      const slots = await window.api.slotList?.().catch(() => []) || [];
      const result = id && slots.some?.((x) => x.id === id) ? await loadSlot(id)
        : await loadFile(filePath || id);
      await settle();
      return result;
    },
    save: async (target) => {
      const a = autosave.current;
      if (!target) {
        if (!a.file) return { error: 'This project has no file yet. Call save_project with path: an absolute path ending in .clipcraft.json. It is auto-saved for Home either way.' };
        const ok = await writeFile();
        await writeSlotNow();
        return ok ? { saved: true, file: a.file } : { error: 'Could not write the project file.' };
      }
      const p = projectRef.current;
      clearTimeout(a.fileTimer); a.fileTimer = null;
      const { pretty } = await serializeProject(p);
      await a.writing?.catch(() => {});
      const res = await window.api.saveProjectAgent(pretty, target, a.file);
      if (res?.error) return { error: res.error };
      a.file = res.file;
      setSaveState('saved');
      pushRecent(recentOf(p, res.file));
      await keepRecovery(false);
      await writeSlotNow(p, res.file);
      return { saved: true, file: res.file };
    },
    close: async () => {
      setPlaying(false);
      await flushAutosave();
      refreshSlots();
      setScreen('home');
      await settle();
      return { screen: 'home' };
    },
  };
  const externalApp = useRef(null);
  externalApp.current = {
    screen: () => screenRef.current, project: () => projectRef.current, loadVersion: () => loadVersionRef.current,
    dispatch, settle, pilotApp, craftBusy: () => !!agentRunRef.current, projects: agentProjects,
  };
  const external = useExternalAgent(externalApp, settingsVersion, !!agentRun, onAgentFocus);
  const externalBadge = <ExternalAgentBadge owner={external.owner} onDisconnect={external.disconnect} />;
  const externalApproval = <ExternalAgentApproval approval={external.approval} onAnswer={external.answer} />;

  // Keyboard shortcuts.
  const keys = useRef({});
  keys.current = { togglePlay, split, remove, duplicate, seek, readTime, trimSide, toggleMarker, setTool, copy, cut, paste, extractAudio: detachAudio, save };
  useEffect(() => {
    // Keys come from the user's keymap (Settings > Keyboard shortcuts).
    const onKey = (e) => {
      if (e.defaultPrevented || document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      const k = keys.current, action = actionFor(e);
      if (!action) return;
      const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName) || e.target.isContentEditable;
      if (typing && !WORKS_IN_FIELDS.has(action)) return;
      // Space on a focused button presses that button rather than playing.
      if (action === 'togglePlay' && e.code === 'Space' && e.target.closest('button')) return;
      const run = {
        togglePlay: () => k.togglePlay(), split: () => k.split(), duplicate: () => k.duplicate(), extractAudio: () => k.extractAudio(),
        copy: () => k.copy(), cut: () => k.cut(), paste: () => k.paste(), delete: () => k.remove(),
        undo: () => dispatch({ type: 'undo' }), redo: () => dispatch({ type: 'redo' }),
        stepBack: () => k.seek(k.readTime() - 1 / 30), stepForward: () => k.seek(k.readTime() + 1 / 30),
        jumpBack: () => k.seek(k.readTime() - 1), jumpForward: () => k.seek(k.readTime() + 1), goStart: () => k.seek(0),
        trimLeft: () => k.trimSide('left'), trimRight: () => k.trimSide('right'), marker: () => k.toggleMarker(),
        razorTool: () => k.setTool('razor'), selectTool: () => k.setTool('select'),
        save: () => k.save(false), saveAs: () => k.save(true),
      }[action];
      if (!run) return; // e.g. fullscreen: handled by the player
      // Same defaults as before remapping: only these keys suppress the browser's own
      // behaviour; Escape, Delete and clipboard keys still reach other listeners.
      if (['togglePlay', 'split', 'duplicate', 'extractAudio', 'save', 'saveAs'].includes(action)) e.preventDefault();
      run();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (screen === 'home') {
    return (
      <div className="app home-app">
        <HomeScreen recents={homeProjects} onNew={startNewProject} onOpen={open} onOpenRecent={openRecent}
          onRemoveRecent={removeHomeEntry} onImportMedia={importFromHome}
          onRecordStart={startRecording}
          unsavedNote={unsavedNote}
          onRestoreUnsaved={restoreUnsaved}
          onDiscardUnsaved={discardUnsaved} agentBadge={externalBadge} />
        {externalApproval}
        {closeAsk && <CloseDialog name={closeAsk.name} onChoice={closeAsk.resolve} />}
        {settingsOpen && <SettingsDialog initialSection={typeof settingsOpen === 'string' ? settingsOpen : 'ai'} onClose={() => { setSettingsOpen(false); setSettingsVersion((v) => v + 1); }}
          onAbout={() => setAboutOpen('settings')} updateReady={!!update?.newer} />}
        {aboutOpen && <AboutDialog update={update} onUpdate={setUpdate} onClose={() => { setAboutOpen(false); setUpdateSeen(true); if (aboutOpen === 'settings') setSettingsOpen(true); }}
          onWelcome={() => setAboutOpen(false)} />}
      </div>
    );
  }

  return (
    <div className={`app mode-${workspaceMode} ${dragOver ? 'drag-over' : ''} drawer-${agentDrawer || 'none'}`} style={{ gridTemplateRows: agentMode ? `48px 34px minmax(0, 1fr) ${panes.bottom}px` : `48px minmax(0, 1fr) ${panes.bottom}px`, ...(agentMode ? { gridTemplateColumns: `${panes.left}px minmax(0, 1fr)${agentDrawer ? ` ${panes.right}px` : ''}` } : {}), '--agent-bottom': `${panes.bottom}px`, '--agent-left': `${panes.left}px` }}
      onDragOver={(e) => { e.preventDefault(); if (isFiles(e) && !isInternal(e)) setDragOver(true); }}
      onDragLeave={(e) => { if (e.target === e.currentTarget) setDragOver(false); }}
      onDrop={onDrop}>
      <TopBar agentBadge={externalBadge} workspaceMode={workspaceMode} onWorkspaceModeChange={setWorkspaceMode} project={project} dispatch={dispatch} onOpen={open} onSave={save} saveState={saveState} onExport={startExport} onExportAudio={(f) => exportAudio(f)} onSettings={() => setSettingsOpen(true)}
        onHome={async () => { setPlaying(false); await flushAutosave(); refreshSlots(); setScreen('home'); }}
        updateReady={!!update?.newer} />

      <div className="agent-workspace-tools" hidden={!agentMode}>
        <button className="btn btn-sm" aria-expanded={agentDrawer === 'media'} onClick={() => { setTab('media'); setAgentDrawer(d => d === 'media' ? null : 'media'); }}>Media</button>
        <button className="btn btn-sm" aria-expanded={agentDrawer === 'properties'} onClick={() => setAgentDrawer(d => d === 'properties' ? null : 'properties')}>Properties</button>
        <button className="btn btn-sm" aria-expanded={panes.bottom > 220} onClick={() => setTimelineHeight(panes.bottom > 220 ? 180 : window.innerHeight * 0.5)}>{panes.bottom > 220 ? 'Compact timeline' : 'Expand timeline'}</button>
        <span className="muted">Drag the timeline border to expand</span>
        {agentDrawer && <button className="btn btn-sm" onClick={() => setAgentDrawer(null)}>Close tools</button>}
      </div>
      <div className="workspace" style={{ gridTemplateColumns: panes.rightCollapsed ? `${panes.left}px minmax(0, 1fr)` : `${panes.left}px minmax(0, 1fr) ${panes.right}px` }}>
        <LeftPanel tab={tab} setTab={setTab} media={project.media} dispatch={dispatch} settingsVersion={settingsVersion}
          onImport={importMedia} onAdd={addToTimeline} onAddAsOverlay={addAsOverlay} onLibraryAdd={libraryAdd} onStockAdd={stockAdd} onAddFile={addFile} stockKey={stockKey} onTtsAdd={ttsAdd} selectedText={selectedText}
          onOpenSettings={(section) => setSettingsOpen(typeof section === 'string' ? section : true)} onRemoveMedia={removeMedia} onPeek={peek} peekId={peekId} onPeekAsset={peekAsset}
          recorder={recorder} onStartRecord={() => recorder.start(readTime())} onAddText={addText} onAddTextOver={addTextOver}
          onRecordScreen={() => { setPlaying(false); setScreenOpen(true); }}
          target={target} updateTarget={updateTarget} selectedCount={selectedPictures(project, selection).length}
          wholeFilter={wholeFilter} onWholeVideoFilter={setWholeVideoFilter}
          onApplyLookToAll={(clip) => dispatch({ type: 'updateMany', updates: [
            ...project.videoClips.filter((c) => !c.gap).map((c) => ({ track: 'video', id: c.id, patch: { grade: { ...(clip.grade || {}) }, adjust: { ...(clip.adjust || {}) } } })),
            ...(project.overlayClips || []).map((c) => ({ track: 'overlay', id: c.id, patch: { grade: { ...(clip.grade || {}) }, adjust: { ...(clip.adjust || {}) } } })),
          ] })}
          clipSelected={selection?.track === 'video' || selection?.track === 'overlay'}
          onAddFreeEffect={(fx) => { const clipId = uid(); dispatch({ type: 'addEffectClip', clipId, fx, at: readTime() }); setSelection({ track: 'effect', id: clipId }); }}
          project={project} captions={{ ...captions, run: runCaptions }} />
        <Preview project={cropPreviewProject} editProject={project} selection={selection} onSelect={select} dispatch={dispatch} time={time} seekVer={seekVer} playing={playing} duration={duration}
          onTime={setTime} onEnd={() => setPlaying(false)} onTogglePlay={togglePlay} onSeek={seek} onDropItem={dropOnPreview}
          peek={project.media.find((m) => m.id === peekId) || assetPeek} onClosePeek={() => { setPeekId(null); setAssetPeek(null); }}
          onAddPeek={(m) => { setPeekId(null); setAssetPeek(null); if (m && m.assetPath) addFile(m.assetPath, m.assetWhere || 'main'); else if (m) addToTimeline(m.id); }}
          quality={quality} onQualityChange={async (q) => { const st = await window.api.qualitySet(q); setPlaybackQuality(st.quality); setQuality(st.quality); }}
          clockRef={clockRef}
          propertiesCollapsed={agentMode ? agentDrawer !== 'properties' : panes.rightCollapsed} onToggleProperties={() => agentMode ? setAgentDrawer(d => d === 'properties' ? null : 'properties') : setRightCollapsed(!panes.rightCollapsed)}
          trackPick={trackPick} onTrackPoint={(point) => setTrackPick((p) => (p ? { ...p, point } : p))}
          cropEdit={cropEdit} onCropDraft={setCropDraft}
          colorPick={colorPick} onColorPicked={finishColorPick} />
        <Inspector collapsed={agentMode ? agentDrawer !== 'properties' : panes.rightCollapsed} onCollapse={() => {
          if (agentMode) setAgentDrawer(null); else setRightCollapsed(true);
          requestAnimationFrame(() => document.querySelector('.properties-toggle')?.focus());
        }} project={project} selection={selection} dispatch={dispatch} duration={duration} time={time} clockRef={clockRef} playing={playing} onSeek={seek}
          onAddTextOver={addTextOver}
          onEnhance={(strength) => selection && enhanceClip({ track: selection.track, id: selection.id }, strength)}
          onTrackPick={(sel) => startTrackPick(sel)} onCropEdit={(sel) => startCropEdit(sel)} onColorPick={(sel) => startColorPick(sel)} />
        <Splitter which="left" style={{ left: panes.left + (agentMode ? 10 : 0) }} onStart={startResize} onReset={resetSize} onNudge={nudgeSize} label="Resize the left panel" />
        {!agentMode && !panes.rightCollapsed && <Splitter which="right" style={{ right: panes.right }} onStart={startResize} onReset={resetSize} onNudge={nudgeSize} label="Resize the properties panel" />}
      </div>
      <Splitter which="bottom" style={{ bottom: panes.bottom + 10, ...(agentMode ? { left: panes.left + 20 } : {}) }} onStart={startResize} onReset={resetSize} onNudge={nudgeSize} label="Resize the timeline" />

      <Timeline project={project} time={time} duration={duration} selection={selection} clockRef={clockRef} playing={playing}
        agentRun={agentRun?.runKey === `${project.id}:${projectLoadVersion}` ? agentRun : null}
        agentOwnsEdit={state.agentEdit?.token === agentRun?.requestId} agentHasChanges={!!state.agentEdit?.steps.length}
        onShowAgent={() => setWorkspaceMode('agent')}
        agentFocus={agentFocus?.runKey === `${project.id}:${projectLoadVersion}` ? (agentFocus.live && state.agentEdit?.token !== agentFocus.requestId ? { ...agentFocus, live: null } : agentFocus) : null}
        onSelect={select} onSeek={seek} dispatch={dispatch} onAttachContext={attachTimelineContext} contextVersion={projectLoadVersion}
        onDetach={() => detachAudio()} detachOk={detachOk} linkMode={linkMode}
        onLinkToggle={() => (linkMode === 'unlink' ? unlinkClip() : linkPair())}
        onSplit={split} onDelete={remove} onDuplicate={duplicate}
        tool={tool} setTool={setTool} onTrimSide={trimSide} onMarker={toggleMarker} recorder={recorder} onToggleRecord={toggleRecording}
        onDropItem={dropItem} onDropFiles={dropFiles} canUndo={!!state.past.length} canRedo={!!state.future.length} onClipMenu={openClipMenu} onAddText={addText}
        overlay={slots.length > 0 && <SlotStrip slots={slots} media={project.media} selection={selection} onPick={pickSlot} onReplace={replaceSlot} title={project.template?.title} />} />
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems(menu)} onClose={() => setMenu(null)} />}
      {speedAsk && (() => {
        const c = findClip(project, speedAsk);
        if (!c) return null;
        const m = c.mediaId && project.media.find((x) => x.id === c.mediaId);
        return (
          <SpeedDialog clip={c} name={m?.name || 'Clip'} onClose={() => setSpeedAsk(null)}
            onApply={(speed) => dispatch({ type: 'update', track: speedAsk.track, id: speedAsk.id, patch: { speed } })} />
        );
      })()}

      {(screenOpen || screenRec.active) && <ScreenRecordDialog rec={screenRec} at={readTime()} onClose={() => setScreenOpen(false)} />}
      {recoveredNote && (
        <div className="recovered-note" role="status">
          <b>ClipCraft had a problem and restarted its window.</b> Your project was restored as it was a second before.
          <button className="btn btn-sm" onClick={() => window.api.openCrashLog()}>Show crash log</button>
          <button className="icon-btn" aria-label="Close" onClick={() => setRecoveredNote(false)}>×</button>
        </div>
      )}
            {!updateSeen && !aboutOpen && <UpdateNotice update={update} onDismiss={() => setUpdateSeen(true)} />}
      {aboutOpen && <AboutDialog update={update} onUpdate={setUpdate} onClose={() => { setAboutOpen(false); setUpdateSeen(true); if (aboutOpen === 'settings') setSettingsOpen(true); }}
        onWelcome={() => { setAboutOpen(false); setWelcomeOpen(true); }} />}
      {welcomeOpen && <WelcomeCard onClose={closeWelcome} />}
      {closeAsk && <CloseDialog name={closeAsk.name} onChoice={closeAsk.resolve} />}
      {seqAsk && <SequenceDialog media={seqAsk.media} mismatch={seqAsk.mismatch}
        onChangeSettings={() => resolveSeq(true)} onKeepSettings={() => resolveSeq(false)} />}
      {settingsOpen && <SettingsDialog initialSection={typeof settingsOpen === 'string' ? settingsOpen : 'ai'} onClose={() => { setSettingsOpen(false); setSettingsVersion((v) => v + 1); }}
        onAbout={() => setAboutOpen('settings')} updateReady={!!update?.newer}
        onProxiesCleared={(deleted) => projectRef.current.media.forEach((m) => {
          if (m.lightProxy && deleted.includes(m.lightProxy)) dispatch({ type: 'mediaVisuals', path: m.path, patch: { lightProxy: null } });
          if (m.proxies) {
            const proxies = Object.fromEntries(Object.entries(m.proxies).map(([k, v]) => [k, deleted.includes(v) ? null : v]));
            if (JSON.stringify(proxies) !== JSON.stringify(m.proxies)) dispatch({ type: 'mediaVisuals', path: m.path, patch: { proxies } });
          }
        })} />}
      <CraftAI key={`${project.id}:${projectLoadVersion}`} getProject={() => projectRef.current} getHistoryLength={() => historyRef.current.past.length}
        runKey={`${project.id}:${projectLoadVersion}`} onRunStateChange={setAgentRun} onAgentFocus={onAgentFocus}
        onAttachmentDrag={() => setDragOver(false)}
        dispatch={dispatch} settle={settle} onOpenSettings={() => setSettingsOpen(true)} settingsVersion={settingsVersion}
        timelineContextRequest={timelineContextRequest?.projectId === project.id && timelineContextRequest.loadVersion === projectLoadVersion ? timelineContextRequest : null}
        presentation={agentMode ? 'docked' : 'floating'} onExpand={() => setWorkspaceMode('agent')}
        onImport={importMedia} onAttachSelection={() => selection && attachTimelineContext({ kind: 'clips', clip_refs: selection.items || [{ track: selection.track, id: selection.id }] })} hasSelection={!!selection}
        app={pilotApp} external={{ holder: external.holder, onDisconnect: external.disconnect, subscribe: external.subscribe }} />
      {externalApproval}
      {dragOver && <div className="drop-overlay"><div>Drop files to import them</div></div>}
      {renderJob && (
        <div className="render-job" role="status">
          {renderJob.error ? (
            <><CircleAlert size={15} /><span>{renderJob.error}</span>
              <button className="btn btn-sm" onClick={() => setRenderJob(null)}>Dismiss</button></>
          ) : (
            <><Loader2 size={15} className="spin" /><span>{renderJob.label}</span>
              <div className="progress render-job-bar"><div style={{ width: `${Math.round((renderJob.fraction || 0) * 100)}%` }} /></div>
              <button className="btn btn-sm btn-ghost" onClick={() => (renderJob.kind === 'detach' ? window.api.detachCancel() : renderJob.kind === 'enhance' ? window.api.enhanceCancel() : renderJob.kind === 'track' ? window.api.trackCancel() : window.api.reverseCancel())}>Cancel</button></>
          )}
        </div>
      )}
      {trackPick && (
        <div className="render-job" role="status">
          <Crosshair size={15} />
          <span>{trackPick.point ? 'Point set — track it through the whole clip?' : 'Click the object on the player that you want to follow'}</span>
          <button className="btn btn-sm" disabled={!trackPick.point} onClick={runTrack}>Track motion</button>
          <button className="btn btn-sm btn-ghost" onClick={() => setTrackPick(null)}>Cancel</button>
        </div>
      )}
      {cropEdit && (() => {
        const c = findClip(project, cropEdit);
        const cur = cropEdit.draftAspect || 'free';
        const rot = cropEdit.draftRot || 0;
        return (
          <div className="render-job crop-bar" role="status">
            <Crop size={15} />
            <span>Cropping{c ? ` “${project.media.find((m) => m.id === c.mediaId)?.name || 'clip'}”` : ''} — drag the frame's edges, or drag inside it to move it; what is dimmed gets cut. Nothing is applied until you confirm.</span>
            <span className="chips" role="group" aria-label="Crop aspect">
              {CROP_ASPECTS.map((a) => (
                <button key={a.id} type="button" className={`chip ${cur === a.id ? 'on' : ''}`} aria-pressed={cur === a.id}
                  onClick={() => applyCropAspect(a.id)}>{a.label}</button>
              ))}
            </span>
            <span className="crop-rot" role="group" aria-label="Rotate or straighten">
              <RotateCw size={13} />
              <input type="range" min="-45" max="45" step="0.5" value={Math.min(45, Math.max(-45, rot))} aria-label="Rotate (degrees)"
                onChange={(e) => setCropRot(Number(e.target.value))} />
              <input type="number" className="crop-rot-num" min="-180" max="180" step="0.5" value={rot} aria-label="Rotation in degrees"
                onChange={(e) => setCropRot(Number(e.target.value))} />
              <span className="crop-rot-val">{rot > 0 ? `+${rot}` : rot}°</span>
            </span>
            <button className="btn btn-sm" onClick={doneCropEdit}>Done</button>
            <button className="btn btn-sm btn-ghost" onClick={cancelCropEdit}>Cancel</button>
          </div>
        );
      })()}
      {colorPick && (
        <div className="render-job" role="status">
          <Pipette size={15} />
          <span>Click the color in the player — that exact pixel becomes the key color.</span>
          <button className="btn btn-sm btn-ghost" onClick={() => setColorPick(null)}>Cancel</button>
        </div>
      )}
      {exporting && <ExportDialog state={exporting} onCancel={cancelExport} onStart={confirmExport}
        onClose={() => { if(exportRunning.current)return; if(exporting.target?.frameDir)window.api.exportAbort(exporting.target.frameDir);setExporting(null); }} onShow={() => window.api.showInFolder(exporting.file)}
        onOpen={() => window.api.openFile(exporting.file)} onPickTarget={pickExportTarget}
        onRename={renameExport} onSettings={changeExportSettings} onResolution={changeExportResolution}
        onPosterAt={changePosterAt} onPosterImage={changePosterImage} />}
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
