// Every plain UI string in the renderer's JSX goes through t() (docs/design/localization.md): the extraction
// script's --check mode must find nothing left to wrap and nothing for a hand pass. Brand names and technical
// tokens are allowed as literals. Usage: node tests/unit/system/test-i18n-coverage.cjs
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const root = path.resolve(__dirname, '../../..');
const r = spawnSync(process.execPath, [path.join(root, 'scripts/i18n-wrap.cjs'), '--check', '--report', path.join(require('node:os').tmpdir(), 'i18n-coverage-report.json')], { cwd: root, encoding: 'utf8' });
process.stdout.write(r.stdout);
if (r.status !== 0) { process.stderr.write(r.stderr); process.exit(1); }
console.log('i18n coverage OK: no plain UI strings outside t()');
