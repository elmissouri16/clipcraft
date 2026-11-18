const assert=require('node:assert/strict');
const {parseMyinstants,search}=require('../../../electron/library/library.cjs');
// Original minimal records; no third-party page scripts or assets are copied.
const item=(id,name)=>`<button onclick="play('/media/sounds/fixture-${id}.mp3', 'loader-${id}', 'fixture-${id}')"></button><a class="instant-link">${name}</a>`;
const infinite=content=>`<div id="instants_container">${content}</div><div id="loading"></div>`;
(async()=>{
 const first=item(11,'Original first'),second=item(22,'Original second');
 assert.equal(parseMyinstants(first).hasNext,false);
 assert.equal(parseMyinstants(first+'<a rel="next" href="?page=2">More</a>').hasNext,true);
 assert.equal(parseMyinstants(first+"<LINK href='?page=2' REL = 'alternate NEXT'>").hasNext,true);
 assert.equal(parseMyinstants(first+'<a rel="next-item">Wrong token</a>').hasNext,false);
 assert.equal(parseMyinstants(infinite(first)).hasNext,true);
 assert.equal(parseMyinstants(infinite('')).hasNext,false);
 assert.equal(parseMyinstants(first+'<div id="loading"></div>').hasNext,false);
 assert.equal(parseMyinstants(first+'<div id="instants_container"></div>').hasNext,false);
 assert.equal(parseMyinstants(infinite(first+first)).results.length,1);
 const requests=[],fetcher=async url=>{const query=new URL(url);requests.push(query);const page=Number(query.searchParams.get('page'));return page===3?{ok:false,status:404}:{ok:true,status:200,text:async()=>infinite(page===2?second:first)};};
 const a=await search(fetcher,{kind:'trolls',q:'original query',page:1}),b=await search(fetcher,{kind:'trolls',q:'original query',page:2}),end=await search(fetcher,{kind:'trolls',q:'original query',page:3});
 assert.equal(a.pages,2);assert.equal(b.pages,3);assert.notEqual(a.results[0].id,b.results[0].id);assert.equal(end.pages,3);assert.deepEqual(end.results,[]);
 assert.ok([...a.results,...b.results].every(row=>row.license==='unknown'));
 assert.deepEqual(requests.map(url=>[url.pathname,url.searchParams.get('name'),url.searchParams.get('page')]),[1,2,3].map(n=>['/en/search/','original query',String(n)]));
 const last=await search(fetcher,{kind:'trolls',q:'original query',page:50});assert.equal(last.page,50);assert.equal(last.pages,50);
 console.log('LIBRARY PAGINATION OK: classic/infinite markup, empty/404 terminal pages, distinct results, retained query/unknown license, page bound');
})().catch(error=>{console.error(error);process.exitCode=1;});
