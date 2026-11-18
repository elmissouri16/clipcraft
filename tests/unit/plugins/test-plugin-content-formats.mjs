import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {contentContributions,validateContentBytes} from '../../../shared/pluginContent.mjs';
const require=createRequire(import.meta.url),ff=require('../../../electron/media/ffmpeg.cjs'),{inspectPackSound}=require('../../../electron/plugins/contentAudio.cjs'),{PluginManager}=require('../../../electron/plugins/manager.cjs');
const dir=await fs.mkdtemp(path.join(os.tmpdir(),'clipcraft-pack-formats-')),checks=[];
const check=(name,fn)=>{fn();checks.push(name);};
const sound={id:'tone',name:'Tone',kind:'sfx',license:'Original synthetic fixture; CC0-1.0'};
const font={id:'face',name:'Face',license:'Local system font; private verification only.'};
const files=[];
try{
 for(const ext of ['mp3','ogg']){
  const file=path.join(dir,'tone.'+ext);execFileSync(ff.ffmpegPath,['-v','error','-y','-f','lavfi','-i','sine=frequency=440:sample_rate=16000:duration=0.25','-c:a',ext==='mp3'?'libmp3lame':'libvorbis',file]);const bytes=await fs.readFile(file);files.push({ext,bytes});
  check(ext+' declared contribution validates',()=>assert.ok(contentContributions({sounds:[{...sound,file:'assets/tone.'+ext}]}).sounds));
  check(ext+' actual container passes structural checks',()=>assert.ok(validateContentBytes('sound',bytes,'assets/tone.'+ext)));
  check(ext+' cannot masquerade as WAV',()=>assert.throws(()=>validateContentBytes('sound',bytes,'assets/tone.wav')));
  const probed=await inspectPackSound(file);assert.ok(probed.duration>0);checks.push(ext+' passes bounded native audio probe');
  check(ext+' rejects truncated bytes',()=>assert.throws(()=>validateContentBytes('sound',bytes.subarray(0,12),'assets/tone.'+ext)));
 }
 for(const [ext,file] of [['ttf',require('../../fixtures/pack-fonts.cjs').packTestFont('ttf')],['otf',require('../../fixtures/pack-fonts.cjs').packTestFont('otf')]]){
  const bytes=await fs.readFile(file);files.push({ext,bytes});check(ext+' declared contribution validates',()=>assert.ok(contentContributions({fonts:[{...font,faces:[{file:'assets/face.'+ext,weight:400,style:'normal'}]}]}).fonts));
  check(ext+' real font directory passes structural checks',()=>assert.ok(validateContentBytes('font',bytes,'assets/face.'+ext)));
  check(ext+' cannot masquerade as WOFF2',()=>assert.throws(()=>validateContentBytes('font',bytes,'assets/face.woff2')));
  check(ext+' rejects truncated tables',()=>assert.throws(()=>validateContentBytes('font',bytes.subarray(0,64),'assets/face.'+ext)));
  const bad=Buffer.from(bytes);bad.writeUInt32BE(bytes.length+1,20);check(ext+' rejects out-of-bounds table offsets',()=>assert.throws(()=>validateContentBytes('font',bad,'assets/face.'+ext)));
 }
 const invalidMp3=Buffer.alloc(14);invalidMp3.write('ID3');invalidMp3[3]=4;invalidMp3[6]=255;check('reject non-syncsafe ID3 lengths',()=>assert.throws(()=>validateContentBytes('sound',invalidMp3,'assets/bad.mp3')));
 const ogg=Buffer.from(files.find(f=>f.ext==='ogg').bytes);ogg[26]=255;check('reject OGG lacing overflow',()=>assert.throws(()=>validateContentBytes('sound',ogg.subarray(0,40),'assets/bad.ogg')));
 const cover=path.join(dir,'cover.jpg'),album=path.join(dir,'album.mp3');execFileSync(ff.ffmpegPath,['-v','error','-y','-f','lavfi','-i','color=c=blue:s=32x32','-frames:v','1',cover]);execFileSync(ff.ffmpegPath,['-v','error','-y','-i',path.join(dir,'tone.mp3'),'-i',cover,'-map','0:a','-map','1:v','-c','copy','-id3v2_version','3','-disposition:v','attached_pic',album]);const albumBytes=await fs.readFile(album);assert.ok(validateContentBytes('sound',albumBytes,'assets/album.mp3'));assert.ok((await inspectPackSound(album)).duration>0);checks.push('normal MP3 album artwork remains supported as metadata');
 const folder=path.join(dir,'source');await fs.mkdir(path.join(folder,'assets'),{recursive:true});const contributes={sounds:[],fonts:[]};
 for(const f of files){const file='assets/asset.'+f.ext;await fs.writeFile(path.join(folder,file),f.bytes);if(['mp3','ogg'].includes(f.ext))contributes.sounds.push({...sound,id:f.ext,file});else contributes.fonts.push({...font,id:f.ext,faces:[{file,weight:400,style:'normal'}]});}
 await fs.writeFile(path.join(folder,'plugin.json'),JSON.stringify({id:'studio.formats',name:'Formats',publisher:'Fixture',version:'0.1.0',apiVersion:1,contributes}));const manager=new PluginManager(path.join(dir,'installed'),'2.0.0');await manager.install(folder,true);
 for(const asset of await manager.sounds()){const materialized=await manager.soundAsset(asset.id);assert.equal(path.extname(materialized.path),path.extname(asset.file));await inspectPackSound(materialized.path);checks.push('installed '+path.extname(asset.file)+' owns correctly named, decodable audio');}
 assert.equal((await manager.fonts()).length,2);checks.push('installed TTF/OTF families publish exact font IDs');
 await fs.writeFile(path.join(dir,'result.json'),JSON.stringify({ok:true,checks},null,2));console.log(checks.length+' content format checks passed; evidence: '+dir);
}catch(error){console.error('Evidence:',dir);throw error;}
