import React,{useEffect,useMemo,useRef,useState} from 'react';
import {Play,Pause,RotateCcw,AudioLines} from 'lucide-react';
import Slider from '../../../components/ui/Slider.jsx';
import {effectExpression} from '../../../../shared/pluginEffects.mjs';
import {transitionExpression} from '../../../../shared/pluginTransitions.mjs';
import {parseCube} from '../../../../shared/cubeLut.mjs';
import {motionPresetPatch} from '../../../../shared/pluginMotion.mjs';
import {fxGL} from '../../effects/gl.js';
import {filterExpr} from '../../effects/filters.js';
import {gradeExpr} from '../../effects/grade.js';
import {clipCss} from '../../effects/effects.js';
import {stateAt} from '../../timeline/anim.js';
import {fontsReady} from '../../text/fonts.js';
import {drawTextClip} from '../../text/render.js';
import {toFileUrl} from '../../../state/store.js';
import {previewScene} from '../previewScene.js';
import {t} from '../../../i18n/index.js';
const DURATION=2,FPS=24;
const clock=value=>`${Math.floor(value/60)}:${String(Math.floor(value%60)).padStart(2,'0')}.${Math.floor(value%1*10)}`;
export default function PluginContentPreview({content,onParametersChange,onValidityChange,active=true}){
 const canvas=useRef(null),stage=useRef(null),sourceA=useRef(null),sourceB=useRef(null),audioNode=useRef(null),callbacks=useRef({}),valid=useRef(null);
 callbacks.current={onParametersChange,onValidityChange};
 const [playing,setPlaying]=useState(false),[position,setPosition]=useState(.5),[parameters,setParameters]=useState({}),[original,setOriginal]=useState(false),[error,setError]=useState(''),[audio,setAudio]=useState(null),[duration,setDuration]=useState(DURATION),[size,setSize]=useState({width:640,height:360}),[fonts,setFonts]=useState(null);
 const runtime=useRef({position:.5,playing:false,parameters:{},original:false,invalidate:()=>{}});
 const report=value=>{if(valid.current!==value){valid.current=value;callbacks.current.onValidityChange?.(value);}};
 const kind=content.kind,item=content.item,isSound=kind==='sounds',transition=kind==='transitions',canCompare=['effects','luts','colorPresets','motionPresets'].includes(kind);
 const prepared=useMemo(()=>{try{return {luts:Object.fromEntries(Object.entries(content.luts||{}).map(([id,text])=>[id,parseCube(text)]))};}catch(e){return {error:e.message};}},[content]);
 useEffect(()=>{
  runtime.current.position=.5;runtime.current.playing=false;runtime.current.parameters={};runtime.current.original=false;setPlaying(false);setPosition(.5);setParameters({});setOriginal(false);setError('');setAudio(null);setDuration(DURATION);callbacks.current.onParametersChange?.({});report(false);
 },[content]);
 useEffect(()=>{
  if(isSound)return;let live=true;setFonts(null);
  (async()=>{if(kind==='textStyles'||kind==='fonts')await fontsReady([{...(kind==='textStyles'?item.style:{font:`pack-font:${content.key}:${item.id}`}),text:t('plugins.preview_sample')}],{strict:true});if(live)setFonts(content);})().catch(e=>{if(live){setError(e.message);report(false);}});
  return()=>{live=false;};
 },[content]);
 useEffect(()=>{
  if(!isSound)return;let live=true,token;window.api.pluginsPreviewSound(`pack-sound:${content.key}:${item.id}`).then(value=>{token=value.token;if(live)setAudio(value);else window.api.pluginsReleaseSoundPreview(token).catch(()=>{});}).catch(e=>{if(live){setError(e.message);report(false);}});return()=>{live=false;if(token)window.api.pluginsReleaseSoundPreview(token).catch(()=>{});};
 },[content]);
 useEffect(()=>{
  if(isSound||!stage.current)return;const observer=new ResizeObserver(([entry])=>{if(!entry.contentRect.width)return;const width=Math.max(320,Math.min(1280,Math.round(entry.contentRect.width*Math.min(window.devicePixelRatio||1,2)/16)*16));setSize(old=>old.width===width?old:{width,height:width*9/16});});observer.observe(stage.current);return()=>observer.disconnect();
 },[isSound]);
 useEffect(()=>{if(!active){runtime.current.playing=false;setPlaying(false);setPosition(runtime.current.position);audioNode.current?.pause();}},[active]);
 useEffect(()=>{
  if(isSound||!active||fonts!==content)return;report(false);if(prepared.error){setError(prepared.error);return;}
  let live=true,raf=0,previous=0,lastDraw=-Infinity,lastUi=0;const cv=canvas.current,ctx=cv.getContext('2d'),{width:W,height:H}=size,a=previewScene(W,H),b=previewScene(W,H,true),motion=kind==='motionPresets'?{in:0,out:DURATION,...motionPresetPatch({...item,digest:content.key,pluginId:content.pluginId,version:content.version},{in:0,out:DURATION})}:null;
  cv.width=W;cv.height=H;cv.dataset.previewPreparations=String((Number(cv.dataset.previewPreparations)||0)+1);
  for(const [ref,source] of [[sourceA,a],[sourceB,b]])if(ref.current){ref.current.width=160;ref.current.height=90;ref.current.getContext('2d').drawImage(source,0,0,160,90);}
  const draw=()=>{
   const {position:time,parameters:params,original:before}=runtime.current;
   try{
    ctx.setTransform(1,0,0,1,0,0);ctx.globalAlpha=1;ctx.filter='none';ctx.clearRect(0,0,W,H);let image=a;
    if(!before&&kind==='effects')image=fxGL().effects(a,W,H,[{expr:effectExpression(item,params),T:time*DURATION}]);
    if(transition)image=fxGL().transition(a,b,W,H,time,transitionExpression(item,params));
    if(!before&&kind==='luts')image=fxGL().effects(a,W,H,[{lut:prepared.luts[item.id],K:1}]);
    if(!before&&kind==='colorPresets'){
     const s=item.settings,passes=[],f=filterExpr({filter:s.filter,filterIntensity:s.filterIntensity});if(s.filterLut)passes.push({lut:prepared.luts[s.filterLut],K:(s.filterIntensity??100)/100});else if(f)passes.push({expr:f,T:time*DURATION});if(s.lut)passes.push({lut:prepared.luts[s.lut],K:(s.lutIntensity??100)/100});if(s.grade&&Object.keys(s.grade).length)passes.push({expr:gradeExpr(s.grade),T:time*DURATION});if(passes.length)image=fxGL().effects(a,W,H,passes);ctx.filter=clipCss({adjust:s.adjust});
    }
    if(!before&&motion){const m=stateAt(motion,time*DURATION,DURATION),v=m.transform;ctx.globalAlpha=m.opacity;ctx.translate(W/2+v.x*W,H/2+v.y*H);ctx.rotate(v.rot*Math.PI/180);ctx.scale(v.scale*(v.uniform===false?v.scaleX:1),v.scale*(v.uniform===false?v.scaleY:1));ctx.drawImage(a,-W/2,-H/2);}
    else ctx.drawImage(image,0,0,W,H);
    if(kind==='textStyles'||kind==='fonts'){ctx.filter='none';ctx.setTransform(W/1280,0,0,H/720,0,0);const style=kind==='textStyles'?item.style:{font:`pack-font:${content.key}:${item.id}`,size:84,x:.5,y:.5,stroke:{width:0}};drawTextClip(ctx,{...style,text:kind==='textStyles'?item.sampleText||t('plugins.preview_sample'):t('plugins.preview_sample'),start:0,duration:DURATION},time*DURATION,1280,720);}
    report(true);cv.dataset.previewFrame=String((Number(cv.dataset.previewFrame)||0)+1);cv.dataset.previewPosition=String(time);
   }catch(e){setError(e.message);report(false);runtime.current.playing=false;setPlaying(false);live=false;}
  };
  const tick=now=>{raf=0;if(!live)return;const state=runtime.current;if(state.playing){if(previous)state.position=(state.position+(now-previous)/1000/DURATION)%1;previous=now;}else previous=0;
   if(now-lastDraw>=1000/FPS||!state.playing){draw();lastDraw=now;}if(now-lastUi>=100){setPosition(state.position);lastUi=now;}if(live&&state.playing)raf=requestAnimationFrame(tick);
  };
  const invalidate=()=>{lastDraw=-Infinity;if(live&&!raf)raf=requestAnimationFrame(tick);};runtime.current.invalidate=invalidate;draw();lastDraw=performance.now();if(live&&runtime.current.playing)raf=requestAnimationFrame(tick);
  return()=>{live=false;cancelAnimationFrame(raf);runtime.current.invalidate=()=>{};};
 },[content,size,fonts,prepared,active]);
 const seek=value=>{runtime.current.position=value;runtime.current.playing=false;setPlaying(false);setPosition(value);if(isSound&&audioNode.current&&Number.isFinite(audioNode.current.duration)){audioNode.current.pause();audioNode.current.currentTime=value*audioNode.current.duration;}runtime.current.invalidate();};
 const play=()=>{if(isSound){if(audioNode.current?.paused)audioNode.current.play().catch(e=>setError(e.message));else audioNode.current?.pause();return;}const next=!runtime.current.playing;runtime.current.playing=next;setPlaying(next);setPosition(runtime.current.position);runtime.current.invalidate();};
 const change=(id,value)=>{const next={...runtime.current.parameters,[id]:value};runtime.current.parameters=next;setParameters(next);callbacks.current.onParametersChange?.(next);runtime.current.invalidate();};
 const reset=()=>{runtime.current.parameters={};setParameters({});callbacks.current.onParametersChange?.({});runtime.current.invalidate();};
 const compare=before=>{runtime.current.original=before;setOriginal(before);runtime.current.invalidate();};
 return <div className="plugin-content-preview" data-preview-kind={kind} data-preview-active={active}>
  {canCompare&&<div className="seg-tabs small plugin-preview-compare" role="group" aria-label={t('plugins.preview_compare')}><button type="button" className={original?'on':''} data-preview-original aria-pressed={original} onClick={()=>compare(true)}>{t('plugins.preview_original')}</button><button type="button" className={!original?'on':''} data-preview-result aria-pressed={!original} onClick={()=>compare(false)}>{t('plugins.preview_result')}</button></div>}
  {isSound&&<div className="plugin-preview-sound"><AudioLines size={28}/><span>{item.name}</span></div>}
  {isSound?<audio ref={audioNode} src={audio?toFileUrl(audio.path):undefined} aria-label={item.name} onLoadedData={()=>{const seconds=audioNode.current.duration;runtime.current.position=0;setPosition(0);setDuration(Number.isFinite(seconds)?seconds:0);report(true);}} onTimeUpdate={()=>{const node=audioNode.current;if(node.duration>0){runtime.current.position=node.currentTime/node.duration;setPosition(runtime.current.position);}}} onPlay={()=>setPlaying(true)} onPause={()=>setPlaying(false)} onEnded={()=>setPlaying(false)} onError={()=>{setError(t('plugins.preview_audio_failed'));report(false);}}/>:<div ref={stage} className="plugin-preview-stage"><canvas ref={canvas} data-preview-key={content.key} aria-label={t('plugins.preview_of',{name:item.name})}/></div>}
  <div className="plugin-preview-transport settings-actions">
   <button type="button" className="icon-btn" data-preview-play aria-label={t(playing?'plugins.preview_pause':'plugins.preview_play')} title={t(playing?'plugins.preview_pause':'plugins.preview_play')} disabled={!!error||isSound&&!audio} onClick={play}>{playing?<Pause size={14}/>:<Play size={14}/>}</button>
   <input type="range" aria-label={t('plugins.preview_position')} min="0" max="1" step="0.001" value={position} onChange={e=>seek(Number(e.target.value))}/>
   <output className="plugin-preview-time" data-preview-time>{clock(position*duration)} / {clock(duration)}</output>
  </div>
  {transition&&<div className="plugin-preview-sources"><button type="button" className="btn btn-ghost" data-preview-source="a" onClick={()=>seek(0)}><canvas ref={sourceA}/><span>{t('plugins.preview_from')}</span></button><button type="button" className="btn btn-ghost" data-preview-source="b" onClick={()=>seek(1)}><canvas ref={sourceB}/><span>{t('plugins.preview_to')}</span></button></div>}
  {!!item.parameters?.length&&<div className="plugin-preview-parameters"><div className="plugin-preview-parameters-head"><h5 className="set2-group-label">{t('plugins.preview_parameters')}</h5><button type="button" className="btn btn-sm btn-ghost" data-preview-reset onClick={reset}><RotateCcw size={12}/>{t('plugins.preview_reset')}</button></div>{item.parameters.map(p=><Slider key={p.id} label={p.name} value={parameters[p.id]??p.default} min={p.min} max={p.max} step={p.step} onChange={value=>change(p.id,value)}/>)}</div>}
  {error&&<p role="alert" data-preview-error>{error}</p>}
 </div>;
}
