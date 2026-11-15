const SCHEME='clipcraft-panel';
const CSP="default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'none'; font-src 'none'; connect-src 'none'; worker-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
const PANEL_SCHEME={scheme:SCHEME,privileges:{standard:true,secure:true,supportFetchAPI:true,corsEnabled:true}};
function servePanelProtocol(session,origin,files,panel){
 const names=[panel.entry,panel.script,panel.style].filter(Boolean),allowed=new Set(names.map(name=>`${origin}/${name}`));
 session.protocol.handle(SCHEME,request=>{
  if(request.method!=='GET'||!allowed.has(request.url))return new Response('Not allowed',{status:403});
  const name=request.url.slice(origin.length+1),type=name.endsWith('.html')?'text/html':name.endsWith('.css')?'text/css':'text/javascript';
  return new Response(files.get(name),{headers:{'content-type':`${type}; charset=utf-8`,'content-security-policy':CSP,'x-content-type-options':'nosniff','cache-control':'no-store'}});
 });
 session.webRequest.onBeforeRequest((details,callback)=>callback({cancel:details.method!=='GET'||!allowed.has(details.url)}));
}
module.exports={SCHEME,CSP,PANEL_SCHEME,servePanelProtocol};
