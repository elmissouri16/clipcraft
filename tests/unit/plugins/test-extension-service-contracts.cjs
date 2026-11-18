const assert=require('node:assert/strict');
const {serviceContract,serviceValue,serviceMethod,matchServiceContract}=require('../../../shared/extensionServices.cjs');
const {ExtensionHostServices}=require('../../../electron/plugins/extensionHostServices.cjs');
(async()=>{
 const contract=serviceContract({version:1,methods:{echo:{input:{type:'object',properties:{text:{type:'string',maxLength:8}},required:['text']},output:{type:'integer',minimum:0}},chunks:{input:{type:'null'},output:{type:'bytes',maxLength:4},stream:true}}});
 serviceMethod(contract,'echo',{text:'hello'});assert.throws(()=>serviceMethod(contract,'echo',{text:'too long here'}));assert.throws(()=>serviceMethod(contract,'echo',{text:'hi',other:true}));assert.throws(()=>serviceMethod(contract,'chunks',null));assert.throws(()=>serviceMethod(contract,'constructor',null));assert.throws(()=>serviceValue(contract.methods.echo.output,-1));serviceValue(contract.methods.chunks.output,new Uint8Array(4));assert.throws(()=>serviceValue(contract.methods.chunks.output,new Uint8Array(5)));
 matchServiceContract(contract,JSON.parse(JSON.stringify(contract)));assert.throws(()=>matchServiceContract(contract,{...contract,version:2}));assert.throws(()=>matchServiceContract(undefined,contract));
 for(const invalid of [{version:0,methods:{}},{version:1,methods:{a:{input:{type:'string',pattern:'.*'},output:{type:'null'}}}},{version:1,methods:{a:{input:{type:'object',properties:{},required:['missing']},output:{type:'null'}}}}])assert.throws(()=>serviceContract(invalid));
 const job={key:'one',state:'running'},runtime={active:new Map([['one',job]]),services:new Map(),executionActive:()=>true,jobsHost:{authorize:()=>{}}},host=new ExtensionHostServices(runtime);let calls=0;
 host.register('clipcraft.contracted',{echo:()=>{calls++;return -1;},chunks:()=>null},{contract});
 await assert.rejects(host.call('clipcraft.contracted','echo',{text:7},{owner:job}),/contract/);assert.equal(calls,0);await assert.rejects(host.call('clipcraft.contracted','echo',{text:'valid'},{owner:job}),/contract/);assert.equal(calls,1);
 assert.throws(()=>host.register('clipcraft.missing',{echo:()=>1},{contract}),/Missing/);
 console.log('Service contracts reject incompatible schemas, calls, results and bounded chunks before delivery');
})().catch(error=>{console.error(error);process.exitCode=1;});
