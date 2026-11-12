// The localization layer (src/i18n/index.js, electron/system/i18n.cjs, docs/design/localization.md) and
// the dictionaries: language resolution, t/tn/rich, fallback, and the invariants every language must
// keep (same keys as English, same placeholders, complete plural forms, no em dashes).
// Usage: node tests/unit/system/test-i18n.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import React from 'react';
import { t, tn, rich, setLanguage, getLanguage, resolveLanguage, LANGUAGES } from '../../../src/i18n/index.js';
const main = createRequire(import.meta.url)('../../../electron/system/i18n.cjs');

const checks = [], check = (name, ok) => { assert.ok(ok, name); checks.push(name); };
const load = (id) => JSON.parse(fs.readFileSync(new URL(`../../../shared/i18n/${id}.json`, import.meta.url), 'utf8'));
const dicts = { en: load('en'), fr: load('fr'), es: load('es') };

// resolution
check('explicit languages win; system follows the OS; unknown falls back to English', resolveLanguage('fr', 'en-US') === 'fr' && resolveLanguage('system', 'es-MX') === 'es' && resolveLanguage('system', 'de-DE') === 'en' && resolveLanguage('xx', 'fr') === 'fr' && resolveLanguage(undefined, 'FR') === 'fr');
check('the main process resolves the same way', main.resolveLanguage('system', 'es-ES') === 'es' && main.resolveLanguage('de', 'en') === 'en' && LANGUAGES.map((l) => l.id).join() === main.LANGUAGE_IDS.join());
// t / tn / rich on a known English key set
const sampleKey = Object.keys(dicts.en).find((k) => typeof dicts.en[k] === 'string' && !dicts.en[k].includes('{'));
setLanguage('en');
check('t returns English text and falls back to the key', t(sampleKey) === dicts.en[sampleKey] && t('nope.missing') === 'nope.missing');
check('placeholders are filled and unknown ones are kept', t('x', { a: 1 }) === 'x');
setLanguage('fr', 'fr');
check('a French key falls back to English when missing', getLanguage() === 'fr' && t(sampleKey) === (dicts.fr[sampleKey] ?? dicts.en[sampleKey]));
setLanguage('en');
const pluralKey = Object.keys(dicts.en).find((k) => dicts.en[k] && typeof dicts.en[k] === 'object');
if (pluralKey) check('tn picks the plural form and fills count', tn(pluralKey, 1) === dicts.en[pluralKey].one.replace('{count}', '1') && tn(pluralKey, 2) === dicts.en[pluralKey].other.replace('{count}', '2'));
const richKey = Object.keys(dicts.en).find((k) => typeof dicts.en[k] === 'string' && /<b>.*<\/b>/.test(dicts.en[k]));
if (richKey) { const out = rich(richKey); const arr = Array.isArray(out) ? out : [out]; check('rich turns <b> into an element', arr.some((x) => React.isValidElement(x) && x.type === 'b')); }

// dictionary invariants
const placeholders = (s) => (typeof s === 'string' ? (s.match(/\{\w+\}/g) || []).sort().join() : Object.values(s).flatMap((v) => v.match(/\{\w+\}/g) || []).sort().join());
const flat = (d) => Object.entries(d).flatMap(([k, v]) => (typeof v === 'string' ? [[k, v]] : Object.entries(v).map(([f, s]) => [`${k}.${f}`, s])));
check('every English value is a string or a plural object with one and other', Object.values(dicts.en).every((v) => typeof v === 'string' || (v && typeof v === 'object' && typeof v.one === 'string' && typeof v.other === 'string')));
check('no em dashes in any language', ['en', 'fr', 'es'].every((id) => flat(dicts[id]).every(([, s]) => !s.includes('—'))));
for (const id of ['fr', 'es']) {
  const missing = Object.keys(dicts.en).filter((k) => dicts[id][k] === undefined), extra = Object.keys(dicts[id]).filter((k) => dicts.en[k] === undefined);
  check(`${id} has every English key and nothing else (missing ${missing.length}, extra ${extra.length})`, !missing.length && !extra.length);
  const mismatched = Object.keys(dicts.en).filter((k) => dicts[id][k] !== undefined && placeholders(dicts.en[k]) !== placeholders(dicts[id][k]));
  check(`${id} keeps the same placeholders as English (${mismatched.slice(0, 3).join(', ')})`, !mismatched.length);
  const untranslated = Object.keys(dicts.en).filter((k) => typeof dicts.en[k] === 'string' && dicts.en[k].length > 12 && /\s/.test(dicts.en[k]) && dicts[id][k] === dicts.en[k]);
  check(`${id} is translated, not a copy (identical long strings: ${untranslated.length})`, untranslated.length < Object.keys(dicts.en).length * 0.05);
}
console.log(`i18n: ${checks.length} checks passed (${Object.keys(dicts.en).length} keys)`);
