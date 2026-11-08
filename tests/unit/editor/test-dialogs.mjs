// Native message boxes with a fallback to the page functions (used by UI test stubs).
// Usage: node tests/unit/editor/test-dialogs.mjs
import assert from 'node:assert/strict';
const calls = [];
globalThis.window = { alert: m => calls.push(['alert', m]), confirm: m => (calls.push(['confirm', m]), false), api: { messageBoxSync: req => (calls.push(['native', req.kind, req.confirmLabel]), { confirmed: true }) } };
const { showAlert, askConfirm } = await import('../../../src/app/dialogs.js');
showAlert('Could not import:\nclip.mov: unsupported');
assert.equal(askConfirm('Remove "a.mp4"?', 'Remove'), true);
assert.deepEqual(calls, [['native', 'alert', undefined], ['native', 'confirm', 'Remove']], 'the native box is used when available');
calls.length = 0; window.api.messageBoxSync = () => ({ unavailable: true });
showAlert('x'); assert.equal(askConfirm('y'), false);
assert.deepEqual(calls.map(c => c[0]), ['alert', 'confirm'], 'test runs fall back to the page functions');
calls.length = 0; window.api.messageBoxSync = () => { throw new Error('no host'); };
showAlert('z'); assert.deepEqual(calls.map(c => c[0]), ['alert']);
console.log('dialogs ok: native boxes, fallback for tests and missing hosts');
