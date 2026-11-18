// Native in-app authoring. Draft assets are immutable snapshots scoped to the editor window.
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const {validateFiles,readArchive}=require('./package.cjs'),{writePackage}=require('./packageWriter.cjs');
class PackBuilder{
 constructor({manager,dialog,getWindow,fontDirectory}){Object.assign(this,{manager,dialog,getWindow,fontDirectory});this.current=null;}
 begin(){if(this.current)this.discard(this.current.id);const id=crypto.randomUUID();this.current={id,assets:new Map(),controller:new AbortController(),receipt:null,busy:false};return {id};}
 draft(id){if(!this.current||id!==this.current.id||this.current.controller.signal.aborted)throw Error('Pack draft is closed.');return this.current;}
 discard(id){if(this.current?.id===id){this.current.controller.abort();this.current.assets.clear();this.current=null;}return true;}
 async readAsset(file,kind){const {CONTENT_LIMITS,validateContentBytes}=await import('../../shared/pluginContent.mjs');const stat=await fs.lstat(file);if(!stat.isFile()||stat.size>CONTENT_LIMITS[kind])throw Error('Choose a regular asset within the pack size limits.');const bytes=await fs.readFile(file);const ext=path.extname(file).slice(1).toLowerCase();validateContentBytes(kind,bytes,'assets/file.'+ext);return {bytes,ext,name:path.basename(file,path.extname(file)).slice(0,160)};}
 async pick(id,kind){
  const draft=this.draft(id);if(draft.busy)throw Error('This draft is already exporting.');const extensions={sound:['wav','mp3','ogg'],font:['woff2','ttf','otf'],lut:['cube']}[kind];if(!extensions)throw Error('Unknown pack asset kind.');
  const answer=await this.dialog.showOpenDialog(this.getWindow(),{title:'Add pack assets',properties:['openFile','multiSelections'],filters:[{name:kind,extensions}]});this.draft(id);if(answer.canceled)return [];
  if(answer.filePaths.length+draft.assets.size>64)throw Error('At most 64 draft asset files.');const batch=[];let currentBytes=[...draft.assets.values()].reduce((sum,a)=>sum+a.bytes.length,0);
  for(const file of answer.filePaths){const asset=await this.readAsset(file,kind);currentBytes+=asset.bytes.length;if(currentBytes>128*1024*1024)throw Error('Draft assets exceed 128 MiB.');batch.push({...asset,kind,token:crypto.randomUUID(),filename:path.basename(file)});}
  this.draft(id);const total=[...draft.assets.values(),...batch].reduce((sum,a)=>sum+a.bytes.length,0);if(total>128*1024*1024)throw Error('Draft assets exceed 128 MiB.');for(const asset of batch)draft.assets.set(asset.token,asset);
  return batch.map(({bytes,...publicAsset})=>publicAsset);
 }
 async prepare(id,input){
  const draft=this.draft(id),{contentAssets,CONTENT_LIMITS}=await import('../../shared/pluginContent.mjs');
  if(!input||typeof input!=='object'||Object.keys(input).some(k=>!['metadata','assets','textStyles','colorPresets','motionPresets','fontLicenses'].includes(k))||Buffer.byteLength(JSON.stringify(input))>512*1024)throw Error('Invalid or oversized pack draft.');
  for(const key of ['textStyles','colorPresets','motionPresets'])if(!Array.isArray(input[key]||[])||(input[key]||[]).length>100)throw Error('At most 100 presets per kind.');
  if(!Array.isArray(input.assets||[])||(input.assets||[]).length>64)throw Error('At most 64 selected asset files.');
  const metadata=input.metadata;if(!metadata||Object.keys(metadata).some(k=>!['id','name','publisher','version','description'].includes(k)))throw Error('Invalid pack metadata.');
  const manifest={...metadata,apiVersion:1,contributes:{}},files=new Map(),fonts=new Map(),luts=new Map(),fontSources=new Map(),lutSources=new Map();let bytes=0;if(typeof manifest.description==='string'&&!manifest.description.trim())delete manifest.description;
  const put=(name,data)=>{draft.controller.signal.throwIfAborted();if(files.has(name))throw Error('Asset IDs create duplicate file names.');bytes+=data.length;if(bytes>CONTENT_LIMITS.total||files.size>=CONTENT_LIMITS.files)throw Error('Pack asset count or byte limit exceeded.');files.set(name,Buffer.from(data));};
  const unique=(prefix,map)=>{let i=1;while(map.has(prefix+'-'+i))i++;return prefix+'-'+i;};
  for(const selected of input.assets||[]){
   const asset=draft.assets.get(selected.token);if(!asset||selected.kind!==asset.kind)throw Error('Unknown draft asset token.');
   const common={id:selected.id,name:selected.name,license:selected.license};
   if(!/^[a-z][a-z0-9-]{0,63}$/.test(common.id)||typeof common.id!=='string')throw Error('Asset IDs must be lowercase names.');
   if(asset.kind==='font'){
    const existing=fonts.get(common.id);if(existing&&(existing.name!==common.name||existing.license!==common.license))throw Error('Faces in one font family must share its name and license.');
    const family=existing||{...common,faces:[]},file=`assets/font-${common.id}-${family.faces.length}.${asset.ext}`;put(file,asset.bytes);family.faces.push({file,weight:selected.weight??400,style:selected.style??'normal'});fonts.set(common.id,family);
   }else{
    const file=`assets/${asset.kind}-${common.id}.${asset.ext}`;put(file,asset.bytes);if(asset.kind==='lut'){if(luts.has(common.id))throw Error('Duplicate LUT ID.');luts.set(common.id,{...common,file});}else (manifest.contributes.sounds||=[]).push({...common,file,kind:selected.soundKind||'sfx'});
   }
  }
  const ensureFont=async source=>{
   if(typeof source==='string'&&source.startsWith('draft-font:')){const token=source.slice(11),selected=(input.assets||[]).find(a=>a.token===token&&a.kind==='font');if(!selected||!fonts.has(selected.id))throw Error('The selected draft font was removed.');return 'pack:'+selected.id;}
   const {FONT_LIST}=await import('../../shared/fontCatalog.mjs');if(FONT_LIST.some(f=>f.id===source))return source;
   if(fontSources.has(source))return 'pack:'+fontSources.get(source);const familyId=unique('style-font',fonts);let family;
   if(typeof source==='string'&&source.startsWith('pack-font:')){
    const first=await this.manager.contentBytes(source,'font');family={id:familyId,name:first.item.name,license:first.item.license,faces:[]};
    for(let i=0;i<first.item.faces.length;i++){const value=i?await this.manager.contentBytes(source,'font',i):first,face=first.item.faces[i],file=`assets/font-${familyId}-${i}${path.extname(face.file)}`;put(file,value.bytes);family.faces.push({file,weight:face.weight,style:face.style});}
   }else{
    if(typeof source!=='string'||!source.startsWith('custom-'))throw Error('Unknown source font.');const own=require('../export/fonts.cjs'),file=own.fileOf(this.fontDirectory(),source);if(!file)throw Error('The selected local font is unavailable.');
    const data=await this.readAsset(file,'font'),target=`assets/font-${familyId}-0.${data.ext}`;put(target,data.bytes);family={id:familyId,name:data.name,license:input.fontLicenses?.[source],faces:[{file:target,weight:400,style:'normal'}]};
   }
   fonts.set(familyId,family);fontSources.set(source,familyId);return 'pack:'+familyId;
  };
  const ensureLut=async(ref,license)=>{
   if(!ref||typeof ref!=='object')throw Error('Invalid source LUT.');if(ref.draftAsset){const selected=(input.assets||[]).find(a=>a.token===ref.draftAsset&&a.kind==='lut');if(!selected||!luts.has(selected.id))throw Error('The selected draft LUT was removed.');return selected.id;}let key,data,name,terms;
   if(ref.pluginDigest!==undefined||ref.assetId!==undefined){key=`pack:${ref.pluginDigest}:${ref.assetId}`;if(lutSources.has(key))return lutSources.get(key);const value=await this.manager.contentBytes(`pack-lut:${ref.pluginDigest}:${ref.assetId}`,'lut');data=value.bytes;name=value.item.name;terms=value.item.license;}
   else if(ref.bundled){if(typeof ref.bundled!=='string'||!/^[a-zA-Z0-9_-]+\.cube$/.test(ref.bundled))throw Error('Invalid bundled LUT.');key='bundled:'+ref.bundled;if(lutSources.has(key))return lutSources.get(key);const root=path.join(__dirname,'../../shared/luts');data=(await this.readAsset(path.join(root,ref.bundled),'lut')).bytes;name=path.basename(ref.bundled,'.cube');terms='LUTs: slay (CC BY 4.0). Source: https://github.com/slaycamera/luts — https://www.slaycamera.com. License: https://creativecommons.org/licenses/by/4.0/ . Included unchanged.';}
   else if(ref.path){if(typeof ref.path!=='string'||!path.isAbsolute(ref.path)||path.extname(ref.path).toLowerCase()!=='.cube')throw Error('Choose a local .cube LUT.');key='file:'+path.resolve(ref.path);if(lutSources.has(key))return lutSources.get(key);const value=await this.readAsset(ref.path,'lut');data=value.bytes;name=value.name;terms=license;}
   else throw Error('Unknown source LUT.');
   const id=unique('look-lut',luts),file=`assets/lut-${id}.cube`;put(file,data);luts.set(id,{id,name,license:terms,file});lutSources.set(key,id);return id;
  };
  const textStyles=[];for(const style of input.textStyles||[]){const value={...style,style:structuredClone(style.style)};if(value.style?.font)value.style.font=await ensureFont(value.style.font);textStyles.push(value);}
  const colorPresets=[];for(const value of input.colorPresets||[]){if(Object.keys(value).some(k=>!['id','name','settings','sourceLut','sourceFilterLut','sourceLutLicense','sourceFilterLutLicense'].includes(k)))throw Error('Invalid selected color preset.');const settings=structuredClone(value.settings);if(value.sourceLut)settings.lut=await ensureLut(value.sourceLut,value.sourceLutLicense);if(value.sourceFilterLut)settings.filterLut=await ensureLut(value.sourceFilterLut,value.sourceFilterLutLicense);if(!settings.lut)delete settings.lutIntensity;colorPresets.push({id:value.id,name:value.name,settings});}
  Object.assign(manifest.contributes,...(textStyles.length?[{textStyles}]:[]),...(colorPresets.length?[{colorPresets}]:[]),...((input.motionPresets||[]).length?[{motionPresets:input.motionPresets}]:[]),...(fonts.size?[{fonts:[...fonts.values()]}]:[]),...(luts.size?[{luts:[...luts.values()]}]:[]));
  files.set('plugin.json',Buffer.from(JSON.stringify(manifest,null,2)+'\n'));const bundle=await validateFiles(files,this.manager.appVersion);if(contentAssets(bundle.manifest).size!==files.size-1)throw Error('Draft asset accounting failed.');this.draft(id);return bundle;
 }
 async export(id,input){
  const draft=this.draft(id);if(draft.busy)throw Error('This draft is already exporting.');draft.busy=true;draft.receipt=null;
  try{const bundle=await this.prepare(id,input);const answer=await this.dialog.showSaveDialog(this.getWindow(),{title:'Export a new creative pack',defaultPath:`${bundle.manifest.id}-${bundle.manifest.version}.clipcraft-plugin.tgz`,filters:[{name:'ClipCraft plugin',extensions:['tgz']}]});this.draft(id);if(answer.canceled||!answer.filePath)return null;
   const result=await writePackage(bundle,answer.filePath,{signal:draft.controller.signal});if(this.current!==draft)return {...result,manifest:bundle.manifest,closed:true};const token=crypto.randomUUID();draft.receipt={token,path:result.path,key:bundle.key};return {...result,token,manifest:bundle.manifest};
  }catch(error){if(error.code==='EEXIST')throw Error('That archive already exists. Choose a new filename or change the pack version.');throw error;}finally{draft.busy=false;}
 }
 async install(id,token){const draft=this.draft(id);if(draft.busy)throw Error('This draft is already exporting.');if(!draft.receipt||token!==draft.receipt.token)throw Error('Unknown exported pack receipt.');const bundle=await validateFiles(await readArchive(draft.receipt.path),this.manager.appVersion);if(bundle.key!==draft.receipt.key)throw Error('The exported archive changed. Export a new archive before installing.');return this.manager.install(draft.receipt.path,false,{requiredKey:bundle.key});}
}
module.exports={PackBuilder};
