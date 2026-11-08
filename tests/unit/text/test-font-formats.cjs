const assert=require('node:assert/strict'),postcss=require('postcss'),plugin=require('../../../build/font-formats.cjs');
(async()=>{
 const css=`@font-face{font-family:Example;src:url(a.woff2) format("woff2"),url(a.woff) format("woff");font-weight:700;unicode-range:U+0000-00FF}
 @font-face{font-family:Embedded;src:url(data:font/woff2;base64,AAAA) format(woff2),url(b.woff) format(woff)}
 @font-face{font-family:OldOnly;src:url(custom.woff) format("woff")}
 .background{background:url(keep.woff)}`;
 const out=(await postcss([plugin]).process(css,{from:undefined})).css;
 assert.ok(!out.includes('a.woff)')&&!out.includes('b.woff)'));
 for(const kept of ['a.woff2','data:font/woff2;base64,AAAA','custom.woff','keep.woff','font-weight:700','unicode-range:U+0000-00FF'])assert.ok(out.includes(kept),kept);
 console.log('WOFF2 equivalents replace legacy format copies; embedded fonts, WOFF-only fonts and style descriptors are preserved');
})().catch(e=>{console.error(e);process.exitCode=1;});
