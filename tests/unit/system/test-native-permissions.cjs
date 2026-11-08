// Check staging permissions without building or packaging an installer.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const afterPack=require('../../../build/after-pack.cjs');
(async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'clipcraft-native-permissions-'));
 for(const [name,magic] of [['elf','7f454c46'],['arm64-macho','cffaedfe'],['intel-macho','feedfacf'],['universal','cafebabe']]){const file=path.join(dir,name);fs.writeFileSync(file,Buffer.from(magic,'hex'));fs.chmodSync(file,0o644);}
 fs.writeFileSync(path.join(dir,'plain.txt'),'data');fs.chmodSync(path.join(dir,'plain.txt'),0o600);await afterPack({appOutDir:dir});
 if(process.platform!=='win32'){
  for(const name of ['elf','arm64-macho','intel-macho','universal'])assert.equal(fs.statSync(path.join(dir,name)).mode&0o777,0o755,name+' remains executable');
  assert.equal(fs.statSync(path.join(dir,'plain.txt')).mode&0o777,0o644);
 }
 if(process.platform==='darwin'){
  const ff=require('../../../electron/media/ffmpeg.cjs'),{execFileSync}=require('node:child_process');
  const type=execFileSync('/usr/bin/file',[ff.ffprobePath],{encoding:'utf8'});assert.match(type,process.arch==='arm64'?/arm64/:/x86_64/);
  assert.match(execFileSync(ff.ffprobePath,['-version'],{encoding:'utf8'}),/^ffprobe version/);
 }
 const config=require('../../../package.json').build.asarUnpack;assert.ok(!config.includes('node_modules/@openai/codex-*/**'),'agent runtimes are downloaded, not bundled');assert.ok(config.includes('node_modules/@ffprobe-installer/**'));
 console.log('Native packaging: ELF and Mach-O permissions, native Mac FFprobe and runtime packaging rules passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
