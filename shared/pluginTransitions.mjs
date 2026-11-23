import {validateEffectDefinition,validateEffectExpression,effectExpression} from './pluginEffects.mjs';
export const isPluginTransition=id=>typeof id==='string'&&id.startsWith('plugin-transition:');
export const transitionId=d=>`plugin-transition:${d.contributionId}@${d.digest}`;
export const CROSSFADE_EXPRESSION='A(X,Y)*(1-P)+B(X,Y)*P';
export function validateTransitionDefinition(value) {
  const definition=validateEffectDefinition(value,'transition');
  const duration=value.duration??0.5;
  if(!Number.isFinite(duration)||duration<0.05||duration>5)throw Error('Plugin transition duration must be 0.05–5 seconds.');
  return {...definition,duration};
}
export const validateTransitionExpression=source=>validateEffectExpression(source,'transition');
export function transitionExpression(definition,params) {
  const expression=effectExpression(definition,params,'transition');
  if(typeof expression!=='string')return expression;
  // Guard endpoints even for an author expression that offsets or tints its inputs.
  return `if(lte(P,0),A(X,Y),if(gte(P,1),B(X,Y),(${expression})))`;
}
