// Pack color settings are snapshots of existing ClipCraft controls, with local LUT references.
import {parseCube} from './cubeLut.mjs';
import {FILTER_LOOKS} from './filterCatalog.mjs';
const fail=message=>{throw Error('Invalid color pack: '+message);};
const record=v=>!!v&&typeof v==='object'&&!Array.isArray(v);
const keys=(v,names)=>{if(!record(v)||Object.keys(v).some(k=>!names.includes(k)))fail('unknown settings');};
const number=(v,lo,hi)=>Number.isFinite(v)&&v>=lo&&v<=hi;
export function validatePackCube(text){
 let size=0,dimensions=0,rows=0;const domains=new Map();
 for(const raw of text.split(/\r?\n/)){
  const line=raw.split('#')[0].trim();if(!line)continue;const p=line.split(/\s+/),key=p[0];
  if(key==='TITLE'){if(!/^TITLE\s+"[^"\u0000-\u001f]{0,160}"$/.test(line))fail('invalid cube title');continue;}
  if(['LUT_3D_SIZE','LUT_1D_SIZE'].includes(key)){if(size||p.length!==2||!Number.isInteger(Number(p[1])))fail('one cube dimension required');size=Number(p[1]);dimensions=key==='LUT_3D_SIZE'?3:1;if(size<2||size>(dimensions===3?65:65536))fail('unsupported cube grid size');continue;}
  if(['DOMAIN_MIN','DOMAIN_MAX'].includes(key)){if(domains.has(key)||p.length!==4||p.slice(1).some(n=>!number(Number(n),-1000000,1000000)))fail('invalid cube domain');domains.set(key,p.slice(1).map(Number));continue;}
  if(p.length!==3||!size||p.some(n=>!number(Number(n),-64,64)))fail('cube values must be three finite numbers');rows++;
 }
 const lo=domains.get('DOMAIN_MIN')||[0,0,0],hi=domains.get('DOMAIN_MAX')||[1,1,1];if(hi.some((n,i)=>n<=lo[i]))fail('cube domain maximum must exceed its minimum');
 if(!size||rows!==(dimensions===3?size**3:size))fail('cube data must exactly match its grid');
 const parsed=parseCube(text);if(!parsed.data.length)fail('empty cube');return true;
}
const gradeKeys=['temp','tint','saturation','exposure','contrast','highlight','shadow','whites','blacks','brilliance','sharpen','clarity','particles','fade','vignette'];
const colors=['red','orange','yellow','green','cyan','blue','purple','magenta'];
export function validateColorSettings(settings,{localLuts=[]}={}){
 keys(settings,['filter','filterIntensity','adjust','grade','lut','lutIntensity','filterLut']);if(!Object.keys(settings).length)fail('empty preset');
 if(settings.filter!==undefined&&!FILTER_LOOKS.some(v=>v.id===settings.filter))fail('unknown filter');
 for(const k of ['filterIntensity','lutIntensity'])if(settings[k]!==undefined&&!number(settings[k],0,100))fail('invalid intensity');
 if(settings.filterLut!==undefined&&(!localLuts.includes(settings.filterLut)||settings.filter&&settings.filter!=='none'))fail('filter LUT must reference this package and replaces its filter look');
 if(settings.lut!==undefined&&!localLuts.includes(settings.lut))fail('LUT must reference this package');
 if(settings.lutIntensity!==undefined&&!settings.lut)fail('LUT intensity needs a LUT');
 if(settings.adjust!==undefined){keys(settings.adjust,['brightness','contrast','saturation','hue','blur']);const ranges={brightness:[-1,1],contrast:[0,3],saturation:[0,3],hue:[-180,180],blur:[0,50]};for(const [k,v] of Object.entries(settings.adjust))if(!number(v,...ranges[k]))fail('invalid adjustment');}
 if(settings.grade!==undefined){keys(settings.grade,[...gradeKeys,'hsl','curves']);for(const [k,v] of Object.entries(settings.grade)){
  if(gradeKeys.includes(k)&&!number(v,['sharpen','clarity','particles','fade'].includes(k)?0:-100,100))fail('invalid grade');
  if(k==='hsl'){keys(v,colors);for(const c of Object.values(v)){keys(c,['h','s','l']);if(Object.values(c).some(x=>!number(x,-100,100)))fail('invalid HSL');}}
  if(k==='curves'){keys(v,['master','r','g','b']);for(const points of Object.values(v)){if(!Array.isArray(points)||points.length<2||points.length>32)fail('invalid curve count');let previous=-1;for(const point of points){if(!Array.isArray(point)||point.length!==2||point.some(x=>!number(x,0,1))||point[0]<=previous)fail('invalid curve points');previous=point[0];}}}
 }}
 return structuredClone(settings);
}
export function validateColorContributions(input,localLuts=[]){
 if(input===undefined)return [];if(!Array.isArray(input)||input.length>100)fail('at most 100 color presets');
 const ids=new Set();return input.map(v=>{keys(v,['id','name','settings']);if(typeof v.id!=='string'||!/^[a-z][a-z0-9-]{0,63}$/.test(v.id)||ids.has(v.id))fail('unique IDs required');ids.add(v.id);if(typeof v.name!=='string'||!v.name.trim()||v.name.length>160||/[\u0000-\u001f]/.test(v.name))fail('invalid name');return {id:v.id,name:v.name,settings:validateColorSettings(v.settings,{localLuts})};});
}
export function colorPresetPatch(definition){
 const settings=validateColorSettings(definition.settings,{localLuts:[definition.settings.lut,definition.settings.filterLut].filter(Boolean)});
 const grade={...(settings.grade||{})};
 if(settings.lut)grade.lut={ref:{pluginDigest:definition.digest,assetId:settings.lut},name:definition.lutName||settings.lut,intensity:settings.lutIntensity??100,dependency:{pluginId:definition.pluginId,digest:definition.digest,version:definition.version,id:settings.lut,name:definition.lutName||settings.lut}};
 return {filter:settings.filterLut?`pack-lut:${definition.digest}:${settings.filterLut}`:settings.filter||'none',...(settings.filterLut?{filterDependency:{pluginId:definition.pluginId,digest:definition.digest,version:definition.version,id:settings.filterLut,name:definition.filterLutName||settings.filterLut}}:{}),filterIntensity:settings.filterIntensity??100,adjust:{...(settings.adjust||{})},grade,packColor:{pluginId:definition.pluginId,digest:definition.digest,id:definition.id,name:definition.name,version:definition.version}};
}

export function packFilterLutRef(value){const match=typeof value==='string'&&value.match(/^pack-lut:([a-f0-9]{64}):([a-z][a-z0-9-]{0,63})$/);return match?{pluginDigest:match[1],assetId:match[2]}:null;}
