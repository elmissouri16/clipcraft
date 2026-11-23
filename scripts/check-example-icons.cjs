// Example artwork has one delivery size; third-party package icon bounds remain
// part of the general package contract in shared/pluginIcon.mjs.
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const EXAMPLE_ICON_SIZE=256;
// Text-only SDK demos deliberately exercise the supported native identity fallback.
// All other curated examples still require their distinct 256px PNG artwork.
const EXAMPLE_MONOGRAMS=Object.freeze({'clipcraft-examples.native-properties':'NP','clipcraft-examples.sdk-workbench':'SW','clipcraft-examples.scene-reviewer':'SH'});
async function exampleManifests(root=path.resolve(__dirname,'..')){
 const files=[];
 for(const parent of ['examples/plugins','examples/extensions'])for(const entry of await fs.readdir(path.join(root,parent),{withFileTypes:true}))if(entry.isDirectory())files.push(path.join(root,parent,entry.name,'plugin.json'));
 for(const name of ['sounds','fonts'])files.push(path.join(root,'examples/plugin-showcase/recipes',name+'.json'));
 return files.sort();
}
async function checkExampleIcons({root=path.resolve(__dirname,'..')}={}){
 const {pluginIconPath,validatePluginIcon,PLUGIN_ICON_LIMIT}=await import('../shared/pluginIcon.mjs'),{readRegularFile}=require('../electron/plugins/package.cjs'),entries=[],monograms=[],errors=[];
 for(const file of await exampleManifests(root)){
  try{
   const manifest=JSON.parse(await fs.readFile(file,'utf8'));
   if(manifest.icon===undefined&&Object.hasOwn(EXAMPLE_MONOGRAMS,manifest.id)){
    const words=manifest.name.replace(/([a-z])([A-Z])/g,'$1 $2').trim().split(/[\s-]+/u),label=(words.length>1?[...words[0]][0]+[...words.at(-1)][0]:[...manifest.name].slice(0,2).join('')).toLocaleUpperCase();
    if(label!==EXAMPLE_MONOGRAMS[manifest.id])throw Error('Unexpected example monogram');monograms.push({id:manifest.id,name:manifest.name,label,manifest:path.relative(root,file)});continue;
   }
   const icon=pluginIconPath(manifest.icon),source=path.join(path.dirname(file),...(manifest.main?['src']:[]),icon),bytes=await readRegularFile(source,PLUGIN_ICON_LIMIT,'Example icon'),size=validatePluginIcon(bytes);
   if(size.width!==EXAMPLE_ICON_SIZE||size.height!==EXAMPLE_ICON_SIZE)throw Error(`icon must be exactly ${EXAMPLE_ICON_SIZE}×${EXAMPLE_ICON_SIZE}, got ${size.width}×${size.height}`);
   entries.push({id:manifest.id,name:manifest.name,version:manifest.version,manifest:path.relative(root,file),file:path.relative(root,source),...size,bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')});
  }catch(error){errors.push(path.relative(root,file)+': '+error.message);}
 }
 if(errors.length)throw Error('Example icon validation failed:\n'+errors.join('\n'));
 return {ok:true,size:EXAMPLE_ICON_SIZE,count:entries.length,entries,monograms};
}
if(require.main===module)checkExampleIcons().then(result=>console.log(JSON.stringify(result,null,2))).catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports={EXAMPLE_MONOGRAMS,EXAMPLE_ICON_SIZE,exampleManifests,checkExampleIcons};
