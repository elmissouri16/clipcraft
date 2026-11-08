// A graphic CraftAI wrote for "create chart of us states populations animated" (50 states, 10 per
// page, 10 s per page, small text, long still holds). Kept to check that design_warnings catch it.
export const inputs = { data: { type: 'series', default: [] } };
export default function render({frame,fps,width,height,inputs,kit}) {
 const page=Math.min(4,Math.floor(frame/(fps*10)));
 const local=frame-page*fps*10;
 const rows=inputs.data.slice(page*10,page*10+10);
 const scale=Math.ceil(rows[0].value/500000)*500000;
 const left=130, right=950, plotW=820;
 const fmt=n=>(n/1000000).toFixed(2)+'M';
 const alpha=kit.progress(local,0,10,'out');
 const bars=rows.map((r,i)=>{
   const p=kit.progress(local,8+i*4,30,'out');
   const y=422+i*98;
   return kit.svg`<g opacity="${kit.progress(local,5+i*4,10,'out')}">
    <text x="82" y="${y}" fill="#7891a9" font-size="29" font-weight="600">${String(page*10+i+1).padStart(2,'0')}</text>
    <text x="${left}" y="${y}" fill="#f2f6fa" font-size="37" font-weight="600">${r.label}</text>
    <text x="${right}" y="${y}" text-anchor="end" fill="#64e3cb" font-size="37" font-weight="700">${fmt(r.value*p)}</text>
    <rect x="${left}" y="${y+17}" width="${plotW}" height="20" rx="7" fill="#182a3b"/>
    <rect x="${left}" y="${y+17}" width="${plotW*r.value/scale*p}" height="20" rx="7" fill="url(#bar)"/>
   </g>`;
 });
 const ticks=[0,.25,.5,.75,1].map(v=>kit.svg`<g>
  <line x1="${left+plotW*v}" y1="374" x2="${left+plotW*v}" y2="1353" stroke="#c4daeb" stroke-opacity=".07"/>
  <text x="${left+plotW*v}" y="1403" text-anchor="middle" fill="#8da5bb" font-size="28">${Number((scale*v/1000000).toFixed(2))}M</text>
 </g>`);
 const dots=[0,1,2,3,4].map(i=>kit.svg`<rect x="${82+i*178}" y="1510" width="158" height="5" rx="2.5" fill="${i===page?'#64e3cb':'#263a4d'}"/>`);
 return kit.svg`<svg viewBox="0 0 1080 1920">
  <defs>${kit.gradient('bg',['#10273c','#08131f'],{angle:110})}${kit.gradient('bar',['#3caeab','#79f0ca'],{angle:0})}</defs>
  <rect width="1080" height="1920" fill="url(#bg)"/>
  <circle cx="1050" cy="50" r="480" fill="#65e6d0" opacity=".025"/>
  <g font-family="Inter">
   <rect x="82" y="144" width="8" height="42" rx="4" fill="#64e3cb"/>
   <text x="112" y="176" fill="#64e3cb" font-size="31" font-weight="700" letter-spacing="4">2020 CENSUS</text>
   <text x="82" y="260" fill="#f2f6fa" font-size="73" font-weight="800" letter-spacing="-2">U.S. state populations</text>
   <g opacity="${alpha}">
    <text x="82" y="324" fill="#a6b9cb" font-size="33">Rank ${page*10+1}–${page*10+10} of 50</text>
    <text x="950" y="324" text-anchor="end" fill="#a6b9cb" font-size="29">People · millions</text>
    ${ticks}${bars}
    <text x="82" y="1461" fill="#8da5bb" font-size="28">Zero-based bars · scale changes by page</text>
   </g>
   ${dots}
   <text x="82" y="1579" fill="#c0cddd" font-size="29">Source: U.S. Census Bureau · Table 2</text>
   <text x="82" y="1624" fill="#8da5bb" font-size="28">Resident population · April 1, 2020</text>
   <text x="82" y="1669" fill="#8da5bb" font-size="28">50 states only · D.C. and territories excluded</text>
  </g>
 </svg>`;
}
