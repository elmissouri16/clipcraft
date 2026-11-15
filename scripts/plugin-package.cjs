// node scripts/plugin-package.cjs validate <folder>
// node scripts/plugin-package.cjs pack <folder> <new-output.clipcraft-plugin.tgz>
const fs=require('node:fs/promises'),path=require('node:path'),tar=require('tar');
async function main() {
  const [command,folder,output]=process.argv.slice(2);
  if(!['validate','pack'].includes(command)||!folder||(command==='pack'&&!output)) throw Error('Usage: node scripts/plugin-package.cjs validate <folder> | pack <folder> <new-output.clipcraft-plugin.tgz>');
  const {readFolder,validateFiles}=require('../electron/plugins/package.cjs');
  const bundle=await validateFiles(await readFolder(folder),require('../package.json').version);
  const {manifest}=bundle;
  if(command==='pack') {
    const handle=await fs.open(output,'wx');
    try { const stream=handle.createWriteStream();await require('node:stream/promises').pipeline(tar.c({gzip:true,cwd:folder,portable:true},[...bundle.files.keys()]),stream); }
    catch(e){await fs.rm(output,{force:true});throw e;} finally {await handle.close();}
  }
  console.log(`${command==='pack'?'Packed':'Validated'} ${manifest.id} ${manifest.version}`);
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
