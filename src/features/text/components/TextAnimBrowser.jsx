import React, { useState } from 'react';
import { Ban, ChevronDown } from 'lucide-react';
import TextPreview from './TextPreview.jsx';
import { textAnimCategories, textAnimCategoryLabel, textAnimPresets } from "../../effects/textAnim.js";
import { ANIM_UNITS, INHERENT_UNIT_ANIMS } from "../units.js";
import { t } from '../../../i18n/index.js';

// Text Animations browser (Text inspector > Animation): In / Out preset packs in collapsible category
// folders, like the professional preset composers. Hovering a tile plays the preset through the real text
// renderer on the clip's own words, so what plays here is what plays in the preview and in the export.
// Picking a tile applies the preset (renderer id + its tuned duration) to the selected clip — for captions
// the inspector routes the same patch to every caption when "apply to all" is on.
//
// The Animate control under the tiles picks the preset's unit: the whole text at once, word by word, or
// letter by letter, with the stagger defined in src/features/text/units.js. It is stored on the same animIn /
// animOut record as the preset, per In / Out slot.
// Unit labels: Whole text / Word by word / Letters.
const UNIT_LABELS = { whole: t('text.whole_text'), word: t('text.word_by_word'), char: t('text.letters') };

export default function TextAnimBrowser({ kind, value, unit = 'whole', baseStyle, sampleText, onPick, onClear, onUnit }) {
  const presets = textAnimPresets(kind);
  const cats = textAnimCategories(kind);
  const [closed, setClosed] = useState(() => new Set());
  const [hover, setHover] = useState(null);
  const activeCat = presets.find((p) => p.anim === value)?.cat;
  const toggle = (cat) => setClosed((s) => {
    const n = new Set(s);
    if (n.has(cat)) n.delete(cat);
    else n.add(cat);
    return n;
  });
  // Type & Words presets that already animate per unit ignore the unit choice; the control says so
  // instead of pretending to change them.
  const inherent = INHERENT_UNIT_ANIMS.has(value);
  // With a unit smaller than the whole text, the stagger is only visible on a few words: preview on the
  // clip's own text when it has at least two words, otherwise on a short stock phrase.
  const words = (sampleText || '').split(/\s+/).filter(Boolean).length;
  const previewText = unit === 'whole' || words >= 2 ? sampleText : t('text.cut_it_your_way');
  // The tile previews isolate the animation being browsed: the other slot and the loop are off.
  const styleFor = (p) => (kind === 'in'
    ? { ...baseStyle, animIn: { id: p.anim, dur: p.dur, unit }, animOut: { id: 'none', dur: 0.3 }, animLoop: { id: 'none', speed: 1 } }
    : { ...baseStyle, animIn: { id: 'none', dur: 0.3 }, animOut: { id: p.anim, dur: p.dur, unit }, animLoop: { id: 'none', speed: 1 } });
  // In tiles: play the entrance, then a beat at rest. Out tiles: hold at rest, then play the exit.
  const loopFor = (p) => (kind === 'in' ? p.dur + 1 : p.dur + 1.3);

  return (
    <div className="tan">
      <button className={`tan-none ${value === 'none' ? 'on' : ''}`} onClick={onClear} aria-pressed={value === 'none'}>
        <Ban size={14} aria-hidden="true" /> {t('text-anim-browser.no_animation')}
      </button>
      {value !== 'none' && (
        <div className="tan-unit">
          <span className="tan-unit-label">{t('text-anim-browser.animate')}</span>
          <div className="seg-tabs small" role="group" aria-label={t('text-anim-browser.animation_unit')}>
            {ANIM_UNITS.map((u) => (
              <button key={u} className={unit === u ? 'on' : ''} aria-pressed={unit === u}
                disabled={inherent || !onUnit} onClick={() => onUnit && onUnit(u)}>
                {UNIT_LABELS[u]}
              </button>
            ))}
          </div>
          {inherent && <p className="tan-note">{t('text-anim-browser.this_preset_already_animates_per_word_or_l')}</p>}
          {!inherent && unit === 'char' && (
            <p className="tan-note">{t('text-anim-browser.letters_animate_one_by_one_inside_each_wor')}</p>
          )}
          {!inherent && unit === 'word' && (
            <p className="tan-note">{t('text-anim-browser.each_word_plays_the_same_motion_in_turn_fi')}</p>
          )}
        </div>
      )}
      {cats.map((cat) => {
        const list = presets.filter((p) => p.cat === cat);
        const open = !closed.has(cat) || cat === activeCat;
        return (
          <div key={cat} className="tan-cat">
            <button className="tan-cat-head" aria-expanded={open} onClick={() => toggle(cat)}>
              <ChevronDown size={14} className={open ? '' : 'closed'} aria-hidden="true" />
              <span>{textAnimCategoryLabel(cat)}</span>
              <span className="tan-count">{list.length}</span>
            </button>
            {open && (
              <div className="tpl-grid">
                {list.map((p) => (
                  <div key={p.name} className={`tpl-item ${value === p.anim ? 'on' : ''}`}
                    onMouseEnter={() => setHover(p.name)} onMouseLeave={() => setHover(null)}>
                    <button className="tpl-btn" onClick={() => onPick(p)} title={`${p.name} · ${p.dur.toFixed(1)}s`}>
                      <TextPreview style={styleFor(p)} text={previewText} hover={hover === p.name}
                        width={128} height={72} loopDur={loopFor(p)} />
                    </button>
                    <span className="tpl-name">{p.name}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
