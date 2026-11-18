// Exclusive publication of exact validated buffers; incomplete archives stay in private staging.
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {createWriteStream}=require('node:fs'),{Transform}=require('node:stream'),{pipeline}=require('node:stream/promises'),tar=require('tar');
async function writePackage(bundle,target,{signal,requireTgz=true}={}){
 const {CONTENT_LIMITS}=await import('../../shared/pluginContent.mjs');
 if(typeof target!=='string'||!path.isAbsolute(target)||requireTgz&&!target.toLowerCase().endsWith('.tgz'))throw Error('Choose a new .tgz archive filename.');
 const stage=await fs.mkdtemp(path.join(os.tmpdir(),'clipcraft-pack-write-'));let publication;
 try{
  for(const [name,bytes] of bundle.files){signal?.throwIfAborted();const file=path.join(stage,name);await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,bytes,{flag:'wx'});}
  signal?.throwIfAborted();publication=await fs.mkdtemp(path.join(path.dirname(target),'.clipcraft-pack-'));const archive=path.join(publication,'pack.tgz');let total=0;
  const cap=new Transform({transform(chunk,_encoding,next){total+=chunk.length;if(total>CONTENT_LIMITS.archive)return next(Error('Compressed pack exceeds 64 MiB.'));next(null,chunk);}});
  // The pipeline owns the stream and its descriptor on success/error/abort.
  // Mixing a numeric fd with manual FileHandle.close masked cap errors as EBADF.
  await pipeline(tar.c({cwd:stage,gzip:true,portable:true},[...bundle.files.keys()]),cap,createWriteStream(archive,{flags:'wx'}),{signal});
  signal?.throwIfAborted();
  // A hard link publishes atomically and never overwrites. Volumes without hard links (FAT, exFAT,
  // some network shares) get an exclusive copy, which still refuses an existing destination.
  try{await fs.link(archive,target);}
  catch(error){if(!['ENOTSUP','EOPNOTSUPP','EPERM','EXDEV'].includes(error.code))throw error;await fs.copyFile(archive,target,require('node:fs').constants.COPYFILE_EXCL);}
  return {path:target,bytes:total,key:bundle.key};
 }finally{await fs.rm(stage,{recursive:true,force:true});if(publication)await fs.rm(publication,{recursive:true,force:true});}
}
module.exports={writePackage};
