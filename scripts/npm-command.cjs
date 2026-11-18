// Execute npm's JavaScript entry with the selected Node runtime. Windows .cmd
// shims cannot be passed directly to execFile without introducing a shell.
const fs=require('node:fs'),path=require('node:path');
function npmCommand(args){
 const bin=path.dirname(process.execPath),entry=[process.env.npm_execpath,path.join(bin,'node_modules/npm/bin/npm-cli.js'),path.resolve(bin,'../lib/node_modules/npm/bin/npm-cli.js')].find(file=>file&&fs.existsSync(file));
 if(entry)return {command:process.execPath,args:[entry,...args]};
 if(process.platform==='win32')throw Error('Cannot locate npm-cli.js. Run this check through npm run sdk:verify or npm test.');
 return {command:'npm',args};
}
module.exports={npmCommand};
