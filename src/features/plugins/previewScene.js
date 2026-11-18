// Original ClipCraft sample artwork. No remote assets or project media are loaded.
export function previewScene(width,height,second=false){
 const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
 const c=canvas.getContext('2d');c.scale(width/960,height/540);
 const sky=c.createLinearGradient(0,0,0,380);sky.addColorStop(0,second?'#a6c5d0':'#c7a49a');sky.addColorStop(1,second?'#e4e9db':'#f6ddba');c.fillStyle=sky;c.fillRect(0,0,960,540);
 const shape=(color,points)=>{c.fillStyle=color;c.beginPath();points.forEach(([x,y],i)=>i?c.lineTo(x,y):c.moveTo(x,y));c.closePath();c.fill();};
 c.fillStyle=second?'#f2f1dd':'#fff0cf';c.beginPath();c.arc(second?735:710,110,37,0,Math.PI*2);c.fill();
 if(second){
  shape('#78979c',[[0,300],[0,255],[90,183],[168,247],[285,112],[392,244],[510,165],[646,269],[790,182],[960,270],[960,330]]);
  shape('#dce4dd',[[226,179],[285,112],[341,179],[302,157],[280,174],[260,155]]);
  shape('#517680',[[0,330],[0,302],[127,235],[246,324],[407,229],[571,320],[744,252],[960,308],[960,380]]);
  const water=c.createLinearGradient(0,310,0,540);water.addColorStop(0,'#789b9b');water.addColorStop(1,'#315d67');c.fillStyle=water;c.fillRect(0,330,960,210);
  for(let i=0;i<44;i++){c.fillStyle=i%3?'rgba(222,229,207,.14)':'rgba(28,61,68,.2)';c.fillRect((i*137)%960,340+(i*29)%200,42+(i*13)%100,1);}
  shape('#294c4b',[[0,385],[120,355],[230,408],[342,540],[0,540]]);
  shape('#b78357',[[677,348],[786,348],[786,407],[677,407]]);shape('#303e3d',[[662,350],[732,305],[802,350]]);
  c.fillStyle='#efd4a2';c.fillRect(694,364,17,23);c.fillRect(751,364,17,23);
  for(let i=0;i<10;i++){const x=20+i*28,y=346+(i%3)*18;shape('#23413f',[[x,y-80],[x-24,y+17],[x+24,y+17]]);c.fillStyle='#263a37';c.fillRect(x-3,y+10,6,38);}
 }else{
  shape('#b68b7e',[[0,292],[0,261],[124,205],[231,248],[347,172],[461,249],[591,204],[725,278],[840,219],[960,254],[960,350]]);
  c.fillStyle='#d6ad83';c.beginPath();c.moveTo(0,343);c.bezierCurveTo(230,190,414,404,650,294);c.bezierCurveTo(790,238,874,283,960,319);c.lineTo(960,540);c.lineTo(0,540);c.fill();
  c.fillStyle='#b57d5d';c.beginPath();c.moveTo(0,416);c.bezierCurveTo(213,305,401,460,621,354);c.bezierCurveTo(770,287,890,369,960,351);c.lineTo(960,540);c.lineTo(0,540);c.fill();
  c.fillStyle='#e4bc8d';c.beginPath();c.moveTo(405,540);c.bezierCurveTo(530,435,681,435,654,351);c.bezierCurveTo(702,442,578,467,542,540);c.fill();
  shape('#3d5550',[[0,478],[148,421],[310,471],[402,540],[0,540]]);
  shape('#c38461',[[684,278],[776,278],[776,344],[684,344]]);shape('#805044',[[676,278],[730,244],[785,278]]);
  c.fillStyle='#3b4b46';c.fillRect(722,307,20,37);c.fillStyle='#e5c38b';c.fillRect(696,293,13,17);c.fillRect(751,293,13,17);
  for(let i=0;i<22;i++){const x=(i*73)%960,y=430+(i*31)%110;c.strokeStyle=i%2?'#48584a':'#6d6b51';c.lineWidth=3;c.beginPath();c.moveTo(x,y);c.lineTo(x-6,y-16);c.moveTo(x,y);c.lineTo(x+8,y-23);c.stroke();}
 }
 let seed=193;for(let i=0;i<1800;i++){seed=(seed*1664525+1013904223)>>>0;const x=seed%960;seed=(seed*1664525+1013904223)>>>0;c.fillStyle=i%2?'rgba(255,255,255,.035)':'rgba(0,0,0,.025)';c.fillRect(x,seed%540,1.5,1.5);}
 return canvas;
}
