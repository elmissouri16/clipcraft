const SCHEME='clipcraft-extension-view';
const VIEW_SCHEME={scheme:SCHEME,privileges:{standard:true,secure:true,supportFetchAPI:true,corsEnabled:true}};
const CSP="default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; worker-src 'self' blob:; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
const MIME={html:'text/html',js:'text/javascript',mjs:'text/javascript',cjs:'text/javascript',css:'text/css',json:'application/json',svg:'image/svg+xml',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp',gif:'image/gif',woff2:'font/woff2',ttf:'font/ttf',otf:'font/otf',wav:'audio/wav',mp3:'audio/mpeg',ogg:'audio/ogg',mp4:'video/mp4',webm:'video/webm',wasm:'application/wasm'};
const denyClosedView=(_details,callback)=>callback({cancel:true});
function serveViewProtocol(session,origin,files){
 const allowed=new Map([...files].filter(([name])=>/^(dist|assets)\//.test(name)).map(([name,bytes])=>[origin+'/'+name,{name,bytes}]));
 const asset=url=>{try{const parsed=new URL(url);if(parsed.protocol+'//'+parsed.host!==origin||parsed.username||parsed.password)return;parsed.search='';parsed.hash='';return allowed.get(parsed.href);}catch{return;}};
 let disposed=false;
 const dispose=()=>{if(disposed)return;disposed=true;allowed.clear();try{session.protocol.unhandle(SCHEME);}finally{session.webRequest.onBeforeRequest(denyClosedView);}};
 try{
  session.protocol.handle(SCHEME,request=>{const file=asset(request.url);if(request.method!=='GET'||!file)return new Response('Not allowed',{status:403});return new Response(file.bytes,{headers:{'content-type':MIME[file.name.split('.').at(-1)]||'application/octet-stream','content-security-policy':CSP,'x-content-type-options':'nosniff','cache-control':'no-store'}});});
  session.webRequest.onBeforeRequest((details,callback)=>callback({cancel:details.method!=='GET'||!asset(details.url)}));
 }catch(error){try{dispose();}catch{}throw error;}
 // In-memory Electron sessions can outlive their renderer. Clear the snapshot
 // and retain a shared denial callback, rather than leaving asset bytes rooted
 // or briefly allowing network access while a closing renderer still exists.
 return dispose;
}
function viewPayload(value){
 let budget=256*1024;const ancestors=new Set();
 const copy=(v,depth=0)=>{
  if(depth>64)throw Error('View message exceeds nesting limit');
  if(v===null||typeof v==='boolean'||typeof v==='number'&&Number.isFinite(v)){budget-=16;if(budget<0)throw Error('View message exceeds 256 KiB');return v;}
  if(typeof v==='string'){budget-=Buffer.byteLength(v);if(budget<0)throw Error('View message exceeds 256 KiB');return v;}
  if(!v||typeof v!=='object'||(!Array.isArray(v)&&![Object.prototype,null].includes(Object.getPrototypeOf(v)))||ancestors.has(v))throw Error('View messages must be acyclic JSON data');
  ancestors.add(v);const result=Array.isArray(v)?[]:Object.create(null),keys=Object.keys(v);
  if(Array.isArray(v)&&(v.length>16384||keys.length!==v.length||keys.some((key,index)=>key!==String(index))))throw Error('View messages require bounded dense arrays');
  for(const key of keys){budget-=Buffer.byteLength(key)+8;if(budget<0)throw Error('View message exceeds 256 KiB');result[key]=copy(v[key],depth+1);}ancestors.delete(v);return result;
 };
 return copy(value);
}
module.exports={SCHEME,VIEW_SCHEME,CSP,serveViewProtocol,viewPayload};
