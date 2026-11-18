// toFileUrl: a backslash is a path separator only on Windows; on macOS and Linux it is part of a
// file name and must reach the player encoded. Usage: node tests/unit/editor/test-file-url.mjs
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { toFileUrl } from '../../../src/state/store.js';

for (const platform of ['darwin', 'linux']) {
  for (const path of ['/Users/me/Movies/AC\\DC live.mp4', '/home/me/clips/2024\\05 trip/a.mp4', '/home/me/a #1 100% ?.mp4', '/home/me/Vidéos/café.mp4'])
    assert.equal(fileURLToPath(toFileUrl(path, platform), { windows: false }).replace(/^\/+/, '/'), path, `${platform}: ${path}`);
}
assert.equal(fileURLToPath(toFileUrl('C:\\Users\\me\\Vidéos\\a #1 100%.mp4', 'win32'), { windows: true }), 'C:\\Users\\me\\Vidéos\\a #1 100%.mp4', 'Windows separators');
assert.equal(toFileUrl('C:\\clips\\a.mp4', 'win32'), 'file:///C:/clips/a.mp4');
console.log('File URLs keep backslashes in names on macOS/Linux and convert them on Windows');
