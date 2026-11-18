// Build a standalone author SDK, never the editor or an installer.
const fs=require('node:fs/promises'),path=require('node:path'),esbuild=require('esbuild');
async function buildSdk(){
 const root=path.resolve(__dirname,'../packages/plugin-sdk'),dist=path.join(root,'dist');await fs.mkdir(dist,{recursive:true});
 await esbuild.build({entryPoints:[path.join(root,'src/index.mjs')],outfile:path.join(dist,'index.mjs'),bundle:true,format:'esm',platform:'browser',target:'es2022',legalComments:'none'});
 for(const name of ['authoring','cli'])await esbuild.build({entryPoints:[path.join(root,`src/${name}.cjs`)],outfile:path.join(dist,`${name}.cjs`),bundle:true,format:'cjs',platform:'node',target:'node20',external:['esbuild','tar','typescript','typescript/*','@types/node','@types/node/*'],legalComments:'none'});
 await esbuild.build({entryPoints:[path.join(root,'src/extension.mjs')],outfile:path.join(dist,'extension.mjs'),bundle:true,format:'esm',platform:'node',target:'node20'});
 for(const name of ['index.d.ts','extension.d.ts','authoring.d.cts'])await fs.copyFile(path.join(root,'src',name),path.join(dist,name));
 await fs.chmod(path.join(dist,'cli.cjs'),0o755);console.log('Plugin SDK built: '+dist);
}
if(require.main===module)buildSdk().catch(error=>{console.error(error);process.exitCode=1;});
module.exports={buildSdk};
