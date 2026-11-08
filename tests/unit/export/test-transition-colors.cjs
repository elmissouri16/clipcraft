// A lossless RGB transition segment must keep the same colors as its neighbors.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {execFileSync}=require('node:child_process'),ff=require('../../../electron/media/ffmpeg.cjs');
(async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'clipcraft-transition-colors-')),W=320,H=180,fps=10;
 const source=path.join(dir,'colors.png'),segment=path.join(dir,'transition.mkv'),out=path.join(dir,'out.mp4');
 const colors=[[180,70,40],[30,90,150],[40,160,60],[160,40,150],[30,30,30]],rgb=Buffer.alloc(W*H*3);
 for(let y=0;y<H;y++)for(let x=0;x<W;x++)rgb.set(colors[Math.floor(x/W*colors.length)],(y*W+x)*3);
 execFileSync(ff.ffmpegPath,['-v','error','-y','-f','rawvideo','-pix_fmt','rgb24','-s',`${W}x${H}`,'-i','-','-frames:v','1',source],{input:rgb});
 execFileSync(ff.ffmpegPath,['-v','error','-y','-loop','1','-framerate',String(fps),'-i',source,'-t','0.4','-c:v','ffv1','-pix_fmt','bgra',segment]);
 const c={id:'a',mediaId:'m',in:0,out:1,speed:1};
 const p={width:W,height:H,fps,media:[{...await ff.probe(source),id:'m',path:source}],videoClips:[c,{...c,id:'b',transition:{type:'fx_wipeup',duration:.4}}],overlayClips:[],textClips:[],audioClips:[],fxSegments:{b:segment}};
 const {args}=ff.buildExportArgs(p,out,{encoder:'libx264'});execFileSync(ff.ffmpegPath,args,{stdio:'pipe'});
 const results=[];for(const time of [.2,.6,.8,1.3]){
  const actual=execFileSync(ff.ffmpegPath,['-v','error','-ss',String(time),'-i',out,'-frames:v','1','-pix_fmt','rgb24','-f','rawvideo','-']);
  let error=0,n=0;for(let y=10;y<H-10;y+=10)for(let x=16;x<W;x+=64)for(let ch=0;ch<3;ch++){const i=(y*W+x)*3+ch;error+=Math.abs(actual[i]-rgb[i]);n++;}
  results.push({time,meanRgbError:error/n});fs.writeFileSync(path.join(dir,'evidence.json'),JSON.stringify(results,null,2));assert.ok(error/n<3,'transition color at '+time+': '+error/n);
 }
 console.log('RGB transition segments preserve neighboring colors; evidence: '+dir);
})().catch(error=>{console.error(error);process.exitCode=1;});
