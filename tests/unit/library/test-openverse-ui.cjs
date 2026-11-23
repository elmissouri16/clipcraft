// Real Electron UI with a local Openverse fixture; no provider keys or user's project changes.
// Native clipboard acceptance requires an activatable app, even in an otherwise quiet battery.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), http = require('node:http'), net = require('node:net');
const { spawn, execFileSync } = require('node:child_process');
const assert = require('node:assert/strict');
(async () => {
  const root = path.resolve(__dirname, '../../..'), dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clipcraft-openverse-ui-'));
  fs.mkdirSync(path.join(dir, 'settings-test'));
  fs.writeFileSync(path.join(dir, 'settings-test/settings.json'), JSON.stringify({ firstRun: { tourSeen: true, packPromptSeen: true } }));
  const ff = require('../../../electron/media/ffmpeg.cjs');
  execFileSync(ff.ffmpegPath, ['-v','error','-y','-f','lavfi','-i','color=c=0x246a56:s=640x360','-frames:v','1',path.join(dir,'photo.png')]);
  execFileSync(ff.ffmpegPath, ['-v','error','-y','-f','lavfi','-i','sine=frequency=600:duration=1',path.join(dir,'sound.wav')]);
  const pack=path.join(dir,'clipcraft-assets-test');fs.mkdirSync(pack);
  fs.copyFileSync(path.join(dir,'sound.wav'),path.join(pack,'track.wav'));
  if(!process.env.FVE_BROWSER_EMPTY_PACK)fs.writeFileSync(path.join(pack,'library.json'),JSON.stringify({items:[
    {name:'Original library music',file:'track.wav',group:'Music',sub:'Library',kind:'audio',duration:1},
    {name:'Local ambient recording',file:'track.wav',group:'Sound FX',sub:'Ambience',kind:'audio',duration:1}
  ]}));
  const ids = ['98a11e0c-7e10-4610-9402-f3969126455a', 'abefa1df-a6f9-40fb-9ef9-c471fb21cb92'];
  const requests = [];
  let origin;
  const server = http.createServer((req, res) => {
    requests.push(req.url); const u = new URL(req.url, origin);
    if (u.pathname.startsWith('/en/')) {
      const page = Number(u.searchParams.get('page') || 1), id = page === 2 ? '22' : '11';
      const html = `<div id="instants_container"><button onclick="play('/media/sounds/fixture-${id}.mp3', 'loader-${id}', 'fixture-${id}')"></button><a class="instant-link">Original page ${page}</a></div><div id="loading"></div>`;
      res.writeHead(page >= 3 ? 404 : 200, {'content-type':'text/html'});
      return res.end(page >= 3 ? '' : html);
    }
    const audio = u.pathname.includes('/audio/');
    if (u.pathname.endsWith('/thumb/') || u.pathname === '/photo.png' || u.pathname === '/sound.wav') {
      const sound = u.pathname === '/sound.wav'; res.setHeader('content-type', sound ? 'audio/wav' : 'image/png');
      return res.end(fs.readFileSync(path.join(dir, sound ? 'sound.wav' : 'photo.png')));
    }
    const records = ids.map((id, i) => ({ id, title: `${i ? 'Credit' : 'CC0'} ${audio ? 'sound' : 'forest'}`, creator: 'Fixture artist',
      license: i ? 'by' : 'cc0', license_version: i ? '4.0' : '1.0', license_url: `https://creativecommons.org/${i ? 'licenses/by/4.0' : 'publicdomain/zero/1.0'}/`,
      attribution: `${i ? 'Credit' : 'CC0'} ${audio ? 'sound' : 'forest'} by Fixture artist, ${i ? 'CC BY 4.0' : 'CC0'}`,
      foreign_landing_url: 'https://www.flickr.com/photos/fixture/123', source: audio ? 'freesound' : 'flickr',
      url: `${origin}/${audio ? 'sound.wav' : 'photo.png'}`, thumbnail: `${origin}/v1/images/${id}/thumb/`, duration: 1000, width: 640, height: 360 }));
    const id = u.pathname.split('/')[3];
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(id ? records.find(r => r.id === id) : { page_count: 1, result_count: 2, results: records.filter(r => u.searchParams.get('license').split(',').includes(r.license) && (u.searchParams.get('q') !== 'onlycredited' || r.license === 'by')) }));
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r)); origin = `http://127.0.0.1:${server.address().port}`;
  const port = await new Promise(r => { const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>r(p));}); });
  const fd = fs.openSync(path.join(dir, 'runtime.log'), 'w'), url=`http://127.0.0.1:${port}`;
  const vite = spawn(process.execPath, [path.join(root,'node_modules/vite/bin/vite.js'),'--host','127.0.0.1','--port',String(port),'--strictPort'], { cwd:root, stdio:['ignore',fd,fd] });
  let electron;
  try {
    for(let i=0;i<100;i++){try{if((await fetch(url)).ok)break;}catch{}await new Promise(r=>setTimeout(r,80));}
    electron=spawn(require('electron'),['--no-sandbox',root],{cwd:root,stdio:['ignore',fd,fd],env:{...process.env,FVE_SMOKE:dir,FVE_SMOKE_QUIET:'0',FVE_SMOKE_MODE:'openverse',CLIPCRAFT_BUNDLED_MEDIA:'1',FVE_MYINSTANTS_URL:origin,CLIPCRAFT_ASSETS_DIR:pack,CLIPCRAFT_BUNDLED_PACK_DIR:path.join(dir,'no-bundle'),FVE_OPENVERSE_API:`${origin}/v1/`,VITE_DEV_SERVER_URL:url}});
    const code=await new Promise(resolve=>{const t=setTimeout(()=>{electron.kill('SIGKILL');resolve(-1);},120000);electron.once('exit',c=>{clearTimeout(t);resolve(c);});});
    fs.writeFileSync(path.join(dir,'requests.json'),JSON.stringify(requests,null,2));
    const result=JSON.parse(fs.readFileSync(path.join(dir,'result.json'))); assert.equal(code,0,result.error);assert.ok(!result.error,result.error);
    assert.ok(requests.some(r=>r.includes('/audio/'))); assert.ok(requests.some(r=>r.includes('license=cc0%2Cby')));
    if (!process.env.FVE_BROWSER_EMPTY_PACK) assert.ok([1,2,3].every(page => requests.some(value => {const url = new URL(value, origin); return url.searchParams.get('name') === 'original pagination' && url.searchParams.get('page') === String(page);})));
    console.log('Real-app Openverse passed; evidence: '+dir);
  } finally { electron?.kill();vite.kill();server.close();fs.closeSync(fd); }
})().catch(e=>{console.error(e);process.exitCode=1;});
