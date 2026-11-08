import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Check, Clock3, ImagePlus, ListPlus, Paperclip, Zap, Captions, Loader2, MessageCircle, MessageSquarePlus, RectangleVertical, Scissors, Settings, Square, Undo2, X } from 'lucide-react';
import { runAgent } from "../runAgent.js";
import { makeAgentCtx } from "../agentCtx.js";
import { addTimelineAttachment, resolveTimelineAttachments, timelineAttachmentLabel, timelineContextPart } from '../timelineContext.js';
import { projectRevision, proposedPlanNote } from "../context.js";
import CraftModelPicker from './CraftModelPicker.jsx';
import Dropdown from "../../../components/ui/Dropdown.jsx";
import { newChatSession, normalizeChatSessions, snapshotChatSessions } from "../chatSessions.js";
import ToolActivityRow from './ToolActivityRow.jsx';
import EditPlanCard from './EditPlanCard.jsx';
import MessageQueue from './MessageQueue.jsx';
import ImageAttachments from './ImageAttachments.jsx';
import VideoAttachments from './VideoAttachments.jsx';
import { MAX_CHAT_VIDEOS, isVideoFile, videoMessagePart } from '../videoAttachments.js';
import { MAX_CHAT_IMAGES, imageMessageParts } from '../imageAttachments.js';
import { webSourceUrl } from "../../../../shared/webSource.mjs";

// Quick actions on the empty state, grouped by what they do; each sends its text as-is.
const ACTIONS = [
  { icon: Scissors, group: 'Cut', text: 'Remove the silences' },
  { icon: Captions, group: 'Captions', text: 'Add automatic captions' },
  { icon: MessageCircle, group: 'Ask', text: 'What is said in this video?' },
  { icon: RectangleVertical, group: 'Format', text: 'Make it vertical 9:16' },
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

export default function CraftAI({ getProject, getHistoryLength, dispatch, settle, onOpenSettings, settingsVersion, timelineContextRequest, presentation = 'floating', onExpand, onImport, onAttachSelection, hasSelection, onRunStateChange, runKey, onAttachmentDrag, app = {} }) {
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
  const saveChat = (next) => {
    if (!isCurrent()) return;
    chatRef.current = next;
    setChat(next);
    dispatch({ type: 'craftChat', projectId, chat: snapshotChatSessions(next) });
  };
  const updateSession = (patch) => {
    const current = chatRef.current;
    saveChat({ ...current, sessions: current.sessions.map((s) => s.id === current.activeSessionId
      ? { ...s, ...(typeof patch === 'function' ? patch(s) : patch) } : s) });
  };
  const setMessages = (value) => updateSession((s) => ({ messages: typeof value === 'function' ? value(s.messages) : value }));
  const setInput = (draft) => updateSession({ draft });

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
      ...(images.length > MAX_CHAT_IMAGES ? ['Only six images fit in a message. Additional images were not attached.'] : []),
      ...(videos.length > MAX_CHAT_VIDEOS ? ['Only three reference videos fit in a message. Additional videos were not attached.'] : [])].join('\n'));
  };
  const attachVideos = async files => {
    if (importingImages.current) return;
    importingImages.current = true; setImagesLoading(true); setImageError('');
    const sessionId = chatRef.current.activeSessionId;
    try {
      if (!window.api.agentAttachVideos) throw Error('Restart ClipCraft to enable reference videos.');
      if (files.length > MAX_CHAT_VIDEOS) throw Error('Attach up to three reference videos per message.');
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
        if (files.length > MAX_CHAT_IMAGES || files.some(file => file.size > 20 * 1024 * 1024)) throw Error('Attach up to six images, up to 20 MB each.');
        const items = await Promise.all(files.map(async file => ({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) })));
        result = await window.api.agentPasteImages(items);
      } else {
        if (!window.api.agentAttachImages) throw Error('Restart ClipCraft to enable image attachments.');
        result = await window.api.agentAttachImages();
      }
      if (!isCurrent()) return;
      const current = chatRef.current;
      const target = current.sessions.find(s => s.id === sessionId);
      if (!target) return;
      const merged = [...new Map([...target.images, ...(result.images || [])].map(image => [image.id, image])).values()];
      saveChat({ ...current, sessions: current.sessions.map(s => s.id === sessionId ? { ...s, images: merged.slice(0, MAX_CHAT_IMAGES) } : s) });
      if (current.activeSessionId === sessionId) setImageError([...(result.errors || []).map(error => `${error.name ? error.name + ': ' : ''}${error.error}`), ...(merged.length > MAX_CHAT_IMAGES ? ['Only six images fit in a message. Additional images were not attached.'] : [])].join('\n'));
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
    { icon: Scissors, group: 'First cut', text: 'Assemble a first cut using my imported media.' },
    { icon: MessageCircle, group: 'Explore', text: 'Review my imported media and suggest a video structure.' },
  ] : ACTIONS;

  const refreshConfig = useCallback(async () => {
    const generation = ++configRequest.current;
    const s = await window.api.settingsGet();
    const sdk = ['codex-sdk', 'claude-agent-sdk'].includes(s.provider);
    const modelId = s.models[s.provider] || s.defaultModels?.[s.provider] || '';
    const status = sdk ? await window.api.aiSdkStatus({ provider: s.provider, executablePath: s.executablePaths?.[s.provider] || '' }) : null;
    if (generation !== configRequest.current) return;
    setConfig({ ready: sdk ? status.ok && status.authenticated !== false : s.provider === 'ollama' || !!s.keys[s.provider],
      provider: s.provider, model: modelId || (sdk ? `${s.provider === 'codex-sdk' ? 'Codex' : 'Claude'} · CLI default` : ''),
      modelId, executablePath: s.executablePaths?.[s.provider] || '',
      reasoningEffort: s.reasoningEfforts?.[s.provider]?.[modelId] || '',
      error: sdk ? status.error || (status.authenticated === false ? `Sign in with ${status.loginCommand}.` : '') : '', sdk });
  }, []);
  useEffect(() => {
    refreshConfig();
  }, [refreshConfig, settingsVersion, open]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      canceled.current = true;
      configRequest.current++;
      if (activeRequest.current) window.api.agentCancel?.(activeRequest.current).catch(() => {});
      onRunStateChange?.(null);
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
    const timer = setTimeout(() => inputRef.current?.focus({ preventScroll: true }), 100);
    return () => clearTimeout(timer);
  }, [open]);

  const updateLast = (fn, completedContents) => updateSession((s) => ({
    messages: s.messages.map((x, i) => (i === s.messages.length - 1 ? fn(x) : x)),
    ...(completedContents ? { contents: structuredClone(completedContents) } : {}),
  }));
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
    onRunStateChange?.(busy ? { runKey, requestId: activeRequest.current, label: runningStep?.label || 'Preparing the next step…', stopping, onStop: stopRequest } : null);
  }, [busy, stopping, runningStep?.label]);

  const startTurn = async (item, queued = false, preserveComposer = false) => {
    const msg = item.text.trim();
    // Claim synchronously: two Enter presses cannot start concurrent requests.
    if (!msg || activeRequest.current || preparingRequest.current || modelSaving || !config?.ready || !isCurrent()) return;
    preparingRequest.current = true;setPreparing(true);
    followLatest.current=true;setAwayFromLatest(false);
    let attached, contextPart;
    try {
      if (item.images?.length) {
        if (!window.api.agentValidateImages) throw Error('Restart ClipCraft to enable image attachments.');
        const validation = await window.api.agentValidateImages(item.images.map(image => image.id));
        if (validation?.error) throw Error(validation.error);
      }
      if (item.videos?.length) {
        if (!window.api.agentValidateVideos) throw Error('Restart ClipCraft to enable reference videos.');
        const validation = await window.api.agentValidateVideos(item.videos.map(video => video.id));
        if (validation?.error) throw Error(validation.error);
      }
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
      ctx: makeAgentCtx({ app, provider: config?.provider, getProject, dispatch, settle, requestId, isCurrent, isStopped: () => canceled.current,
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
      updateLast((last) => ({ ...last, pending: false, steps: last.steps.map(step => step.status === 'running' ? { ...step, status: 'error', detail: result.canceled ? 'Stopped.' : 'Finished.' } : step), text: result.canceled ? 'Stopped.' : result.text || 'Done.', changed: !!ownsUndo, undoRevision, ...(result.tokenUsage ? { tokenUsage: result.tokenUsage } : {}) }), contents.current);
    }
    // Stop, provider errors and manual editing all require explicit queue resume.
    if (result.error || result.canceled || canceled.current) updateSession({ queuePaused: true });
    activeRequest.current = null;
    setBusy(false);setStopping(false);
  };

  const send = (text) => {
    const current = chatRef.current.sessions.find(s => s.id === chatRef.current.activeSessionId);
    const msg = text.trim() || (current.videos?.length ? 'Edit my footage in the style of the attached reference video.' : current.images.length ? 'Review the attached images.' : '');
    if (!msg || modelSaving || preparingRequest.current || importingImages.current || !config?.ready || !isCurrent()) return;
    const item = { id: crypto.randomUUID(), text: msg, images: structuredClone(current.images), ...(current.videos?.length ? { videos: structuredClone(current.videos) } : {}), timelineAttachments: structuredClone(current.timelineAttachments || []) };
    if (activeRequest.current || current.queue.length) {
      updateSession(s => ({ queue: [...s.queue, item], queuePaused: s.queue.length ? s.queuePaused : !!canceled.current, draft: '', timelineAttachments: [], images: [], videos: [] }));
      setContextError('');
    } else startTurn(item);
    requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }));
  };

  useEffect(() => {
    if (!busy && !preparing && !activeRequest.current && !session.queuePaused && session.queue.length && config?.ready && !modelSaving) startTurn(session.queue[0], true);
  }, [busy, preparing, session.queue, session.queuePaused, chat.activeSessionId, config?.ready, modelSaving]);

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
        <section id="craft-ai-panel" className="pilot-panel pilot2" aria-label="CraftAI assistant"
          onDragOver={event => { if (![...event.dataTransfer.types].includes('Files')) return;event.preventDefault();event.stopPropagation();event.dataTransfer.dropEffect = 'copy';setImageDrag(true);onAttachmentDrag?.(); }}
          onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget)) setImageDrag(false); }}
          onDrop={event => { if (!event.dataTransfer.files.length) return;event.preventDefault();event.stopPropagation();setImageDrag(false);onAttachmentDrag?.();attachFiles([...event.dataTransfer.files]); }}>
          <header className="pilot-head">
            <CraftModelPicker config={config} disabled={busy || preparing} onSavingChange={setModelSaving} onSaved={(s) => {
              configRequest.current++;
              const modelId = s.models[s.provider] || s.defaultModels?.[s.provider] || '';
              setConfig((previous) => ({ ...previous, modelId,
                model: modelId || (s.provider === 'codex-sdk' ? 'Codex · CLI default' : s.provider === 'claude-agent-sdk' ? 'Claude · CLI default' : ''),
                reasoningEffort: s.reasoningEfforts?.[s.provider]?.[modelId] || '',
              }));
            }} />
            <button className="icon-btn" onClick={newChat} disabled={busy || preparing || imagesLoading || (!messages.length && !input.trim() && !session.timelineAttachments?.length && !session.videos?.length && !session.images.length && !session.queue.length)} aria-label="New chat" title="New chat"><MessageSquarePlus size={16} /></button>
            <button className="icon-btn" onClick={onOpenSettings} aria-label="AI settings" title="AI settings"><Settings size={16} /></button>
            {!docked && <button className="btn btn-sm" onClick={onExpand} title="Expand to Agent mode">Expand</button>}
            {!docked && <button className="icon-btn" onClick={closePanel} aria-label="Close assistant"><X size={16} /></button>}
          </header>

          <div className="pilot-session-picker">
            <span className="pilot-section-label">Conversation</span>
            <Dropdown ariaLabel="Chat sessions" value={chat.activeSessionId} disabled={busy || preparing || imagesLoading}
              options={[...chat.sessions].reverse().map((s) => ({ value: s.id, label: s.title + (s.queue.length ? ` · ${s.queue.length} queued` : '') }))}
              onChange={selectSession} />
          </div>

          <div className="pilot-list" ref={listRef} onScroll={event=>{const e=event.currentTarget;followLatest.current=e.scrollHeight-e.scrollTop-e.clientHeight<80;setAwayFromLatest(!followLatest.current);}}>
            {config && !config.ready && (
              <div className="pilot-callout">
                <b>Connect an AI first</b>
                <p>{config.error || 'Choose an installed Codex or Claude agent, a local Ollama model, or an API provider in Settings.'}</p>
                <button className="btn btn-primary btn-sm" onClick={onOpenSettings}>Open Settings</button>
              </div>
            )}
            {!messages.length && (
              <div className="pilot-welcome">
                <div className="pilot-logo"><Zap size={22} /></div>
                <h3>{docked && emptyTimeline ? 'What will you create?' : 'What should we edit?'}</h3>
                <p>{docked ? (!getProject().media.length && emptyTimeline ? 'Import your footage, then describe the video you want to make.' : emptyTimeline ? 'Your media is ready. Describe the story, style, and length you want.' : 'Describe a change, or attach clips and a time range to focus the edit.') : 'Ask in your own words. I can cut silences, add captions, write titles, change speed or format, apply filters and more.'}</p>
                {docked && <button className="btn btn-primary" onClick={onImport}>Import media</button>}
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
                    {m.timelineAttachments?.length > 0 && <div className="pilot-message-context" aria-label="Attached timeline context">{m.timelineAttachments.map(a => <span key={a.id}><Clock3 size={12} />{timelineAttachmentLabel(a)}</span>)}</div>}
                    {m.text}
                  </div>
                ) : (
                  <div className="reply">
                    <div className="pilot-reply-heading"><Zap size={13} /><b>CraftAI</b><span>{m.pending ? 'Working' : m.error ? 'Needs attention' : m.text === 'Stopped.' ? 'Stopped' : 'Complete'}</span></div>
                    {m.steps?.length > 0 && (
                      <details className="pilot-turn-activity" open={!docked || m.pending || m.steps.some(s => s.status === 'error') ? true : undefined}>
                        <summary>{m.pending ? <Loader2 size={12} className="spin" /> : <Check size={12} />}{m.pending ? 'Work in progress' : 'View activity'}<span>{m.steps.length} {m.steps.length === 1 ? 'step' : 'steps'}</span></summary>
                        <ul className="pilot-steps">
                          {m.steps.map((s) => <ToolActivityRow key={s.id} step={s} onCancel={busy&&s.status==='running'&&s.activity?.render?stopRequest:undefined} />)}
                        </ul>
                      </details>
                    )}
                    {m.pending && !m.steps?.length && <div className="pilot-thinking"><Loader2 size={14} className="spin" /> Thinking…</div>}
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
                      <small className="pilot-context-usage" title="Reported by the provider for this reply. Cached input is re-read context, billed at a reduced rate.">
                        {m.tokenUsage.inputTokens.toLocaleString()} input tokens{m.tokenUsage.cachedInputTokens ? ` (${m.tokenUsage.cachedInputTokens.toLocaleString()} cached)` : ''} · {(m.tokenUsage.outputTokens || 0).toLocaleString()} output
                      </small>
                    )}
                    {!m.tokenUsage && m.contextUsage?.requests > 0 && (
                      <small className="pilot-context-usage" title="Rough input estimate across this reply's model requests, including conversation and tool schemas. Provider tokenization and SDK overhead can differ.">
                        ~{Math.ceil(m.contextUsage.inputChars / 4).toLocaleString()} estimated input tokens · {m.contextUsage.requests} {m.contextUsage.requests === 1 ? 'request' : 'requests'}
                      </small>
                    )}
                    {m.error && (
                      <div className="pilot-error" role="alert">
                        <b>{/project changed|no longer owns|editing session/i.test(m.error.error || '') || ['edit_interrupted','edit_timeout','edit_limit'].includes(m.error.code) ? 'Editing was interrupted' : 'Request needs attention'}</b>
                        <p>{m.error.error}</p>
                        <div className="pilot-error-actions">
                          {m.error.suggestModel && <button className="btn btn-sm btn-primary" onClick={onOpenSettings}>Change model in Settings</button>}
                          {m.error.link && <button className="btn btn-sm" onClick={() => window.api.openHelp(m.error.link)}>{m.error.linkLabel || 'Open the Google page'}</button>}
                          {!m.error.link && !m.error.suggestModel && (/project changed|no longer owns|editing session/i.test(m.error.error || '') || ['edit_interrupted','edit_timeout','edit_limit'].includes(m.error.code)
                            ? <button className="btn btn-sm" disabled={busy || modelSaving || !config?.ready} onClick={() => startTurn({ text: 'Continue the interrupted request from the current timeline. Read the current project, reuse completed media and edits, and finish the remaining work.', timelineAttachments: [] }, false, true)}>Continue from current timeline</button>
                            : <button className="btn btn-sm" onClick={onOpenSettings}>Open Settings</button>)}
                        </div>
                      </div>
                    )}
                    {m.changed && m.undoRevision === projectRevision(getProject()) && !m.pending && (
                      <button className="pilot-undo" onClick={() => dispatch({ type: 'undo' })}><Undo2 size={13} /> Undo these changes</button>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>

          {awayFromLatest&&<div className="pilot-latest"><button type="button" onClick={()=>{followLatest.current=true;setAwayFromLatest(false);if(listRef.current)listRef.current.scrollTop=listRef.current.scrollHeight;}}><ArrowDown size={13} />{busy ? 'Latest activity' : 'Latest messages'}</button></div>}
          <div className="pilot-composer">
            {busy && <div className="pilot-run-status"><Loader2 size={14} className="spin" /><span role="status">{stopping ? 'Stopping…' : runningStep?.label || 'Working on your request…'}</span><button className="pilot-text-btn" onClick={stopRequest} disabled={stopping} aria-label="Stop"><Square size={11} />{stopping ? 'Stopping' : 'Stop'}</button></div>}
            <MessageQueue key={session.id} items={session.queue} paused={session.queuePaused} busy={busy} disabled={!config?.ready || modelSaving || stopping || preparing}
              onPause={() => updateSession({ queuePaused: true })}
              onResume={() => { setContextError('');updateSession({ queuePaused: false }); }}
              onChange={(id, patch) => { updateSession(s => ({ queue: s.queue.map(item => item.id === id ? { ...item, ...patch } : item) }));setContextError(''); }}
              onRemove={id => { updateSession(s => ({ queue: s.queue.filter(item => item.id !== id) }));setContextError(''); }} />
            {docked && <div className="pilot-context-actions"><button className="pilot-text-btn" onClick={onAttachSelection} disabled={!hasSelection}><Clock3 size={13} />Attach selected clips</button><span className="muted" title="Shift-drag the timeline ruler to attach a range">or Shift-drag a range</span></div>}
            {session.timelineAttachments?.length > 0 && (
              <div className="pilot-timeline-context" aria-label="Timeline context for next message">
                <span className="pilot-context-hint">Attached timeline · refreshed when sent</span>
                {session.timelineAttachments.map(a => <div key={a.id} className="pilot-context-chip">
                  <button type="button" className="pilot-context-jump" onClick={() => app.seekTimeline?.(a.start_sec)} title="Jump to this timeline part"><Clock3 size={13} /><span>{timelineAttachmentLabel(a)}</span></button>
                  <button type="button" className="icon-btn sm" aria-label={`Remove ${timelineAttachmentLabel(a)} from context`} onClick={() => { updateSession({ timelineAttachments: session.timelineAttachments.filter(item => item.id !== a.id) });setContextError(''); }}><X size={12} /></button>
                </div>)}
              </div>
            )}
            {contextError && <p className="pilot-context-error" role="alert">{contextError}</p>}
            {session.videos?.length > 0 && <div className="pilot-image-attachments"><VideoAttachments videos={session.videos} onRemove={id => { updateSession({ videos: session.videos.filter(video => video.id !== id) });setContextError(''); }} /></div>}
            {session.images.length > 0 && <div className="pilot-image-attachments"><ImageAttachments images={session.images} onRemove={id => { updateSession({ images: session.images.filter(image => image.id !== id) });setContextError(''); }} /></div>}
            {imagesLoading && <div className="pilot-image-loading" role="status"><Loader2 size={13} className="spin" />Preparing attachments…</div>}
            {imageError && <div className="pilot-image-error" role="alert"><span>{imageError}</span><button type="button" className="icon-btn sm" aria-label="Dismiss attachment error" onClick={() => setImageError('')}><X size={12} /></button></div>}
            <div className="pilot-input">
              <button type="button" className="pilot-attach-button" aria-label="Attach images or reference videos" title="Attach images or reference videos · or drop/paste here · up to 6 images and 3 videos" disabled={imagesLoading || preparing || (session.images.length >= MAX_CHAT_IMAGES && (session.videos?.length || 0) >= MAX_CHAT_VIDEOS)} onClick={() => attachFiles(null)}><Paperclip size={17} /></button>
              <textarea ref={inputRef} rows={2} value={input} dir="auto"
                placeholder={busy || session.queue.length ? 'Add the next instruction…' : 'Describe your next edit…'}
                onPaste={event => { const files = [...event.clipboardData.files];if (files.length) { event.preventDefault();attachFiles(files); } }}
                onChange={(e) => setInput(e.target.value)} onKeyDown={onKeyDown} disabled={!config?.ready} aria-label="Message" />
              <button className="send" onClick={() => send(chatRef.current.sessions.find(s => s.id === chatRef.current.activeSessionId).draft)} disabled={modelSaving || preparing || imagesLoading || (!input.trim() && !session.images.length && !session.videos?.length) || !config?.ready} aria-label={busy || session.queue.length ? 'Queue message' : 'Send'} title={busy || session.queue.length ? 'Add to queue (Enter)' : 'Send (Enter)'}>{preparing ? <Loader2 size={17} className="spin" /> : busy || session.queue.length ? <ListPlus size={17} /> : <ArrowUp size={17} />}</button>
            </div>
            <div className="pilot-composer-hint"><span>{busy || session.queue.length ? 'Enter to queue · Shift+Enter for a new line' : 'Enter to send · Shift+Enter for a new line'}</span><span>Edits can be undone</span></div>
          </div>
          {imageDrag && <div className="pilot-image-drop" aria-hidden="true"><ImagePlus size={28} /><b>Drop reference images</b><span>Up to 6 images · 20 MB each</span></div>}
        </section>
      )}

      <button hidden={docked} ref={launcherRef} className="pilot-fab" onClick={() => setOpen(true)} aria-expanded={open}
        aria-controls={open ? 'craft-ai-panel' : undefined} aria-hidden={open || undefined} tabIndex={open ? -1 : 0} aria-label="CraftAI assistant">
        <span className="pilot-fab-icon"><Zap size={17} /></span>
        <span>{activeRender?`${activeRender.name==='review_section'?'Review':'Export'} ${Math.floor((activeRender.activity.render.progress||0)*100)}%`:busy?'CraftAI working…':'CraftAI'}</span>
      </button>
    </div>
  );
}
