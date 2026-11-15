// Declarative effect contract. Parameter placeholders become finite numeric literals, never code.
import {parse} from './effectExpression.mjs';
const own=(v,k)=>Object.hasOwn(v,k);
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const fields=(v,allowed)=>{if(!object(v)||Object.keys(v).some(k=>!allowed.includes(k)))throw Error('Invalid plugin effect fields.');};
const text=v=>typeof v==='string'&&v.trim()&&v.length<=160&&!/[\u0000-\u001f]/.test(v);
const local=v=>typeof v==='string'&&/^[a-z][a-z0-9-]{0,63}$/.test(v);
export const isPluginEffect=id=>typeof id==='string'&&id.startsWith('plugin:');
export const effectId=d=>`plugin:${d.contributionId}@${d.digest}`;
export function validateEffectExpression(source, mode='effect') {
  if(typeof source!=='string'||source.length>4096)throw Error('Plugin expression exceeds 4096 characters.');
  // A token bound also protects the recursive parser before AST inspection.
  if((source.match(/[A-Za-z_][A-Za-z_0-9]*|\d+(?:\.\d*)?(?:e[+-]?\d+)?|[^\s]/gi)||[]).length>1024)throw Error('Plugin expression exceeds token budget.');
  let nesting=0;for(const character of source){if(character==='('&&++nesting>32)throw Error('Plugin expression exceeds nesting budget.');if(character===')')nesting--;}
  const ast=parse(source);let nodes=0,samples=0;
  const visit=(node,depth=0)=>{
    if(++nodes>512||depth>32)throw Error('Plugin expression exceeds AST budget.');
    if(node.k==='num'&&(!Number.isFinite(node.v)||Math.abs(node.v)>1e9))throw Error('Plugin expression has an invalid number.');
    if(node.k==='var'&&node.v==='P'&&mode==='effect')throw Error('Transition progress is not available to effects.');
    if(node.k==='var'&&node.v==='T'&&mode==='transition')throw Error('Use normalized progress P in transitions.');
    if(node.k==='call'){
      if(mode==='effect'&&['A','B'].includes(node.f))throw Error('Transition inputs are not available to effects.');
      if(mode==='transition'&&['S','L','PR','PG','PB'].includes(node.f))throw Error('Use A/B input sampling in transitions.');
      if(['S','L','PR','PG','PB','A','B'].includes(node.f)&&++samples>16)throw Error('Plugin expression exceeds 16 texture samples.');
      if(['st','ld'].includes(node.f)&&!(node.args[0].k==='num'&&Number.isInteger(node.args[0].v)&&node.args[0].v>=0&&node.args[0].v<=8))throw Error('Plugin registers must be literal indices 0–8.');
      node.args.forEach(n=>visit(n,depth+1));
    }
    if(node.a)visit(node.a,depth+1);if(node.b)visit(node.b,depth+1);
  };visit(ast);return ast;
}
export function validateEffectDefinition(value, mode='effect') {
  fields(value,mode==='transition'?['id','name','expression','parameters','duration']:['id','name','expression','parameters']);
  if(!local(value.id)||!text(value.name))throw Error('Invalid plugin effect ID or name.');
  const parameters=value.parameters??[];
  if(!Array.isArray(parameters)||parameters.length>8)throw Error('Effects support up to eight numeric parameters.');
  const ids=new Set();
  const validated=parameters.map(p=>{
    fields(p,['id','name','min','max','step','default']);
    if(!local(p.id)||!text(p.name)||ids.has(p.id))throw Error('Invalid or duplicate effect parameter.');ids.add(p.id);
    if(!['min','max','step','default'].every(k=>Number.isFinite(p[k])&&Math.abs(p[k])<=1e6)||p.min>=p.max||p.step<=0||p.step>p.max-p.min||p.default<p.min||p.default>p.max)throw Error('Invalid effect parameter limits.');
    return {...p};
  });
  if(typeof value.expression!=='string'||value.expression.length>4096)throw Error('Invalid effect expression.');
  const template=value.expression.replace(/\{\{([a-z][a-z0-9-]*)\}\}/g,(_,id)=>{
    if(!ids.has(id))throw Error(`Unknown effect parameter ${id}.`);
    // Sentinel prevents parameterized register indices from passing validation.
    return '(123456789)';
  });
  validateEffectExpression(template,mode);
  return {id:value.id,name:value.name,expression:value.expression,parameters:validated};
}
export function effectParameters(definition,params={}) {
  if(!object(params)||Object.keys(params).some(k=>!definition.parameters.some(p=>p.id===k)))throw Error('Unknown effect parameter values.');
  const out={};
  for(const p of definition.parameters){const value=own(params,p.id)?params[p.id]:p.default;if(!Number.isFinite(value)||value<p.min||value>p.max)throw Error(`Invalid parameter ${p.name}.`);out[p.id]=value;}
  return out;
}
export function effectExpression(definition,params={}) {
  const values=effectParameters(definition,params);
  return definition.expression.replace(/\{\{([a-z][a-z0-9-]*)\}\}/g,(_,id)=>`(${values[id]})`);
}
