// User-interface text in the renderer (docs/design/localization.md). Every string the UI shows comes
// from shared/i18n/<language>.json through t(); English is the fallback for a missing key. The
// language is settled once, before React renders (main.jsx reads it from the main process), and a
// change applies when ClipCraft restarts, so t() can be called from anywhere, including module-level
// tables, without a hook.
import React from 'react';
import en from '../../shared/i18n/en.json' with { type: 'json' };
import fr from '../../shared/i18n/fr.json' with { type: 'json' };
import es from '../../shared/i18n/es.json' with { type: 'json' };

const DICTS = { en, fr, es };
export const LANGUAGES = [
  { id: 'system', label: 'System language' },
  { id: 'en', label: 'English' },
  { id: 'fr', label: 'Français' },
  { id: 'es', label: 'Español' },
];
let lang = 'en';

// 'system' or an unknown value resolves from the OS/browser language; anything we do not have is English.
export function resolveLanguage(preference, systemLanguage = (typeof navigator !== 'undefined' && navigator.language) || 'en') {
  if (preference && preference !== 'system' && DICTS[preference]) return preference;
  const base = String(systemLanguage || 'en').toLowerCase().slice(0, 2);
  return DICTS[base] ? base : 'en';
}
export function setLanguage(preference, systemLanguage) {
  lang = resolveLanguage(preference, systemLanguage);
  if (typeof document !== 'undefined') document.documentElement.lang = lang;
  return lang;
}
export const getLanguage = () => lang;

const fill = (s, params) => (params ? s.replace(/\{(\w+)\}/g, (m, k) => (params[k] === undefined || params[k] === null ? m : String(params[k]))) : s);
// The text for a key, with {name} placeholders filled. A missing key falls back to English, then to the key.
export function t(key, params) {
  const s = DICTS[lang][key] ?? en[key] ?? key;
  return fill(s, params);
}
// Plural forms: the key holds an object { one, other, ... } selected with Intl.PluralRules for the
// language; {count} is filled in. tn('library.items', 3) -> "3 items".
const rules = {};
export function tn(key, count, params) {
  const forms = DICTS[lang][key] ?? en[key];
  if (!forms || typeof forms !== 'object') return t(key, { count, ...params });
  const rule = (rules[lang] ||= new Intl.PluralRules(lang));
  const form = forms[rule.select(count)] ?? forms.other ?? Object.values(forms)[0];
  return fill(form, { count, ...params });
}
// Text with simple markup: <b>…</b>, <i>…</i>, <code>…</code>, <kbd>…</kbd>, and any tag given in
// `tags` as a function of the inner text (for a link or a button). Returns React children.
export function rich(key, params, tags = {}) {
  const text = t(key, params);
  const out = [];
  const re = /<(\w+)>([\s\S]*?)<\/\1>|<(\w+)\s*\/>/g;
  let last = 0, m, i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tag = m[1] || m[3], inner = m[2] ?? '';
    const custom = tags[tag];
    if (custom) out.push(React.createElement(React.Fragment, { key: i++ }, custom(inner)));
    else if (tag === 'br') out.push(React.createElement('br', { key: i++ }));
    else out.push(React.createElement(['b', 'i', 'code', 'kbd', 'small', 'em', 'strong'].includes(tag) ? tag : 'span', { key: i++ }, inner));
    last = re.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out.length === 1 ? out[0] : out;
}
// Dates and numbers follow the language.
export const formatDate = (value, options = { day: 'numeric', month: 'short', year: 'numeric' }) => new Date(value).toLocaleDateString(lang, options);
export const formatDateTime = (value, options = { dateStyle: 'medium', timeStyle: 'short' }) => new Date(value).toLocaleString(lang, options);
export const formatNumber = (value, options) => new Intl.NumberFormat(lang, options).format(value);
