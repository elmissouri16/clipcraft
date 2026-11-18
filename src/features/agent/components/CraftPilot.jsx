import {registerPluginProviderMetadata} from '../providers.js';
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Bot, Check, CircleAlert, Clock3, ImagePlus, ListPlus, Paperclip, Zap, Captions, Loader2, MessageCircle, MessageSquarePlus, RectangleVertical, Scissors, SlidersHorizontal, Square, Undo2, X } from 'lucide-react';
import { runAgent } from "../runAgent.js";
import { graphicEdits } from '../../graphics/graphicEdits.js';
import { makeAgentCtx } from "../agentCtx.js";
import { addTimelineAttachment, resolveTimelineAttachments, timelineAttachmentLabel, timelineContextPart } from '../timelineContext.js';
import { projectRevision, proposedPlanNote } from "../context.js";
import CraftModelPicker from './CraftModelPicker.jsx';
import SubagentControl from './SubagentControl.jsx';
import Dropdown from "../../../components/ui/Dropdown.jsx";
import { newChatSession, normalizeChatSessions, snapshotChatSessions } from "../chatSessions.js";
import { compactSavedContents } from "../context.js";
import ToolActivityRow from './ToolActivityRow.jsx';
import EditPlanCard from './EditPlanCard.jsx';
import VideoClipPicks from './VideoClipPicks.jsx';
import MessageQueue from './MessageQueue.jsx';
import ImageAttachments from './ImageAttachments.jsx';
import VideoAttachments from './VideoAttachments.jsx';
import { MAX_CHAT_VIDEOS, isVideoFile, videoMessagePart } from '../videoAttachments.js';
import { MAX_CHAT_IMAGES, imageMessageParts } from '../imageAttachments.js';
import { webSourceUrl } from "../../../../shared/webSource.mjs";
import { t, tn, rich, formatNumber } from '../../../i18n/index.js';

// Quick actions on the empty state, grouped by what they do; each sends its text as-is. The text is
// the user's message to the model, so it stays English; only the group label is panel text.
const BRAND = 'CraftAI';
const SDK_AGENTS = { 'codex-sdk': 'Codex', 'claude-agent-sdk': 'Claude', 'opencode-sdk': 'OpenCode' };
const ACTIONS = [
  { icon: Scissors, group: t('pilot.cut'), text: 'Remove the silences' },
  { icon: Captions, group: t('edit-plan-card.captions'), text: 'Add automatic captions' },
  { icon: MessageCircle, group: t('pilot.ask'), text: 'What is said in this video?' },
  { icon: RectangleVertical, group: t('home.format'), text: 'Make it vertical 9:16' },
];

// Tiny formatter: paragraphs, bold, lists and safe source links.
function Rich({ text }) {
  const blocks = text.split(/\n{2,}/);
  const inline = (s) => s.split(/(\*\*[^*]+\*\*|\[[^\]\n]+\]\(https?:\/\/[^\s)]+\))/g).map((part, i) => {
    if (part.startsWith('**')) return <b key={i}>{part.slice(2, -2)}</b>;
    const link = /^\[([^\]]+)\]\((.+)\)$/.exec(part);
    const url = link && webSourceUrl(link[2]);
    return url ? <button key={i} type="button" className="pilot-source-link" title={url} onClick={() => window.api.openWebSource(url)}>{link[1]}</button> : part;
  });
  return blocks.map((block, i) => {
    const lines = block.split('\n');
    if (lines.every((l) => /^\s*[-*•]\s+/.test(l))) {
      return <ul key={i}>{lines.map((l, j) => <li key={j}>{inline(l.replace(/^\s*[-*•]\s+/, ''))}</li>)}</ul>;
    }
    return <p key={i}>{lines.map((l, j) => <React.Fragment key={j}>{j > 0 && <br />}{inline(l)}</React.Fragment>)}</p>;
  });
}

export default function CraftAI({ getProject, getHistoryLength, dispatch, settle, onOpenSettings, settingsVersion, timelineContextRequest, presentation = 'floating', onExpand, onImport, onAttachSelection, hasSelection, onRunStateChange, onAgentFocus, runKey, onAttachmentDrag, app = {}, external = null }) {
  const [floatingOpen, setOpen] = useState(false);
  const docked = presentation === 'docked';
  const open = docked || floatingOpen;
  const [contextError, setContextError] = useState('');
  const [imageError, setImageError] = useState('');
  const [imagesLoading, setImagesLoading] = useState(false);
  const [imageDrag, setImageDrag] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const preparingRequest = useRef(false);
  const importingImages = useRef(false);
  const contextRequestSeen = useRef(null);
  const projectId = useRef(getProject().id).current;
  const [chat, setChat] = useState(() => {
    const saved = normalizeChatSessions(getProject().craftAI);
    if (!saved.sessions.length) {
      const session = newChatSession();
      saved.sessions.push(session); saved.activeSessionId = session.id;
    }
    return structuredClone(saved);
  });
  const chatRef = useRef(chat);
  // An outside agent (external MCP) holding the editor pauses CraftAI (docs/design/external-agent-mcp.md).
  const externalRef = useRef(external);
  externalRef.current = external;
  const holder = external?.holder || null;
  const session = chat.sessions.find((s) => s.id === chat.activeSessionId);
  const { messages, draft: input } = session;
  const [busy, setBusy] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [modelSaving, setModelSaving] = useState(false);
  const [config, setConfig] = useState(null); // { ready, provider, model }
  const contents = useRef(null);
  if (contents.current === null) contents.current = structuredClone(session.contents);
  const mounted = useRef(true);
  const canceled = useRef(false);
  const activeRequest = useRef(null);
  const configRequest = useRef(0);
  const listRef = useRef(null);
  const followLatest = useRef(true);
  const [awayFromLatest,setAwayFromLatest] = useState(false);
  const inputRef = useRef(null);
  const launcherRef = useRef(null);
  const closePanel = () => {
    setOpen(false);
    requestAnimationFrame(() => launcherRef.current?.focus({ preventScroll: true }));
  };
  const isCurrent = () => mounted.current && getProject().id === projectId;
  // The chat lives in the project (saved and restored with it). Storing it copies every session
  // into every history snapshot, so while the user types, the project copy is refreshed at most a
  // few times a second rather than once per keystroke; the composer shows `chat` at once. Any
  // other chat change, a send, a session switch or unmount stores the latest draft immediately.
  const pendingDraft = useRef(null); // a timer while a typed draft waits to reach the project
  const storeChat = (next) => dispatch({ type: 'craftChat', projectId, chat: snapshotChatSessions(next) });
  const flushDraft = () => {
    if (!pendingDraft.current) return;
    clearTimeout(pendingDraft.current);
    pendingDraft.current = null;
    if (getProject().id === projectId) storeChat(chatRef.current);
  };
  const saveChat = (next, { typing = false } = {}) => {
    if (!isCurrent()) return;
    chatRef.current = next;
    setChat(next);
    if (!typing) { if (pendingDraft.current) { clearTimeout(pendingDraft.current); pendingDraft.current = null; } storeChat(next); return; }
    if (!pendingDraft.current) pendingDraft.current = setTimeout(flushDraft, 200);
  };
  const updateSession = (patch, options) => {
    const current = chatRef.current;
    saveChat({ ...current, sessions: current.sessions.map((s) => s.id === current.activeSessionId
      ? { ...s, ...(typeof patch === 'function' ? patch(s) : patch) } : s) }, options);
  };
  const setMessages = (value) => updateSession((s) => ({ messages: typeof value === 'function' ? value(s.messages) : value }));
  const setInput = (draft) => updateSession({ draft }, { typing: true });

  // Files from a drop, a paste or the picker: videos become references, the rest images.
  const attachFiles = async files => {
    if (!files) {
      if (importingImages.current) return;
      if (!window.api.agentPickAttachments) return attachImages();
      importingImages.current = true; setImagesLoading(true); setImageError('');
      const sessionId = chatRef.current.activeSessionId;
      try { mergeAttachments(sessionId, await window.api.agentPickAttachments()); }
      catch (error) { if (isCurrent() && chatRef.current.activeSessionId === sessionId) setImageError(error.message); }
      finally { importingImages.current = false; if (isCurrent()) { setImagesLoading(false);requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true })); } }
      return;
    }
    const videos = files.filter(isVideoFile), images = files.filter(file => !isVideoFile(file));
    if (videos.length) await attachVideos(videos);
    if (images.length) await attachImages(images);
  };
  const mergeAttachments = (sessionId, result) => {
    if (!isCurrent()) return;
    const current = chatRef.current, target = current.sessions.find(s => s.id === sessionId);
    if (!target) return;
    const images = [...new Map([...target.images, ...(result.images || [])].map(image => [image.id, image])).values()];
    const videos = [...new Map([...(target.videos || []), ...(result.videos || [])].map(video => [video.id, video])).values()];
    saveChat({ ...current, sessions: current.sessions.map(s => s.id === sessionId ? { ...s, images: images.slice(0, MAX_CHAT_IMAGES), videos: videos.slice(0, MAX_CHAT_VIDEOS) } : s) });
    if (current.activeSessionId === sessionId) setImageError([...(result.errors || []).map(error => `${error.name ? error.name + ': ' : ''}${error.error}`),
      ...(images.length > MAX_CHAT_IMAGES ? [t('pilot.only_six_images_fit_in_a_message')] : []),
      ...(videos.length > MAX_CHAT_VIDEOS ? [t('pilot.only_three_reference_videos_fit')] : [])].join('\n'));
  };
  const attachVideos = async files => {
    if (importingImages.current) return;
    importingImages.current = true; setImagesLoading(true); setImageError('');
    const sessionId = chatRef.current.activeSessionId;
    try {
      if (!window.api.agentAttachVideos) throw Error(t('pilot.restart_to_enable_reference_videos'));
      if (files.length > MAX_CHAT_VIDEOS) throw Error(t('pilot.attach_up_to_three_reference_videos'));
      mergeAttachments(sessionId, await window.api.agentAttachVideos(files));
    } catch (error) { if (isCurrent() && chatRef.current.activeSessionId === sessionId) setImageError(error.message); }
    finally { importingImages.current = false; if (isCurrent()) setImagesLoading(false); }
  };
  const attachImages = async files => {
    if (importingImages.current) return;
    importingImages.current = true; setImagesLoading(true); setImageError('');
    const sessionId = chatRef.current.activeSessionId;
    try {
      let result;
      if (files) {
        if (files.length > MAX_CHAT_IMAGES || files.some(file => file.size > 20 * 1024 * 1024)) throw Error(t('pilot.attach_up_to_six_images_20_mb_each'));
        const items = await Promise.all(files.map(async file => ({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) })));
        result = await window.api.agentPasteImages(items);
      } else {
        if (!window.api.agentAttachImages) throw Error(t('pilot.restart_to_enable_image_attachments'));
        result = await window.api.agentAttachImages();
      }
      if (!isCurrent()) return;
      const current = chatRef.current;
      const target = current.sessions.find(s => s.id === sessionId);
      if (!target) return;
      const merged = [...new Map([...target.images, ...(result.images || [])].map(image => [image.id, image])).values()];
      saveChat({ ...current, sessions: current.sessions.map(s => s.id === sessionId ? { ...s, images: merged.slice(0, MAX_CHAT_IMAGES) } : s) });
      if (current.activeSessionId === sessionId) setImageError([...(result.errors || []).map(error => `${error.name ? error.name + ': ' : ''}${error.error}`), ...(merged.length > MAX_CHAT_IMAGES ? [t('pilot.only_six_images_fit_in_a_message')] : [])].join('\n'));
    } catch (error) { if (isCurrent() && chatRef.current.activeSessionId === sessionId) setImageError(error.message); }
    finally { importingImages.current = false; if (isCurrent()) { setImagesLoading(false);requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true })); } }
  };

  useEffect(() => {
    const request = timelineContextRequest;
    if (!request || request.id === contextRequestSeen.current || request.projectId !== projectId) return;
    contextRequestSeen.current = request.id;
    setOpen(true);setContextError('');
    if (request.error) { setContextError(request.error);return; }
    try { updateSession({ timelineAttachments: addTimelineAttachment(chatRef.current.sessions.find(s => s.id === chatRef.current.activeSessionId)?.timelineAttachments, request.attachment) }); }
    catch (error) { setContextError(error.message); }
    requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }));
  }, [timelineContextRequest]);

  const emptyTimeline = !getProject().videoClips.length && !getProject().textClips.length && !getProject().audioClips.length && !getProject().overlayClips?.length;
  const suggestions = docked && emptyTimeline ? [
    { icon: Scissors, group: t('pilot.first_cut'), text: 'Assemble a first cut using my imported media.' },
    { icon: MessageCircle, group: t('pilot.explore'), text: 'Review my imported media and suggest a video structure.' },
  ] : ACTIONS;

  const refreshConfig = useCallback(async () => {
    const generation = ++configRequest.current;
    const s = await window.api.settingsGet();
    registerPluginProviderMetadata(s.providerPlugins);
    const pluginProvider=s.providerPlugins?.find(p=>p.id===s.provider);
    const sdk = ['codex-sdk', 'claude-agent-sdk', 'opencode-sdk'].includes(s.provider);
    const modelId = s.models[s.provider] || s.defaultModels?.[s.provider] || '';
    const status = sdk ? await window.api.aiSdkStatus({ provider: s.provider, executablePath: s.executablePaths?.[s.provider] || '' }) : null;
    if (generation !== configRequest.current) return;
    setConfig({ ready: sdk ? status.ok && status.authenticated !== false : pluginProvider ? !pluginProvider.unavailable&&pluginProvider.approved&&(!pluginProvider.needsKey||!!s.keys[s.provider]) : s.provider === 'ollama' || !!s.keys[s.provider],
      provider: s.provider,providerName:pluginProvider?.name, model: modelId || (sdk ? t('pilot.agent_cli_default', { agent: SDK_AGENTS[s.provider] }) : ''),
      modelId, executablePath: s.executablePaths?.[s.provider] || '',
      reasoningEffort: s.reasoningEfforts?.[s.provider]?.[modelId] || '',
      subagents: s.subagents?.[s.provider] === true, subagentConcurrency: s.subagentConcurrency?.[s.provider] || 2,
      error: sdk ? status.error || (status.authenticated === false ? t('pilot.sign_in_with_command', { command: status.loginCommand }) : '') : pluginProvider?.unavailable?t('plugins.provider_unavailable'):'', sdk });
  }, []);
  useEffect(() => {
    refreshConfig();
  }, [refreshConfig, settingsVersion, open]);
  useEffect(()=>window.api.onPluginsChanged?.(()=>refreshConfig()),[refreshConfig]);
  useEffect(()=>{let previous='';return window.api.onExtensionState?.(state=>{const signature=JSON.stringify(state.map(job=>[job.key,job.generation,job.state]));if(signature!==previous){previous=signature;refreshConfig();}});},[refreshConfig]);
  useEffect(() => {
    mounted.current = true;
    window.addEventListener('pagehide', flushDraft);
    return () => {
      window.removeEventListener('pagehide', flushDraft);
      flushDraft();
      mounted.current = false;
      canceled.current = true;
      configRequest.current++;
      if (activeRequest.current) window.api.agentCancel?.(activeRequest.current).catch(() => {});
      onRunStateChange?.(null);
      onAgentFocus?.(null);
    };
  }, []);

  // Opening mounts a fresh list even when no messages changed while closed.
  // Position it before paint so long saved chats do not animate from the top.
  useLayoutEffect(() => {
    if (open && listRef.current) {followLatest.current=true;setAwayFromLatest(false);listRef.current.scrollTop = listRef.current.scrollHeight;}
  }, [open, chat.activeSessionId]);

  useLayoutEffect(() => {
    const field = inputRef.current;
    if (!field) return;
    field.style.height = 'auto';
    field.style.height = `${Math.min(120, field.scrollHeight)}px`;
  }, [input, open]);

  useLayoutEffect(() => {
    if (followLatest.current && listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages, busy, input, session.queue, session.timelineAttachments, session.images, imagesLoading, open]);

  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const observer = new ResizeObserver(() => {
      if (followLatest.current) list.scrollTop = list.scrollHeight;
    });
    observer.observe(list);
    return () => observer.disconnect();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    // Never take focus away from an open modal dialog (Settings, Export, About).
    const timer = setTimeout(() => { if (!document.querySelector('[role="dialog"][aria-modal="true"]')) inputRef.current?.focus({ preventScroll: true }); }, 100);
    return () => clearTimeout(timer);
  }, [open]);

  // A finished request keeps older bulky tool results as previews (context.js compactSavedContents), in the
  // live conversation and in the saved one, so neither grows with every result ever returned.
  const updateLast = (fn, completedContents) => {
    if (completedContents && completedContents === contents.current) completedContents = contents.current = compactSavedContents(contents.current);
    return updateSession((s) => ({
      messages: s.messages.map((x, i) => (i === s.messages.length - 1 ? fn(x) : x)),
      ...(completedContents ? { contents: structuredClone(completedContents) } : {}),
    }));
  };
  const stopRequest = () => {
    if(canceled.current || !activeRequest.current)return;
    canceled.current=true;setStopping(true);
    updateSession({ queuePaused: true });
    updateLast(last=>({...last,steps:(last.steps||[]).map(step=>step.status==='running'&&step.activity?.render?{...step,activity:{...step.activity,render:{...step.activity.render,stopping:true,remainingSeconds:null}}}:step)}));
    window.api.agentCancel?.(activeRequest.current).catch(()=>{});
  };
  const activeRender=messages.at(-1)?.steps?.find(step=>step.status==='running'&&step.activity?.render);
  const runningStep = messages.at(-1)?.steps?.find(step => step.status === 'running');
  useEffect(() => {
    onRunStateChange?.(busy ? { runKey, requestId: activeRequest.current, label: runningStep?.label || t('pilot.preparing_the_next_step'), stopping, onStop: stopRequest } : null);
  }, [busy, stopping, runningStep?.label]);
  // Timeline spotlight and trail (App's agentFocus, docs/agents/agent-editing.md): the running step's
  // targets and the finished changes of this turn. Keyed on step ids, apart from the strip effect above.
  const turnSteps = busy ? messages.at(-1)?.steps || [] : [];
  const liveStep = turnSteps.find((s) => s.status === 'running' && s.activity?.targets);
  const trailSteps = turnSteps.filter((s) => s.status === 'done' && s.activity?.targets);
  const focusKey = busy ? `${liveStep?.id ?? ''}|${trailSteps.map((s) => s.id).join(',')}` : '';
  useEffect(() => {
    const pick = (s) => ({ id: s.id, name: s.name, title: s.activity.title || s.label || '', targets: s.activity.targets, at: Date.now() });
    onAgentFocus?.(busy ? { runKey, requestId: activeRequest.current, live: liveStep ? pick(liveStep) : null, trail: trailSteps.slice(-24).map(pick) } : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy, focusKey]);

  const startTurn = async (item, queued = false, preserveComposer = false) => {
    const msg = item.text.trim();
    // Claim synchronously: two Enter presses cannot start concurrent requests.
    if (!externalRef.current?.holder) externalRef.current?.yieldEdit?.(); // an idle outside agent's open edit ends here, so this request can begin its own
    if (!msg || activeRequest.current || preparingRequest.current || modelSaving || !config?.ready || !isCurrent() || externalRef.current?.holder) return;
    preparingRequest.current = true;setPreparing(true);
    followLatest.current=true;setAwayFromLatest(false);
    let attached, contextPart;
    try {
      if (item.images?.length) {
        if (!window.api.agentValidateImages) throw Error(t('pilot.restart_to_enable_image_attachments'));
        const validation = await window.api.agentValidateImages(item.images.map(image => image.id));
        if (validation?.error) throw Error(validation.error);
      }
      if (item.videos?.length) {
        if (!window.api.agentValidateVideos) throw Error(t('pilot.restart_to_enable_reference_videos'));
        const validation = await window.api.agentValidateVideos(item.videos.map(video => video.id));
        if (validation?.error) throw Error(validation.error);
      }
      await graphicEdits.flush();
      attached = resolveTimelineAttachments(getProject(), item.timelineAttachments);
      contextPart = timelineContextPart(attached);
    } catch (error) { setContextError(error.message);if (queued) updateSession({ queuePaused: true });return; }
    finally { preparingRequest.current = false;if (isCurrent()) setPreparing(false); }
    if (!isCurrent()) return;
    setContextError('');
    if (queued) updateSession(s => ({ queue: s.queue.filter(entry => entry.id !== item.id) }));
    else if (!preserveComposer) updateSession({ timelineAttachments: [], images: [], videos: [], draft: '' });
    setBusy(true);
    canceled.current = false;setStopping(false);
    const requestId = crypto.randomUUID();
    const requestRevision = projectRevision(getProject());
    activeRequest.current = requestId;
    updateSession((s) => ({ title: s.messages.length ? s.title : msg.replace(/\s+/g, ' ').slice(0, 60) }));
    setMessages((m) => [...m, { role: 'user', text: msg, images: item.images || [], ...(item.videos?.length ? { videos: item.videos } : {}), timelineAttachments: attached.map(({ snapshot, status, ...attachment }) => attachment) }, { role: 'assistant', text: '', steps: [], pending: true }]);
    const conversationStart = contents.current.length;
    const videoPart = videoMessagePart(item.videos);
    contents.current.push({ role: 'user', parts: [{ text: msg }, ...(contextPart ? [{ text: contextPart }] : []), ...(videoPart ? [{ text: videoPart }] : []), ...imageMessageParts(item.images)] });

    dispatch({ type: 'beginAgentEdit', token: requestId });
    await settle();
    const result = await runAgent({
      requestId, sessionKey: `${projectId}:${chatRef.current.activeSessionId}`,
      contents: contents.current,
      ctx: makeAgentCtx({ app, provider: config?.provider, getProject, dispatch, settle, requestId, isCurrent, isStopped: () => canceled.current, allowPluginCommands: true,
        chatImageIds: (item.images || []).map(image => image.id) }),
      isCanceled: () => canceled.current || !isCurrent(),
      onEvent: (ev) => {
        if (ev.type === 'context') { updateLast((last) => ({ ...last, contextUsage: ev.usage })); return; }
        updateLast((last) => {
          const steps = [...last.steps];
          const i = steps.findIndex((s) => s.id === ev.id);
          if (i >= 0) steps[i] = ev;
          else steps.push(ev);
          return { ...last, steps };
        });
      },
    }).catch((e) => ({ error: { error: e.message } }));

    if (!isCurrent()) return;

    // Everything the assistant did becomes a single Undo step.
    const ownsUndo = app.getAgentEdit?.()?.token === requestId && app.getAgentEdit?.()?.steps.length > 0 && projectRevision(getProject()) !== requestRevision;
    const undoRevision = ownsUndo ? projectRevision(getProject()) : null;
    dispatch({ type: 'endAgentEdit', token: requestId });
    // A plan the agent proposed in this request was shown to the user, who may approve it next: it
    // must survive the checkpoint below, or "Approved" reaches an agent that never saw the plan.
    const proposedPlan = () => proposedPlanNote(contents.current.slice(conversationStart));
    if (result.error) {
      // Drop the incomplete request, including unanswered tool calls, so a retry
      // starts from a valid conversation while any completed edits remain undoable.
      const plan = proposedPlan();
      contents.current.splice(conversationStart);
      if (result.operations?.length || contextPart || item.images?.length || plan) contents.current.push({ role: 'user', parts: [{ text: `Host recovery checkpoint for interrupted request ${requestId}. Original request: ${msg}${plan}\n${contextPart ? contextPart + '\n' : ''}Completed/failed operations: ${JSON.stringify(result.operations)}\nCompleted edits remain in the live project. Read current project state before continuing; do not repeat completed operations blindly.` }, ...imageMessageParts(item.images)] });
      updateLast((last) => ({ ...last, pending: false, steps: last.steps.map(step => step.status === 'running' ? { ...step, status: 'error', detail: result.error.error } : step), error: result.error, changed: !!ownsUndo, undoRevision }), contents.current);
    } else {
      if (result.canceled) {
        const plan = proposedPlan();
        contents.current.splice(conversationStart);
        if (result.operations?.length || contextPart || item.images?.length || plan) contents.current.push({ role: 'user', parts: [{ text: `Host recovery checkpoint: request stopped. Original request: ${msg}${plan}\n${contextPart ? contextPart + '\n' : ''}Operation outcomes: ${JSON.stringify(result.operations)}\nCompleted edits remain. Read live project state before continuing.` }, ...imageMessageParts(item.images)] });
      }
      updateLast((last) => ({ ...last, pending: false, steps: last.steps.map(step => step.status === 'running' ? { ...step, status: 'error', detail: result.canceled ? t('pilot.stopped_message') : t('pilot.finished') } : step), text: result.canceled ? t('pilot.stopped_message') : result.text || t('pilot.done'), stopped: !!result.canceled, changed: !!ownsUndo, undoRevision, ...(result.tokenUsage ? { tokenUsage: result.tokenUsage } : {}) }), contents.current);
    }
    // Stop, provider errors and manual editing all require explicit queue resume.
    if (result.error || result.canceled || canceled.current) updateSession({ queuePaused: true });
    activeRequest.current = null;
    setBusy(false);setStopping(false);
  };

  const send = (text) => {
    flushDraft(); // a send attempt stores the draft as typed, whether or not the request starts
    const current = chatRef.current.sessions.find(s => s.id === chatRef.current.activeSessionId);
    const msg = text.trim() || (current.videos?.length ? 'Edit my footage in the style of the attached reference video.' : current.images.length ? 'Review the attached images.' : '');
    if (!msg || modelSaving || preparingRequest.current || importingImages.current || !config?.ready || !isCurrent() || externalRef.current?.holder || current.external) return;
    const item = { id: crypto.randomUUID(), text: msg, images: structuredClone(current.images), ...(current.videos?.length ? { videos: structuredClone(current.videos) } : {}), timelineAttachments: structuredClone(current.timelineAttachments || []) };
    if (activeRequest.current || current.queue.length) {
      updateSession(s => ({ queue: [...s.queue, item], queuePaused: s.queue.length ? s.queuePaused : !!canceled.current, draft: '', timelineAttachments: [], images: [], videos: [] }));
      setContextError('');
    } else startTurn(item);
    requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }));
  };

  useEffect(() => {
    if (!busy && !preparing && !activeRequest.current && !session.queuePaused && session.queue.length && config?.ready && !modelSaving && !holder) startTurn(session.queue[0], true);
  }, [busy, preparing, session.queue, session.queuePaused, chat.activeSessionId, config?.ready, modelSaving, holder]);

  // An outside agent's steps, in a read-only session named after it: one reply per edit, with the
  // same activity rows CraftAI shows. Reads before an edit join the reply that follows.
  useEffect(() => external?.subscribe?.((event) => {
    if (!isCurrent() || !['edit-start', 'tool', 'edit-end', 'agent-released'].includes(event.type)) return;
    const client = event.client || t('pilot.external_agent'), current = chatRef.current;
    let target = current.sessions.find((s) => s.external === client), sessions = current.sessions, activeSessionId = current.activeSessionId;
    if (!target) {
      if (event.type !== 'edit-start' && event.type !== 'tool') return;
      target = { ...newChatSession(), title: t('pilot.client_external_agent', { client }), external: client };
      sessions = [...sessions, target];
    }
    let messages = target.messages;
    const open = messages.at(-1)?.pending;
    if (event.type === 'edit-start' || event.type === 'tool') {
      if (!open) messages = [...messages, { role: 'assistant', text: '', steps: [], pending: true }];
      if (event.type === 'tool') {
        const { editId, client: _client, ...rest } = event, step = { ...rest, id: `${editId}:${event.id}` };
        messages = messages.map((m, i) => {
          if (i !== messages.length - 1) return m;
          const steps = [...m.steps], at = steps.findIndex((s) => s.id === step.id);
          if (at >= 0) steps[at] = step; else steps.push(step);
          return { ...m, steps };
        });
      }
    } else if (open && (event.type === 'agent-released' || event.reason !== 'read')) {
      const changed = !!event.changed;
      const text = event.type === 'agent-released' ? t('pilot.disconnected')
        : event.reason === 'validated' ? changed ? t('pilot.edit_complete_and_validated') : t('pilot.checked_nothing_changed')
        : event.reason === 'interrupted' ? t('pilot.interrupted_the_project_was_changed')
        : event.reason === 'canceled' ? t('pilot.stopped_by_the_agent')
        : event.reason === 'released' ? changed ? t('pilot.disconnected_changes_kept_not_validated') : t('pilot.disconnected')
        : changed ? t('pilot.changes_kept_agent_moved_on') : t('pilot.done');
      messages = messages.map((m, i) => i !== messages.length - 1 ? m : { ...m, pending: false, text,
        steps: m.steps.map((s) => s.status === 'running' ? { ...s, status: 'error', detail: t('pilot.interrupted') } : s),
        changed, undoRevision: changed && event.undoable ? projectRevision(getProject()) : null });
    } else return;
    sessions = sessions.map((s) => s.id === target.id ? { ...s, messages } : s);
    // Show the agent's session when it starts work, unless the user is writing in another chat.
    const active = sessions.find((s) => s.id === activeSessionId);
    if (event.type === 'edit-start' && activeSessionId !== target.id && !activeRequest.current && !active?.draft?.trim()) { activeSessionId = target.id; contents.current = []; }
    saveChat({ ...current, sessions, activeSessionId });
  }), [external?.subscribe]);

  const newChat = () => {
    if (activeRequest.current || preparingRequest.current || importingImages.current) return;
    const current = chatRef.current;
    const active = current.sessions.find((s) => s.id === current.activeSessionId);
    if (!active.messages.length && !active.draft.trim() && !active.timelineAttachments?.length && !active.images.length && !active.videos?.length && !active.queue.length) return;
    const next = newChatSession();
    saveChat({ ...current, activeSessionId: next.id, sessions: [...current.sessions, next] });
    contents.current = [];
    setContextError('');setImageError('');
  };

  const selectSession = (id) => {
    if (activeRequest.current || preparingRequest.current || importingImages.current) return;
    const selected = chatRef.current.sessions.find((s) => s.id === id);
    if (!selected) return;
    contents.current = structuredClone(selected.contents);
    saveChat({ ...chatRef.current, activeSessionId: id });
    setContextError('');setImageError('');
  };

  const onKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send(chatRef.current.sessions.find(s => s.id === chatRef.current.activeSessionId).draft);
    }
  };

  return (
    <div className={`pilot-shell ${open ? 'is-open' : ''} ${docked ? 'is-docked' : ''}`}>
      {open && (
        <section id="craft-ai-panel" className="pilot-panel pilot2" aria-label={t('pilot.craftai_assistant')}
          onDragOver={event => { if (![...event.dataTransfer.types].includes('Files')) return;event.preventDefault();event.stopPropagation();event.dataTransfer.dropEffect = 'copy';setImageDrag(true);onAttachmentDrag?.(); }}
          onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget)) setImageDrag(false); }}
          onDrop={event => { if (!event.dataTransfer.files.length) return;event.preventDefault();event.stopPropagation();setImageDrag(false);onAttachmentDrag?.();attachFiles([...event.dataTransfer.files]); }}>
          <header className="pilot-head">
            <span className="pilot-mark" aria-hidden="true"><Zap size={13} /></span>
            <div className="pilot-session-picker">
              <Dropdown ariaLabel={t('pilot.chat_sessions')} value={chat.activeSessionId} disabled={busy || preparing || imagesLoading}
                options={[...chat.sessions].reverse().map((s) => ({ value: s.id, label: s.queue.length ? tn('pilot.session_title_queued', s.queue.length, { title: s.title }) : s.title }))}
                onChange={selectSession} />
            </div>
            <button className="icon-btn" onClick={newChat} disabled={busy || preparing || imagesLoading || (!messages.length && !input.trim() && !session.timelineAttachments?.length && !session.videos?.length && !session.images.length && !session.queue.length)} aria-label={t('pilot.new_chat')} title={t('pilot.new_chat')}><MessageSquarePlus size={16} /></button>
            <button className="icon-btn" onClick={onOpenSettings} aria-label={t('pilot.ai_settings')} title={t('pilot.ai_settings')}><SlidersHorizontal size={16} /></button>
            {!docked && <button className="btn btn-sm" onClick={onExpand} title={t('pilot.expand_to_agent_mode')}>{t('pilot.expand')}</button>}
            {!docked && <button className="icon-btn" onClick={closePanel} aria-label={t('pilot.close_assistant')}><X size={16} /></button>}
          </header>

          <div className="pilot-list" ref={listRef} onScroll={event=>{const e=event.currentTarget;followLatest.current=e.scrollHeight-e.scrollTop-e.clientHeight<80;setAwayFromLatest(!followLatest.current);}}>
            {config && !config.ready && !session.external && (
              <div className="pilot-callout">
                <b>{t('pilot.connect_an_ai_first')}</b>
                <p>{config.error || t('pilot.choose_an_installed_agent_or_provider')}</p>
                <button className="btn btn-primary btn-sm" onClick={onOpenSettings}>{t('pilot.open_settings')}</button>
              </div>
            )}
            {!messages.length && (
              <div className="pilot-welcome">
                <div className="pilot-logo"><Zap size={22} /></div>
                <h3>{docked && emptyTimeline ? t('pilot.what_will_you_create') : t('pilot.what_should_we_edit')}</h3>
                <p>{docked ? (!getProject().media.length && emptyTimeline ? t('pilot.import_your_footage_then_describe') : emptyTimeline ? t('pilot.your_media_is_ready_describe_the_story') : t('pilot.describe_a_change_or_attach_clips')) : t('pilot.ask_in_your_own_words')}</p>
                {docked && <button className="btn btn-primary" onClick={onImport}>{t('home.import_media')}</button>}
                <div className="pilot-actions">
                  {suggestions.map((a) => {
                    const Icon = a.icon;
                    return (
                      <button key={a.text} className="pilot-action" disabled={busy || modelSaving || !config?.ready} onClick={() => docked ? setInput(a.text) : send(a.text)}>
                        <span className="pa-icon"><Icon size={15} /></span>
                        <span className="pa-text"><b>{a.group}</b><small>{a.text}</small></span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} className={`pilot-msg ${m.role}`}>
                {m.role === 'user' ? (
                  <div className="bubble" dir="auto">
                    <ImageAttachments images={m.images} />
                    <VideoAttachments videos={m.videos} />
                    {m.timelineAttachments?.length > 0 && <div className="pilot-message-context" aria-label={t('pilot.attached_timeline_context')}>{m.timelineAttachments.map(a => <span key={a.id}><Clock3 size={12} />{timelineAttachmentLabel(a)}</span>)}</div>}
                    {m.text}
                  </div>
                ) : (
                  <div className="reply">
                    <div className="pilot-reply-heading">{session.external ? <Bot size={13} /> : <Zap size={13} />}<b>{session.external || BRAND}</b>{(() => { const state = m.pending ? 'working' : m.error ? 'attention' : m.stopped || m.text === 'Stopped.' || m.text === t('pilot.stopped_message') ? 'stopped' : 'complete'; const Icon = state === 'working' ? Loader2 : state === 'attention' ? CircleAlert : state === 'stopped' ? Square : Check; return <span className={`pilot-status ${state}`}><Icon size={11} className={state === 'working' ? 'spin' : undefined} />{state === 'working' ? t('pilot.working') : state === 'attention' ? t('pilot.needs_attention') : state === 'stopped' ? t('pilot.stopped') : t('pilot.complete')}</span>; })()}</div>
                    {m.steps?.length > 0 && (
                      <details className="pilot-turn-activity" open={!docked || m.pending || m.steps.some(s => s.status === 'error') ? true : undefined}>
                        <summary>{m.pending ? <Loader2 size={12} className="spin" /> : <Check size={12} />}{m.pending ? t('pilot.work_in_progress') : t('pilot.view_activity')}<span>{tn('pilot.steps', m.steps.length)}</span></summary>
                        <ul className="pilot-steps">
                          {m.steps.map((s) => <ToolActivityRow key={s.id} step={s} onCancel={busy&&s.status==='running'&&s.activity?.render?stopRequest:undefined} />)}
                        </ul>
                      </details>
                    )}
                    {m.pending && !m.steps?.length && <div className="pilot-thinking"><Loader2 size={14} className="spin" /> {t('pilot.thinking')}</div>}
                    {(() => {
                      const discovery = m.steps?.findLast?.(s => s.status === 'done' && s.activity?.discovery)?.activity.discovery;
                      if (!discovery) return null;
                      return <VideoClipPicks data={discovery} actionable={!m.pending && !busy && !modelSaving && config?.ready && !holder && !session.external && !session.queue.length}
                        onAdd={pick => send(`Add the proposed source clip to the end of my current timeline using add_video_clip with media_id ${JSON.stringify(pick.media_id)}, index_id ${JSON.stringify(pick.index_id)} and pick_id ${JSON.stringify(pick.pick_id)}. Keep the existing edit and use this pick's exact source range.`)} />;
                    })()}
                    {(() => {
                      const plan = m.steps?.findLast?.(s => s.name === 'propose_edit_plan' && s.status === 'done' && s.activity?.plan);
                      if (!plan) return null;
                      // Only the latest reply can be approved, and only once nothing else is running.
                      const actionable = !m.pending && !busy && i === messages.length - 1 && !session.queue.length;
                      return <EditPlanCard plan={plan.activity.plan} actionable={actionable}
                        onApprove={() => send('Approved. Carry out this edit plan, then review the result with critique_edit.')}
                        onChange={() => { setInput('Change the plan: ');requestAnimationFrame(() => inputRef.current?.focus()); }} />;
                    })()}
                    {m.text && <div className="bubble" dir="auto"><Rich text={m.text} /></div>}
                    {m.tokenUsage?.inputTokens > 0 && (
                      <small className="pilot-context-usage" title={t('pilot.reported_by_the_provider_for_this_reply_ca')}>
                        {t(m.tokenUsage.cachedInputTokens ? 'pilot.token_usage_with_cached' : 'pilot.token_usage', { input: formatNumber(m.tokenUsage.inputTokens), cached: formatNumber(m.tokenUsage.cachedInputTokens || 0), output: formatNumber(m.tokenUsage.outputTokens || 0) })}
                      </small>
                    )}
                    {!m.tokenUsage && m.contextUsage?.requests > 0 && (
                      <small className="pilot-context-usage" title={t('pilot.rough_input_estimate_across_this_replys_mo')}>
                        {tn('pilot.estimated_input_tokens_requests', m.contextUsage.requests, { tokens: formatNumber(Math.ceil(m.contextUsage.inputChars / 4)) })}
                      </small>
                    )}
                    {m.error && (
                      <div className="pilot-error" role="alert">
                        <b>{/project changed|no longer owns|editing session/i.test(m.error.error || '') || ['edit_interrupted','edit_timeout','edit_limit'].includes(m.error.code) ? t('pilot.editing_was_interrupted') : t('pilot.request_needs_attention')}</b>
                        <p>{m.error.error}</p>
                        <div className="pilot-error-actions">
                          {m.error.suggestModel && <button className="btn btn-sm btn-primary" onClick={onOpenSettings}>{t('pilot.change_model_in_settings')}</button>}
                          {m.error.link && <button className="btn btn-sm" onClick={() => window.api.openHelp(m.error.link)}>{m.error.linkLabel || t('pilot.open_the_google_page')}</button>}
                          {!m.error.link && !m.error.suggestModel && (/project changed|no longer owns|editing session/i.test(m.error.error || '') || ['edit_interrupted','edit_timeout','edit_limit'].includes(m.error.code)
                            ? <button className="btn btn-sm" disabled={busy || modelSaving || !config?.ready} onClick={() => startTurn({ text: 'Continue the interrupted request from the current timeline. Read the current project, reuse completed media and edits, and finish the remaining work.', timelineAttachments: [] }, false, true)}>{t('pilot.continue_from_current_timeline')}</button>
                            : <button className="btn btn-sm" onClick={onOpenSettings}>{t('pilot.open_settings')}</button>)}
                        </div>
                      </div>
                    )}
                    {m.changed && m.undoRevision === projectRevision(getProject()) && !m.pending && (
                      <button className="pilot-undo" onClick={() => dispatch({ type: 'undo' })}><Undo2 size={13} /> {t('pilot.undo_these_changes')}</button>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>

          {awayFromLatest&&<div className="pilot-latest"><button type="button" onClick={()=>{followLatest.current=true;setAwayFromLatest(false);if(listRef.current)listRef.current.scrollTop=listRef.current.scrollHeight;}}><ArrowDown size={13} />{busy ? t('pilot.latest_activity') : t('pilot.latest_messages')}</button></div>}
          <div className="pilot-composer">
            {holder && <div className="pilot-external" role="status"><span>{rich('pilot.holder_is_working_craftai_is_paused', { holder })}</span><button type="button" className="btn btn-sm" onClick={external.onDisconnect}>{t('external.disconnect')}</button></div>}
            {!holder && session.external && <div className="pilot-external" role="status"><span>{rich('pilot.what_the_agent_did_start_a_new_chat', { agent: session.external })}</span><button type="button" className="btn btn-sm" onClick={newChat}><MessageSquarePlus size={13} /> {t('pilot.new_chat')}</button></div>}
            {busy && <div className="pilot-run-status"><Loader2 size={14} className="spin" /><span role="status">{stopping ? t('pilot.stopping_ellipsis') : runningStep?.label || t('pilot.working_on_your_request')}</span><button className="pilot-text-btn" onClick={stopRequest} disabled={stopping} aria-label={t('pilot.stop')}><Square size={11} />{stopping ? t('pilot.stopping') : t('pilot.stop')}</button></div>}
            <MessageQueue key={session.id} items={session.queue} paused={session.queuePaused} busy={busy} disabled={!config?.ready || modelSaving || stopping || preparing}
              onPause={() => updateSession({ queuePaused: true })}
              onResume={() => { setContextError('');updateSession({ queuePaused: false }); }}
              onChange={(id, patch) => { updateSession(s => ({ queue: s.queue.map(item => item.id === id ? { ...item, ...patch } : item) }));setContextError(''); }}
              onRemove={id => { updateSession(s => ({ queue: s.queue.filter(item => item.id !== id) }));setContextError(''); }} />
            {contextError && <p className="pilot-context-error" role="alert">{contextError}</p>}
            <div className={`pilot-input${session.timelineAttachments?.length || session.videos?.length || session.images.length || imagesLoading || imageError ? ' has-attachments' : ''}`}>
              {(session.timelineAttachments?.length > 0 || session.videos?.length > 0 || session.images.length > 0 || imagesLoading || imageError) && (
                <div className="pilot-attachments">
                  {session.timelineAttachments?.length > 0 && (
                    <div className="pilot-timeline-context" aria-label={t('pilot.timeline_context_for_next_message')} title={t('pilot.attached_timeline_refreshed_when_sent')}>
                      {session.timelineAttachments.map(a => <div key={a.id} className="pilot-context-chip">
                  <button type="button" className="pilot-context-jump" onClick={() => app.seekTimeline?.(a.start_sec)} title={t('pilot.jump_to_this_timeline_part')}><Clock3 size={13} /><span>{timelineAttachmentLabel(a)}</span></button>
                  <button type="button" className="icon-btn sm" aria-label={t('pilot.remove_from_context', { label: timelineAttachmentLabel(a) })} onClick={() => { updateSession({ timelineAttachments: session.timelineAttachments.filter(item => item.id !== a.id) });setContextError(''); }}><X size={12} /></button>
                </div>)}
                    </div>
                  )}
                  {session.videos?.length > 0 && <div className="pilot-image-attachments"><VideoAttachments videos={session.videos} onRemove={id => { updateSession({ videos: session.videos.filter(video => video.id !== id) });setContextError(''); }} /></div>}
                  {session.images.length > 0 && <div className="pilot-image-attachments"><ImageAttachments images={session.images} onRemove={id => { updateSession({ images: session.images.filter(image => image.id !== id) });setContextError(''); }} /></div>}
                  {imagesLoading && <div className="pilot-image-loading" role="status"><Loader2 size={13} className="spin" />{t('pilot.preparing_attachments')}</div>}
                  {imageError && <div className="pilot-image-error" role="alert"><span>{imageError}</span><button type="button" className="icon-btn sm" aria-label={t('pilot.dismiss_attachment_error')} onClick={() => setImageError('')}><X size={12} /></button></div>}
                </div>
              )}
              <textarea ref={inputRef} rows={2} value={input} dir="auto"
                placeholder={busy || session.queue.length ? t('pilot.add_the_next_instruction') : t('pilot.describe_your_next_edit')}
                onPaste={event => { const files = [...event.clipboardData.files];if (files.length) { event.preventDefault();attachFiles(files); } }}
                onChange={(e) => setInput(e.target.value)} onKeyDown={onKeyDown} disabled={!config?.ready || !!holder || !!session.external} aria-label={t('pilot.message')} />
              <div className="pilot-input-bar">
                <div className="pilot-input-tools">
                  <button type="button" className="pilot-attach-button" aria-label={t('pilot.attach_images_or_reference_videos')} title={t('pilot.attach_images_or_reference_videos_or_drop')} disabled={imagesLoading || preparing || (session.images.length >= MAX_CHAT_IMAGES && (session.videos?.length || 0) >= MAX_CHAT_VIDEOS)} onClick={() => attachFiles(null)}><Paperclip size={17} /></button>
                  {docked && <button type="button" className="icon-btn sm pilot-attach-selection" onClick={onAttachSelection} disabled={!hasSelection} aria-label={t('pilot.attach_selected_clips')} title={`${t('pilot.attach_selected_clips')} · ${t('pilot.shift_drag_the_timeline_ruler_to_attach_a')}`}><Clock3 size={14} /></button>}
                  <SubagentControl config={config} disabled={busy || preparing || modelSaving || !!holder || !!session.external} onSavingChange={setModelSaving} onSaved={s => {
                    configRequest.current++;
                    setConfig(previous => ({ ...previous, subagents: s.subagents?.[s.provider] === true, subagentConcurrency: s.subagentConcurrency?.[s.provider] || 2 }));
                  }} />
                </div>
                <div className="pilot-input-end">
                  <CraftModelPicker config={config} disabled={busy || preparing || modelSaving} onSavingChange={setModelSaving} onSaved={(s) => {
              configRequest.current++;
              const modelId = s.models[s.provider] || s.defaultModels?.[s.provider] || '';
              setConfig((previous) => ({ ...previous, modelId,
                model: modelId || (SDK_AGENTS[s.provider] ? t('pilot.agent_cli_default', { agent: SDK_AGENTS[s.provider] }) : ''),
                reasoningEffort: s.reasoningEfforts?.[s.provider]?.[modelId] || '',
              }));
            }} />
                  <button className="send" onClick={() => send(chatRef.current.sessions.find(s => s.id === chatRef.current.activeSessionId).draft)} disabled={modelSaving || preparing || imagesLoading || (!input.trim() && !session.images.length && !session.videos?.length) || !config?.ready || !!holder || !!session.external} aria-label={busy || session.queue.length ? t('pilot.queue_message') : t('pilot.send')} title={busy || session.queue.length ? t('pilot.add_to_queue_enter') : t('pilot.send_enter')}>{preparing ? <Loader2 size={17} className="spin" /> : busy || session.queue.length ? <ListPlus size={17} /> : <ArrowUp size={17} />}</button>
                </div>
              </div>
            </div>
            <div className="pilot-composer-hint"><span>{busy || session.queue.length ? t('pilot.enter_to_queue_shift_enter_new_line') : t('pilot.enter_to_send_shift_enter_new_line')}</span></div>
          </div>
          {imageDrag && <div className="pilot-image-drop" aria-hidden="true"><ImagePlus size={28} /><b>{t('pilot.drop_reference_images')}</b><span>{t('pilot.up_to_6_images_20_mb_each')}</span></div>}
        </section>
      )}

      <button hidden={docked} ref={launcherRef} className="pilot-fab" onClick={() => setOpen(true)} aria-expanded={open}
        aria-controls={open ? 'craft-ai-panel' : undefined} aria-hidden={open || undefined} tabIndex={open ? -1 : 0} aria-label={t('pilot.craftai_assistant')}>
        <span className="pilot-fab-icon"><Zap size={17} /></span>
        <span>{activeRender?t(activeRender.name==='review_section'?'pilot.review_percent':'pilot.export_percent',{percent:Math.floor((activeRender.activity.render.progress||0)*100)}):busy?t('pilot.craftai_working'):BRAND}</span>
      </button>
    </div>
  );
}
