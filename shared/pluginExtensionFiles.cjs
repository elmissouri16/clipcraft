// Shared by the authoring pipeline and native package reader; no runtime imports.
const reserved=/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
const EXTENSION_LIMITS=Object.freeze({files:4096,nodes:8192,path:240,file:32*1024*1024});
const portable=name=>typeof name==='string'&&name.length<=EXTENSION_LIMITS.path&&!name.split('/').some(part=>!part||part==='.'||part==='..'||part.endsWith('.')||reserved.test(part));
const extensionFile=name=>portable(name)&&/^(dist|assets)\/[a-zA-Z0-9_./-]+\.(cjs|mjs|js|json|css|html|map|svg|png|jpg|jpeg|webp|gif|mp4|webm|txt|wasm|woff2|ttf|otf|wav|mp3|ogg|cube)$/.test(name);
const extensionDirectory=name=>portable(name)&&/^(dist|assets)(?:\/[a-zA-Z0-9_.-]+)*$/.test(name);
// Check both files and implied directories. A package must retain the same
// layout on case-sensitive and case-insensitive filesystems before any writes.
function assertExtensionPaths(names){
 const seen=new Map();
 for(const name of names){
  if(name!=='plugin.json'&&!extensionFile(name))throw Error('Extension paths must be portable and unambiguous: '+name);
  const parts=name.split('/');
  for(let i=0;i<parts.length;i++){
   const spelling=parts.slice(0,i+1).join('/'),key=spelling.toLowerCase(),type=i===parts.length-1?'file':'directory',previous=seen.get(key);
   if(previous&&(previous.spelling!==spelling||previous.type!==type||type==='file'))throw Error('Extension paths must be portable and unambiguous: '+name);
   seen.set(key,{spelling,type});
   if(seen.size>EXTENSION_LIMITS.nodes)throw Error('Extension package exceeds path resource limits');
  }
 }
 return seen.size;
}
module.exports={extensionFile,extensionDirectory,assertExtensionPaths,EXTENSION_LIMITS};
