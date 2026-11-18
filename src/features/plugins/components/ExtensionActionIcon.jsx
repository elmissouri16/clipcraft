import React from 'react';
import {SquareTerminal} from 'lucide-react';
export default function ExtensionActionIcon({entry,size=16}){
 const icon=entry.icon;
 return icon?<svg width={size} height={size} viewBox="0 0 24 24" fill={icon.fill} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" data-extension-action-icon>{icon.paths.map((path,index)=><path key={index} d={path}/>)}</svg>:<SquareTerminal size={size} aria-hidden="true"/>;
}
