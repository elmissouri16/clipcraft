import assert from 'node:assert/strict';
import { createFontLoader, textFontRequests } from '../../../src/features/text/fontLoading.js';

const requests = textFontRequests([
  { text:'abc',font:'cairo',bold:false },{ text:'مرحبا',font:'cairo',bold:false },
  { text:'ß',uppercase:true },{ text:'hidden',font:'missing',disabled:true },{ text:'   ' },
]);
assert.equal(requests.length,2);
assert.match(requests[0].text,/ا/);
assert.match(requests[0].text,/b/);
assert.equal(requests[1].font,'montserrat');assert.equal(requests[1].bold,true);assert.equal(requests[1].text,'S');
assert.equal(textFontRequests([{font:'arialbd',text:'old'}])[0].font,'arial');

const calls=[],set=[{family:'"Cairo"'}];let reject=false,localLoads=0,customLoads=0;
set.check=()=>true; // Browser check() alone must not turn a missing family into an installed one.
set.load=async(font,text)=>{calls.push({font,text});if(reject)throw Error('missing subset');return [];};
const loader=createFontLoader({fontSet:set,localFace:()=>({load:async()=>{localLoads++;throw Error('not installed');}}),customFace:async()=>customLoads++});
const font={id:'cairo',family:'Cairo',source:'bundled',regular:400,bold:900};
assert.deepEqual(calls,[],'creating a loader does not load the font catalog');
const load=loader.load(font,{text:'مرحبا',bold:true});assert.equal(load,loader.load(font,{text:'مرحبا',bold:true}));assert.equal(await load,true);
assert.equal(calls.length,1);assert.match(calls[0].font,/900 32px "Cairo"/);assert.equal(calls[0].text,'مرحبا');
assert.equal(await loader.load(font,{text:'Ж'}),true);assert.equal(calls.length,2,'a new script must load its own Unicode subset');
reject=true;assert.equal(await loader.load(font,{text:'new'}),false);assert.equal(loader.status('cairo'),false);
reject=false;assert.equal(await loader.load(font,{text:'new'}),true,'failed loads remain retryable');
assert.equal(await loader.load({...font,id:'absent',family:'Absent'}),false,'missing CSS registration cannot silently succeed');
assert.equal(await loader.load({...font,id:'system',source:'system'}),false);assert.equal(localLoads,1);
assert.equal(await loader.load({...font,id:'custom',source:'custom'}),true);assert.equal(customLoads,1);
loader.invalidate('custom');assert.equal(loader.status('custom'),undefined);
console.log('Font loading passes: scoped faces, actual Unicode text, request sharing, retries, installed-font probes, custom loading and legacy styles');
