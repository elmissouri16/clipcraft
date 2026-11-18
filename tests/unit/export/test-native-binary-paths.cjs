const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),{execFileSync}=require('node:child_process');
(async()=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'clipcraft-native-paths-')),root=path.resolve(__dirname,'../../..'),values=['ffmpeg',path.join(directory,'app.asar tools','ffmpeg'),path.join(directory,'app.asar.unpacked','ffmpeg'),'relative app.asar binaries/ffmpeg'];
 // Read the actual public media path in a plain Node process. No ASAR or binary
 // is involved, so these overrides must remain literal even when names resemble one.
 const code=`const assert=require('node:assert/strict');const [media,values]=process.argv.slice(1);for(const value of JSON.parse(values)){process.env.FFMPEG_BIN=value;delete require.cache[require.resolve('ffmpeg-static')];delete require.cache[media];assert.equal(require(media).ffmpegPath,value);}`;
 execFileSync(process.execPath,['-e',code,require.resolve('../../../electron/media/ffmpeg.cjs'),JSON.stringify(values)],{cwd:root,env:process.env});
 const source=path.join(directory,'physical-source.asar'),folder=path.join(source,'electron/media');await fs.mkdir(folder,{recursive:true});await fs.copyFile(path.join(root,'electron/media/nativePaths.cjs'),path.join(folder,'nativePaths.cjs'));const {unpackedBinaryPath}=require(path.join(folder,'nativePaths.cjs')),inside=path.join(source,'node_modules/ffmpeg-static/ffmpeg');assert.equal(unpackedBinaryPath(inside),inside,'A real directory named .asar is not an archive');
 await fs.writeFile(path.join(directory,'result.json'),JSON.stringify({ok:true,checks:['plain Node media API preserves four literal overrides','physical source directory named .asar is not rewritten'],values},null,2));console.log('Native binary source paths verified: '+directory);
})().catch(error=>{console.error(error);process.exitCode=1;});
