// Fixed host jobs only: no source paths, encoder arguments, URLs or credentials.
export const MEDIA_JOB_LIMITS=Object.freeze({sourceBytes:512*1024*1024,outputBytes:512*1024*1024,seconds:60,deadlineMs:120000});
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const exact=(v,keys)=>{if(!object(v)||Object.keys(v).some(k=>!keys.includes(k))||keys.some(k=>!Object.hasOwn(v,k)))throw Error('Invalid media job fields.');};
export function mediaJob(method,value){
 if(method==='media.import'){exact(value,['kind']);if(!['image','video','audio'].includes(value.kind))throw Error('Unsupported media kind.');return {operation:'copy',kind:value.kind};}
 if(method!=='media.process')throw Error('Unsupported media job.');
 if(value?.operation==='resize-image'){exact(value,['operation','max_size']);if(![320,640,1280].includes(value.max_size))throw Error('Unsupported image size.');return {...value,kind:'image'};}
 exact(value,['operation','start_sec','duration_sec']);
 if(!['extract-audio','trim-video'].includes(value.operation)||!Number.isFinite(value.start_sec)||value.start_sec<0||value.start_sec>1e6||!Number.isFinite(value.duration_sec)||value.duration_sec<.1||value.duration_sec>MEDIA_JOB_LIMITS.seconds)throw Error('Choose a bounded media range of 0.1–60 seconds.');
 return {...value,kind:value.operation==='extract-audio'?'audio':'video'};
}
export function validateExportDestination(value){
 exact(value,['id','name','origin']);
 if(typeof value.id!=='string'||!/^[a-z][a-z0-9-]{0,63}$/.test(value.id)||typeof value.name!=='string'||!value.name.trim()||value.name.length>160||/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/.test(value.name))throw Error('Invalid export destination.');
 let url;try{url=new URL(value.origin);}catch{throw Error('Invalid destination origin.');}
 if(url.protocol!=='https:'||url.origin!==value.origin||url.username||url.password||url.port||!/^([a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/.test(url.hostname)||/\.(?:localhost|local|internal|test|invalid)$/.test(url.hostname))throw Error('Declare a public HTTPS origin on the standard port.');
 return {...value};
}
export function uploadInput(value,destinations){exact(value,['destinationId']);const destination=destinations.find(d=>d.id===value.destinationId);if(!destination)throw Error('Choose a declared export destination.');return {destinationId:destination.id};}
export function uploadAnswer(value,origin){
 exact(value,['url','token']);let url;try{url=new URL(value.url);}catch{throw Error('Enter an HTTPS upload URL.');}
 if(typeof value.url!=='string'||value.url.length>4096||url.origin!==origin||url.username||url.password||url.hash||/[\u0000-\u0020\u007f]/.test(value.url))throw Error('The upload URL must use the declared HTTPS origin.');
 if(typeof value.token!=='string'||value.token.length>4096||/[^\x21-\x7e]/.test(value.token))throw Error('Invalid bearer token.');
 return {url:url.href,token:value.token};
}
