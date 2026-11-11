import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { PRESETS, nativeAgentName } from '../../features/agent/providers.js';
import ServiceConnections from './ServiceConnections.jsx';
import { SettingsPage, SettingsGroup } from './SettingsLayout.jsx';
import Dropdown from "../../components/ui/Dropdown.jsx";
import { AudioLines, Bot, Check, CircleAlert, CircleCheck, Copy, ExternalLink, Eye, EyeOff, Film, Gauge, Info, Keyboard, Loader2, Server, ShieldCheck, Sparkles, Trash2, X } from 'lucide-react';
import ShortcutSettings from './ShortcutSettings.jsx';
import { ENGINE_NAMES, defaultSpeech, piperVoicesOf, usableEngines } from '../../features/audio/voiceDefault.js';

// Providers come from the preset table (shared/providers.json): name, key page, hint, default address.
const PROVIDERS = PRESETS;

const PROVIDERS = [
  { id: 'gemini', name: 'Google Gemini', needsKey: true, hint: 'The easiest key is a free one from Google AI Studio (starts with AIza). Vertex AI express keys (AQ.…) work too once the API is enabled for their project.', keyUrl: 'https://aistudio.google.com/app/apikey', keyUrlLabel: 'Get a free key (AI Studio)' },
  { id: 'groq', name: 'Groq (fast, free tier)', needsKey: true, hint: 'Free key from the Groq console (starts with gsk_). Very fast. Recommended model: openai/gpt-oss-120b (works well with the CraftAI editing tools). "Load models" shows the ones your key can use.', keyUrl: 'https://console.groq.com/keys', keyUrlLabel: 'Get a free key (Groq)' },
  { id: 'ollama', name: 'Ollama (local, free)', needsKey: false, hint: 'Runs on this PC, no key and no internet. Install Ollama and pull a model first.', baseUrl: 'http://localhost:11434', keyUrl: 'https://ollama.com/download', keyUrlLabel: 'Download Ollama' },
  { id: 'openai', name: 'OpenAI', needsKey: true, hint: 'Key from platform.openai.com. Recommended model: gpt-4o-mini or better.', baseUrl: 'https://api.openai.com/v1', keyUrl: 'https://platform.openai.com/api-keys', keyUrlLabel: 'Get a key (OpenAI)' },
  { id: 'openrouter', name: 'OpenRouter', needsKey: true, hint: 'One key for many models (OpenAI, Anthropic, Meta…). Model ids look like "openai/gpt-4o-mini".', keyUrl: 'https://openrouter.ai/keys', keyUrlLabel: 'Get a key (OpenRouter)' },
  { id: 'claude', name: 'Anthropic Claude', needsKey: true, hint: 'Key from console.anthropic.com.', keyUrl: 'https://console.anthropic.com/settings/keys', keyUrlLabel: 'Open Anthropic console' },
  { id: 'custom', name: 'Custom (OpenAI-compatible)', needsKey: true, hint: 'Any service that speaks the OpenAI chat API: set its address (base URL) and the exact model id below. LM Studio and similar local servers work too — the key may be any value the server accepts.', baseUrl: '' },
  { id: 'codex-sdk', name: 'Codex (native)', needsKey: false, sdk: true, hint: 'Uses your existing Codex sign-in. No API key, Node or npm needed; the native engine can be downloaded here.', keyUrl: 'https://developers.openai.com/codex/cli', keyUrlLabel: 'Codex setup' },
  { id: 'claude-agent-sdk', name: 'Claude (native)', needsKey: false, sdk: true, hint: 'Uses your existing Claude sign-in. No API key, Node or npm needed; the native engine can be downloaded here.', keyUrl: 'https://code.claude.com/docs/en/quickstart', keyUrlLabel: 'Install Claude' },
];

  { id: 'opencode-sdk', name: 'OpenCode (native)', needsKey: false, sdk: true, hint: 'Uses the providers you connected in OpenCode (opencode auth login), including its free models. No API key, Node or npm needed; the native engine can be downloaded here. Model ids are provider/model, e.g. opencode/claude-fable-5-2.', keyUrl: 'https://opencode.ai/docs/', keyUrlLabel: 'OpenCode docs' },

// Display name of a native agent in the runtime controls.
const nativeName = nativeAgentName;

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
    <SettingsGroup label={title} hint={text}>
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
    </SettingsGroup>
  );
}

function StockSettings(props) {
  return (
    <ServiceKey {...props} service="pixabay" title="Pixabay · stock videos and photos" icon={Film} keyLabel="Pixabay API key"
      text="Powers Media > Stock. The key is free from your Pixabay account's API page."
      url="https://pixabay.com/api/docs/" urlLabel="Get a free Pixabay key" test={(k) => window.api.stockTest(k)} />
  );
}

// Soundza key for the sound-effects section (Audio > Soundza).
function SoundzaSettings(props) {
  return (
    <ServiceKey {...props} service="soundza" title="Soundza · sound effects" icon={AudioLines} keyLabel="Soundza API key"
      text="Powers Audio > Soundza. The key is free from Soundza's developer keys page."
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
// Motion graphics are kept as full-quality transparent video; the cache keeps the newest 4 GB and
// never removes what an open project uses (a removed graphic is drawn again when its project opens).
function GraphicsCache({ mb }) {
  const [use, setUse] = useState(null);
  useEffect(() => { window.api.graphicsUsage?.().then(setUse).catch(() => {}); }, []);
  if (!use) return null;
  return (
    <SettingsGroup label="Motion graphics" hint="Rendered graphics are kept so they play and export at once. Up to 4 GB is kept; older ones are drawn again when a project that uses them opens.">
      <div className="proxy-store">
        <span className="muted" aria-label="Motion graphics cache size">{use.entries ? `${use.entries} graphic${use.entries > 1 ? 's' : ''} · ${mb(use.bytes)} on disk` : 'No graphics on disk.'}</span>
        {use.entries > 0 && (
          <button className="btn btn-ghost btn-sm" type="button" onClick={async () => setUse(await window.api.graphicsClear())}
            title="Delete rendered graphics that no open project uses">
            <Trash2 size={13} /> Clear
          </button>
        )}
      </div>
    </SettingsGroup>
  );
}

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
    <>
    <SettingsGroup label="Playback quality" hint="Below Full, the player uses a lighter copy of each video (made once, in the background) so slower computers stay smooth.">
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
    </SettingsGroup>
    <GraphicsCache mb={mb} />
    <SettingsGroup label="Performance mode" hint="How much background work (thumbnails, waveforms, copies) runs at once, and whether exports leave room for other apps.">
      <div className="seg-tabs small" role="radiogroup" aria-label="Performance mode">
        {PERF_MODE_OPTIONS.map(([id, label, hint]) => (
          <button key={id} type="button" role="radio" aria-checked={mode === id} className={mode === id ? 'on' : ''}
            title={hint} onClick={async () => { const r = await window.api.perfSetMode(id); setMode(r.mode); setSt(r); }}>{label}</button>
        ))}
      </div>
      <p className="set2-note">{PERF_MODE_OPTIONS.find(([id]) => id === mode)?.[2]}</p>
    </SettingsGroup>
    </>
  );
}

// Settings pages, grouped in the rail: editor preferences, AI, then connected services.
const SECTION_GROUPS = [
  { label: 'General', items: [
    { id: 'quality', label: 'Performance', icon: Gauge, title: 'Performance', description: 'How ClipCraft plays and processes media on this computer. Exports always render from your original files.' },
    { id: 'shortcuts', label: 'Shortcuts', icon: Keyboard, title: 'Keyboard shortcuts', description: 'Remap any editor shortcut. Changes are saved and apply at once.' },
  ] },
  { label: 'AI', items: [
    { id: 'ai', label: 'Assistant', icon: Sparkles, title: 'AI assistant', description: 'The service CraftAI uses to understand and carry out your edits.' },
    { id: 'speech', label: 'Voice', icon: AudioLines, title: 'Voice generation', description: 'Narration from text, in Audio > Text to speech or through CraftAI. Independent of the assistant’s provider.' },
    { id: 'external', label: 'External agents', icon: Bot, title: 'External agents (MCP)', description: 'Let an agent you run outside ClipCraft, such as Claude Code or Codex, edit through the same tools CraftAI uses while ClipCraft is open. One agent at a time; CraftAI pauses while it works.' },
    { id: 'mcp', label: 'Tool servers', icon: Server, title: 'Tool servers (MCP)', description: 'Local Model Context Protocol servers whose tools CraftAI can use while editing.' },
  ] },
  { label: 'Services', items: [
    { id: 'stock', label: 'Media libraries', icon: Film, title: 'Media libraries', description: 'Free stock footage and sound effects. Keys are stored encrypted on this PC.' },
  ] },
];
const SECTIONS = SECTION_GROUPS.flatMap(g => g.items);

export default function SettingsDialog({ onClose, onProxiesCleared, onAbout, initialSection = 'ai' }) {
  const [section, setSection] = useState(initialSection === 'stock' || initialSection.startsWith('services') ? 'services' : initialSection);
  const [serviceTarget, setServiceTarget] = useState((initialSection.startsWith('services:') ? initialSection.slice('services:'.length) : '') || (initialSection === 'stock' ? 'pixabay' : ''));
  const openService = target => { setServiceTarget(target || ''); setSection('services'); };
  const [saved, setSaved] = useState(null); // public settings from the main process
  const paneRef = useRef(null);
  const dialogRef = useRef(null);
  const opener = useRef(document.activeElement);
  useEffect(() => () => { if (opener.current?.isConnected) opener.current.focus({ preventScroll: true }); }, []);
  // Focus starts on the dialog itself, never on a control: a mouse-opened window shows no focus ring
  // (desktop convention), Tab then reaches the rail first, and Enter does not close it by accident.
  useEffect(() => { dialogRef.current?.focus({ preventScroll: true }); }, []);
  useLayoutEffect(() => { if (paneRef.current) paneRef.current.scrollTop = 0; }, [section]);
  const [provider, setProvider] = useState('gemini');
  const [model, setModel] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [executablePath, setExecutablePath] = useState('');
  const [webResearch, setWebResearch] = useState(false);
  const [sdkStatus, setSdkStatus] = useState(null);
  const [runtimeProgress, setRuntimeProgress] = useState(null);
  const [runtimeError, setRuntimeError] = useState('');
  const [installingProvider, setInstallingProvider] = useState(null);
  const [runtimeRefresh, setRuntimeRefresh] = useState(0);
  const runtimeSelected = useRef(provider);
  runtimeSelected.current = provider;
  useEffect(() => {
    setRuntimeProgress(null);setRuntimeError('');
    return window.api.onAiRuntimeProgress(progress => {
      if (progress.provider !== provider) return;
      if (['ready', 'error', 'canceled'].includes(progress.stage)) {
        setRuntimeProgress(null);setRuntimeError(progress.error || '');setRuntimeRefresh(n => n + 1);
      } else setRuntimeProgress(progress);
    });
  }, [provider]);
  const [showKey, setShowKey] = useState(false);
  const [busy, setBusy] = useState(null); // 'save' | 'test' | 'models'
  const [models, setModels] = useState([]); // model ids offered by the provider
  const [customModel, setCustomModel] = useState(false);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsNote, setModelsNote] = useState('');
  const catalogGeneration = useRef(0);
  const [result, setResult] = useState(null); // { ok, text }

  const load = (s, p = s.provider) => {
    setSaved(s);
    setProvider(p);
    setModel(s.models[p] || s.defaultModels[p]);
    setBaseUrl(s.baseUrls[p] || '');
    setApiKey('');
    setExecutablePath(s.executablePaths?.[p] || '');
    setWebResearch(!!s.webResearch?.[p]);
    setResult(null);
    setCustomModel(false);
  };
  useEffect(() => {
    window.api.settingsGet().then((s) => load(s));
  }, []);

  useEffect(() => {
    let alive = true;
    catalogGeneration.current++;
    setSdkStatus(null);
    setModels([]);
    setModelsNote('');
    setModelsLoading(false);
    if (!PROVIDERS.find((p) => p.id === provider)?.sdk) return;
    const timer = setTimeout(() => {
      window.api.aiSdkStatus({ provider, executablePath }).then(async (status) => {
        if (!alive) return;
        setSdkStatus(status);
        if (status.runtime?.progress) setRuntimeProgress(status.runtime.progress);
        if (!status.ok || status.authenticated === false) return;
        setModelsLoading(true);
        try {
          const catalog = await window.api.aiModels({ provider, executablePath, model: '' });
          if (!alive) return;
          if (catalog.ok) {
            setModels(catalog.models);
            setModelsNote(catalog.fromCache ? 'Models from the CLI’s cached catalog.' : 'Models reported by the installed agent.');
          } else setModelsNote(catalog.error || 'Could not load models. You can enter a custom model ID.');
        } catch (error) {
          if (alive) setModelsNote(error.message || 'Could not load models. You can enter a custom model ID.');
        } finally { if (alive) setModelsLoading(false); }
      }).catch((error) => { if (alive) setSdkStatus({ ok: false, error: error.message }); });
    }, 250);
    return () => { alive = false; catalogGeneration.current++; clearTimeout(timer); };
  }, [provider, executablePath, runtimeRefresh]);

  useEffect(() => {
    const onKey = (e) => { if (!e.defaultPrevented && e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const dialogKeys = event => {
    if (event.key !== 'Tab') return;
    const controls = [...dialogRef.current.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]')].filter(el => el.getClientRects().length);
    const first = controls[0], last = controls.at(-1);
    if (!first) { event.preventDefault(); return; }
    if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };
  if (!saved) return null;
  const page = SECTIONS.find((s) => s.id === section) || SECTIONS[0];
  const info = PROVIDERS.find((p) => p.id === provider);
  const hint = saved.keys[provider];
  const draft = { provider, model, baseUrl, apiKey, executablePath, ...(info?.sdk ? { webResearch } : {}) };
  const runtimeBusy = installingProvider === provider || (runtimeProgress && runtimeProgress.stage !== 'ready');
  const installRuntime = async () => {
    const selected = provider;
    setInstallingProvider(selected);setRuntimeError('');
    try {
      const result = await window.api.aiRuntimeInstall(selected);
      if (runtimeSelected.current === selected) {
        if (result.ok) setExecutablePath('');
        if (!result.ok && !result.canceled) setRuntimeError(result.error || 'The download failed. Try again.');
        setRuntimeProgress(null);setRuntimeRefresh(n => n + 1);
      }
    } catch (error) {
      if (runtimeSelected.current === selected) { setRuntimeError(error.message);setRuntimeProgress(null); }
    } finally { setInstallingProvider(p => p === selected ? null : p); }
  };

  const switchProvider = (p) => {
    catalogGeneration.current++;
    setBusy(null);
    setProvider(p);
    setModel(saved.models[p] || saved.defaultModels[p]);
    setBaseUrl(saved.baseUrls[p] || '');
    setApiKey('');
    setExecutablePath(saved.executablePaths?.[p] || '');
    setWebResearch(!!saved.webResearch?.[p]);
    setResult(null);
    setModels([]);
    setCustomModel(false);
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
    const generation = ++catalogGeneration.current;
    setBusy('models');
    setResult(null);
    let r;
    try { r = await window.api.aiModels(draft); }
    catch (error) { r = { ok: false, error: error.message }; }
    if (generation !== catalogGeneration.current) return;
    setBusy(null);
    if (!r.ok) return setResult({ ok: false, text: r.error, link: r.link, linkLabel: r.linkLabel });
    setModels(r.models);
    setModelsNote(r.fromCache ? 'Models from the CLI’s cached catalog.' : 'Models reported by the installed agent.');
    setResult({ ok: true, text: r.useCliDefault
      ? 'Leave Model blank to use the installed CLI default, or enter a model id.'
      : r.fromCache ? `${r.models.length} models in the CLI’s cached catalog. Choose one your account can use.`
        : `${r.models.length} models available. Pick one from the Model list.` });
  };

  const removeKey = async () => {
    load(await window.api.settingsClearKey(provider), provider);
  };

  return (
    <div ref={dialogRef} tabIndex={-1} onKeyDown={dialogKeys} className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="settings-title" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal settings settings2">
        <div className="settings-head">
          <h3 id="settings-title">Settings</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Close settings"><X size={16} /></button>
        </div>
        <div className="set2-body">
          <nav className="set2-rail" aria-label="Settings sections">
            {SECTION_GROUPS.map((group) => (
              <div key={group.label} className="set2-rail-group" role="group" aria-label={group.label}>
                <div className="set2-rail-label" aria-hidden="true">{group.label}</div>
                {group.items.map((s) => {
                  const Icon = s.icon;
                  return (
                    <button key={s.id} type="button" data-section={s.id} className={section === s.id ? 'on' : ''} aria-current={section === s.id || undefined}
                      onClick={() => { setSection(s.id); if (paneRef.current) paneRef.current.scrollTop = 0; }}>
                      <Icon size={15} /> <span>{s.label}</span>
                    </button>
                  );
                })}
              </div>
            ))}
            <div className="set2-app-links">
              <button type="button" className="about-btn" onClick={() => { onClose();onAbout(); }} aria-label="About ClipCraft" title="Version and source">
                <Info size={15} /><span>About ClipCraft</span>
              </button>
            </div>
          </nav>
          <div className="set2-pane" ref={paneRef}>
        {section === 'ai' && (
        <SettingsPage title={page.title} description={page.description} actions={<>
            <button className="btn" onClick={test} disabled={!!busy || (info.needsKey && !apiKey.trim() && !hint) || (info.sdk && (!sdkStatus?.ok || sdkStatus.authenticated === false))}>
              {busy === 'test' ? <Loader2 size={14} className="spin" /> : null} Test connection
            </button>
            <button className="btn btn-primary" onClick={save} disabled={!!busy}>
              {busy === 'save' ? <Loader2 size={14} className="spin" /> : null} Save
            </button>
        </>}>
          <SettingsGroup label="Provider">
            <label className="field">
              <span className="sr-only">Provider</span>
              <select value={provider} aria-label="Provider" onChange={(e) => switchProvider(e.target.value)}>
                {PROVIDERS.map((p) => <option key={p.id} value={p.id}>{p.name}{saved.keys[p.id] ? '  ✓' : ''}</option>)}
              </select>
            </label>
            <p className="set2-note">{info.hint}</p>
            {info.keyUrl && (
              <button className="btn btn-ghost btn-sm link-btn" type="button" onClick={() => window.api.openHelp(info.keyUrl)}>
                <ExternalLink size={13} /> {info.keyUrlLabel}
              </button>
            )}
          </SettingsGroup>

          <SettingsGroup label="Connection">
          {info.sdk && (
            <>
              <div className={`set2-status ${!sdkStatus ? 'pending' : sdkStatus.ok && sdkStatus.authenticated !== false ? 'ok' : 'bad'}`} role="status" aria-label="Installed agent status">
                <span className="set2-status-dot" aria-hidden="true" />
                <div className="set2-status-body">
                  <span>{!sdkStatus ? 'Checking the installed agent…' : !sdkStatus.ok ? sdkStatus.error
                    : sdkStatus.authenticated === false ? `Installed: ${sdkStatus.version}. Sign in with ${sdkStatus.loginCommand}.`
                    : `Detected: ${sdkStatus.version}${sdkStatus.authenticated ? ' · Signed in' : ' · Test the connection to check login'}`}</span>
                  {sdkStatus?.ok && <small className="set2-path" title={sdkStatus.executablePath}>{sdkStatus.executablePath}</small>}
                </div>
              </div>
              <label className="field">
                <span>Agent executable <em className="set2-optional">optional</em></span>
                <div className="key-row">
                  <input type="text" value={executablePath} disabled={runtimeBusy} spellCheck={false} aria-label="Agent executable"
                    placeholder="Detect installed CLI automatically" onChange={(e) => setExecutablePath(e.target.value)} />
                  <button className="btn btn-sm" type="button" disabled={runtimeBusy} onClick={async () => {
                    const file = await window.api.aiPickExecutable(provider);
                    if (file) setExecutablePath(file);
                  }}>Browse</button>
                </div>
              </label>
              {(runtimeBusy || (!sdkStatus?.ok && sdkStatus?.runtime?.supported)) && (
                <div className="progress-block" aria-label="Agent download">
                  {runtimeBusy ? <>
                    <span role="status" aria-live="polite">{runtimeProgress?.stage === 'retry' ? 'Reconnecting download…' : runtimeProgress?.stage === 'verify' ? 'Verifying download…'
                      : runtimeProgress?.stage === 'extract' ? 'Installing native engine…'
                      : `Downloading ${nativeName(provider)}…${runtimeProgress?.total ? ` ${Math.round(100 * (runtimeProgress.received || 0) / runtimeProgress.total)}%` : ''}`}</span>
                    <div className="progress" role="progressbar" aria-label="Agent download progress" aria-valuemin={0} aria-valuemax={100}
                      aria-valuenow={runtimeProgress?.total ? Math.round(100 * (runtimeProgress.received || 0) / runtimeProgress.total) : undefined}>
                      <div style={{ width: `${runtimeProgress?.total ? 100 * (runtimeProgress.received || 0) / runtimeProgress.total : 0}%` }} />
                    </div>
                    <button type="button" className="btn btn-sm" onClick={() => window.api.aiRuntimeCancel(provider)}>Cancel download</button>
                  </> : <>
                    <p className="muted">The native engine downloads once and is reused. No Node or npm installation needed.</p>
                    <button type="button" className="btn btn-sm" onClick={installRuntime}>{runtimeError ? 'Retry download' : `Download ${nativeName(provider)}`}</button>
                  </>}
                </div>
              )}
              {runtimeError && <p className="error-text" role="alert">{runtimeError}</p>}
              <label className="set2-switch-row">
                <span className="set2-switch-text">
                  <b>Web research</b>
                  <small className="muted">{nativeName(provider)} may search the web{provider !== 'codex-sdk' ? ' and read pages' : ''} when you ask for research, sources or current facts. Searches show in the chat and answers link their sources. It never changes your project on its own.</small>
                </span>
                <input type="checkbox" className="switch" aria-label="Web research" checked={webResearch} onChange={(e) => setWebResearch(e.target.checked)} />
              </label>
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

          {(provider === 'ollama' || provider === 'openai' || provider === 'custom' || baseUrl) && (
            <label className="field">
              <span>{provider === 'custom' ? 'Address (required for Custom)' : 'Address (optional for hosted services)'}</span>
              <input type="text" value={baseUrl} spellCheck={false} placeholder={info.baseUrl || 'Default'} onChange={(e) => setBaseUrl(e.target.value)} />
            </label>
          )}

          {!saved.encryption && info.needsKey && (
            <p className="error-text">Secure storage is not available on this PC, so keys cannot be saved.</p>
          )}

          {!info.sdk && !info.needsKey && !(provider === 'ollama' || provider === 'openai' || provider === 'custom' || baseUrl) && <p className="set2-note">No key needed.</p>}
          </SettingsGroup>

          <SettingsGroup label="Model" aside={
              <button className="btn btn-ghost btn-sm" type="button" onClick={loadModels}
                disabled={!!busy || modelsLoading || (info.needsKey && !apiKey.trim() && !hint) || (info.sdk && !sdkStatus?.ok)}>
                {busy === 'models' || modelsLoading ? <Loader2 size={13} className="spin" /> : null} {info.sdk ? 'Refresh models' : 'Load models'}
              </button>
          }>
          <label className="field">
            <span className="sr-only">Model</span>
            {info.sdk ? (
              <>
                <Dropdown ariaLabel="AI model" className="settings-model-picker" value={customModel ? '__custom__' : model} disabled={!!busy}
                  options={[
                    { value: '', label: 'Default from installed CLI' },
                    ...[...new Set([...models, ...(model ? [model] : [])])].map((id) => ({ value: id, label: id })),
                    { value: '__custom__', label: 'Custom model ID…' },
                  ]}
                  onChange={(id) => {
                    setCustomModel(id === '__custom__');
                    if (id !== '__custom__') setModel(id);
                    setResult(null);
                  }} />
                {customModel && <input type="text" value={model} aria-label="Custom model ID" spellCheck={false}
                  placeholder="Enter the exact model ID" onChange={(e) => setModel(e.target.value)} />}
                <small className="muted">{modelsLoading ? 'Loading models…' : modelsNote || 'Choose a model, use the CLI default, or enter a custom ID.'} Click Save to use this model in CraftAI.</small>
              </>
            ) : (
              <>
                <input type="text" list="model-ids" value={model} aria-label="AI model ID" spellCheck={false} onChange={(e) => setModel(e.target.value)} />
                <datalist id="model-ids">{models.map((m) => <option key={m} value={m} />)}</datalist>
                <small className="muted">Use the model id (for example gemini-3.8-flash), not the display name. “Load models” lists the real ones.</small>
              </>
            )}
          </label>

          </SettingsGroup>
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

        </SettingsPage>
        )}
        {section === 'external' && <SettingsPage title={page.title} description={page.description}><ExternalAgentSettings /></SettingsPage>}
        {section === 'mcp' && <SettingsPage title={page.title} description={page.description}><McpSettings saved={saved} onSaved={(st) => setSaved(st)} /></SettingsPage>}
        {section === 'speech' && (
          <SettingsPage title={page.title} description={page.description}>
            <VoiceSettings saved={saved} onSaved={setSaved} />
          </SettingsPage>
        )}
        {section === 'quality' && <SettingsPage title={page.title} description={page.description}><ProxySettings onCleared={onProxiesCleared} /></SettingsPage>}
        {section === 'shortcuts' && <SettingsPage title={page.title} description={page.description}><ShortcutSettings saved={saved} onSaved={setSaved} /></SettingsPage>}
        {section === 'stock' && (
          <SettingsPage title={page.title} description={page.description}>
            <StockSettings saved={saved} onSaved={(st) => setSaved(st)} />
            <SoundzaSettings saved={saved} onSaved={(st) => setSaved(st)} />
          </SettingsPage>
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
    <>
    <SettingsGroup label="Servers" hint={<>Their tools reach CraftAI as <code>mcp_&lt;server&gt;_&lt;tool&gt;</code>, next to the editing tools.</>}>
      {!servers.length && <p className="set2-empty">No servers yet. Add one below.</p>}
      {servers.map((s, i) => (
        <div key={`${s.name}-${i}`} className="set2-item">
          <span className="set2-item-text">
            <b>{s.name}</b> <span className="muted">{s.command} {s.args.join(' ')}</span>
          </span>
          <button className="btn btn-sm" type="button" disabled={busy === s.name} onClick={() => test(s)}>{busy === s.name ? 'Testing…' : 'Test'}</button>
          <button className="icon-btn" type="button" aria-label={`Remove ${s.name}`} title="Remove server" onClick={() => remove(i)}><Trash2 size={15} /></button>
        </div>
      ))}
    </SettingsGroup>
    <SettingsGroup label="Add a server">
      <div className="set2-grid">
      <label className="field"><span>Name</span>
        <input type="text" value={name} placeholder="e.g. filesystem" onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="field"><span>Command</span>
        <input type="text" value={command} spellCheck={false} placeholder="e.g. npx" onChange={(e) => setCommand(e.target.value)} />
      </label>
      </div>
      <label className="field"><span>Arguments <em className="set2-optional">space-separated</em></span>
        <input type="text" value={args} spellCheck={false} placeholder="e.g. -y @modelcontextprotocol/server-filesystem /home/me/files" onChange={(e) => setArgs(e.target.value)} />
      </label>
      <div className="settings-actions">
        <button className="btn" type="button" disabled={!name.trim() || !command.trim()} onClick={add}>Add server</button>
        {/* Idle busy is '', so an empty draft name must not read as "Testing…". */}
        <button className="btn" type="button" disabled={!name.trim() || !command.trim() || (!!busy && busy === name.trim())}
          onClick={() => test({ name: name.trim(), command: command.trim(), args: splitArgs(args) })}>{busy && busy === name.trim() ? 'Testing…' : 'Test draft'}</button>
      </div>
      {result && (
        <div className={`result ${result.ok ? 'ok' : 'bad'}`} role="status">
          {result.ok ? <CircleCheck size={15} /> : <CircleAlert size={15} />}
          <div className="result-body"><span>{result.text}</span></div>
        </div>
      )}
    </SettingsGroup>
    </>
  );
}

// Settings > Voice: the default voice, the Gemini key and Piper downloads share one speech status, so the default
// follows a key saved or a voice downloaded on the same page.
function VoiceSettings({ saved, onSaved }) {
  const [status, setStatus] = useState(null);
  const refresh = () => window.api.ttsStatus?.().then(setStatus).catch(() => {});
  useEffect(() => { refresh(); }, [JSON.stringify(saved.serviceKeys || {})]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      {status && <DefaultVoiceSettings status={status} onChanged={refresh} />}
      <ServiceKey saved={saved} onSaved={onSaved} service="gemini-tts" title="Gemini voices" icon={AudioLines}
        keyLabel="Gemini TTS API key" text="Gemini 3.8 Flash TTS and Flash-Lite TTS. The key is free from Google AI Studio."
        url="https://aistudio.google.com/app/apikey" urlLabel="Get a Gemini API key" test={(key) => window.api.ttsGeminiTestKey(key)} />
      {status && <PiperSettings status={status} setStatus={(next) => setStatus(typeof next === 'function' ? next : (s) => ({ ...s, ...next }))} />}
    </>
  );
}

// The speech engine and voice CraftAI and Text to speech use when none is named (src/features/audio/voiceDefault.js).
function DefaultVoiceSettings({ status, onChanged }) {
  const pref = status.voiceDefault || { engine: 'auto', voice: '' };
  const [eleven, setEleven] = useState(null);
  const usable = usableEngines(status), effective = defaultSpeech(status);
  useEffect(() => {
    if (pref.engine === 'eleven' && status.elevenKey && !eleven) window.api.ttsElevenVoices().then((r) => setEleven(r.voices || [])).catch(() => setEleven([]));
  }, [pref.engine, status.elevenKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = async (next) => { await window.api.settingsSetVoiceDefault(next); onChanged(); };
  const voices = pref.engine === 'gemini' ? (status.gemini?.voices || []).map((v) => [v.id, `${v.name}${v.style ? ` · ${v.style}` : ''}`])
    : pref.engine === 'piper' ? piperVoicesOf(status).map((v) => [v.id, `${v.lang} · ${v.name}`])
    : pref.engine === 'eleven' ? (eleven || []).map((v) => [v.id, v.name]) : [];
  const needs = { gemini: ' (needs a key)', piper: ' (download a voice below)', eleven: ' (needs a key in Audio)' };
  const now = effective.engine ? `${ENGINE_NAMES[effective.engine]}${effective.voice ? ` · ${(status.gemini?.voices || []).find((v) => v.id === effective.voice)?.name || piperVoicesOf(status).find((v) => v.id === effective.voice)?.name || (eleven || []).find((v) => v.id === effective.voice)?.name || effective.voice}` : ''}` : 'none set up yet';
  return (
    <SettingsGroup label="Default voice" hint="Used by CraftAI and as Text to speech's first choice when no engine or voice is named.">
      <div className="set2-grid">
        <label className="field"><span>Engine</span>
          <select aria-label="Default voice engine" value={pref.engine} onChange={(e) => save({ engine: e.target.value, voice: '' })}>
            <option value="auto">Automatic</option>
            {['gemini', 'piper', 'eleven'].map((id) => <option key={id} value={id}>{ENGINE_NAMES[id]}{usable[id] ? '' : needs[id]}</option>)}
          </select>
        </label>
        {pref.engine !== 'auto' && (
          <label className="field"><span>Voice</span>
            <select aria-label="Default voice" value={effective.from === 'settings' ? effective.voice : pref.voice} disabled={!voices.length} onChange={(e) => save({ engine: pref.engine, voice: e.target.value })}>
              {!voices.length && <option value="">{pref.engine === 'eleven' && status.elevenKey && !eleven ? 'Loading…' : 'No voice available'}</option>}
              {voices.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
            </select>
          </label>
        )}
      </div>
      <p className="set2-note" data-default-voice-note>{pref.engine === 'auto'
        ? `Gemini when it has a key, otherwise a downloaded Piper voice, otherwise ElevenLabs. Now: ${now}.`
        : effective.from === 'settings' ? `Now: ${now}. CraftAI uses it unless you ask for another voice.`
        : `${effective.note} Now: ${now}.`}</p>
    </SettingsGroup>
  );
}

// Piper voices on this computer (electron/audio/tts.cjs): optional downloads, the engine first, then any voices.
// Each can be removed again; one download runs at a time and can be canceled.
const mb = (bytes) => `${Math.round((bytes || 0) / 1e6)} MB`;
function PiperSettings({ status, setStatus }) {
  const [job, setJob] = useState(null); // { target, fraction }
  const [message, setMessage] = useState(null); // { ok, text }
  useEffect(() => window.api.onTtsPiperProgress?.((p) => setJob((j) => (j?.target === p.target ? { ...j, fraction: p.fraction } : j))), []);
  const download = async (target, label) => {
    setMessage(null); setJob({ target, fraction: 0 });
    const r = await window.api.ttsPiperDownload(target);
    setJob(null);
    if (r.status) setStatus((s) => ({ ...s, ...r.status }));
    setMessage(r.ok ? { ok: true, text: `${label} downloaded.` } : r.canceled ? { ok: true, text: 'Download canceled.' } : { ok: false, text: r.error });
  };
  const remove = async (target, label) => {
    setMessage(null);
    const r = await window.api.ttsPiperRemove(target);
    if (r.status) setStatus((s) => ({ ...s, ...r.status }));
    setMessage(r.ok ? { ok: true, text: `${label} removed.` } : { ok: false, text: r.error });
  };
  const row = (target, label, detail, downloaded, bytes, disabled) => {
    const running = job?.target === target;
    return (
      <div key={target} className="set2-item piper-row" data-piper={target}>
        <span className="set2-item-text"><b>{label}</b> <span className="muted">{detail}</span></span>
        {running ? <>
          <span className="piper-progress" role="status"><Loader2 size={13} className="spin" />{Math.round((job.fraction || 0) * 100)}%</span>
          <button className="btn btn-sm" type="button" onClick={() => window.api.ttsPiperCancel(target)}>Cancel</button>
        </> : downloaded
          ? <button className="btn btn-sm" type="button" disabled={!!job} onClick={() => remove(target, label)}>Remove</button>
          : <button className="btn btn-sm btn-primary" type="button" disabled={!!job || disabled} onClick={() => download(target, label)}>Download · {mb(bytes)}</button>}
      </div>
    );
  };
  return (
    <SettingsGroup label="Piper voices on this computer" hint="Free voices that run offline, no account. Optional: download the engine, then the voices you want. Used in Audio > Text to speech and by CraftAI.">
      {!status.supported ? <p className="set2-empty">Piper voices are not available on this computer.</p> : <>
        {row('engine', 'Voice engine', status.runtime === 'sherpa' ? 'Runs the Piper voices (sherpa-onnx)' : 'Piper', status.installed, status.engineBytes, false)}
        {status.voices.map((v) => row(v.id, `${v.name}`, `${v.lang} · ${v.gender} · ${v.license}${!status.installed && !v.downloaded ? ' · needs the engine' : ''}`, v.downloaded, v.bytes, false))}
      </>}
      {message && (
        <div className={`result ${message.ok ? 'ok' : 'bad'}`} role="status">
          {message.ok ? <CircleCheck size={15} /> : <CircleAlert size={15} />}
          <div className="result-body"><span>{message.text}</span></div>
        </div>
      )}
    </SettingsGroup>
  );
}

// External agents (docs/design/external-agent-mcp.md): on/off, the server address, who is connected,
// one-click setup in the agents installed on this computer, and the agents the user allowed.
function ExternalAgentSettings() {
  const [status, setStatus] = useState(null);
  const [agents, setAgents] = useState(null);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState(null); // { ok, text }
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    window.api.externalStatus?.().then(setStatus).catch((e) => setMessage({ ok: false, text: e.message }));
    window.api.externalAgents?.().then((r) => setAgents(r.agents || [])).catch(() => setAgents([]));
    return window.api.onExternalStatus?.((s) => setStatus(s));
  }, []);
  if (!window.api.externalStatus) return <p className="set2-empty">Restart ClipCraft to use external agents.</p>;
  if (!status) return <p className="set2-empty"><Loader2 size={14} className="spin" /> Loading…</p>;
  const toggle = async (on) => {
    setMessage(null);
    const r = await window.api.externalSetEnabled(on);
    if (r?.status) setStatus(r.status);
    if (r && !r.ok) setMessage({ ok: false, text: r.error });
  };
  const act = async (agent, remove) => {
    setBusy(agent.id); setMessage(null);
    const r = await (remove ? window.api.externalUninstall(agent.id) : window.api.externalInstall(agent.id));
    setBusy('');
    if (r.agents?.length) setAgents(r.agents);
    setMessage(r.ok ? { ok: true, text: remove ? `ClipCraft was removed from ${agent.name}.` : `${agent.name} is set up. Start a new ${agent.name} session to use ClipCraft's tools.` } : { ok: false, text: r.error });
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(await window.api.externalManualConfig()); setCopied(true); setTimeout(() => setCopied(false), 1600); }
    catch { setMessage({ ok: false, text: 'Could not copy the setup.' }); }
  };
  const owner = status.owner;
  const stateOf = (a) => !a.found ? 'Not found on this computer' : !a.installed ? 'Not set up' : a.current ? 'Set up' : 'Set up for another address. Update it.';
  return (
    <>
    <SettingsGroup>
      <label className="set2-switch-row">
        <span className="set2-switch-text">
          <b>Allow external agents</b>
          <small className="muted">ClipCraft serves its tools on this computer only, to agents that have its key. Each new agent asks for your permission once.</small>
        </span>
        <input type="checkbox" className="switch" aria-label="Allow external agents" checked={status.enabled} onChange={(e) => toggle(e.target.checked)} />
      </label>
      {status.enabled && (
        <div className={`result ${status.running ? 'ok' : 'bad'}`} role="status">
          {status.running ? <CircleCheck size={15} /> : <CircleAlert size={15} />}
          <div className="result-body">
            <span>{!status.running ? (status.error || 'Not running. Turn the switch off and on again.')
              : owner ? `${owner.client.name} is ${owner.active ? 'working' : 'connected (idle)'}.` : 'Running. Waiting for an agent.'}</span>
            {status.running && <span className="external-url">{status.url}</span>}
          </div>
          {owner && <button className="btn btn-sm" type="button" onClick={() => window.api.externalDisconnect().then(setStatus)}>Disconnect</button>}
        </div>
      )}
    </SettingsGroup>
    <SettingsGroup label="Agents on this computer" hint="Install adds ClipCraft to the agent's own settings, for all its projects. The agent connects while ClipCraft is open with the switch on.">
      {!agents && <p className="set2-empty"><Loader2 size={14} className="spin" /> Looking for agents…</p>}
      {agents?.map((a) => (
        <div key={a.id} className="set2-item external-agent-row" data-agent={a.id}>
          <span className="set2-item-text"><b>{a.name}</b> <span className="muted">{a.error || stateOf(a)}</span></span>
          {a.found && (!a.installed || !a.current) && <button className="btn btn-sm btn-primary" type="button" disabled={!!busy} onClick={() => act(a, false)}>{busy === a.id ? <Loader2 size={13} className="spin" /> : null}{a.installed ? 'Update' : 'Install'}</button>}
          {a.installed && <button className="btn btn-sm" type="button" disabled={!!busy} onClick={() => act(a, true)}>Remove</button>}
        </div>
      ))}
      <div className="set2-item external-agent-row">
        <span className="set2-item-text"><b>Other MCP clients</b> <span className="muted">Copy the server address and key as mcpServers JSON.</span></span>
        <button className="btn btn-sm" type="button" onClick={copy}>{copied ? <Check size={13} /> : <Copy size={13} />}{copied ? 'Copied' : 'Copy setup'}</button>
      </div>
      {message && (
        <div className={`result ${message.ok ? 'ok' : 'bad'}`} role="status">
          {message.ok ? <CircleCheck size={15} /> : <CircleAlert size={15} />}
          <div className="result-body"><span>{message.text}</span></div>
        </div>
      )}
    </SettingsGroup>
    <SettingsGroup label="Allowed agents" hint="Named as the agent reports itself. Removing one asks again on its next call.">
      {!status.approved.length && <p className="set2-empty">None yet.</p>}
      {status.approved.map((name) => (
        <div key={name} className="set2-item">
          <span className="set2-item-text"><b>{name}</b>{owner?.client?.name === name && <span className="muted"> connected</span>}</span>
          <button className="icon-btn" type="button" aria-label={`Remove ${name}`} title="Remove" onClick={() => window.api.externalForget(name).then(setStatus)}><Trash2 size={15} /></button>
        </div>
      ))}
    </SettingsGroup>
    </>
  );
}
