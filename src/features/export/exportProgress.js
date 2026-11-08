import { exportDuration } from '../../state/store.js';
import { overlayRanges } from '../effects/apply.js';
// Phase-aware, smoothed export timing. Only measured successful work updates
// the local speed profile; canceled exports and cache hits do not train it.
const PROFILE_KEY = 'clipcraft.export-speed.v1';
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const seeds = { prepare: 1, text: 70, effects: 25, encode: 35, finish: 1 };
export function exportStages(project, effectsFrames = 0) {
  const { width, height, fps } = project.renderSize || project;
  const frames = Math.max(1, Math.ceil(exportDuration(project)*fps));
  const pixels = Math.max(.01,width*height/1e6);
  const hasText = project.textClips.length || overlayRanges(project).length;
  const complexity = 1 + Math.log2(1+(project.overlayClips?.length||0))*.45;
  return [
    { id:'prepare',label:'Preparing your video',units:1 },
    ...(hasText?[{id:'text',label:'Rendering captions and graphics',units:frames*pixels}]:[]),
    ...(effectsFrames?[{id:'effects',label:'Rendering effects and transitions',units:effectsFrames*pixels}]:[]),
    {id:'encode',label:'Encoding video',units:frames*pixels*complexity},
    {id:'finish',label:'Finishing your video',units:1},
  ];
}
export function readExportProfile(storage) {
  try { const p=JSON.parse(storage?.getItem(PROFILE_KEY)||'{}');return p&&typeof p==='object'&&!Array.isArray(p)?p:{}; }catch{return {};}
}
export class ExportProgress {
  constructor(stages,{now=()=>performance.now(),profile={},publish=()=>{},storage}={}) {
    this.stages=stages;this.now=now;this.publish=publish;this.storage=storage;this.profile=profile;
    this.started=now();this.phaseStarted=this.started;this.index=-1;this.fraction=0;this.progress=0;this.lastPublish=-Infinity;this.lastAdvance=this.started;this.eta=null;this.done=false;
    this.durations=stages.map(s=>{
      const rate=Number(profile[s.id]);return s.id==='prepare'||s.id==='finish'?1:Math.max(.35,s.units/(Number.isFinite(rate)&&rate>0?rate:seeds[s.id]));
    });
    this.completed=new Map();
    this.cachedStages=new Set();
  }
  start(id) {
    const index=this.stages.findIndex(s=>s.id===id);if(index<0)return;
    const now=this.now();
    if(this.index>=0&&index!==this.index){this.completed.set(this.index,(now-this.phaseStarted)/1000);}
    this.index=index;this.phaseStarted=now;this.lastAdvance=now;this.fraction=0;this.eta=null;this.emit(true);
  }
  update(fraction,{restart=false,...detail}={}) {
    if(this.done||this.index<0)return;
    const now=this.now();
    if(detail.cached)this.cachedStages.add(this.index);
    if(restart){this.phaseStarted=now;this.lastAdvance=now;this.fraction=0;this.eta=null;}
    const next=clamp(Number(fraction)||0,0,1);if(next>this.fraction)this.lastAdvance=now;
    this.fraction=Math.max(this.fraction,next);this.detail=detail;
    const elapsed=(now-this.phaseStarted)/1000;
    if(this.fraction>=1)this.durations[this.index]=Math.max(.001,elapsed);
    if(this.fraction>.015&&elapsed>.5&&this.fraction<.995){
      const observed=elapsed/this.fraction;
      this.durations[this.index]=this.durations[this.index]*.7+observed*.3;
    }
    this.emit(this.fraction>=1);
  }
  emit(force=false) {
    const now=this.now();if(!force&&now-this.lastPublish<200)return;
    this.lastPublish=now;
    const stage=this.stages[this.index],elapsed=(now-this.phaseStarted)/1000;
    const completed=this.stages.slice(0,this.index).reduce((n,_s,i)=>n+(this.completed.get(i)??this.durations[i]),0);
    const total=completed+this.durations.slice(this.index).reduce((a,b)=>a+b,0);
    this.progress=Math.max(this.progress,clamp((completed+this.durations[this.index]*this.fraction)/Math.max(.01,total),0,.99));
    const remaining=Math.max(0,this.durations[this.index]*(1-this.fraction)-(now-this.lastAdvance)/1000)+this.durations.slice(this.index+1).reduce((a,b)=>a+b,0);
    this.eta=this.eta==null?remaining:this.eta*.75+remaining*.25;
    const settling=this.fraction>=.995;
    const stalled=now-this.lastAdvance>8000;
    const measured=this.fraction>.015&&elapsed>.5;
    this.publish({progress:this.progress,stage:stage?.label||'Preparing your video',phase:stage?.id,phaseProgress:this.fraction,
      step:this.index+1,steps:this.stages.length,startedAt:this.started,elapsedSeconds:(now-this.started)/1000,
      remainingSeconds:now-this.started<1500||!measured||settling||stalled?null:Math.max(1,this.eta),
      timingStatus:stalled?'Working on this step':settling?'Saving changes':'Estimating time remaining',...this.detail});
  }
  finish() {
    const now=this.now();if(this.index>=0)this.completed.set(this.index,(now-this.phaseStarted)/1000);
    for(const [i,seconds] of this.completed){const s=this.stages[i];if(this.cachedStages.has(i)||seconds<.4||!s.units||['prepare','finish'].includes(s.id))continue;
      const rate=clamp(s.units/seconds,.05,10000),old=Number(this.profile[s.id]);this.profile[s.id]=old>0?old*.65+rate*.35:rate;
    }
    try{this.storage?.setItem(PROFILE_KEY,JSON.stringify(this.profile));}catch{}
    this.done=true;return (now-this.started)/1000;
  }
}
export function formatElapsed(seconds=0){const n=Math.max(0,Math.floor(seconds));return n>=3600?`${Math.floor(n/3600)}:${String(Math.floor(n/60)%60).padStart(2,'0')}:${String(n%60).padStart(2,'0')}`:`${Math.floor(n/60)}:${String(n%60).padStart(2,'0')}`;}
export function formatRemaining(seconds){
  if(!Number.isFinite(seconds))return null;
  if(seconds<10)return 'Less than 10 seconds remaining';
  const n=Math.ceil(seconds/(seconds<60?5:15))*(seconds<60?5:15);
  if(n<60)return `About ${n} seconds remaining`;
  const minutes=Math.ceil(n/60);return minutes<60?`About ${minutes} min remaining`:`About ${Math.floor(minutes/60)} hr${minutes%60?` ${minutes%60} min`:''} remaining`;
}
