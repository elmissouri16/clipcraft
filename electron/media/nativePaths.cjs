// Rewrite only binaries inside this application's physical ASAR. Parent folder
// names and external/relative overrides are not archive paths.
const fs=require('node:fs'),path=require('node:path');
const applicationRoot=path.resolve(__dirname,'../..');
const archived=path.extname(applicationRoot)==='.asar'&&(process.versions.electron?require('original-fs'):fs).statSync(applicationRoot).isFile();
function unpackedBinaryPath(file){
 if(typeof file!=='string')throw new TypeError('Native media binary path must be a string');
 if(!archived||!path.isAbsolute(file))return file;
 const relative=path.relative(applicationRoot,file);
 if(!relative||relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative))return file;
 return path.join(applicationRoot+'.unpacked',relative);
}
module.exports={unpackedBinaryPath};
