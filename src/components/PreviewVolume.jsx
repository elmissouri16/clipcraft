import React, { useEffect, useRef, useState } from 'react';
import { Volume1, Volume2, VolumeX } from 'lucide-react';
import { getPreviewAudio, setPreviewAudio, subscribePreviewAudio } from '../audioTap.js';

export default function PreviewVolume({ onOpen }) {
  const [audio, setAudio] = useState(getPreviewAudio);
  const [open, setOpen] = useState(false);
  const root = useRef(null);
  const button = useRef(null);
  const slider = useRef(null);
  useEffect(() => subscribePreviewAudio(() => setAudio(getPreviewAudio())), []);
  useEffect(() => {
    if (!open) return;
    slider.current?.focus();
    const outside = (event) => { if (!root.current?.contains(event.target)) setOpen(false); };
    document.addEventListener('mousedown', outside);
    return () => document.removeEventListener('mousedown', outside);
  }, [open]);
  const silent = audio.muted || audio.volume === 0;
  const percent = Math.round(audio.volume * 100);
  const Icon = silent ? VolumeX : audio.volume < 0.5 ? Volume1 : Volume2;
  return (
    <span ref={root} className="preview-volume transport-menu-wrap" onKeyDown={(event) => {
      if (['Space', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.code)) event.stopPropagation();
      if (open && event.key === 'Escape') {
        event.preventDefault(); event.stopPropagation(); setOpen(false); button.current?.focus();
      }
    }}>
      <button ref={button} type="button" className={`icon-btn ${silent ? 'active' : ''}`}
        aria-label="Preview volume" aria-haspopup="dialog" aria-expanded={open}
        title={`Preview volume: ${silent ? 'muted' : `${percent}%`}`} onClick={() => { if (!open) onOpen?.(); setOpen((value) => !value); }}>
        <Icon size={16} />
      </button>
      {open && (
        <div className="transport-menu preview-volume-menu" role="dialog" aria-label="Preview audio">
          <div className="preview-volume-heading"><b>Preview volume</b><output>{silent ? 'Muted' : `${percent}%`}</output></div>
          <div className="preview-volume-row">
            <button type="button" className="icon-btn" aria-label={silent ? 'Unmute preview' : 'Mute preview'} aria-pressed={silent}
              onClick={() => setPreviewAudio(silent ? { muted: false, volume: audio.volume || 1 } : { muted: true })}>
              <Icon size={16} />
            </button>
            <input ref={slider} type="range" min="0" max="100" step="1" value={percent}
              aria-label="Preview volume level" aria-valuetext={`${percent}%${audio.muted ? ', muted' : ''}`}
              onChange={(event) => setPreviewAudio({ volume: Number(event.target.value) / 100, muted: false })} />
          </div>
        </div>
      )}
    </span>
  );
}
