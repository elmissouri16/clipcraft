// Local private decoder fixtures. No third-party font binaries are committed or published.
const fs=require('node:fs'),path=require('node:path');
function packTestFont(ext){
 const explicit=process.env['CLIPCRAFT_TEST_'+ext.toUpperCase()];
 const candidates=explicit?[explicit]:ext==='ttf'?[
  '/System/Library/Fonts/Supplemental/Arial.ttf',path.join(process.env.WINDIR||'C:\\Windows','Fonts','arial.ttf'),'/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
 ]:[
  '/System/Library/Fonts/Supplemental/STIXGeneral.otf','/usr/share/fonts/opentype/freefont/FreeSans.otf','/usr/share/fonts/opentype/urw-base35/NimbusSans-Regular.otf',
 ];
 const file=candidates.find(f=>fs.existsSync(f));if(!file)throw Error('Provide an existing private '+ext.toUpperCase()+' fixture through CLIPCRAFT_TEST_'+ext.toUpperCase()+'.');return file;
}
module.exports={packTestFont};
