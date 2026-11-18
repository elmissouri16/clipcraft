// Original generated boundary data; no packaged fixture binaries or execution.
const fs=require('node:fs/promises'),path=require('node:path'),zlib=require('node:zlib');
module.exports=async(directory,sdk=require('../../packages/plugin-sdk/src/authoring.cjs'))=>{
 const source=path.join(directory,'boundary-source'),prefix='assets/'+'d'.repeat(120)+'/',manifest=Buffer.from(JSON.stringify({id:'test.archive-boundary',name:'Archive boundary',publisher:'Original test',version:'0.1.0',apiVersion:1,main:'dist/extension.cjs'})),entry=Buffer.from('exports.activate=()=>{throw Error("Admission must not activate this fixture")};'),payloadBytes=128*1024*1024,count=4094,size=Math.floor((payloadBytes-manifest.length-entry.length)/count);let left=payloadBytes-manifest.length-entry.length;
 await fs.mkdir(path.join(source,'dist'),{recursive:true});await fs.mkdir(path.join(source,prefix),{recursive:true});await fs.writeFile(path.join(source,'plugin.json'),manifest);await fs.writeFile(path.join(source,'dist/extension.cjs'),entry);
 for(let i=0;i<count;i++){const suffix='-'+String(i).padStart(4,'0')+'.txt',name=prefix+'f'.repeat(240-prefix.length-suffix.length)+suffix,n=i===count-1?left:size;await fs.writeFile(path.join(source,name),Buffer.alloc(n));left-=n;}
 const archive=path.join(directory,'boundary.tgz'),packed=await sdk.packPlugin(source,archive),compressed=await fs.readFile(archive);
 return {archive,source,key:packed.key,fileCount:4096,payloadBytes,maxPathLength:240,compressedBytes:compressed.length,expandedBytes:zlib.gunzipSync(compressed).length};
};
