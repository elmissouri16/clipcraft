const assert=require('node:assert/strict'),{processFile}=require('../../../electron/media/inspectArtifact.cjs');
(async()=>{
 assert.equal(await processFile(process.execPath,['-e','process.stdout.write("inspected")']),'inspected');
 await assert.rejects(processFile(process.execPath,['-e','process.stdout.write("x".repeat(1024*1024+1))']),/1 MiB/);
 await assert.rejects(processFile('/missing-clipcraft-inspector',[]),/ENOENT/);
 const controller=new AbortController(),work=processFile(process.execPath,['-e','setInterval(()=>{},1000)'],controller.signal);setTimeout(()=>controller.abort(),20);await assert.rejects(work,error=>error.name==='AbortError');
 await assert.rejects(processFile(process.execPath,['-e','throw Error("must not run")'],controller.signal),error=>error.name==='AbortError');
 console.log('Standalone artifact inspector enforces output bounds, spawn failure and cancellation without legacy exporters');
})().catch(error=>{console.error(error);process.exitCode=1;});
