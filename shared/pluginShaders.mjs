// Authored GLSL ES 3 fragment functions. Project files hold immutable package
// references and parameters; only verified installed definitions supply code.
export function validateShaderFragment(fragment,mode='effect',parameterIds=[]){
 if(typeof fragment!=='string'||!fragment.trim()||fragment.length>65536||fragment.includes('\0')||/^\s*#\s*version\b/m.test(fragment))throw Error('Shader fragment must contain 1 to 65536 characters without a version directive');
 const name=mode==='transition'?'transition':'effect';
 const signature=mode==='transition'?/\bvec4\s+transition\s*\(\s*vec2\s+\w+\s*,\s*float\s+\w+\s*\)/:/\bvec4\s+effect\s*\(\s*vec2\s+\w+\s*\)/;
 if(!signature.test(fragment))throw Error('Shader fragment must define '+(name==='effect'?'vec4 effect(vec2 uv)':'vec4 transition(vec2 uv, float progress)'));
 fragment.replace(/\{\{([a-z][a-z0-9-]*)\}\}/g,(_,id)=>{if(!parameterIds.includes(id))throw Error('Unknown shader parameter '+id);return '0.0';});
 return fragment;
}
export function shaderPass(definition,values,mode='effect'){
 const ids=definition.parameters.map(p=>p.id);
 return {kind:'glsl',mode,fragment:validateShaderFragment(definition.fragment,mode,ids),parameterIds:ids,values:ids.map(id=>values[id])};
}
const scalar=(index)=>`uParams[${Math.floor(index/4)}][${index%4}]`;
export function glslTemplate(pass,mode){
 if(pass?.kind!=='glsl'||pass.mode!==mode||!Array.isArray(pass.parameterIds)||pass.parameterIds.length>8||new Set(pass.parameterIds).size!==pass.parameterIds.length||pass.parameterIds.some(id=>typeof id!=='string'||!/^[a-z][a-z0-9-]{0,63}$/.test(id))||!Array.isArray(pass.values)||pass.values.length!==pass.parameterIds.length||pass.values.some(value=>!Number.isFinite(value)||Math.abs(value)>1e6))throw Error('Invalid GLSL shader pass');
 const fragment=validateShaderFragment(pass.fragment,mode,pass.parameterIds).replace(/\{\{([a-z][a-z0-9-]*)\}\}/g,(_,id)=>scalar(pass.parameterIds.indexOf(id)));
 const offset=pass.values.length,region=pass.region??{},strength=pass.strength??1;
 if(!Number.isFinite(strength)||strength<0||strength>1||pass.region&&(!['x','y','w','h','feather'].every(key=>Number.isFinite(region[key]??0))||!['rect','ellipse',undefined].includes(region.shape)))throw Error('Invalid shader strength or region');
 const values=[...pass.values,strength,region.x??0,region.y??0,region.w??1,region.h??1,region.feather??0,region.shape==='ellipse'?1:0,region.invert?1:0,pass.region?1:0],params=new Float32Array(Math.ceil(values.length/4)*4);params.set(values);
 const u=index=>scalar(offset+index),source=`#version 300 es
precision highp float;
precision highp sampler2D;
uniform sampler2D uA;
uniform sampler2D uB;
uniform float W;
uniform float H;
uniform float T;
uniform float P;
uniform bool uFlipY;
uniform vec4 uParams[${params.length/4}];
out vec4 outColor;
vec4 ccSampleA(vec2 uv){vec2 point=clamp(uv,vec2(0.0),vec2(1.0));if(uFlipY)point.y=1.0-point.y;return texture(uA,point);}
vec4 ccSampleB(vec2 uv){vec2 point=clamp(uv,vec2(0.0),vec2(1.0));if(uFlipY)point.y=1.0-point.y;return texture(uB,point);}
vec4 ccSample(vec2 uv){return ccSampleA(uv);}
#line 1
${fragment}
#line 100001
void main(){
 vec2 pixel=vec2(floor(gl_FragCoord.x),H-1.0-floor(gl_FragCoord.y));
 vec2 uv=(pixel+0.5)/vec2(W,H);
 ${mode==='transition'?`outColor=P<=0.0?ccSampleA(uv):P>=1.0?ccSampleB(uv):clamp(transition(uv,P),0.0,1.0);`:`
 float mask=1.0;
 if(${u(8)}>0.5){
  vec2 lo=vec2(W,H)*vec2(${u(1)},${u(2)}),size=vec2(W,H)*vec2(${u(3)},${u(4)});
  float distance;
  if(${u(6)}>0.5){vec2 halfSize=max(size*0.5,vec2(1.0));distance=(length((pixel-lo-size*0.5)/halfSize)-1.0)*min(halfSize.x,halfSize.y);}
  else {vec2 outside=max(lo-pixel,pixel-lo-size);distance=max(outside.x,outside.y);}
  mask=clamp(0.5-distance/max(${u(5)}*H,1.0),0.0,1.0);
  if(${u(7)}>0.5)mask=1.0-mask;
 }
 outColor=mix(ccSampleA(uv),clamp(effect(uv),0.0,1.0),mask*${u(0)});`}
}`;
 return {key:'glsl|'+mode+'|'+source,source,params};
}
