// Bounded GIF recipe. Plugins never choose paths, codecs, filters or frame bytes.
export const GIF_LIMITS=Object.freeze({seconds:15,frames:300,snapshotBytes:8*1024*1024,frameBytes:512*1024*1024,outputBytes:256*1024*1024});
export const GIF_PARAMETERS=[
 {id:'start_sec',name:'Start (seconds)',min:0,max:1000000,step:0.1,default:0},
 {id:'end_sec',name:'End (seconds; 0 = five seconds or project end)',min:0,max:1000000,step:0.1,default:0},
 {id:'max_size',name:'Longest edge',type:'enum',default:'size-480',options:[320,480,720,960].map(n=>({value:`size-${n}`,label:`${n} px`}))},
 {id:'fps',name:'Frame rate',type:'enum',default:'fps-10',options:[5,10,20].map(n=>({value:`fps-${n}`,label:`${n} fps`}))},
];
export function gifPlan(project,input){
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!GIF_PARAMETERS.some(p=>p.id===k)))throw Error('Invalid GIF settings.');
 const v=Object.fromEntries(GIF_PARAMETERS.map(p=>[p.id,input[p.id]??p.default]));
 const fps={'fps-5':5,'fps-10':10,'fps-20':20}[v.fps],cap={'size-320':320,'size-480':480,'size-720':720,'size-960':960}[v.max_size];
 const {width,height,duration_sec:duration}=project||{};
 if(!Number.isInteger(width)||!Number.isInteger(height)||width<2||height<2||width>16384||height>16384||!Number.isFinite(duration)||duration<=0)throw Error('Invalid GIF project geometry or duration.');
 const start=v.start_sec,end=v.end_sec===0?Math.min(duration,start+5):v.end_sec;
 if(!fps||!cap||!Number.isFinite(start)||!Number.isFinite(end)||start<0||end<=start||end>duration+1e-7||end-start>GIF_LIMITS.seconds+1e-7)throw Error('Choose a GIF range inside the video timeline, at most 15 seconds long.');
 const frames=Math.ceil((end-start)*fps-1e-7);
 if(frames<1||frames>GIF_LIMITS.frames)throw Error('GIF frame limit exceeded.');
 const scale=Math.min(1,cap/Math.max(width,height));
 return {start_sec:start,end_sec:end,width:Math.max(2,Math.round(width*scale)),height:Math.max(2,Math.round(height*scale)),fps,frame_count:frames,duration_sec:frames/fps};
}
export function gifProjectSnapshot(project){
 const {craftAI,posterImage,posterImageAt,...copy}=project;
 copy.media=(project.media||[]).map(({thumb,thumbCount,thumbInterval,thumbW,thumbH,wave,poster,proxy,proxies,lightProxy,optimizing,proxyRequired,proxyFailed,...media})=>media);
 return JSON.parse(JSON.stringify(copy));
}
