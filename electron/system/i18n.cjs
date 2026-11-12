// User-interface text in the main process (docs/design/localization.md): dialog titles and the
// messages the renderer shows as returned. The same dictionaries as the renderer
// (shared/i18n/<language>.json); the language comes from settings ('system' follows app.getLocale()).
const fs = require('node:fs');
const path = require('node:path');
const dir = path.join(__dirname, '..', '..', 'shared', 'i18n');
const DICTS = {};
for (const id of ['en', 'fr', 'es']) { try { DICTS[id] = JSON.parse(fs.readFileSync(path.join(dir, `${id}.json`), 'utf8')); } catch { DICTS[id] = {}; } }
let lang = 'en';
function resolveLanguage(preference, systemLanguage = 'en') {
  if (preference && preference !== 'system' && DICTS[preference]) return preference;
  const base = String(systemLanguage || 'en').toLowerCase().slice(0, 2);
  return DICTS[base] ? base : 'en';
}
const setLanguage = (preference, systemLanguage) => (lang = resolveLanguage(preference, systemLanguage));
const getLanguage = () => lang;
const fill = (s, params) => (params ? s.replace(/\{(\w+)\}/g, (m, k) => (params[k] === undefined || params[k] === null ? m : String(params[k]))) : s);
const t = (key, params) => fill(DICTS[lang]?.[key] ?? DICTS.en[key] ?? key, params);
module.exports = { t, setLanguage, getLanguage, resolveLanguage, LANGUAGE_IDS: ['system', 'en', 'fr', 'es'] };
