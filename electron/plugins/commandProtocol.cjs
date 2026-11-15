// A non-file origin prevents Chromium workers from inheriting file:// module access.
const fs=require('node:fs/promises'),path=require('node:path');
const SCHEME='clipcraft-command',ORIGIN=`${SCHEME}://runtime`;
const CSP="default-src 'none'; script-src 'self' blob:; worker-src blob:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
function registerCommandScheme(protocol,additional=[]){protocol.registerSchemesAsPrivileged([{scheme:SCHEME,privileges:{standard:true,secure:true,supportFetchAPI:true,corsEnabled:true}},...additional]);}
function serveCommandProtocol(session){
 session.protocol.handle(SCHEME,async request=>{
  const resource=request.url===`${ORIGIN}/index.html`?'commandSandbox.html':request.url===`${ORIGIN}/commandSandbox.js`?'commandSandbox.js':null;
  if(request.method!=='GET'||!resource)return new Response('Not allowed',{status:403});
  const bytes=await fs.readFile(path.join(__dirname,resource));
  return new Response(bytes,{headers:{'content-type':resource.endsWith('.html')?'text/html; charset=utf-8':'text/javascript; charset=utf-8','content-security-policy':CSP,'x-content-type-options':'nosniff','cache-control':'no-store'}});
 });
}
module.exports={registerCommandScheme,serveCommandProtocol,COMMAND_URL:`${ORIGIN}/index.html`,COMMAND_SCRIPT_URL:`${ORIGIN}/commandSandbox.js`};
