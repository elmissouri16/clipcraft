const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { spawn } = require('../system/childProcesses.cjs');
const { ffmpegPath, probe } = require('./ffmpeg.cjs');
const VERSION = 'shots-v1';
const abortError = () => Object.assign(new Error('Media analysis stopped.'), { name: 'AbortError' });
function fileFingerprint(file) {
  const stat = fs.statSync(file);
  if (!stat.isFile()) throw new Error('Media source is not a regular file.');
  return createHash('sha256').update(JSON.stringify([path.resolve(file),stat.size,stat.mtimeMs,stat.ctimeMs,stat.ino])).digest('hex');
}
function detectCuts(file, threshold, signal) {
  if (signal?.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, ['-hide_banner','-v','error','-i',file,'-map','0:v:0','-vf',`scale=320:-2,scdet=threshold=${threshold},metadata=print:key=lavfi.scd.time:file=-`,'-an','-f','null','-'], { windowsHide:true,stdio:['ignore','pipe','pipe'] });
    const times=[];let buffer='',error='',tooMany=false;
    const abort=()=>child.kill('SIGKILL');
    signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
    child.stdout.on('data',chunk=>{
      buffer+=chunk;const lines=buffer.split(/\r?\n/);buffer=lines.pop();
      for(const line of lines){const match=/^lavfi\.scd\.time=([\d.]+)/.exec(line);if(match){times.push(Number(match[1]));if(times.length>20000){tooMany=true;abort();}}}
      if(buffer.length>65536){tooMany=true;abort();}
    });
    child.stderr.on('data',chunk=>{error=(error+chunk).slice(-2000);});
    child.once('error',error=>{signal?.removeEventListener('abort',abort);reject(error);});
    child.once('close',code=>{signal?.removeEventListener('abort',abort);if(signal?.aborted)reject(abortError());else if(tooMany)reject(new Error('Media has too many visual boundaries for one analysis. Split the source first.'));else if(code!==0)reject(new Error(`Could not analyse visual boundaries. ${error}`));else resolve(times);});
  });
}
class MediaAnalysis {
  constructor(dir) { this.dir=dir; }
  options({threshold=10,min_scene_sec=0.2}={}) {
    if(!Number.isFinite(threshold)||threshold<1||threshold>100||!Number.isFinite(min_scene_sec)||min_scene_sec<0.05||min_scene_sec>60)throw new Error('Use threshold 1–100 and min_scene_sec 0.05–60.');
    return {threshold,min_scene_sec};
  }
  key(fingerprint,options){return createHash('sha256').update(JSON.stringify([VERSION,fingerprint,options])).digest('hex');}
  file(key){return path.join(this.dir,`${key}.json`);}
  read(key){if(!/^[a-f0-9]{64}$/.test(key))return null;try{const value=JSON.parse(fs.readFileSync(this.file(key),'utf8'));return value.version===VERSION&&value.analysis_id===key&&/^[a-f0-9]{64}$/.test(value.fingerprint)&&Array.isArray(value.shots)&&value.shots.length&&value.shots.every((shot,i)=>typeof shot.id==='string'&&Number.isFinite(shot.start_sec)&&Number.isFinite(shot.end_sec)&&shot.start_sec>=0&&shot.end_sec>=shot.start_sec&&(i===0?shot.start_sec===0:Math.abs(shot.start_sec-value.shots[i-1].end_sec)<1e-7))&&Math.abs(value.shots.at(-1).end_sec-value.duration_sec)<1e-6?value:null;}catch{return null;}}
  write(key,value){fs.mkdirSync(this.dir,{recursive:true});const file=this.file(key),temp=`${file}.${randomUUID()}.tmp`;fs.writeFileSync(temp,JSON.stringify(value));fs.renameSync(temp,file);const entries=fs.readdirSync(this.dir).filter(f=>/^[a-f0-9]{64}\.json$/.test(f));if(entries.length>128)entries.filter(name=>!this.read(name.slice(0,-5))?.shots.some(s=>s.observation)).map(name=>({name,time:fs.statSync(path.join(this.dir,name)).mtimeMs})).sort((a,b)=>a.time-b.time).slice(0,entries.length-128).forEach(({name})=>fs.rmSync(path.join(this.dir,name),{force:true}));}
  async analyze(media,opts={},signal){
    if(!media?.path||!['video','image'].includes(media.type))throw new Error('Select video or image media from the project library.');
    const options=this.options(opts),fingerprint=fileFingerprint(media.path),key=this.key(fingerprint,options),cached=this.read(key);
    if(signal?.aborted)throw abortError();
    if(cached&&cached.fingerprint===fingerprint)return {...cached,cached:true};
    const info=await probe(media.path);if(signal?.aborted)throw abortError();
    const duration=info.type==='image'?0:info.duration;
    if(info.type!=='image'&&(!Number.isFinite(duration)||duration<=0))throw new Error('Source duration is unavailable.');
    const cuts=info.type==='image'?[]:await detectCuts(media.path,options.threshold,signal);
    if(fileFingerprint(media.path)!==fingerprint)throw new Error('The media source changed during analysis. Analyse it again.');
    const boundaries=[0];for(const time of cuts)if(time-boundaries.at(-1)>=options.min_scene_sec&&duration-time>=options.min_scene_sec)boundaries.push(time);
    const shots=info.type==='image'?[{start_sec:0,end_sec:0,representative_sec:0}]:boundaries.map((start,index)=>({start_sec:start,end_sec:boundaries[index+1]??duration,representative_sec:(start+(boundaries[index+1]??duration))/2}));
    const value={version:VERSION,analysis_id:key,fingerprint,duration_sec:duration,options,shots:shots.map(shot=>({...shot,id:createHash('sha256').update(JSON.stringify([key,shot.start_sec,shot.end_sec])).digest('hex').slice(0,24)})),
      limitations:'Visual shot boundaries only. Continuous action, subjects, speech meaning and gradual changes require inspection. Descriptions are observations of sampled frames, not proof of every moment.'};
    if(signal?.aborted)throw abortError();this.write(key,value);return {...value,cached:false};
  }
  annotate(analysisId,shotId,{description,tags=[],evidence,provider,model}){
    if(!/^[a-f0-9]{64}$/.test(analysisId))throw new Error('Unknown media analysis.');
    const value=this.read(analysisId),shot=value?.shots.find(s=>s.id===shotId);
    if(!shot)throw new Error('Unknown shot. Analyse the current source again.');
    if(typeof description!=='string'||!description.trim()||description.length>2000||!Array.isArray(tags)||tags.length>20||tags.some(t=>typeof t!=='string'||t.length>80))throw new Error('Provide a description up to 2000 characters and up to 20 short tags.');
    if(!Array.isArray(evidence)||!evidence.length)throw new Error('Inspect a source frame from this shot before describing it.');
    shot.observation={description:description.trim(),tags,evidence,provider,model,kind:'sampled_frame_observation'};this.write(analysisId,value);return shot;
  }
}
module.exports={MediaAnalysis,fileFingerprint,detectCuts};
