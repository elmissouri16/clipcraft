import React, { useEffect, useState } from 'react';
import { AudioLines, CircleAlert, CircleCheck, ExternalLink, Eye, EyeOff, Film, Gauge, Loader2, Server, ShieldCheck, Sparkles, Trash2, X } from 'lucide-react';

const PROVIDERS = [
  { id: 'gemini', name: 'Google Gemini', needsKey: true, hint: 'The easiest key is a free one from Google AI Studio (starts with AIza). Vertex AI express keys (AQ.…) work too once the API is enabled for their project.', keyUrl: 'https://aistudio.google.com/app/apikey', keyUrlLabel: 'Get a free key (AI Studio)' },
  { id: 'groq', name: 'Groq (fast, free tier)', needsKey: true, hint: 'Free key from the Groq console (starts with gsk_). Very fast. Recommended model: openai/gpt-oss-120b (works well with the CraftAI editing tools). "Load models" shows the ones your key can use.', keyUrl: 'https://console.groq.com/keys', keyUrlLabel: 'Get a free key (Groq)' },
  { id: 'ollama', name: 'Ollama (local, free)', needsKey: false, hint: 'Runs on this PC, no key and no internet. Install Ollama and pull a model first.', baseUrl: 'http://localhost:11434', keyUrl: 'https://ollama.com/download', keyUrlLabel: 'Download Ollama' },
  { id: 'openai', name: 'OpenAI', needsKey: true, hint: 'Key from platform.openai.com. Recommended model: gpt-4o-mini or better.', baseUrl: 'https://api.openai.com/v1', keyUrl: 'https://platform.openai.com/api-keys', keyUrlLabel: 'Get a key (OpenAI)' },
  { id: 'openrouter', name: 'OpenRouter', needsKey: true, hint: 'One key for many models (OpenAI, Anthropic, Meta…). Model ids look like "openai/gpt-4o-mini".', keyUrl: 'https://openrouter.ai/keys', keyUrlLabel: 'Get a key (OpenRouter)' },
  { id: 'claude', name: 'Anthropic Claude', needsKey: true, hint: 'Key from console.anthropic.com.', keyUrl: 'https://console.anthropic.com/settings/keys', keyUrlLabel: 'Open Anthropic console' },
  { id: 'custom', name: 'Custom (OpenAI-compatible)', needsKey: true, hint: 'Any service that speaks the OpenAI chat API: set its address (base URL) and the exact model id below. LM Studio and similar local servers work too — the key may be any value the server accepts.', baseUrl: '' },
  { id: 'codex-sdk', name: 'Codex SDK (installed)', needsKey: false, sdk: true, hint: 'Use your installed Codex and its existing login. Sign in in a terminal with codex login, then test the connection here. Credentials stay with Codex.', keyUrl: 'https://developers.openai.com/codex/cli', keyUrlLabel: 'Install Codex' },
  { id: 'claude-agent-sdk', name: 'Claude Agent SDK (installed)', needsKey: false, sdk: true, hint: 'Use your installed Claude executable and its existing login for your personal setup. Sign in in a terminal with claude auth login, then test the connection here. Credentials stay with Claude.', keyUrl: 'https://code.claude.com/docs/en/quickstart', keyUrlLabel: 'Install Claude' },
];


// Pixabay key for the stock library (Media > Library).
// Key of an online service (stock media), saved encrypted like the AI keys.
function ServiceKey({ saved, onSaved, service, title, icon: Icon, text, url, urlLabel, signupUrl, signupLabel, keyLabel, test }) {
  const [key, setKey] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(null);
  const [result, setResult] = useState(null);
  const hint = saved.serviceKeys?.[service];
  const save = async () => {
    setBusy('save');
    const r = await window.api.settingsSaveServiceKey(service, key);
    setBusy(null);
    if (!r.ok) return setResult({ ok: false, text: r.error });
    setKey('');
    onSaved(r.settings);
    setResult({ ok: true, text: 'Saved.' });
  };
  const runTest = async () => {
    setBusy('test');
    setResult(null);
    setResult(await test(key));
    setBusy(null);
  };
  return (
    <section className="settings-section">
      <div className="settings-title"><Icon size={16} /> {title}</div>
      <p className="muted">{text} Stored encrypted on this PC.</p>
      {signupUrl && (
        <button className="btn btn-ghost btn-sm link-btn" type="button" onClick={() => window.api.openHelp(signupUrl)}>
          <ExternalLink size={13} /> {signupLabel}
        </button>
      )}
      {url && (
        <button className="btn btn-ghost btn-sm link-btn" type="button" onClick={() => window.api.openHelp(url)}>
          <ExternalLink size={13} /> {urlLabel}
        </button>
      )}
      <label className="field">
        <span>{keyLabel} {hint && <b className="key-ok"><ShieldCheck size={13} /> saved {hint}</b>}</span>
        <div className="key-row">
          <input type={show ? 'text' : 'password'} value={key} autoComplete="off" spellCheck={false} aria-label={keyLabel}
            placeholder={hint ? 'Paste a new key to replace the saved one' : 'Paste your key here'} onChange={(e) => setKey(e.target.value)} />
          <button className="icon-btn" type="button" onClick={() => setShow((v) => !v)} aria-label={show ? 'Hide key' : 'Show key'}>
            {show ? <EyeOff size={15} /> : <Eye size={15} />}
          </button>
          {hint && (
            <button className="icon-btn" type="button" aria-label={`Delete saved ${keyLabel}`} title="Delete saved key"
              onClick={async () => { onSaved(await window.api.settingsClearServiceKey(service)); setResult(null); }}><Trash2 size={15} /></button>
          )}
        </div>
      </label>
      {result && (
        <div className={`result ${result.ok ? 'ok' : 'bad'}`} role="status">
          {result.ok ? <CircleCheck size={15} /> : <CircleAlert size={15} />}
          <div className="result-body"><span>{result.text}</span></div>
        </div>
      )}
      <div className="settings-actions">
        <button className="btn" onClick={runTest} disabled={!!busy || (!key.trim() && !hint)}>
          {busy === 'test' ? <Loader2 size={14} className="spin" /> : null} Test key
        </button>
        <button className="btn btn-primary" onClick={save} disabled={!!busy || !key.trim()}>
          {busy === 'save' ? <Loader2 size={14} className="spin" /> : null} Save key
        </button>
      </div>
    </section>
  );
}

function StockSettings(props) {
  return (
    <ServiceKey {...props} service="pixabay" title="Stock videos and photos" icon={Film} keyLabel="Pixabay API key"
      text="Media > Library searches Pixabay. Pixabay keys are free: sign in on pixabay.com and copy the key from the API page."
      url="https://pixabay.com/api/docs/" urlLabel="Get a free Pixabay key" test={(k) => window.api.stockTest(k)} />
  );
}

// Soundza key for the sound-effects section (Audio > Soundza).
function SoundzaSettings(props) {
  return (
    <ServiceKey {...props} service="soundza" title="Sound effects (Soundza)" icon={AudioLines} keyLabel="Soundza API key"
      text="Audio > Soundza searches Soundza's free library of sound effects. Soundza keys are free: create an account, then copy a key from the developer keys page."
      url="https://soundza.com/developers/keys" urlLabel="Get a free Soundza key" test={(k) => window.api.soundzaTest(k)} />
  );
}

// Playback quality: the player can play scaled copies of every video (longest side capped per
// level), so weak PCs edit smoothly. Made once per video, in the background. Export reads originals.
const QUALITY_OPTIONS = [
  ['full', 'Full', 'Original resolution'],
  ['high', 'High', 'Up to 1280 px'],
  ['medium', 'Medium', 'Up to 960 px'],
  ['low', 'Low', 'Up to 640 px'],
];
const PERF_MODE_OPTIONS = [
  ['low-end', 'Low-End', 'Low playback copies, one background job at a time, exports yield to the PC'],
  ['balanced', 'Balanced', 'Your playback quality, two background jobs at a time'],
  ['high-performance', 'High-Performance', 'Full-quality playback, three background jobs at a time'],
];
function ProxySettings({ onCleared }) {
  const [st, setSt] = useState(null);
  const [mode, setMode] = useState(null);
  useEffect(() => { window.api.proxyStatus().then(setSt).catch(() => {}); }, []);
  useEffect(() => { window.api.perfGetMode?.().then(setMode).catch(() => {}); }, []);
  if (!st) return null;
  const mb = (b) => (b >= 1073741824 ? `${(b / 1073741824).toFixed(1)} GB` : `${Math.max(0, Math.round(b / 1048576))} MB`);
  const clear = async () => {
    const res = await window.api.proxyClear();
    setSt(res);
    onCleared?.(res.deleted || []);
  };
  return (
    <section className="settings-section">
      <div className="settings-title"><Gauge size={16} /> Playback quality (smooth editing on slower PCs)</div>
      <p className="muted">At High, Medium or Low, ClipCraft makes a scaled copy of every video and plays that while you edit, so even a
        weak PC stays smooth. Each copy is made once per video, in the background; until it is ready the original plays.
        Export always uses the original files, at full quality.</p>
      <div className="seg-tabs small" role="radiogroup" aria-label="Playback quality">
        {QUALITY_OPTIONS.map(([id, label, hint]) => (
          <button key={id} type="button" role="radio" aria-checked={st.quality === id} className={st.quality === id ? 'on' : ''}
            title={hint} onClick={async () => setSt(await window.api.qualitySet(id))}>{label}</button>
        ))}
      </div>
      <div className="proxy-store">
        <span className="muted">{st.files ? `${st.files} prox${st.files > 1 ? 'ies' : 'y'} · ${mb(st.bytes)} on disk` : 'No proxy on disk.'}</span>
        {st.files > 0 && (
          <button className="btn btn-ghost btn-sm" type="button" onClick={clear} disabled={st.quality !== 'full'}
            title={st.quality !== 'full' ? 'Choose Full quality first' : 'Delete the scaled copies (they are made again if a lower quality is chosen)'}>
            <Trash2 size={13} /> Delete proxies
          </button>
        )}
      </div>
      <div className="settings-title" style={{ marginTop: 22 }}><Gauge size={16} /> Performance mode</div>
      <p className="muted">Modes trade background work against responsiveness: how many thumbnails, waveforms and copies
        ClipCraft builds at once, which playback quality it defaults to, and whether an export yields the PC's
        processor to everything else. A mode never changes export quality — exports always render from the
        original files at your chosen quality settings.</p>
      <div className="seg-tabs small" role="radiogroup" aria-label="Performance mode">
        {PERF_MODE_OPTIONS.map(([id, label, hint]) => (
          <button key={id} type="button" role="radio" aria-checked={mode === id} className={mode === id ? 'on' : ''}
            title={hint} onClick={async () => { const r = await window.api.perfSetMode(id); setMode(r.mode); setSt(r); }}>{label}</button>
        ))}
      </div>
    </section>
  );
}

// Settings sections for the left rail (redesign: rail + pane, all controls unchanged inside).
const SECTIONS = [
  { id: 'ai', label: 'AI assistant', icon: Sparkles },
  { id: 'mcp', label: 'MCP servers', icon: Server },
  { id: 'quality', label: 'Playback quality', icon: Gauge },
  { id: 'stock', label: 'Stock media', icon: Film },
];

export default function SettingsDialog({ onClose, onProxiesCleared }) {
  const [section, setSection] = useState('ai');
  const [saved, setSaved] = useState(null); // public settings from the main process
  const [provider, setProvider] = useState('gemini');
  const [model, setModel] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [executablePath, setExecutablePath] = useState('');
  const [sdkStatus, setSdkStatus] = useState(null);
  const [showKey, setShowKey] = useState(false);
  const [busy, setBusy] = useState(null); // 'save' | 'test' | 'models'
  const [models, setModels] = useState([]); // model ids offered by the provider
  const [result, setResult] = useState(null); // { ok, text }

  const load = (s, p = s.provider) => {
    setSaved(s);
    setProvider(p);
    setModel(s.models[p] || s.defaultModels[p]);
    setBaseUrl(s.baseUrls[p] || '');
    setApiKey('');
    setExecutablePath(s.executablePaths?.[p] || '');
    setResult(null);
    setModels([]);
  };
  useEffect(() => {
    window.api.settingsGet().then((s) => load(s));
  }, []);

  useEffect(() => {
    let alive = true;
    setSdkStatus(null);
    if (!PROVIDERS.find((p) => p.id === provider)?.sdk) return;
    const timer = setTimeout(() => {
      window.api.aiSdkStatus({ provider, executablePath }).then((status) => {
        if (alive) setSdkStatus(status);
      }).catch((error) => { if (alive) setSdkStatus({ ok: false, error: error.message }); });
    }, 250);
    return () => { alive = false; clearTimeout(timer); };
  }, [provider, executablePath]);

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!saved) return null;
  const info = PROVIDERS.find((p) => p.id === provider);
  const hint = saved.keys[provider];
  const draft = { provider, model, baseUrl, apiKey, executablePath };

  const switchProvider = (p) => {
    setProvider(p);
    setModel(saved.models[p] || saved.defaultModels[p]);
    setBaseUrl(saved.baseUrls[p] || '');
    setApiKey('');
    setExecutablePath(saved.executablePaths?.[p] || '');
    setResult(null);
    setModels([]);
  };

  const save = async () => {
    setBusy('save');
    const res = await window.api.settingsSave(draft);
    setBusy(null);
    if (!res.ok) return setResult({ ok: false, text: res.error });
    load(res.settings, provider);
    setResult({ ok: true, text: 'Saved.' });
  };

  const test = async () => {
    setBusy('test');
    setResult(null);
    const r = await window.api.aiTest(draft);
    setBusy(null);
    setResult(r.ok ? { ok: true, text: `Connected in ${(r.ms / 1000).toFixed(1)}s. The model replied: "${r.reply}"` } : { ok: false, text: r.error, link: r.link, linkLabel: r.linkLabel, suggestModel: r.suggestModel });
  };

  const loadModels = async () => {
    setBusy('models');
    setResult(null);
    const r = await window.api.aiModels(draft);
    setBusy(null);
    if (!r.ok) return setResult({ ok: false, text: r.error, link: r.link, linkLabel: r.linkLabel });
    setModels(r.models);
    setResult({ ok: true, text: r.useCliDefault
      ? 'Leave Model blank to use the installed CLI default, or enter a model id.'
      : r.fromCache ? `${r.models.length} models in the CLI’s cached catalog. Choose one your account can use.`
        : `${r.models.length} models available. Pick one from the Model list.` });
  };

  const removeKey = async () => {
    load(await window.api.settingsClearKey(provider), provider);
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="settings-title" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal settings settings2">
        <div className="settings-head">
          <h3 id="settings-title">Settings</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Close settings"><X size={16} /></button>
        </div>
        <div className="set2-body">
          <nav className="set2-rail" aria-label="Settings sections">
            {SECTIONS.map((s) => {
              const Icon = s.icon;
              return (
                <button key={s.id} type="button" className={section === s.id ? 'on' : ''} aria-current={section === s.id || undefined}
                  onClick={() => setSection(s.id)}>
                  <Icon size={15} /> <span>{s.label}</span>
                </button>
              );
            })}
          </nav>
          <div className="set2-pane">
        {section === 'ai' && (
        <section className="settings-section">
          <div className="settings-title"><Sparkles size={16} /> AI assistant</div>
          <p className="muted">The assistant (CraftAI) uses this service to understand your requests. Your key is stored encrypted on this PC and is never shown again.</p>

          <label className="field">
            <span>Provider</span>
            <select value={provider} onChange={(e) => switchProvider(e.target.value)}>
              {PROVIDERS.map((p) => <option key={p.id} value={p.id}>{p.name}{saved.keys[p.id] ? '  ✓' : ''}</option>)}
            </select>
          </label>
          <p className="muted">{info.hint}</p>
          {info.keyUrl && (
            <button className="btn btn-ghost btn-sm link-btn" type="button" onClick={() => window.api.openHelp(info.keyUrl)}>
              <ExternalLink size={13} /> {info.keyUrlLabel}
            </button>
          )}

          {info.sdk && (
            <>
              <label className="field">
                <span>Agent executable (optional)</span>
                <div className="key-row">
                  <input type="text" value={executablePath} spellCheck={false} aria-label="Agent executable"
                    placeholder="Detect installed CLI automatically" onChange={(e) => setExecutablePath(e.target.value)} />
                  <button className="btn btn-sm" type="button" onClick={async () => {
                    const file = await window.api.aiPickExecutable(provider);
                    if (file) setExecutablePath(file);
                  }}>Browse</button>
                </div>
              </label>
              <div className={`result ${!sdkStatus ? '' : sdkStatus.ok && sdkStatus.authenticated !== false ? 'ok' : 'bad'}`} role="status" aria-label="Installed agent status">
                <div className="result-body">
                  {!sdkStatus ? 'Checking the installed agent…' : !sdkStatus.ok ? sdkStatus.error
                    : sdkStatus.authenticated === false ? `Installed: ${sdkStatus.version}. Sign in with ${sdkStatus.loginCommand}.`
                    : `Detected: ${sdkStatus.version}${sdkStatus.authenticated ? ' · Signed in' : ' · Test the connection to check login'}`}
                  {sdkStatus?.ok && <small className="muted">{sdkStatus.executablePath}</small>}
                </div>
              </div>
            </>
          )}

          {info.needsKey && (
            <label className="field">
              <span>
                API key
                {hint && <b className="key-ok"><ShieldCheck size={13} /> saved {hint}</b>}
              </span>
              <div className="key-row">
                <input type={showKey ? 'text' : 'password'} value={apiKey} autoComplete="off" spellCheck={false}
                  placeholder={hint ? 'Paste a new key to replace the saved one' : 'Paste your key here'}
                  onChange={(e) => setApiKey(e.target.value)} />
                <button className="icon-btn" type="button" onClick={() => setShowKey((v) => !v)} aria-label={showKey ? 'Hide key' : 'Show key'}>
                  {showKey ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
                {hint && <button className="icon-btn" type="button" onClick={removeKey} aria-label="Delete saved key" title="Delete saved key"><Trash2 size={15} /></button>}
              </div>
            </label>
          )}

          <label className="field">
            <span>
              Model
              <button className="btn btn-ghost btn-sm" type="button" onClick={loadModels}
                disabled={!!busy || (info.needsKey && !apiKey.trim() && !hint) || (info.sdk && !sdkStatus?.ok)}>
                {busy === 'models' ? <Loader2 size={13} className="spin" /> : null} Load models
              </button>
            </span>
            <input type="text" list="model-ids" value={model} spellCheck={false} placeholder={info.sdk ? 'Default from installed CLI' : undefined} onChange={(e) => setModel(e.target.value)} />
            <datalist id="model-ids">{models.map((m) => <option key={m} value={m} />)}</datalist>
            <small className="muted">{info.sdk ? 'Leave blank to use your installed CLI’s configured model, or enter a model id.' : 'Use the model id (for example gemini-3.8-flash), not the display name. “Load models” lists the real ones.'}</small>
          </label>

          {(provider === 'ollama' || provider === 'openai' || provider === 'custom' || baseUrl) && (
            <label className="field">
              <span>{provider === 'custom' ? 'Address (required for Custom)' : 'Address (optional for hosted services)'}</span>
              <input type="text" value={baseUrl} spellCheck={false} placeholder={info.baseUrl || 'Default'} onChange={(e) => setBaseUrl(e.target.value)} />
            </label>
          )}

          {!saved.encryption && info.needsKey && (
            <p className="error-text">Secure storage is not available on this PC, so keys cannot be saved.</p>
          )}

          {result && (
            <div className={`result ${result.ok ? 'ok' : 'bad'}`} role="status">
              {result.ok ? <CircleCheck size={15} /> : <CircleAlert size={15} />}
              <div className="result-body">
                <span>{result.text}</span>
                {result.suggestModel && (
                  <button className="btn btn-sm btn-primary" type="button"
                    onClick={() => { setModel(result.suggestModel); setResult(null); }}>
                    Use {result.suggestModel}
                  </button>
                )}
                {result.link && (
                  <button className="btn btn-sm" type="button" onClick={() => window.api.openHelp(result.link)}>
                    <ExternalLink size={13} /> {result.linkLabel || 'Open the Google page'}
                  </button>
                )}
              </div>
            </div>
          )}

          <div className="settings-actions">
            <button className="btn" onClick={test} disabled={!!busy || (info.needsKey && !apiKey.trim() && !hint) || (info.sdk && (!sdkStatus?.ok || sdkStatus.authenticated === false))}>
              {busy === 'test' ? <Loader2 size={14} className="spin" /> : null} Test connection
            </button>
            <button className="btn btn-primary" onClick={save} disabled={!!busy}>
              {busy === 'save' ? <Loader2 size={14} className="spin" /> : null} Save
            </button>
          </div>
        </section>
        )}
        {section === 'mcp' && <McpSettings saved={saved} onSaved={(st) => setSaved(st)} />}
        {section === 'quality' && <ProxySettings onCleared={onProxiesCleared} />}
        {section === 'stock' && (
          <>
            <StockSettings saved={saved} onSaved={(st) => setSaved(st)} />
            <SoundzaSettings saved={saved} onSaved={(st) => setSaved(st)} />
          </>
        )}
          </div>
        </div>
      </div>
    </div>
  );
}

// MCP servers: external tool servers (stdio) whose tools CraftAI can call during an edit.
// Config is name + command + arguments; "Test" starts the server and lists its real tools.
function McpSettings({ saved, onSaved }) {
  const servers = saved.mcpServers || [];
  const [name, setName] = useState('');
  const [command, setCommand] = useState('');
  const [args, setArgs] = useState('');
  const [busy, setBusy] = useState('');
  const [result, setResult] = useState(null);
  const splitArgs = (s) => s.split(/\s+/).map((x) => x.trim()).filter(Boolean);
  const persist = async (list) => {
    const r = await window.api.settingsSetMcpServers(list);
    const st = r?.settings || r;
    if (st && Array.isArray(st.mcpServers)) onSaved(st);
  };
  const add = async () => {
    if (!name.trim() || !command.trim()) return;
    await persist([...servers, { name: name.trim(), command: command.trim(), args: splitArgs(args) }]);
    setName(''); setCommand(''); setArgs('');
    setResult({ ok: true, text: 'Server saved. CraftAI will offer its tools on the next request.' });
  };
  const remove = async (i) => { await persist(servers.filter((_, k) => k !== i)); setResult(null); };
  const test = async (server) => {
    setBusy(server.name); setResult(null);
    const r = await window.api.mcpTest(server);
    setBusy('');
    setResult(r.ok
      ? { ok: true, text: `"${server.name}" answered. Tools: ${r.tools.join(', ') || '(none)'}` }
      : { ok: false, text: `"${server.name}" failed: ${r.error}` });
  };
  return (
    <section className="settings-section">
      <div className="settings-title"><Sparkles size={16} /> MCP tool servers</div>
      <p className="muted">Connect Model Context Protocol servers (started as local processes). Their tools are given to CraftAI as <i>mcp_&lt;server&gt;_&lt;tool&gt;</i> alongside the editing tools.</p>
      {servers.map((s, i) => (
        <div key={`${s.name}-${i}`} className="key-row" style={{ marginBottom: 6 }}>
          <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            <b>{s.name}</b> <span className="muted">{s.command} {s.args.join(' ')}</span>
          </span>
          <button className="btn btn-sm" type="button" disabled={busy === s.name} onClick={() => test(s)}>{busy === s.name ? 'Testing…' : 'Test'}</button>
          <button className="icon-btn" type="button" aria-label={`Remove ${s.name}`} title="Remove server" onClick={() => remove(i)}><Trash2 size={15} /></button>
        </div>
      ))}
      <label className="field"><span>Name</span>
        <input type="text" value={name} placeholder="e.g. filesystem" onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="field"><span>Command</span>
        <input type="text" value={command} spellCheck={false} placeholder="e.g. npx" onChange={(e) => setCommand(e.target.value)} />
      </label>
      <label className="field"><span>Arguments (space-separated)</span>
        <input type="text" value={args} spellCheck={false} placeholder="e.g. -y @modelcontextprotocol/server-filesystem /home/me/files" onChange={(e) => setArgs(e.target.value)} />
      </label>
      <div className="settings-actions">
        <button className="btn" type="button" disabled={!name.trim() || !command.trim()} onClick={add}>Add server</button>
        <button className="btn" type="button" disabled={!name.trim() || !command.trim() || busy === name}
          onClick={() => test({ name: name.trim(), command: command.trim(), args: splitArgs(args) })}>{busy === name ? 'Testing…' : 'Test draft'}</button>
      </div>
      {result && (
        <div className={`result ${result.ok ? 'ok' : 'bad'}`} role="status">
          {result.ok ? <CircleCheck size={15} /> : <CircleAlert size={15} />}
          <div className="result-body"><span>{result.text}</span></div>
        </div>
      )}
    </section>
  );
}
