import React, { useEffect, useRef, useState } from 'react';
import { Ban } from 'lucide-react';
import { ANIMATIONS, DEFAULT_ANIM_DURATION, animOf, previewState } from "../../timeline/anim.js";
import { samplePhotoUrl, samplePictureUrl } from "../../effects/previews.jsx";
import Slider from "../../../components/ui/Slider.jsx";
import { t } from '../../../i18n/index.js';
import { catalogLabel, catalogName } from '../../../i18n/catalog.js';

const KINDS = [['in', t('clip.in')], ['out', t('clip.out')], ['combo', t('animation.combo')]];

// Tile picture: the sample photo moving like the animation, playing while the pointer is over the tile.
function AnimThumb({ kind, id }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    const show = (st) => {
      el.style.transform = `translate(${st.x * 100}%, ${st.y * 100}%) rotate(${st.r}deg) scale(${st.s})`;
      el.style.opacity = String(st.o);
    };
    const still = () => show(previewState(kind, id, kind === 'combo' ? 0.15 : 0.6));
    still();
    const tile = el.closest('.tile') || el;
    let raf = 0;
    const play = () => {
      const t0 = performance.now();
      const loop = () => {
        const s = (performance.now() - t0) / 1000;
        // In / Out: play the move in 0.8 s, then hold half a second. Combo: loops.
        const p = kind === 'combo' ? (s % 2.4) / 2.4 : Math.min(1, (s % 1.3) / 0.8);
        show(previewState(kind, id, p));
        raf = requestAnimationFrame(loop);
      };
      cancelAnimationFrame(raf);
      loop();
    };
    const stop = () => { cancelAnimationFrame(raf); still(); };
    tile.addEventListener('pointerenter', play);
    tile.addEventListener('pointerleave', stop);
    return () => {
      cancelAnimationFrame(raf);
      tile.removeEventListener('pointerenter', play);
      tile.removeEventListener('pointerleave', stop);
    };
  }, [kind, id]);
  return (
    <span className="anim-stage">
      <img ref={ref} src={samplePhotoUrl(id)} onError={(e) => { e.currentTarget.src = samplePictureUrl(); }} alt="" draggable={false} />
    </span>
  );
}

// Clip panel > Animation: In, Out and Combo animations. A Combo replaces In and Out.
export default function AnimationPanel({ clip, len, set, dispatch }) {
  const current = animOf(clip, len);
  const [kind, setKind] = useState(current.combo ? 'combo' : current.out && !current.in ? 'out' : 'in');
  const chosen = clip.anim?.[kind]?.type || null;
  const pick = (id) => {
    const a = { ...(clip.anim || {}) };
    if (!id) delete a[kind];
    else if (kind === 'combo') {
      delete a.in;
      delete a.out;
      a.combo = { type: id };
    } else {
      delete a.combo;
      a[kind] = { type: id, duration: a[kind]?.duration ?? Math.min(DEFAULT_ANIM_DURATION, len / 2) };
    }
    set({ anim: a });
  };
  const cats = [...new Set(ANIMATIONS[kind].map((a) => a.cat))];
  const dur = current[kind]?.duration;
  return (
    <div className="anim-panel">
      <div className="seg-tabs small" role="tablist" aria-label={t('animation-panel.animation_type')}>
        {KINDS.map(([id, name]) => (
          <button key={id} role="tab" aria-selected={kind === id} className={kind === id ? 'on' : ''} onClick={() => setKind(id)}>
            {name}{clip.anim?.[id] ? ' •' : ''}
          </button>
        ))}
      </div>
      <p className="dim small">{t(kind === 'in' ? 'animation.plays_when_the_clip_starts_hover' : kind === 'out' ? 'animation.plays_when_the_clip_ends_hover' : 'animation.plays_during_the_whole_clip_hover')}</p>
      <div className="anim-grid">
        <button className={`tile ${!chosen ? 'on' : ''}`} aria-pressed={!chosen} onClick={() => pick(null)}>
          <span className="tile-preview anim-none"><Ban size={22} /></span>
          <span className="tile-label">{t('grade.none')}</span>
        </button>
      </div>
      {cats.map((cat) => (
        <div key={cat} className="anim-cat">
          <div className="anim-cat-title">{catalogLabel('animation_cat', cat)}</div>
          <div className="anim-grid">
            {ANIMATIONS[kind].filter((a) => a.cat === cat).map((a) => (
              <button key={a.id} className={`tile ${chosen === a.id ? 'on' : ''}`} aria-pressed={chosen === a.id} title={catalogName('animation', a)} onClick={() => pick(a.id)}>
                <span className="tile-preview"><AnimThumb kind={kind} id={a.id} /></span>
                <span className="tile-label">{catalogName('animation', a)}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
      {chosen && kind !== 'combo' && (
        <Slider dispatch={dispatch} label={t('animation-panel.duration')} value={dur} min={0.1} max={Math.max(0.2, Math.min(5, len))} step={0.1}
          fmt={(v) => `${v.toFixed(1)}s`} onChange={(d) => set({ anim: { ...clip.anim, [kind]: { ...clip.anim[kind], duration: d } } })} />
      )}
    </div>
  );
}
