// Tests electron/telemetry.cjs against a running copy of the website (website/tests/README in website/README.md):
//   FVE_TELEMETRY_URL=http://127.0.0.1:8790/api/v1/telemetry node scripts/test-telemetry.cjs
// Electron is replaced by a small stub, so the real %APPDATA%\CapRocket\telemetry.json is never touched.
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

const url = process.env.FVE_TELEMETRY_URL;
if (!url) {
  console.error('Set FVE_TELEMETRY_URL to the telemetry endpoint of a local test site.');
  process.exit(1);
}
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fve-telemetry-'));
const calls = [];
let offline = false;
const stub = {
  app: { getPath: () => dir, getVersion: () => '0.1.0', isPackaged: false },
  net: {
    fetch: async (u, opts) => {
      calls.push(JSON.parse(opts.body));
      if (offline) throw new Error('offline');
      return fetch(u, opts);
    },
  },
};
const load = Module._load;
Module._load = function (request, ...rest) {
  return request === 'electron' ? stub : load.call(this, request, ...rest);
};
const t = require('../electron/telemetry.cjs');

let failed = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${name}${ok ? '' : `  -> ${detail}`}`);
  if (!ok) failed++;
};
const state = () => JSON.parse(fs.readFileSync(path.join(dir, 'telemetry.json'), 'utf8'));

(async () => {
  check('not asked yet: consent is null', t.getStatus().consent === null);
  await t.sendDue();
  check('nothing sent before consent', calls.length === 0);

  t.setConsent(false);
  await t.sendDue();
  check('declined: nothing sent', calls.length === 0 && t.getStatus().consent === false);
  check('declined: no installation ID created', !state().installId);

  t.setConsent(true);
  await new Promise((r) => setTimeout(r, 1500)); // setConsent sends in the background
  const s = state();
  check('consent creates a random UUID', /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(s.installId));
  check('install event sent once', calls.length === 1 && calls[0].event === 'install' && s.installSent === true, JSON.stringify(calls));
  check('payload has only id, event and version', JSON.stringify(Object.keys(calls[0]).sort()) === '["event","install_id","version"]');

  await t.sendDue();
  await t.sendDue();
  check('no heartbeat again on the same day', calls.length === 1);

  fs.writeFileSync(path.join(dir, 'telemetry.json'), JSON.stringify({ ...state(), lastHeartbeatDay: '2000-01-01' }));
  await t.sendDue();
  check('heartbeat sent on a new day', calls.length === 2 && calls[1].event === 'heartbeat' && state().lastHeartbeatDay === new Date().toISOString().slice(0, 10));

  fs.writeFileSync(path.join(dir, 'telemetry.json'), JSON.stringify({ ...state(), lastHeartbeatDay: '2000-01-01' }));
  offline = true;
  let threw = false;
  try { await t.sendDue(); } catch { threw = true; }
  check('offline: no error, retried later', !threw && state().lastHeartbeatDay === '2000-01-01');
  offline = false;

  t.setConsent(false);
  const before = calls.length;
  await t.sendDue();
  check('turned off: nothing more is sent', calls.length === before && t.getStatus().consent === false);

  const bad = { ...stub.net };
  stub.net.fetch = async () => { throw new Error('boom'); };
  t.setConsent(true);
  await new Promise((r) => setTimeout(r, 200));
  check('network errors never throw', t.getStatus().consent === true);
  stub.net.fetch = bad.fetch;
  t.setConsent(false);

  console.log(`\n${failed ? `${failed} failed` : 'all passed'}  (state file: ${path.join(dir, 'telemetry.json')})`);
  process.exit(failed ? 1 : 0);
})();
