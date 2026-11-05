import React, { useEffect, useRef, useState } from 'react';
import { Music, Pause, Play, Plus, X } from 'lucide-react';
import { formatTime, previewPath, toFileUrl } from '../store.js';
import { applyElementVolume, resumeAudioGraph, subscribePreviewAudio, wireElement } from '../audioTap.js';
import PreviewVolume from './PreviewVolume.jsx';

// Watches a media item from the Media panel before it is on the timeline: click a card and it
// plays in the player at its own shape (tall stays tall, wide stays wide). Space plays / pauses, ← / → step a
// frame, Esc or × goes back to the project.
export default function MediaPeek({ m, fps = 30, onClose, onAdd }) {
  const el = useRef(null);
  const scrubRef = useRef(null);
  const tcRef = useRef(null);
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const still = m.type === 'image';
  const dur = still ? 0 : m.duration || 0;

  useEffect(() => {
    setT(0);
    setPlaying(!still);
  }, [m.id]);
  useEffect(() => {
    const v = el.current;
    if (!v || still) return;
    wireElement(v);
    applyElementVolume(v, 1);
    if (playing) { resumeAudioGraph(); v.play().catch(() => setPlaying(false)); }
    else v.pause();
  }, [playing, m.id]);
  useEffect(() => subscribePreviewAudio(() => applyElementVolume(el.current, 1)), []);

  // Smooth progress: while playing, a rAF loop paints the scrub fill and the clock straight
  // from the media element (the element is the clock here) — timeupdate alone fires ~4×/s
  // and made the indicator advance in visible steps.
  useEffect(() => {
    const v = el.current;
    if (!v || still) return undefined;
    const paint = () => {
      const ct = v.currentTime || 0;
      if (scrubRef.current) {
        scrubRef.current.value = ct;
        scrubRef.current.style.setProperty('--p', `${dur ? (ct / dur) * 100 : 0}%`);
      }
      if (tcRef.current) tcRef.current.textContent = formatTime(ct);
    };
    if (!playing) { paint(); return undefined; }
    let raf = 0;
    const loop = () => { raf = requestAnimationFrame(loop); paint(); };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [playing, m.id, still, dur]);

  const seek = (to) => {
    const x = Math.max(0, Math.min(dur, to));
    if (el.current && !still) el.current.currentTime = x;
    setT(x);
  };
  const keys = useRef({});
  keys.current = { seek, t, onClose };
  useEffect(() => {
    // Capture phase, so the project's own shortcuts (Space plays the timeline) don't also run.
    const onKey = (e) => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName) || e.target.isContentEditable) return;
      const volumeControl = e.target.closest('.preview-volume');
      if (volumeControl && (e.key !== 'Escape' || volumeControl.querySelector('[role=dialog]'))) return;
      const k = keys.current;
      if (e.code === 'Space') setPlaying((p) => !p);
      else if (e.key === 'Escape') k.onClose();
      else if (e.key === 'ArrowLeft') { setPlaying(false); k.seek(k.t - 1 / fps); }
      else if (e.key === 'ArrowRight') { setPlaying(false); k.seek(k.t + 1 / fps); }
      else return;
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [fps]);

  const w = m.width || 16;
  const h = m.height || 9;
  const src = toFileUrl(previewPath(m));
  return (
    <div className="peek">
      <div className="stage-wrap">
        <div className="stage peek-stage" style={{ aspectRatio: `${w} / ${h}`, width: `min(100cqw, calc(100cqh * ${w / h}))` }}>
          {still ? <img src={src} alt="" draggable={false} /> : (
            <video ref={el} src={src} playsInline preload="auto" style={m.type === 'audio' ? { display: 'none' } : undefined}
              onTimeUpdate={(e) => setT(e.currentTarget.currentTime)} onEnded={() => setPlaying(false)} />
          )}
          {m.type === 'audio' && (
            <div className="peek-audio">
              {m.wave ? <img src={toFileUrl(m.wave)} alt="" draggable={false} /> : <Music size={40} aria-hidden="true" />}
            </div>
          )}
        </div>
      </div>
      {!still && (
        <input ref={scrubRef} className="peek-scrub" type="range" min={0} max={dur} step={1 / fps} value={t} aria-label="Position"
          style={{ '--p': `${dur ? (t / dur) * 100 : 0}%` }}
          onChange={(e) => seek(Number(e.target.value))} />
      )}
      <div className="transport">
        <span className="tc peek-name" title={m.name}>
          {still ? <b>{m.name}</b> : <><b ref={tcRef}>{formatTime(t)}</b><span> / {formatTime(dur)}</span></>}
        </span>
        <div className="transport-btns">
          {!still && (
            <button className="play-btn" onClick={() => setPlaying((p) => !p)} aria-label={playing ? 'Pause (Space)' : 'Play (Space)'} title="Space">
              {playing ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}
            </button>
          )}
        </div>
        <span className="tc-spacer peek-actions">
          {!still && <PreviewVolume />}
          <button className="btn btn-primary btn-sm" onClick={() => onAdd(m)} title="Add to the timeline at the playhead"><Plus size={14} /> Add</button>
          <button className="icon-btn" onClick={onClose} aria-label="Back to the project (Esc)" title="Back to the project (Esc)"><X size={16} /></button>
        </span>
      </div>
    </div>
  );
}
