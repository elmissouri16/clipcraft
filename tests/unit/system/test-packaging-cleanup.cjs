const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {getNodeModuleFileMatcher,getMainFileMatchers}=require('app-builder-lib/out/fileMatcher');
const root=path.resolve(__dirname,'../../..'),pkg=require('../../../package.json');
for(const [config,os,arch] of [['mac','darwin','arm64'],['mac','darwin','x64'],['linux','linux','x64'],['linux','linux','arm64'],['linux','linux','ia32'],['win','win32','x64'],['win','win32','ia32']]){
 const filter=getNodeModuleFileMatcher(root,path.join(root,'dist'),s=>s.replaceAll('${arch}',arch),pkg.build[config],{config:pkg.build,debugLogger:{isEnabled:false}}).createFilter();
 // electron-builder normalizes global files into a FileSet. A negative-only
 // platform matcher would otherwise create a second permissive project matcher.
 const info={config:{...pkg.build,files:[{from:'.',to:'.',filter:pkg.build.files}]},projectDir:root,buildResourcesDir:'build',isPrepackedAppAsar:false,debugLogger:{isEnabled:false}};
 const matchers=getMainFileMatchers(root,path.join(root,'dist'),s=>s.replaceAll('${arch}',arch),pkg.build[config],{info},path.join(root,'release'),false);
 const appAllows=name=>matchers.some(m=>m.createFilter()(path.join(root,name),{isDirectory:()=>false}));
 for(const name of ['dist/index.html','electron/main.cjs','shared/luts/example.cube','assets/icon.png','package.json','LICENSE','THIRD-PARTY-NOTICES.md'])assert.equal(appAllows(name),true,name+' remains included');
 for(const name of ['release/old.dmg','src/main.jsx','tests/test.cjs','scripts/dev.cjs','public/logo.png','AGENTS.md'])assert.equal(appAllows(name),false,name+' stays outside the application');
 const allowed=relative=>filter(path.join(root,relative),{isDirectory:()=>false});
 for(const target of ['darwin','linux','win32'])for(const cpu of ['arm64','x64','ia32'])assert.equal(allowed(`node_modules/ffprobe-static/bin/${target}/${cpu}/ffprobe${target==='win32'?'.exe':''}`),target===os&&cpu===arch,`${config}/${arch} only ships its matching fallback`);
 for(const name of ['lucide-react','react','react-dom','scheduler','loose-envify','js-tokens']){
  for(const file of ['index.js','cjs/index.js','dist/index.mjs','types.d.ts'])assert.equal(allowed(`node_modules/${name}/${file}`),false);
  assert.equal(allowed(`node_modules/${name}/LICENSE`),true,'UI library licenses remain included');
 }
 for(const file of ['@anthropic-ai/claude-agent-sdk/sdk.mjs','@openai/codex-sdk/dist/index.js','zod/index.cjs','tar/dist/commonjs/index.js','@ffprobe-installer/'+os+'-'+arch+'/ffprobe'])assert.equal(allowed('node_modules/'+file),true,'runtime dependencies remain included');
 assert.equal(allowed('dist/assets/font.woff2'),true);assert.equal(allowed('node_modules/@fontsource/montserrat/400.css'),false);assert.equal(allowed('node_modules/@fontsource/montserrat/LICENSE'),true);
}
console.log('UI build code is excluded; runtime modules and licenses are kept; fallback selection covers both universal Mac slices, Linux and Windows');
