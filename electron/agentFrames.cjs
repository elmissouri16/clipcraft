const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { spawn } = require('node:child_process');
const { ffmpegPath } = require('./ffmpeg.cjs');
const stopped = () => Object.assign(new Error('Frame inspection stopped.'), { name: 'AbortError' });
const checkStop = signal => { if (signal?.aborted) throw stopped(); };
const frameSize = (width, height) => {
  if (![width,height].every(n => Number.isFinite(n) && n > 0 && n <= 8192)) throw new Error('Invalid frame dimensions.');
  const scale = Math.min(1,1024/Math.max(width,height));
  return {width:Math.max(1,Math.round(width*scale)),height:Math.max(1,Math.round(height*scale))};
};
async function planFrames(project, source, clipId, times) {
  if(!project||!Array.isArray(project.media)||!Array.isArray(project.videoClips))throw new Error('Invalid editor project.');
  const p=project,clipLen=c=>(c.out-c.in)/(c.speed||1);
  let end=0;
  const layout=p.videoClips.map((clip,index)=>{
    const transition=clip.transition;
    const overlap=index&&transition&&transition.type!=='none'?Math.max(0,Number.isFinite(transition.timelineOverlap)?Math.min(transition.timelineOverlap,clipLen(clip),clipLen(p.videoClips[index-1])):Math.min(transition.duration,clipLen(clip)/2,clipLen(p.videoClips[index-1])/2)):0;
    const start=Math.max(0,end-overlap);end=start+clipLen(clip);return {clip,start,end};
  });
  if (!['timeline','clip'].includes(source)) throw new Error('source must be timeline or clip.');
  if (!Array.isArray(times) || !times.length || times.length > 6 || times.some(t => typeof t !== 'number' || !Number.isFinite(t) || t < 0)) throw new Error('Provide 1–6 nonnegative times_sec.');
  const size=frameSize(p.width,p.height);
  if (source === 'timeline') {
    const duration=Math.max(0,end,...(p.overlayClips||[]).map(c=>c.start+clipLen(c)),...(p.audioClips||[]).map(c=>c.start+clipLen(c)),
      ...(p.textClips||[]).map(c=>c.start+c.duration));
    if (times.some(t => t >= duration)) throw new Error('Frame times must be inside the timeline duration.');
    return times.map(time => ({source,time_sec:time,project:p,...size}));
  }
  const main=layout.find(l=>l.clip.id===clipId && !l.clip.gap);
  const overlay=(p.overlayClips||[]).find(c=>c.id===clipId);
  const clip=main?.clip||overlay, start=main?.start??overlay?.start;
  const media=clip && p.media.find(m=>m.id===clip.mediaId && ['image','video'].includes(m.type));
  if (!media?.path) throw new Error('clip_id must name an existing picture clip.');
  if (times.some(t=>t<start || t>=start+clipLen(clip))) throw new Error('Frame times must be inside the selected clip on the timeline.');
  return times.map(time=>({source,time_sec:time,source_time_sec:clip.in+(time-start)*(clip.speed||1),clip_id:clipId,media,...frameSize(media.width,media.height)}));
}
async function sourceFrame(plan, signal) {
  checkStop(signal);
  return new Promise((resolve,reject)=>{
    const child=spawn(ffmpegPath,['-v','error',...(plan.media.type==='video'?['-ss',String(plan.source_time_sec)]:[]),'-i',plan.media.path,
      '-vf',`scale=${plan.width}:${plan.height},setsar=1`,'-frames:v','1','-q:v','3','-f','image2pipe','-vcodec','mjpeg','-'],{windowsHide:true,stdio:['ignore','pipe','pipe']});
    const chunks=[];let bytes=0,error='';
    const abort=()=>child.kill('SIGKILL');
    signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
    child.stdout.on('data',chunk=>{bytes+=chunk.length;if(bytes>8*1024*1024)abort();else chunks.push(chunk);});
    child.stderr.on('data',chunk=>{error=(error+chunk).slice(-1500);});
    child.once('error',reject);
    child.once('close',code=>{
      signal?.removeEventListener('abort',abort);
      if(signal?.aborted)reject(stopped());
      else if(code!==0||!bytes||bytes>8*1024*1024)reject(new Error(`Could not decode the source frame. ${error}`));
      else resolve(Buffer.concat(chunks));
    });
  });
}
class AgentFrames {
  constructor(captureTimeline) {this.captureTimeline=captureTimeline;this.records=new Map();this.dir=null;}
  async inspect(owner,{project,source='timeline',clip_id,times_sec,revision},signal) {
    const plans=await planFrames(project,source,clip_id,times_sec);checkStop(signal);
    const pending=[];
    try {
      for(const plan of plans){
        checkStop(signal);
        const bytes=plan.source==='clip'?await sourceFrame(plan,signal):await this.captureTimeline(plan,signal);
        checkStop(signal);
        if(!Buffer.isBuffer(bytes)||bytes.length<4||bytes.length>8*1024*1024||bytes[0]!==255||bytes[1]!==216)throw new Error('Frame capture returned no readable JPEG.');
        this.dir ||= fs.mkdtempSync(path.join(os.tmpdir(),'clipcraft-vision-'));
        const id=randomUUID(),file=path.join(this.dir,`${id}.jpg`);
        fs.writeFileSync(file,bytes,{flag:'wx'});
        const {media,project:ignored,...meta}=plan;
        pending.push({owner,path:file,id,...meta,revision});
      }
      checkStop(signal);
      for(const frame of pending)this.records.set(frame.id,frame);
      while(this.records.size>48){const [id,frame]=this.records.entries().next().value;fs.rmSync(frame.path,{force:true});this.records.delete(id);}
      return {frames:pending.map(({owner,path,...meta})=>meta),revision,note:'Actual image captures are attached to the next Codex editing turn. Times are timeline seconds; clip captures show the source before edits.'};
    }catch(error){for(const frame of pending)fs.rmSync(frame.path,{force:true});throw error;}
  }
  images(owner,ids=[]) {
    if(!Array.isArray(ids)||ids.length>6)throw new Error('Use at most six inspected frames.');
    return [...new Set(ids)].map(id=>{
      const frame=this.records.get(id);
      if(!frame||frame.owner!==owner||!fs.existsSync(frame.path))throw new Error('Frame capture expired. Run inspect_frames again.');
      return {path:frame.path,label:`${frame.source} frame at timeline ${frame.time_sec}s${frame.clip_id?` from clip ${frame.clip_id}, source ${frame.source_time_sec}s`:''}; ${frame.width}x${frame.height}; editor revision ${frame.revision}`};
    });
  }
  clearOwner(owner){for(const [id,frame] of this.records)if(frame.owner===owner){fs.rmSync(frame.path,{force:true});this.records.delete(id);}}
  dispose(){this.records.clear();if(this.dir)fs.rmSync(this.dir,{recursive:true,force:true});this.dir=null;}
}
module.exports={AgentFrames,planFrames,sourceFrame,frameSize};
