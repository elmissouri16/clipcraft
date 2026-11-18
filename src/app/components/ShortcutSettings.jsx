import React, { useState, useEffect, useRef } from 'react';
import { Plus, RotateCcw, X } from 'lucide-react';
import { shortcutActions, subscribeShortcuts, SHORTCUT_GROUPS, FIXED_GESTURES, resolveKeymap, overridesFor, assignCombo, comboFromEvent, comboParts, setActiveKeymap } from '../keymap.js';
import { t } from '../../i18n/index.js';

const Combo = ({ combo }) => <span className="shortcut-combo">{comboParts(combo).map((part, i) => <kbd key={i}>{part}</kbd>)}</span>;

// Settings > Keyboard shortcuts: every editor shortcut, remappable. Changes are
// saved at once (settings.json) and apply immediately; a key belongs to one action.
export default function ShortcutSettings({ saved, onSaved }) {
  const [actions,setActions]=useState(shortcutActions),[overrides,setOverrides]=useState(saved.shortcuts||{}),stored=useRef(saved.shortcuts||{}),queue=useRef(Promise.resolve()),writeVersion=useRef(0);
  useEffect(()=>subscribeShortcuts(()=>setActions(shortcutActions())),[]);
  useEffect(()=>{stored.current=saved.shortcuts||{};setOverrides(stored.current);},[saved.shortcuts]);
  const map=resolveKeymap(overrides,actions),label=id=>actions.find(action=>action.id===id)?.label||id;
  const groups=[...SHORTCUT_GROUPS.map(group=>({id:group,label:group})),...actions.filter(action=>action.extensionId).filter((action,index,rows)=>rows.findIndex(other=>other.group===action.group)===index).map(action=>({id:action.group,label:action.extensionName}))];
  const [recording, setRecording] = useState(null);
  const [notice, setNotice] = useState('');
  const commit = (next, message = '', reset = {}) => {
    const previous=reset.all?{}:{...stored.current};for(const id of reset.ids||[])delete previous[id];
    const value=overridesFor(next,actions,previous),version=++writeVersion.current;
    stored.current=value;setOverrides(value);setNotice(message);setActiveKeymap(value);
    const write=queue.current.then(()=>window.api.settingsSetShortcuts(value));queue.current=write.catch(()=>{});
    write.then(st=>{if(version===writeVersion.current&&st){setActiveKeymap(st.shortcuts);onSaved(st);}}).catch(()=>{if(version===writeVersion.current){stored.current=saved.shortcuts||{};setOverrides(stored.current);setActiveKeymap(stored.current);setNotice(t('shortcuts.save_failed'));}});
  };
  const record = (e, id) => {
    if (e.key === 'Tab') { setRecording(null); return; }
    // While recording, every key belongs to the field (not the dialog or the editor).
    e.preventDefault(); e.stopPropagation();
    if (e.key === 'Escape' && !e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey) { setRecording(null); return; }
    const combo = comboFromEvent(e);
    if (!combo) return; // a modifier alone: keep waiting for the key
    const { map: next, movedFrom } = assignCombo(map, id, combo);
    setRecording(null);
    commit(next, movedFrom ? t('shortcuts.combo_moved_from_action_to_action', { combo, from: label(movedFrom), to: label(id) }) : '');
  };
  const defaults = resolveKeymap({},actions);
  const changed = id => JSON.stringify(map[id]) !== JSON.stringify(defaults[id]);
  const anyChanged = actions.some(a => changed(a.id))||Object.keys(overrides).length>0;
  return (
    <section className="settings-section shortcut-settings">
      <p className="set2-note">{t('shortcuts.add_a_key_with_then_press_the_keys_you_wan')}</p>
      <p className="shortcut-notice" role="status" aria-live="polite">{notice}</p>
      {groups.map(group => (
        <div key={group.id} className="shortcut-group" role="group" aria-label={group.label}>
          <div className="shortcut-group-title">{group.label}</div>
          {actions.filter(a => a.group === group.id).map(a => (
            <div key={a.id} className="shortcut-row" data-action={a.id}>
              <span className="shortcut-label">{a.label}{a.enabled===false&&<small className="shortcut-help">{t('shortcuts.extension_'+a.reason)}</small>}{a.enabled!==false&&a.extensionId&&!Object.hasOwn(overrides,a.id)&&a.keys.some(key=>!defaults[a.id].includes(key))&&<small className="shortcut-help">{t('shortcuts.default_in_use')}</small>}</span>
              <div className="shortcut-keys">
                {map[a.id].length === 0 && recording !== a.id && <span className="shortcut-none">{t('shortcuts.not_set')}</span>}
                {map[a.id].map(combo => (
                  <span key={combo} className="shortcut-key">
                    <Combo combo={combo} />
                    <button type="button" className="shortcut-remove" aria-label={t('shortcuts.remove_combo_from_action', { combo, action: a.label })} title={t('home.remove')}
                      onClick={() => commit({ ...map, [a.id]: map[a.id].filter(c => c !== combo) })}><X size={11} /></button>
                  </span>
                ))}
                {map[a.id].length < 4 && (
                  <button type="button" className={`shortcut-add ${recording === a.id ? 'recording' : ''}`}
                    aria-label={recording === a.id ? t('shortcuts.press_keys_for_action', { action: a.label }) : t('shortcuts.add_a_key_for_action', { action: a.label })}
                    onClick={e => { e.currentTarget.focus(); setRecording(recording === a.id ? null : a.id); }} onKeyDown={recording === a.id ? e => record(e, a.id) : undefined}
                    onBlur={() => recording === a.id && setRecording(null)}>
                    {recording === a.id ? t('shortcuts.press_keys') : <Plus size={12} />}
                  </button>
                )}
                {changed(a.id) && (
                  <button type="button" className="icon-btn sm shortcut-reset" aria-label={t('shortcuts.reset_action_to_default', { action: a.label })} title={defaults[a.id].length ? t('shortcuts.default_keys', { keys: defaults[a.id].join(', ') }) : t('shortcuts.default_none')}
                    onClick={() => commit(assignAll(map, a.id, defaults[a.id]),'',{ids:[a.id]})}><RotateCcw size={12} /></button>
                )}
              </div>
            </div>
          ))}
        </div>
      ))}
      <div className="shortcut-group" role="group" aria-label={t('shortcuts.mouse')}>
        <div className="shortcut-group-title">{t('shortcuts.mouse')}</div>
        {FIXED_GESTURES.map(g => <div key={g.label} className="shortcut-row"><span className="shortcut-label">{g.label}</span><div className="shortcut-keys"><span className="shortcut-fixed">{g.keys}</span></div></div>)}
      </div>
      <div className="settings-actions">
        <button type="button" className="btn btn-sm" disabled={!anyChanged} onClick={() => commit(resolveKeymap({},actions), t('shortcuts.all_shortcuts_are_back_to_their_defaults'),{all:true})}>{t('shortcuts.reset_all_to_defaults')}</button>
      </div>
    </section>
  );
}

// Restoring an action's defaults takes those keys back from other actions.
function assignAll(map, id, combos) {
  let next = { ...map, [id]: [] };
  for (const combo of combos) next = assignCombo(next, id, combo).map;
  return next;
}
