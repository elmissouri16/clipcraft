import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, X } from 'lucide-react';

// The onboarding tour: a first-launch walkthrough that spotlights the REAL interface —
// a dimmed backdrop with a cut-out over the element each step explains, a callout card
// beside it, Back / Next, a step counter, and a Skip button on every step. It starts on
// the Home screen; the step that introduces the editor opens a scratch "Tour project"
// (through App's openTourDemo, which never touches a non-empty user project). Finishing
// or skipping marks the tour seen (settings flag); About can replay it any time.
// The step index is CONTROLLED by App: the Home↔editor transition remounts this
// component (the two screens are separate trees), and the step must survive it.
export default function OnboardingTour({ onClose, goHome, openDemo, setTab, stepIndex, onStepChange }) {
  const STEPS = [
    {
      id: 'welcome', target: '.home-hero', enter: () => goHome(),
      title: 'Welcome to ClipCraft',
      text: 'This is Home. Start a new project in any frame size — 16:9 for YouTube, 9:16 for reels — and ClipCraft sets the canvas up for you.',
    },
    {
      id: 'projects', target: '.home-recents', enter: () => goHome(),
      title: 'Your projects live here',
      text: 'Projects you open or save appear here for one-click return. Your work is stored in files on this PC — nothing is uploaded anywhere.',
    },
    {
      id: 'dock', target: '.dock.tabbar', enter: () => openDemo(),
      title: 'The library dock',
      text: 'Every library is one click away: Media, Audio with the Music place, Text, Effects, Transitions, Captions, your Assets — and Forge, where CraftAI generates media for you.',
    },
    {
      id: 'media', target: '.library', enter: () => setTab('media'),
      title: 'Bring media in',
      text: 'Import videos, audio and photos here, then click or drag them onto the timeline. We opened a scratch Tour project for this walkthrough — it is only saved if you save it.',
    },
    {
      id: 'preview', target: '.player',
      title: 'The preview',
      text: 'The player shows your edit exactly as it will export. The transport underneath scrubs and plays, and sets the playback quality while you work.',
    },
    {
      id: 'timeline', target: 'section.timeline',
      title: 'The timeline',
      text: 'Clips live on layers you can lock, hide, mute and reorder. Split, trim, ripple and arrange with the tools in the timeline toolbar.',
    },
    {
      id: 'meter', target: '.meter-strip',
      title: 'The audio meter',
      text: 'This meter reads the true level of the mix you will export. Its clip lamps only light on a real over, so loud-but-clean audio stays green and amber.',
    },
    {
      id: 'inspector', target: 'aside.inspector',
      title: 'The inspector',
      text: 'Select any clip and its controls appear here — transform, blend modes, masks, colour and more, all keyframable over time.',
    },
    {
      id: 'export', target: '.btn.btn-export',
      title: 'Export when ready',
      text: 'Export renders your video from the original media, always in full quality — no watermark, no account, nothing leaves your PC.',
    },
  ];
  const idx = stepIndex;
  const setIdx = onStepChange;
  const [rect, setRect] = useState(null);
  const cardRef = useRef(null);
  const [cardSize, setCardSize] = useState({ w: 348, h: 216 });
  const step = STEPS[idx];
  const last = idx === STEPS.length - 1;

  // Run the step's stage-setting (screen / project / tab), then track its target.
  useEffect(() => { step.enter?.(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [idx]);
  useEffect(() => {
    let alive = true;
    setRect(null);
    const measure = () => {
      if (!alive) return;
      const el = document.querySelector(step.target);
      if (el) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) {
          setRect((prev) => {
            const next = { x: r.x, y: r.y, w: r.width, h: r.height };
            return prev && Math.abs(prev.x - next.x) < 1 && Math.abs(prev.y - next.y) < 1 && Math.abs(prev.w - next.w) < 1 && Math.abs(prev.h - next.h) < 1 ? prev : next;
          });
          return;
        }
      }
      setRect(null);
    };
    measure();
    const iv = setInterval(measure, 200);
    window.addEventListener('resize', measure);
    return () => { alive = false; clearInterval(iv); window.removeEventListener('resize', measure); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx]);
  useEffect(() => {
    if (cardRef.current) {
      const r = cardRef.current.getBoundingClientRect();
      if (r.width && (Math.abs(r.width - cardSize.w) > 2 || Math.abs(r.height - cardSize.h) > 2)) setCardSize({ w: r.width, h: r.height });
    }
  });

  const next = () => (last ? onClose('done') : setIdx(idx + 1));
  const back = () => setIdx(Math.max(0, idx - 1));
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose('skip'); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); next(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); e.stopPropagation(); back(); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx, last]);

  // Callout placement: under the target when it fits, above it otherwise; centred on the
  // target horizontally and clamped into the window.
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let cardStyle = { left: Math.round((vw - cardSize.w) / 2), top: Math.round((vh - cardSize.h) / 2) };
  if (rect) {
    const below = rect.y + rect.h + 14;
    const top = below + cardSize.h <= vh - 10 ? below : Math.max(10, rect.y - cardSize.h - 14);
    const left = Math.min(Math.max(10, rect.x + rect.w / 2 - cardSize.w / 2), vw - cardSize.w - 10);
    cardStyle = { left: Math.round(left), top: Math.round(top) };
  }

  return (
    <div className="tour-root" data-tour data-step={step.id} role="dialog" aria-modal="true" aria-label={`Tour step ${idx + 1} of ${STEPS.length}: ${step.title}`}>
      {rect ? (
        <div className="tour-spot" data-tour-spot
          style={{ left: rect.x - 6, top: rect.y - 6, width: rect.w + 12, height: rect.h + 12 }} />
      ) : (
        <div className="tour-dim" />
      )}
      <div className="tour-card" ref={cardRef} style={cardStyle}>
        <span className="tour-kicker">Step {idx + 1} of {STEPS.length}</span>
        <h3>{step.title}</h3>
        <p>{step.text}</p>
        <div className="tour-dots" aria-hidden="true">
          {STEPS.map((s, i) => <span key={s.id} className={`tour-dot ${i === idx ? 'on' : ''} ${i < idx ? 'done' : ''}`} />)}
        </div>
        <div className="tour-actions">
          <button className="btn btn-ghost btn-sm" aria-label="Skip tour" onClick={() => onClose('skip')}><X size={13} /> Skip tour</button>
          <span className="tour-actions-spacer" />
          {idx > 0 && <button className="btn btn-sm" aria-label="Previous step" onClick={back}><ArrowLeft size={13} /> Back</button>}
          <button className="btn btn-primary btn-sm" aria-label={last ? 'Finish tour' : 'Next step'} onClick={next}>
            {last ? <><Check size={13} /> Finish</> : <>Next <ArrowRight size={13} /></>}
          </button>
        </div>
      </div>
    </div>
  );
}
