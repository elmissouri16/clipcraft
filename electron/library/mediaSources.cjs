// The editor discovers services through the Node extension runtime. Only verified media handles
// can become project files. Source credentials and network transport stay inside each extension.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const KINDS = ['photo', 'video', 'music', 'sfx', 'trolls'];
const short = value => typeof value === 'string' && value.length > 0 && value.length <= 240;
const usable = entry => entry.kind === 'integration' && entry.point === 'media.sources';
const mediaType = kind => kind === 'photo' ? 'image' : kind === 'video' ? 'video' : 'audio';
function description(entry, value) {
  if (!Array.isArray(value?.kinds) || !value.kinds.length || value.kinds.some(kind => !KINDS.includes(kind))) throw Error('Invalid media source kinds.');
  const categories = {};
  for (const kind of value.kinds) {
    const options = value.categories?.[kind] || [];
    if (!Array.isArray(options) || options.length > 100 || !options.every(short)) throw Error('Invalid media source categories.');
    categories[kind] = [...new Set(options)];
  }
  return {id:entry.service, key:entry.key, name:entry.title, kinds:value.kinds, categories,
    configured:value.configured !== false, attribution:value.attribution === true, orientation:value.orientation === true,
    licenseSummary:short(value.licenseSummary) ? value.licenseSummary : '', sourceLinks:value.sourceLinks === true, notice:short(value.notice) ? value.notice : ''};
}

// Search results may carry vendor data back to the same service. Local file fields are host-only.
function resultItem(value, entry, kind) {
  if (!['string', 'number'].includes(typeof value?.id) || !short(String(value.id)) || JSON.stringify(value).length > 15500) throw Error('Invalid media search item.');
  const {path:ignoredPath, sourceId:ignoredSource, ...data} = value;
  for (const key of ['title','name','user','creator','thumb','category','license','licenseName','landing']) {
    if (data[key] != null && typeof data[key] !== 'string') throw Error('Invalid media search field: ' + key);
  }
  if (data.tags != null && typeof data.tags !== 'string' && !(Array.isArray(data.tags) && data.tags.every(tag => typeof tag === 'string'))) throw Error('Invalid media tags.');
  if (data.duration != null && !(Number.isFinite(data.duration) && data.duration >= 0)) throw Error('Invalid media duration.');
  const title = [data.title, data.tags, data.name, String(data.id)].find(value => typeof value === 'string' && value.trim());
  return {...data, id:String(data.id), title, kind, sourceId:entry.service, sourceName:entry.title};
}

async function publishFile(source, destination) {
  try { await fsp.link(source, destination); return; }
  catch (error) {
    if (error.code === 'EEXIST') return;
    if (!['EXDEV','EPERM','ENOTSUP','EOPNOTSUPP','ENOSYS'].includes(error.code)) throw error;
  }
  const temporary = destination + '.' + crypto.randomUUID() + '.part';
  try {
    await fsp.copyFile(source, temporary, fs.constants.COPYFILE_EXCL);
    await fsp.rename(temporary, destination);
  } finally { await fsp.rm(temporary, {force:true}); }
}

class MediaSources {
  constructor(manager, directory, probe) {
    this.manager = manager;
    this.directory = directory;
    this.probe = probe;
  }
  async entries() {
    await this.manager.ready;
    const extensions = this.manager.extensions;
    await extensions.activate('ui:media.sources', {continueOnError:true});
    return extensions.ui.list().filter(usable);
  }
  async catalog() {
    const entries = await this.entries();
    const results = await Promise.allSettled(entries.map(async entry => description(entry,
      await this.manager.extensions.callService(entry.service, 'describe', {}, {timeoutMs:10000}))));
    return results.flatMap(result => result.status === 'fulfilled' ? [result.value] : []);
  }
  async entry(id) {
    if (!short(id)) throw Error('Choose an enabled media source.');
    const lookup = list => list.find(entry => usable(entry) && entry.service === id);
    const entry = lookup(this.manager.extensions.ui.list()) || lookup(await this.entries());
    if (!entry) throw Error('This media source is unavailable. Enable its extension in Plugins.');
    return entry;
  }
  async search(input, signal) {
    if (!KINDS.includes(input.kind)) throw Error('Unsupported media kind.');
    let source;
    if (input.provider?.includes('.')) {
      const entry = await this.entry(input.provider);
      const details = description(entry, await this.manager.extensions.callService(entry.service, 'describe', {}, {signal}));
      if (details.kinds.includes(input.kind)) source = details;
    } else {
      const matches = (await this.catalog()).filter(row => row.kinds.includes(input.kind));
      source = input.provider ? matches.find(row => row.name.toLowerCase() === String(input.provider).toLowerCase()) : matches[0];
    }
    if (!source) throw Error('No enabled media source for this request. Check Plugins.');
    if (!source.configured) throw Error('Configure ' + source.name + ' in Settings → Plugins.');
    const entry = await this.entry(source.id);
    const {requestId,provider,...params} = input;
    const value = await this.manager.extensions.callService(entry.service, 'search', params, {signal});
    if (!Array.isArray(value?.results) || value.results.length > 100 || ![value.page,value.pages,value.total].every(n => Number.isSafeInteger(n) && n >= 0)) throw Error('Invalid media search page.');
    return {page:value.page, pages:value.pages, total:value.total, results:value.results.map(item => ({...resultItem(item, entry, input.kind), sourceLinks:source.sourceLinks}))};
  }
  async preview(item, signal) {
    const entry = await this.entry(item.sourceId);
    const runtime = this.manager.extensions;
    const job = runtime.services.get(entry.service)?.job;
    if (!job) throw Error('Media source is unavailable.');
    const result = await runtime.callService(entry.service, 'preview', {item}, {signal});
    const [file,cache] = await Promise.all([fsp.realpath(result.path), fsp.realpath(path.join(job.storage, 'media-cache'))]);
    const relative = path.relative(cache, file);
    if (relative.startsWith('..') || path.isAbsolute(relative) || !relative || !/\.(png|jpe?g|webp|gif|mp3|wav|ogg|flac|aac|m4a|opus)$/i.test(file) || !(await fsp.stat(file)).isFile()) throw Error('Invalid media source preview.');
    if (runtime.services.get(entry.service)?.job !== job) throw Error('Media source stopped.');
    return {path:file};
  }
  async source(item) {
    const entry = await this.entry(item.sourceId);
    const result = await this.manager.extensions.callService(entry.service, 'source', {item});
    const url = new URL(result.url);
    if (url.protocol !== 'https:' || url.username || url.password) throw Error('Invalid media source link.');
    return url.href;
  }
  async download(item, signal) {
    const entry = await this.entry(item.sourceId);
    const runtime = this.manager.extensions, media = this.manager.extensionMedia;
    const job = runtime.services.get(entry.service)?.job;
    if (!job) throw Error('Media source is unavailable.');
    const {artifact,credit} = await runtime.callService(entry.service, 'download', {item}, {signal});
    try {
      if (!credit || typeof credit !== 'object' || Array.isArray(credit) || JSON.stringify(credit).length > 16384 ||
        !Object.values(credit).every(value => typeof value === 'string' || typeof value === 'boolean')) throw Error('Invalid media credit.');
      const verified = await media.item(job, artifact.id);
      if (verified.type !== mediaType(item.kind)) throw Error('Downloaded media has the wrong type.');
      const hash = crypto.createHash('sha256').update(JSON.stringify([entry.service, item.id, credit])).update('\0');
      for await (const chunk of fs.createReadStream(verified.path, {signal})) hash.update(chunk);
      const dest = path.join(this.directory, hash.digest('hex') + path.extname(verified.path));
      await fsp.mkdir(this.directory, {recursive:true});
      await publishFile(verified.path, dest);
      const [probed] = await this.probe([dest]);
      if (probed.error) throw Error(probed.error);
      signal?.throwIfAborted();
      return {...probed, name:verified.name, credit};
    } finally {
      if (artifact?.id) await media.release(job, artifact.id).catch(() => {});
    }
  }
}
module.exports = {MediaSources};
