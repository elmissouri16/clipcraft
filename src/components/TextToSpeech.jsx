import React, { useEffect, useRef, useState } from 'react';
import { CheckCircle2, ExternalLink, KeyRound, Loader2, Pause, Play, Plus, Type } from 'lucide-react';
import { toFileUrl } from '../store.js';

// Sign-up page for new ElevenLabs accounts.
export const ELEVENLABS_SIGNUP_URL = 'https://elevenlabs.io';

// Audio > Text to speech: a free voice that runs on this PC (Piper) or an ElevenLabs voice (the user's key).
export default function TextToSpeech({ onAdd, selectedText, onOpenSettings }) {
  const [engine, setEngine] = useState('piper');
  const [status, setStatus] = useState(null); // { voices, installed, elevenKey }
  const [eleven, setEleven] = useState({ voices: [], loading: false, error: '' });
  const [usage, setUsage] = useState(null); // ElevenLabs credits: { used, limit, left, resetsAt }
  const [voice, setVoice] = useState({ piper: 'en_US-joe-medium', eleven: '' });
  const [text, setText] = useState('');
  const [speed, setSpeed] = useState(1);
  const [busy, setBusy] = useState(null); // 'preview' | 'add'
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState('');
  const [playing, setPlaying] = useState(false);
  const audio = useRef(null);

  const refresh = () => window.api.ttsStatus().then(setStatus);
  useEffect(() => {
    refresh();
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
  const voiceName = engine === 'eleven' ? eleven.voices.find((v) => v.id === voiceId)?.name : status?.voices.find((v) => v.id === voiceId)?.name;
  const speak = async (mode) => {
    setError('');
    setBusy(mode);
    setProgress(null);
    const res = await window.api.ttsSpeak({ engine, voiceId, voiceName, text, speed });
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

  const needKey = engine === 'eleven' && status && !status.elevenKey;
  const ready = text.trim() && voiceId && !needKey && !busy;
  const selected = status?.voices.find((v) => v.id === voice.piper);
  return (
    <div className="tts">
      <div className="tab-title">Text to speech</div>
      <div className="seg-tabs small" role="tablist" aria-label="Voice engine">
        {[['piper', 'Free · on this PC'], ['eleven', 'ElevenLabs']].map(([id, name]) => (
          <button key={id} role="tab" aria-selected={engine === id} className={engine === id ? 'on' : ''} onClick={() => setEngine(id)}>{name}</button>
        ))}
      </div>

      <label className="field">
        <span>Text
          {selectedText && (
            <button className="btn btn-ghost btn-sm" type="button" onClick={() => setText(selectedText.text)}><Type size={13} /> Use selected text</button>
          )}
        </span>
        <textarea rows={5} dir="auto" value={text} maxLength={5000} placeholder="Type what the voice should say…" onChange={(e) => setText(e.target.value)} />
        <small className="muted">{text.length} / 5000</small>
      </label>

      {engine === 'piper' ? (
        <label className="field">
          <span>Voice</span>
          <select value={voice.piper} aria-label="Voice" onChange={(e) => setVoice((v) => ({ ...v, piper: e.target.value }))}>
            {(status?.voices || []).map((v) => (
              <option key={v.id} value={v.id}>{v.lang} · {v.name} ({v.gender}){v.downloaded ? ' ✓' : ''}</option>
            ))}
          </select>
          {selected && (
            <small className="muted">
              Licence: {selected.license}. {selected.downloaded ? 'Downloaded.' : 'First use downloads the voice (about 60 MB)'}
              {!status.installed && !selected.downloaded ? ' and the free Piper engine (about 22 MB).' : selected.downloaded ? '' : '.'}
            </small>
          )}
        </label>
      ) : needKey ? (
        <div className="card stock-key">
          <div className="card-row">
            <span className="card-icon"><KeyRound size={18} /></span>
            <div><b>ElevenLabs key needed</b><p>An ElevenLabs API key is needed to use its voices (Arabic included).</p></div>
          </div>
          <div className="stock-key-actions">
            <button className="btn btn-sm" onClick={() => window.api.openHelp(ELEVENLABS_SIGNUP_URL)}><ExternalLink size={13} /> Create a free account</button>
          </div>
        </div>
      ) : (
        <label className="field">
          <span>Voice {eleven.loading && <Loader2 size={13} className="spin" />}</span>
          <select value={voice.eleven} aria-label="ElevenLabs voice" onChange={(e) => setVoice((v) => ({ ...v, eleven: e.target.value }))}>
            {eleven.voices.map((v) => <option key={v.id} value={v.id}>{v.name}{v.gender ? ` (${v.gender}${v.accent ? `, ${v.accent}` : ''})` : ''}</option>)}
          </select>
          {eleven.error && <span className="error-text">{eleven.error}</span>}
          {usage && usage.limit > 0 && (
            <small className={usage.left < text.length || usage.left / usage.limit < 0.1 ? 'error-text' : 'muted'}>
              Credits: <b>{usage.left.toLocaleString('en-US')}</b> of {usage.limit.toLocaleString('en-US')} left
              {usage.resetsAt ? ` · renews ${new Date(usage.resetsAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : ''}
              {usage.left < text.length ? ' · not enough for this text' : ''}
            </small>
          )}
          <small className="muted">Model: Eleven Multilingual v2 (29 languages, Arabic included). The free plan requires a credit and is for non-commercial use.</small>
        </label>
      )}

      <label className="field">
        <span>Speed <b>{speed.toFixed(2)}×</b></span>
        <input type="range" min={engine === 'eleven' ? 0.7 : 0.5} max={engine === 'eleven' ? 1.2 : 2} step="0.05" value={speed} aria-label="Speed"
          onChange={(e) => setSpeed(Number(e.target.value))} />
      </label>

      {progress && busy && (
        <div className="lib-loading"><Loader2 size={15} className="spin" />
          {progress.stage === 'engine' ? `Downloading the voice engine… ${Math.round(progress.fraction * 100)}%`
            : progress.fraction < 1 ? `Downloading the voice… ${Math.round(progress.fraction * 100)}%` : 'Speaking…'}
        </div>
      )}
      {error && <p className="error-text">{error}</p>}

      <div className="row-btns">
        <button className="btn" disabled={!ready && !playing} onClick={() => (playing ? (audio.current.pause(), setPlaying(false)) : speak('preview'))}>
          {busy === 'preview' ? <Loader2 size={14} className="spin" /> : playing ? <Pause size={14} /> : <Play size={14} />} {playing ? 'Stop' : 'Preview'}
        </button>
        <button className="btn btn-primary" disabled={!ready} onClick={() => speak('add')}>
          {busy === 'add' ? <Loader2 size={14} className="spin" /> : <Plus size={14} />} Add to timeline
        </button>
      </div>
      <p className="lib-note">
        <CheckCircle2 size={12} /> The voice goes on the Audio track at the playhead{selectedText ? ', or where the selected text starts when you read it' : ''}.
        Same text and settings are reused from the cache, so trying again costs nothing.
      </p>
    </div>
  );
}
