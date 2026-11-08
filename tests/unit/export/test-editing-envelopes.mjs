// Render actual audio/video, then measure output samples rather than inspecting
// filter strings. These regressions cover errors hidden by a correct preview.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import ff from '../../../electron/media/ffmpeg.cjs';
import { emptyProject, historyReducer } from '../../../src/state/store.js';
import { motionData, stateAt } from '../../../src/features/timeline/anim.js';

const dir=fs.mkdtempSync(path.join(os.tmpdir(),'clipcraft-editing-envelopes-'));
const gen=args=>execFileSync(ff.ffmpegPath,['-v','error','-y',...args],{maxBuffer:8*1024*1024});
const source=path.join(dir,'tone.mp4');
gen(['-f','lavfi','-i','color=black:s=160x90:r=20:d=5','-f','lavfi','-i','sine=frequency=440:sample_rate=48000:duration=5','-shortest','-c:v','libx264','-c:a','aac',source]);
const media={...(await ff.probe(source)),id:'m',path:source};
const p={...emptyProject(),width:160,height:90,fps:20,media:[media],videoClips:[{id:'v',mediaId:'m',in:0,out:5,speed:1,muted:true,linkId:'pair'}],
  audioClips:[{id:'a',mediaId:'m',start:0,in:0,out:5,speed:1,linkId:'pair',linkOff:0,linkInOff:0,fadeIn:1,fadeOut:1}]};
const render=async(project,name)=>{const file=path.join(dir,name+'.mp4');await ff.runExport(project,file,()=>{}).promise;return file;};
const original=await render(p,'original');
function rms(file,time){const b=gen(['-ss',String(time),'-i',file,'-t','0.03','-vn','-ac','1','-ar','48000','-f','f32le','-']);let sum=0;for(let i=0;i<b.length;i+=4)sum+=b.readFloatLE(i)**2;return Math.sqrt(sum/(b.length/4));}
const evidence={audio:[],opacity:[]};
for(const split of [.5,2.5,4.5]){
  const after=historyReducer({past:[],future:[],present:p},{type:'split',track:'video',id:'v',t:split,newId:'right'}).present;
  const output=await render(after,'split-'+split);
  for(const time of [.2,.48,.52,2.48,2.52,4.48,4.52,4.8]){
    const expected=rms(original,time),actual=rms(output,time);
    assert.ok(Math.abs(actual/expected-1)<.12,`split ${split}, audio ${time}: ${actual} vs ${expected}`);
    evidence.audio.push({split,time,expected,actual});
  }
}
// Overlay audio has the same fade/volume path as separate audio and analysis.
const overlay={...p,videoClips:p.videoClips.map(c=>({...c,linkId:undefined})),audioClips:[],overlayClips:[{id:'overlay',mediaId:'m',start:0,in:0,out:5,speed:1,volume:.3,fadeIn:1,fadeOut:1}]};
const overlayFile=await render(overlay,'overlay');
for(const time of [.2,2.5,4.8])assert.ok(Math.abs(rms(overlayFile,time)/rms(original,time)-.3)<.03,'overlay audio matches the common envelope');

// Constant source alpha must be multiplied, never replaced by animated alpha.
const white=path.join(dir,'half-alpha.png');gen(['-f','lavfi','-i','color=white@0.5:s=160x90,format=rgba','-frames:v','1',white]);
const image={...(await ff.probe(white)),id:'white',path:white};
const fading={id:'fade',mediaId:'white',start:0,in:0,out:5,speed:1,anim:{in:{type:'fade_in',duration:1},out:{type:'fade_out',duration:1}}};
const picture={...p,media:[media,image],audioClips:[],overlayClips:[fading]};picture.motion=motionData(picture);
const output=await render(picture,'alpha');
for(const time of [.5,2,4.5]){
  const b=gen(['-ss',String(time),'-i',output,'-frames:v','1','-f','rawvideo','-pix_fmt','gray','-']);
  const mean=b.reduce((sum,v)=>sum+v,0)/b.length,expected=127.5*stateAt(fading,time,5).opacity;
  assert.ok(Math.abs(mean-expected)<12,`alpha at ${time}: ${mean} vs ${expected}`);evidence.opacity.push({time,expected,mean});
}
fs.writeFileSync(path.join(dir,'evidence.json'),JSON.stringify(evidence,null,2));
console.log('exported split audio, overlay sound, fade-in/out and source alpha agree with preview; evidence: '+dir);
