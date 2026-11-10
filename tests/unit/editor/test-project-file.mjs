// The project document and its chat sidecar (src/state/projectFile.js, electron/project/sidecar.cjs,
// docs/architecture/project-file.md): the split, exact change detection, the merge on load with the
// sidecar winning over an embedded legacy chat, the sidecar path, atomic write and removal.
// Usage: node tests/unit/editor/test-project-file.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { projectDoc, projectChat, sameDoc, mergeChat, classifyChange } from '../../../src/state/projectFile.js';
import { serializeProjectParts } from '../../../src/state/projectSerialization.js';
const sidecar = createRequire(import.meta.url)('../../../electron/project/sidecar.cjs');

const checks = [], check = (name, ok) => { assert.ok(ok, name); checks.push(name); };
const chat = { version: 1, sessions: [{ id: 's1', title: 'Chat', messages: [{ role: 'user', text: 'Hi' }], contents: [], draft: '', timelineAttachments: [], images: [], videos: [], queue: [], queuePaused: false }], activeSessionId: 's1' };
const empty = { version: 1, sessions: [{ id: 's0', title: 'New chat', messages: [], contents: [], draft: '', timelineAttachments: [], images: [], videos: [], queue: [], queuePaused: false }], activeSessionId: 's0' };
const p = { id: 'p', name: 'Doc', media: [], videoClips: [{ id: 'v1' }], craftAI: chat };

const doc = projectDoc(p);
check('the document is the project without its chat', !('craftAI' in doc) && doc.videoClips === p.videoClips && doc.name === 'Doc');
check('the same project gives the same document object (serializer cache hits)', projectDoc(p) === doc);
check('a chat with content is stored; an empty default chat is not', projectChat(p) === chat && projectChat({ ...p, craftAI: empty }) === null && projectChat({ ...p, craftAI: undefined }) === null);
check('a chat-only change keeps the document the same', sameDoc(p, { ...p, craftAI: { ...chat, activeSessionId: null } }));
check('a timeline change is a document change', !sameDoc(p, { ...p, videoClips: [{ id: 'v1' }] }) && !sameDoc(p, { ...p, name: 'Other' }));
check('an added or removed field is a document change', !sameDoc(p, { ...p, posterAt: 1 }) && !sameDoc({ ...p, posterAt: 1 }, p));
check('sameDoc is safe on null', !sameDoc(null, p) && sameDoc(p, p));
check('the sidecar merges into craftAI', mergeChat({ id: 'p' }, JSON.stringify(chat)).craftAI.activeSessionId === 's1');
check('the sidecar wins over an embedded legacy chat', mergeChat({ id: 'p', craftAI: empty }, JSON.stringify(chat)).craftAI.sessions[0].id === 's1');
check('no sidecar keeps the embedded chat; a torn sidecar is ignored', mergeChat({ id: 'p', craftAI: empty }, null).craftAI === empty && mergeChat({ id: 'p', craftAI: empty }, '{oops').craftAI === empty && mergeChat({ id: 'p' }, '[1]').craftAI === undefined);
// Change classification is conservative: only a clean chat swap skips the document.
const swapped = { ...p, craftAI: { ...chat, activeSessionId: null } };
check('a clean chat swap is chat-only', JSON.stringify(classifyChange(p, swapped)) === '{"doc":false,"chat":true}');
check('a timeline edit is a document change without a chat write', JSON.stringify(classifyChange(p, { ...p, videoClips: [] })) === '{"doc":true,"chat":false}');
check('a chat swap together with any other change writes both', JSON.stringify(classifyChange(p, { ...swapped, name: 'Both' })) === '{"doc":true,"chat":true}');
const mutated = { ...p }; mutated.videoClips.push({ id: 'v2' }); // in place, behind a fresh object
check('a fresh object with no differing field still writes the document (in-place mutation)', classifyChange(p, mutated).doc === true && classifyChange(p, mutated).chat === false);
check('no snapshot before means both; the same snapshot means neither', classifyChange(null, p).doc && classifyChange(null, p).chat && !classifyChange(p, p).doc && !classifyChange(p, p).chat);
const parts = await serializeProjectParts(p);
check('serializeProjectParts gives the document and the chat apart', !JSON.parse(parts.doc.compact).craftAI && JSON.parse(parts.chat.compact).activeSessionId === 's1' && JSON.parse(parts.doc.pretty).name === 'Doc');
check('a project without chat content serializes no chat', (await serializeProjectParts({ ...p, craftAI: empty })).chat === null);

// main-process sidecar
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-sidecar-')), file = path.join(dir, 'My video.clipcraft.json');
check('the sidecar sits next to the file with the .chat.json suffix', sidecar.chatPath(file) === path.join(dir, 'My video.clipcraft.chat.json') && sidecar.chatPath('/x/a.JSON') === '/x/a.chat.json');
check('no sidecar reads as null', sidecar.readChat(file) === null);
sidecar.writeChat(file, JSON.stringify(chat));
check('the chat is written atomically and reads back', JSON.parse(sidecar.readChat(file)).activeSessionId === 's1' && !fs.existsSync(`${sidecar.chatPath(file)}.part`));
check('mergeChat in the main process matches the renderer', sidecar.mergeChat({ id: 'p' }, sidecar.readChat(file)).craftAI.sessions.length === 1 && sidecar.mergeChat({ id: 'p', craftAI: empty }, '{').craftAI === empty);
// Precedence: a document that embeds a chat and is newer than the sidecar wins (an older app saved it).
fs.writeFileSync(file, '{"id":"p"}');
const past = new Date(Date.now() - 60000);
fs.utimesSync(sidecar.chatPath(file), past, past);
check('a sidecar older than a document without an embedded chat still loads', JSON.parse(sidecar.readChat(file, '{"id":"p"}')).activeSessionId === 's1');
check('an embedded chat in a newer document wins over the sidecar', sidecar.readChat(file, '{"id":"p","craftAI":{"version":1}}') === null);
fs.utimesSync(sidecar.chatPath(file), new Date(Date.now() + 60000), new Date(Date.now() + 60000));
check('a sidecar newer than the embedding document wins', sidecar.readChat(file, '{"id":"p","craftAI":{"version":1}}') !== null);
check('picking the sidecar in Open gives its document; a lone sidecar stays as picked', sidecar.documentFor(sidecar.chatPath(file)) === file && sidecar.documentFor(path.join(dir, 'lone.clipcraft.chat.json')) === path.join(dir, 'lone.clipcraft.chat.json') && sidecar.documentFor(file) === file);
sidecar.writeChat(file, null);
check('null removes the sidecar', !fs.existsSync(sidecar.chatPath(file)) && sidecar.readChat(file) === null);
sidecar.writeChat(file, null);
check('removing a missing sidecar is fine', true);
fs.rmSync(dir, { recursive: true, force: true });
console.log(`project file: ${checks.length} checks passed`);
