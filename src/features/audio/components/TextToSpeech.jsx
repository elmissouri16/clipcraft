import React, { useEffect, useRef, useState } from 'react';
import { CheckCircle2, ExternalLink, KeyRound, Loader2, Pause, Play, Plus, RefreshCw, Type, Unplug } from 'lucide-react';
import { toFileUrl } from "../../../state/store.js";
import { defaultSpeech, studioVoicesOf } from "../voiceDefault.js";
import { formatDate, formatNumber, rich, t } from '../../../i18n/index.js';

// Sign-up page for new ElevenLabs accounts.
export const ELEVENLABS_SIGNUP_URL = 'https://elevenlabs.io';
// Where to get VoiceStudio, the free voice app ClipCraft can connect to (Settings > Voice).
export const VOICESTUDIO_URL = 'https://github.com/debpalash/VoiceStudio';

// A voice's descriptive word from the catalogs (gender, language, licence, Gemini style): translated when
// the dictionary knows it (tts.voice_<slug>), otherwise shown as the catalog gives it.
export function voiceWord(word) {
  const key = `tts.voice_${String(word || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')}`;
  const out = t(key);
  return out === key ? word : out;
}

// Audio > Text to speech. Online engines use keys stored in Settings.
export default function TextToSpeech({ onAdd, selectedText, onOpenSettings, settingsVersion }) {
  const [engine, setEngine] = useState('gemini');
  const [status, setStatus] = useState(null); // The VoiceStudio connector, online-key presence and Gemini catalog.
  const [eleven, setEleven] = useState({ voices: [], loading: false, error: '' });
  const [usage, setUsage] = useState(null); // ElevenLabs credits: { used, limit, left, resetsAt }
  const [voice, setVoice] = useState({ voicestudio: '', eleven: '', gemini: 'Kore' });
  const [geminiModel, setGeminiModel] = useState('');
  const [delivery, setDelivery] = useState('');
  const [text, setText] = useState('');
  const [speed, setSpeed] = useState(1);
  const [busy, setBusy] = useState(null); // 'preview' | 'add'
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState('');
  const [playing, setPlaying] = useState(false);
  const audio = useRef(null);

  const refresh = () => window.api.ttsStatus().then((st) => { setStatus(st); return st; }).catch((e) => setError(e.message));
  // Opening (and coming back from Settings) starts on the default voice (Settings > Voice > Default voice).
  useEffect(() => {
    refresh().then((st) => {
      const d = st && defaultSpeech(st);
      if (!d?.engine) return;
      setEngine(d.engine);
      if (d.voice) setVoice((v) => ({ ...v, [d.engine]: d.voice }));
    });
  }, [settingsVersion]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    audio.current = new Audio();
    audio.current.onended = () => setPlaying(false);
    const off = window.api.onTtsProgress(setProgress);
    return () => { off(); audio.current.pause(); };
  }, []);
  useEffect(() => {
    if (engine !== 'eleven' || !status?.elevenKey || eleven.voices.length) return;
    setEleven({ voices: [], loading: true, error: '' });
    window.api.ttsElevenVoices().then((r) => {
      setEleven({ voices: r.voices || [], loading: false, error: r.error || '' });
      if (r.voices?.length) setVoice((v) => ({ ...v, eleven: v.eleven || r.voices[0].id }));
    });
  }, [engine, status]); // eslint-disable-line react-hooks/exhaustive-deps
  const refreshUsage = () => window.api.ttsElevenUsage().then((r) => setUsage(r.usage || null));
  useEffect(() => {
    if (engine === 'eleven' && status?.elevenKey) refreshUsage();
  }, [engine, status?.elevenKey]);

  const voiceId = voice[engine];
  const voiceName = engine === 'eleven' ? eleven.voices.find((v) => v.id === voiceId)?.name
    : engine === 'gemini' ? voiceId : studioVoicesOf(status).find((v) => v.id === voiceId)?.name;
  const speak = async (mode) => {
    setError('');
    setBusy(mode);
    setProgress(null);
    let res;
    try {
      res = await window.api.ttsSpeak({ engine, voiceId, voiceName, text, speed: engine === 'gemini' ? 1 : speed,
        ...(engine === 'gemini' ? { model: geminiModel || status.gemini.defaultModel, style: delivery } : engine === 'voicestudio' ? { style: delivery } : {}) });
    } catch (e) { res = { error: e.message }; }
    setBusy(null);
    setProgress(null);
    refresh();
    if (engine === 'eleven') refreshUsage();
    if (res.error) return setError(res.error);
    if (mode === 'preview') {
      audio.current.src = toFileUrl(res.path);
      audio.current.play().catch(() => {});
      setPlaying(true);
    } else onAdd(res, !!selectedText && text.trim() === selectedText.text.trim());
  };

  // VoiceStudio is a separate app: its voices are offered while the connector (Settings > Voice) is on and it answers.
  const studioVoices = studioVoicesOf(status);
  const studioMissing = engine === 'voicestudio' && status && !studioVoices.length;
  useEffect(() => {
    if (studioVoices.length && !studioVoices.some((v) => v.id === voice.voicestudio)) setVoice((v) => ({ ...v, voicestudio: studioVoices[0].id }));
  }, [studioVoices.map((v) => v.id).join()]); // eslint-disable-line react-hooks/exhaustive-deps
  const needKey = status && ((engine === 'eleven' && !status.elevenKey) || (engine === 'gemini' && !status.geminiKey));
  const studioWhy = !status?.studio?.enabled ? 'off' : !status.studio.running ? 'down' : 'empty';
  // A "Describe a voice" entry (a voice-design engine such as Qwen3-TTS) builds the voice from the Style text.
  const studioVoice = studioVoices.find((v) => v.id === voice.voicestudio);
  const styleRequired = engine === 'voicestudio' && studioVoice?.kind === 'design';
  const ready = status && text.trim() && voiceId && !needKey && !studioMissing && !busy && !(styleRequired && !delivery.trim());
  return (
    <div className="tts">
      <div className="tab-title">{t('tts.text_to_speech')}</div>
      <div className="seg-tabs small" role="tablist" aria-label={t('tts.voice_engine')}>
        {[['gemini', 'Gemini'], ['voicestudio', t('tts.voicestudio_local')], ['eleven', 'ElevenLabs']].map(([id, name]) => (
          <button key={id} role="tab" aria-selected={engine === id} className={engine === id ? 'on' : ''} disabled={!!busy} onClick={() => { setEngine(id); setError(''); }}>{name}</button>
        ))}
      </div>

      <label className="field">
        <span>{t('tts.text')}
          {selectedText && (
            <button className="btn btn-ghost btn-sm" type="button" onClick={() => setText(selectedText.text)}><Type size={13} /> {t('tts.use_selected_text')}</button>
          )}
        </span>
        <textarea rows={5} dir="auto" value={text} maxLength={5000} placeholder={t('tts.type_what_the_voice_should_say')} onChange={(e) => setText(e.target.value)} />
        <small className="muted">{text.length} / 5000</small>
      </label>

      {engine === 'voicestudio' ? (studioMissing ? (
        <div className="card stock-key" data-studio-missing={studioWhy}>
          <div className="card-row">
            <span className="card-icon"><Unplug size={18} /></span>
            <div><b>{studioWhy === 'off' ? t('tts.voicestudio_is_off') : studioWhy === 'down' ? t('tts.voicestudio_is_not_running') : t('tts.voicestudio_lists_no_voice')}</b>
              <p>{studioWhy === 'off' ? t('tts.voicestudio_is_a_free_app_install_it_then')
                : studioWhy === 'down' ? (status.studio.error || t('tts.open_voicestudio_then_try_again'))
                : t('tts.create_a_voice_profile_in_voicestudio')}</p></div>
          </div>
          <div className="stock-key-actions">
            {studioWhy === 'off'
              ? <button className="btn btn-primary btn-sm" onClick={() => onOpenSettings?.('speech')}>{t('pilot.open_settings')}</button>
              : <button className="btn btn-primary btn-sm" onClick={() => { setError(''); refresh(); }}><RefreshCw size={13} /> {t('tts.check_again')}</button>}
            <button className="btn btn-ghost btn-sm" onClick={() => window.api.openHelp(VOICESTUDIO_URL)}><ExternalLink size={13} /> {t('tts.get_voicestudio')}</button>
          </div>
        </div>
      ) : (
        <>
          <label className="field">
            <span>{t('settings.voice')}</span>
            <select value={voice.voicestudio} aria-label={t('settings.voice')} disabled={!!busy} onChange={(e) => setVoice((v) => ({ ...v, voicestudio: e.target.value }))}>
              {studioVoices.map((v) => (
                <option key={v.id} value={v.id}>{v.name}{v.language ? ` · ${v.language}` : ''}{v.kind === 'default' && status.studio.engine ? ` · ${status.studio.engine}` : ''}</option>
              ))}
            </select>
            <small className="muted">{t('tts.voices_come_from_voicestudio')}</small>
          </label>
          <label className="field">
            <span>{styleRequired ? t('tts.style') : t('tts.style_optional')}</span>
            <input type="text" aria-label={t('tts.speech_style')} value={delivery} maxLength={200} disabled={!!busy} required={styleRequired}
              placeholder={styleRequired ? t('tts.e_g_a_sad_woman_almost_crying_speaking_slowly') : status.studio.activeEngine === 'omnivoice' ? t('tts.e_g_female_young_adult_low_pitch_whisper') : t('tts.e_g_calm_warm_narrator')} onChange={(e) => setDelivery(e.target.value)} />
            {styleRequired && !delivery.trim() ? <small className="error-text">{t('tts.describe_the_voice_first_this_engine_needs')}</small>
              : <small className="muted">{styleRequired ? t('tts.this_voice_is_built_from_the_style_text')
                : status.studio.activeEngine === 'omnivoice' && studioVoice?.kind !== 'profile' ? t('tts.style_takes_voice_design_tags_only')
                : t('tts.passed_to_voicestudios_engine_some_ignore')}</small>}
          </label>
        </>
      )) : needKey ? (
        <div className="card stock-key">
          <div className="card-row">
            <span className="card-icon"><KeyRound size={18} /></span>
            <div><b>{engine === 'gemini' ? t('tts.gemini_tts_key_needed') : t('tts.elevenlabs_key_needed')}</b>
              <p>{engine === 'gemini' ? t('tts.add_a_gemini_voice_key_in_settings') : t('tts.add_an_elevenlabs_voice_key_in_settings')}</p></div>
          </div>
          <div className="stock-key-actions">
            <button className="btn btn-sm" onClick={() => onOpenSettings?.(`services:${engine === 'gemini' ? 'gemini-tts' : 'elevenlabs'}`)}>{t('settings.add_api_key')}</button>
            <button className="btn btn-ghost btn-sm" onClick={() => window.api.openHelp(engine === 'gemini' ? 'https://aistudio.google.com/app/apikey' : ELEVENLABS_SIGNUP_URL)}>
              <ExternalLink size={13} /> {engine === 'gemini' ? t('tts.get_a_gemini_key') : t('tts.create_a_free_account')}</button>
          </div>
        </div>
      ) : engine === 'gemini' ? (
        <>
          <label className="field">
            <span>{t('tts.speech_model')}</span>
            <select aria-label={t('tts.gemini_speech_model')} value={geminiModel || status?.gemini?.defaultModel || ''} disabled={!!busy}
              onChange={(e) => setGeminiModel(e.target.value)}>
              {(status?.gemini?.models || []).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </label>
          <label className="field">
            <span>{t('settings.voice')}</span>
            <select aria-label={t('tts.gemini_voice')} value={voice.gemini} disabled={!!busy} onChange={(e) => setVoice((v) => ({ ...v, gemini: e.target.value }))}>
              {(status?.gemini?.voices || []).map((v) => <option key={v.id} value={v.id}>{v.name} · {voiceWord(v.style)}</option>)}
            </select>
          </label>
          <label className="field">
            <span>{t('tts.delivery_optional')}</span>
            <textarea aria-label={t('tts.speech_delivery')} rows={2} value={delivery} maxLength={1000} disabled={!!busy}
              placeholder={t('tts.calm_documentary_narrator_warm_tone_speaki')} onChange={(e) => setDelivery(e.target.value)} />
            <small className="muted">{t('tts.describe_tone_accent_and_pacing_here_only')}</small>
          </label>
        </>
      ) : (
        <label className="field">
          <span>{t('settings.voice')} {eleven.loading && <Loader2 size={13} className="spin" />}</span>
          <select value={voice.eleven} aria-label={t('tts.elevenlabs_voice')} onChange={(e) => setVoice((v) => ({ ...v, eleven: e.target.value }))}>
            {eleven.voices.map((v) => <option key={v.id} value={v.id}>{v.name}{v.gender ? ` (${v.gender}${v.accent ? `, ${v.accent}` : ''})` : ''}</option>)}
          </select>
          {eleven.error && <span className="error-text">{eleven.error}</span>}
          {usage && usage.limit > 0 && (
            <small className={usage.left < text.length || usage.left / usage.limit < 0.1 ? 'error-text' : 'muted'}>
              {rich('tts.credits_left', { left: formatNumber(usage.left), limit: formatNumber(usage.limit) })}
              {usage.resetsAt ? ` · ${t('tts.renews_on', { date: formatDate(usage.resetsAt, { month: 'short', day: 'numeric' }) })}` : ''}
              {usage.left < text.length ? ` · ${t('tts.not_enough_for_this_text')}` : ''}
            </small>
          )}
          <small className="muted">{t('tts.model_eleven_multilingual_v2_29_languages')}</small>
        </label>
      )}

      {engine !== 'gemini' && <label className="field">
        <span>{t('tts.speed')} <b>{speed.toFixed(2)}×</b></span>
        <input type="range" min={engine === 'eleven' ? 0.7 : 0.5} max={engine === 'eleven' ? 1.2 : 2} step="0.05" value={speed} aria-label={t('tts.speed')}
          onChange={(e) => setSpeed(Number(e.target.value))} />
      </label>}

      {progress && busy && (
        <div className="lib-loading"><Loader2 size={15} className="spin" />
          {progress.stage === 'wait' ? t('tts.gemini_rate_limit_waiting', { seconds: Math.ceil(progress.seconds || 0) })
            : progress.stage === 'speech' ? t('tts.generating_speech_with_gemini')
            : progress.stage === 'studio' ? t('tts.speaking_with_voicestudio_first_request')
            : t('tts.speaking')}
        </div>
      )}
      {error && <p className="error-text">{error}</p>}

      <div className="row-btns">
        <button className="btn" disabled={!ready && !playing} onClick={() => (playing ? (audio.current.pause(), setPlaying(false)) : speak('preview'))}>
          {busy === 'preview' ? <Loader2 size={14} className="spin" /> : playing ? <Pause size={14} /> : <Play size={14} />} {playing ? t('pilot.stop') : t('tts.preview')}
        </button>
        <button className="btn btn-primary" disabled={!ready} onClick={() => speak('add')}>
          {busy === 'add' ? <Loader2 size={14} className="spin" /> : <Plus size={14} />} {t('tts.add_to_timeline')}
        </button>
      </div>
      <p className="lib-note">
        <CheckCircle2 size={12} /> {selectedText ? t('tts.voice_goes_at_playhead_or_selected_text') : t('tts.voice_goes_at_playhead')} {t('tts.same_text_reused_from_cache')}
      </p>
    </div>
  );
}
