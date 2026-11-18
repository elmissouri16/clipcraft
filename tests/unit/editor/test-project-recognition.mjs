// Opening a file as a project (Home, the Open dialog, an outside agent's open_project) registers it as
// the auto save target only when it is a ClipCraft project: any other JSON file would be rewritten as
// one. electron/project/projectfile.cjs isProjectDocument is the check project:open and project:openPath
// make before adopting the file. Usage: node tests/unit/editor/test-project-recognition.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { emptyProject } from '../../../src/state/store.js';
import { serializeProjectParts } from '../../../src/state/projectSerialization.js';
const { isProjectDocument, checkGenerated } = createRequire(import.meta.url)('../../../electron/project/projectfile.cjs');

// What the app saves is recognised, also a project saved by an older version with its lists only.
const { doc } = await serializeProjectParts({ ...emptyProject(), name: 'Saved' });
assert.equal(isProjectDocument(doc.pretty), true, 'a saved project is a project');
assert.equal(isProjectDocument(doc.compact), true, 'a compact saved project is a project');
assert.equal(isProjectDocument(JSON.stringify(emptyProject())), true);
assert.equal(isProjectDocument('{"name":"Old","media":[],"videoClips":[],"audioClips":[]}'), true);

// Other JSON files are not, even after the generated-files pass added a media list to them.
const packageJson = '{\n  "name": "my-app",\n  "version": "1.0.0",\n  "scripts": { "build": "vite build" }\n}\n';
for (const text of [packageJson, '{"userID": 12345678901234567890, "theme": "dark"}', '[]', 'null', '42', '"x"', 'not json', '',
  '{"media": [], "name": "no main track"}', '{"media": {}, "videoClips": []}', '{"media": [], "videoClips": "x"}']) {
  assert.equal(isProjectDocument(text), false, `not a project: ${text.slice(0, 40)}`);
}
assert.equal(isProjectDocument(checkGenerated(packageJson, null)), false, 'the media list checkGenerated adds does not make a project');
console.log('project recognition ok: saved projects open, other JSON files never become auto save targets');
