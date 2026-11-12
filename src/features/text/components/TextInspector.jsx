import React, { useMemo, useState } from 'react';
import { AlignCenter, AlignLeft, AlignRight, Bold, CaseUpper, Italic, Search, Star, Underline } from 'lucide-react';
import Slider from "../../../components/ui/Slider.jsx";
import NumBox from "../../../components/ui/NumBox.jsx";
import { dragProps } from "../../timeline/dnd.js";
import TextPreview from './TextPreview.jsx';
import FontPicker from './FontPicker.jsx';
import { resolveStyle } from "../render.js";
import {
  ANIM_LOOP, BUBBLES, HIGHLIGHTS, TEMPLATE_CATEGORIES, TEXT_EFFECTS, TEXT_TEMPLATES,
} from "../catalog.js";
import TextAnimBrowser from './TextAnimBrowser.jsx';
import { PinToTrack } from "../../inspector/components/ClipInspector.jsx";
import { t } from '../../../i18n/index.js';
import { catalogLabel, catalogName } from '../../../i18n/catalog.js';

const TABS = [['Basic', t('clip.basic')], ['Templates', t('text.templates')], ['Bubble', t('text.bubble')], ['Effects', t('library.effects')], ['Animation', t('clip.animation')]];
// Keys that describe how text looks (shared by "apply to all captions"); text and timing stay per clip.
const PER_CLIP = ['id', 'text', 'start', 'duration', 'words', 'caption'];

function stylePatch(patch) {
  const out = { ...patch };
  PER_CLIP.forEach((k) => delete out[k]);
  return out;
}

const FAV_KEY = 'clipcraft.favoriteTemplates';
function loadFavs() {
  try {
    return new Set(JSON.parse(localStorage.getItem(FAV_KEY) || '[]'));
  } catch {
    return new Set();
  }
}

export function TemplateGrid({ onPick, activeId, captionOnly, sampleText, draggable, category }) {
  const [ownCat, setCat] = useState(captionOnly ? 'Captions' : 'All');
  const cat = category || ownCat;
  const [q, setQ] = useState('');
  const [favs, setFavs] = useState(loadFavs);
  const [hover, setHover] = useState(null);
  const toggleFav = (id) => {
    const next = new Set(favs);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setFavs(next);
    try {
      localStorage.setItem(FAV_KEY, JSON.stringify([...next]));
    } catch {
      // Favorites are a convenience; ignore storage failures.
    }
  };
  const list = TEXT_TEMPLATES.filter((tp) => {
    if (captionOnly && !tp.caption && cat === 'Captions') return false;
    if (cat === 'Favorites') return favs.has(tp.id);
    if (cat !== 'All' && !tp.tags.includes(cat)) return false;
    // The search matches the shown (translated) name and the English catalog name alike.
    return !q || tp.name.toLowerCase().includes(q.toLowerCase()) || catalogName('text_template', tp).toLowerCase().includes(q.toLowerCase());
  });
  return (
    <div className="tpl">
      <label className="search">
        <Search size={14} aria-hidden="true" />
        <input type="text" placeholder={t('text.search_text_templates')} value={q} onChange={(e) => setQ(e.target.value)} />
      </label>
      {!category && <div className="chips scroll-x" onWheel={(e) => { e.currentTarget.scrollLeft += e.deltaY; }}>
        {TEMPLATE_CATEGORIES.map((c) => (
          <button key={c} className={`chip ${cat === c ? 'on' : ''}`} onClick={() => setCat(c)}>{catalogLabel('text_cat', c)}</button>
        ))}
      </div>}
      <div className="tpl-grid">
        {list.map((tp) => (
          <div key={tp.id} className={`tpl-item ${activeId === tp.id ? 'on' : ''}`}
            onMouseEnter={() => setHover(tp.id)} onMouseLeave={() => setHover(null)}>
            <button className="tpl-btn" onClick={() => onPick(tp)} title={catalogName('text_template', tp)}
              {...(draggable ? dragProps({ kind: 'text', patch: { ...tp.patch, template: tp.id } }) : {})}>
              <TextPreview style={tp.caption ? { ...tp.patch, caption: true } : tp.patch} text={sampleText || tp.previewText} hover={hover === tp.id} width={128} height={72} />
            </button>
            <span className="tpl-name">{catalogName('text_template', tp)}</span>
            <button className={`tpl-fav ${favs.has(tp.id) ? 'on' : ''}`} onClick={() => toggleFav(tp.id)}
              aria-label={t(favs.has(tp.id) ? 'text.remove_from_favorites' : 'text.add_to_favorites')}>
              <Star size={12} fill={favs.has(tp.id) ? 'currentColor' : 'none'} />
            </button>
          </div>
        ))}
        {!list.length && <p className="muted">{t('text.no_templates_here_yet')}</p>}
      </div>
    </div>
  );
}

// `kind` is the catalog kind of `items` (src/i18n/catalog.js): the tiles show the translated names.
function StyleTiles({ items, kind, value, onPick, styleFor, sample }) {
  const [hover, setHover] = useState(null);
  return (
    <div className="tpl-grid">
      {items.map((it) => (
        <div key={it.id} className={`tpl-item ${value === it.id ? 'on' : ''}`}
          onMouseEnter={() => setHover(it.id)} onMouseLeave={() => setHover(null)}>
          <button className="tpl-btn" onClick={() => onPick(it.id)} title={catalogName(kind, it)}>
            <TextPreview style={styleFor(it.id)} text={sample} hover={hover === it.id} width={128} height={72} />
          </button>
          <span className="tpl-name">{catalogName(kind, it)}</span>
        </div>
      ))}
    </div>
  );
}

function Toggle({ on, onClick, label, children }) {
  return <button className={`icon-toggle ${on ? 'on' : ''}`} aria-pressed={!!on} aria-label={label} title={label} onClick={onClick}>{children}</button>;
}

function Color({ label, value, onChange }) {
  return (
    <label className="field row">
      <span>{label}</span>
      <input type="color" value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

export default function TextInspector({ clip, dispatch, project = null }) {
  const [tab, setTab] = useState('Basic');
  const [applyAll, setApplyAll] = useState(true);
  const [animTab, setAnimTab] = useState('In');
  const st = useMemo(() => resolveStyle(clip), [clip]);
  const sharedToCaptions = clip.caption && applyAll;

  // Style changes go to every caption when "Apply to all main captions" is on.
  const set = (patch) => {
    const style = stylePatch(patch);
    const own = Object.fromEntries(Object.entries(patch).filter(([k]) => PER_CLIP.includes(k)));
    if (sharedToCaptions && Object.keys(style).length) dispatch({ type: 'styleCaptions', patch: style });
    else if (Object.keys(style).length) dispatch({ type: 'update', track: 'text', id: clip.id, patch: style });
    if (Object.keys(own).length) dispatch({ type: 'update', track: 'text', id: clip.id, patch: own });
  };
  const nested = (key) => (p) => set({ [key]: { ...st[key], ...p } });
  const S = (p) => <Slider dispatch={dispatch} {...p} />;
  // The colour roles the clip's style actually paints with, derived from the resolved style
  // (so every template — captions, titles, labels — gets exactly its own roles, no more).
  // They used to be scattered: the word box colour lived only in the Animation tab, the
  // bubble colour only in the Bubble tab, the second/glow colours only in the Effects tab —
  // a user recolouring a template (e.g. the Word Box violet box) could not find them. The
  // swatches below write the very same clip fields those tabs write, through set()/nested(),
  // so the one renderer (preview + export) honours them and caption sharing still applies.
  const colorRoles = [];
  if (st.highlight.mode !== 'none') {
    colorRoles.push(<Color key="hl-color" label={t('text.word_color')} value={st.highlight.color} onChange={(color) => nested('highlight')({ color })} />);
    if (st.highlight.mode === 'box' || st.highlight.mode === 'marker') {
      colorRoles.push(<Color key="hl-bg" label={t('text.box_color')} value={st.highlight.bg} onChange={(bgc) => nested('highlight')({ bg: bgc })} />);
    }
  }
  if (st.bg.on) colorRoles.push(<Color key="bg" label={t('text.background_color')} value={st.bg.color} onChange={(color) => nested('bg')({ color })} />);
  if (st.bubble && st.bubble !== 'none') colorRoles.push(<Color key="bubble" label={t('text.bubble_color')} value={st.bubbleColor} onChange={(bubbleColor) => set({ bubbleColor })} />);
  if (['gradient', 'fire', 'ice', 'shadow3d', 'retro', 'double'].includes(st.effect)) {
    colorRoles.push(<Color key="color2" label={t('text.second_color')} value={st.color2} onChange={(color2) => set({ color2 })} />);
  }
  if (['neon', 'glow', 'fire', 'ice'].includes(st.effect)) {
    colorRoles.push(<Color key="glow" label={t('clip.glow_color')} value={st.glowColor} onChange={(glowColor) => set({ glowColor })} />);
  }
  // Stable style objects for the tiles (style + one changed key).
  const styleWith = (key, val) => ({ ...stylePatch(st), [key]: val, caption: clip.caption });
  const animStyle = (kind) => (id) => {    const base = { ...stylePatch(st), animIn: { id: 'none', dur: 0.5 }, animOut: { id: 'none', dur: 0.4 }, animLoop: { id: 'none', speed: 1 } };
    if (kind === 'In') base.animIn = { id, dur: 0.8 };
    if (kind === 'Out') base.animOut = { id, dur: 0.8 };
    if (kind === 'Loop') base.animLoop = { id, speed: 1 };
    return base;
  };

  return (
    <div className="text-inspector">
      <div className="ci-tabs text-tabs" role="tablist">
        {TABS.map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>{label}</button>
        ))}
      </div>
      {clip.caption && (
        <label className="apply-all">
          <input type="checkbox" checked={applyAll} onChange={(e) => setApplyAll(e.target.checked)} />
          {t('text.apply_to_all_main_captions')}
        </label>
      )}

      {tab === 'Basic' && (
        <div className="fields">
          {project && <PinToTrack clip={clip} project={project} card
            set={(patch) => dispatch({ type: 'update', track: 'text', id: clip.id, patch })} />}
          <div className="insp-card">
            <div className="insp-card-title">{t('text.type')}</div>
          <label className="field">
            <span>{t('tts.text')}</span>
            <textarea rows={3} dir="auto" value={clip.text} onChange={(e) => set({ text: e.target.value })} />
          </label>
          <div className="field">
            <span>{t('text.font')}</span>
            <FontPicker value={st.font} onChange={(font) => set({ font })} />
          </div>
          <div className="toggle-row">
            <Toggle label={t('text.bold')} on={st.bold} onClick={() => set({ bold: !st.bold })}><Bold size={15} /></Toggle>
            <Toggle label={t('text.italic')} on={st.italic} onClick={() => set({ italic: !st.italic })}><Italic size={15} /></Toggle>
            <Toggle label={t('text.underline')} on={st.underline} onClick={() => set({ underline: !st.underline })}><Underline size={15} /></Toggle>
            <Toggle label={t('text.uppercase')} on={st.uppercase} onClick={() => set({ uppercase: !st.uppercase })}><CaseUpper size={15} /></Toggle>
            <span className="tool-sep" />
            <Toggle label={t('text.align_left')} on={st.align === 'left'} onClick={() => set({ align: 'left' })}><AlignLeft size={15} /></Toggle>
            <Toggle label={t('text.align_center')} on={st.align === 'center'} onClick={() => set({ align: 'center' })}><AlignCenter size={15} /></Toggle>
            <Toggle label={t('text.align_right')} on={st.align === 'right'} onClick={() => set({ align: 'right' })}><AlignRight size={15} /></Toggle>
          </div>
          {S({ label: t('text.size'), value: st.size, min: 12, max: 260, step: 1, onChange: (size) => set({ size }) })}
          {S({ label: t('text.letter_spacing'), value: st.letterSpacing, min: -5, max: 40, step: 1, onChange: (letterSpacing) => set({ letterSpacing }) })}
          {S({ label: t('text.line_height'), value: st.lineHeight, min: 0.8, max: 2.5, step: 0.05, onChange: (lineHeight) => set({ lineHeight }) })}
          {S({ label: t('text.max_width'), value: st.maxWidth, min: 0.2, max: 1, numScale: 100, fmt: (v) => `${Math.round(v * 100)}%`, onChange: (maxWidth) => set({ maxWidth }) })}
          </div>
          <div className="insp-card">
            <div className="insp-card-title">{t('clip.fill')}</div>
            <Color label={t('clip.color')} value={st.color} onChange={(color) => set({ color })} />
            {S({ label: t('clip.opacity'), value: st.opacity ?? 1, numScale: 100, fmt: (v) => `${Math.round(v * 100)}%`, onChange: (opacity) => set({ opacity }) })}
          </div>
          {colorRoles.length > 0 && (
            <div className="insp-card">
              <div className="insp-card-title">{t('text.style_colors')}</div>
              {colorRoles}
            </div>
          )}
          <div className="insp-card">
            <div className="insp-card-title">{t('clip.stroke')}</div>
          {S({ label: t('clip.width'), value: st.stroke.width, min: 0, max: 30, step: 1, onChange: (width) => nested('stroke')({ width }) })}
          <Color label={t('clip.stroke_color')} value={st.stroke.color} onChange={(color) => nested('stroke')({ color })} />

          </div>
          <div className="insp-card">
            <div className="insp-card-head"><span className="insp-card-title">{t('text.shadow')}</span>
              <input type="checkbox" checked={st.shadow.on} onChange={(e) => nested('shadow')({ on: e.target.checked })} aria-label={t('text.shadow')} />
            </div>
          {st.shadow.on && (
            <>
              <Color label={t('text.shadow_color')} value={st.shadow.color} onChange={(color) => nested('shadow')({ color })} />
              {S({ label: t('clip.opacity'), value: st.shadow.opacity, onChange: (opacity) => nested('shadow')({ opacity }) })}
              {S({ label: t('grade.blur'), value: st.shadow.blur, min: 0, max: 60, step: 1, onChange: (blur) => nested('shadow')({ blur }) })}
              {S({ label: t('text.distance'), value: st.shadow.y, min: -30, max: 30, step: 1, onChange: (y) => nested('shadow')({ y }) })}
            </>
          )}

          </div>
          <div className="insp-card">
            <div className="insp-card-head"><span className="insp-card-title">{t('inspector.background')}</span>
              <input type="checkbox" checked={st.bg.on} onChange={(e) => nested('bg')({ on: e.target.checked })} aria-label={t('inspector.background')} />
            </div>
          {st.bg.on && (
            <>
              <div className="chips">
                {['block', 'line'].map((m) => (
                  <button key={m} className={`chip ${st.bg.mode === m ? 'on' : ''}`} onClick={() => nested('bg')({ mode: m })}>
                    {t(m === 'block' ? 'text.whole_text' : 'text.each_line')}
                  </button>
                ))}
              </div>
              <Color label={t('text.background_color')} value={st.bg.color} onChange={(color) => nested('bg')({ color })} />
              {S({ label: t('clip.opacity'), value: st.bg.opacity, onChange: (opacity) => nested('bg')({ opacity }) })}
              {S({ label: t('text.corner_radius'), value: st.bg.radius, min: 0, max: 60, step: 1, onChange: (radius) => nested('bg')({ radius }) })}
            </>
          )}

          </div>
          <div className="insp-card">
            <div className="insp-card-title">{t('text.position_timing')}</div>
            <p className="dim small">{t('text.or_drag_the_text_on_the_player')}</p>
          {S({ label: t('inspector.position_x'), value: st.x, numScale: 100, fmt: (v) => `${Math.round(v * 100)}%`, onChange: (x) => set({ x }) })}
          {S({ label: t('inspector.position_y'), value: st.y, numScale: 100, fmt: (v) => `${Math.round(v * 100)}%`, onChange: (y) => set({ y }) })}
          {S({ label: t('text.rotation'), value: st.rotation || 0, min: -180, max: 180, step: 1, fmt: (v) => `${Math.round(v)}°`, onChange: (rotation) => set({ rotation }) })}
          <NumBox layout="field" label={t('inspector.start_s')} step={0.1} min={0} value={clip.start}
            onChange={(v) => set({ start: Math.max(0, v) })} />
          <NumBox layout="field" label={t('graphic.duration_s')} step={0.1} min={0.1} value={clip.duration}
            onChange={(v) => set({ duration: Math.max(0.1, v) })} />
          </div>
        </div>
      )}

      {tab === 'Templates' && (
        <div className="pad-block">
          <TemplateGrid activeId={clip.template} captionOnly={clip.caption} sampleText={clip.caption ? undefined : clip.text}
            onPick={(tp) => set({ ...stylePatch(tp.patch), template: tp.id })} />
        </div>
      )}

      {tab === 'Bubble' && (
        <div className="pad-block">
          <Color label={t('text.bubble_color')} value={st.bubbleColor} onChange={(bubbleColor) => set({ bubbleColor })} />
          <StyleTiles items={BUBBLES} kind="bubble" value={st.bubble} sample={clip.text} onPick={(bubble) => set({ bubble })}
            styleFor={(id) => styleWith('bubble', id)} />
        </div>
      )}

      {tab === 'Effects' && (
        <div className="pad-block">
          <div className="color-pair">
            <Color label={t('text.second_color')} value={st.color2} onChange={(color2) => set({ color2 })} />
            <Color label={t('clip.glow_color')} value={st.glowColor} onChange={(glowColor) => set({ glowColor })} />
          </div>
          <StyleTiles items={TEXT_EFFECTS} kind="text_effect" value={st.effect} sample={clip.text} onPick={(effect) => set({ effect })}
            styleFor={(id) => styleWith('effect', id)} />
        </div>
      )}

      {tab === 'Animation' && (
        <div className="pad-block">
          <div className="sub-head">{t('text.word_highlight')}</div>
          <div className="chips">
            {HIGHLIGHTS.map((h) => (
              <button key={h.id} className={`chip ${st.highlight.mode === h.id ? 'on' : ''}`}
                onClick={() => nested('highlight')({ mode: h.id })}>{catalogName('highlight', h)}</button>
            ))}
          </div>
          {st.highlight.mode !== 'none' && (
            <div className="color-pair">
              <Color label={t('text.word_color')} value={st.highlight.color} onChange={(color) => nested('highlight')({ color })} />
              {(st.highlight.mode === 'box' || st.highlight.mode === 'marker') && (
                <Color label={t('text.box_color')} value={st.highlight.bg} onChange={(bgc) => nested('highlight')({ bg: bgc })} />
              )}
            </div>
          )}
          <div className="seg-tabs small">
            {[['In', t('clip.in')], ['Out', t('clip.out')], ['Loop', t('text.loop')]].map(([id, label]) => (
              <button key={id} className={animTab === id ? 'on' : ''} onClick={() => setAnimTab(id)}>{label}</button>
            ))}
          </div>
          {animTab === 'In' && (
            <>
              {S({ label: t('animation-panel.duration'), value: st.animIn.dur, min: 0.1, max: 3, step: 0.05, fmt: (v) => `${v.toFixed(1)}s`, onChange: (dur) => nested('animIn')({ dur }) })}
              <TextAnimBrowser kind="in" value={st.animIn.id} unit={st.animIn.unit} sampleText={clip.text}
                baseStyle={{ ...stylePatch(st), caption: clip.caption }}
                onPick={(p) => nested('animIn')({ id: p.anim, dur: p.dur })}
                onUnit={(unit) => nested('animIn')({ unit })}
                onClear={() => nested('animIn')({ id: 'none' })} />
            </>
          )}
          {animTab === 'Out' && (
            <>
              {S({ label: t('animation-panel.duration'), value: st.animOut.dur, min: 0.1, max: 3, step: 0.05, fmt: (v) => `${v.toFixed(1)}s`, onChange: (dur) => nested('animOut')({ dur }) })}
              <TextAnimBrowser kind="out" value={st.animOut.id} unit={st.animOut.unit} sampleText={clip.text}
                baseStyle={{ ...stylePatch(st), caption: clip.caption }}
                onPick={(p) => nested('animOut')({ id: p.anim, dur: p.dur })}
                onUnit={(unit) => nested('animOut')({ unit })}
                onClear={() => nested('animOut')({ id: 'none' })} />
            </>
          )}
          {animTab === 'Loop' && (
            <>
              {S({ label: t('tts.speed'), value: st.animLoop.speed, min: 0.2, max: 3, step: 0.1, fmt: (v) => `${v.toFixed(1)}×`, onChange: (speed) => nested('animLoop')({ speed }) })}
              <StyleTiles items={ANIM_LOOP} kind="anim_loop" value={st.animLoop.id} sample={clip.text} onPick={(id) => nested('animLoop')({ id })} styleFor={animStyle('Loop')} />
            </>
          )}
        </div>
      )}
    </div>
  );
}
