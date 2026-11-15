const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const { fileFingerprint } = require("../media/mediaAnalysis.cjs");
const { spawn } = require('node:child_process');
const { ffmpegPath, toSdr } = require("../media/ffmpeg.cjs");
const stopped = () => Object.assign(new Error('Frame inspection stopped.'), { name: 'AbortError' });
const checkStop = signal => { if (signal?.aborted) throw stopped(); };
const frameSize = (width, height) => {
  if (![width,height].every(n => Number.isFinite(n) && n > 0 && n <= 8192)) throw new Error('Invalid frame dimensions.');
  const scale = Math.min(1,1024/Math.max(width,height));
  return {width:Math.max(1,Math.round(width*scale)),height:Math.max(1,Math.round(height*scale))};
};
async function planFrames(project, source, clipId, times, mediaId) {
  if(!project||!Array.isArray(project.media)||!Array.isArray(project.videoClips))throw new Error('Invalid editor project.');
  const p=project,clipLen=c=>(c.out-c.in)/(c.speed||1);
  let end=0;
  const layout=p.videoClips.map((clip,index)=>{
    const transition=clip.transition;
    const overlap=index&&transition&&transition.type!=='none'?Math.max(0,Number.isFinite(transition.timelineOverlap)?Math.min(transition.timelineOverlap,clipLen(clip),clipLen(p.videoClips[index-1])):Math.min(transition.duration,clipLen(clip)/2,clipLen(p.videoClips[index-1])/2)):0;
    const start=Math.max(0,end-overlap);end=start+clipLen(clip);return {clip,start,end};
  });
  if (!['timeline','clip','media'].includes(source)) throw new Error('source must be timeline, clip or media.');
  if (!Array.isArray(times) || !times.length || times.length > 6 || times.some(t => typeof t !== 'number' || !Number.isFinite(t) || t < 0)) throw new Error('Provide 1–6 nonnegative times_sec.');
  const size=frameSize(p.width,p.height);
  if (source === 'timeline') {
    const duration=Math.max(0,end,...(p.overlayClips||[]).map(c=>c.start+clipLen(c)),...(p.audioClips||[]).map(c=>c.start+clipLen(c)),
      ...(p.textClips||[]).map(c=>c.start+c.duration));
    if (times.some(t => t >= duration)) throw new Error('Frame times must be inside the timeline duration.');
    return times.map(time => ({source,time_sec:time,project:p,...size}));
  }
  if (source === 'media') {
    const media=p.media.find(m=>m.id===mediaId&&['image','video'].includes(m.type));
    if(!media?.path)throw new Error('media_id must name an existing picture source.');
    if(times.some(t=>media.type==='image'?t!==0:t>=media.duration))throw new Error('Source times must be inside the media duration; static images use zero.');
    return times.map(time=>({source,source_time_sec:time,media_id:media.id,media,...frameSize(media.width,media.height)}));
  }
  const main=layout.find(l=>l.clip.id===clipId && !l.clip.gap);
  const overlay=(p.overlayClips||[]).find(c=>c.id===clipId);
  const clip=main?.clip||overlay, start=main?.start??overlay?.start;
  const media=clip && p.media.find(m=>m.id===clip.mediaId && ['image','video'].includes(m.type));
  if (!media?.path) throw new Error('clip_id must name an existing picture clip.');
  if (times.some(t=>t<start || t>=start+clipLen(clip))) throw new Error('Frame times must be inside the selected clip on the timeline.');
  return times.map(time=>({source,time_sec:time,source_time_sec:clip.in+(time-start)*(clip.speed||1),clip_id:clipId,media_id:media.id,media,...frameSize(media.width,media.height)}));
}
async function sourceFrame(plan, signal) {
  checkStop(signal);
  return new Promise((resolve,reject)=>{
    const sdr = toSdr(plan.media).replace(/^,/, '');
    const child=spawn(ffmpegPath,['-v','error',...(plan.media.type==='video'?['-ss',String(plan.source_time_sec)]:[]),'-i',plan.media.path,
      '-map', plan.media.type==='video'?'0:V:0':'0:v:0',
      '-vf',`${sdr ? sdr + ',' : ''}scale=${plan.width}:${plan.height},setsar=1`,'-frames:v','1','-q:v','3','-f','image2pipe','-vcodec','mjpeg','-'],{windowsHide:true,stdio:['ignore','pipe','pipe']});
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
// Contact sheets: several captured frames tiled into one numbered image for
// overview checks (completion review, storyboards). Measured on an OpenAI model,
// six 576×1024 frames cost ~4.5k image tokens alone and ~1.1k as one 1024 px
// sheet, with caption-sized text still read correctly. Precision work (explicit
// inspection, subject tracking) keeps individual full-size frames.
const SHEET_MAX = 1024;
const SHEET_FONTS = ['/System/Library/Fonts/Supplemental/Arial Bold.ttf', '/System/Library/Fonts/Supplemental/Arial.ttf', '/Library/Fonts/Arial.ttf',
  'C:/Windows/Fonts/arialbd.ttf', 'C:/Windows/Fonts/arial.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', '/usr/share/fonts/TTF/DejaVuSans-Bold.ttf', '/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf'];
function sheetLayout(frames) {
  const n = frames.length, portrait = frames[0].height >= frames[0].width;
  const cols = Math.min(n, portrait ? 3 : 2), rows = Math.ceil(n / cols);
  const aspect = frames[0].width / frames[0].height;
  // Largest cell of the first frame's aspect that keeps the sheet within SHEET_MAX.
  let ch = Math.floor(Math.min(SHEET_MAX / rows, SHEET_MAX / cols / aspect)), cw = Math.floor(ch * aspect);
  cw -= cw % 2; ch -= ch % 2;
  return { cols, rows, cw, ch };
}
const escapeFilterPath = file => file.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
function composeSheet(files, { cols, rows, cw, ch }, signal, font = SHEET_FONTS.find(f => fs.existsSync(f))) {
  checkStop(signal);
  const n = files.length, parts = [];
  files.forEach((_, i) => {
    let chain = `[${i}:v]scale=${cw}:${ch}:force_original_aspect_ratio=decrease,pad=${cw}:${ch}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,format=yuvj420p`;
    // A thin dark outline separates neighbouring cells with similar content.
    chain += `,drawbox=x=0:y=0:w=iw:h=ih:color=0x0A0A12:t=2,drawbox=x=0:y=0:w=${font ? 46 : 18}:h=${font ? 28 : 18}:color=black@0.78:t=fill`;
    if (font) chain += `,drawtext=fontfile='${escapeFilterPath(font)}':text='#${i + 1}':x=8:y=5:fontsize=19:fontcolor=0xFFD54A`;
    parts.push(`${chain}[c${i}]`);
  });
  for (let i = n; i < cols * rows; i++) parts.push(`color=c=black:s=${cw}x${ch}:d=1,format=yuvj420p[c${i}]`);
  const layout = Array.from({ length: cols * rows }, (_, i) => `${(i % cols) * cw}_${Math.floor(i / cols) * ch}`).join('|');
  parts.push(`${Array.from({ length: cols * rows }, (_, i) => `[c${i}]`).join('')}xstack=inputs=${cols * rows}:layout=${layout}[out]`);
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, ['-v', 'error', ...files.flatMap(f => ['-i', f]), '-filter_complex', parts.join(';'), '-map', '[out]', '-frames:v', '1', '-q:v', '3', '-f', 'image2pipe', '-vcodec', 'mjpeg', '-'],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks = []; let error = '';
    const abort = () => child.kill('SIGKILL');
    signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) abort();
    child.stdout.on('data', c => chunks.push(c));
    child.stderr.on('data', c => { error = (error + c).slice(-1500); });
    child.once('error', reject);
    child.once('close', code => {
      signal?.removeEventListener('abort', abort);
      if (signal?.aborted) reject(stopped());
      else if (code !== 0 || !chunks.length) reject(new Error(`Could not build the contact sheet. ${error}`));
      else resolve(Buffer.concat(chunks));
    });
  });
}
const cellLabel = f => f.source === 'media' ? `source ${f.source_time_sec}s` : `${f.source === 'clip' ? 'raw clip' : f.source === 'rendered' ? 'rendered' : 'timeline'} ${Number(f.time_sec).toFixed(2)}s`;
const ANALYSIS_LIMITS = require('../../shared/subagentLimits.json');

class AgentFrames {
  constructor(captureTimeline) {this.captureTimeline=captureTimeline;this.records=new Map();this.scopes=new Map();this.dir=null;}
  openScope(owner, requestId) {
    const key = `${owner}:${requestId}`;
    if (this.scopes.has(key) || this.scopes.size >= ANALYSIS_LIMITS.maxConcurrent) throw Error('Too many active analysis frame scopes.');
    this.scopes.set(key, { owner, limit: ANALYSIS_LIMITS.framesPerTask });return key;
  }
  closeScope(owner, requestId) {
    const key = `${owner}:${requestId}`;this.scopes.delete(key);
    for (const [id, frame] of this.records) if (frame.scopeKey === key) this.drop(id);
  }
  drop(id) { const frame=this.records.get(id);if(frame)fs.rmSync(frame.path,{force:true});this.records.delete(id); }
  prune() {
    const groups = new Map();
    for (const [id, frame] of this.records) { const key = this.scopes.has(frame.scopeKey) ? frame.scopeKey : null;const group=groups.get(key)||[];group.push(id);groups.set(key,group); }
    for (const [key, ids] of groups) for (const id of ids.slice(0, Math.max(0, ids.length - (key ? this.scopes.get(key).limit : 48)))) this.drop(id);
  }
  async inspect(owner,{project,source='timeline',clip_id,media_id,times_sec,source_times_sec,revision,requestId},signal) {
    const key=`${owner}:${requestId}`,scopeKey=this.scopes.has(key)?key:undefined;
    const plans=await planFrames(project,source,clip_id,source==='media'?source_times_sec:times_sec,media_id);checkStop(signal);
    const pending=[];
    try {
      for(const plan of plans){
        checkStop(signal);
        const fingerprint=plan.media?fileFingerprint(plan.media.path):undefined;
        const bytes=plan.source!=='timeline'?await sourceFrame(plan,signal):await this.captureTimeline(plan,signal);
        if(plan.media&&fileFingerprint(plan.media.path)!==fingerprint)throw new Error('The source changed during frame capture. Inspect it again.');
        checkStop(signal);
        if(!Buffer.isBuffer(bytes)||bytes.length<4||bytes.length>8*1024*1024||bytes[0]!==255||bytes[1]!==216)throw new Error('Frame capture returned no readable JPEG.');
        this.dir ||= fs.mkdtempSync(path.join(os.tmpdir(),'clipcraft-vision-'));
        const id=randomUUID(),file=path.join(this.dir,`${id}.jpg`);
        fs.writeFileSync(file,bytes,{flag:'wx'});
        const {media,project:ignored,...meta}=plan;
        pending.push({owner,path:file,id,...meta,revision,fingerprint,...(scopeKey?{scopeKey}:{}),image_hash:createHash('sha256').update(bytes).digest('hex')});
      }
      checkStop(signal);
      if(scopeKey&&!this.scopes.has(scopeKey))throw Error('Analysis frame scope expired.');
      for(const frame of pending)this.records.set(frame.id,frame);
      this.prune();
      return {frames:pending.map(({owner,path,scopeKey,...meta})=>meta),revision,note:'Actual image captures are attached to the next configured vision-model turn. Times are timeline seconds; clip captures show the source before edits.'};
    }catch(error){for(const frame of pending)fs.rmSync(frame.path,{force:true});throw error;}
  }
  // One numbered image for 2–6 captured frames of this owner. The cells keep their
  // own IDs and times so coverage and scene evidence still refer to real frames.
  async sheet(owner, ids, { revision } = {}, signal) {
    if (!Array.isArray(ids) || ids.length < 2 || ids.length > 6 || new Set(ids).size !== ids.length) throw new Error('A contact sheet needs 2–6 distinct frame IDs.');
    const frames = ids.map(id => { const f = this.records.get(id); if (!f || f.owner !== owner || !fs.existsSync(f.path) || f.source === 'sheet') throw new Error('Frame capture expired. Run inspect_frames again.'); return f; });
    const layout = sheetLayout(frames);
    const bytes = await composeSheet(frames.map(f => f.path), layout, signal);
    checkStop(signal);
    if (bytes.length < 4 || bytes[0] !== 255 || bytes[1] !== 216) throw new Error('Contact sheet encoding failed.');
    this.dir ||= fs.mkdtempSync(path.join(os.tmpdir(), 'clipcraft-vision-'));
    const id = randomUUID(), file = path.join(this.dir, `${id}.jpg`);
    fs.writeFileSync(file, bytes, { flag: 'wx' });
    const cells = frames.map((f, i) => ({ cell: i + 1, id: f.id, source: f.source, ...(Number.isFinite(f.time_sec) ? { time_sec: f.time_sec } : {}), ...(Number.isFinite(f.source_time_sec) ? { source_time_sec: f.source_time_sec } : {}), ...(f.clip_id ? { clip_id: f.clip_id } : {}), ...(f.media_id ? { media_id: f.media_id } : {}) }));
    const label = `Contact sheet of ${frames.length} frames, ${layout.cols} per row, numbered left to right then top to bottom: ${frames.map((f, i) => `#${i + 1} ${cellLabel(f)}`).join('; ')}. Each cell is a reduced copy; inspect a frame on its own for fine detail.`;
    const scopeKey=frames[0].scopeKey&&frames.every(f=>f.scopeKey===frames[0].scopeKey)?frames[0].scopeKey:undefined;
    if(scopeKey&&!this.scopes.has(scopeKey)){fs.rmSync(file,{force:true});throw Error('Analysis frame scope expired.');}
    const record = { owner, path: file, id, source: 'sheet', revision: revision ?? frames[0].revision, cells, label, width: layout.cols * layout.cw, height: layout.rows * layout.ch,...(scopeKey?{scopeKey}:{}) };
    this.records.set(id, record);
    this.prune();
    const { owner: ignored, path: omitted, scopeKey: internalScope, ...meta } = record;
    return meta;
  }
  addExternal(owner, bytes, { revision, label }) {
    if (!Buffer.isBuffer(bytes) || bytes.length < 4 || bytes.length > 8 * 1024 * 1024 || bytes[0] !== 255 || bytes[1] !== 216) throw new Error('External image conversion failed.');
    this.dir ||= fs.mkdtempSync(path.join(os.tmpdir(), 'clipcraft-vision-'));
    const id = randomUUID(), file = path.join(this.dir, `${id}.jpg`);
    fs.writeFileSync(file, bytes, { flag: 'wx' });
    const record = { owner, path: file, id, source: 'external', revision, label: String(label).slice(0, 600) };
    this.records.set(id, record);
    this.prune();
    const { owner: ignored, path: omitted, ...meta } = record;
    return meta;
  }
  images(owner,ids=[]) {
    if(!Array.isArray(ids)||ids.length>6)throw new Error('Use at most six inspected frames.');
    return [...new Set(ids)].map(id=>{
      const frame=this.records.get(id);
      if(!frame||frame.owner!==owner||!fs.existsSync(frame.path))throw new Error('Frame capture expired. Run inspect_frames again.');
      return {path:frame.path,label:frame.label || `${frame.source} frame at ${frame.source==='media'?'source':'timeline'} ${frame.source==='media'?frame.source_time_sec:frame.time_sec}s${frame.clip_id?` from clip ${frame.clip_id}, source ${frame.source_time_sec}s`:''}; ${frame.width}x${frame.height}; editor revision ${frame.revision}`};
    });
  }
  // width/height (the image's pixel size) let rendered frames go on a contact sheet.
  addRendered(owner, bytes, { revision, time_sec, render_time_sec, label, width, height }) {
    const frame = this.addExternal(owner, bytes, { revision, label });
    const record = this.records.get(frame.id);
    Object.assign(record, { source: 'rendered', time_sec, render_time_sec, ...(width > 0 && height > 0 ? { width, height } : {}) });
    const { owner: ignored, path: omitted, ...meta } = record;
    return meta;
  }
  markPresented(owner,ids,requestId,provider,model){
    for(const id of ids||[]){const frame=this.records.get(id);if(frame?.owner!==owner)continue;
      Object.assign(frame,{presentedFor:requestId,presentedProvider:provider,presentedModel:model,presentedVia:undefined});
      // A sheet shows its cells as reduced copies: good enough to describe a scene,
      // not to pick exact coordinates (tracking requires a frame presented on its own).
      for(const cell of frame.cells||[]){const f=this.records.get(cell.id);if(f?.owner===owner&&f.presentedFor!==requestId)Object.assign(f,{presentedFor:requestId,presentedProvider:provider,presentedModel:model,presentedVia:id});}
    }
  }
  evidence(owner,ids,requestId){
    if(typeof requestId!=='string'||!requestId)throw new Error('Scene evidence requires an active agent request.');
    if(!Array.isArray(ids)||!ids.length||ids.length>6)throw new Error('Use one to six inspected frame IDs.');
    return ids.map(id=>{const frame=this.records.get(id);if(!frame||frame.owner!==owner||frame.presentedFor!==requestId||!fs.existsSync(frame.path))throw new Error('Inspect and present the evidence frames in this request before describing a scene.');const {owner:ignored,path,scopeKey,...meta}=frame;return meta;});
  }
  clearOwner(owner){for(const [id,frame] of this.records)if(frame.owner===owner)this.drop(id);for(const[key,scope]of this.scopes)if(scope.owner===owner)this.scopes.delete(key);}
  dispose(){this.records.clear();this.scopes.clear();if(this.dir)fs.rmSync(this.dir,{recursive:true,force:true});this.dir=null;}
}
module.exports={AgentFrames,planFrames,sourceFrame,frameSize,sheetLayout,composeSheet};
