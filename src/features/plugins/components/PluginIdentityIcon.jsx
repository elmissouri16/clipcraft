import React,{useEffect,useState} from 'react';
const images=new Map();
function image(key){
 if(!images.has(key)){
  if(images.size>=32)images.delete(images.keys().next().value);
  images.set(key,Promise.resolve(window.api.pluginsIcon?.(key)).catch(()=>null));
 }
 return images.get(key);
}
export default function PluginIdentityIcon({row,artwork=row,large=false}){
 const [source,setSource]=useState(null),[failed,setFailed]=useState(false),id=row.manifest?.id||row.key;
 useEffect(()=>{let live=true;setSource(null);setFailed(false);if(artwork.manifest?.icon)image(artwork.key).then(value=>{if(live)setSource(value);});return()=>{live=false;};},[artwork.key,artwork.manifest?.icon]);
 const name=row.manifest?.name||id,words=name.replace(/([a-z])([A-Z])/g,'$1 $2').trim().split(/[\s-]+/u),initials=(words.length>1?[...words[0]][0]+[...words.at(-1)][0]:[...name].slice(0,2).join('')).toLocaleUpperCase();
 const tone=[...id].reduce((sum,char)=>sum+char.charCodeAt(0),0)%5;
 return <span className={`plugin-identity-icon${large?' large':''}`} data-plugin-icon={source&&!failed?'image':'monogram'} data-tone={tone} aria-hidden="true">
  {source&&!failed?<img src={source} alt="" draggable={false} onError={()=>setFailed(true)}/>:initials}
 </span>;
}
