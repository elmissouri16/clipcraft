// An animated bar chart component, as the agent would write one. Its geometry is fixed so tests can
// measure exact pixels: plot from x 120 to 960, baseline y 1500, top y 500 (1080x1920 canvas);
// gridlines are 4 px white bands at 25 % opacity centred on y 500/750/1000/1250; bar i spans
// x 144+168i .. 264+168i; the tallest value fills the full 1000 px.
export const inputs = {
  data: { type: 'series', default: [{ label: '2019', value: 1.2 }, { label: '2020', value: 1.9 }, { label: '2021', value: 2.6 }, { label: '2022', value: 3.0 }, { label: '2023', value: 3.4 }] },
  title: { type: 'text', default: 'Revenue' },
  format: { type: 'text', default: '$#.#M' },
  accent: { type: 'color', default: '#e8b34a' },
  font: { type: 'font', default: null }, // { family, data: base64 woff2 }: embedded, since an SVG image loads nothing external
};

export default function render({ frame, fps, width, height, inputs, kit }) {
  const { data, title, format, accent, font } = inputs;
  const family = font ? 'GraphicFont' : 'sans-serif';
  const face = font ? kit.svg`<style>@font-face { font-family: GraphicFont; src: url(data:font/woff2;base64,${font.data}) format('woff2'); }</style>` : '';
  const left = 120, right = 960, base = 1500, top = 500, step = (right - left) / data.length, barW = 120;
  const max = Math.max(...data.map((d) => d.value));
  const axis = kit.progress(frame, 0, 18, 'out');                     // the baseline draws itself on
  const grid = [500, 750, 1000, 1250].map((y) => kit.svg`<rect x="${left}" y="${y - 2}" width="${right - left}" height="4" fill="#ffffff" fill-opacity="0.25"/>`);
  const bars = data.map((d, i) => {
    const grow = kit.spring({ frame, fps, delay: kit.stagger(i, 6, 15), stiffness: 120, damping: 14 });
    const h = (d.value / max) * (base - top) * grow, x = left + i * step + (step - barW) / 2;
    const shown = kit.format(d.value * Math.min(1, Math.max(0, grow)), format);
    return kit.svg`<rect x="${x}" y="${base - h}" width="${barW}" height="${Math.max(0, h)}" fill="${accent}"/>
      <text x="${x + barW / 2}" y="${base - h - 24}" fill="#ffffff" font-family="${family}" font-size="40" font-weight="700" text-anchor="middle" opacity="${kit.clamp01(grow * 2)}">${shown}</text>
      <text x="${x + barW / 2}" y="${base + 56}" fill="#ffffff" fill-opacity="0.8" font-family="${family}" font-size="34" text-anchor="middle">${d.label}</text>`;
  });
  const titleIn = kit.progress(frame, 0, 20, 'out');
  return kit.svg`<svg viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
    ${face}
    ${grid}
    <rect x="${left}" y="${base}" width="${(right - left) * axis}" height="6" fill="#ffffff"/>
    ${bars}
    <text x="${left}" y="${380 - 40 * (1 - titleIn)}" fill="#ffffff" opacity="${titleIn}" font-family="${family}" font-size="72" font-weight="800">${title}</text>
  </svg>`;
}
