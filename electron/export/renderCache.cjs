const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
function reapRenderCaches(root=os.tmpdir()) {
  for(const entry of fs.readdirSync(root,{withFileTypes:true})) {
    if(!entry.isDirectory()||!/^clipcraft-render-cache-[A-Za-z0-9]+$/.test(entry.name))continue;
    const dir=path.join(root,entry.name);
    try {
      const owner=JSON.parse(fs.readFileSync(path.join(dir,'.owner.json'),'utf8'));
      if(owner.kind!=='clipcraft-render-cache'||!Number.isSafeInteger(owner.pid)||owner.pid<1)continue;
      try {process.kill(owner.pid,0);}catch(error){if(error.code==='ESRCH')fs.rmSync(dir,{recursive:true,force:true});}
    }catch{ /* Legacy/unrecognized caches or another live owner stay untouched. */ }
  }
}

// Session cache: canceled/partial jobs never enter it. Source fingerprints and
// renderer versions invalidate stale work; byte/entry limits bound disk usage.
class RenderCache {
  constructor({maxBytes=512*1024*1024,maxEntries=32}={}) {this.maxBytes=maxBytes;this.maxEntries=maxEntries;this.entries=new Map();this.dir=null;this.bytes=0;}
  key(value,files=[]) {
    try {
      const versions=files.filter(Boolean).map(file=>{const s=fs.statSync(file);return [file,s.dev,s.ino,s.size,s.mtimeMs,s.ctimeMs];});
      return crypto.createHash('sha256').update(JSON.stringify([value,versions])).digest('hex');
    }catch{return null;}
  }
  get(key) {
    if(!key)return null;const entry=this.entries.get(key);if(!entry)return null;
    let valid=false;try{valid=fs.statSync(entry.file).size===entry.bytes;}catch{}
    if(!valid){this.entries.delete(key);this.bytes-=entry.bytes;try{fs.rmSync(entry.file,{force:true});}catch{}return null;}
    this.entries.delete(key);this.entries.set(key,entry);return entry.file;
  }
  async put(key,file,{immutable=false}={}) {
    if(!key)return null;
    const bytes=(await fs.promises.stat(file)).size;if(bytes>this.maxBytes)return null;
    if(!this.dir){
      reapRenderCaches();this.dir=fs.mkdtempSync(path.join(os.tmpdir(),'clipcraft-render-cache-'));
      fs.writeFileSync(path.join(this.dir,'.owner.json'),JSON.stringify({kind:'clipcraft-render-cache',pid:process.pid}));
    }
    const output=path.join(this.dir,key+path.extname(file)),partial=output+'.part';
    try {
      if(immutable){
        try {await fs.promises.link(file,partial);}
        catch(error){if(!require('../system/hardLinks.cjs').hardLinkUnsupported(error))throw error;await fs.promises.copyFile(file,partial);}
      }else await fs.promises.copyFile(file,partial);
      await fs.promises.rename(partial,output);
    }
    catch(error){await fs.promises.rm(partial,{force:true}).catch(()=>{});throw error;}
    const old=this.entries.get(key);if(old)this.bytes-=old.bytes;
    this.entries.delete(key);this.entries.set(key,{file:output,bytes});this.bytes+=bytes;
    while(this.bytes>this.maxBytes||this.entries.size>this.maxEntries) {
      const oldest=this.entries.keys().next().value,entry=this.entries.get(oldest);
      this.entries.delete(oldest);this.bytes-=entry.bytes;fs.rmSync(entry.file,{force:true});
    }
    return output;
  }
  clear() {this.entries.clear();this.bytes=0;if(this.dir)fs.rmSync(this.dir,{recursive:true,force:true});this.dir=null;}
}
module.exports={RenderCache,reapRenderCaches};
