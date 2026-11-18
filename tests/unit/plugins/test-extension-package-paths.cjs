// Build original tar bytes directly so malformed paths are not normalized by a packer.
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {extensionFile,assertExtensionPaths}=require('../../../shared/pluginExtensionFiles.cjs');
const {readFolder,readArchive,validateFiles,validateIntake}=require('../../../electron/plugins/package.cjs');
const {PluginManager}=require('../../../electron/plugins/manager.cjs');
const manifest=Buffer.from(JSON.stringify({id:'test.portable',name:'Portable fixture',publisher:'Test',version:'0.1.0',apiVersion:1,main:'dist/extension.cjs'}));
const main=Buffer.from('throw Error("Validation and installation must not execute code");');
const files=extra=>new Map([['plugin.json',manifest],['dist/extension.cjs',main],...extra]);
const {archive}=require('../../fixtures/pluginArchive.cjs');
const pax=(key,value)=>{let record='',length=0;do{length=Buffer.byteLength(record);record=`${length} ${key}=${value}\n`;}while(Buffer.byteLength(record)!==length);return Buffer.from(record);};
(async()=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'clipcraft-extension-paths-')),checks=[];
 const check=name=>{checks.push(name);console.log('PASS',name);};
 for(const name of ['dist/extension.cjs','dist/ui/Panel.js','assets/Scene.webm','assets/.notes.txt','assets/console.txt','assets/com10.txt'])assert.ok(extensionFile(name),name);
 for(const name of ['dist/CON.js','assets/nul.txt','assets/PrN/icon.svg','assets/AUX.notes.txt','dist/COM1.js','assets/LpT9/icon.svg','dist/part./index.js','dist/part../index.js','dist/../index.js','dist//index.js','/dist/index.js','dist\\index.js','dist/C:/index.js','dist/a b.js'])assert.equal(extensionFile(name),false,name);
 check('single-path policy rejects reserved names, trailing dots, traversal and nonportable separators');
 const collisions=[
  ['dist/Panel.js','dist/panel.js'],
  ['assets/Icons/a.svg','assets/icons/b.svg'],
  ['assets/file.js','assets/file.js/child.js'],
  ['assets/Dir.txt/a.txt','assets/dir.txt'],
 ];
 for(const names of collisions){for(const name of names)assert.ok(extensionFile(name));for(const ordered of [names,[...names].reverse()]){
  assert.throws(()=>assertExtensionPaths(['plugin.json','dist/extension.cjs',...ordered]),/portable and unambiguous/);
  await assert.rejects(validateFiles(files(ordered.map(name=>[name,Buffer.from('fixture')])),'2.0.0'),/portable and unambiguous/);
 }}
 check('case aliases and file/directory conflicts reject in either order, including implied directories');
 const accepted=files([['assets/Icons/a.svg',Buffer.from('<svg/>')],['assets/Icons/b.svg',Buffer.from('<svg/>')]]),canonical=await validateFiles(accepted,'2.0.0');
 assert.equal((await validateFiles(new Map([...accepted].reverse()),'2.0.0')).key,canonical.key);
 check('consistent mixed-case directories remain supported with order-independent fingerprints');
 const source=path.join(directory,'valid');await fs.mkdir(source);for(const [name,bytes] of accepted){await fs.mkdir(path.dirname(path.join(source,name)),{recursive:true});await fs.writeFile(path.join(source,name),bytes);}
 assert.equal((await validateFiles(await readFolder(source),'2.0.0')).key,canonical.key);
 const validArchive=path.join(directory,'valid.tgz');await fs.writeFile(validArchive,archive([...accepted].map(([name,bytes])=>({name,bytes}))));
 assert.equal((await validateFiles(await readArchive(validArchive),'2.0.0')).key,canonical.key);
 check('regular folder and original archive bytes retain exact native fingerprint parity');
 await require('../../../scripts/build-plugin-sdk.cjs').buildSdk();const sdk=require('../../../packages/plugin-sdk/dist/authoring.cjs');
 assert.equal((await sdk.validatePlugin(validArchive)).key,canonical.key);
 const manager=new PluginManager(path.join(directory,'installed'),'2.0.0'),[installed]=await manager.install(validArchive);assert.equal(installed.key,canonical.key);const inventory=await fs.readFile(path.join(manager.root,'inventory.json'));
 for(let i=0;i<collisions.length;i++){
  const target=path.join(directory,'collision-'+i+'.tgz'),payload=files(collisions[i].map(name=>[name,Buffer.from('fixture')]));await fs.writeFile(target,archive([...payload].map(([name,bytes])=>({name,bytes}))));
  await assert.rejects(sdk.validatePlugin(target),error=>error.code==='VALIDATION_FAILED'&&/portable and unambiguous/.test(error.message));
  await assert.rejects(manager.install(target),/portable and unambiguous/);
  assert.deepEqual(await fs.readFile(path.join(manager.root,'inventory.json')),inventory);
 }
 check('built SDK and native installer refuse aliases before any inventory publication');
 const badEntries=[
  {name:'../outside.txt'}, {name:'/tmp/outside.txt'}, {name:'dist\\outside.js'},
  {name:'dist/extension.cjs',bytes:main}, // Duplicate exact entry.
  {name:'assets/linked.txt',bytes:Buffer.alloc(0),type:'2',link:'../../outside.txt'},
  {name:'assets/hard.txt',bytes:Buffer.alloc(0),type:'1',link:'dist/extension.cjs'},
  {name:'assets/CON.txt'}, {name:'assets/trailing./child.txt'},
  // The same nonportable separator carried by a PAX record and by a GNU long name.
  [{name:'PaxHeader/outside',type:'x',bytes:pax('path','dist\\outside.js')},{name:'dist/placeholder.js'}],
  [{name:'././@LongLink',type:'L',bytes:Buffer.from('dist\\outside.js\0')},{name:'dist/placeholder.js'}],
 ];
 for(let i=0;i<badEntries.length;i++){
  const target=path.join(directory,'malformed-'+i+'.tgz');await fs.writeFile(target,archive([{name:'plugin.json',bytes:manifest},{name:'dist/extension.cjs',bytes:main},...[badEntries[i]].flat()]));
  await assert.rejects(readArchive(target),/Package must contain/);
  await assert.rejects(manager.install(target));assert.deepEqual(await fs.readFile(path.join(manager.root,'inventory.json')),inventory);
 }
 // The tar reader rewrites "\\" to "/" on Windows. Run the same archives through a reader that
 // believes it is on Windows, so every platform's run proves the refusal does not depend on that.
 const windows=require('node:child_process').spawnSync(process.execPath,['-e',`const {readArchive}=require(${JSON.stringify(path.resolve(__dirname,'../../../electron/plugins/package.cjs'))});(async()=>{for(let i=0;i<${badEntries.length};i++){let accepted=true;try{await readArchive(require('node:path').join(${JSON.stringify(directory)},'malformed-'+i+'.tgz'));}catch(error){accepted=!/Package must contain/.test(error.message);}if(accepted){console.error('malformed-'+i+' accepted');process.exitCode=1;}}})()`],{env:{...process.env,TESTING_TAR_FAKE_PLATFORM:'win32'},encoding:'utf8'});
 assert.equal(windows.status,0,windows.stderr);
 check('archive names are judged as written, so Windows path rewriting cannot admit a nonportable separator');
 assert.deepEqual((await fs.readdir(manager.root)).filter(name=>!['inventory.json',installed.key].includes(name)),[]);
 await assert.rejects(fs.stat(path.join(directory,'outside.txt')),{code:'ENOENT'});
 check('traversal, absolute paths, duplicate entries and links cannot escape or leave install staging');
 const oversize=files([['assets/large.txt',Buffer.alloc(32*1024*1024+1)]]);await assert.rejects(validateFiles(oversize,'2.0.0'),/resource limits/);
 const crowded=files(Array.from({length:4095},(_,i)=>['assets/item-'+i+'.txt',Buffer.alloc(0)]));await assert.rejects(validateFiles(crowded,'2.0.0'),/resource limits/);
 check('direct authoring buffers obey native per-file and file-count limits');
 const historical=await validateFiles(await readFolder(path.resolve(__dirname,'../../fixtures/plugins/legacy/chapter-markers')),'2.0.0');assert.equal(historical.key,'8a117e77523afa98a66c998abf2a42bb6ccefa654d4e6ad2cb7e6553b1302260');
 check('historical creative/package fingerprint logic is unchanged');
 const wav=Buffer.alloc(46);wav.write('RIFF');wav.writeUInt32LE(38,4);wav.write('WAVE',8);wav.write('fmt ',12);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(8000,24);wav.writeUInt32LE(16000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(2,40);
 const creative=names=>new Map([['plugin.json',Buffer.from(JSON.stringify({id:'test.creative-paths',name:'Creative paths',publisher:'Test',version:'0.1.0',apiVersion:1,contributes:{sounds:names.map((file,i)=>({id:'sound-'+i,name:'Original sample '+i,file,kind:'sfx',license:'Original test signal; CC0-1.0'}))}}))],...names.map(name=>[name,wav])]);
 for(const [i,names] of [['assets/Case.wav','assets/case.wav'],['assets/NUL.wav']].entries()){
  const payload=creative(names),captured=await validateFiles(payload,'2.0.0'),target=path.join(directory,'creative-collision-'+i+'.tgz');await fs.writeFile(target,archive([...payload].map(([name,bytes])=>({name,bytes}))));
  await assert.rejects(validateIntake(payload,'2.0.0'),/portable and unambiguous/);
  assert.equal((await sdk.inspectPlugin(target)).key,captured.key,'read-only inspection retains the historical fingerprint');
  await assert.rejects(sdk.validatePlugin(target),error=>error.code==='VALIDATION_FAILED'&&/portable and unambiguous/.test(error.message));await assert.rejects(manager.install(target),/portable and unambiguous/);assert.deepEqual(await fs.readFile(path.join(manager.root,'inventory.json')),inventory);
 }
 check('creative asset aliases reject on new intake while captured historical bytes remain inspectable');
 const project=path.join(directory,'creative-author');await sdk.createPlugin(project,{id:'test.creative-paths',name:'Creative author',publisher:'Test',template:'content-pack'});await fs.writeFile(path.join(project,'plugin.json'),creative(['assets/NUL.wav']).get('plugin.json'));
 await assert.rejects(sdk.checkPlugin(project),error=>error.code==='VALIDATION_FAILED'&&/portable and unambiguous/.test(error.message));await assert.rejects(sdk.buildPlugin(project),/portable and unambiguous/);await assert.rejects(fs.stat(path.join(project,'dist')),{code:'ENOENT'});
 check('creative author preflight rejects reserved asset declarations before file access or output writes');
 let retainedExistingPayloadOnDisk=false;
 if(process.platform!=='win32'){
  const payload=creative(['assets/NUL.wav']),captured=await validateFiles(payload,'2.0.0'),installed=path.join(manager.root,captured.key);await fs.mkdir(installed);
  for(const [name,bytes] of payload){await fs.mkdir(path.dirname(path.join(installed,name)),{recursive:true});await fs.writeFile(path.join(installed,name),bytes);}
  await manager.save([...(await manager.inventory()),{key:captured.key,enabled:true}]);assert.equal((await manager.read(captured.key)).id,'test.creative-paths');assert.deepEqual((await manager.commandBundle(captured.key)).files.get('assets/NUL.wav'),wav);
  const {DevelopmentSessions}=require('../../../electron/plugins/development.cjs'),development=new DevelopmentSessions(manager);await assert.rejects(development.start(installed),/portable and unambiguous/);assert.equal(development.session,null);assert.equal(development.roots.size,0);await development.dispose();retainedExistingPayloadOnDisk=true;
  check('existing Unix creative payload stays readable; a new development materialization refuses it');
 }
 await fs.writeFile(path.join(directory,'result.json'),JSON.stringify({ok:true,checks,retainedExistingPayloadOnDisk},null,2));console.log('Portable extension package evidence: '+directory);
})().catch(error=>{console.error(error);process.exitCode=1;});
