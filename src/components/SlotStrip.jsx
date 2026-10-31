import React, { useState } from 'react';
import { ChevronDown, ChevronUp, Repeat } from 'lucide-react';
import { toFileUrl } from '../store.js';

// The replaceable clips of a template, over the timeline (like CapCut): click one, pick your video or photo, it
// takes the slot's place and length. slots: from slotList().
export default function SlotStrip({ slots, media, selection, onPick, onReplace, title }) {
  const [hidden, setHidden] = useState(false);
  const filled = slots.filter((s) => s.clip.filled).length;
  if (hidden) {
    return (
      <button className="ts-show" onClick={() => setHidden(false)} title="Show the replaceable clips">
        <Repeat size={13} /> {filled} / {slots.length} replaced <ChevronUp size={13} />
      </button>
    );
  }
  return (
    <div className="ts-strip" role="region" aria-label="Replaceable clips">
      <div className="ts-head">
        <span><b>{title || 'Template'}</b> · click a clip, then pick your video · {filled} / {slots.length} replaced</span>
        <button className="btn btn-ghost btn-sm" onClick={() => setHidden(true)}><ChevronDown size={13} /> Hide</button>
      </div>
      <div className="ts-list">
        {slots.map((s, i) => {
          const m = media.find((x) => x.id === s.clip.mediaId);
          const on = selection?.track === s.track && selection?.id === s.clip.id;
          const pic = m?.type === 'image' ? toFileUrl(m.path) : null;
          return (
            <div key={s.clip.id} className={`ts-slot ${on ? 'on' : ''} ${s.clip.filled ? 'filled' : ''}`}>
              <button className="ts-thumb" onClick={() => onPick(s)} title={`Clip ${i + 1}: ${s.duration.toFixed(1)} s`}
                style={m?.thumb ? { backgroundImage: `url("${toFileUrl(m.thumb)}")`, backgroundSize: `${(m.thumbCount || 1) * 100}% 100%` } : undefined}>
                {pic && <img src={pic} alt="" draggable={false} />}
                {!m?.thumb && !pic && m?.type === 'video' && <video src={`${toFileUrl(m.path)}#t=${(s.clip.in || 0) + 0.1}`} preload="metadata" muted />}
                <span className="ts-num">{i + 1}</span>
              </button>
              <button className="btn btn-sm ts-replace" onClick={() => onReplace(s)}><Repeat size={12} /> {s.clip.filled ? 'Change' : 'Replace'}</button>
              <span className="ts-dur">{s.duration < 10 ? s.duration.toFixed(1) : Math.round(s.duration)}s</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
