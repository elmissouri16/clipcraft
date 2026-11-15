import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { PRESETS, nativeAgentName,registerPluginProviderMetadata } from '../../features/agent/providers.js';
import { t, tn, rich, formatNumber, LANGUAGES, getLanguage, resolveLanguage } from '../../i18n/index.js';
import ServiceConnections from './ServiceConnections.jsx';
import PluginSettings from '../../features/plugins/components/PluginSettings.jsx';
import { SettingsPage, SettingsGroup } from './SettingsLayout.jsx';
import Dropdown from "../../components/ui/Dropdown.jsx";
import { AudioLines, Bot, Check, CircleAlert, CircleCheck, Copy, ExternalLink, Gauge, Info, Keyboard, Loader2, Server, Sparkles, Trash2, X, Languages } from 'lucide-react';
import ShortcutSettings from './ShortcutSettings.jsx';
import { ENGINE_NAMES, defaultSpeech, studioVoicesOf, usableEngines } from '../../features/audio/voiceDefault.js';
import { VOICESTUDIO_URL } from '../../features/audio/components/TextToSpeech.jsx';
import { SUBAGENT_LIMITS } from '../../../shared/subagents.mjs';

// Providers come from the preset table (shared/providers.json): name, key page, hint, default address.

// Display name of a native agent in the runtime controls.
const nativeName = nativeAgentName;


// Playback quality: the player can play scaled copies of every video (longest side capped per
// level), so weak PCs edit smoothly. Made once per video, in the background. Export reads originals.
const QUALITY_OPTIONS = [
  ['full', t('settings.full'), t('settings.original_resolution')],
  ['high', t('settings.high'), t('settings.up_to_px', { px: 1280 })],
  ['medium', t('settings.medium'), t('settings.up_to_px', { px: 960 })],
  ['low', t('settings.low'), t('settings.up_to_px', { px: 640 })],
];
const PERF_MODE_OPTIONS = [
  ['low-end', t('settings.low_end'), t('settings.low_playback_copies_one_background_job')],
  ['balanced', t('settings.balanced'), t('settings.your_playback_quality_two_background_jobs')],
  ['high-performance', t('settings.high_performance'), t('settings.full_quality_playback_three_background_jobs')],
];
// Motion graphics are kept as full-quality transparent video; the cache keeps the newest 4 GB and
// never removes what an open project uses (a removed graphic is drawn again when its project opens).
function GraphicsCache({ mb }) {
  const [use, setUse] = useState(null);
  useEffect(() => { window.api.graphicsUsage?.().then(setUse).catch(() => {}); }, []);
  if (!use) return null;
  return (
    <SettingsGroup label={t('settings.motion_graphics')} hint={t('settings.rendered_graphics_are_kept_so_they_play')}>
      <div className="proxy-store">
        <span className="muted" aria-label={t('settings.motion_graphics_cache_size')}>{use.entries ? tn('settings.graphics_on_disk', use.entries, { size: mb(use.bytes) }) : t('settings.no_graphics_on_disk')}</span>
        {use.entries > 0 && (
          <button className="btn btn-ghost btn-sm" type="button" onClick={async () => setUse(await window.api.graphicsClear())}
            title={t('settings.delete_rendered_graphics_that_no_open_proj')}>
            <Trash2 size={13} /> {t('settings.clear')}
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
    <SettingsGroup label={t('settings.playback_quality')} hint={t('settings.below_full_the_player_uses_a_lighter_copy')}>
      <div className="seg-tabs small" role="radiogroup" aria-label={t('settings.playback_quality')}>
        {QUALITY_OPTIONS.map(([id, label, hint]) => (
          <button key={id} type="button" role="radio" aria-checked={st.quality === id} className={st.quality === id ? 'on' : ''}
            title={hint} onClick={async () => setSt(await window.api.qualitySet(id))}>{label}</button>
        ))}
      </div>
      <div className="proxy-store">
        <span className="muted">{st.files ? tn('settings.proxies_on_disk', st.files, { size: mb(st.bytes) }) : t('settings.no_proxy_on_disk')}</span>
        {st.files > 0 && (
          <button className="btn btn-ghost btn-sm" type="button" onClick={clear} disabled={st.quality !== 'full'}
            title={st.quality !== 'full' ? t('settings.choose_full_quality_first') : t('settings.delete_the_scaled_copies')}>
            <Trash2 size={13} /> {t('settings.delete_proxies')}
          </button>
        )}
      </div>
    </SettingsGroup>
    <GraphicsCache mb={mb} />
    <SettingsGroup label={t('settings.performance_mode')} hint={t('settings.how_much_background_work_runs_at_once')}>
      <div className="seg-tabs small" role="radiogroup" aria-label={t('settings.performance_mode')}>
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
  { label: t('settings.general'), items: [
    { id: 'plugins', label:t('plugins.title'), icon:Server, title:t('plugins.title'), description:t('plugins.description') },
    { id: 'language', label: t('settings.language'), icon: Languages, title: t('settings.language'), description: t('settings.the_language_of_clipcrafts_interface') },
    { id: 'quality', label: t('settings.performance'), icon: Gauge, title: t('settings.performance'), description: t('settings.how_clipcraft_plays_and_processes_media') },
    { id: 'shortcuts', label: t('settings.shortcuts'), icon: Keyboard, title: t('settings.keyboard_shortcuts'), description: t('settings.remap_any_editor_shortcut') },
  ] },
  { label: t('settings.ai'), items: [
    { id: 'ai', label: t('settings.assistant'), icon: Sparkles, title: t('settings.ai_assistant'), description: t('settings.the_service_craftai_uses_to_understand') },
    { id: 'speech', label: t('settings.voice'), icon: AudioLines, title: t('settings.voice_generation'), description: t('settings.narration_from_text_in_audio_text_to_speech') },
    { id: 'external', label: t('settings.external_agents'), icon: Bot, title: t('settings.external_agents_mcp'), description: t('settings.let_an_agent_you_run_outside_clipcraft') },
    { id: 'mcp', label: t('settings.tool_servers'), icon: Server, title: t('settings.tool_servers_mcp'), description: t('settings.local_model_context_protocol_servers') },
  ] },
  { label: t('settings.services'), items: [
    { id: 'services', label: t('settings.api_keys'), icon: Server, title: t('settings.external_services'), description: t('settings.add_and_manage_api_keys_for_the_assistant') },
  ] },
];
const SECTIONS = SECTION_GROUPS.flatMap(g => g.items);

export default function SettingsDialog({ onClose, onProxiesCleared, onAbout, initialSection = 'ai', pluginCommands }) {
  const [section, setSection] = useState(initialSection === 'stock' || initialSection.startsWith('services') ? 'services' : initialSection);
  const [serviceTarget, setServiceTarget] = useState((initialSection.startsWith('services:') ? initialSection.slice('services:'.length) : '') || (initialSection === 'stock' ? 'pixabay' : ''));
  const openService = target => { setServiceTarget(target || ''); setSection('services'); };
  const [saved, setSaved] = useState(null); // public settings from the main process
  const PROVIDERS=[...PRESETS,...(saved?.providerPlugins||[])];
  useEffect(()=>{registerPluginProviderMetadata(saved?.providerPlugins||[]);},[saved]);
  const paneRef = useRef(null);
  const dialogRef = useRef(null);
  const opener = useRef(document.activeElement);
  useEffect(() => () => { if (opener.current?.isConnected) opener.current.focus({ preventScroll: true }); }, []);
  // Focus starts on the dialog itself, never on a control: a mouse-opened window shows no focus ring
  // (desktop convention), Tab then reaches the rail first, and Enter does not close it by accident.
  const sheetRef = useRef(null);
  useEffect(() => { sheetRef.current?.focus({ preventScroll: true }); }, []);
  // Once settings have loaded, make sure focus is still inside the dialog (a panel may have grabbed it meanwhile).
  useEffect(() => { if (saved && !dialogRef.current?.contains(document.activeElement)) sheetRef.current?.focus({ preventScroll: true }); }, [!!saved]);
  useLayoutEffect(() => { if (paneRef.current) paneRef.current.scrollTop = 0; }, [section]);
  const [provider, setProvider] = useState('gemini');
  const [model, setModel] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [executablePath, setExecutablePath] = useState('');
  const [webResearch, setWebResearch] = useState(false);
  const [subagents, setSubagents] = useState(false);
  const [subagentConcurrency, setSubagentConcurrency] = useState(SUBAGENT_LIMITS.concurrent);
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
    setExecutablePath(s.executablePaths?.[p] || '');
    setWebResearch(!!s.webResearch?.[p]);
    setSubagents(!!s.subagents?.[p]);
    setSubagentConcurrency(s.subagentConcurrency?.[p] || SUBAGENT_LIMITS.concurrent);
    setResult(null);
    setCustomModel(false);
  };
  useEffect(() => {
    let live=true;window.api.settingsGet().then(s=>{if(live)load(s);});
    const off=window.api.onPluginsChanged?.(()=>window.api.settingsGet().then(s=>{if(live)setSaved(s);}));
    return()=>{live=false;off?.();};
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
            setModelsNote(catalog.fromCache ? t('settings.models_from_the_clis_cached_catalog') : t('settings.models_reported_by_the_installed_agent'));
          } else setModelsNote(catalog.error || t('settings.could_not_load_models_enter_a_custom_id'));
        } catch (error) {
          if (alive) setModelsNote(error.message || t('settings.could_not_load_models_enter_a_custom_id'));
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
    if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current || document.activeElement === sheetRef.current)) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };
  if (!saved) return null;
  const page = SECTIONS.find((s) => s.id === section) || SECTIONS[0];
  const info = PROVIDERS.find((p) => p.id === provider)||{id:provider,plugin:true,unavailable:true,name:t('plugins.provider_unavailable'),needsKey:true};
  const hint = saved.keys[provider];
  const draft = { provider, model, baseUrl, executablePath, ...(info?.sdk ? { webResearch, subagents, subagentConcurrency } : {}) };
  const runtimeBusy = installingProvider === provider || (runtimeProgress && runtimeProgress.stage !== 'ready');
  const installRuntime = async () => {
    const selected = provider;
    setInstallingProvider(selected);setRuntimeError('');
    try {
      const result = await window.api.aiRuntimeInstall(selected);
      if (runtimeSelected.current === selected) {
        if (result.ok) setExecutablePath('');
        if (!result.ok && !result.canceled) setRuntimeError(result.error || t('settings.the_download_failed_try_again'));
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
    setExecutablePath(saved.executablePaths?.[p] || '');
    setWebResearch(!!saved.webResearch?.[p]);
    setSubagents(!!saved.subagents?.[p]);
    setSubagentConcurrency(saved.subagentConcurrency?.[p] || SUBAGENT_LIMITS.concurrent);
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
    setResult({ ok: true, text: t('settings.saved') });
  };

  const test = async () => {
    setBusy('test');
    setResult(null);
    const r = await window.api.aiTest(draft);
    setBusy(null);
    setResult(r.ok ? { ok: true, text: t('settings.connected_in_seconds_the_model_replied', { seconds: formatNumber(r.ms / 1000, { minimumFractionDigits: 1, maximumFractionDigits: 1 }), reply: r.reply }) } : { ok: false, text: r.error, link: r.link, linkLabel: r.linkLabel, suggestModel: r.suggestModel });
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
    setModelsNote(r.fromCache ? t('settings.models_from_the_clis_cached_catalog') : t('settings.models_reported_by_the_installed_agent'));
    setResult({ ok: true, text: r.useCliDefault
      ? t('settings.leave_model_blank_to_use_the_cli_default')
      : r.fromCache ? tn('settings.models_in_the_clis_cached_catalog', r.models.length)
        : tn('settings.models_available_pick_one_from_the_list', r.models.length) });
  };



  return (
    <div ref={dialogRef} onKeyDown={dialogKeys} className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="settings-title" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal settings settings2" ref={sheetRef} tabIndex={-1}>
        <div className="settings-head">
          <h3 id="settings-title">{t('home.settings')}</h3>
          <button className="icon-btn" onClick={onClose} aria-label={t('settings.close_settings')}><X size={16} /></button>
        </div>
        <div className="set2-body">
          <nav className="set2-rail" aria-label={t('settings.settings_sections')}>
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
              <button type="button" className="about-btn" onClick={() => { onClose();onAbout(); }} aria-label={t('settings.about_clipcraft')} title={t('settings.version_and_source')}>
                <Info size={15} /><span>{t('settings.about_clipcraft')}</span>
              </button>
            </div>
          </nav>
          <div className="set2-pane" ref={paneRef}>
        {section === 'ai' && (
        <SettingsPage title={page.title} description={page.description} actions={<>
            <button className="btn" onClick={test} disabled={!!busy || info.unavailable || (info.needsKey && !hint) || (info.sdk && (!sdkStatus?.ok || sdkStatus.authenticated === false))}>
              {busy === 'test' ? <Loader2 size={14} className="spin" /> : null} {t('settings.test_connection')}
            </button>
            <button className="btn btn-primary" onClick={save} disabled={!!busy||info.unavailable}>
              {busy === 'save' ? <Loader2 size={14} className="spin" /> : null} {t('close.save')}
            </button>
        </>}>
          <SettingsGroup label={t('settings.provider')}>
            <label className="field">
              <span className="sr-only">{t('settings.provider')}</span>
              <select value={provider} aria-label={t('settings.provider')} onChange={(e) => switchProvider(e.target.value)}>
                {!PROVIDERS.some(p=>p.id===provider)&&<option value={provider}>{t('plugins.provider_unavailable')}</option>}
                {PROVIDERS.map((p) => <option key={p.id} value={p.id}>{p.plugin?`${p.name} · ${p.version||t('plugins.unavailable')}`:t(`providers.${p.id}.name`)}{saved.keys[p.id] ? '  ✓' : ''}</option>)}
              </select>
            </label>
            <p className="set2-note">{info.plugin?(info.unavailable?t('plugins.provider_unavailable'):info.description):t(`providers.${provider}.hint`)}</p>
            {info.keyUrl && (
              <button className="btn btn-ghost btn-sm link-btn" type="button" onClick={() => window.api.openHelp(info.keyUrl)}>
                <ExternalLink size={13} /> {t(`providers.${provider}.key_label`)}
              </button>
            )}
          </SettingsGroup>

          <SettingsGroup label={t('settings.connection')}>
          {info.sdk && (
            <>
              <div className={`set2-status ${!sdkStatus ? 'pending' : sdkStatus.ok && sdkStatus.authenticated !== false ? 'ok' : 'bad'}`} role="status" aria-label={t('settings.installed_agent_status')}>
                <span className="set2-status-dot" aria-hidden="true" />
                <div className="set2-status-body">
                  <span>{!sdkStatus ? t('settings.checking_the_installed_agent') : !sdkStatus.ok ? sdkStatus.error
                    : sdkStatus.authenticated === false ? t('settings.installed_version_sign_in_with_command', { version: sdkStatus.version, command: sdkStatus.loginCommand })
                    : sdkStatus.authenticated ? t('settings.detected_version_signed_in', { version: sdkStatus.version }) : t('settings.detected_version_test_the_connection', { version: sdkStatus.version })}</span>
                  {sdkStatus?.ok && <small className="set2-path" title={sdkStatus.executablePath}>{sdkStatus.executablePath}</small>}
                </div>
              </div>
              <label className="field">
                <span>{t('settings.agent_executable')} <em className="set2-optional">{t('settings.optional')}</em></span>
                <div className="key-row">
                  <input type="text" value={executablePath} disabled={runtimeBusy} spellCheck={false} aria-label={t('settings.agent_executable')}
                    placeholder={t('settings.detect_installed_cli_automatically')} onChange={(e) => setExecutablePath(e.target.value)} />
                  <button className="btn btn-sm" type="button" disabled={runtimeBusy} onClick={async () => {
                    const file = await window.api.aiPickExecutable(provider);
                    if (file) setExecutablePath(file);
                  }}>{t('settings.browse')}</button>
                </div>
              </label>
              {(runtimeBusy || (!sdkStatus?.ok && sdkStatus?.runtime?.supported)) && (
                <div className="progress-block" aria-label={t('settings.agent_download')}>
                  {runtimeBusy ? <>
                    <span role="status" aria-live="polite">{runtimeProgress?.stage === 'retry' ? t('settings.reconnecting_download') : runtimeProgress?.stage === 'verify' ? t('settings.verifying_download')
                      : runtimeProgress?.stage === 'extract' ? t('settings.installing_native_engine')
                      : runtimeProgress?.total ? t('settings.downloading_name_percent', { name: nativeName(provider), percent: Math.round(100 * (runtimeProgress.received || 0) / runtimeProgress.total) })
                        : t('settings.downloading_name', { name: nativeName(provider) })}</span>
                    <div className="progress" role="progressbar" aria-label={t('settings.agent_download_progress')} aria-valuemin={0} aria-valuemax={100}
                      aria-valuenow={runtimeProgress?.total ? Math.round(100 * (runtimeProgress.received || 0) / runtimeProgress.total) : undefined}>
                      <div style={{ width: `${runtimeProgress?.total ? 100 * (runtimeProgress.received || 0) / runtimeProgress.total : 0}%` }} />
                    </div>
                    <button type="button" className="btn btn-sm" onClick={() => window.api.aiRuntimeCancel(provider)}>{t('settings.cancel_download')}</button>
                  </> : <>
                    <p className="muted">{t('settings.the_native_engine_downloads_once_and_is_re')}</p>
                    <button type="button" className="btn btn-sm" onClick={installRuntime}>{runtimeError ? t('settings.retry_download') : t('settings.download_name', { name: nativeName(provider) })}</button>
                  </>}
                </div>
              )}
              {runtimeError && <p className="error-text" role="alert">{runtimeError}</p>}
              <label className="set2-switch-row">
                <span className="set2-switch-text">
                  <b>{t('settings.web_research')}</b>
                  <small className="muted">{provider !== 'codex-sdk' ? t('settings.name_may_search_the_web_and_read_pages', { name: nativeName(provider) }) : t('settings.name_may_search_the_web', { name: nativeName(provider) })}</small>
                </span>
                <input type="checkbox" className="switch" aria-label={t('settings.web_research')} checked={webResearch} onChange={(e) => setWebResearch(e.target.checked)} />
              </label>
              <label className="set2-switch-row">
                <span className="set2-switch-text"><b>{t('subagents.setting')}</b><small className="muted">{t('subagents.setting_hint')}</small></span>
                <input type="checkbox" className="switch" aria-label={t('subagents.setting')} checked={subagents} onChange={e => setSubagents(e.target.checked)} />
              </label>
              <label className="field"><span>{t('subagents.concurrency')}</span>
                <Dropdown ariaLabel={t('subagents.concurrency')} value={subagentConcurrency} disabled={!subagents} onChange={setSubagentConcurrency}
                  options={Array.from({ length: SUBAGENT_LIMITS.maxConcurrent }, (_, i) => ({ value: i + 1, label: String(i + 1) }))} />
                <small className="muted">{t('subagents.concurrency_hint')}</small>
              </label>
            </>
          )}
          {info.plugin&&!info.unavailable&&<p className="set2-note">{t('plugins.provider_destination',{endpoint:info.baseUrl})}</p>}
          {info.needsKey && <div className="service-key-link"><span className="set2-note">{hint ? t('settings.api_key_saved_hint', { hint }) : t('settings.no_api_key_saved_for_this_provider')}</span><button type="button" className="btn btn-sm" onClick={() => openService(`assistant:${provider}`)}>{t('settings.manage_api_key')}</button></div>}

          {!info.plugin&&(provider === 'ollama' || provider === 'openai' || provider === 'custom' || baseUrl) && (
            <label className="field">
              <span>{provider === 'custom' ? t('settings.address_required_for_custom') : t('settings.address_optional_for_hosted_services')}</span>
              <input type="text" value={baseUrl} spellCheck={false} placeholder={info.baseUrl || t('settings.default')} onChange={(e) => setBaseUrl(e.target.value)} />
            </label>
          )}

          {!saved.encryption && info.needsKey && (
            <p className="error-text">{t('settings.secure_storage_is_not_available_on_this_pc')}</p>
          )}

          {!info.sdk && !info.needsKey && !(provider === 'ollama' || provider === 'openai' || provider === 'custom' || baseUrl) && <p className="set2-note">{t('settings.no_key_needed')}</p>}
          </SettingsGroup>

          <SettingsGroup label={t('settings.model')} aside={
              <button className="btn btn-ghost btn-sm" type="button" onClick={loadModels}
                disabled={!!busy || info.unavailable || modelsLoading || (info.needsKey && !hint) || (info.sdk && !sdkStatus?.ok)}>
                {busy === 'models' || modelsLoading ? <Loader2 size={13} className="spin" /> : null} {info.sdk ? t('settings.refresh_models') : t('settings.load_models')}
              </button>
          }>
          <label className="field">
            <span className="sr-only">{t('settings.model')}</span>
            {info.plugin ? <><Dropdown ariaLabel={t('settings.ai_model')} value={model} disabled={!!busy||info.unavailable} options={(info.models||[]).map(m=>({value:m.id,label:m.name}))} onChange={setModel}/><small className="muted">{t('plugins.provider_models_note')}</small></> : info.sdk ? (
              <>
                <Dropdown ariaLabel={t('settings.ai_model')} className="settings-model-picker" value={customModel ? '__custom__' : model} disabled={!!busy}
                  options={[
                    { value: '', label: t('settings.default_from_installed_cli') },
                    ...[...new Set([...models, ...(model ? [model] : [])])].map((id) => ({ value: id, label: id })),
                    { value: '__custom__', label: t('settings.custom_model_id_option') },
                  ]}
                  onChange={(id) => {
                    setCustomModel(id === '__custom__');
                    if (id !== '__custom__') setModel(id);
                    setResult(null);
                  }} />
                {customModel && <input type="text" value={model} aria-label={t('settings.custom_model_id')} spellCheck={false}
                  placeholder={t('settings.enter_the_exact_model_id')} onChange={(e) => setModel(e.target.value)} />}
                <small className="muted">{modelsLoading ? t('settings.loading_models') : modelsNote || t('settings.choose_a_model_use_the_cli_default')} {t('settings.click_save_to_use_this_model_in_craftai')}</small>
              </>
            ) : (
              <>
                <input type="text" list="model-ids" value={model} aria-label={t('settings.ai_model_id')} spellCheck={false} onChange={(e) => setModel(e.target.value)} />
                <datalist id="model-ids">{models.map((m) => <option key={m} value={m} />)}</datalist>
                <small className="muted">{t('settings.use_the_model_id_for_example_gemini_3_8_fl')}</small>
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
                    {t('settings.use_model', { model: result.suggestModel })}
                  </button>
                )}
                {result.link && (
                  <button className="btn btn-sm" type="button" onClick={() => window.api.openHelp(result.link)}>
                    <ExternalLink size={13} /> {result.linkLabel || t('settings.open_the_google_page')}
                  </button>
                )}
              </div>
            </div>
          )}

        </SettingsPage>
        )}
        {section === 'plugins' && <SettingsPage title={page.title} description={page.description}><PluginSettings commands={pluginCommands} /></SettingsPage>}
        {section === 'external' && <SettingsPage title={page.title} description={page.description}><ExternalAgentSettings /></SettingsPage>}
        {section === 'mcp' && <SettingsPage title={page.title} description={page.description}><McpSettings saved={saved} onSaved={(st) => setSaved(st)} /></SettingsPage>}
        {section === 'speech' && (
          <SettingsPage title={page.title} description={page.description}>
            <VoiceSettings saved={saved} onOpenService={openService} />
          </SettingsPage>
        )}
        {section === 'language' && <SettingsPage title={page.title} description={page.description}><LanguageSettings saved={saved} onSaved={setSaved} /></SettingsPage>}
        {section === 'quality' && <SettingsPage title={page.title} description={page.description}><ProxySettings onCleared={onProxiesCleared} /></SettingsPage>}
        {section === 'shortcuts' && <SettingsPage title={page.title} description={page.description}><ShortcutSettings saved={saved} onSaved={setSaved} /></SettingsPage>}
        {section === 'services' && <SettingsPage title={page.title} description={page.description}><ServiceConnections saved={saved} onSaved={setSaved} providers={PROVIDERS} target={serviceTarget} onNavigate={(nextSection, nextProvider) => { if (nextProvider && nextProvider !== provider) switchProvider(nextProvider); setSection(nextSection); }} /></SettingsPage>}
          </div>
        </div>
      </div>
    </div>
  );
}

// UI language (docs/design/localization.md): saved at once, applied when ClipCraft restarts.
function LanguageSettings({ saved, onSaved }) {
  const [busy, setBusy] = useState(false);
  const current = saved.language || 'system';
  const pending = resolveLanguage(current) !== getLanguage();
  const choose = async (value) => {
    setBusy(true);
    try { onSaved(await window.api.settingsSetLanguage(value)); } finally { setBusy(false); }
  };
  return (
    <SettingsGroup label={t('settings.interface_language')} hint={t('settings.menus_panels_dialogs_and_messages')}>
      <label className="field">
        <span className="sr-only">{t('settings.language')}</span>
        <select value={current} aria-label={t('settings.language')} disabled={busy} onChange={(e) => choose(e.target.value)}>
          {LANGUAGES.map((l) => <option key={l.id} value={l.id}>{l.id === 'system' ? t('settings.system_language') : l.label}</option>)}
        </select>
      </label>
      {pending && (
        <div className="set2-switch-row">
          <span className="set2-note">{t('settings.the_new_language_applies_when_clipcraft_re')}</span>
          <button type="button" className="btn btn-sm btn-primary" onClick={() => window.api.appRelaunch()}>{t('settings.restart_clipcraft')}</button>
        </div>
      )}
    </SettingsGroup>
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
    setResult({ ok: true, text: t('settings.server_saved_craftai_will_offer_its_tools') });
  };
  const remove = async (i) => { await persist(servers.filter((_, k) => k !== i)); setResult(null); };
  const test = async (server) => {
    setBusy(server.name); setResult(null);
    const r = await window.api.mcpTest(server);
    setBusy('');
    setResult(r.ok
      ? { ok: true, text: t('settings.server_answered_tools', { name: server.name, tools: r.tools.join(', ') || t('settings.none_in_parentheses') }) }
      : { ok: false, text: t('settings.server_failed_error', { name: server.name, error: r.error }) });
  };
  return (
    <>
    <SettingsGroup label={t('settings.servers')} hint={rich('settings.their_tools_reach_craftai_as_mcp_tool')}>
      {!servers.length && <p className="set2-empty">{t('settings.no_servers_yet_add_one_below')}</p>}
      {servers.map((s, i) => (
        <div key={`${s.name}-${i}`} className="set2-item">
          <span className="set2-item-text">
            <b>{s.name}</b> <span className="muted">{s.command} {s.args.join(' ')}</span>
          </span>
          <button className="btn btn-sm" type="button" disabled={busy === s.name} onClick={() => test(s)}>{busy === s.name ? t('settings.testing') : t('settings.test')}</button>
          <button className="icon-btn" type="button" aria-label={t('settings.remove_name', { name: s.name })} title={t('settings.remove_server')} onClick={() => remove(i)}><Trash2 size={15} /></button>
        </div>
      ))}
    </SettingsGroup>
    <SettingsGroup label={t('settings.add_a_server')}>
      <div className="set2-grid">
      <label className="field"><span>{t('home.name')}</span>
        <input type="text" value={name} placeholder={t('settings.e_g_filesystem')} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="field"><span>{t('settings.command')}</span>
        <input type="text" value={command} spellCheck={false} placeholder={t('settings.e_g_npx')} onChange={(e) => setCommand(e.target.value)} />
      </label>
      </div>
      <label className="field"><span>{t('settings.arguments')} <em className="set2-optional">{t('settings.space_separated')}</em></span>
        <input type="text" value={args} spellCheck={false} placeholder={t('settings.e_g_y_modelcontextprotocol_server_filesyst')} onChange={(e) => setArgs(e.target.value)} />
      </label>
      <div className="settings-actions">
        <button className="btn" type="button" disabled={!name.trim() || !command.trim()} onClick={add}>{t('settings.add_server')}</button>
        {/* Idle busy is '', so an empty draft name must not read as "Testing…". */}
        <button className="btn" type="button" disabled={!name.trim() || !command.trim() || (!!busy && busy === name.trim())}
          onClick={() => test({ name: name.trim(), command: command.trim(), args: splitArgs(args) })}>{busy && busy === name.trim() ? t('settings.testing') : t('settings.test_draft')}</button>
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

// Voice selection and the VoiceStudio connector remain here; external credentials live in API keys.
function VoiceSettings({ saved, onOpenService }) {
  const [status, setStatus] = useState(null);
  const refresh = () => window.api.ttsStatus?.().then(setStatus).catch(() => {});
  useEffect(() => { refresh(); }, [JSON.stringify(saved.serviceKeys || {})]); // eslint-disable-line react-hooks/exhaustive-deps
  return <>
    {status && <DefaultVoiceSettings status={status} onChanged={refresh} onOpenService={onOpenService} />}
    {status && <VoiceStudioSettings status={status} onChanged={refresh} />}
    <SettingsGroup label={t('settings.online_voice_services')} hint={t('settings.manage_credentials_in_settings_api_keys')}>
      {[['gemini-tts','Gemini','gemini-tts'],['elevenlabs','ElevenLabs','elevenlabs']].map(([id,label,target]) => <div key={id} className="service-key-link"><span>{label} <small className="muted">· {saved.serviceKeys?.[id] ? t('services.key_saved') : t('services.no_key_saved')}</small></span><button className="btn btn-sm" onClick={() => onOpenService(target)}>{saved.serviceKeys?.[id] ? t('settings.manage_key') : t('settings.add_key')}</button></div>)}
    </SettingsGroup>
  </>;
}

function DefaultVoiceSettings({ status, onChanged, onOpenService }) {
  const pref = status.voiceDefault || { engine: 'auto', voice: '' };
  const [eleven, setEleven] = useState(null);
  const usable = usableEngines(status), effective = defaultSpeech(status);
  useEffect(() => {
    if (pref.engine === 'eleven' && status.elevenKey && !eleven) window.api.ttsElevenVoices().then((r) => setEleven(r.voices || [])).catch(() => setEleven([]));
  }, [pref.engine, status.elevenKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = async (next) => { await window.api.settingsSetVoiceDefault(next); onChanged(); };
  const voices = pref.engine === 'gemini' ? (status.gemini?.voices || []).map((v) => [v.id, `${v.name}${v.style ? ` · ${v.style}` : ''}`])
    : pref.engine === 'voicestudio' ? studioVoicesOf(status).filter((v) => v.kind !== 'design').map((v) => [v.id, v.language ? `${v.name} · ${v.language}` : v.name])
    : pref.engine === 'eleven' ? (eleven || []).map((v) => [v.id, v.name]) : [];
  const engineOption = (id) => usable[id] ? ENGINE_NAMES[id]
    : id === 'voicestudio' ? (status.studio?.enabled ? t('settings.engine_not_running', { engine: ENGINE_NAMES[id] }) : t('settings.engine_turn_it_on_below', { engine: ENGINE_NAMES[id] }))
    : t('settings.engine_add_key_in_api_keys', { engine: ENGINE_NAMES[id] });
  const now = effective.engine ? `${ENGINE_NAMES[effective.engine]}${effective.voice ? ` · ${(status.gemini?.voices || []).find((v) => v.id === effective.voice)?.name || studioVoicesOf(status).find((v) => v.id === effective.voice)?.name || (eleven || []).find((v) => v.id === effective.voice)?.name || effective.voice}` : ''}` : t('settings.none_set_up_yet');
  return (
    <SettingsGroup label={t('settings.default_voice')} hint={t('settings.used_by_craftai_and_as_text_to_speechs_first')}>
      <div className="set2-grid">
        <label className="field"><span>{t('settings.engine')}</span>
          <select aria-label={t('settings.default_voice_engine')} value={pref.engine} onChange={(e) => save({ engine: e.target.value, voice: '' })}>
            <option value="auto">{t('settings.automatic')}</option>
            {['gemini', 'voicestudio', 'eleven'].map((id) => <option key={id} value={id}>{engineOption(id)}</option>)}
          </select>
        </label>
        {pref.engine !== 'auto' && (
          <label className="field"><span>{t('settings.voice')}</span>
            <select aria-label={t('settings.default_voice')} value={effective.from === 'settings' ? effective.voice : pref.voice} disabled={!voices.length} onChange={(e) => save({ engine: pref.engine, voice: e.target.value })}>
              {!voices.length && <option value="">{pref.engine === 'eleven' && status.elevenKey && !eleven ? t('settings.loading') : t('settings.no_voice_available')}</option>}
              {voices.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
            </select>
          </label>
        )}
      </div>
      {['gemini','eleven'].includes(pref.engine) && !usable[pref.engine] && <button className="btn btn-sm" onClick={() => onOpenService(pref.engine === 'eleven' ? 'elevenlabs' : 'gemini-tts')}>{t('settings.add_api_key')}</button>}
      <p className="set2-note" data-default-voice-note>{pref.engine === 'auto'
        ? t('settings.gemini_when_it_has_a_key_otherwise_voicestudio', { now })
        : effective.from === 'settings' ? t('settings.now_craftai_uses_it_unless_you_ask', { now })
        : `${effective.note} ${t('settings.now', { now })}`}</p>
    </SettingsGroup>
  );
}

// The VoiceStudio connector (electron/audio/tts.cjs): VoiceStudio is a free, open-source voice app the user installs;
// when the switch is on, ClipCraft speaks through its local API. The address is saved on blur or Enter; Test
// tries the draft without saving it.
function VoiceStudioSettings({ status, onChanged }) {
  const studio = status.studio || { enabled: false, url: '' };
  const [url, setUrl] = useState(studio.url || '');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null); // { ok, text }
  useEffect(() => { setUrl(studio.url || ''); }, [studio.url]);
  const save = async (patch) => {
    setMessage(null);
    const r = await window.api.settingsSetVoiceStudio(patch);
    if (r?.error) return setMessage({ ok: false, text: r.error });
    onChanged();
  };
  const saveUrl = () => { if (url.trim() !== (studio.url || '')) save({ url: url.trim() }); };
  const test = async () => {
    setBusy(true); setMessage(null);
    const r = await window.api.ttsStudioTest(url.trim());
    setBusy(false); setMessage(r);
  };
  const voices = studio.voices || [];
  return (
    <SettingsGroup label={t('settings.voicestudio_on_this_computer')} hint={t('settings.voicestudio_is_a_free_open_source_voice_app')}>
      <label className="set2-switch-row">
        <span className="set2-switch-text">
          <b>{t('settings.use_voicestudio')}</b>
          <small className="muted">{t('settings.when_on_text_to_speech_and_craftai_can_spea')}</small>
        </span>
        <input type="checkbox" className="switch" aria-label={t('settings.use_voicestudio')} checked={!!studio.enabled} onChange={(e) => save({ enabled: e.target.checked })} />
      </label>
      {studio.enabled && <>
        <div className="studio-address">
          <label className="field"><span>{t('settings.address')}</span>
            <input type="text" aria-label={t('settings.voicestudio_address')} value={url} spellCheck={false} placeholder="127.0.0.1:3900"
              onChange={(e) => setUrl(e.target.value)} onBlur={saveUrl} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); saveUrl(); } }} />
          </label>
          <button className="btn btn-sm" type="button" disabled={busy} onClick={test}>{busy ? t('settings.testing') : t('settings.test_connection')}</button>
        </div>
        <div className={`result ${studio.running ? 'ok' : 'bad'}`} role="status" data-studio-state={studio.running ? 'running' : 'down'}>
          {studio.running ? <CircleCheck size={15} /> : <CircleAlert size={15} />}
          <div className="result-body">
            <span>{studio.running
              ? t('settings.voicestudio_version_is_running_engine_count', { version: studio.version || '?', engine: studio.engine || 'VoiceStudio', count: voices.length })
              : (studio.error || t('settings.voicestudio_is_not_running_open_it'))}</span>
            {studio.running && voices.length > 0 && <span className="muted">{voices.map((v) => v.name).slice(0, 8).join(', ')}{voices.length > 8 ? '…' : ''}</span>}
          </div>
          {!studio.running && <button className="btn btn-sm" type="button" onClick={() => window.api.openHelp(VOICESTUDIO_URL)}><ExternalLink size={13} /> {t('tts.get_voicestudio')}</button>}
        </div>
        <p className="set2-note">{t('settings.voices_and_models_belong_to_voicestudio')}</p>
      </>}
      {message && (
        <div className={`result ${message.ok ? 'ok' : 'bad'}`} role="status" data-studio-test>
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
  if (!window.api.externalStatus) return <p className="set2-empty">{t('settings.restart_clipcraft_to_use_external_agents')}</p>;
  if (!status) return <p className="set2-empty"><Loader2 size={14} className="spin" /> {t('settings.loading')}</p>;
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
    setMessage(r.ok ? { ok: true, text: remove ? t('settings.clipcraft_was_removed_from_name', { name: agent.name }) : t('settings.name_is_set_up_start_a_new_session', { name: agent.name }) } : { ok: false, text: r.error });
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(await window.api.externalManualConfig()); setCopied(true); setTimeout(() => setCopied(false), 1600); }
    catch { setMessage({ ok: false, text: t('settings.could_not_copy_the_setup') }); }
  };
  const owner = status.owner;
  const stateOf = (a) => !a.found ? t('settings.not_found_on_this_computer') : !a.installed ? t('services.not_set_up') : a.current ? t('settings.set_up') : t('settings.set_up_for_another_address_update_it');
  return (
    <>
    <SettingsGroup>
      <label className="set2-switch-row">
        <span className="set2-switch-text">
          <b>{t('settings.allow_external_agents')}</b>
          <small className="muted">{t('settings.clipcraft_serves_its_tools_on_this_compute')}</small>
        </span>
        <input type="checkbox" className="switch" aria-label={t('settings.allow_external_agents')} checked={status.enabled} onChange={(e) => toggle(e.target.checked)} />
      </label>
      {status.enabled && (
        <div className={`result ${status.running ? 'ok' : 'bad'}`} role="status">
          {status.running ? <CircleCheck size={15} /> : <CircleAlert size={15} />}
          <div className="result-body">
            <span>{!status.running ? (status.error || t('settings.not_running_turn_the_switch_off_and_on'))
              : owner ? (owner.active ? t('settings.name_is_working', { name: owner.client.name }) : t('settings.name_is_connected_idle', { name: owner.client.name })) : t('settings.running_waiting_for_an_agent')}</span>
            {status.running && <span className="external-url">{status.url}</span>}
          </div>
          {owner && <button className="btn btn-sm" type="button" onClick={() => window.api.externalDisconnect().then(setStatus)}>{t('external.disconnect')}</button>}
        </div>
      )}
    </SettingsGroup>
    <SettingsGroup label={t('settings.agents_on_this_computer')} hint={t('settings.install_adds_clipcraft_to_the_agent')}>
      {!agents && <p className="set2-empty"><Loader2 size={14} className="spin" /> {t('settings.looking_for_agents')}</p>}
      {agents?.map((a) => (
        <div key={a.id} className="set2-item external-agent-row" data-agent={a.id}>
          <span className="set2-item-text"><b>{a.name}</b> <span className="muted">{a.error || stateOf(a)}</span></span>
          {a.found && (!a.installed || !a.current) && <button className="btn btn-sm btn-primary" type="button" disabled={!!busy} onClick={() => act(a, false)}>{busy === a.id ? <Loader2 size={13} className="spin" /> : null}{a.installed ? t('settings.update') : t('settings.install')}</button>}
          {a.installed && <button className="btn btn-sm" type="button" disabled={!!busy} onClick={() => act(a, true)}>{t('home.remove')}</button>}
        </div>
      ))}
      <div className="set2-item external-agent-row">
        <span className="set2-item-text"><b>{t('settings.other_mcp_clients')}</b> <span className="muted">{t('settings.copy_the_server_address_and_key_as_mcpserv')}</span></span>
        <button className="btn btn-sm" type="button" onClick={copy}>{copied ? <Check size={13} /> : <Copy size={13} />}{copied ? t('audio.copied') : t('settings.copy_setup')}</button>
      </div>
      {message && (
        <div className={`result ${message.ok ? 'ok' : 'bad'}`} role="status">
          {message.ok ? <CircleCheck size={15} /> : <CircleAlert size={15} />}
          <div className="result-body"><span>{message.text}</span></div>
        </div>
      )}
    </SettingsGroup>
    <SettingsGroup label={t('settings.allowed_agents')} hint={t('settings.named_as_the_agent_reports_itself')}>
      {!status.approved.length && <p className="set2-empty">{t('settings.none_yet')}</p>}
      {status.approved.map((name) => (
        <div key={name} className="set2-item">
          <span className="set2-item-text"><b>{name}</b>{owner?.client?.name === name && <span className="muted"> {t('settings.connected')}</span>}</span>
          <button className="icon-btn" type="button" aria-label={t('settings.remove_name', { name })} title={t('home.remove')} onClick={() => window.api.externalForget(name).then(setStatus)}><Trash2 size={15} /></button>
        </div>
      ))}
    </SettingsGroup>
    </>
  );
}
