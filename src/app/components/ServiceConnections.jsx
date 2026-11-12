import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, CircleAlert, CircleCheck, ExternalLink, Eye, EyeOff, Loader2, ShieldCheck, Trash2 } from 'lucide-react';
import SearchBox from '../../components/ui/SearchBox.jsx';
import { SettingsGroup } from './SettingsLayout.jsx';
import { t } from '../../i18n/index.js';

function connections(providers) {
  const groups = [
    { id: 'gemini', name: 'Google Gemini', url: 'https://aistudio.google.com/app/apikey', slots: [{ id: 'gemini-tts', kind: 'voice', label: t('settings.voice_generation'), keyLabel: t('services.gemini_tts_api_key'), test: key => window.api.ttsGeminiTestKey(key) }] },
    { id: 'openai', name: 'OpenAI', slots: [{ id: 'cap-openai', kind: 'captions', label: t('services.caption_transcription'), test: key => window.api.testCaptionsCloud('openai', key || undefined) }] },
    { id: 'elevenlabs', name: 'ElevenLabs', url: 'https://elevenlabs.io', slots: [
      { id: 'elevenlabs', kind: 'voice', label: t('settings.voice_generation'), keyLabel: t('services.elevenlabs_voice_api_key'), test: key => window.api.ttsTestKey(key) },
      { id: 'cap-elevenlabs', kind: 'captions', label: t('services.caption_transcription'), test: key => window.api.testCaptionsCloud('elevenlabs', key || undefined) },
    ] },
    { id: 'groq', name: 'Groq', slots: [{ id: 'cap-groq', kind: 'captions', label: t('services.caption_transcription'), test: key => window.api.testCaptionsCloud('groq', key || undefined) }] },
    { id: 'claude', name: 'Anthropic Claude', slots: [] },
    { id: 'openrouter', name: 'OpenRouter', slots: [] },
    { id: 'deepgram', name: 'Deepgram', url: 'https://console.deepgram.com', slots: [{ id: 'cap-deepgram', kind: 'captions', label: t('services.caption_transcription'), test: key => window.api.testCaptionsCloud('deepgram', key || undefined) }] },
    { id: 'pixabay', name: 'Pixabay', url: 'https://pixabay.com/api/docs/', slots: [{ id: 'pixabay', kind: 'stock', label: t('services.stock_photos_and_videos'), keyLabel: t('services.pixabay_api_key'), test: key => window.api.stockTest(key) }] },
    { id: 'soundza', name: 'Soundza', url: 'https://soundza.com/developers/keys', slots: [{ id: 'soundza', kind: 'sfx', label: t('services.sound_effects'), keyLabel: t('services.soundza_api_key'), test: key => window.api.soundzaTest(key) }] },
    { id: 'custom', name: t('services.custom_assistant_service'), slots: [] },
  ];
  // Any other assistant provider that stores a key (a preset row such as xAI, Mistral or DeepSeek) gets its own group.
  for (const p of providers) if (p.needsKey && !groups.some(g => g.id === p.id)) groups.splice(groups.findIndex(g => g.id === 'custom'), 0, { id: p.id, name: t(`providers.${p.id}.name`), slots: [] });
  return groups.map(group => {
    const assistant = providers.find(p => p.id === group.id && p.needsKey);
    return { ...group, url: group.url || assistant?.keyUrl,
      slots: [...(assistant ? [{ id: `assistant:${group.id}`, kind: 'assistant', label: t('settings.assistant'), provider: group.id }] : []), ...group.slots]
        .map(slot => ({ ...slot, keyLabel: slot.keyLabel || t('services.provider_feature_api_key', { provider: group.name, feature: slot.label.toLocaleLowerCase() }) })) };
  });
}
const hintFor = (saved, slot) => slot.provider ? saved.keys?.[slot.provider] : saved.serviceKeys?.[slot.id];

function Credential({ slot, saved, onSaved, onNavigate }) {
  const [key, setKey] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState('');
  const [result, setResult] = useState(null);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const hint = hintFor(saved, slot);
  const run = async action => {
    setBusy(action); setResult(null);
    try {
      const value = key.trim();
      if (action === 'test') {
        const response = slot.provider
          ? await window.api.aiTest({ provider: slot.provider, model: saved.models?.[slot.provider] || saved.defaultModels?.[slot.provider], baseUrl: saved.baseUrls?.[slot.provider] || '', apiKey: value })
          : await slot.test(value);
        if (alive.current) setResult({ ok: !!response.ok, text: response.text || response.error || (response.ok ? (value ? t('services.key_accepted_save_it_to_use_it') : t('services.key_accepted')) : t('services.the_connection_test_failed')) });
      } else {
        const response = action === 'remove'
          ? await (slot.provider ? window.api.settingsClearKey(slot.provider) : window.api.settingsClearServiceKey(slot.id))
          : await (slot.provider ? window.api.settingsSaveProviderKey(slot.provider, value) : window.api.settingsSaveServiceKey(slot.id, value));
        if (response?.ok === false) throw Error(response.error || t('services.the_key_could_not_be_saved'));
        onSaved(response.settings || response);
        if (alive.current) { setKey(''); setShow(false); setResult({ ok: true, text: action === 'remove' ? t('services.key_removed') : t('services.key_saved_message') }); }
      }
    } catch (error) { if (alive.current) setResult({ ok: false, text: error.message }); }
    finally { if (alive.current) setBusy(''); }
  };
  return <div className="connection-credential" data-service-key={slot.id}>
    <div className="connection-usage"><b>{slot.label}</b><span className={hint ? 'key-ok' : 'muted'}>{hint ? <><ShieldCheck size={13} /> {t('services.saved_hint', { hint })}</> : t('services.no_key_saved')}</span></div>
    <label className="field"><span>{slot.keyLabel}</span><div className="key-row">
      <input type={show ? 'text' : 'password'} value={key} autoComplete="off" spellCheck={false} disabled={!!busy} aria-label={slot.keyLabel}
        placeholder={hint ? t('services.paste_a_replacement_key') : t('services.paste_your_api_key')} onChange={e => { setKey(e.target.value); setResult(null); }} />
      <button className="icon-btn" disabled={!!busy || !key} aria-label={show ? t('services.hide_pasted_key') : t('services.show_pasted_key')} title={show ? t('services.hide_pasted_key') : t('services.show_pasted_key')} onClick={() => setShow(!show)}>{show ? <EyeOff size={15} /> : <Eye size={15} />}</button>
      {hint && <button className="icon-btn" disabled={!!busy} aria-label={t('services.delete_saved_key', { key: slot.keyLabel })} title={t('services.remove_saved_key')} onClick={() => run('remove')}><Trash2 size={15} /></button>}
    </div></label>
    {result && <div className={`result ${result.ok ? 'ok' : 'bad'}`} role="status">{result.ok ? <CircleCheck size={15} /> : <CircleAlert size={15} />}<span>{result.text}</span></div>}
    <div className="settings-actions">
      {slot.provider && <button className="btn btn-sm btn-ghost" onClick={() => onNavigate('ai', slot.provider)}>{t('services.assistant_settings')}</button>}
      <button className="btn btn-sm" disabled={!!busy || (!key.trim() && !hint)} onClick={() => run('test')}>{busy === 'test' && <Loader2 size={13} className="spin" />}{t('services.test_key')}</button>
      <button className="btn btn-sm btn-primary" disabled={!!busy || !key.trim()} onClick={() => run('save')}>{busy === 'save' && <Loader2 size={13} className="spin" />}{t('services.save_key')}</button>
    </div>
  </div>;
}

export default function ServiceConnections({ saved, onSaved, providers, target, onNavigate }) {
  const catalog = connections(providers);
  const targetGroup = catalog.find(g => g.id === target || g.slots.some(s => s.id === target))?.id || '';
  const [open, setOpen] = useState(targetGroup);
  const [search, setSearch] = useState('');
  const root = useRef(null);
  useEffect(() => { setOpen(targetGroup); setSearch(''); }, [targetGroup, target]);
  useEffect(() => {
    if (open && targetGroup === open) root.current?.querySelector(catalog.some(g => g.slots.some(s => s.id === target)) ? `[data-service-key="${target}"]` : `[data-connection="${open}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [open, targetGroup, target]);
  const query = search.trim().toLowerCase();
  // Search aliases by slot kind (English search terms, next to the displayed labels).
  const aliases = { assistant: 'assistant chat models', voice: 'voice generation speech text to speech tts narration', captions: 'caption transcription captions subtitles speech to text stt', stock: 'stock photos videos media libraries images b-roll', sfx: 'sound effects media libraries audio sounds sfx' };
  const shown = catalog.filter(g => `${g.name} ${g.slots.map(s => `${s.label} ${s.keyLabel} ${aliases[s.kind] || ''}`).join(' ')}`.toLowerCase().includes(query));
  return <div ref={root} className="service-connections">
    <SearchBox value={search} onChange={setSearch} placeholder={t('services.search_services_or_features')} ariaLabel={t('services.search_api_services')} />
    <p className="set2-note">{t('services.keys_are_stored_encrypted_on_this_computer')}</p>
    {shown.map(group => {
      const count = group.slots.filter(s => hintFor(saved, s)).length;
      return <section className="settings-section connection-card" key={group.id} data-connection={group.id}>
        <button className="connection-toggle" aria-expanded={open === group.id} onClick={() => setOpen(open === group.id ? '' : group.id)}>
          <span><b>{group.name}</b><small>{group.slots.map(s => s.label).join(' · ')}</small></span><span className={`connection-status ${count ? 'saved' : ''}`}>{count ? group.slots.length === 1 ? t('services.key_saved') : t('services.count_of_total_keys_saved', { count, total: group.slots.length }) : t('services.not_set_up')}</span><ChevronDown size={15} />
        </button>
        {open === group.id && <div className="connection-details">
          {group.url && <button className="btn btn-sm btn-ghost link-btn" onClick={() => window.api.openHelp(group.url)}><ExternalLink size={13} />{t('services.get_a_provider_api_key', { provider: group.name })}</button>}
          {group.slots.length > 1 && <p className="set2-note">{t('services.add_a_key_for_the_feature_you_use_you_may')}</p>}
          {group.slots.map(slot => <Credential key={slot.id} slot={slot} saved={saved} onSaved={onSaved} onNavigate={onNavigate} />)}
        </div>}
      </section>;
    })}
    {!shown.length && <p className="empty-note">{t('services.no_services_match_query', { query: search })}</p>}
    <SettingsGroup label={t('services.no_api_key_needed')} hint={t('services.openverse_and_sfxmint_work_without_a_key')} />
  </div>;
}
