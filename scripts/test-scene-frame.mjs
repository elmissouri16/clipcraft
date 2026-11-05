import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import ff from '../electron/ffmpeg.cjs';
import frames from '../electron/imageFrame.cjs';
import { emptyProject, historyReducer } from '../src/store.js';
import { createToolRunner } from '../src/agent/tools.js';

const dir=fs.mkdtempSync(path.join(os.tmpdir(),'clipcraft-scene-frame-'));
const source=path.join(dir,'wide.png'), transparent=path.join(dir,'alpha.png');
const gen=(filter,file)=>execFileSync(ff.ffmpegPath,['-y','-loglevel','error','-f','lavfi','-i',filter,'-frames:v','1',file]);
const pixels=file=>execFileSync(ff.ffmpegPath,['-v','error','-i',file,'-frames:v','1','-f','rawvideo','-pix_fmt','rgba','-'],{maxBuffer:4*1024*1024});
const redBounds=(bytes,width,height)=>{
  let l=width,r=-1,t=height,b=-1;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const k=(y*width+x)*4;
    if(bytes[k]>180 && bytes[k+1]<60 && bytes[k+2]<60){l=Math.min(l,x);r=Math.max(r,x);t=Math.min(t,y);b=Math.max(b,y);}
  }
  return {w:r-l+1,h:b-t+1};
};
try {
  gen('color=c=blue:s=640x360,drawbox=x=270:y=130:w=100:h=100:c=red:t=fill',source);
  gen('color=c=black@0:s=320x320,format=rgba,drawbox=x=120:y=120:w=80:h=80:c=red@1:t=fill:replace=1',transparent);
  const fitted=await frames.fitImageFrame(source,{width:180,height:320});
  const info=await ff.probe(fitted.path);
  assert.deepEqual([info.width,info.height],[180,320]);
  assert.notEqual(fitted.path,source);assert.ok(fs.existsSync(source),'native source is preserved');
  const bounds=redBounds(pixels(fitted.path),180,320);
  assert.ok(Math.abs(bounds.w-bounds.h)<=2 && bounds.w>80,'a square stays square after portrait fitting');
  assert.equal((await frames.fitImageFrame(fitted.path,{width:180,height:320})).path,fitted.path,'exact-sized output avoids re-encoding');
  const alpha=await frames.fitImageFrame(transparent,{width:180,height:320});
  const rgba=pixels(alpha.path);
  assert.equal(rgba[3],0);assert.equal(rgba[(160*180+90)*4+3],255,'alpha survives fitting');
  await assert.rejects(frames.fitImageFrame(source,{width:0,height:320}),/canvas/);
  await assert.rejects(frames.fitImageFrame(source,{width:180,height:320,signal:AbortSignal.abort()}),{name:'AbortError'});

  let state={past:[],future:[],present:{...emptyProject(),ratio:'9:16',width:180,height:320,
    media:[{...(await ff.probe(source)),id:'wide',name:'Wide',path:source}]}};
  const dispatch=a=>{state=historyReducer(state,a);};
  const api={stockAdd:async()=>state.present.media[0],stockSearch:async()=>({results:[{id:'stock',kind:'photo'}]})};
  const runner=createToolRunner({getProject:()=>state.present,dispatch,api,settle:async()=>{},addProbed:res=>res});
  const main=await runner.run('add_media',{media_name:'Wide'});
  assert.ok(main.clip_id);assert.deepEqual([state.present.width,state.present.height,state.present.ratio],[180,320,'9:16'],'the first source cannot replace a template canvas');
  let clip=state.present.videoClips[0];
  assert.ok(clip.crop.l>0.3 && clip.crop.r>0.3);assert.equal(clip.transform.scale,1);
  dispatch({type:'update',track:'video',id:clip.id,patch:{out:1}});
  // Zooms start at scale 1 over the cropped picture; they cannot reintroduce bars.
  assert.ok(!(await runner.run('add_keyframes',{clip_id:main.clip_id,property:'scale',keyframes:[{time_sec:0,value:1},{time_sec:0.9,value:1.1}]})).error);
  const movie=path.join(dir,'main.mp4');
  await ff.runExport({...state.present,fps:10},movie,()=>{}).promise;
  const frame=pixels(movie);
  assert.ok(frame[2]>150 && frame[0]<60,'portrait export covers the corner with the blue source');
  const b=redBounds(frame,180,320);assert.ok(Math.abs(b.w-b.h)<=2,'export does not stretch the source');
  const overlay=await runner.run('add_media',{media_name:'Wide',as:'overlay',start_sec:0});
  assert.ok(state.present.overlayClips.find(c=>c.id===overlay.clip_id).crop.l>0.3);
  const stock=await runner.run('search_stock',{kind:'photo',query:'wide'});
  const added=await runner.run('add_stock',{stock_id:stock.items[0].stock_id,start_sec:0,duration_sec:1});
  assert.ok(state.present.overlayClips.find(c=>c.id===added.clip_id).crop.l>0.3);
  const fit=await runner.run('add_media',{media_name:'Wide',as:'overlay',start_sec:1,fit:'fit'});
  assert.deepEqual(state.present.overlayClips.find(c=>c.id===fit.clip_id).crop,{l:0,r:0,t:0,b:0});
  assert.match((await runner.run('add_media',{media_name:'Wide',fit:'stretch'})).error,/fit/);
  console.log('scene frame ok (exact PNG dimensions, proportional fill, alpha, cancellation, template preservation, main/overlay/stock fill, zoom and real export)');
} finally { fs.rmSync(dir,{recursive:true,force:true}); }
