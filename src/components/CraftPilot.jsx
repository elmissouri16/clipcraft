import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowUp, Zap, Captions, CircleAlert, CircleCheck, Loader2, MessageCircle, MessageSquarePlus, Palette, RectangleVertical, Scissors, Settings, Square, Undo2, X, Shuffle } from 'lucide-react';
import { runAgent } from '../agent/runAgent.js';
import { EDIT_STYLES, STYLE_NAMES } from '../agent/motionGuide.js';

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

export default function CraftPilot({ getProject, getHistoryLength, dispatch, settle, onOpenSettings, settingsVersion, app = {} }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([]); // { role: 'user' | 'assistant', text, steps?, error?, changed? }
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [config, setConfig] = useState(null); // { ready, provider, model }
  const [style, setStyle] = useState(null); // picked editing style id, sent with the next message
  const [showStyles, setShowStyles] = useState(false); // the style cards once the chat has started
  const contents = useRef([]); // the model conversation, kept between messages
  const canceled = useRef(false);
  const listRef = useRef(null);
  const inputRef = useRef(null);

  const refreshConfig = useCallback(async () => {
    const s = await window.api.settingsGet();
    setConfig({ ready: s.provider === 'ollama' || !!s.keys[s.provider], provider: s.provider, model: s.models[s.provider] });
  }, []);
  useEffect(() => {
    refreshConfig();
  }, [refreshConfig, settingsVersion, open]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, busy]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50);
  }, [open]);

  const updateLast = (fn) => setMessages((m) => m.map((x, i) => (i === m.length - 1 ? fn(x) : x)));

  const pickStyle = (id) => {
    setStyle(id);
    setShowStyles(false);
    setTimeout(() => inputRef.current?.focus(), 30);
  };

  const send = async (text) => {
    const msg = styledMessage(text, style);
    if (!msg || busy) return;
    setInput('');
    setStyle(null);
    setBusy(true);
    canceled.current = false;
    setMessages((m) => [...m, { role: 'user', text: msg }, { role: 'assistant', text: '', steps: [], pending: true }]);
    contents.current.push({ role: 'user', parts: [{ text: msg }] });

    const startLen = getHistoryLength();
    const result = await runAgent({
      contents: contents.current,
      ctx: {
        getProject, dispatch, api: window.api, settle, ...app,
        // Undo only what this request did: the user's earlier edits stay.
        undoOwn: () => {
          if (getHistoryLength() <= startLen) return false;
          dispatch({ type: 'undo' });
          return true;
        },
      },
      isCanceled: () => canceled.current,
      onEvent: (ev) => updateLast((last) => {
        const steps = [...last.steps];
        const i = steps.findIndex((s) => s.id === ev.id);
        if (i >= 0) steps[i] = ev;
        else steps.push(ev);
        return { ...last, steps };
      }),
    }).catch((e) => ({ error: { error: e.message } }));

    // Everything the assistant did becomes a single Undo step.
    if (result.changed) dispatch({ type: 'collapseHistory', from: startLen });
    if (result.error) {
      // Drop the unanswered user turn so the conversation stays valid for the next message.
      contents.current.pop();
      while (contents.current.length && contents.current.at(-1).role !== 'user') contents.current.pop();
      updateLast((last) => ({ ...last, pending: false, error: result.error, changed: result.changed }));
    } else {
      updateLast((last) => ({ ...last, pending: false, text: result.canceled ? 'Stopped.' : result.text || 'Done.', changed: result.changed }));
    }
    setBusy(false);
  };

  const newChat = () => {
    if (busy) return;
    contents.current = [];
    setMessages([]);
  };

  const onKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send(input);
    }
  };

  // Providers whose models can call the editing tools.
  const notGemini = config && config.ready && !['gemini', 'groq', 'openai'].includes(config.provider);

  return (
    <>
      {open && (
        <section className="pilot-panel pilot2" aria-label="CraftPilot assistant">
          <header className="pilot-head">
            <span className="pilot-title"><Zap size={16} /> <span className="pilot-wordmark">Craft<span className="grad">Pilot</span></span></span>
            <span className="pilot-model" title={config ? `${config.provider} · ${config.model}` : ''}>{config ? config.model : ''}</span>
            <button className={`icon-btn ${showStyles ? 'active' : ''}`} onClick={() => setShowStyles((v) => !v)} aria-pressed={showStyles}
              aria-label="Editing styles" title="Editing styles"><Palette size={16} /></button>
            <button className="icon-btn" onClick={newChat} disabled={busy || !messages.length} aria-label="New chat" title="New chat"><MessageSquarePlus size={16} /></button>
            <button className="icon-btn" onClick={onOpenSettings} aria-label="AI settings" title="AI settings"><Settings size={16} /></button>
            <button className="icon-btn" onClick={() => setOpen(false)} aria-label="Close assistant"><X size={16} /></button>
          </header>

          <div className="pilot-list" ref={listRef}>
            {config && !config.ready && (
              <div className="pilot-callout">
                <b>Connect an AI first</b>
                <p>Add your API key in Settings. A free Google AI Studio key works.</p>
                <button className="btn btn-primary btn-sm" onClick={onOpenSettings}>Open Settings</button>
              </div>
            )}
            {notGemini && (
              <div className="pilot-callout warn">
                <b>Editing needs Gemini, Groq or an OpenAI-compatible service</b>
                <p>The assistant can edit your project with Google Gemini, Groq or an OpenAI-compatible service. Choose one in Settings.</p>
                <button className="btn btn-sm" onClick={onOpenSettings}>Open Settings</button>
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
                      <button key={a.text} className="pilot-action" disabled={busy || !config?.ready} onClick={() => send(a.text)}>
                        <span className="pa-icon"><Icon size={15} /></span>
                        <span className="pa-text"><b>{a.group}</b><small>{a.text}</small></span>
                      </button>
                    );
                  })}
                </div>
                <div className="pilot-styles-head">Or pick a style for a whole reel</div>
                <StyleGrid value={style} onPick={pickStyle} disabled={busy || !config?.ready} />
              </div>
            )}
            {messages.length > 0 && showStyles && (
              <div className="pilot-styles-box">
                <div className="pilot-styles-head">Pick a style, then say what you want</div>
                <StyleGrid value={style} onPick={pickStyle} disabled={busy || !config?.ready} />
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
                            {s.status === 'running' ? <Loader2 size={13} className="spin" /> : s.status === 'done' ? <CircleCheck size={13} />
                              : s.status === 'switch' ? <Shuffle size={13} /> : <CircleAlert size={13} />}
                            <span>{s.label}{s.status === 'error' ? ` — ${s.detail}` : ''}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                    {m.pending && !m.steps?.length && <div className="pilot-thinking"><Loader2 size={14} className="spin" /> Thinking…</div>}
                    {m.text && <div className="bubble" dir="auto"><Rich text={m.text} /></div>}
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
              placeholder={style ? `A reel in the ${EDIT_STYLES[style].title} style… (optional details)` : 'Tell CraftPilot what to do…'}
              onChange={(e) => setInput(e.target.value)} onKeyDown={onKeyDown} disabled={!config?.ready} aria-label="Message" />
            {busy ? (
              <button className="send stop" onClick={() => { canceled.current = true; }} aria-label="Stop"><Square size={14} fill="currentColor" /></button>
            ) : (
              <button className="send" onClick={() => send(input)} disabled={(!input.trim() && !style) || !config?.ready} aria-label="Send"><ArrowUp size={16} /></button>
            )}
          </div>
        </section>
      )}

      <button className={`pilot-fab ${open ? 'open' : ''}`} onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label="CraftPilot assistant">
        <span className="pilot-fab-icon"><Zap size={17} /></span>
        <span>CraftPilot</span>
      </button>
    </>
  );
}
