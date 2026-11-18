const assert=require('node:assert/strict');
(async()=>{
 const report=await require('../../../scripts/check-example-icons.cjs').checkExampleIcons();
 assert.ok(report.count>=23,'All source and sound/font recipe examples need identity artwork');
 assert.equal(new Set(report.entries.map(row=>row.id)).size,report.count);
 assert.equal(new Set(report.entries.map(row=>row.sha256)).size,report.count,'Each example needs its own artwork');
 console.log(`Example icon delivery verified: ${report.count} distinct ${report.size}×${report.size} PNGs`);
})().catch(error=>{console.error(error);process.exitCode=1;});
