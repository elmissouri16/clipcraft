// Merges shared/i18n/parts/*.en.json (keys added by a hand pass) into shared/i18n/en.json, sorted, and
// removes the parts. Refuses a key that already exists with a different text. --drop k1,k2 deletes
// obsolete keys (fragments replaced by whole sentences). Usage: node scripts/i18n-merge-parts.cjs [--drop a,b]
const fs = require('node:fs'), path = require('node:path');
const dir = path.resolve(__dirname, '../shared/i18n'), partsDir = path.join(dir, 'parts');
const en = JSON.parse(fs.readFileSync(path.join(dir, 'en.json'), 'utf8'));
const dropArg = process.argv.indexOf('--drop');
for (const k of dropArg > 0 ? process.argv[dropArg + 1].split(',') : []) delete en[k];
let added = 0, conflicts = [];
for (const f of fs.existsSync(partsDir) ? fs.readdirSync(partsDir).filter((n) => n.endsWith('.en.json')) : []) {
  const part = JSON.parse(fs.readFileSync(path.join(partsDir, f), 'utf8'));
  for (const [k, v] of Object.entries(part)) {
    if (en[k] !== undefined && JSON.stringify(en[k]) !== JSON.stringify(v)) { conflicts.push(`${f}: ${k}`); continue; }
    if (en[k] === undefined) added++;
    en[k] = v;
  }
  fs.unlinkSync(path.join(partsDir, f));
}
fs.writeFileSync(path.join(dir, 'en.json'), JSON.stringify(Object.fromEntries(Object.entries(en).sort(([a], [b]) => a.localeCompare(b))), null, 2) + '\n');
console.log(`merged ${added} new keys; en.json now has ${Object.keys(en).length}`);
if (conflicts.length) { console.error('conflicting keys (kept en.json, dropped the part value):\n' + conflicts.join('\n')); process.exitCode = 1; }
