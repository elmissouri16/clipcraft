// Exercise all shipped packages in their real utility processes against local network fixtures.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), http = require('node:http');
const assert = require('node:assert/strict');
const {execFileSync,spawn} = require('node:child_process');
const {ffmpegPath} = require('../../../electron/media/ffmpeg.cjs');
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'clipcraft-media-sources-')), root = path.resolve(__dirname,'../../..');
  const {PluginManager} = require('../../../electron/plugins/manager.cjs');
  const manager = new PluginManager(path.join(dir,'plugins'),'2.0.0');
  const previous = path.join(dir,'previous-pixabay');
  fs.cpSync(path.join(root,'electron/bundled-media/pixabay'),previous,{recursive:true});
  const manifestFile=path.join(previous,'plugin.json'), manifest=JSON.parse(fs.readFileSync(manifestFile));
  for (const version of ['0.9.0','0.9.1']) {
    fs.writeFileSync(manifestFile,JSON.stringify({...manifest,version}));
    const rows=await manager.install(previous,true);
    fs.writeFileSync(path.join(manager.root,'.bundled-media.json'),JSON.stringify({pixabay:rows.find(row=>row.enabled).key}));
  }
  fs.mkdirSync(path.join(dir,'settings-test'));
  fs.writeFileSync(path.join(dir,'settings-test/settings.json'), JSON.stringify({firstRun:{tourSeen:true,packPromptSeen:true}}));
  const make = (input, args, filename) => execFileSync(ffmpegPath,['-v','error','-f','lavfi','-i',input,...args,path.join(dir,filename)]);
  make('color=c=red:s=320x180:r=24:d=1',['-c:v','libx264','-pix_fmt','yuv420p'],'video.mp4');
  make('color=c=red:s=320x180',['-frames:v','1'],'photo.png');
  make('sine=frequency=440:duration=12',['-c:a','libmp3lame'],'meme.mp3');
  const soundza = await require('../../fixtures/soundza-stub.cjs').start();
  let origin;
  const seen = [];
  const server = http.createServer((req,res) => {
    const u = new URL(req.url,origin); seen.push(u.pathname);
    const send = (mime,data,status=200) => {res.writeHead(status,{'content-type':mime});res.end(data);};
    if (u.pathname === '/api/videos/' || u.pathname === '/api/') {
      if (u.searchParams.get('key') !== 'fixture-pix') return send('text/plain','invalid key',403);
      const file = {url:origin+'/video.mp4',thumbnail:origin+'/photo.png',width:320,height:180};
      return send('application/json',JSON.stringify({totalHits:1,hits:[{id:19,tags:'Red scene',user:'Studio',duration:1,pageURL:'https://pixabay.com/videos/19/',videos:{medium:file,small:file},largeImageURL:origin+'/photo.png',webformatURL:origin+'/photo.png',imageWidth:320,imageHeight:180}]}));
    }
    if (u.pathname.startsWith('/en/')) return send('text/html',"<button onclick=\"play('/media/sounds/meme.mp3', 'loader-11', 'fixture')\"></button><a class=\"instant-link\">Meme fixture</a>");
    const files = {'/video.mp4':['video/mp4','video.mp4'],'/photo.png':['image/png','photo.png'],'/media/sounds/meme.mp3':['audio/mpeg','meme.mp3']};
    if (files[u.pathname]) {const [mime,name]=files[u.pathname];return send(mime,fs.readFileSync(path.join(dir,name)));}
    return send('application/json',JSON.stringify({page_count:1,result_count:0,results:[]}));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve)); origin='http://127.0.0.1:'+server.address().port;
  const fd=fs.openSync(path.join(dir,'runtime.log'),'w');
  try {
    for(const reopen of [false,true]) {
      const child=spawn(require('electron'),[root],{cwd:root,stdio:['ignore',fd,fd],env:{...process.env,FVE_SMOKE:dir,FVE_SMOKE_MODE:'media-sources',FVE_SMOKE_QUIET:'1',CLIPCRAFT_BUNDLED_MEDIA:'1',FVE_SOURCE_REOPEN:reopen?'1':'0',FVE_PIXABAY_API:origin+'/api/',FVE_MYINSTANTS_URL:origin,FVE_OPENVERSE_API:origin+'/v1/',CLIPCRAFT_SOUNDZA_URL:'http://127.0.0.1:'+soundza.port+'/v1',VITE_DEV_SERVER_URL:''}});
      const code=await new Promise(resolve=>{const timer=setTimeout(()=>child.kill('SIGKILL'),90000);child.once('exit',code=>{clearTimeout(timer);resolve(code);});});
      const result=JSON.parse(fs.readFileSync(path.join(dir,reopen?'reopened.json':'initial.json')));
      assert.equal(code,0,result.error);assert.ok(result.ok,result.error);
    }
    assert.ok(seen.includes('/video.mp4')&&seen.includes('/media/sounds/meme.mp3')&&soundza.hits.search>0);
    console.log('Verified bundled sources, browser, saved project and export: '+dir);
  } finally {server.close();soundza.server.close();fs.closeSync(fd);}
})().catch(e=>{console.error(e);process.exitCode=1;});
