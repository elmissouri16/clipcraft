// The motion-graphics sandbox only lets its own folder load; the allowed prefix must match the URL Chromium
// requests for sandbox.html on every install location: Windows drive paths (file:///C:/…), spaces and
// non-ASCII names are percent-encoded. Usage: node tests/unit/agents/test-graphics-sandbox-url.cjs
const assert = require('node:assert/strict'), path = require('node:path');
const { ownPrefix } = require('../../../electron/graphics/render.cjs');

const cases = [
  ['C:\\Users\\Sam\\AppData\\Local\\Programs\\ClipCraft\\resources\\app.asar\\electron\\graphics', true, 'file:///C:/Users/Sam/AppData/Local/Programs/ClipCraft/resources/app.asar/electron/graphics/sandbox.html'],
  ['C:\\Program Files\\ClipCraft\\resources\\app.asar\\electron\\graphics', true, 'file:///C:/Program%20Files/ClipCraft/resources/app.asar/electron/graphics/sandbox.html'],
  ['/Users/sam/Apps/ClipCraft 2.app/Contents/Resources/app.asar/electron/graphics', false, 'file:///Users/sam/Apps/ClipCraft%202.app/Contents/Resources/app.asar/electron/graphics/sandbox.html'],
  ['/home/zoë/Applications/ClipCraft/resources/app.asar/electron/graphics', false, 'file:///home/zo%C3%AB/Applications/ClipCraft/resources/app.asar/electron/graphics/sandbox.html'],
  ['/opt/ClipCraft/resources/app.asar/electron/graphics', false, 'file:///opt/ClipCraft/resources/app.asar/electron/graphics/sandbox.html'],
];
for (const [dir, windows, requested] of cases) {
  const own = ownPrefix(dir, { windows });
  assert.ok(requested.startsWith(own), `${dir}: ${own} allows ${requested}`);
  assert.ok(own.endsWith('/graphics/'), 'the prefix ends at the folder');
  assert.ok(!`${own.slice(0, -1)}-evil/page.html`.startsWith(own), 'a sibling folder is not allowed');
}
assert.ok(ownPrefix().startsWith('file:///') && ownPrefix().endsWith(path.basename(path.join(__dirname, '../../../electron/graphics')) + '/'));
console.log('graphics sandbox URL prefix matches Chromium request URLs for Windows, spaces and non-ASCII paths');
