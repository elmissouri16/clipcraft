import React,{useEffect,useState} from 'react';
import Preview from './components/Preview.jsx';
import {fontsReady} from "../text/fonts.js";
import {loadProjectLuts} from "../effects/lut.js";
import {projectDuration,setPlaybackQuality} from "../../state/store.js";
import "../../styles/frameInspection.css";
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const paint=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
const noop=()=>{};
export default function FrameInspection(){
  const [job,setJob]=useState(null);
  useEffect(()=>{window.frameInspection.load().then(async value=>{
    setPlaybackQuality('full');await fontsReady();await loadProjectLuts(value.project);
    setJob(value);
  }).catch(error=>window.frameInspection.ready(error.message));},[]);
  useEffect(()=>{
    if(!job)return;let canceled=false;
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
        const ready=media.every(el=>el.tagName==='IMG'?el.complete&&el.naturalWidth:el.readyState>=2&&!el.seeking);
        if(ready)break;
        if(performance.now()>end)throw new Error('Timed out decoding a frame for visual inspection.');
        if(canceled)return;await wait(30);
      }
      await paint();if(!canceled)await window.frameInspection.ready();
    })().catch(error=>!canceled&&window.frameInspection.ready(error.message));
    return()=>{canceled=true;};
  },[job]);
  return job?<div className="frame-inspection"><Preview project={job.project} time={job.time_sec} seekVer={1} playing={false}
    duration={projectDuration(job.project)} selection={null} onSelect={noop} dispatch={noop} onTime={noop} onEnd={noop}
    onTogglePlay={noop} onSeek={noop} onDropItem={noop} quality="full" onQualityChange={noop}/></div>:null;
}
