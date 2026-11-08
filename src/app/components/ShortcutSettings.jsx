import React, { useState } from 'react';
import { Plus, RotateCcw, X } from 'lucide-react';
import { SHORTCUT_ACTIONS, SHORTCUT_GROUPS, FIXED_GESTURES, resolveKeymap, overridesFor, assignCombo, comboFromEvent, comboParts, setActiveKeymap } from '../keymap.js';

const label = id => SHORTCUT_ACTIONS.find(a => a.id === id)?.label || id;
const Combo = ({ combo }) => <span className="shortcut-combo">{comboParts(combo).map((part, i) => <kbd key={i}>{part}</kbd>)}</span>;

// Settings > Keyboard shortcuts: every editor shortcut, remappable. Changes are
// saved at once (settings.json) and apply immediately; a key belongs to one action.
export default function ShortcutSettings({ saved, onSaved }) {
  const [map, setMap] = useState(() => resolveKeymap(saved.shortcuts));
  const [recording, setRecording] = useState(null);
  const [notice, setNotice] = useState('');
  const commit = async (next, message = '') => {
    setMap(next); setNotice(message);
    const overrides = overridesFor(next);
    setActiveKeymap(overrides);
    const st = await window.api.settingsSetShortcuts(overrides);
    if (st) onSaved(st);
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
    commit(next, movedFrom ? `${combo} moved from “${label(movedFrom)}” to “${label(id)}”.` : '');
  };
  const defaults = Object.fromEntries(SHORTCUT_ACTIONS.map(a => [a.id, a.keys]));
  const changed = id => JSON.stringify(map[id]) !== JSON.stringify(defaults[id]);
  const anyChanged = SHORTCUT_ACTIONS.some(a => changed(a.id));
  return (
    <section className="settings-section shortcut-settings">
      <p className="set2-note">Add a key with +, then press the keys you want (Esc cancels). Each key belongs to one action; assigning it elsewhere moves it.</p>
      <p className="shortcut-notice" role="status" aria-live="polite">{notice}</p>
      {SHORTCUT_GROUPS.map(group => (
        <div key={group} className="shortcut-group" role="group" aria-label={group}>
          <div className="shortcut-group-title">{group}</div>
          {SHORTCUT_ACTIONS.filter(a => a.group === group).map(a => (
            <div key={a.id} className="shortcut-row" data-action={a.id}>
              <span className="shortcut-label">{a.label}</span>
              <div className="shortcut-keys">
                {map[a.id].length === 0 && recording !== a.id && <span className="shortcut-none">Not set</span>}
                {map[a.id].map(combo => (
                  <span key={combo} className="shortcut-key">
                    <Combo combo={combo} />
                    <button type="button" className="shortcut-remove" aria-label={`Remove ${combo} from ${a.label}`} title="Remove"
                      onClick={() => commit({ ...map, [a.id]: map[a.id].filter(c => c !== combo) })}><X size={11} /></button>
                  </span>
                ))}
                {map[a.id].length < 4 && (
                  <button type="button" className={`shortcut-add ${recording === a.id ? 'recording' : ''}`}
                    aria-label={recording === a.id ? `Press keys for ${a.label}` : `Add a key for ${a.label}`}
                    onClick={e => { e.currentTarget.focus(); setRecording(recording === a.id ? null : a.id); }} onKeyDown={recording === a.id ? e => record(e, a.id) : undefined}
                    onBlur={() => recording === a.id && setRecording(null)}>
                    {recording === a.id ? 'Press keys…' : <Plus size={12} />}
                  </button>
                )}
                {changed(a.id) && (
                  <button type="button" className="icon-btn sm shortcut-reset" aria-label={`Reset ${a.label} to default`} title={`Default: ${defaults[a.id].join(', ') || 'none'}`}
                    onClick={() => commit(assignAll(map, a.id, defaults[a.id]))}><RotateCcw size={12} /></button>
                )}
              </div>
            </div>
          ))}
        </div>
      ))}
      <div className="shortcut-group" role="group" aria-label="Mouse">
        <div className="shortcut-group-title">Mouse</div>
        {FIXED_GESTURES.map(g => <div key={g.label} className="shortcut-row"><span className="shortcut-label">{g.label}</span><div className="shortcut-keys"><span className="shortcut-fixed">{g.keys}</span></div></div>)}
      </div>
      <div className="settings-actions">
        <button type="button" className="btn btn-sm" disabled={!anyChanged} onClick={() => commit(resolveKeymap({}), 'All shortcuts are back to their defaults.')}>Reset all to defaults</button>
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
