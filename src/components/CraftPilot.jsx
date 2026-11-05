import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowUp, Zap, Captions, CircleAlert, CircleCheck, Loader2, MessageCircle, MessageSquarePlus, Palette, RectangleVertical, Scissors, Settings, Square, Undo2, X, Shuffle } from 'lucide-react';
import { runAgent } from '../agent/runAgent.js';
import { EDIT_STYLES, STYLE_NAMES } from '../agent/motionGuide.js';
import CraftModelPicker from './CraftModelPicker.jsx';
import Dropdown from './Dropdown.jsx';
import { newChatSession, normalizeChatSessions, snapshotChatSessions } from '../agent/chatSessions.js';
import ToolCallIcon from './ToolCallIcon.jsx';

// Quick actions on the empty state, grouped by what they do; each sends its text as-is.
const ACTIONS = [
  { icon: Scissors, group: 'Cut', text: 'Remove the silences' },
  { icon: Captions, group: 'Captions', text: 'Add automatic captions' },
  { icon: MessageCircle, group: 'Ask', text: 'What is said in this video?' },
  { icon: RectangleVertical, group: 'Format', text: 'Make it vertical 9:16' },
];

// The named editing styles as cards: pick one, then say what you want (or just send) to edit the video in it.
function StyleGrid({ value, onPick, disabled }) {
  return (
    <div className="pilot-styles" role="listbox" aria-label="Editing styles">
      {STYLE_NAMES.map((id) => {
        const st = EDIT_STYLES[id];
        return (
          <button key={id} type="button" role="option" aria-selected={value === id} disabled={disabled}
            className={`pilot-style ${value === id ? 'on' : ''}`} title={st.look} onClick={() => onPick(value === id ? null : id)}>
            <span className="pilot-style-emoji" aria-hidden="true">{st.emoji}</span>
            <b>{st.title}</b>
            <span>{st.tag}</span>
          </button>
        );
      })}
    </div>
  );
}

// The message for a picked style: the user's words (in their language) plus the style's name for edit_style.
const styledMessage = (text, styleId) => {
  if (!styleId) return text.trim();
  const name = EDIT_STYLES[styleId].title;
  return text.trim() ? `${text.trim()}

(Style: ${name})` : `Make a reel of this video in the ${name} style.`;
};

// Tiny formatter for the assistant's reply: paragraphs, **bold** and "- " bullet lists.
function Rich({ text }) {
  const blocks = text.split(/\n{2,}/);
  const inline = (s) => s.split(/(\*\*[^*]+\*\*)/g).map((part, i) => (part.startsWith('**') ? <b key={i}>{part.slice(2, -2)}</b> : part));
  return blocks.map((block, i) => {
    const lines = block.split('\n');
    if (lines.every((l) => /^\s*[-*•]\s+/.test(l))) {
      return <ul key={i}>{lines.map((l, j) => <li key={j}>{inline(l.replace(/^\s*[-*•]\s+/, ''))}</li>)}</ul>;
    }
    return <p key={i}>{lines.map((l, j) => <React.Fragment key={j}>{j > 0 && <br />}{inline(l)}</React.Fragment>)}</p>;
  });
}

export default function CraftAI({ getProject, getHistoryLength, dispatch, settle, onOpenSettings, settingsVersion, app = {} }) {
  const [open, setOpen] = useState(false);
  const projectId = useRef(getProject().id).current;
  const [chat, setChat] = useState(() => {
    const saved = normalizeChatSessions(getProject().craftAI);
    saved.sessions.forEach((s) => { if (!EDIT_STYLES[s.style]) s.style = null; });
    if (!saved.sessions.length) {
      const session = newChatSession();
      saved.sessions.push(session); saved.activeSessionId = session.id;
    }
    return structuredClone(saved);
  });
  const chatRef = useRef(chat);
  const session = chat.sessions.find((s) => s.id === chat.activeSessionId);
  const { messages, draft: input, style } = session;
  const [busy, setBusy] = useState(false);
  const [modelSaving, setModelSaving] = useState(false);
  const [config, setConfig] = useState(null); // { ready, provider, model }
  const [showStyles, setShowStyles] = useState(false); // the style cards once the chat has started
  const contents = useRef(null);
  if (contents.current === null) contents.current = structuredClone(session.contents);
  const mounted = useRef(true);
  const canceled = useRef(false);
  const activeRequest = useRef(null);
  const configRequest = useRef(0);
  const listRef = useRef(null);
  const inputRef = useRef(null);
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
  const setStyle = (value) => updateSession({ style: value });

  const refreshConfig = useCallback(async () => {
    const generation = ++configRequest.current;
    const s = await window.api.settingsGet();
    const sdk = ['codex-sdk', 'claude-agent-sdk'].includes(s.provider);
    const status = sdk ? await window.api.aiSdkStatus({ provider: s.provider, executablePath: s.executablePaths?.[s.provider] || '' }) : null;
    if (generation !== configRequest.current) return;
    setConfig({ ready: sdk ? status.ok && status.authenticated !== false : s.provider === 'ollama' || !!s.keys[s.provider],
      provider: s.provider, model: s.models[s.provider] || (sdk ? `${s.provider === 'codex-sdk' ? 'Codex' : 'Claude'} · CLI default` : ''),
      modelId: s.models[s.provider] || '', executablePath: s.executablePaths?.[s.provider] || '',
      reasoningEffort: s.reasoningEfforts?.[s.provider]?.[s.models[s.provider] || ''] || '',
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
    };
  }, []);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, busy]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50);
  }, [open]);

  const updateLast = (fn, completedContents) => updateSession((s) => ({
    messages: s.messages.map((x, i) => (i === s.messages.length - 1 ? fn(x) : x)),
    ...(completedContents ? { contents: structuredClone(completedContents) } : {}),
  }));

  const pickStyle = (id) => {
    setStyle(id);
    setShowStyles(false);
    setTimeout(() => inputRef.current?.focus(), 30);
  };

  const send = async (text) => {
    const msg = styledMessage(text, style);
    if (!msg || busy || modelSaving) return;
    setInput('');
    setStyle(null);
    setBusy(true);
    canceled.current = false;
    const requestId = crypto.randomUUID();
    activeRequest.current = requestId;
    updateSession((s) => ({ title: s.messages.length ? s.title : msg.replace(/\s+/g, ' ').slice(0, 60) }));
    setMessages((m) => [...m, { role: 'user', text: msg }, { role: 'assistant', text: '', steps: [], pending: true }]);
    const conversationStart = contents.current.length;
    contents.current.push({ role: 'user', parts: [{ text: msg }] });

    const startLen = getHistoryLength();
    const result = await runAgent({
      requestId,
      contents: contents.current,
      ctx: {
        ...app,
        getProject: () => {
          if (!isCurrent()) throw new Error('The project changed.');
          return getProject();
        },
        dispatch: (action) => { if (isCurrent() && !canceled.current) dispatch(action); },
        addProbed: (...args) => isCurrent() && !canceled.current ? app.addProbed?.(...args) : null,
        startExport: (...args) => isCurrent() && !canceled.current ? app.startExport?.(...args) : undefined,
        api: window.api, settle,
        // Undo only what this request did: the user's earlier edits stay.
        undoOwn: () => {
          if (!isCurrent() || canceled.current || getHistoryLength() <= startLen) return false;
          dispatch({ type: 'undo' });
          return true;
        },
      },
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
    if (result.changed) dispatch({ type: 'collapseHistory', from: startLen });
    if (result.error) {
      // Drop the incomplete request, including unanswered tool calls, so a retry
      // starts from a valid conversation while any completed edits remain undoable.
      contents.current.splice(conversationStart);
      updateLast((last) => ({ ...last, pending: false, error: result.error, changed: result.changed }), contents.current);
    } else {
      if (result.canceled) contents.current.splice(conversationStart);
      updateLast((last) => ({ ...last, pending: false, text: result.canceled ? 'Stopped.' : result.text || 'Done.', changed: result.changed }), contents.current);
    }
    setBusy(false);
    activeRequest.current = null;
  };

  const newChat = () => {
    if (busy) return;
    const current = chatRef.current;
    const active = current.sessions.find((s) => s.id === current.activeSessionId);
    if (!active.messages.length && !active.draft.trim()) return;
    const next = newChatSession();
    saveChat({ ...current, activeSessionId: next.id, sessions: [...current.sessions, next] });
    contents.current = [];
    setShowStyles(false);
  };

  const selectSession = (id) => {
    if (busy) return;
    const selected = chatRef.current.sessions.find((s) => s.id === id);
    if (!selected) return;
    contents.current = structuredClone(selected.contents);
    saveChat({ ...chatRef.current, activeSessionId: id });
    setShowStyles(false);
  };

  const onKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send(input);
    }
  };

  return (
    <>
      {open && (
        <section className="pilot-panel pilot2" aria-label="CraftAI assistant">
          <header className="pilot-head">
            <span className="pilot-title"><Zap size={16} /> <span className="pilot-wordmark">Craft<span className="grad">AI</span></span></span>
            <CraftModelPicker config={config} disabled={busy} onSavingChange={setModelSaving} onSaved={(s) => {
              configRequest.current++;
              const modelId = s.models[s.provider] || '';
              setConfig((previous) => ({ ...previous, modelId,
                model: modelId || (s.provider === 'codex-sdk' ? 'Codex · CLI default' : s.provider === 'claude-agent-sdk' ? 'Claude · CLI default' : ''),
                reasoningEffort: s.reasoningEfforts?.[s.provider]?.[modelId] || '',
              }));
            }} />
            <button className={`icon-btn ${showStyles ? 'active' : ''}`} onClick={() => setShowStyles((v) => !v)} aria-pressed={showStyles}
              aria-label="Editing styles" title="Editing styles"><Palette size={16} /></button>
            <button className="icon-btn" onClick={newChat} disabled={busy || (!messages.length && !input.trim())} aria-label="New chat" title="New chat"><MessageSquarePlus size={16} /></button>
            <button className="icon-btn" onClick={onOpenSettings} aria-label="AI settings" title="AI settings"><Settings size={16} /></button>
            <button className="icon-btn" onClick={() => setOpen(false)} aria-label="Close assistant"><X size={16} /></button>
          </header>

          <div className="pilot-session-picker">
            <Dropdown ariaLabel="Chat sessions" value={chat.activeSessionId} disabled={busy}
              options={[...chat.sessions].reverse().map((s) => ({ value: s.id, label: s.title }))}
              onChange={selectSession} />
          </div>

          <div className="pilot-list" ref={listRef}>
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
                <h3>What should we edit?</h3>
                <p>Ask in your own words. I can cut silences, add captions, write titles, change speed or format, apply filters and more.</p>
                <div className="pilot-actions">
                  {ACTIONS.map((a) => {
                    const Icon = a.icon;
                    return (
                      <button key={a.text} className="pilot-action" disabled={busy || modelSaving || !config?.ready} onClick={() => send(a.text)}>
                        <span className="pa-icon"><Icon size={15} /></span>
                        <span className="pa-text"><b>{a.group}</b><small>{a.text}</small></span>
                      </button>
                    );
                  })}
                </div>
                <div className="pilot-styles-head">Or pick a style for a whole reel</div>
                <StyleGrid value={style} onPick={pickStyle} disabled={busy || modelSaving || !config?.ready} />
              </div>
            )}
            {messages.length > 0 && showStyles && (
              <div className="pilot-styles-box">
                <div className="pilot-styles-head">Pick a style, then say what you want</div>
                <StyleGrid value={style} onPick={pickStyle} disabled={busy || modelSaving || !config?.ready} />
              </div>
            )}

            {messages.map((m, i) => (
              <div key={i} className={`pilot-msg ${m.role}`}>
                {m.role === 'user' ? (
                  <div className="bubble" dir="auto">{m.text}</div>
                ) : (
                  <div className="reply">
                    {m.steps?.length > 0 && (
                      <ul className="pilot-steps">
                        {m.steps.map((s) => (
                          <li key={s.id} className={s.status} title={s.detail || ''}>
                            <ToolCallIcon name={s.name} />
                            <span>{s.label}{s.status === 'error' ? ` — ${s.detail}` : ''}</span>
                            <span className="pilot-step-status" aria-label={s.status === 'running' ? 'Running' : s.status === 'done' ? 'Completed' : s.status === 'switch' ? 'Provider changed' : 'Failed'}>
                              {s.status === 'running' ? <Loader2 size={12} className="spin" /> : s.status === 'done' ? <CircleCheck size={12} />
                                : s.status === 'switch' ? <Shuffle size={12} /> : <CircleAlert size={12} />}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                    {m.pending && !m.steps?.length && <div className="pilot-thinking"><Loader2 size={14} className="spin" /> Thinking…</div>}
                    {m.text && <div className="bubble" dir="auto"><Rich text={m.text} /></div>}
                    {m.contextUsage?.requests > 0 && (
                      <small className="pilot-context-usage" title="Rough input estimate across this reply's model requests, including conversation and tool schemas. Provider tokenization and SDK overhead can differ.">
                        ~{Math.ceil(m.contextUsage.inputChars / 4).toLocaleString()} estimated input tokens · {m.contextUsage.requests} {m.contextUsage.requests === 1 ? 'request' : 'requests'}
                      </small>
                    )}
                    {m.error && (
                      <div className="pilot-error" role="alert">
                        <b>Couldn't reach the assistant</b>
                        <p>{m.error.error}</p>
                        <div className="pilot-error-actions">
                          {m.error.suggestModel && <button className="btn btn-sm btn-primary" onClick={onOpenSettings}>Change model in Settings</button>}
                          {m.error.link && <button className="btn btn-sm" onClick={() => window.api.openHelp(m.error.link)}>{m.error.linkLabel || 'Open the Google page'}</button>}
                          {!m.error.link && !m.error.suggestModel && <button className="btn btn-sm" onClick={onOpenSettings}>Open Settings</button>}
                        </div>
                      </div>
                    )}
                    {m.changed && !m.pending && (
                      <button className="pilot-undo" onClick={() => dispatch({ type: 'undo' })}><Undo2 size={13} /> Undo these changes</button>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>

          {style && (
            <div className="pilot-picked">
              <span className="pilot-picked-pill" title={EDIT_STYLES[style].look}>
                {EDIT_STYLES[style].emoji} {EDIT_STYLES[style].title}
                <button type="button" onClick={() => setStyle(null)} aria-label="Remove the style"><X size={12} /></button>
              </span>
              <span className="pilot-picked-hint">Add what you want (length, language, music…) or just send.</span>
            </div>
          )}
          <div className="pilot-input">
            <textarea ref={inputRef} rows={2} value={input} dir="auto"
              placeholder={style ? `A reel in the ${EDIT_STYLES[style].title} style… (optional details)` : 'Tell CraftAI what to do…'}
              onChange={(e) => setInput(e.target.value)} onKeyDown={onKeyDown} disabled={!config?.ready} aria-label="Message" />
            {busy ? (
              <button className="send stop" onClick={() => {
                canceled.current = true;
                window.api.agentCancel?.(activeRequest.current).catch(() => {});
              }} aria-label="Stop"><Square size={14} fill="currentColor" /></button>
            ) : (
              <button className="send" onClick={() => send(input)} disabled={modelSaving || (!input.trim() && !style) || !config?.ready} aria-label="Send"><ArrowUp size={16} /></button>
            )}
          </div>
        </section>
      )}

      <button className={`pilot-fab ${open ? 'open' : ''}`} onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label="CraftAI assistant">
        <span className="pilot-fab-icon"><Zap size={17} /></span>
        <span>CraftAI</span>
      </button>
    </>
  );
}
