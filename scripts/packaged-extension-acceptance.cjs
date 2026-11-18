// Test controller only; never shipped in app.asar. Dialog replies are queued through
// the main-process debugger; installation/trust/runtime/edit/view IPC remain real.
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const ID = 'fixture.packaged-acceptance';
const literal = JSON.stringify;

async function prepare(root, output) {
  await require('./build-plugin-sdk.cjs').buildSdk();
  const source = path.join(output, 'extension-source');
  await fs.cp(path.join(root, 'tests/fixtures/extensions/packaged-acceptance'), source, {recursive: true});
  const sdk = require('../packages/plugin-sdk/dist/authoring.cjs');
  const built = await sdk.buildPlugin(source), archive = path.join(output, 'extension.tgz');
  await sdk.packPlugin(built.directory, archive);
  const validated = await sdk.validatePlugin(archive);
  if (validated.key !== built.key) throw Error('SDK archive fingerprint differs from compiled extension');
  return {id: ID, key: built.key, appVersion: require(path.join(root, 'package.json')).version, archive,
    sha256: crypto.createHash('sha256').update(await fs.readFile(archive)).digest('hex')};
}

async function dialogs(main, answers) {
  await main.evaluate(`(() => {
    const dialog = process.mainModule.require('electron').dialog;
    if (!globalThis.__packagedDialogs) {
      const state = globalThis.__packagedDialogs = {dialog, original: {}, queue: [], seen: []};
      for (const method of ['showOpenDialog', 'showMessageBox']) {
        state.original[method] = dialog[method];
        dialog[method] = async (...args) => {
          const next = state.queue.shift();
          state.seen.push({method, options: args.at(-1)});
          if (!next || next.method !== method) throw Error('Unexpected native dialog: ' + method);
          return next.value;
        };
      }
    }
    globalThis.__packagedDialogs.queue.push(...${literal(answers)});
    return true;
  })()`);
}

async function restoreDialogs(main) {
  return main.evaluate(`(() => {
    const state = globalThis.__packagedDialogs;
    if (!state) return {seen: [], pending: 0};
    for (const [method, fn] of Object.entries(state.original)) state.dialog[method] = fn;
    const result = {seen: state.seen.map(item => ({method: item.method, title: item.options.title, properties: item.options.properties})), pending: state.queue.length};
    delete globalThis.__packagedDialogs;
    return result;
  })()`);
}

async function exercise({page, main, fixture, check, reopen = false}) {
  const q = expression => page.evaluate(expression);
  const run = name => q(`window.api.pluginsExtensionExecute(${literal(ID + '.' + name)}, {})`);
  const running = `(await window.api.pluginsExtensionStatus()).some(row => row.id === ${literal(ID)} && row.state === 'running')`;
  if (!reopen) {
    await dialogs(main, [{method: 'showOpenDialog', value: {canceled: false, filePaths: [fixture.archive]}}]);
    const installed = await q('window.api.pluginsInstall()');
    check(installed?.length === 1 && installed[0].key === fixture.key, 'the running app installs the SDK-built extension archive', installed);
    check(!(await q(running)), 'installing the archive does not execute it');
    const refused = await q(`window.api.pluginsExtensionExecute(${literal(ID + '.proof')}, {}, ${literal(fixture.key)}).then(() => null, error => error.message)`);
    check(typeof refused === 'string' && /trust/i.test(refused), 'an untrusted installed command is refused', refused);
    await dialogs(main, [{method: 'showMessageBox', value: {response: 0}}]);
    check(await q(`window.api.pluginsExtensionTrust(${literal(fixture.key)})`) === false && !(await q(running)), 'declining Node trust leaves the extension stopped');
    await dialogs(main, [{method: 'showMessageBox', value: {response: 1}}]);
    check(await q(`window.api.pluginsExtensionTrust(${literal(fixture.key)})`) === true && await page.until(running, 30000), 'explicit Node trust starts the installed utility worker');
    const settings = await q(`window.api.pluginsExtensionSettingsRead(${literal(ID + '.settings')})`);
    check(settings.label === 'Packaged marker', 'native setting defaults reach the installed worker', settings);
    await q(`window.api.pluginsExtensionSettingsUpdate(${literal(ID + '.settings')}, 'label', 'Persisted packaged marker')`);
  } else {
    check(await page.until(running, 30000), 'the trusted extension activates after a cold application restart');
    const proof = await run('proof');
    check(proof.label === 'Persisted packaged marker', 'installed extension settings survive a cold application restart', proof);
  }

  const proof = await run('proof');
  check(proof.capabilities.features['ui.actions.state'] === 1 && proof.capabilities.features['ui.inspector'] === 1,
    'the installed worker discovers current native-control features', proof.capabilities);
  check(proof.host.appVersion === fixture.appVersion, 'the installed worker reads the native host', proof.host);
  const action = `[data-extension-action="${ID}.mark"]`;
  check(await page.until(`!!document.querySelector(${literal(action)}) && !document.querySelector(${literal(action)}).disabled`, 30000), 'the enabled extension toolbar action renders');
  check(await q(`!!document.querySelector(${literal(action + ' [data-extension-action-icon]')})`), 'the toolbar renders the extension vector icon');

  if (!reopen) {
    const before = await q('window.__fve.history().past.length');
    await q(`document.querySelector(${literal(action)}).click()`);
    check(await page.until(`window.__fve.rawProject().markers.some(marker => marker.label === 'Persisted packaged marker')`, 30000) && await q('window.__fve.history().past.length') === before + 1,
      'a native extension action edits the project with one Undo entry');
    await q(`window.__fve.dispatch({type: 'undo'})`);
    check(await page.until(`window.__fve.rawProject().markers.length === 0`, 5000), 'Undo restores the project after the installed command');
    await q(`window.__fve.select({track: 'video', id: 'v'})`);
    const field = `[data-extension-inspector="${ID}.picture"] input`;
    check(await page.until(`!!document.querySelector(${literal(field)})`, 10000), 'the installed bound property control renders');
    await q(`(() => {const node = document.querySelector(${literal(field)}); node.focus();
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(node, '.65');
      node.dispatchEvent(new Event('input', {bubbles: true})); node.blur();})()`);
    check(await page.until('window.__fve.rawProject().videoClips[0].opacity === .65', 10000), 'the installed native field edits the selected clip');
    await q(`window.__fve.dispatch({type: 'undo'})`);
    check(await page.until(`Number(document.querySelector(${literal(field)}).value) === 1`, 5000), 'Undo synchronizes the installed property control');
  }

  await q(`window.api.pluginsExtensionViewOpen(${literal(ID + '.panel')})`);
  check(await page.until(`(await window.api.pluginsExtensionExecute(${literal(ID + '.proof')}, {})).view !== null`, 30000), 'the installed view preload and packaged scripts reach the worker');
  const view = (await run('proof')).view;
  check(view.id === ID + '.panel' && view.node === 'undefined' && view.editorBridge === 'undefined' && view.wasm === true && view.color === 'rgb(24, 145, 83)' && !!view.theme,
    'the isolated installed view loads query assets, CSS, theme and WebAssembly without Node/editor access', view);
  const viewState = `(() => {
    const page = process.mainModule.require('electron').webContents.getAllWebContents().find(contents => contents.getURL().includes('/assets/panel.html'));
    if (!page) return null;
    const prefs = page.getLastWebPreferences();
    const owner = process.mainModule.require('electron').BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('index.html'));
    return page.executeJavaScript('document.querySelector("output").textContent').then(text => ({text, url: page.getURL(),
      separateProcess: !!owner && owner.webContents.getOSProcessId() !== page.getOSProcessId(), sandbox: prefs.sandbox, contextIsolation: prefs.contextIsolation}));
  })()`;
  check(await main.until(`(await (${viewState}))?.text === ${literal(JSON.stringify({kind: 'reply', label: 'Persisted packaged marker'}))}`, 10000), 'worker replies reach the installed isolated view');
  const nativeView = await main.evaluate(viewState);
  check(nativeView.sandbox === true && nativeView.contextIsolation === true && nativeView.separateProcess === true,
    'the installed view uses a separate sandboxed renderer with context isolation', nativeView);
  await q(`window.api.pluginsExtensionViewClose(${literal(ID + '.panel')})`);

  if (!reopen) {
    await q(`window.api.pluginsExtensionStop(${literal(fixture.key)})`);
    check(await page.until(`!document.querySelector(${literal(action)})`, 10000) && !(await q(running)), 'Stop removes the installed extension registrations');
    const stopped = await q(`window.api.pluginsExtensionExecute(${literal(ID + '.proof')}, {}).then(() => null, error => error.message)`);
    check(typeof stopped === 'string', 'automatic command dispatch cannot undo an explicit Stop', stopped);
    await q(`window.api.pluginsExtensionTrust(${literal(fixture.key)})`);
    check(await page.until(running, 30000), 'the already trusted extension explicitly starts again');
    const answered = await restoreDialogs(main);
    check(answered.pending === 0 && answered.seen.length === 3, 'only the archive picker and two explicit trust decisions were supplied', answered);
    return {proof, view, nativeView, dialogs: answered};
  }
  await q(`window.api.pluginsRemove(${literal(fixture.key)})`);
  check(await page.until(`!document.querySelector(${literal(action)})`, 10000) && !(await q(running)), 'removal stops the worker and removes its UI');
  const inventory = await q('window.api.pluginsList()');
  check(!inventory.some(row => row.key === fixture.key), 'the extension is absent from installed inventory after removal');
  return {proof, view, nativeView};
}

module.exports = {prepare, exercise, restoreDialogs};
