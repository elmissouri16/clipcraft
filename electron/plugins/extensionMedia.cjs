// Host-owned artifacts bridge trusted Node output into the editor's media model.
// A temporary source is copied and inspected before the extension receives a handle.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const {pipeline} = require('node:stream/promises');
const {Transform} = require('node:stream');
const {inspect} = require('../media/inspectArtifact.cjs');
const SUFFIXES = new Set(['.png','.jpg','.jpeg','.webp','.bmp','.mp4','.mov','.mkv','.webm','.avi','.m4v','.wav','.mp3','.m4a','.aac','.ogg','.flac','.aiff','.opus']);
const MAX_BYTES = 512 * 1024 * 1024;
const check = signal => { if (signal.aborted) throw Error('Extension media operation canceled'); };

class ExtensionMedia {
  constructor({root, isActive, inspectFile = inspect}) {
    Object.assign(this, {root, isActive, inspectFile});
    this.records = new Map();
    this.running = new Map();
    this.leases = new Map();
  }
  assertOwner(job) {
    if (!this.isActive(job)) throw Error('Extension is no longer active');
  }
  async import(job, input) {
    this.assertOwner(job);
    if (!input || typeof input !== 'object') throw Error('Provide a local path or media bytes');
    const fromPath = typeof input.path === 'string';
    if (fromPath === (input.bytes !== undefined)) throw Error('Provide exactly one of path or bytes');
    const suffix = path.extname(fromPath ? input.path : input.name || '').toLowerCase();
    if (!SUFFIXES.has(suffix)) throw Error('Unsupported extension media format');
    if (fromPath && !path.isAbsolute(input.path)) throw Error('Media source must be an absolute local path');
    if ([...this.running.values()].reduce((total,set)=>total+set.size,0) >= 8) throw Error('Too many concurrent media imports');
    if (this.records.size >= 256) throw Error('Release unused media artifacts before importing more');
    const controller = new AbortController();
    const deadline = setTimeout(() => controller.abort(), 300000);
    const operations = this.running.get(job) || new Set();
    this.running.set(job, operations);operations.add(controller);
    const id = crypto.randomUUID(), directory = path.join(this.root, 'pending', id), file = path.join(directory, 'media' + suffix);
    let kept = false;
    try {
      await fsp.mkdir(directory, {recursive:true});
      if (fromPath) {
        const stat = await fsp.lstat(input.path);
        if (!stat.isFile() || !stat.size || stat.size > MAX_BYTES) throw Error('Choose a regular media file of at most 512 MiB');
        let copied = 0;
        await pipeline(fs.createReadStream(input.path), new Transform({transform(chunk, _encoding, done) {
          copied += chunk.length;done(copied > MAX_BYTES ? Error('Media source exceeds 512 MiB') : null, chunk);
        }}), fs.createWriteStream(file, {flags:'wx'}), {signal:controller.signal});
      } else {
        if (!(input.bytes instanceof Uint8Array) || !input.bytes.byteLength || input.bytes.byteLength > 32 * 1024 * 1024) throw Error('Media bytes must contain 1–32 MiB; use a local path for larger files');
        await fsp.writeFile(file, input.bytes, {flag:'wx'});
      }
      check(controller.signal);
      const metadata = await this.inspectFile(file, controller.signal);
      check(controller.signal);this.assertOwner(job);
      const name = typeof input.name === 'string' ? input.name : path.basename(input.path);
      if (!name || name.length > 240 || /[\u0000-\u001f]/.test(name)) throw Error('Invalid media name');
      const record = {id, job, directory, file, metadata, name, adopted:false};
      this.records.set(id, record);kept = true;
      return {id, name, ...metadata, bytes:(await fsp.stat(file)).size};
    } finally {
      clearTimeout(deadline);operations.delete(controller);
      if (!operations.size) this.running.delete(job);
      if (!kept) await fsp.rm(directory, {recursive:true,force:true});
    }
  }
  get(job, id) {
    this.assertOwner(job);
    const record = this.records.get(id);
    if (!record || record.job !== job) throw Error('Media artifact is unavailable or belongs to another extension activation');
    return record;
  }
  ownership(record,work){const next=(record.ownership||Promise.resolve()).catch(()=>{}).then(work);record.ownership=next;return next;}
  async item(job, id, adopt = false, lease = null) {
    const record = this.get(job,id);
    if(adopt&&lease){record.leases??=new Set();record.leases.add(lease);const records=this.leases.get(lease)||new Set();records.add(record);this.leases.set(lease,records);}
    if(adopt)await this.ownership(record,async()=>{
     if(lease&&!record.leases.has(lease))throw Error('Staged media insertion canceled');
     if(!record.owned){
      const folder = path.join(this.root,'owned');await fsp.mkdir(folder,{recursive:true});
      const file = path.join(folder, record.id + path.extname(record.file));
      await fsp.copyFile(record.file,file,fs.constants.COPYFILE_EXCL);
      record.owned = file;
     }
      // Once offered to the editor, retain the durable file even if the reply is
      // lost after a commit. An uncertain response must never delete project media.
      if(!lease)record.adopted = true;
    });
    this.assertOwner(job);
    return {id:record.id, path:adopt ? record.owned : record.file, name:record.name, ...record.metadata, origin:'plugin-media'};
  }
  async release(job, id) {
    const record = this.get(job,id);
    if (record.previewing) throw Error('Close the preview before releasing its artifact');
    this.records.delete(id);
    // A hook can release its handle immediately after staging an insertion. The
    // draft still owns a lease on its bytes until commit/rollback settles.
    if(record.leases?.size){record.releaseRequested=true;return true;}
    await record.ownership?.catch(()=>{});await fsp.rm(record.directory,{recursive:true,force:true});
    return true;
  }
  async commitLease(id){
    const records=this.leases.get(id)||[];this.leases.delete(id);
    await Promise.all([...records].map(record=>this.ownership(record,async()=>{record.adopted=true;record.leases.delete(id);if(record.releaseRequested&&!record.leases.size)await fsp.rm(record.directory,{recursive:true,force:true});})));
  }
  async releaseLease(id){
    const records=this.leases.get(id)||[];this.leases.delete(id);
    await Promise.all([...records].map(record=>this.ownership(record,async()=>{record.leases.delete(id);if(!record.adopted&&!record.leases.size&&record.owned){await fsp.rm(record.owned,{force:true});record.owned=null;}if(record.releaseRequested&&!record.leases.size)await fsp.rm(record.directory,{recursive:true,force:true});})));
  }
  async stopped(job) {
    for (const controller of this.running.get(job) || []) controller.abort();
    const records = [...this.records.values()].filter(r=>r.job === job);
    for (const record of records) {this.records.delete(record.id);await record.ownership?.catch(()=>{});await fsp.rm(record.directory,{recursive:true,force:true});}
  }
}
module.exports = {ExtensionMedia};
