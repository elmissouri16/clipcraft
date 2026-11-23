const {serviceContract}=require('./extensionServices.cjs');
const customHookName=value=>typeof value==='string'&&/^[a-z][a-z0-9-]{0,47}\.[a-z][a-z0-9-]{0,47}\.[a-z][\w.-]{0,63}$/.test(value);
function hookContract(value){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!['version','input','output'].includes(key)))throw Error('Invalid hook contract');
 const checked=serviceContract({version:value.version,methods:{hook:{input:value.input,output:value.output}}});
 return {version:checked.version,input:checked.methods.hook.input,output:checked.methods.hook.output};
}
function hookOptions(value={},custom=false){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!['timeoutMs','order',...(custom?['contract']:[])].includes(key)))throw Error('Invalid hook options');
 const timeoutMs=value.timeoutMs??30000,order=value.order??100;
 if(!Number.isInteger(timeoutMs)||timeoutMs<1000||timeoutMs>300000)throw Error('Hook timeout must be between one second and five minutes');
 if(!Number.isInteger(order)||Math.abs(order)>10000)throw Error('Hook order must be an integer between -10000 and 10000');
 return {timeoutMs,order,...(custom?{contract:hookContract(value.contract)}:{})};
}
const orderedHooks=(runtime,name)=>[...(runtime.hooks.get(name)?.values()??[])].sort((a,b)=>(a.hookOrders?.get(name)??100)-(b.hookOrders?.get(name)??100)||a.manifest.id.localeCompare(b.manifest.id));
module.exports={customHookName,hookContract,hookOptions,orderedHooks};
