// Verify the production dependency filter without creating an installer.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {getNodeModuleFileMatcher}=require('app-builder-lib/out/fileMatcher');
const root=path.resolve(__dirname,'../../..'),pkg=require('../../../package.json');
const filter=getNodeModuleFileMatcher(root,path.join(root,'dist'),x=>x,{}, {config:pkg.build,debugLogger:{isEnabled:false}}).createFilter();
const walk=dir=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name)):[path.join(dir,e.name)]);
let excludedBytes=0,files=0,licenses=0;
for(const scope of ['@fontsource','@fontsource-variable']){
 const folder=path.join(root,'node_modules',scope);
 for(const file of walk(folder)){
  const stat=fs.statSync(file);
  if(/\.(?:woff2?|ttf|otf)$/i.test(file)){assert.equal(filter(file,stat),false,path.relative(root,file)+' is redundant');excludedBytes+=stat.size;files++;}
  if(/^licen[cs]e/i.test(path.basename(file))){assert.equal(filter(file,stat),true,'font license remains packaged');licenses++;}
 }
 const nested=path.join(root,'node_modules/wrapper/node_modules',scope,'example/files/latin.woff2');assert.equal(filter(nested,{isDirectory:()=>false}),false,'nested raw font copies are excluded');
}
assert.ok(files>0&&licenses>0);
const built=walk(path.join(root,'dist')).filter(file=>/\.(?:woff2?|ttf|otf)$/i.test(file));assert.ok(built.length>0,'renderer retains compiled fonts');
for(const file of built)assert.equal(filter(file,fs.statSync(file)),true,'built renderer fonts stay included');
console.log(JSON.stringify({excludedBytes,files,licenses,rendererFontBytes:built.reduce((sum,f)=>sum+fs.statSync(f).size,0),rendererFonts:built.length}));
