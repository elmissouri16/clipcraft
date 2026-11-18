// Historical selector test oracle; not part of the SDK or runtime.
import {findClipIn,clipLocked,videoLayout,freeLen} from '../../../src/state/store.js';
export const actionSelectionKey=selection=>JSON.stringify((selection?.items||(selection?[selection]:[])).map(s=>[s.track,s.id]).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))));
export function actionSelection(project,selection){
 const groups=new Map(),starts=new Map(videoLayout(project.videoClips||[]).map(l=>[l.clip.id,l.start]));
 for(const track of ['video','overlay','audio','text','effect','sticker'])for(const clip of project[`${track}Clips`]||[])if(clip.linkId){if(!groups.has(clip.linkId))groups.set(clip.linkId,[]);groups.get(clip.linkId).push({track,clip});}
 return (selection?.items||(selection?[selection]:[])).map(s=>{
  const clip=findClipIn(project,s.track,s.id),members=groups.get(clip?.linkId)||[],pic=members.find(m=>['video','overlay'].includes(m.track)),aud=members.find(m=>m.track==='audio');
  let linkedSupported=false,linkManageSupported=false;
  if(members.length===2&&pic&&aud&&!pic.clip.gap&&!aud.clip.gap){const v=pic.clip,a=aud.clip,start=pic.track==='video'?starts.get(v.id):v.start;
   linkManageSupported=typeof clip.linkId==='string'&&[start,a.start,v.in,v.out,a.in,a.out,v.speed||1,a.speed||1,a.linkOff??0,a.linkInOff??0].every(Number.isFinite)&&start>=0&&a.start>=0&&v.in>=0&&a.in>=0&&v.out>v.in&&a.out>a.in&&(v.speed||1)>0&&(a.speed||1)>0&&Math.abs((v.out-v.in)/(v.speed||1)-freeLen('audio',a))<1e-8&&Math.abs((v.speed||1)-(a.speed||1))<1e-8&&Math.abs(a.start-start-(a.linkOff||0))<1e-8&&Math.abs(a.in-v.in-(a.linkInOff||0))<1e-8;
   linkedSupported=linkManageSupported;
  }
  return {lane:s.track,id:s.id,missing:!clip,attached:s.track==='effect'&&s.id.includes('|'),gap:!!clip?.gap,linked:!!clip?.linkId,linkedSupported,linkManageSupported,locked:!!clip&&(clipLocked(project,s.track,clip)||linkManageSupported&&members.some(m=>clipLocked(project,m.track,m.clip)))};
 });
}
