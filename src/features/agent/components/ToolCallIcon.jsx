import React from 'react';

// Original ClipCraft glyphs. Every mark uses the same 32-unit grid, rounded
// media surfaces and two weights of detail: context below, action above.
// Keep small marks deliberate; these are read at 26px in the activity list.
const Surface = ({ x=4, y=6, width=24, height=20, rx=3 }) =>
  <rect x={x} y={y} width={width} height={height} rx={rx} fill="currentColor" fillOpacity=".08" />;
const Wave = () => <path d="M6 14v4 M10 11v10 M14 8v16 M18 12v8 M22 10v12 M26 14v4" />;
const Picture = () => <><Surface /><path d="m5 23 7-8 5 5 4-4 6 7" /><circle cx="21.5" cy="11.5" r="1.5" fill="currentColor" stroke="none" /></>;
const Lens = () => <><circle cx="21.5" cy="20.5" r="5" fill="var(--tool-ground, #20202f)" /><path d="m25.2 24.2 3 3" /></>;
const Plus = () => <path d="M24 4v8 M20 8h8" />;
const Glint = () => <path d="m24 3 1.5 4.5L30 9l-4.5 1.5L24 15l-1.5-4.5L18 9l4.5-1.5Z" fill="currentColor" fillOpacity=".18" />;
const ART = {
  pluginFind: [<><Surface x={3} y={4} width={19} height={24} /><path d="M7 10h10 M7 16h7 M7 22h5" /></>, <><circle cx="23" cy="21" r="6" fill="var(--tool-ground)" /><path d="m27 25 3 4 M20 21h6" /></>],
  pluginRun: [<><path d="M5 12h6V7h10v5h6v16H5Z" fill="currentColor" fillOpacity=".1" /><path d="M14 3v4 M18 3v4" /></>, <path d="m13 15 7 4-7 4Z" fill="currentColor" fillOpacity=".25" />],
  project: [<><Surface x={6} y={3} width={20} height={26} /><path d="M10 8h12 M10 24h7" /></>, <><rect x="10" y="12" width="12" height="8" rx="1.5" fill="currentColor" fillOpacity=".14" /><path d="m15 14 4 2-4 2" /></>],
  options: [<path d="M5 8h22 M5 16h22 M5 24h22" />, <><rect x="10" y="5" width="4" height="6" rx="2" fill="var(--tool-ground)" /><rect x="20" y="13" width="4" height="6" rx="2" fill="var(--tool-ground)" /><rect x="8" y="21" width="4" height="6" rx="2" fill="var(--tool-ground)" /></>],
  scenes: [<><Surface y={9} height={15} /><path d="M11 10v13 M21 10v13" /></>, <><path d="M16 4v24" strokeDasharray="2 3" /><path d="m12.5 4 3.5 3 3.5-3" /></>],
  storyboard: [<><Surface x={4} y={5} width={10} height={9} rx={2} /><Surface x={18} y={5} width={10} height={9} rx={2} /><Surface x={4} y={18} width={10} height={9} rx={2} /></>, <><rect x="18" y="18" width="10" height="9" rx="2" fill="currentColor" fillOpacity=".14" /><path d="m21.5 20.5 4 2-4 2" /></>],
  annotation: [<><Surface /><path d="M8 11h8 M8 16h5" /></>, <><path d="m17 22 8-8 3 3-8 8-4 1Z" fill="var(--tool-ground)" /><path d="m23 16 3 3" /></>],
  silence: [<Wave />, <><rect x="12" y="6" width="8" height="20" rx="2" fill="var(--tool-ground)" stroke="none" /><path d="M14 16h4 M16 4v24" strokeDasharray="2 3" /><path d="m4 6 3 3 M25 23l3 3" /></>],
  cut: [<><Surface x={3} y={21} width={26} height={7} rx={2} /><path d="M16 21v7" strokeDasharray="2 3" /></>, <><circle cx="8" cy="7" r="3" /><circle cx="8" cy="16" r="3" /><path d="m10.5 8.5 14 11 M10.5 14.5 24 3" /><circle cx="15" cy="12" r=".8" fill="currentColor" stroke="none" /></>],
  keep: [<><Surface y={10} height={14} /><path d="M10 10v14 M22 10v14" /></>, <><rect x="10" y="9" width="12" height="16" rx="2" fill="currentColor" fillOpacity=".15" /><path d="m13 17 2.5 2.5 4-5" /></>],
  transcript: [<><path d="M5 9v8 M9 5v16 M13 11v4" /><Surface x={17} y={8} width={12} height={19} rx={2} /></>, <path d="M20 13h6 M20 18h6 M20 23h4 M4 26h8l3-3" />],
  captions: [<><Surface /><path d="m14 11 5 3-5 3" /></>, <><rect x="7" y="19" width="18" height="5" rx="1.5" fill="currentColor" fillOpacity=".18" /><path d="M10 21.5h4 M17 21.5h5" /></>],
  text: [<Surface />, <><path d="M10 11v-1h12v1 M16 10v13 M12 23h8" /></>],
  editText: [<><Surface /><path d="M9 11h10 M14 11v11 M11 22h4" /></>, <><path d="m20 22 5-5 3 3-5 5-4 1Z" fill="var(--tool-ground)" /><path d="m24 18 3 3" /></>],
  remove: [<><Surface y={10} height={14} /><path d="M8 14h5" /></>, <><path d="M12 9V6h8v3 M9 9h14 M11 12l1 14h10l1-14" fill="var(--tool-ground)" /><path d="M15 15v7 M19 15v7" /></>],
  split: [<><Surface x={3} y={10} width={11} height={14} rx={2} /><Surface x={18} y={10} width={11} height={14} rx={2} /></>, <><path d="M16 6v22" strokeDasharray="2 3" /><path d="m12 4 4 4 4-4" /><path d="M6 17h4 M22 17h4" /></>],
  speed: [<><path d="M5 24a12 12 0 1 1 22 0 M7 12l2 1 M16 5v3 M25 12l-2 1" /><path d="M10 27h12" /></>, <><path d="m16 19 6-8" /><circle cx="16" cy="19" r="2.5" fill="currentColor" fillOpacity=".18" /></>],
  volume: [<path d="M5 13h5l6-5v16l-6-5H5Z" fill="currentColor" fillOpacity=".1" />, <><path d="M24 6v20 M21 6h6 M21 26h6" /><rect x="21" y="13" width="6" height="5" rx="1.5" fill="var(--tool-ground)" /></>],
  effects: [<><Surface /><path d="M8 12h8 M8 17h11 M8 22h6" /></>, <><path d="m24 3 1.5 5 4.5 1.5-4.5 1.5L24 16l-1.5-5L18 9.5 22.5 8Z" fill="currentColor" fillOpacity=".18" /></>],
  transition: [<><Surface x={3} y={9} width={16} height={17} rx={2} /><Surface x={13} y={6} width={16} height={17} rx={2} /></>, <><path d="M13 10h6v12h-6Z" fill="currentColor" fillOpacity=".2" /><path d="m8 24 16-16" /></>],
  ratio: [<><Surface y={9} height={14} /><path d="M11 5h10 M11 27h10" /></>, <><rect x="11" y="5" width="10" height="22" rx="2" fill="currentColor" fillOpacity=".1" /><path d="m14 9 2-2 2 2 M14 23l2 2 2-2" /></>],
  zoom: [<><Surface /><path d="m6 23 6-7 5 5" /></>, <><path d="M19 4h9v9 M28 4 17 15" /><path d="M13 12v7h7" /></>],
  transform: [<><rect x="9" y="9" width="14" height="14" rx="1" fill="currentColor" fillOpacity=".1" /></>, <><path d="M4 11V4h7 M21 4h7v7 M28 21v7h-7 M11 28H4v-7" /><path d="M7 7h.01 M25 7h.01 M25 25h.01 M7 25h.01" strokeWidth="3" /></>],
  keys: [<><path d="M4 24h24 M5 22V10 M27 22V10" /></>, <><path d="m5 17 11-7 11 7" /><path d="m5 14 3 3-3 3-3-3Z M16 7l3 3-3 3-3-3Z M27 14l3 3-3 3-3-3Z" fill="var(--tool-ground)" /></>],
  animation: [<><rect x="4" y="14" width="11" height="12" rx="2" opacity=".5" /><rect x="10" y="10" width="12" height="13" rx="2" fill="var(--tool-ground)" /></>, <><rect x="17" y="5" width="11" height="14" rx="2" fill="currentColor" fillOpacity=".12" /><path d="M4 7h7 M4 10h4 M21 26h7" /></>],
  media: [<><path d="M4 11V8a2 2 0 0 1 2-2h7l3 4h10a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z" fill="currentColor" fillOpacity=".08" /></>, <><path d="M16 14v9 M11.5 18.5h9" /></>],
  search: [<><Surface /><path d="M8 11h11 M8 16h7 M8 21h4" /></>, <Lens />],
  soundSearch: [<Wave />, <Lens />],
  stockSearch: [<><Surface /><path d="M10 6v20 M22 6v7 M4 11h6 M4 21h6 M22 11h6" /></>, <Lens />],
  music: [<><Surface x={4} y={9} width={24} height={17} /><path d="M8 14v7 M11 16v3" /></>, <><path d="M17 21V8l10-2v13 M17 12l10-2" /><ellipse cx="14.5" cy="22" rx="2.5" ry="2" fill="currentColor" fillOpacity=".22" /><ellipse cx="24.5" cy="20" rx="2.5" ry="2" fill="currentColor" fillOpacity=".22" /></>],
  voices: [<><Surface x={3} y={7} width={10} height={18} rx={2} /><Surface x={19} y={7} width={10} height={18} rx={2} /><circle cx="8" cy="12" r="2" /><circle cx="24" cy="12" r="2" /><path d="M6 19h4 M22 19h4" /></>, <><rect x="11" y="4" width="10" height="24" rx="3" fill="var(--tool-ground)" /><path d="M14 13v6 M18 10v12" /></>],
  narration: [<><Surface x={3} y={15} width={7} height={11} /><Surface x={12} y={15} width={7} height={11} /><Surface x={21} y={15} width={8} height={11} /><path d="M6 19v3 M15 18v5 M25 19v3" /></>, <><rect x="13" y="2" width="6" height="9" rx="3" fill="var(--tool-ground)" /><path d="M10 9a6 6 0 0 0 12 0 M16 15v-1" /></>],
  voiceover: [<><Surface x={3} y={13} width={26} height={14} /><path d="M7 18v4 M11 16v8 M23 18v4" /></>, <><rect x="13" y="3" width="8" height="14" rx="4" fill="var(--tool-ground)" /><path d="M10 13a7 7 0 0 0 14 0 M17 20v5 M14 25h6" /></>],
  stock: [<><Surface /><path d="M10 6v20 M22 6v20 M4 11h6 M4 21h6 M22 11h6 M22 21h6" /></>, <path d="m14 12 5 4-5 4Z" fill="currentColor" fillOpacity=".2" />],
  image: [<Picture />, <Glint />],
  sceneAdd: [<Picture />, <Plus />],
  images: [<><Surface x={8} y={3} width={21} height={19} /><Surface x={3} y={10} width={21} height={19} /><path d="m5 26 6-7 5 5 3-3 4 5" /></>, <Glint />],
  inspect: [<><path d="M4 10V5h6 M22 5h6v5 M28 22v5h-6 M10 27H4v-5" /></>, <><path d="M6 16s4-6 10-6 10 6 10 6-4 6-10 6S6 16 6 16Z" fill="currentColor" fillOpacity=".08" /><circle cx="16" cy="16" r="3" /></>],
  move: [<><Surface x={9} y={10} width={14} height={13} rx={2} /><path d="M4 27h24" /></>, <><path d="M2 6h28 M6 2 2 6l4 4 M26 2l4 4-4 4" /><path d="M13 16h6" /></>],
  trim: [<><Surface x={3} y={10} width={26} height={14} rx={2} /><path d="M13 17h6" /></>, <><path d="M9 6v22 M23 6v22 M6 6h3 M6 28h3 M23 6h3 M23 28h3" /><path d="M4 16h2 M26 16h2" opacity=".5" /></>],
  clip: [<><Surface y={10} height={14} /><path d="M8 14h6" /></>, <><path d="M9 5h14 M12 3v4 M20 3v4 M11 18l3 3 7-7" /></>],
  color: [<Surface />, <><path d="M16 16V8a8 8 0 0 1 7 12Z" fill="#c2a6ed" stroke="none" /><path d="m16 16 7 4a8 8 0 0 1-14 0Z" fill="#8ec5cf" stroke="none" /><path d="m16 16-7 4a8 8 0 0 1 7-12Z" fill="#dfb292" stroke="none" /><circle cx="16" cy="16" r="8" /></>],
  composite: [<><Surface x={3} y={4} width={18} height={18} /><path d="m5 19 5-6 5 5" /></>, <><rect x="11" y="12" width="18" height="16" rx="3" fill="currentColor" fillOpacity=".12" /><path d="m16 19 4 5 4-5" /></>],
  settings: [<><Surface x={6} y={3} width={20} height={26} /><path d="M10 8h12" /></>, <><path d="M10 15h12 M10 23h12" /><circle cx="14" cy="15" r="2" fill="var(--tool-ground)" /><circle cx="19" cy="23" r="2" fill="var(--tool-ground)" /></>],
  guide: [<><path d="M16 8c-3-3-7-4-12-3v21c5-1 9 0 12 3 3-3 7-4 12-3V5c-5-1-9 0-12 3Z" fill="currentColor" fillOpacity=".08" /><path d="M16 8v21" /></>, <><path d="M8 11h4 M8 16h4 M20 12h4 M20 17h4" /></>],
  undo: [<><Surface x={11} y={11} width={17} height={15} rx={2} /></>, <><path d="M12 5 5 12l7 7 M5 12h14a6 6 0 0 1 0 12" /></>],
  export: [<><Surface x={3} y={7} width={19} height={20} /><path d="m9 13 6 4-6 4Z" fill="currentColor" fillOpacity=".1" /></>, <><path d="M17 5h11v11 M28 5 16 17" /><path d="M26 22v4a3 3 0 0 1-3 3" /></>],
  tools: [<><Surface x={3} y={4} width={11} height={10} rx={2} /><Surface x={18} y={4} width={11} height={10} rx={2} /><Surface x={3} y={18} width={11} height={10} rx={2} /></>, <><path d="M23.5 18v10 M18.5 23h10" /></>],
  recall: [<><Surface x={10} y={4} width={18} height={24} /><path d="M15 10h8 M15 15h8 M17 20h6" /></>, <><path d="M3 11v7h7 M3 18a8 8 0 0 1 10-9" /><path d="m7 14-4 4" /></>],
  connect: [<><Surface x={3} y={4} width={11} height={10} rx={2} /><Surface x={18} y={18} width={11} height={10} rx={2} /></>, <><path d="M14 9h6a4 4 0 0 1 4 4v5 M18 23h-6a4 4 0 0 1-4-4v-5" /></>],
  web: [<><Surface x={3} y={5} width={26} height={23} /><path d="M3 11h26 M7 8h.01 M10 8h.01" /></>, <><circle cx="16" cy="19.5" r="6" /><path d="M10 19.5h12 M16 13.5c-3 3-3 9 0 12 3-3 3-9 0-12" /></>],
  layers: [<path d="m4 22 12 6 12-6 M4 16l12 6 12-6" />, <path d="m4 10 12-6 12 6-12 6Z" fill="currentColor" fillOpacity=".14" />],
  words: [<><Surface /><path d="M8 11h16 M8 22h16" /></>, <><rect x="8" y="15" width="6" height="4" rx="1" fill="currentColor" fillOpacity=".16" /><rect x="18" y="15" width="6" height="4" rx="1" fill="currentColor" fillOpacity=".16" /><path d="M16 13v8" /></>],
  subtitleFile: [<><path d="M7 3h12l7 7v19H7Z" fill="currentColor" fillOpacity=".08" /><path d="M19 3v7h7" /></>, <><path d="M11 15h4 M18 15h4 M11 20h11 M11 25h7" /></>],
  audioFx: [<Wave />, <><path d="M11 5v22 M23 5v22" /><rect x="8.5" y="10" width="5" height="4" rx="1.5" fill="var(--tool-ground)" /><rect x="20.5" y="19" width="5" height="4" rx="1.5" fill="var(--tool-ground)" /></>],
  envelope: [<><path d="M5 22v3 M9 18v7 M13 20v5 M17 22v3 M21 17v8 M25 19v6 M4 28h24" /></>, <><path d="M5 11h4c4 0 4 8 8 8s5-10 10-10" /><circle cx="5" cy="11" r="2" fill="var(--tool-ground)" /><circle cx="17" cy="19" r="2" fill="var(--tool-ground)" /><circle cx="27" cy="9" r="2" fill="var(--tool-ground)" /></>],
  duck: [<><path d="M4 7v4 M8 5v8 M12 7v4 M20 7v4 M24 5v8 M28 7v4 M4 24h24" /></>, <><path d="M4 17h5c3 0 2 9 7 9s4-9 7-9h5" /><path d="M16 5v11 M12.5 12.5 16 16l3.5-3.5" /></>],
  track: [<><path d="M4 10V4h6 M22 4h6v6 M28 22v6h-6 M10 28H4v-6" /><path d="M7 24c5-7 11 2 18-14" strokeDasharray="2 3" /></>, <><circle cx="17" cy="14" r="5" fill="currentColor" fillOpacity=".12" /><path d="M17 6v3 M17 19v3 M9 14h3 M22 14h3" /></>],
  pin: [<><Surface /><path d="m6 23 6-8 5 6" /></>, <><path d="M24 3a5 5 0 0 1 5 5c0 4-5 9-5 9s-5-5-5-9a5 5 0 0 1 5-5Z" fill="var(--tool-ground)" /><circle cx="24" cy="8" r="1.5" /></>],
  review: [<><Surface y={4} height={19} /><path d="M10 28h12 M16 23v5" /></>, <><path d="m13 9 7 4.5-7 4.5Z" fill="currentColor" fillOpacity=".15" /><path d="m22 23 2 2 5-5" /></>],
  complete: [<><Surface x={6} y={3} width={20} height={26} /><path d="M11 9h10 M11 14h7" /></>, <><circle cx="21" cy="23" r="7" fill="var(--tool-ground)" /><path d="m17.5 23 2.5 2.5 4.5-5" /></>],
  playbook: [<><path d="M16 8c-3-3-7-4-12-3v21c5-1 9 0 12 3 3-3 7-4 12-3V5c-5-1-9 0-12 3Z" fill="currentColor" fillOpacity=".08" /><path d="M16 8v21" /></>, <path d="m20 11 6 3.5-6 3.5Z" fill="currentColor" fillOpacity=".2" />],
  graphicGuide: [<><path d="M5 7h9a3 3 0 0 1 3 3v15a2 2 0 0 0-2-2H5Z M27 7h-6a3 3 0 0 0-3 3v15a2 2 0 0 1 2-2h7Z" fill="currentColor" fillOpacity=".08" /></>, <><path d="M8 19v-3 M11 19v-6 M22 19l2-4 2 2" /></>],
  graphicEdit: [<><Surface /><path d="M8 22V16 M13 22V12 M18 22v-4" /></>, <><path d="m20 19 7-7 2 2-7 7h-2Z" fill="var(--tool-ground)" /></>],
  graphic: [<><Surface /><path d="M8 22V16 M13 22V12 M18 22v-4" /></>, <><path d="m21 9 3-3 3 3 M24 6v9" /><circle cx="24" cy="20" r="3.2" fill="var(--tool-ground)" /></>],
  path: [<><path d="M5 25c5-1 4-9 10-10s6-8 12-9" strokeDasharray="2.5 3" /></>, <><circle cx="5" cy="25" r="2.4" fill="var(--tool-ground)" /><path d="m21 4 6 2-2 6" /></>],
  reference: [<><Surface x={4} y={5} width={18} height={15} rx={2} /><path d="M7.5 8.5h.01 M7.5 16.5h.01 M18.5 8.5h.01 M18.5 16.5h.01" strokeWidth="2.4" /></>, <><rect x="14" y="14" width="14" height="13" rx="2" fill="var(--tool-ground)" /><path d="M17.5 18.5h7 M17.5 22.5h4.5" /></>],
  log: [<><Surface x={4} y={4} width={13} height={24} rx={2} /><path d="M7 8h.01 M7 14h.01 M7 20h.01" strokeWidth="2.6" /></>, <><path d="M20 9h8 M20 14h8 M20 19h6 M20 24h8" /></>],
  fillers: [<Wave />, <><rect x="11" y="9" width="7" height="14" rx="2" fill="var(--tool-ground)" /><path d="m12.5 12.5 4 7 M16.5 12.5l-4 7" /></>],
  retakes: [<><Surface x={3} y={9} width={11} height={14} rx={2} /><Surface x={18} y={9} width={11} height={14} rx={2} /></>, <><path d="m5 11 7 10" /><path d="m21 16 2.5 2.5 3.5-4.5" /></>],
  highlights: [<><Surface x={3} y={17} width={26} height={11} rx={2} /><path d="M10 17v11 M20 17v11" /></>, <path d="m15 3 2 4.5 5 .5-3.8 3.3 1.1 4.9L15 13.6l-4.3 2.6 1.1-4.9L8 8l5-.5Z" fill="currentColor" fillOpacity=".2" />],
  plan: [<><Surface x={6} y={3} width={20} height={26} /><path d="M13 3v3h6V3" /></>, <><path d="m10 12 1.5 1.5L14 11 M17 12h5 M10 18l1.5 1.5L14 17 M17 18h5 M10 24h4 M17 24h5" /></>],
  critique: [<><Surface y={5} height={18} /><path d="M8 18l4-5 3 3 5-6" /></>, <><circle cx="22" cy="22" r="5" fill="var(--tool-ground)" /><path d="m25.6 25.6 3 3" /><path d="M20 22h4" /></>],
  filter: [<Picture />, <><circle cx="12" cy="13" r="6" fill="currentColor" fillOpacity=".1" /><circle cx="20" cy="13" r="6" fill="currentColor" fillOpacity=".1" /><circle cx="16" cy="19.5" r="6" fill="currentColor" fillOpacity=".1" /></>],
  captionCue: [<><Surface /><rect x="7" y="19" width="18" height="5" rx="1.5" fill="currentColor" fillOpacity=".18" /></>, <><path d="M16 6v10" strokeDasharray="2 2" /><path d="m12.5 9.5 3.5-3.5 3.5 3.5" /></>],
  effectLayer: [<><Surface x={3} y={21} width={26} height={7} rx={2} /><path d="M9 21v7 M23 21v7" /></>, <path d="m16 3 1.5 5 4.5 1.5-4.5 1.5L16 16l-1.5-5L10 9.5 14.5 8Z" fill="currentColor" fillOpacity=".18" />],
  importFile: [<><path d="M7 3h12l7 7v19H7Z" fill="currentColor" fillOpacity=".08" /><path d="M19 3v7h7" /></>, <><path d="M16 13v10 M12 19l4 4 4-4" /></>],
  beats: [<><path d="M4 26h24" /><path d="M7 26v-6 M12 26v-12 M17 26v-6 M22 26v-12 M27 26v-6" /></>, <><circle cx="12" cy="9" r="2.5" fill="currentColor" fillOpacity=".25" /><circle cx="22" cy="9" r="2.5" fill="currentColor" fillOpacity=".25" /></>],
  sourceIndex: [<><Surface x={3} y={7} width={26} height={19} /><path d="M9 7v19 M19 7v19 M3 13h26 M3 20h26" /></>, <path d="M3 3h10 M3 29h18" strokeDasharray="2 2" />],
  sourceAnalysis: [<><Surface x={3} y={4} width={24} height={24} /><path d="M7 10h15 M7 16h10 M7 22h5" /></>, <><circle cx="24" cy="24" r="6" fill="var(--tool-ground)" /><path d="m21 24 2 2 4-5" /></>],
  sourceDialogue: [<><Surface x={2} y={5} width={12} height={22} /><path d="M6 5v22 M10 5v22 M2 11h12 M2 21h12" /></>, <path d="M18 9h11 M18 15h9 M18 21h11 M18 27h6" />],
  sourceFind: [<><Picture /><circle cx="21" cy="21" r="6" fill="var(--tool-ground)" /></>, <><path d="m25.5 25.5 4 4 M18 21h6 M21 18v6" /></>],
  sourceReview: [<><Surface x={2} y={8} width={8} height={17} /><Surface x={12} y={8} width={8} height={17} /><Surface x={22} y={8} width={8} height={17} /></>, <path d="M4 4h24 M16 1v6 M4 28h24" />],
  sourcePicks: [<><Surface x={9} y={3} width={20} height={8} /><Surface x={9} y={13} width={20} height={8} /><Surface x={9} y={23} width={20} height={6} /></>, <path d="m2 6 2 2 3-4 M3 16h3 M3 26h3" />],
  sourceAdd: [<><Surface x={3} y={17} width={26} height={11} /><path d="M10 17v11 M21 17v11" /></>, <path d="M16 2v11 M11 8l5 5 5-5" />],
  delegateAnalysis: [<><circle cx="16" cy="7" r="4" /><circle cx="7" cy="25" r="4" /><circle cx="25" cy="25" r="4" /></>, <path d="M16 11v5 M7 21v-5h18v5" />],
  analysisAgent: [<><Surface x={3} y={7} width={18} height={20} /><circle cx="24" cy="10" r="5" fill="var(--tool-ground)" /></>, <><path d="M7 13h9 M7 18h9 M7 23h5 m15-9 4 4" /></>],
};
export const TOOL_ICONS = {
  list_plugin_commands:'pluginFind',run_plugin_command:'pluginRun',
  delegate_video_analysis:'delegateAnalysis',subagent_analysis:'analysisAgent',
  get_video_analysis:'sourceAnalysis',read_video_transcript:'sourceDialogue',index_video:'sourceIndex',find_video_moments:'sourceFind',review_video_moment:'sourceReview',propose_video_clips:'sourcePicks',add_video_clip:'sourceAdd',
  get_project:'project',list_options:'options',analyze_reference:'reference',analyze_scenes:'scenes',get_storyboard:'storyboard',annotate_scene:'annotation',
  remove_silences:'silence',cut_range:'cut',keep_ranges:'keep',transcribe:'transcript',add_captions:'captions',add_text:'text',edit_text:'editText',
  delete_clip:'remove',split_at:'split',set_speed:'speed',set_volume:'volume',set_filter:'filter',set_effects:'effects',add_transition:'transition',
  set_aspect_ratio:'ratio',zoom:'zoom',set_transform:'transform',add_keyframes:'keys',move_along_path:'path',graphics_guide:'graphicGuide',add_graphic:'graphic',edit_graphic:'graphicEdit',set_animation:'animation',add_media:'media',search_sounds:'soundSearch',
  add_sound:'music',list_voices:'voices',add_voiceover:'voiceover',add_narration:'narration',search_stock:'stockSearch',add_stock:'stock',add_effect:'effectLayer',move_clip:'move',
  trim_clip:'trim',clip_tools:'clip',set_color:'color',set_compositing:'composite',set_project:'settings',motion_guide:'guide',add_scene:'sceneAdd',
  generate_image:'image',generate_images:'images',inspect_frames:'inspect',undo:'undo',export_video:'export',load_tools:'tools',recall_context:'recall',
  switch:'move',mcp:'connect',web_search:'web',layer_tools:'layers',list_local_media:'search',import_media:'importFile',edit_caption_words:'words',
  caption_tools:'captionCue',export_subtitles:'subtitleFile',set_audio_effects:'audioFx',set_volume_envelope:'envelope',duck_audio:'duck',
  track_subject:'track',pin_to_subject:'pin',review_section:'review',complete_edit:'complete',
  edit_guide:'playbook',log_footage:'log',remove_fillers:'fillers',remove_retakes:'retakes',find_highlights:'highlights',
  propose_edit_plan:'plan',critique_edit:'critique',get_beats:'beats',
};
const AUDIO=new Set(['silence','transcript','volume','music','voices','voiceover','audioFx','envelope','duck','soundSearch','fillers','beats']);
const TEXT=new Set(['captions','captionCue','text','editText','words','subtitleFile']);
const MOTION=new Set(['speed','zoom','transform','keys','animation','track','pin']);
const REVIEW=new Set(['inspect','review','complete','scenes','storyboard','log','critique','highlights']);
export default function ToolCallIcon({ name }) {
  const toolName = typeof name === 'string' ? name : 'unknown';
  const art=Object.hasOwn(TOOL_ICONS,toolName)?TOOL_ICONS[toolName]:toolName.startsWith('mcp_')?'connect':'clip';
  const family=AUDIO.has(art)?'audio':TEXT.has(art)?'text':MOTION.has(art)?'motion':REVIEW.has(art)?'review':'edit';
  const [base, action] = ART[art];
  return <span className="pilot-step-kind" data-tool-icon={toolName} data-glyph={art} data-family={family} aria-hidden="true">
    <svg viewBox="0 0 32 32" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" focusable="false">
      <g className="tool-glyph-context">{base}</g>
      <g className="tool-glyph-action">{action}</g>
    </svg>
  </span>;
}
