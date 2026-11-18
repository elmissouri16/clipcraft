// Isolated native renderer proof: edit real React controls without touching a user project.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const root=path.resolve(__dirname,'../../..');
if (!process.versions.electron) {
 (async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'clipcraft-graphic-data-ui-'));
  const port=await new Promise(resolve=>{const server=require('node:net').createServer();server.listen(0,'127.0.0.1',()=>{const p=server.address().port;server.close(()=>resolve(p));});});
  const fd=fs.openSync(path.join(dir,'runtime.log'),'w'),url=`http://127.0.0.1:${port}`;
  const vite=spawn(process.execPath,[path.join(root,'node_modules/vite/bin/vite.js'),'--host','127.0.0.1','--port',String(port),'--strictPort'],{cwd:root,stdio:['ignore',fd,fd]});let electron;
  try {
   let ready=false;for(let i=0;i<100;i++){try{ready=(await fetch(url)).ok;}catch{}if(ready)break;await new Promise(r=>setTimeout(r,50));}assert.ok(ready,'isolated Vite starts');
   const env={...process.env,GRAPHIC_DATA_TEST_DIR:dir,GRAPHIC_DATA_TEST_URL:url};delete env.ELECTRON_RUN_AS_NODE;
   electron=spawn(require('electron'),[__filename],{cwd:root,env,stdio:['ignore',fd,fd]});
   const code=await new Promise(resolve=>{const timer=setTimeout(()=>{electron.kill('SIGKILL');resolve(-1);},60000);electron.once('exit',code=>{clearTimeout(timer);resolve(code);});});
   const result=JSON.parse(fs.readFileSync(path.join(dir,'result.json')));assert.equal(code,0,result.error);assert.equal(result.ok,true,result.error);
   console.log('Adaptive graphic data native renderer passed; evidence: '+dir);
  } finally {electron?.kill();vite.kill();fs.closeSync(fd);}
 })().catch(error=>{console.error(error);process.exitCode=1;});
} else {
 const {app,BrowserWindow}=require('electron'),dir=process.env.GRAPHIC_DATA_TEST_DIR;
 app.setPath('userData',path.join(dir,'profile'));if(process.platform==='darwin')app.setActivationPolicy('accessory');
 app.whenReady().then(async()=>{
  const win=new BrowserWindow({show:false,width:900,height:800,webPreferences:{contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
  const q=code=>win.webContents.executeJavaScript(code),wait=()=>new Promise(r=>setTimeout(r,35)),checks=[];
  await win.loadURL(process.env.GRAPHIC_DATA_TEST_URL);
  await q(`(async()=>{
   const source=await fetch('/src/features/inspector/components/GraphicDataField.jsx').then(r=>r.text()),main=await fetch('/src/main.jsx').then(r=>r.text());
   const React=(await import(source.match(/from ["']([^"']*\\/react\\.js[^"']*)["']/)[1])).default;
   const ReactDOM=(await import(main.match(/from ["']([^"']*react-dom_client\\.js[^"']*)["']/)[1])).default;
   const Field=(await import('/src/features/inspector/components/GraphicDataField.jsx')).default;
   const Panel=(await import('/src/features/inspector/components/GraphicPanel.jsx')).default;
   const {graphicDataError}=await import('/src/features/graphics/graphicData.js');
   const host=document.createElement('div');host.id='data-test';host.className='graphic-field wide';host.style.cssText='position:fixed;inset:0;width:480px;padding:16px;overflow:auto;z-index:999;background:#171723';document.body.appendChild(host);
   function Harness(){
    const [fixture,load]=React.useState({id:0,value:null}),[transient,validity]=React.useState('');
    window.loadData=(value,declaration)=>{validity('');load(previous=>({id:previous.id+1,value,declaration}));};
    window.dataValue=fixture.value;window.dataError=transient||graphicDataError(fixture.value,fixture.declaration);
    if(fixture.declaration?.panel){
      const schema=fixture.declaration.fields,media={id:'panel-media',type:'video',duration:2,graphic:{schema,inputs:fixture.value}},clip={id:'panel-clip',mediaId:media.id,start:0,in:0,out:2,speed:1};
      return React.createElement(Panel,{key:fixture.id,clip,media,project:{media:[media],overlayClips:[clip],videoClips:[],width:320,height:180,fps:30},track:'overlay',dispatch:action=>{window.panelActions.push(action);}});
    }
    return React.createElement(Field,{key:fixture.id,value:fixture.value,declaration:fixture.declaration,label:'Data',onChange:value=>load(previous=>({...previous,value})),onValidity:validity});
   }
   ReactDOM.createRoot(host).render(React.createElement(Harness));
  })()`);await wait();
  async function check(name,code){await wait();assert.ok(await q(code),name);checks.push(name);}
  async function load(value,schema){await q(`loadData(${JSON.stringify(value)},${JSON.stringify(schema)})`);await wait();}
  async function edit(label,value,tag='input'){
   await q(`(()=>{const input=[...document.querySelectorAll('#data-test ${tag}')].find(e=>e.getAttribute('aria-label')===${JSON.stringify(label)});if(!input)throw Error('Missing field '+${JSON.stringify(label)});input.focus();Object.getOwnPropertyDescriptor(${tag==='textarea'?'HTMLTextAreaElement':'HTMLInputElement'}.prototype,'value').set.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event('input',{bubbles:true}));})()`);await wait();
  }
  async function clickText(text,selector='button'){await q(`(()=>{const button=[...document.querySelectorAll('#data-test '+${JSON.stringify(selector)})].find(e=>e.textContent.trim()===${JSON.stringify(text)});if(!button)throw Error('Missing button '+${JSON.stringify(text)});button.click();})()`);await wait();}
  async function branch(title){await q(`(()=>{const button=[...document.querySelectorAll('#data-test .graphic-data-disclosure')].find(e=>e.querySelector('strong')?.textContent===${JSON.stringify(title)});if(!button)throw Error('Missing branch '+${JSON.stringify(title)});button.click();})()`);await wait();}
  async function choose(label,text){await q(`document.querySelector('#data-test button[aria-label='+JSON.stringify(${JSON.stringify(label)})+']').click()`);await wait();await clickText(text,'.dropdown-item');}
  const schema={type:'array',default:[],minItems:1,maxItems:2,itemLabel:'name',items:{type:'object',fields:{
   name:{type:'text',label:'Full name',default:''},age:{type:'text',label:'Age now',default:''},enabled:{type:'boolean',label:'Visible',default:false},
   birth:{type:'date',label:'Birth date',default:''},stats:{type:'object',label:'Details',fields:{score:{type:'number',label:'Rating',min:0,max:10,default:0},tags:{type:'array',label:'Tags',items:{type:'text',default:''}}}},
   notes:{type:'object',label:'Notes',nullable:true,default:null,fields:{caption:{type:'text',label:'Caption',default:'New caption'}}}
  }}};
  await load([{name:'Actor A',age:'61',enabled:false,birth:'1965-04-04',stats:{score:3,tags:['one','two']},notes:null,extra:'keep'}],schema);
  await check('initial forms need no JSON and keep declared labels',`!document.querySelector('#data-test textarea')&&!!document.querySelector('#data-test input[aria-label="Full name · 1"]')`);
  await check('dates and booleans get typed controls',`document.querySelector('#data-test input[aria-label="Birth date · 1"]').type==='date'&&document.querySelector('#data-test input[aria-label="Visible · 1"]').type==='checkbox'`);
  await check('collapsed descendants do not mount controls',`!document.querySelector('#data-test input[aria-label^="Rating"]')`);
  await edit('Age now · 1','62');await check('numeric-looking strings stay strings',`dataValue[0].age==='62'&&dataValue[0].extra==='keep'`);
  await branch('Details');await edit('Rating · Details · 1','8');
  await check('nested edits preserve siblings and numeric type',`dataValue[0].stats.score===8&&JSON.stringify(dataValue[0].stats.tags)==='["one","two"]'&&dataValue[0].extra==='keep'`);
  await edit('Rating · Details · 1','99');await check('invalid nested numeric drafts do not overwrite data',`dataValue[0].stats.score===8&&!!dataError`);
  await q(`document.querySelector('#data-test input[aria-label="Rating · Details · 1"]').dispatchEvent(new FocusEvent('focusout',{bubbles:true}))`);
  await check('leaving invalid number restores last valid value',`!dataError&&document.querySelector('#data-test input[aria-label="Rating · Details · 1"]').value==='8'`);
  await branch('Tags');await edit('Item 1 · 1 · Tags · Details · 1','changed');
  await check('nested scalar list edit is exact',`dataValue[0].stats.tags[0]==='changed'&&dataValue[0].stats.tags[1]==='two'`);
  await clickText('Set value');await check('nullable typed objects initialize from child metadata',`dataValue[0].notes.caption==='New caption'`);
  await q(`document.querySelector('#data-test button[aria-label="Clear value: Notes · 1"]').click()`);await check('nullable groups can be explicitly cleared again',`dataValue[0].notes===null`);
  await check('minimum list length disables removal',`document.querySelector('#data-test button[aria-label="Remove row 1"]').disabled`);
  await q(`[...document.querySelectorAll('#data-test .graphic-data-list-add>button')].at(-1).click()`);await check('item schema builds new entries and enforces maximum',`dataValue.length===2&&dataValue[1].name===''&&dataValue[1].stats.score===0&&dataValue[1].notes===null&&[...document.querySelectorAll('#data-test .graphic-data-list-add>button')].at(-1).disabled`);
  await load({child:{nested:[1,'2',false,null]}},{type:'json'});await branch('Child');await branch('Nested');
  await check('mixed nested list retains every original type',`JSON.stringify(dataValue.child.nested)==='[1,"2",false,null]'&&document.querySelectorAll('#data-test [data-data-entry]').length===4`);
  await load([], {type:'json',default:[]});await choose('New entry type','On / off');await clickText('Add entry');
  await check('empty untyped lists offer a type without JSON',`dataValue.length===1&&dataValue[0]===false`);
  await load({}, {type:'json'});await clickText('Add field');await edit('Field name','__proto__');await clickText('Add field');
  await check('dynamic property creation preserves keys without prototype mutation',`Object.hasOwn(dataValue,'__proto__')&&dataValue.__proto__===''&&Object.getPrototypeOf(dataValue)===Object.prototype`);
  await load(null,{type:'json'});await choose('Data','Group');await check('null is explicitly initialized, not silently coerced',`dataValue!==null&&!Array.isArray(dataValue)&&Object.keys(dataValue).length===0`);
  await q(`loadData(Array.from({length:5000},(_,i)=>({name:'Entry '+i,value:i})),{type:'array',items:{type:'object',fields:{name:{type:'text'},value:{type:'number'}}},itemLabel:'name'})`);await wait();
  const mounted=await q(`document.querySelectorAll('#data-test *').length`);
  await check('large collections mount one page',`document.querySelectorAll('#data-test [data-data-entry]').length===12&&document.querySelectorAll('#data-test *').length<500`);
  await clickText('Next');await branch('Entry 12');await edit('Name · 13','Changed entry');
  await check('off-page edits target the correct row',`dataValue[12].name==='Changed entry'&&dataValue[0].name==='Entry 0'&&dataValue[13].name==='Entry 13'`);
  await q(`document.querySelector('#data-test button[aria-label="Move entry 13 up"]').click()`);await check('moving entries across pages keeps data intact',`dataValue[11].name==='Changed entry'&&dataValue[12].name==='Entry 11'&&dataValue.length===5000`);
  await load({amount:2},{type:'object',fields:{amount:{type:'number'}}});await clickText('Edit JSON (advanced)','summary');await edit('Data','{','textarea');
  await check('advanced syntax errors remain visible without applying',`dataValue.amount===2&&!!dataError&&document.querySelector('#data-test textarea').getAttribute('aria-invalid')==='true'`);
  await clickText('Edit JSON (advanced)','summary');await check('closing advanced editor returns to form and clears abandoned syntax error',`!document.querySelector('#data-test textarea')&&!dataError&&dataValue.amount===2`);
  await q(`window.panelActions=[]`);
  await load({date:'',optional:null,note:'Short'},{panel:true,fields:{date:{type:'date',label:'Event date',default:''},optional:{type:'number',label:'Optional count',default:null,nullable:true,min:2,max:10},note:{type:'text',label:'Notes',control:'textarea',default:''}}});
  await check('the real inspector routes date, nullable and multiline scalar fields to appropriate controls',`document.querySelector('#data-test input[aria-label="Event date"]').type==='date'&&!!document.querySelector('#data-test textarea[aria-label="Notes"]')&&!document.querySelector('#data-test .graphic-data-advanced')`);
  await edit('Event date','2026-11-18');
  await check('date edits reach the real inspector draft without JSON quoting',`panelActions.some(action=>action.type==='batch'&&action.actions.some(change=>change.patch?.graphicDraft?.inputs.date==='2026-11-18'))`);
  await clickText('Set value');await check('top-level nullable numbers initialize within their declared bounds',`panelActions.some(action=>action.type==='batch'&&action.actions.some(change=>change.patch?.graphicDraft?.inputs.optional===2))`);
  const result={ok:true,checks,largeList:{entries:5000,mountedElements:mounted,pageSize:12}};fs.writeFileSync(path.join(dir,'result.json'),JSON.stringify(result,null,2));win.destroy();app.quit();
 }).catch(error=>{fs.writeFileSync(path.join(dir,'result.json'),JSON.stringify({ok:false,error:String(error.stack||error)},null,2));console.error(error);app.exit(1);});
}
