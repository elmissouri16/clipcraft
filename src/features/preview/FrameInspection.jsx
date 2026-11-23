import {setCustomTimelineTypes} from '../../../shared/customTimeline.mjs';
import {setPluginTransitions} from '../plugins/transitionRegistry.js';
import {assertPluginEffects,setPluginEffects} from '../plugins/effectRegistry.js';
import React,{useEffect,useState} from 'react';
import Preview from './components/Preview.jsx';
import {fontsReady} from "../text/fonts.js";
import {loadProjectLuts} from "../effects/lut.js";
import {projectDuration,setPlaybackQuality,renderable} from "../../state/store.js";
import "../../styles/frameInspection.css";
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const paint=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
const noop=()=>{};
export default function FrameInspection(){
  const [job,setJob]=useState(null);
  useEffect(()=>{const off=window.frameInspection.onFrame?.(update=>setJob(previous=>({...previous,...update})));window.frameInspection.load().then(async value=>{
    setPluginEffects(value.pluginEffects||[]);setPluginTransitions(value.pluginTransitions||[]);setPlaybackQuality('full');if(value.strict)assertPluginEffects(value.project);await fontsReady(value.project.textClips,{strict:!!value.strict});await loadProjectLuts(value.project,{strict:!!value.strict});
    if(value.timelineTypes)setCustomTimelineTypes(value.timelineTypes);setJob({...value,project:renderable(value.project)});
  }).catch(error=>window.frameInspection.ready(error.message));return()=>off?.();},[]);
  useEffect(()=>{
    if(!job)return;let canceled=false;
    const renderError=event=>{if(job.strict&&!canceled)window.frameInspection.ready(String(event.message||'Frame composition failed.'),job.sequence);};
    window.addEventListener('error',renderError);
    (async()=>{
      await paint();
      const end=performance.now()+15000;
      // Visible picture elements must have decoded the requested frame.
      while(true){
        const media=[...document.querySelectorAll('.stage video,.stage img')].filter(el=>{
          const slot=el.closest('.slot');return slot?.style.visibility==='visible' && getComputedStyle(el).display!=='none' && !!(el.currentSrc||el.src);
        });
        const failed=media.find(el=>el.error || (el.tagName==='IMG'&&el.complete&&!el.naturalWidth));
        if(failed)throw new Error('A visible media source could not be decoded.');
        const ready=media.every(el=>el.tagName==='IMG'?el.complete&&el.naturalWidth:el.readyState>=2&&!el.seeking&&(!job.strict||!el.dataset.frameExpectedTime||Math.abs(el.currentTime-Number(el.dataset.frameExpectedTime))<=0.015));
        if(ready)break;
        if(performance.now()>end)throw new Error('Timed out decoding a frame for visual inspection.');
        if(canceled)return;await wait(30);
      }
      await paint();{const failed=[...document.querySelectorAll('canvas[data-render-error]')].find(el=>el.dataset.renderError&&(el.classList.contains('fx-transition')||getComputedStyle(el).display!=='none')&&(!el.closest('.slot')||el.closest('.slot').style.visibility==='visible'));if(failed)throw Error(failed.dataset.renderError);}
      if(!canceled)await window.frameInspection.ready(undefined,job.sequence);
    })().catch(error=>!canceled&&window.frameInspection.ready(error.message,job.sequence));
    return()=>{canceled=true;window.removeEventListener('error',renderError);};
  },[job]);
  return job?<div className="frame-inspection"><Preview project={job.project} time={job.time_sec} seekVer={job.sequence||1} playing={false}
    duration={projectDuration(job.project)} selection={null} onSelect={noop} dispatch={noop} onTime={noop} onEnd={noop}
    onTogglePlay={noop} onSeek={noop} onDropItem={noop} quality="full" onQualityChange={noop}/></div>:null;
}
