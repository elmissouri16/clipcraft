import React, { useState } from 'react';

// Voice Enhancer controls (the section body; hosts frame it). The render itself runs in the
// main process (electron/enhance.cjs) via App's onEnhance, which drives the shared render-job
// pill (progress + working Cancel) and stores clip.enhance = { on, strength, path, from, to }.
// A stored render only counts while the clip keeps the range it was made from: after a
// re-trim the section says so and offers a re-run, and preview / export ignore the stale file.
export const ENHANCE_STRENGTHS = [['light', 'Light'], ['standard', 'Standard'], ['strong', 'Strong']];

export default function EnhanceVoice({ clip, media, set, onEnhance }) {
  const e = clip.enhance || null;
  const [strength, setStrength] = useState(e?.strength || 'standard');
  if (!media?.hasAudio) return <p className="dim small">This clip has no sound to enhance.</p>;
  const stale = !!(e?.path && (Math.abs((e.from ?? -1) - (clip.in || 0)) > 0.02 || Math.abs((e.to ?? -1) - (clip.out ?? -1)) > 0.02));
  const ready = !!(e?.path && !stale);
  const on = !!(e?.on && ready);
  const toggle = (checked) => {
    if (!checked) return set({ enhance: { ...e, on: false } });
    if (ready && e.strength === strength) return set({ enhance: { ...e, on: true } });
    return onEnhance && onEnhance(strength);
  };
  const pick = (s) => {
    setStrength(s);
    if (on || ready) onEnhance && onEnhance(s);
    else if (e) set({ enhance: { ...e, strength: s } });
  };
  return (
    <>
      <label className="field row">
        <span>Enhance voice</span>
        <input type="checkbox" className="switch" aria-label="Enhance voice" checked={on} disabled={!onEnhance && !ready}
          onChange={(ev) => toggle(ev.target.checked)} />
      </label>
      <div className="seg-tabs small" role="radiogroup" aria-label="Enhance strength">
        {ENHANCE_STRENGTHS.map(([id, name]) => (
          <button key={id} role="radio" aria-checked={strength === id} className={strength === id ? 'on' : ''}
            onClick={() => pick(id)}>{name}</button>
        ))}
      </div>
      <p className="dim small">Reduces noise and clarifies voice; processed locally on this PC. The preview and the export use the enhanced sound.</p>
      {stale && (
        <p className="dim small">The clip was trimmed after it was enhanced.
          <button type="button" className="btn btn-sm" onClick={() => onEnhance && onEnhance(strength)}>Enhance again</button>
        </p>
      )}
    </>
  );
}
