// Native extension view destinations and bounded author-supplied geometry.
const PLACEMENTS=Object.freeze(['workbench','left-rail','library','bottom','player-overlay','timeline-overlay','floating','modal']);
function viewPlacement(input={}){
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>!['placement','bounds','width','height'].includes(key))||!PLACEMENTS.includes(input.placement??'workbench'))throw Error('Invalid view placement');
 const result={placement:input.placement??'workbench'};
 for(const key of ['width','height'])if(input[key]!==undefined){if(!['floating','modal'].includes(result.placement))throw Error('Pixel dimensions only apply to native windows');if(!Number.isInteger(input[key])||input[key]<160||input[key]>4096)throw Error('View window dimensions must be 160 to 4096 pixels');result[key]=input[key];}
 if(input.bounds!==undefined){const rect=input.bounds;if(!rect||Array.isArray(rect)||Object.keys(rect).length!==4||!['x','y','width','height'].every(key=>Object.hasOwn(rect,key)&&Number.isFinite(rect[key])&&rect[key]>=0&&rect[key]<=1)||rect.width<=0||rect.height<=0||rect.x+rect.width>1||rect.y+rect.height>1)throw Error('Overlay bounds must fit inside the normalized host surface');if(!result.placement.endsWith('-overlay'))throw Error('Normalized bounds only apply to overlays');result.bounds={...rect};}
 return result;
}
module.exports={PLACEMENTS,viewPlacement};
