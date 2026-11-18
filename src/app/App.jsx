import ExtensionActionIcon from '../features/plugins/components/ExtensionActionIcon.jsx';
import ExtensionPreparation from '../features/plugins/components/ExtensionPreparation.jsx';
import {useExtensionShortcuts} from '../features/plugins/useExtensionShortcuts.js';
import ExtensionMessages from '../features/plugins/components/ExtensionMessages.jsx';
import ExtensionMediaPreview from '../features/plugins/components/ExtensionMediaPreview.jsx';
import {useExtensionHost} from '../features/plugins/useExtensionHost.js';
import {packBrowserApplication} from '../../shared/pluginBrowserApply.mjs';
import {dependencyReplacementUpdates} from '../../shared/pluginDependencies.mjs';
import {pluginEditsApplied,historyOrigin} from '../state/store.js';
import {createEditorContext} from '../features/plugins/editorContext.js';
import PluginWorkbench from '../features/plugins/components/PluginWorkbench.jsx';
import {useExtensionUi,extensionUiError} from '../features/plugins/useExtensionUi.js';
import {refreshPluginEffects,subscribePluginEffects,pluginEffectsRevision,assertPluginEffects} from '../features/plugins/effectRegistry.js';
import { useMemo, useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { createTimelineAttachment } from '../features/agent/timelineContext.js';
import { recentEntryFor } from './recents.js';
import { LAYERED, LINK_FILE_SLACK, openLayer, canvasFor, clipLocked, clipLayer, emptyProject, exportDuration, findClipIn, findLinkPartner, linkPairBatch, freeLen, historyReducer, isLayerLocked, layerCount, layerFree, layerName, layerOf, levelCopyState, lockedMediaUse, markerNear, normalizeProject, parseEffectKey, pickAttributes, projectDuration, renderable, setPlaybackQuality, toFileUrl, trimActions, uid, videoClipAt, videoLayout } from "../state/store.js";
import HomeScreen, { PRESETS } from './components/HomeScreen.jsx';
import { ExternalAgentApproval, ExternalAgentBadge } from './components/ExternalAgent.jsx';
import { useExternalAgent } from './useExternalAgent.js';
import { createExtensionEditorTools } from '../features/plugins/extensionEditorTools.js';
import SequenceDialog from "../features/timeline/components/SequenceDialog.jsx";
import { mismatchFor, sequencePatchFor } from "../features/timeline/sequence.js";
import { reverseUpdates, unreverseUpdates } from "../features/timeline/reverse.js";
import { sizeFor } from "../features/effects/effects.js";
import { filterFx, isFilterFx } from "../features/effects/filters.js";
import ContextMenu from "../components/ui/ContextMenu.jsx";
import ErrorBoundary from "../components/ui/ErrorBoundary.jsx";
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
import { serializeProject, serializeProjectParts } from '../state/projectSerialization.js';
import { projectDoc, projectChat, classifyChange, mergeChat, sameDoc } from '../state/projectFile.js';
import CloseDialog from './components/CloseDialog.jsx';
import TopBar from './components/TopBar.jsx';
import SettingsDialog from './components/SettingsDialog.jsx';
import { actionFor, setActiveKeymap, WORKS_IN_FIELDS } from './keymap.js';
import { showAlert, askConfirm } from './dialogs.js';
import { AboutDialog } from './components/About.jsx';
import ScreenRecordDialog from "../features/recording/components/ScreenRecordDialog.jsx";
import { useScreenRecorder } from "../features/recording/useScreenRecorder.js";
import CraftAI from "../features/agent/components/CraftPilot.jsx";
import { hasChatContent } from "../features/agent/chatSessions.js";
import { isFiles, isInternal } from "../features/timeline/dnd.js";
import { renderTextFrames } from "../features/export/exportText.js";
import { fxWork, renderFxPass } from "../features/export/fxExport.js";
import { TEXT_TEMPLATES } from "../features/text/catalog.js";
import { allFonts,fontsReady } from "../features/text/fonts.js";
import { graphicOutdated, isGraphicMedia, redrawGraphicAction, renderGraphicMedia } from '../features/graphics/graphicMedia.js';
import { graphicEdits } from '../features/graphics/graphicEdits.js';
import { t, tn } from '../i18n/index.js';
import { catalogName } from '../i18n/catalog.js';

// (The emoji-to-PNG rasterizer that lived here served only the Stickers feature, removed
// in R1 — emoji inside TEXT clips render through the text pipeline, not this helper.)

export default function App() {
  const [,setPluginRevision]=useState(pluginEffectsRevision);
  useEffect(()=>{
    let live=true;
    const off=subscribePluginEffects(()=>{if(live)setPluginRevision(pluginEffectsRevision());});
    const refresh=()=>refreshPluginEffects().catch(error=>{if(live)showAlert(error.message);});
    refresh();const changed=window.api?.onPluginsChanged?.(refresh);
    return ()=>{live=false;off();changed?.();};
  },[]);

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
  const extensionExportClose=useRef(null);
  useEffect(()=>{if(!exporting){const ready=extensionExportClose.current;extensionExportClose.current=null;ready?.();}},[exporting]);
  const [agentRendering,setAgentRendering] = useState(false);
  const [agentRun, setAgentRun] = useState(null);
  const agentRunRef = useRef(agentRun);
  agentRunRef.current = agentRun;
  // Timeline spotlight and trail (docs/agents/agent-editing.md): what CraftAI works on now and what it
  // changed this request. Outside the history reducer: it never makes an Undo step or revokes the agent.
  // The run's end starts a 6 s hold, then a fade; a history move afterwards (undo, redo, load) clears it.
  // An outside MCP agent (useExternalAgent) feeds the same state, so its edits show the same way.
  const [agentFocus, setAgentFocus] = useState(null);
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
  const [pluginPanelsOpen,setPluginPanelsOpen]=useState(false);
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
      const { compact } = await serializeProject(projectDoc(project));
      if (version !== autosave.current.recoveryVersion) return;
      const recovery=`{"savedAt":${Date.now()},"project":${compact},"file":${JSON.stringify(file || null)},"unsaved":${!!unsaved}}`;
      await window.api.writeProjectRecovery(recovery);
      if (version !== autosave.current.recoveryVersion) return;
      localStorage.setItem('clipcraft.recovery', recovery);
    } catch {
      // storage full: the next save tries again
    }
  };
  // The document and its chat sidecar are written apart (docs/architecture/project-file.md):
  // a.fileChat / a.slotChat remember the chat last written to each, so a timeline edit carries the
  // chat only when it changed too, and a chat change (writeChat) never rewrites the document.
  const chatText = async (project) => { const chat = projectChat(project); return chat ? (await serializeProject(chat, { pretty: false })).compact : null; };
  const writeFile = async () => {
    const a = autosave.current;
    clearTimeout(a.fileTimer);
    a.fileTimer = null;
    a.fileDocDirty = false;
    if (!a.file) return true;
    const file = a.file, project = a.project, chatStale = a.fileChat !== project.craftAI;
    setSaveState('saving');
    let ok = false;
    try {
      const previous = a.writing || Promise.resolve();
      a.writing = previous.catch(() => {}).then(async () => {
        const { pretty } = await serializeProject(projectDoc(project));
        const done = await window.api.autosaveProject(file, pretty, chatStale ? await chatText(project) : undefined);
        if (done && chatStale && a.file === file) a.fileChat = project.craftAI;
        return done;
      });
      ok = await a.writing;
    } catch { /* The save-state pill reports the failed attempt. */ }
    if (!ok) a.fileDocDirty = true; // the next timer writes the document again, not only the chat
    setSaveState(ok ? 'saved' : 'error');
    return ok;
  };
  const writeChat = async () => {
    const a = autosave.current;
    clearTimeout(a.fileTimer);
    a.fileTimer = null;
    if (!a.file) return true;
    const file = a.file, project = a.project;
    if (a.fileChat === project.craftAI) return true;
    try {
      a.writing = (a.writing || Promise.resolve()).catch(() => {}).then(async () => {
        const done = await window.api.autosaveProject(file, null, await chatText(project));
        if (done && a.file === file) a.fileChat = project.craftAI;
        return done;
      });
      return await a.writing;
    } catch { return false; } // the next chat change retries
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
    const { compact } = await serializeProject(projectDoc(p));
    const chatStale = autosave.current.slotChat !== p.craftAI;
    return { id: p.id, title: p.name || 'Untitled', file: file || null, ratio: p.ratio || '', thumb: e.thumb, updatedAt: Date.now(), projectJson: compact,
      ...(chatStale ? { chatJson: await chatText(p) } : {}) };
  };
  const writeSlotNow = async (p = autosave.current.project, file = autosave.current.file) => {
    const a = autosave.current;
    clearTimeout(a.slotTimer);
    a.slotTimer = null;
    a.slotDocDirty = false;
    try {
      a.slotWriting = (a.slotWriting || Promise.resolve()).catch(() => {}).then(async () => {
        const rec = await slotRecord(p, file);if (!rec) return;
        // A failed write marks nothing as written: the next change writes the whole slot again.
        if (!await window.api.slotWrite(rec)) { a.slotDocDirty = true; return; }
        refreshSlots();
        a.slotDocId = p.id;
        if (rec.chatJson !== undefined && a.project.craftAI === p.craftAI) a.slotChat = p.craftAI;
      });
      await a.slotWriting;
    } catch { /* the next change retries */ }
  };
  // Only the chat changed: write the slot's chat file alone (the whole slot when it has none yet).
  const writeSlotChatNow = async () => {
    const a = autosave.current, p = a.project;
    if (a.slotDocId !== p.id) return writeSlotNow();
    clearTimeout(a.slotTimer);
    a.slotTimer = null;
    if (a.slotChat === p.craftAI || !p.id || isTourId(p.id)) return;
    try {
      a.slotWriting = (a.slotWriting || Promise.resolve()).catch(() => {}).then(async () => {
        const written = await window.api.slotWriteChat?.(p.id, await chatText(p));
        if (written && a.project.craftAI === p.craftAI) a.slotChat = p.craftAI;
      });
      await a.slotWriting;
    } catch { /* the next change retries */ }
  };
  // Closing with "Don't save" on a project that existed before this session: its slot goes back to the
  // state it was loaded in (slot: the slot it was opened from, for its header; null when it had none).
  const restoreLoadedSlot = async (base, slot) => {
    const { compact } = await serializeProject(projectDoc(base));
    await window.api.slotWrite({ id: base.id, title: slot?.title || base.name || 'Untitled', file: null, ratio: slot?.ratio || base.ratio || '',
      thumb: slot ? slot.thumb || null : recentEntryFor(base, '', toFileUrl).thumb, updatedAt: slot?.updatedAt || Date.now(), projectJson: compact, chatJson: await chatText(base) });
  };
  // Force-write everything pending for the CURRENT project (its file, then its slot) —
  // awaited before any switch (Home, new, open) so no edit hides inside a debounce window.
  // Resolves false when the project's file could not be written (its slot is still written).
  const flushAutosave = async () => {
    const written = await writeFile();
    await writeSlotNow();
    return written;
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
    // Which part changed (docs/architecture/project-file.md). A load counts as both: a file that
    // still embeds its chat gets its sidecar on the first write, and the last-written marks reset.
    const loaded = a.seenLoad !== projectLoadVersion, previous = a.seen;
    a.seen = project; a.seenLoad = projectLoadVersion;
    if (loaded) { a.fileChat = undefined; a.slotChat = undefined; a.loadedProject = project; } // closing compares against it
    const change = classifyChange(previous, project);
    const docChanged = loaded || change.doc, chatChanged = loaded || change.chat;
    if (!docChanged && !chatChanged) return;
    if (docChanged) { a.fileDocDirty = true; a.slotDocDirty = true; }
    // At most once a second, and always the latest project (thumbnails arriving keep changing it).
    if (docChanged && !a.timer) {
      const tick = () => {
        a.timer = null;
        // A drag in progress changes the project on every pointer move: the whole-project copy to
        // the serializer waits for the release, then runs on the final state (the same one-second
        // cadence otherwise; nothing a crash could lose is older than the gesture).
        if (historyRef.current?.gestureStart) { a.timer = setTimeout(tick, 1000); return; }
        // An unsaved project offered back at start stays stored until the user answers or starts working.
        if (a.pendingRestore && !hasContent(a.project)) return;
        a.pendingRestore = false;
        keepRecovery(!a.file && hasContent(a.project));
      };
      a.timer = setTimeout(tick, 1000);
    }
    if (a.file) {
      clearTimeout(a.fileTimer);
      a.fileTimer = setTimeout(() => (a.fileDocDirty ? writeFile() : writeChat()), 1500);
    }
    // The project's own autosave slot, a second after the last change (true debounce:
    // thumbnail arrivals keep pushing it out, the write always carries the latest state).
    clearTimeout(a.slotTimer);
    a.slotTimer = setTimeout(() => { a.slotTimer = null; (a.slotDocDirty ? writeSlotNow : writeSlotChatNow)(); }, 1000);
  }, [project, projectLoadVersion]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const startupProject = autosave.current.project;
    let saved = null;
    try {
      saved = JSON.parse(localStorage.getItem('clipcraft.recovery') || 'null');
    } catch {
      // nothing usable saved
    }
    window.api.wasRecovered?.().then(async (was) => {
      // Prefer the atomically persisted native recovery over its localStorage
      // mirror, whose flush may lag after a hard kill. A missing native copy
      // falls back to the older localStorage-only format.
      try { const native=await window.api.readProjectRecovery();if(native!==null)saved=JSON.parse(native); } catch { return; }
      // The project's autosave slot is
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
        autosave.current.origin = { created: false, slot: null }; // it existed before this session
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
    const missing = project.media.filter((m) => !m.missing && ((m.type === 'video' && (!m.thumbCount || !m.poster || m.optimizing || levelCopyState(m, quality) === 'fallback')) || (m.hasAudio && !m.wave)));
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
    // Transcribing takes a while: the result belongs to the project load it was made for, never to
    // one opened meanwhile (the same rule as clipJob below).
    const pid = projectRef.current.id, version = loadVersionRef.current;
    // Cloud engines return the same segment shape, so everything after this call —
    // caption clips, styling, apply-to-all — is the one shared path.
    let res;
    try {
      res = engine === 'cloud'
        ? await window.api.runCaptionsCloud(project, engineOpts)
        : await window.api.runCaptions(project, engineOpts);
    } catch (e) { res = { error: e.message }; }
    off();
    if (projectRef.current.id !== pid || loadVersionRef.current !== version) { setCaptions((c) => ({ ...c, busy: false })); return; }
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
    if (bad.length) showAlert(t('app.could_not_import_list', { list: bad.map((b) => t('app.name_and_error', { name: b.name, error: b.error })).join('\n') }));
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

  // The open project at the start of a slow add (download, synthesis, probe, recording), like clipJob:
  // its result lands only in that project. Opened another meanwhile: the result is dropped (any
  // downloaded or recorded file stays on disk).
  const projectStamp = () => {
    const pid = projectRef.current.id, version = loadVersionRef.current;
    return () => projectRef.current.id === pid && loadVersionRef.current === version;
  };
  // A sound from the audio library: one media item per file (reused), clip on the Audio track at the playhead.
  const libraryAdd = async (item) => {
    const still = projectStamp();
    const res = await window.api.libraryAdd(item);
    if (res.error) return res;
    if (!still()) return { canceled: true };
    let m = projectRef.current.media.find((x) => x.path === res.path);
    if (!m) [m] = addItems([res]);
    if (!m) return { error: t('app.could_not_add_the_sound') };
    const clipId = uid();
    dispatch({ type: 'addToTimeline', mediaId: m.id, clipId, at: readTime() });
    setSelection({ track: 'audio', id: clipId });
    return { ok: true };
  };

  // Text to speech: the voice goes on the Audio track where the selected text starts, or at the playhead.
  const selectedText = selection?.track === 'text' ? project.textClips.find((c) => c.id === selection.id) : null;
  const ttsAdd = (res, atText, still) => {
    if (still && !still()) return; // the voice was made for a project that is no longer open
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
    const still = projectStamp();
    const res = await window.api.stockAdd(item);
    if (res.error) return res;
    if (!still()) return { canceled: true };
    let m = projectRef.current.media.find((x) => x.path === res.path);
    if (!m) [m] = addItems([res]);
    if (!m) return { error: t('app.could_not_add_the_file') };
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
  const addFile = async (filePath, where = 'main', packMetadata) => {
    let m = projectRef.current.media.find((x) => x.path === filePath);
    if (!m) {
      const still = projectStamp();
      const [res] = await window.api.probePaths([filePath]);
      if (!res || res.error) return { error: res ? t('app.name_and_error', { name: res.name, error: res.error }) : t('app.the_file_was_not_found') };
      if (!still()) return { canceled: true };
      [m] = addItems([{...res,...(packMetadata?{name:packMetadata.name,credit:packMetadata.credit,origin:'plugin-pack'}:{})}]);
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
  const recordStamp = useRef(null); // the project the voice-over was started in
  const recorder = useRecorder((item, at) => {
    if (recordStamp.current && !recordStamp.current()) return; // recorded for a project no longer open (the file is kept)
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
    if (lockedUse) { showAlert(t('app.media_on_locked_layer', { name: m.name, layer: layerName(p, lockedUse.track, lockedUse.layer) })); return; }
    const used = [p.videoClips, p.overlayClips || [], p.audioClips].reduce((n, list) => n + list.filter((c) => c.mediaId === id).length, 0);
    if (used && !askConfirm(tn('app.media_used_by_clips', used, { name: m.name }), t('home.remove'))) return;
    dispatch({ type: 'removeMedia', id });
  };
  // Locate…: an offline item is pointed at its file again (its id and clips stay); other offline items from the
  // same old folder follow when their files sit at the same relative place under the new folder. One Undo step.
  const locateMedia = async (id) => {
    const m = projectRef.current.media.find((x) => x.id === id);
    if (!m || !window.api.locateMedia) return;
    const res = await window.api.locateMedia(m.path, projectRef.current.media.filter((x) => x.missing && x.id !== id).map((x) => x.path));
    if (!res?.path) return;
    const others = projectRef.current.media.filter((x) => x.missing && x.id !== id && typeof res.moved?.[x.path] === 'string');
    dispatch({ type: 'relinkMedia', changes: [{ id, path: res.path }, ...others.map((x) => ({ id: x.id, path: res.moved[x.path] }))] });
  };

  const startVoiceOver = () => { recordStamp.current = projectStamp(); return recorder.start(readTime()); };
  const toggleRecording = () => (recorder.recording ? recorder.stop() : startVoiceOver());

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

  const replacePackDependency = request => {
    const current=projectRef.current,updates=dependencyReplacementUpdates(current,request);
    if(updates.some(u=>clipLocked(current,u.track,findClipIn(current,u.track,u.id))))throw Error(t('plugins.dependency_locked'));
    if(updates.length)dispatch({type:'updateMany',updates});return updates.length;
  };

  const applyPackContent = async request => {
    if(screen!=='editor')throw Error(t('plugins.browser_open_project'));
    const captured=projectRef.current,selected=selection;
    const fresh=await window.api.pluginsPreviewContent({key:request.key,kind:request.kind,id:request.item.id});
    if(projectRef.current!==captured)throw Error(t('plugins.project_changed'));
    const plan=packBrowserApplication(captured,selected,{...fresh,params:request.params});
    const textTargets=plan.title?[plan.title]:(plan.updates||[]).filter(u=>u.track==='text').map(u=>({...captured.textClips.find(c=>c.id===u.id),...u.patch}));
    if(textTargets.length){await fontsReady(textTargets,{strict:true});if(projectRef.current!==captured)throw Error(t('plugins.project_changed'));}
    if(plan.title){addText(plan.title);return;}
    if(plan.soundId){const sound=await window.api.pluginsSoundAsset(plan.soundId);if(projectRef.current!==captured)throw Error(t('plugins.project_changed'));const result=await addFile(sound.path,'audio',sound);if(result?.error)throw Error(result.error);return;}
    if(plan.updates.some(u=>clipLocked(captured,u.track,findClipIn(captured,u.track,u.id))))throw Error(t('plugins.dependency_locked'));
    dispatch({type:'updateMany',updates:plan.updates});
  };

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
    const at = readTime();
    if (selection?.items) {
      // Several clips: every selected clip under the playhead is cut, one undo step for all of
      // them (a linked partner is cut by its pair, so the second half of a pair is skipped).
      const p = projectRef.current, seen = new Set();
      dispatch({ type: 'beginGesture', group: true });
      for (const it of selection.items) {
        if (seen.has(`${it.track}:${it.id}`)) continue;
        const partner = findLinkPartner(p, findClipIn(p, it.track, it.id));
        if (partner) seen.add(`${partner.track}:${partner.clip.id}`);
        dispatch({ type: 'split', track: it.track, id: it.id, t: at, newId: uid() });
      }
      dispatch({ type: 'endGesture', group: true });
      return;
    }
    let tgt = selection;
    if (!tgt) {
      const v = videoClipAt(project, at);
      if (v) tgt = { track: 'video', id: v.clip.id };
    }
    if (tgt) dispatch({ type: 'split', track: tgt.track, id: tgt.id, t: at, newId: uid() });
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
      dispatch({ type: 'beginGesture', group: true });
      actions.forEach((a) => dispatch(a));
      dispatch({ type: 'endGesture', group: true });
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
      dispatch({ type: 'beginGesture', group: true });
      // Sounds first: a picture removed first would pull its linked sound onto the next one's spot
      // (link sync) before that one goes, so the result depended on which clip was clicked.
      [...selection.items].sort((x, y) => (y.track === 'audio') - (x.track === 'audio')).forEach(removeOne);
      dispatch({ type: 'endGesture', group: true });
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
  // A slow clip job (detach, enhance, reverse, freeze, track) resolves after other work may have run:
  // call before awaiting; the returned check is true only while the same project load is open and the
  // clip still plays the same window, so a result never lands in another project or on a changed clip.
  const clipJob = (sel, c) => {
    const pid = projectRef.current.id, version = loadVersionRef.current;
    return () => {
      const p = projectRef.current;
      if (p.id !== pid || loadVersionRef.current !== version) return false;
      const now = findClip(p, sel);
      return !!now && now.mediaId === c.mediaId && (now.in || 0) === (c.in || 0) && now.out === c.out && (now.speed || 1) === (c.speed || 1);
    };
  };
  const copy = useCallback(() => {
    const c = findClip(project, selection);
    // The clip's media item travels with it: a paste into another project adds it there (see 'paste').
    if (c && !c.gap) setClipboard({ track: selection.track, clip: c, media: c.mediaId ? project.media.find((m) => m.id === c.mediaId) || null : null });
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
    const p = projectRef.current, { clip, media } = clipboard;
    if (clip.mediaId && !p.media.some((m) => m.id === clip.mediaId) && !media?.path) { showAlert(t('app.paste_media_missing')); return; }
    const newId = uid();
    dispatch({ type: 'paste', track: clipboard.track, clip, media, mediaId: uid(), at: readTime(), newId });
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
    setRenderJob({ kind: 'detach', label: t('app.detaching_audio'), fraction: 0 });
    const current = clipJob(sel, c);
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
    if (!current()) return; // another project, or the clip changed while rendering
    const start = sel.track === 'video'
      ? (videoLayout(projectRef.current.videoClips).find((l) => l.clip.id === c.id)?.start ?? 0)
      : c.start;
    const linkId = uid();
    const audioId = uid();
    const now = projectRef.current;
    let media = now.media.find((x) => x.path === res.path);
    const actions = [];
    if (!media) { media = { ...res, id: uid(), origin: 'detach' }; actions.push({ type: 'addMedia', items: [media] }); } // Media tree: Generated ▸ Processed
    // The render is padded to the clip's length; a probe a few milliseconds short of it still
    // takes the clip's whole window (the pair check would refuse a shorter one).
    const want = c.out - c.in, speed = c.speed || 1;
    const out = res.duration && res.duration < want - LINK_FILE_SLACK ? res.duration : want;
    actions.push({ type: 'update', track: sel.track, id: sel.id, patch: { muted: true, linkId } });
    // The sound goes on the first audio layer with room that is not locked, hidden or muted.
    actions.push({ type: 'insertAudioClip', clip: {
      id: audioId, mediaId: media.id, start, in: 0, out, layer: openLayer(now, 'audio', start, out / speed),
      speed, volume: c.volume ?? 1, fadeIn: 0, fadeOut: 0,
      linkId, linkOff: 0, linkInOff: -(c.in || 0),
    } });
    // All or nothing: one step that mutes the picture only together with the sound's insert.
    const batch = { type: 'batch', actions };
    if (historyReducer(historyRef.current, batch) === historyRef.current) { setRenderJob({ error: t('app.detach_refused') }); return; }
    dispatch({ type: 'beginGesture', group: true });
    dispatch(batch);
    dispatch({ type: 'endGesture', group: true });
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
    setRenderJob({ kind: 'enhance', label: t('app.enhancing_voice'), fraction: 0 });
    const current = clipJob(sel, c);
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
    if (!current()) return; // another project, or the clip changed while rendering
    dispatch({ type: 'update', track: sel.track, id: sel.id, patch: { enhance: { on: true, strength, path: res.path, from: c.in || 0, to: c.out ?? m.duration } } });
  }, []);

  // Unlink a linked pair: both clips become independent (one undo step).
  const unlinkClip = useCallback((sel = selection) => {
    const p = projectRef.current;
    const c = sel && findClip(p, sel);
    if (!c || !c.linkId) return;
    const partner = findLinkPartner(p, c);
    dispatch({ type: 'beginGesture', group: true });
    dispatch({ type: 'update', track: sel.track, id: sel.id, patch: { linkId: undefined, linkOff: undefined, linkInOff: undefined } });
    if (partner) dispatch({ type: 'update', track: partner.track, id: partner.clip.id, patch: { linkId: undefined, linkOff: undefined, linkInOff: undefined } });
    dispatch({ type: 'endGesture', group: true });
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
    // All or nothing: the picture never keeps a link its sound did not receive.
    const batch = linkPairBatch(p, pic, aud, uid());
    if (!batch || historyReducer(historyRef.current, batch) === historyRef.current) { setRenderJob({ error: t('app.link_refused') }); return; }
    dispatch({ type: 'beginGesture', group: true });
    dispatch(batch);
    dispatch({ type: 'endGesture', group: true });
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
    dispatch({ type: 'beginGesture', group: true });
    items.forEach((it) => dispatch({ type: 'update', track: it.track, id: it.id, patch: { layer } }));
    dispatch({ type: 'endGesture', group: true });
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
    setExporting({ progress: 0.5, stage: t('app.exporting_audio') });
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
    const at = readTime() > start && readTime() < start + len ? readTime() : start;
    const srcT = (c.in || 0) + (at - start) * (c.speed || 1);
    const current = clipJob(sel, c);
    let fm;
    try { fm = await window.api.frameImage(m.path, srcT); } catch (e) { fm = { error: e.message }; }
    if (!fm || fm.error) { setRenderJob({ error: (fm && fm.error) || t('app.could_not_grab_the_frame') }); return; }
    if (!current()) return; // another project, or the clip changed meanwhile
    let media = projectRef.current.media.find((x) => x.path === fm.path);
    const stillId = uid();
    dispatch({ type: 'beginGesture', group: true });
    if (!media) { media = { ...fm, id: uid() }; dispatch({ type: 'addMedia', items: [media] }); }
    if (sel.track === 'video') {
      const idx = videoLayout(p.videoClips).findIndex((x) => x.clip.id === c.id);
      let insertIndex = idx;
      if (at > start + 0.01) {
        if (at < start + len - 0.01) dispatch({ type: 'split', track: 'video', id: c.id, t: at, newId: uid() });
        insertIndex = idx + 1;
      }
      dispatch({ type: 'addToTimeline', mediaId: media.id, clipId: stillId, index: insertIndex });
    } else {
      const secondId = uid();
      const interior = at > start + 0.01 && at < start + len - 0.01;
      if (interior) {
        dispatch({ type: 'split', track: 'overlay', id: c.id, t: at, newId: secondId });
        dispatch({ type: 'update', track: 'overlay', id: secondId, patch: { start: at + 4 } });
      } else {
        dispatch({ type: 'update', track: 'overlay', id: c.id, patch: { start: (c.start || 0) + 4 } });
      }
      dispatch({ type: 'addOverlayClip', mediaId: media.id, clipId: stillId, at, layer: c.layer });
      dispatch({ type: 'update', track: 'overlay', id: stillId, patch: { transform: c.transform || undefined } });
    }
    dispatch({ type: 'endGesture', group: true });
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
      // Back to the original, on the part of it this clip (or this piece of it) plays now.
      dispatch({ type: 'updateMany', updates: unreverseUpdates(p, sel.track, c) });
      return;
    }
    setRenderJob({ kind: 'reverse', label: t('app.reversing_clip'), fraction: 0 });
    const current = clipJob(sel, c);
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
    if (!current()) return; // another project, or the clip changed while rendering
    let media = projectRef.current.media.find((x) => x.path === res.path);
    dispatch({ type: 'beginGesture', group: true });
    if (!media) { media = { ...res, id: uid(), origin: 'reverse' }; dispatch({ type: 'addMedia', items: [media] }); } // Media tree: Generated ▸ Processed
    const now = findClip(projectRef.current, sel);
    dispatch({ type: 'updateMany', updates: reverseUpdates(projectRef.current, sel.track, { ...now, out: now.out ?? m.duration }, media) });
    dispatch({ type: 'endGesture', group: true });
  };

  const openClipMenu = (e, track, clip) => {
    const clicked = { track, id: clip.id };
    const existing = selection?.items || (selection ? [{ track: selection.track, id: selection.id }] : []);
    const included = existing.some(r => r.track === track && r.id === clip.id);
    if (!included) select(clicked); // like a left click: a linked pair is selected together
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
      dispatch({ type: 'beginGesture', group: true });
      dispatch({ type: 'update', track: cropEdit.track, id: cropEdit.id, patch: { crop: draftCrop, cropAspect: draftAspect, transform: { ...transformOf(c), rot: draftRot } } });
      dispatch({ type: 'endGesture', group: true });
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
    setRenderJob({ kind: 'track', label: t('app.tracking_motion_in_name', { name: m.name || t('app.clip').toLowerCase() }), fraction: 0 });
    const off = window.api.onTrackProgress(({ fraction }) => setRenderJob((j) => (j && j.kind === 'track' ? { ...j, fraction } : j)));
    const current = clipJob(pick, c);
    let res = null;
    try { res = await window.api.trackRun(m, c.in || 0, c.out ?? m.duration, pick.point, pick.box); } catch { /* reported below */ }
    off();
    if (res && res.points && res.points.length && !current()) { setRenderJob(null); return; } // another project, or the clip changed
    if (res && res.points && res.points.length) {
      dispatch({ type: 'beginGesture', group: true });
      dispatch({ type: 'update', track: pick.track, id: pick.id, patch: { track: { points: res.points, box: pick.box, fps: res.fps } } });
      dispatch({ type: 'endGesture', group: true });
      setRenderJob(null);
    } else if (res && res.canceled) setRenderJob(null);
    else setRenderJob({ error: (res && res.error) || t('app.tracking_failed') });
  };
  const attachTimelineContext = (input) => {
    const request = { id: uid(), projectId: projectRef.current.id, loadVersion: projectLoadVersion };
    try { request.attachment = createTimelineAttachment(projectRef.current, input); }
    catch (error) { request.error = error.message; }
    setTimelineContextRequest(request);
  };
  const menuItems = (sel) => [
    { label: t((sel.clip_refs?.length || 1) > 1 ? 'app.add_selected_clips_to_craftai' : 'app.add_clip_to_craftai'), icon: MessageSquarePlus,
      onClick: () => attachTimelineContext({ kind: 'clips', clip_refs: sel.clip_refs || [{ track: sel.track, id: sel.id }] }) },
    { label: t('app.add_clip_time_range_to_craftai'), icon: ScanLine, onClick: () => {
      try {
        const clip = createTimelineAttachment(projectRef.current, { kind: 'clips', clip_refs: [{ track: sel.track, id: sel.id }] });
        attachTimelineContext({ kind: 'range', start_sec: clip.start_sec, end_sec: clip.end_sec });
      } catch (error) { setTimelineContextRequest({ id: uid(), projectId: projectRef.current.id, loadVersion: projectLoadVersion, error: error.message }); }
    } },
    ...(extensionContextActions.length?['sep',{label:t('plugins.actions_menu'),submenu:[...extensionContextActions.map(entry=>({label:entry.title,icon:props=><ExtensionActionIcon entry={entry} {...props}/>,disabled:entry.enabled===false,hint:entry.disabledReason,onClick:async()=>{try{const {snapshot,targets}=capturePluginEditContext(),target=targets.find(t=>t.track===sel.track&&t.id===sel.id);const result=await window.api.pluginsExtensionUiExecute(entry.id,{location:'context',editor:snapshot,clipId:target?.handle||null},entry.instance);if(result?.error)throw Error(result.error);}catch(error){showAlert(extensionUiError(error));}}}))]}]:[]),
    'sep', ...clipEditingMenuItems(sel),
  ];
  const clipEditingMenuItems = (sel) => {
    if (sel.track === 'effect' && !sel.id.includes('|')) {
      return [
        { label: t('keymap.split_at_playhead'), icon: Split, shortcut: 'S', onClick: split },
        { label: t('keymap.duplicate'), icon: CopyPlus, shortcut: 'Ctrl D', onClick: duplicate },
        { label: t('keymap.delete'), icon: Trash2, shortcut: 'Del', onClick: remove },
      ];
    }
    if (sel.track === 'effect') {
      const { track, clipId } = parseEffectKey(sel.id);
      return [
        { label: t('app.delete_effect'), icon: Trash2, shortcut: 'Del', onClick: () => { dispatch({ type: 'removeEffect', id: sel.id }); setSelection(null); } },
        { label: t('app.select_its_clip'), icon: Layers, onClick: () => setSelection({ track, id: clipId }) },
      ];
    }
    const c = findClip(project, sel);
    if (!c) return [];
    if (c.gap) return [{ label: t('app.close_gap'), icon: Trash2, shortcut: 'Del', onClick: () => dispatch({ type: 'delete', ...sel }) }];
    const m = c.mediaId && project.media.find((x) => x.id === c.mediaId);
    const pic = sel.track === 'video' || sel.track === 'overlay';
    const withSound = (pic && m?.type === 'video' && m.hasAudio) || sel.track === 'audio';
    const canDetach = pic && m?.type === 'video' && m.hasAudio && !c.muted && !c.linkId;
    const detachHint = !(pic && m?.type === 'video') ? t('app.only_for_video_clips')
      : !m.hasAudio ? t('app.this_video_has_no_sound') : c.linkId ? t('app.the_sound_is_already_detached') : t('app.the_clip_is_muted_its_sound_is_off');
    // Extract audio: an independent, unlinked copy of the sound (the extractAudio action) —
    // same availability as Detach, minus the link condition.
    const canExtract = pic && m?.type === 'video' && m.hasAudio && !c.muted;
    const extractHint = !(pic && m?.type === 'video') ? t('app.only_for_video_clips')
      : !m.hasAudio ? t('app.this_video_has_no_sound') : t('app.the_clip_is_muted_its_sound_is_off');
    const items = [
      { label: t('keymap.copy'), icon: Copy, shortcut: 'Ctrl C', onClick: copy },
      { label: t('keymap.cut'), icon: Scissors, shortcut: 'Ctrl X', onClick: cut },
      { label: t('keymap.paste'), icon: ClipboardPaste, shortcut: 'Ctrl V', onClick: paste, disabled: !clipboard, hint: t('app.copy_a_clip_first') },
      { label: t('keymap.delete'), icon: Trash2, shortcut: 'Del', onClick: remove },
      { label: t('app.select_all_on_this_layer'), icon: ListChecks, onClick: () => selectAllOnLayer(sel) },
      'sep',
      { label: t('keymap.split_at_playhead'), icon: Split, shortcut: 'S', onClick: split },
      { label: t('keymap.delete_left_of_playhead'), icon: ScissorsLineDashed, shortcut: 'Q', onClick: () => trimSide('left') },
      { label: t('keymap.delete_right_of_playhead'), icon: ScissorsLineDashed, shortcut: 'W', onClick: () => trimSide('right') },
      { label: t('keymap.duplicate'), icon: CopyPlus, shortcut: 'Ctrl D', onClick: duplicate },
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
          label: t('app.move_to_layer'), icon: Layers,
          submenu: Array.from({ length: count }, (_, layer) => layer).filter((layer) => layer !== cur).map((layer) => ({
            label: layerName(project, sel.track, layer),
            disabled: !layerFree(project, sel.track, layer, span.start, span.len, c.id) || isLayerLocked(project, sel.track, layer),
            hint: isLayerLocked(project, sel.track, layer) ? t('app.that_layer_is_locked') : t('app.the_clip_would_overlap_a_clip_there'),
            onClick: () => moveSelectionToLayer(sel, layer),
          })),
        });
      }
    }
    // Speed / Duration (constant speed — also on the inspector's Speed tab) and Properties.
    if (pic || sel.track === 'audio') {
      items.push({ label: t('app.speed_duration'), icon: Gauge, onClick: () => setSpeedAsk({ track: sel.track, id: sel.id }) });
    }
    items.push({ label: t('app.properties'), icon: Info, onClick: () => {
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
          ? { label: t('app.not_replaceable'), icon: Repeat, onClick: () => dispatch({ type: 'update', ...sel, patch: { slot: false } }) }
          : { label: t('app.make_replaceable_template'), icon: Repeat, onClick: () => dispatch({ type: 'update', ...sel, patch: { slot: true } }) },
        { label: t('app.copy_attributes'), icon: Paintbrush, onClick: () => setAttrClipboard(pickAttributes(c)) },
        { label: t('app.paste_attributes'), icon: Paintbrush, disabled: !attrClipboard, hint: t('app.copy_the_attributes_of_a_clip_first'),
          onClick: () => dispatch({ type: 'update', ...sel, patch: attrClipboard }) },
        { label: t('app.reset_position_and_size'), icon: RotateCcw, onClick: () => dispatch({ type: 'update', ...sel, patch: { transform: undefined } }) },
        { label: t('app.remove_filter'), icon: Eraser, disabled: !c.filter || c.filter === 'none', hint: t('app.this_clip_has_no_filter'),
          onClick: () => dispatch({ type: 'update', ...sel, patch: { filter: 'none' } }) },
        sel.track === 'video'
          ? { label: t('app.move_to_overlay_track'), icon: Layers, onClick: () => {
            const l = videoLayout(project.videoClips).find((x) => x.clip.id === c.id);
            dispatch({ type: 'moveToOverlay', id: c.id, at: l ? l.start : readTime() });
            setSelection({ track: 'overlay', id: c.id });
          } }
          : { label: t('app.move_to_main_track'), icon: PanelBottom, onClick: () => {
            const index = videoLayout(project.videoClips).filter((l) => (l.start + l.end) / 2 < c.start).length;
            dispatch({ type: 'moveToMain', id: c.id, index });
            setSelection({ track: 'video', id: c.id });
          } });
    }
    if (pic) {
      const fx = c.effects || [];
      items.push('sep',
        { label: t('app.freeze_frame'), icon: Snowflake, onClick: () => freezeClip(sel) },
        { label: t(c.reversed ? 'app.reverse_restore_original' : 'app.reverse'), icon: Rewind, onClick: () => reverseClip(sel) },
        { label: t(fx.includes('mirror') ? 'app.mirror_on' : 'app.mirror'), icon: FlipHorizontal2,
          onClick: () => dispatch({ type: 'update', ...sel, patch: { effects: fx.includes('mirror') ? fx.filter((x) => x !== 'mirror') : [...fx, 'mirror'] } }) },
        { label: t('app.rotate_90'), icon: RotateCw,
          onClick: () => { const t = c.transform || {}; dispatch({ type: 'update', ...sel, patch: { transform: { ...t, rot: ((t.rot || 0) + 90) % 360 } } }); } });
    }
    items.push('sep');
    if (pic) items.push({ label: t('app.detach_audio'), icon: AudioLines, shortcut: 'Ctrl Shift S', onClick: () => detachAudio(sel), disabled: !canDetach, hint: detachHint });
    if (pic) items.push({ label: t('keymap.extract_audio'), icon: FileAudio, onClick: () => dispatch({ type: 'extractAudio', track: sel.track, id: sel.id, newId: uid() }), disabled: !canExtract, hint: extractHint });
    if (c.linkId) {
      items.push({ label: t('timeline.unlink_audio_and_video'), icon: Unlink, onClick: () => unlinkClip(sel) });
    } else if (selection?.items?.length === 2
      && selection.items.some((it) => it.track === 'audio')
      && selection.items.some((it) => it.track === 'video' || it.track === 'overlay')) {
      items.push({ label: t('app.link_clips'), icon: Link2, onClick: linkPair });
    }
    if (sel.track === 'audio') items.push({ label: t(c.reversed ? 'app.reverse_restore_original' : 'app.reverse'), icon: Rewind, onClick: () => reverseClip(sel) });
    items.push({ label: t('app.export_clip_audio_mp3'), icon: AudioLines, onClick: () => exportAudio('mp3', sel), disabled: !withSound, hint: t('app.this_clip_has_no_sound') });
    // Enhance voice on the clip's own menu too — the same render the inspector's
    // Enhance voice section drives (clip.enhance via enhanceClip), for audio clips and
    // picture clips with sound alike. Hamza, 2026-11-01: it must appear in the audio
    // context, not only in the video panel.
    if (withSound && m?.hasAudio) {
      const e = c.enhance;
      const stale = !!(e?.path && (Math.abs((e.from ?? -1) - (c.in || 0)) > 0.02 || Math.abs((e.to ?? -1) - (c.out ?? -1)) > 0.02));
      const enhOn = !!(e?.on && e?.path && !stale);
      const strengths = [['light', t('app.light')], ['standard', t('clip.standard')], ['strong', t('app.strong')]];
      const strengthName = strengths.find(([s]) => s === e?.strength)?.[1].toLowerCase() || e?.strength;
      items.push({
        label: enhOn ? t('app.enhance_voice_on_strength', { strength: strengthName }) : t('app.enhance_voice'), icon: Sparkles,
        submenu: [
          { label: t('app.off'), disabled: !e?.on, hint: t('app.enhance_voice_is_already_off'), onClick: () => dispatch({ type: 'update', ...sel, patch: { enhance: { ...e, on: false } } }) },
          ...strengths.map(([s, name]) => ({
            label: enhOn && e.strength === s ? t('app.name_checked', { name }) : name,
            onClick: () => enhanceClip(sel, s),
          })),
        ],
      });
    }
    items.push(c.disabled
      ? { label: t('app.activate_clip'), icon: Eye, onClick: () => dispatch({ type: 'update', ...sel, patch: { disabled: false } }) }
      : { label: t('app.deactivate_clip'), icon: EyeOff, onClick: () => dispatch({ type: 'update', ...sel, patch: { disabled: true } }) });
    // Motion tracking: track a video clip's moving point; pin overlay / text clips to a track.
    if (pic && m?.type === 'video') {
      items.push('sep', { label: t(c.track ? 'app.track_motion_again' : 'clip.track_motion'), icon: Crosshair, onClick: () => startTrackPick(sel) });
    }
    if (sel.track === 'overlay' || sel.track === 'text') {
      const sources = trackedClips(project).filter((s) => s.clip.id !== c.id);
      const submenu = [];
      if (c.pin) submenu.push({ label: t('clip.unpin'), icon: PinOff, onClick: () => dispatch({ type: 'update', ...sel, patch: { pin: null } }) });
      for (const s of sources) {
        const sm = project.media.find((x) => x.id === s.clip.mediaId);
        submenu.push({
          label: t('app.track_in_name', { name: sm?.name || t('app.clip').toLowerCase() }), icon: Pin,
          onClick: () => dispatch({ type: 'update', ...sel, patch: { pin: { to: s.clip.id } } }),
        });
      }
      if (!submenu.length) submenu.push({ label: t('app.no_tracked_clips_yet'), disabled: true, hint: t('app.track_motion_in_a_video_clip_first') });
      items.push({ label: t('clip.pin_to_track'), icon: Pin, submenu });
    }
    return items;
  };

  const duplicate = useCallback(() => {
    if (!selection) return;
    const okItem = (it) => it.track !== 'transition' && !(it.track === 'effect' && it.id.includes('|'));
    if (selection.items) {
      // Bulk duplicate: every selected clip, one undo step (locked layers refuse their own).
      // A linked pair is selected as two items but duplicated as one: the reducer copies the
      // partner along with the clip, so the partner's own item is skipped.
      const p = projectRef.current, seen = new Set();
      const items = selection.items.filter(okItem).filter((it) => {
        if (seen.has(`${it.track}:${it.id}`)) return false;
        const partner = findLinkPartner(p, findClipIn(p, it.track, it.id));
        if (partner) seen.add(`${partner.track}:${partner.clip.id}`);
        return true;
      });
      if (!items.length) return;
      dispatch({ type: 'beginGesture', group: true });
      items.forEach((it) => dispatch({ type: 'duplicate', ...it, newId: uid() }));
      dispatch({ type: 'endGesture', group: true });
    } else if (okItem(selection)) dispatch({ type: 'duplicate', ...selection, newId: uid() });
  }, [selection]);

  // Saves to the project's file (asks where the first time, or always with saveAs). Returns true once saved.
  const manualSavePending=useRef(false);
  const save = async (saveAs = false) => {
    if(manualSavePending.current)return false;manualSavePending.current=true;
    try{
    const a = autosave.current;
    let p = projectRef.current;
    const epoch=loadVersionRef.current;
    const previousFile = a.file;
    const target=await window.api.pickSaveProject(previousFile,{saveAs,name:p.name});
    if(!target)return false;if(target.error)throw Error(target.error);
    if(loadVersionRef.current!==epoch||autosave.current!==a)return false;
    p=await extensionHost.before('save',{source:projectRef.current,destination:{path:target,saveAs}});
    clearTimeout(a.fileTimer);a.fileTimer = null;
    const { doc, chat } = await serializeProjectParts(p);
    await a.writing?.catch(() => {});
    const res = await window.api.saveProject(doc.pretty, target, { name: p.name, chat: chat ? chat.compact : null });
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
    a.fileChat = p.craftAI;
    if (!unchanged) a.fileTimer = setTimeout(writeFile, 1500);
    setSaveState(unchanged ? 'saved' : 'saving');
    pushRecent(recentOf(a.project, res));
    await keepRecovery(false);
    await writeSlotNow(a.project, res); // closing after Save also waits for its slot
    return true;
    }catch(error){if(error.name!=='AbortError'){setSaveState('error');showAlert(extensionUiError(error));}return false;}finally{manualSavePending.current=false;}
  };

  const open = async () => {
    try {
      const res = await window.api.openProject();
      if (!res) return;
      if (res.error) { showAlert(res.error); return; }
      const p = await adoptFileBinding(normalizeProject(mergeChat(JSON.parse(res.json), res.chat)), res.file);
      await flushAutosave(); // the current project keeps its last changes (file + slot)
      autosave.current.file = res.file;
      autosave.current.origin = { created: false, slot: null };
      dispatch({ type: 'load', project: p });
      setSaveState('saved');
      setUnsavedNote(null);
      setTime(0);
      setSelection(null);
      pushRecent(recentOf(p, res.file));
      writeSlotNow(p, res.file); // the slot syncs to the file's content under the shared id
      setScreen('editor');
    } catch (e) {
      showAlert(t('app.invalid_project_file', { error: e.message }));
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
    autosave.current.origin = { created: true };
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
      return { error: t('app.auto_saved_project_not_found') };
    }
    if (slot.error) return { error: slot.error }; // its chat file is held by another program
    // Its file changed after the slot was last written (elsewhere, or by another program): the file
    // has work the slot lacks, so the file opens and the slot is rewritten from it.
    if (slot.fileChanged && slot.file) return loadFile(slot.file);
    let p;
    try { p = { ...normalizeProject(slot.project), id: slot.id }; }
    catch (e) { return { error: t('app.invalid_auto_saved_project', { error: e.message }) }; }
    autosave.current.file = slot.file || null;
    autosave.current.pendingRestore = false;
    autosave.current.origin = { created: false, slot }; // Don't save on close puts this slot back
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
      return { error: t('app.project_file_not_found') };
    }
    if (res.error) return { error: res.error }; // not a ClipCraft project: the file is left alone
    try {
      const p = await adoptFileBinding(normalizeProject(mergeChat(JSON.parse(res.json), res.chat)), res.file);
      await flushAutosave();
      autosave.current.file = res.file;
      autosave.current.origin = { created: false, slot: null };
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
      return { error: t('app.invalid_project_file', { error: e.message }) };
    }
  };
  const openRecent = async (r) => {
    if (r.slotId) return openSlot(r);
    const res = await loadFile(r.path);
    if (res?.error) showAlert(res.error);
  };

  // Home's Import media starts a new, unsaved project holding the picked media (like New project):
  // the project last open, and its file, are left as they were.
  const importFromHome = async () => {
    const items = await window.api.importMedia();
    if (!items?.some((i) => !i.error)) { if (items?.length) addItems(items); return; } // canceled, or only errors to show
    await flushAutosave(); // the project being left keeps everything, slot included
    autosave.current.file = null;
    autosave.current.pendingRestore = false;
    autosave.current.origin = { created: true };
    dispatch({ type: 'load', project: emptyProject() });
    addItems(items);
    setSaveState('new');
    setUnsavedNote(null);
    setSelection(null);
    setTime(0);
    setScreen('editor');
  };

  // The startup offer (a project the last session ended on, unsaved): restoring loads it
  // with its file binding, exactly as it was left; the editor's current work is flushed
  // first. Discarding clears the recovery AND the project's slot — the user said no.
  const restoreUnsaved = async () => {
    const note = unsavedNote;
    if (!note) return;
    let p;
    try { p = normalizeProject(note.project); }
    catch (e) { showAlert(t('app.invalid_recovery_project', { error: e.message })); return; }
    await flushAutosave();
    autosave.current.file = note.file || null;
    autosave.current.pendingRestore = false;
    autosave.current.origin = { created: false, slot: null }; // the last session's work: never deleted on close
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
    // The file could not be written: closing now would lose the changes since its last write,
    // so the close waits for the save question like a project that never had a file.
    const failed = !!a.file && !(await flushAutosave()); // Home restores the slot too, including the latest chat.
    if (a.file && !failed) {
      await keepRecovery(false);
      return window.api.closeNow();
    }
    if (!failed && !hasContent(a.project)) {
      await keepRecovery(false);
      return window.api.closeNow();
    }
    // A project that existed before this session (reopened from its Home card) and was not changed
    // since it was loaded closes without asking: there is nothing to save or to throw away.
    const created = a.origin?.created !== false, base = a.loadedProject;
    const unchanged = !created && !!base && (sameDoc(base, a.project) || JSON.stringify(projectDoc(base)) === JSON.stringify(projectDoc(a.project)));
    if (!failed && unchanged) {
      await flushAutosave();
      await keepRecovery(false);
      return window.api.closeNow();
    }
    window.api.closeCancel(); // the window waits for the answer
    if (a.asking) return; // already asking (the close button was clicked again)
    a.asking = true;
    const choice = await new Promise((resolve) => setCloseAsk({ name: a.project.name, failed, resolve }));
    a.asking = false;
    setCloseAsk(null);
    if (choice === 'save') {
      if (await save()) return window.api.closeNow();
      return window.api.closeCancel();
    }
    if (choice === 'discard') {
      await keepRecovery(false);
      // A project with a file keeps its file as last written and its slot as it is.
      if (failed) return window.api.closeNow();
      // No pending slot write may land after the answer.
      clearTimeout(a.slotTimer);a.slotTimer = null;
      try { await a.slotWriting; } catch { /* the slot is replaced below */ }
      const id = a.project?.id;
      if (id && !isTourId(id)) {
        try {
          // A project made in this session goes; one that existed before gets its slot back as it was
          // loaded, so "Don't save" throws away this session's changes and never the project.
          if (created || !base || base.id !== id) await window.api.slotDelete(id);
          else await restoreLoadedSlot(base, a.origin.slot);
        } catch { /* closing anyway */ }
      }
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
    const source=projectRef.current,project=renderable(source);
    if (!project.videoClips.length) return showAlert(t('app.add_a_video_or_photo_before_exporting'));
    setPlaying(false);
    let caps = { libx265: true };
    try { caps = await window.api.exportCaps(); } catch { /* the bundled build has libx265 */ }
    setExporting({ ready: true, eff: resolveExport(project, caps), project, source, caps, target: null, name: (project.name || 'export').replace(/[\\/:*?"<>|]+/g, '_') });
  };
  const confirmExport = () => {
    const { project, source, eff, target, name } = exporting;
    return runExportFlow(project, eff, target, name,false,{source});
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
      return { ...e, project, source:{...(e.source||projectRef.current),...patch},eff: resolveExport(project, e.caps) };
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
    setExporting((e) => e && { ...e, project: { ...e.project, posterAt: t },source:{...(e.source||projectRef.current),posterAt:t} });
  };
  // The rendered cover (export:coverFrame's per-project poster file) is the home card's picture;
  // the timestamp lets the card reload the file when the same path holds a new render.
  const changePosterImage = (file) => {
    const patch={posterImage:file,posterImageAt:Date.now()};dispatch({type:'projectVisuals',projectId:exporting?.project.id,patch});
    setExporting(e=>e&&{...e,source:{...(e.source||projectRef.current),...patch}});
  };
  const exportRunning = useRef(false);
  const exportCanceled = useRef(false);
  const exportPreparation=useRef(null);
  const exportReporter = useRef(null);
  const runExportFlow = async (project, eff, presetTarget, name, review = false, presentation = {}) => {
    if (exportRunning.current) return { error: 'Another export is already running.' };
    exportRunning.current = true;exportCanceled.current = false;
    let target, timer, off,preparation;
    let documentId=null,exportTerminal=false;const operationId=presentation.operationId||crypto.randomUUID(),source=presentation.extensionId?{kind:'extension',extensionId:presentation.extensionId}:presentation.allowAgent?{kind:'agent'}:{kind:'user'};
    const publishExport=(status,value={})=>{if(!documentId||exportTerminal)return;if(['completed','canceled','failed'].includes(status))exportTerminal=true;return window.api.pluginsExtensionPublish?.('export.changed',{operationId,documentId,status,...value},{documentId,source,reason:'export'}).catch(()=>{});};
    let viewState = null;
    const publish = next => {
      viewState = typeof next === 'function' ? next(viewState) : next;
      if(viewState&&presentation.extension)viewState={...viewState,extension:presentation.extension};
      if (!presentation.inline) setExporting(viewState?.done&&presentation.showCompletion===false?null:viewState);
      if (!viewState) {if(exportCanceled.current&&typeof next!=='function')publishExport('canceled');return;}
      const status=viewState.done?'completed':viewState.error?'failed':'rendering',event={};
      for(const key of ['progress','phase','phaseProgress','stage','elapsedSeconds','remainingSeconds','file','size','metadata','error'])if(viewState[key]!==undefined)event[key]=viewState[key];
      publishExport(status,event);
      // The chat receives progress, not the render snapshot or temporary paths.
      const {progress,stage,phase,phaseProgress,remainingSeconds,elapsedSeconds,timingStatus,step,steps,stopping,done,error}=viewState;
      try { presentation.onProgress?.(Object.fromEntries(Object.entries({progress,stage,phase,phaseProgress,remainingSeconds,elapsedSeconds,timingStatus,step,steps,stopping,done,error}).filter(([,value])=>value!==undefined))); } catch { /* presentation cannot fail an export */ }
    };
    exportReporter.current = publish;
    const stopIfCanceled = () => { if (exportCanceled.current) throw new Error('Export canceled'); };
    try {
      documentId=readPluginContext().documentId;
      await refreshPluginEffects();
      assertPluginEffects(project);
      target = presetTarget || await window.api.exportBegin(name);
      if (target.canceled) return { canceled: true };
      stopIfCanceled();publishExport('preparing',{progress:0,review:!!review});preparation=new AbortController();exportPreparation.current=preparation;
      const prepared=await extensionHost.before('export',{source:presentation.source||projectRef.current,signal:preparation.signal,operationId,destination:{path:target.file,review:!!review},allowAgent:presentation.allowAgent===true,agentToken:presentation.agentToken,agentSession:presentation.agentSession});
      stopIfCanceled();const preparedPlan=presentation.plan?.(prepared);project=preparedPlan?preparedPlan.project:renderable(prepared);if(preparedPlan)eff=preparedPlan.effective;assertPluginEffects(project);
      project = exportRenderPlan(project, eff);
      const stages = exportStages(project, fxWork(project));
      let storage;try { storage = window.localStorage; } catch {}
      const progress = new ExportProgress(stages, { storage, profile: readExportProfile(storage), publish: update => {
        if (exportCanceled.current) return;
        publish(e => e && !e.done && !e.error ? { ...e, ...update } : e);
        window.api.exportActivity?.({active:true,progress:update.progress}).catch(() => {});
      } });
      publish({ ready:false, project, eff, target, name, review, progress:0, stage:t(review ? 'app.preparing_section_preview' : 'app.preparing_your_video'), startedAt:performance.now() });
      progress.start('prepare');timer = setInterval(() => progress.emit(), 1000);
      await new Promise(resolve => setTimeout(resolve, 0));stopIfCanceled();
      await loadProjectLuts(project,{strict:true});stopIfCanceled();
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
      assertPluginEffects(project);
      const res = await window.api.exportRun(toExport,target,textFrames);off();off = null;
      if (res.canceled) exportCanceled.current = true;stopIfCanceled();
      if (!res.ok) throw new Error(res.error || t('app.the_video_could_not_be_exported'));
      progress.start('finish');let size = res.size, coverNote = null;
      if (typeof project.posterAt === 'number') {
        try {
          // The embedded cover is the EXPORTED frame at the chosen time — overlays, graphics and
          // text included, what a viewer sees — never a frame of the main-track source.
          const at = Math.min(Math.max(0, project.posterAt), Math.max(0, exportDuration(project) - 1 / (project.fps || 30)));
          const cov = await window.api.exportCover(res.file,res.file,at);
          if (cov.ok) { if (cov.size) size = cov.size; }
          else coverNote = t('app.cover_picture_not_embedded');
        } catch { coverNote = t('app.cover_picture_not_embedded'); }
      }
      // Once encoding has published the finished file, completing the optional
      // cover is best-effort. Cancel never discards a successfully saved video.
      const elapsedSeconds = progress.finish();
      publish({done:true,file:res.file,size,metadata:res.metadata,coverNote,review,progress:1,elapsedSeconds,stage:t(review?'app.preview_rendered':'app.video_saved')});
      return { ok: true, file: res.file, size, metadata: res.metadata, elapsed_seconds: elapsedSeconds, ...(coverNote ? { warning: coverNote } : {}) };
    } catch (error) {
      if(error.name==='AbortError')exportCanceled.current=true;
      if (exportCanceled.current) publish(null);
      else publish({error:error.message,project,eff,name,review,target:null});
      return exportCanceled.current ? { canceled: true } : { error: error.message };
    } finally {
      clearInterval(timer);off?.();if(exportPreparation.current===preparation)exportPreparation.current=null;
      await Promise.allSettled([window.api.fxClear(),...(target?.frameDir?[window.api.exportAbort(target.frameDir)]:[])]);
      await window.api.exportActivity?.({active:false}).catch(() => {});
      exportRunning.current = false;
      if(exportReporter.current===publish)exportReporter.current=null;
    }
  };
  const cancelExport = () => {
    if (exportCanceled.current) return;
    exportCanceled.current = true;exportPreparation.current?.abort();
    (exportReporter.current || setExporting)(e => e && { ...e, stopping:true, remainingSeconds:null });
    window.api.cancelExport().catch(() => {});
  };

  const startAuthorExport = async ({key,id,start,seconds,signal}) => {
    if(exportRunning.current||exporting?.ready)return {error:'Finish or close the existing export first.'};
    if(!Number.isFinite(start)||start<0||!Number.isFinite(seconds)||seconds<=0||seconds>15)return {error:'Choose up to 15 seconds of the current timeline.'};
    let authorization,off,target;
    const stop=()=>{if(exportRunning.current)cancelExport();window.api.pluginsCancelAuthorTest().catch(()=>{});};
    setAgentRendering(true);
    try{
      await graphicEdits.flush();
      if(signal.aborted)return {canceled:true};
      authorization=await window.api.pluginsBeginAuthorExport({key,id});
      signal.addEventListener('abort',stop,{once:true});
      off=window.api.onPluginDevelopmentCatalogChanged(stop);
      const caps=await window.api.exportCaps(),source=projectRef.current;
      const plan=agentExportPlan({...source,exportSettings:{preset:'custom',custom:{...authorization.preset.settings}}},{review:true,start_sec:start,end_sec:Math.min(exportDuration(source),start+seconds)},caps);
      if(signal.aborted)return {canceled:true};
      target=await window.api.exportBegin('Author test - '+authorization.preset.name);
      if(target.canceled||signal.aborted)return {canceled:true};
      setPlaying(false);
      return await runExportFlow(plan.project,plan.effective,{...target,authorToken:authorization.token},authorization.preset.name,true,{inline:true,source,plan:draft=>agentExportPlan({...draft,exportSettings:{preset:'custom',custom:{...authorization.preset.settings}}},{review:true,start_sec:start,end_sec:Math.min(exportDuration(draft),start+seconds)},caps)});
    }catch(error){return {error:error.message};}
    finally{off?.();signal.removeEventListener('abort',stop);if(authorization)await window.api.pluginsFinishAuthorTest(authorization.token).catch(()=>{});if(target?.frameDir)await window.api.exportAbort(target.frameDir).catch(()=>{});setAgentRendering(false);}
  };

  const startAgentExport = async (options = {}, request = {}) => {
    if (exportRunning.current || exporting?.ready) return { error: 'Finish or close the existing export first.' };
    if (request.isCanceled?.()) return { canceled: true };
    let target, watch;
    setAgentRendering(true);
    try {
      await graphicEdits.flush();
      const caps = await window.api.exportCaps();
      const source=projectRef.current;
      const { project: snapshot, effective } = agentExportPlan(source, options, caps);
      if (request.isCanceled?.()) return { canceled: true };
      target = await window.api.agentExportBegin({ requestId: request.requestId, revision: request.revision, kind: options.review ? 'review' : 'export', start_sec: options.start_sec, file_path: options.file_path, name: options.name || snapshot.name, overwrite: options.overwrite });
      if (target.error) return target;
      if (request.isCanceled?.()) return { canceled: true };
      setPlaying(false);
      watch = setInterval(() => { if (request.isCanceled?.() && !exportCanceled.current) cancelExport(); }, 100);
      const result = await runExportFlow(snapshot, effective, target, options.name || snapshot.name, !!options.review, {inline:true,onProgress:request.onProgress,source,plan:draft=>agentExportPlan(draft,options,caps),allowAgent:true,agentToken:historyRef.current.agentEdit?.token});
      return { ...result, settings: effective };
    } catch (error) { return { error: error.message }; }
    finally {
      clearInterval(watch);
      if (target?.frameDir) await window.api.exportAbort(target.frameDir).catch(() => {});
      setAgentRendering(false);
    }
  };

  const startExtensionExport=async({input,target,title,extensionId,operationId,agentSession},{signal,onProgress})=>{
    if(exportRunning.current||exporting?.ready||(!agentSession&&(agentRunRef.current||historyRef.current.agentEdit))||historyRef.current.gestureStart)return {error:'Finish the current edit or export first.'};
    agentSession?.check();
    const stop=()=>{if(exportRunning.current)cancelExport();};signal.addEventListener('abort',stop,{once:true});
    try{
      if(signal.aborted)return {canceled:true};await graphicEdits.flush();
      const caps=await window.api.exportCaps(),source=projectRef.current;
      if(signal.aborted)return {canceled:true};
      if(input.documentId&&capturePluginEditContext().snapshot.documentId!==input.documentId)throw Error('The export document is no longer open.');
      const plan=agentExportPlan(source,input,caps);setPlaying(false);
      const result=await runExportFlow(plan.project,plan.effective,target,input.name||source.name,false,{source,extension:title,extensionId,operationId,onProgress,showCompletion:input.showCompletion,...(agentSession?{allowAgent:true,agentToken:agentSession.agentToken,agentSession}:{}),plan:draft=>agentExportPlan(draft,input,caps)});
      return {...result,settings:plan.effective};
    }catch(error){return {error:error.message};}
    finally{signal.removeEventListener('abort',stop);}
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
      historyOrigin: () => historyOrigin(historyRef.current),
      exportData: () => {
        const p = renderable(projectRef.current);
        return { project: { ...p, maskImages: maskImages(p), decoImages: decoImages(p), customMaskImages: customMaskImages(p), motion: motionDataPinned(p) } };
      },
      // Test hook: exports immediately (no summary gate), resolving settings the same way.
      exportNow: async () => { await graphicEdits.flush(); const p = renderable(projectRef.current); return runExportFlow(p, resolveExport(p),undefined,undefined,false,{source:projectRef.current}); },
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
    getPluginEditorContext: () => readPluginContext(),
    getPluginEditContext: () => capturePluginEditContext(),
    pluginEditApplied: action => pluginEditsApplied(historyRef.current,action),
    pluginCommandReady: () => !exportRunning.current && !historyRef.current.gestureStart,
    runExtensionCommand:(...args)=>extensionHost.runAgentCommand(...args),
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
      const slots = await window.api.slotList?.().catch(() => []) || [];
      const slot = id && slots.some?.((x) => x.id === id);
      // An outside agent opens project files only: any other file would become the auto save target.
      if (!slot && !/\.clipcraft\.json$/i.test(String(filePath || id))) return { error: 'Only a .clipcraft.json project file can be opened. Give the id from list_projects, or the path of a .clipcraft.json file.' };
      setPlaying(false);
      const result = slot ? await loadSlot(id)
        : await loadFile(filePath || id);
      await settle();
      return result;
    },
    save: async (target) => {
      const a=autosave.current,epoch=loadVersionRef.current;if(!target&&!a.file)return {error:'This project has no file yet. Give an absolute path ending in .clipcraft.json.'};
      try{
      const check=await window.api.preflightSaveProjectAgent(target||a.file,a.file);if(check.error)return check;
      const p=await extensionHost.before('save',{source:projectRef.current,destination:{path:check.file,saveAs:check.file!==a.file},allowAgent:true,agentToken:historyRef.current.agentEdit?.token});
      clearTimeout(a.fileTimer); a.fileTimer = null;
      const { doc, chat } = await serializeProjectParts(p);
      await a.writing?.catch(() => {});
      const res = await window.api.saveProjectAgent(doc.pretty, target||a.file, a.file, chat ? chat.compact : null);
      if (res?.error) return { error: res.error };
      if(loadVersionRef.current!==epoch||autosave.current!==a)return {saved:true,file:res.file};
      a.file = res.file;
      a.fileChat = p.craftAI;
      setSaveState('saved');
      pushRecent(recentOf(p, res.file));
      await keepRecovery(false);
      await writeSlotNow(p, res.file);
      return { saved: true, file: res.file };
      }catch(error){return error.name==='AbortError'?{canceled:true}:{error:extensionUiError(error)};}
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

  const extensionShortcuts=useExtensionShortcuts({hasProject:screen==='editor',onError:error=>showAlert(extensionUiError(error))});
  // Keyboard shortcuts.
  const keys = useRef({});
  keys.current = { togglePlay, split, remove, duplicate, seek, readTime, trimSide, toggleMarker, setTool, copy, cut, paste, extractAudio: detachAudio, save, extensionShortcut:extensionShortcuts.run };
  useEffect(() => {
    // Keys come from the user's keymap (Settings > Keyboard shortcuts).
    const onKey = (e) => {
      // Any modal (a dialog or an alert dialog) holds the keyboard.
      if (e.defaultPrevented || e.isComposing || document.querySelector('[aria-modal="true"]')) return;
      const k = keys.current, action = actionFor(e);
      if (!action) return;
      const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName) || e.target.isContentEditable;
      if (typing && !WORKS_IN_FIELDS.has(action)) return;
      if(action.startsWith('extension:')){if(!e.repeat&&k.extensionShortcut(action))e.preventDefault();return;}
      // Editor keys act only on the visible editor, never on the project kept behind the Home screen
      // (extension shortcuts above answer to their own scope).
      if (screenRef.current !== 'editor') return;
      // Space on a focused button presses that button rather than playing.
      if (action === 'togglePlay' && e.code === 'Space' && e.target.closest('button')) return;
      const run = {
        togglePlay: () => k.togglePlay(), split: () => k.split(), duplicate: () => k.duplicate(), extractAudio: () => k.extractAudio(),
        copy: () => k.copy(), cut: () => k.cut(), paste: () => k.paste(), delete: () => k.remove(),
        undo: () => dispatch({ type: 'undo' }), redo: () => dispatch({ type: 'redo' }),
        stepBack: () => k.seek(k.readTime() - 1 / (projectRef.current.fps || 30)), stepForward: () => k.seek(k.readTime() + 1 / (projectRef.current.fps || 30)),
        jumpBack: () => k.seek(k.readTime() - 1), jumpForward: () => k.seek(k.readTime() + 1), goStart: () => k.seek(0),
        trimLeft: () => k.trimSide('left'), trimRight: () => k.trimSide('right'), marker: () => k.toggleMarker(),
        razorTool: () => k.setTool('razor'), selectTool: () => k.setTool('select'),
        save: () => k.save(false), saveAs: () => k.save(true),
      }[action];
      if (!run) return; // e.g. fullscreen: handled by the player
      // Document Undo/Redo must not also undo Chromium's last text-field edit.
      // Editable fields returned above retain their native text history; Escape,
      // Delete and clipboard keys still reach other listeners.
      if (['togglePlay', 'split', 'duplicate', 'extractAudio', 'save', 'saveAs', 'undo', 'redo'].includes(action)) e.preventDefault();
      run();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const pluginContext=useRef(null);
  if(!pluginContext.current||pluginContext.current.epoch!==projectLoadVersion)pluginContext.current={epoch:projectLoadVersion,read:createEditorContext()};
  const readPluginContext=(input)=>pluginContext.current.read(projectRef.current,editorRef.current.selection,{time_sec:readTime(),playing:editorRef.current.playing},input);
  const capturePluginEditContext=(input)=>{const snapshot=readPluginContext(input);return {snapshot,targets:pluginContext.current.read.targets(snapshot),rebase:value=>pluginContext.current.read.rebase(value,snapshot)};};
  const {items:extensionContextUi}=useExtensionUi('context');
  const extensionContextActions=extensionContextUi.filter(entry=>entry.kind==='action');
  useEffect(()=>window.api.onExtensionViewEvent?.(event=>{if(event.type==='reveal'){if(settingsOpen){setSettingsOpen(false);setSettingsVersion(version=>version+1);}setPluginPanelsOpen(true);if(agentMode)setAgentDrawer('plugins');else setRightCollapsed(false);}}),[agentMode,settingsOpen]);
  const extensionEditorTools=useRef(null);extensionEditorTools.current||=createExtensionEditorTools(()=>externalApp.current);
  const extensionHost=useExtensionHost({editorTools:extensionEditorTools.current,capture:capturePluginEditContext,inspect:(method,input)=>pluginContext.current.read[method](projectRef.current,editorRef.current.selection,{time_sec:readTime(),playing:editorRef.current.playing},input),getHistory:()=>historyRef.current,dispatch,startExport:startExtensionExport,hasProject:screen==='editor',epoch:projectLoadVersion,selection:()=>editorRef.current.selection,documentScope:()=>{readPluginContext();return pluginContext.current.read.scope();},isPreparationBusy:(kind,allowAgent)=>!!agentRunRef.current&&!allowAgent||kind==='save'&&exportRunning.current,isBusy:()=>!!agentRunRef.current||exportRunning.current,isAgentCommandBusy:()=>!!exportRunning.current||!!historyRef.current.gestureStart});

  if (screen === 'home') {
    return (
      <div className="app home-app">
        <HomeScreen recents={homeProjects} onNew={startNewProject} onOpen={open} onOpenRecent={openRecent}
          onRemoveRecent={removeHomeEntry} onImportMedia={importFromHome}
          onRecordStart={startRecording}
          unsavedNote={unsavedNote}
          onRestoreUnsaved={restoreUnsaved}
          onDiscardUnsaved={discardUnsaved} agentBadge={externalBadge}
          onSettings={() => setSettingsOpen(true)} />
        {externalApproval}
        <ExtensionMessages hideJobs={!!settingsOpen||!!exporting||!!agentRun} onManage={()=>setSettingsOpen('plugins')}/><ExtensionPreparation value={extensionHost.preparing} onCancel={extensionHost.cancelBefore}/>

        {closeAsk && <CloseDialog name={closeAsk.name} failed={closeAsk.failed} onChoice={closeAsk.resolve} />}
        {extensionHost.preview&&<ExtensionMediaPreview preview={extensionHost.preview} onClose={extensionHost.closePreview} onInsert={extensionHost.insertPreview}/>}
      {settingsOpen && <SettingsDialog onAuthorExport={startAuthorExport} project={project} onReplaceDependency={replacePackDependency} onApplyPack={screen==='editor'?applyPackContent:undefined} initialSection={typeof settingsOpen === 'string' ? settingsOpen : 'ai'} onClose={() => { setSettingsOpen(false); setSettingsVersion((v) => v + 1); }}
          onAbout={() => setAboutOpen('settings')} />}
        {aboutOpen && <AboutDialog onClose={() => { setAboutOpen(false); if (aboutOpen === 'settings') setSettingsOpen(true); }} />}
      </div>
    );
  }

  // The editor's own boundary: a failing panel shows a message instead of blanking the window,
  // while this component (the project, its history and autosave) stays mounted.
  return (
    <ErrorBoundary name="the editor" message={t('error-boundary.editor_message')} onUndo={state.past.length || state.gestureStart ? () => { dispatch({ type: 'endGesture' }); dispatch({ type: 'undo' }); } : undefined}>
    <div className={`app mode-${workspaceMode} ${dragOver ? 'drag-over' : ''} drawer-${agentDrawer || 'none'}`} style={{ gridTemplateRows: agentMode ? `44px 34px minmax(0, 1fr) ${panes.bottom}px` : `44px minmax(0, 1fr) ${panes.bottom}px`, ...(agentMode ? { gridTemplateColumns: `${panes.left}px minmax(0, 1fr)${agentDrawer ? ` ${panes.right}px` : ''}` } : {}), '--agent-bottom': `${panes.bottom}px`, '--agent-left': `${panes.left}px` }}
      onDragOver={(e) => { e.preventDefault(); if (isFiles(e) && !isInternal(e)) setDragOver(true); }}
      onDragLeave={(e) => { if (e.target === e.currentTarget) setDragOver(false); }}
      onDrop={onDrop}>
      <TopBar onManagePlugins={()=>setSettingsOpen('plugins')} onPluginPanels={()=>{setPluginPanelsOpen(true);if(agentMode)setAgentDrawer('plugins');else setRightCollapsed(false);}} agentBadge={externalBadge} workspaceMode={workspaceMode} onWorkspaceModeChange={setWorkspaceMode} project={project} dispatch={dispatch} onOpen={open} onSave={save} saveState={saveState} onExport={startExport} onExportAudio={(f) => exportAudio(f)} onSettings={() => setSettingsOpen(true)}
        onHome={async () => { setPlaying(false); await flushAutosave(); refreshSlots(); setScreen('home'); }} />

      <div className="agent-workspace-tools" hidden={!agentMode}>
        <button className="btn btn-sm" aria-expanded={agentDrawer === 'media'} onClick={() => { setTab('media'); setAgentDrawer(d => d === 'media' ? null : 'media'); }}>{t('app.media')}</button>
        <button className="btn btn-sm" aria-expanded={agentDrawer === 'properties'} onClick={() => setAgentDrawer(d => d === 'properties' ? null : 'properties')}>{t('app.properties')}</button>
        <button className="btn btn-sm" aria-expanded={panes.bottom > 220} onClick={() => setTimelineHeight(panes.bottom > 220 ? 180 : window.innerHeight * 0.5)}>{t(panes.bottom > 220 ? 'app.compact_timeline' : 'app.expand_timeline')}</button>
        <span className="muted">{t('app.drag_the_timeline_border_to_expand')}</span>
        {agentDrawer && <button className="btn btn-sm" onClick={() => setAgentDrawer(null)}>{t('app.close_tools')}</button>}
      </div>
      <div className="workspace" style={{ gridTemplateColumns: panes.rightCollapsed ? `${panes.left}px minmax(0, 1fr)` : `${panes.left}px minmax(0, 1fr) ${panes.right}px` }}>
        <LeftPanel tab={tab} setTab={setTab} media={project.media} dispatch={dispatch} settingsVersion={settingsVersion}
          onImport={importMedia} onAdd={addToTimeline} onAddAsOverlay={addAsOverlay} onLibraryAdd={libraryAdd} onStockAdd={stockAdd} onAddFile={addFile} stockKey={stockKey} onTtsAdd={ttsAdd} onTtsBegin={projectStamp} selectedText={selectedText}
          onOpenSettings={(section) => setSettingsOpen(typeof section === 'string' ? section : true)} onRemoveMedia={removeMedia} onLocateMedia={locateMedia} onPeek={peek} peekId={peekId} onPeekAsset={peekAsset}
          recorder={recorder} onStartRecord={startVoiceOver} onAddText={addText} onAddTextOver={addTextOver}
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
          propertiesCollapsed={agentMode ? agentDrawer !== 'properties' : panes.rightCollapsed} onToggleProperties={() => {setPluginPanelsOpen(false);return agentMode ? setAgentDrawer(d => d === 'properties' ? null : 'properties') : setRightCollapsed(!panes.rightCollapsed);}}
          trackPick={trackPick} onTrackPoint={(point) => setTrackPick((p) => (p ? { ...p, point } : p))}
          cropEdit={cropEdit} onCropDraft={setCropDraft}
          colorPick={colorPick} onColorPicked={finishColorPick} />
        {pluginPanelsOpen&&(!agentMode||agentDrawer==='plugins')?<PluginWorkbench onManage={()=>setSettingsOpen('plugins')} getEditorContext={readPluginContext} project={project} projectEpoch={projectLoadVersion} onClose={()=>{setPluginPanelsOpen(false);if(agentMode)setAgentDrawer(null);}}/>:<Inspector extensionInspectorSet={extensionHost.setInspector} projectEpoch={projectLoadVersion} onSelectEffect={setSelection} collapsed={agentMode ? agentDrawer !== 'properties' : panes.rightCollapsed} onCollapse={() => {
          if (agentMode) setAgentDrawer(null); else setRightCollapsed(true);
          requestAnimationFrame(() => document.querySelector('.properties-toggle')?.focus());
        }} project={project} selection={selection} dispatch={dispatch} duration={duration} time={time} clockRef={clockRef} playing={playing} onSeek={seek}
          onAddTextOver={addTextOver}
          onEnhance={(strength) => selection && enhanceClip({ track: selection.track, id: selection.id }, strength)}
          onTrackPick={(sel) => startTrackPick(sel)} onCropEdit={(sel) => startCropEdit(sel)} onColorPick={(sel) => startColorPick(sel)}
          readLive={() => ({ project: projectRef.current, version: loadVersionRef.current })} />}
        {/* Splitters straddle the one-pixel divider between panels (6px wide, centred on it). */}
        <Splitter which="left" style={{ left: panes.left - 3 }} onStart={startResize} onReset={resetSize} onNudge={nudgeSize} label={t('app.resize_the_left_panel')} />
        {!agentMode && !panes.rightCollapsed && <Splitter which="right" style={{ right: panes.right - 3 }} onStart={startResize} onReset={resetSize} onNudge={nudgeSize} label={t('app.resize_the_properties_panel')} />}
      </div>
      <Splitter which="bottom" style={{ bottom: panes.bottom - 3, ...(agentMode ? { left: panes.left } : {}) }} onStart={startResize} onReset={resetSize} onNudge={nudgeSize} label={t('app.resize_the_timeline')} />

      <Timeline project={project} time={time} duration={duration} selection={selection} clockRef={clockRef} playing={playing}
        agentRun={agentRun?.runKey === `${project.id}:${projectLoadVersion}` ? agentRun : null}
        agentOwnsEdit={state.agentEdit?.token === agentRun?.requestId} agentHasChanges={!!state.agentEdit?.steps.length}
        agentFocus={agentFocus?.runKey === `${project.id}:${projectLoadVersion}` ? (agentFocus.live && state.agentEdit?.token !== agentFocus.requestId ? { ...agentFocus, live: null } : agentFocus) : null}
        onShowAgent={() => setWorkspaceMode('agent')}
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
          <SpeedDialog clip={c} name={m?.name || t('app.clip')} onClose={() => setSpeedAsk(null)}
            onApply={(speed) => dispatch({ type: 'update', track: speedAsk.track, id: speedAsk.id, patch: { speed } })} />
        );
      })()}

      {(screenOpen || screenRec.active) && <ScreenRecordDialog rec={screenRec} at={readTime()} onClose={() => setScreenOpen(false)} />}
      {recoveredNote && (
        <div className="recovered-note" role="status">
          <b>{t('app.clipcraft_had_a_problem_and_restarted_its')}</b> {t('app.your_project_was_restored_as_it_was_a_seco')}
          <button className="btn btn-sm" onClick={() => window.api.openCrashLog()}>{t('app.show_crash_log')}</button>
          <button className="icon-btn" aria-label={t('app.close')} onClick={() => setRecoveredNote(false)}>×</button>
        </div>
      )}
      {aboutOpen && <AboutDialog onClose={() => { setAboutOpen(false); if (aboutOpen === 'settings') setSettingsOpen(true); }} />}
      {closeAsk && <CloseDialog name={closeAsk.name} failed={closeAsk.failed} onChoice={closeAsk.resolve} />}
      {seqAsk && <SequenceDialog media={seqAsk.media} mismatch={seqAsk.mismatch}
        onChangeSettings={() => resolveSeq(true)} onKeepSettings={() => resolveSeq(false)} />}
      {extensionHost.preview&&<ExtensionMediaPreview preview={extensionHost.preview} onClose={extensionHost.closePreview} onInsert={extensionHost.insertPreview}/>}
      {settingsOpen && <SettingsDialog onAuthorExport={startAuthorExport} project={project} onReplaceDependency={replacePackDependency} onApplyPack={screen==='editor'?applyPackContent:undefined} initialSection={typeof settingsOpen === 'string' ? settingsOpen : 'ai'} onClose={() => { setSettingsOpen(false); setSettingsVersion((v) => v + 1); }}
        onAbout={() => setAboutOpen('settings')}
        onProxiesCleared={(deleted) => projectRef.current.media.forEach((m) => {
          // A deleted copy the player still pointed at is made again (optimizing asks for it, like a project
          // opened with a missing proxy), so the clip never stays blank until the project is reopened.
          if (m.proxy && deleted.includes(m.proxy)) dispatch({ type: 'mediaVisuals', path: m.path, patch: { proxy: null, optimizing: true } });
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
        app={pilotApp} external={{ holder: external.holder, onDisconnect: external.disconnect, subscribe: external.subscribe, yieldEdit: external.yieldEdit }} />
      {externalApproval}
        <ExtensionMessages hideJobs={!!settingsOpen||!!exporting||!!agentRun} onManage={()=>setSettingsOpen('plugins')}/><ExtensionPreparation value={extensionHost.preparing} onCancel={extensionHost.cancelBefore}/>

      {dragOver && <div className="drop-overlay"><div>{t('app.drop_files_to_import_them')}</div></div>}
      {renderJob && (
        <div className="render-job" role="status">
          {renderJob.error ? (
            <><CircleAlert size={15} /><span>{renderJob.error}</span>
              <button className="btn btn-sm" onClick={() => setRenderJob(null)}>{t('app.dismiss')}</button></>
          ) : (
            <><Loader2 size={15} className="spin" /><span>{renderJob.label}</span>
              <div className="progress render-job-bar"><div style={{ width: `${Math.round((renderJob.fraction || 0) * 100)}%` }} /></div>
              <button className="btn btn-sm btn-ghost" onClick={() => (renderJob.kind === 'detach' ? window.api.detachCancel() : renderJob.kind === 'enhance' ? window.api.enhanceCancel() : renderJob.kind === 'track' ? window.api.trackCancel() : window.api.reverseCancel())}>{t('app.cancel')}</button></>
          )}
        </div>
      )}
      {trackPick && (
        <div className="render-job" role="status">
          <Crosshair size={15} />
          <span>{t(trackPick.point ? 'app.point_set_track_it_through_the_clip' : 'app.click_the_object_you_want_to_follow')}</span>
          <button className="btn btn-sm" disabled={!trackPick.point} onClick={runTrack}>{t('app.track_motion')}</button>
          <button className="btn btn-sm btn-ghost" onClick={() => setTrackPick(null)}>{t('app.cancel')}</button>
        </div>
      )}
      {cropEdit && (() => {
        const c = findClip(project, cropEdit);
        const cur = cropEdit.draftAspect || 'free';
        const rot = cropEdit.draftRot || 0;
        return (
          <div className="render-job crop-bar" role="status">
            <Crop size={15} />
            <span>{c ? t('app.cropping_name_hint', { name: project.media.find((m) => m.id === c.mediaId)?.name || t('app.clip').toLowerCase() }) : t('app.cropping_hint')}</span>
            <span className="chips" role="group" aria-label={t('app.crop_aspect')}>
              {CROP_ASPECTS.map((a) => (
                <button key={a.id} type="button" className={`chip ${cur === a.id ? 'on' : ''}`} aria-pressed={cur === a.id}
                  onClick={() => applyCropAspect(a.id)}>{catalogName('crop_aspect', a)}</button>
              ))}
            </span>
            <span className="crop-rot" role="group" aria-label={t('app.rotate_or_straighten')}>
              <RotateCw size={13} />
              <input type="range" min="-45" max="45" step="0.5" value={Math.min(45, Math.max(-45, rot))} aria-label={t('app.rotate_degrees')}
                onChange={(e) => setCropRot(Number(e.target.value))} />
              <input type="number" className="crop-rot-num" min="-180" max="180" step="0.5" value={rot} aria-label={t('app.rotation_in_degrees')}
                onChange={(e) => setCropRot(Number(e.target.value))} />
              <span className="crop-rot-val">{rot > 0 ? `+${rot}` : rot}°</span>
            </span>
            <button className="btn btn-sm" onClick={doneCropEdit}>{t('app.done')}</button>
            <button className="btn btn-sm btn-ghost" onClick={cancelCropEdit}>{t('app.cancel')}</button>
          </div>
        );
      })()}
      {colorPick && (
        <div className="render-job" role="status">
          <Pipette size={15} />
          <span>{t('app.click_the_color_in_the_player_that_exact_p')}</span>
          <button className="btn btn-sm btn-ghost" onClick={() => setColorPick(null)}>{t('app.cancel')}</button>
        </div>
      )}
      {exporting && <ExportDialog onExtensionActionResult={({entry,message})=>showAlert((entry.extensionName||entry.extensionId)+' · '+entry.title+'\n\n'+message)} state={exporting} onCancel={cancelExport} onStart={confirmExport}
        onClose={afterClose => { if(exportRunning.current)return; if(exporting.target?.frameDir)window.api.exportAbort(exporting.target.frameDir);if(typeof afterClose==='function')extensionExportClose.current=afterClose;setExporting(null); }} onShow={() => window.api.showInFolder(exporting.file)}
        onOpen={() => window.api.openFile(exporting.file)} onPickTarget={pickExportTarget}
        onRename={renameExport} onSettings={changeExportSettings} onResolution={changeExportResolution}
        onPosterAt={changePosterAt} onPosterImage={changePosterImage} />}
    </div>
    </ErrorBoundary>
  );
}

// Draggable border between panels (double-click: default size, arrow keys: move).
function Splitter({ which, style, onStart, onReset, onNudge, label }) {
  const vertical = which !== 'bottom';
  return (
    <div className={`splitter ${vertical ? 'col' : 'row'}`} style={style} role="separator" tabIndex={0}
      aria-orientation={vertical ? 'vertical' : 'horizontal'} aria-label={label} title={t('app.splitter_title', { label })}
      onPointerDown={(e) => onStart(which, e)} onDoubleClick={() => onReset(which)} onKeyDown={(e) => onNudge(which, e)} />
  );
}
