// Original raw tar fixtures: preserve malformed paths instead of packer normalization.
const assert=require('node:assert/strict'),zlib=require('node:zlib');
function archive(entries){
 const chunks=[];
 for(const {name,bytes=Buffer.from('fixture'),type='0',link=''} of entries){
  assert.ok(Buffer.byteLength(name)<100);const header=Buffer.alloc(512);
  header.write(name);header.write('0000644\0',100);header.write('0000000\0',108);header.write('0000000\0',116);header.write(bytes.length.toString(8).padStart(11,'0')+'\0',124);header.write('00000000000\0',136);header.fill(32,148,156);header.write(type,156);header.write(link,157);header.write('ustar\0',257);header.write('00',263);
  const checksum=header.reduce((sum,n)=>sum+n,0);header.write(checksum.toString(8).padStart(6,'0')+'\0 ',148);chunks.push(header,bytes,Buffer.alloc((512-bytes.length%512)%512));
 }
 return zlib.gzipSync(Buffer.concat([...chunks,Buffer.alloc(1024)]));
}
module.exports={archive};
