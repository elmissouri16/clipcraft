// node scripts/plugin-package.cjs validate <folder|archive>
// node scripts/plugin-package.cjs pack <folder> <new-output.clipcraft-plugin.tgz>
async function main() {
  const [command,folder,output]=process.argv.slice(2);
  if(!['validate','pack'].includes(command)||!folder||(command==='pack'&&!output)) throw Error('Usage: node scripts/plugin-package.cjs validate <folder> | pack <folder> <new-output.clipcraft-plugin.tgz>');
  const sdk=require('../packages/plugin-sdk/src/authoring.cjs'),options={appVersion:require('../package.json').version};
  const result=command==='pack'?await sdk.packPlugin(folder,output,options):await sdk.validatePlugin(folder,options),manifest=result.manifest||result;
  console.log(`${command==='pack'?'Packed':'Validated'} ${manifest.id} ${manifest.version}`);
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
