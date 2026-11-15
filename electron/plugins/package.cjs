// Package bytes are validated before install/execution. Never extract archive paths to disk.
const fs = require('node:fs/promises'), path = require('node:path'), crypto = require('node:crypto'), tar = require('tar');
const panelLimits = { 'panel.html': 64 * 1024, 'panel.js': 64 * 1024, 'panel.css': 32 * 1024 };
const allowed = ['plugin.json', 'commands.js', ...Object.keys(panelLimits)];
const fileLimit = (name, manifestLimit, commandLimit) => name === 'plugin.json' ? manifestLimit : panelLimits[name] || commandLimit;
const contract = import('../../shared/pluginManifest.mjs'), commands = import('../../shared/pluginCommands.mjs');
function fingerprint(files) {
    const hash = crypto.createHash('sha256');
    if (files.has('panel.html')) hash.update('clipcraft-panel-v1\0');
    if (files.has('commands.js')) hash.update('clipcraft-command-v1\0');
    hash.update(files.get('plugin.json'));
    if (files.has('commands.js')) hash.update('\0commands.js\0').update(files.get('commands.js'));
    for (const name of Object.keys(panelLimits)) if (files.has(name)) hash.update(`\0${name}\0`).update(files.get(name));
    return hash.digest('hex');
}
async function readFolder(directory) {
    const { MANIFEST_LIMIT } = await contract, { COMMAND_CODE_LIMIT } = await commands;
    if (!(await fs.lstat(directory)).isDirectory()) throw Error('Plugin folder must be a regular directory.');
    const entries = await fs.readdir(directory, { withFileTypes: true });
    if (!entries.length || entries.length > 5 || entries.some(e => !e.isFile() || !allowed.includes(e.name))) throw Error('Folder must contain only plugin.json and declared command/panel files (no links or other files).');
    const files = new Map();
    for (const entry of entries) {
        const file = path.join(directory, entry.name), limit = fileLimit(entry.name, MANIFEST_LIMIT, COMMAND_CODE_LIMIT), stat = await fs.lstat(file);
        if (!stat.isFile() || stat.size > limit) throw Error('Plugin file exceeds its size limit or is not regular.');
        const bytes = await fs.readFile(file); if (bytes.length > limit) throw Error('Plugin file exceeds its size limit.'); files.set(entry.name, bytes);
    }
    return files;
}
async function readArchive(source) {
    const stat = await fs.lstat(source); if (!stat.isFile() || stat.size > 2 * 1024 * 1024) throw Error('Choose a regular plugin package under 2 MiB.');
    const compressed = await fs.readFile(source); if (compressed.length > 2 * 1024 * 1024) throw Error('Plugin archive is too large.');
    const bytes = await require('node:util').promisify(require('node:zlib').gunzip)(compressed, { maxOutputLength: 512 * 1024 });
    const { MANIFEST_LIMIT } = await contract, { COMMAND_CODE_LIMIT } = await commands;
    const files = new Map(); let invalid = false, entries = 0;
    await new Promise((resolve, reject) => {
        const parser = tar.t({
            strict: true, maxMetaEntrySize: MANIFEST_LIMIT, onReadEntry: entry => {
                entries++; const limit = fileLimit(entry.path, MANIFEST_LIMIT, COMMAND_CODE_LIMIT);
                if (entries > 5 || !allowed.includes(entry.path) || files.has(entry.path) || entry.type !== 'File' || entry.size > limit) { invalid = true; return; }
                const chunks = []; files.set(entry.path, chunks); entry.on('data', chunk => chunks.push(chunk));
            }
        }); parser.on('error', reject); parser.on('end', resolve); parser.end(bytes);
    });
    if (invalid || !files.has('plugin.json')) throw Error('Package must contain only one regular plugin.json and its declared command/panel assets.');
    return new Map([...files].map(([name, chunks]) => [name, Buffer.concat(chunks)]));
}
async function validateFiles(files, appVersion) {
    const { validateManifest, MANIFEST_LIMIT } = await contract, { COMMAND_CODE_LIMIT } = await commands;
    const bytes = files.get('plugin.json'); if (!bytes || bytes.length > MANIFEST_LIMIT) throw Error('Plugin manifest is missing or too large.');
    const manifest = validateManifest(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)), appVersion);
    const panel = manifest.contributes.panels?.[0], expected = ['plugin.json', ...(manifest.entry ? ['commands.js'] : []), ...(panel ? [panel.entry, panel.script, panel.style].filter(Boolean) : [])];
    if (files.size !== expected.length || expected.some(name => !files.has(name))) throw Error('Package files must match the declared entry and panel assets.');
    for (const name of expected.filter(name => panelLimits[name])) { const source = files.get(name); if (!source.length || source.length > panelLimits[name]) throw Error('Panel asset exceeds its size limit.'); const value = new TextDecoder('utf-8', { fatal: true }).decode(source); if (value.includes('\0')) throw Error('Panel assets must be UTF-8 text without NUL bytes.'); }
    let code;
    if (manifest.entry) { const source = files.get(manifest.entry); if (!source.length || source.length > COMMAND_CODE_LIMIT) throw Error('Command entry must contain at most 64 KiB of UTF-8 code.'); code = new TextDecoder('utf-8', { fatal: true }).decode(source); }
    return { manifest, key: fingerprint(files), code, files };
}
module.exports = { readFolder, readArchive, validateFiles, fingerprint };
