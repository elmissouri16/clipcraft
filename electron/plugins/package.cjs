// Package bytes are validated before install/execution. Never extract archive paths to disk.
const fs = require('node:fs/promises'), path = require('node:path'), crypto = require('node:crypto'), tar = require('tar');
const panelLimits = { 'panel.html': 64 * 1024, 'panel.js': 64 * 1024, 'panel.css': 32 * 1024 };
const {extensionFile:extensionPath,extensionDirectory,assertExtensionPaths,EXTENSION_LIMITS}=require('../../shared/pluginExtensionFiles.cjs');
const allowed = ['plugin.json', 'commands.js', ...Object.keys(panelLimits)];
const fileLimit = (name, manifestLimit, commandLimit) => extensionPath(name) ? 32*1024*1024 : name === 'plugin.json' ? manifestLimit : panelLimits[name] || (assetName(name) ? (/\.(wav|mp3|ogg)$/.test(name) ? 32 : name.endsWith('.cube')?16:8)*1024*1024 : commandLimit);
const content = import('../../shared/pluginContent.mjs');
const assetName = name => /^assets\/[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}\.(wav|mp3|ogg|woff2|ttf|otf|cube|png)$/.test(name);
const contract = import('../../shared/pluginManifest.mjs'),compatibility=import('../../shared/legacyPluginPackage.mjs');
const COMMAND_CODE_LIMIT=64*1024;
async function readRegularFile(file,limit,label){
    const stat=await fs.lstat(file);
    if(!stat.isFile()||stat.size>limit)throw Error(label+' must be a regular file within its size limit.');
    const handle=await fs.open(file,require('node:fs').constants.O_RDONLY|(require('node:fs').constants.O_NOFOLLOW||0));
    try{
        const opened=await handle.stat();
        if(!opened.isFile()||opened.size>limit||opened.dev!==stat.dev||opened.ino!==stat.ino)throw Error(label+' changed while opening.');
        let buffer=Buffer.alloc(Math.min(limit+1,opened.size+1)),size=0;
        while(true){
            if(size===buffer.length){const next=Buffer.alloc(Math.min(limit+1,Math.max(size+1,size*2)));buffer.copy(next,0,0,size);buffer=next;}
            const {bytesRead}=await handle.read(buffer,size,buffer.length-size,null);if(!bytesRead)break;size+=bytesRead;
            if(size>limit)throw Error(label+' exceeds its size limit.');
        }
        // Retain exact bytes, not an admission buffer's unused capacity.
        const bytes=Buffer.alloc(size);buffer.copy(bytes,0,0,size);return bytes;
    }finally{await handle.close();}
}
function fingerprint(files) {
    const hash = crypto.createHash('sha256');
    if (files.has('panel.html')) hash.update('clipcraft-panel-v1\0');
    if (files.has('commands.js')) hash.update('clipcraft-command-v1\0');
    hash.update(files.get('plugin.json'));
    if (files.has('commands.js')) hash.update('\0commands.js\0').update(files.get('commands.js'));
    for (const name of Object.keys(panelLimits)) if (files.has(name)) hash.update(`\0${name}\0`).update(files.get(name));
    for(const name of [...files.keys()].filter(assetName).sort()) hash.update(`\0${name}\0${files.get(name).length}\0`).update(files.get(name));
    return hash.digest('hex');
}
async function readFolder(directory) {
    const { MANIFEST_LIMIT } = await contract;
    if (!(await fs.lstat(directory)).isDirectory()) throw Error('Plugin folder must be a regular directory.');
    const { CONTENT_LIMITS } = await content;
    // Select the package format only from bounded, regular, strictly decoded
    // manifest bytes. Never read an arbitrary-size or linked file first.
    const manifestBytes=await readRegularFile(path.join(directory,'plugin.json'),MANIFEST_LIMIT,'Plugin manifest'),raw=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(manifestBytes));
    if(raw.main){
      const result=new Map(),pending=[''];let total=0,visited=0;
      while(pending.length){
        const rel=pending.pop();
        for await(const e of await fs.opendir(path.join(directory,rel))){
          if(++visited>EXTENSION_LIMITS.nodes)throw Error('Extension package exceeds directory resource limits');
          const name=rel?rel+'/'+e.name:e.name;
          if(e.isDirectory()&&extensionDirectory(name))pending.push(name);
          else if(e.isFile()&&(name==='plugin.json'||extensionPath(name))){
            if(result.size>=EXTENSION_LIMITS.files)throw Error('Extension package exceeds resource limits');
            const bytes=name==='plugin.json'?manifestBytes:await readRegularFile(path.join(directory,name),Math.min(EXTENSION_LIMITS.file,CONTENT_LIMITS.total-total),'Extension file');
            if((total+=bytes.length)>CONTENT_LIMITS.total)throw Error('Extension package exceeds resource limits');
            result.set(name,bytes);
          }else throw Error('Invalid extension file or link');
        }
      }
      return result;
    }
    const names=[];let visited=0;
    for await(const e of await fs.opendir(directory)){
        if(++visited>6+CONTENT_LIMITS.files)throw Error('Too many plugin files.');
        if(e.name==='assets'&&e.isDirectory()){
            const dir=path.join(directory,'assets');
            for await(const a of await fs.opendir(dir)) {if(++visited>6+CONTENT_LIMITS.files)throw Error('Too many plugin files.');if(!a.isFile()||!assetName('assets/'+a.name))throw Error('Invalid content asset (no links or subdirectories).');names.push('assets/'+a.name);}
        }else if(e.isFile()&&allowed.includes(e.name))names.push(e.name);
        else throw Error('Folder must contain only plugin.json and declared command/panel/content assets (no links or other files).');
    }
    if(!names.length||names.length>5+CONTENT_LIMITS.files)throw Error('Too many plugin files.');
    const files = new Map();let total=0;
    for (const name of names) {
        const file = path.join(directory,name), limit = fileLimit(name, MANIFEST_LIMIT, COMMAND_CODE_LIMIT), stat = await fs.lstat(file);
        if (!stat.isFile() || stat.size > limit) throw Error('Plugin file exceeds its size limit or is not regular.');
        const bytes = name==='plugin.json'?manifestBytes:await readRegularFile(file,Math.min(limit,CONTENT_LIMITS.total-total),'Plugin file');
        total+=bytes.length;if(total>CONTENT_LIMITS.total)throw Error('Plugin file exceeds its size limit.');files.set(name,bytes);
    }
    return files;
}
async function readArchive(source) {
    const {CONTENT_LIMITS}=await content;
    const stat = await fs.lstat(source); if (!stat.isFile() || stat.size > CONTENT_LIMITS.archive) throw Error('Choose a regular plugin package under 64 MiB.');
    const compressed = await readRegularFile(source,CONTENT_LIMITS.archive,'Plugin archive');
    // A supported file can need a 512-byte header, 511 bytes of padding and a
    // 1 KiB PAX path header. Count that separately from its admitted payload.
    const overhead = EXTENSION_LIMITS.files*2048+1024;
    const bytes = await require('node:util').promisify(require('node:zlib').gunzip)(compressed, { maxOutputLength: CONTENT_LIMITS.total+overhead });
    // tar also sniffs compressed input. It must never decompress again after
    // our bounded gunzip; another layer would bypass maxOutputLength.
    if(bytes[0]===0x1f&&bytes[1]===0x8b)throw Error('Plugin archive must contain a single gzip-compressed tar stream.');
    const { MANIFEST_LIMIT } = await contract;
    const files = new Map(); let invalid = false, entries = 0, total = 0;
    await new Promise((resolve, reject) => {
        const parser = tar.t({
            strict: true, brotli:false, zstd:false, maxMetaEntrySize: MANIFEST_LIMIT, onReadEntry: entry => {
                entries++; const limit = fileLimit(entry.path, MANIFEST_LIMIT, COMMAND_CODE_LIMIT);
                total+=entry.size;
                if (entries > EXTENSION_LIMITS.files || total>CONTENT_LIMITS.total || !(allowed.includes(entry.path)||assetName(entry.path)||extensionPath(entry.path)) || files.has(entry.path) || entry.type !== 'File' || entry.size > limit) { invalid = true; return; }
                const chunks = []; files.set(entry.path, chunks); entry.on('data', chunk => chunks.push(chunk));
            }
        }); parser.on('ignoredEntry',()=>{invalid=true;});parser.on('error', reject); parser.on('end', resolve); parser.end(bytes);
    });
    if (invalid || bytes.length-total>overhead || !files.has('plugin.json')) throw Error('Package must contain only one regular plugin.json and its declared command/panel/content assets within size limits.');
    return new Map([...files].map(([name, chunks]) => [name, Buffer.concat(chunks)]));
}
async function validateFiles(files, appVersion) {
    const { MANIFEST_LIMIT } = await contract;
    const bytes = files.get('plugin.json'); if (!bytes || bytes.length > MANIFEST_LIMIT) throw Error('Plugin manifest is missing or too large.');
    const {manifest,historical}=(await compatibility).readPackageManifest(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)),appVersion);
    const {contentAssets,validateContentBytes,CONTENT_LIMITS}=await content, assets=contentAssets(manifest);
    if(manifest.main){
      assertExtensionPaths(files.keys());
      if(files.size>EXTENSION_LIMITS.files||[...files].some(([name,bytes])=>name!=='plugin.json'&&bytes.length>EXTENSION_LIMITS.file))throw Error('Extension package exceeds resource limits');
      for(const [name,kind] of assets){if(!files.has(name))throw Error('Missing declared content asset');validateContentBytes(kind,files.get(name),name);}
      if(!files.has(manifest.main))throw Error('Invalid executable extension package');
      let total=0;for(const bytes of files.values())total+=bytes.length;if(total>CONTENT_LIMITS.total)throw Error('Extension package exceeds resource limits');
      return {manifest,files,key:require('node:crypto').createHash('sha256').update([...files].sort(([a],[b])=>a<b?-1:a>b?1:0).map(([name,bytes])=>name+'\0'+bytes.length+'\0'+require('node:crypto').createHash('sha256').update(bytes).digest('hex')).join('\0')).digest('hex')};
    }
    const panel = historical?.contributes.panels?.[0], expected = ['plugin.json', ...(historical?.entry ? ['commands.js'] : []), ...(panel ? [panel.entry, panel.script, panel.style].filter(Boolean) : []), ...assets.keys()];
    if (files.size !== expected.length || expected.some(name => !files.has(name))) throw Error('Package files must match the declared entry and panel assets.');
    for (const name of expected.filter(name => panelLimits[name])) { const source = files.get(name); if (!source.length || source.length > panelLimits[name]) throw Error('Panel asset exceeds its size limit.'); const value = new TextDecoder('utf-8', { fatal: true }).decode(source); if (value.includes('\0')) throw Error('Panel assets must be UTF-8 text without NUL bytes.'); }
    let total=0;for(const [name,source] of files){total+=source.length;if(assets.has(name))validateContentBytes(assets.get(name),source,name);}if(total>CONTENT_LIMITS.total)throw Error('Content pack exceeds 128 MiB.');
    if (historical?.entry) { const source = files.get(historical.entry); if (!source.length || source.length > COMMAND_CODE_LIMIT) throw Error('Command entry must contain at most 64 KiB of UTF-8 code.'); new TextDecoder('utf-8', { fatal: true }).decode(source); }
    return { manifest, key: fingerprint(files), files };
}
// Existing creative payloads retain their byte identity and read-only access.
// New installs/author builds/development snapshots must also materialize portably.
async function validateIntake(files,appVersion){
    const bundle=await validateFiles(files,appVersion);
    if(!bundle.manifest.main)assertExtensionPaths([...files.keys()].filter(name=>name==='plugin.json'||name.startsWith('assets/')));
    return bundle;
}
module.exports = { readFolder, readArchive, readRegularFile, validateFiles, validateIntake, fingerprint };
