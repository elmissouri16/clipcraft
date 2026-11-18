// Original ClipCraft cube parser shared by renderer and content-pack validation.
export function parseCube(text) {
  let size = 0;
  let size1d = 0;
  let min = [0, 0, 0];
  let max = [1, 1, 1];
  const values = [];
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const parts = line.split(/\s+/);
    const key = parts[0].toUpperCase();
    if (key === 'LUT_3D_SIZE') size = Number(parts[1]);
    else if (key === 'LUT_1D_SIZE') size1d = Number(parts[1]);
    else if (key === 'DOMAIN_MIN') min = parts.slice(1, 4).map(Number);
    else if (key === 'DOMAIN_MAX') max = parts.slice(1, 4).map(Number);
    else if (/^[-+.\d]/.test(parts[0]) && parts.length >= 3) values.push(Number(parts[0]), Number(parts[1]), Number(parts[2]));
  }
  // A 1D LUT is three per-channel curves: sampling them into a 17^3 grid is mathematically
  // exact for 1D input, so 1D .cube files are converted instead of rejected.
  if (!size && size1d) {
    if (!(size1d >= 2 && size1d <= 65536)) throw new Error('Not a valid 1D .cube LUT (bad LUT_1D_SIZE).');
    if (values.length < size1d * 3) throw new Error('The LUT file is incomplete.');
    const OUT = 17;
    const curve = (c, x) => {
      const f = Math.min(size1d - 1, Math.max(0, x * (size1d - 1)));
      const i = Math.floor(f);
      const j = Math.min(size1d - 1, i + 1);
      const v = values[i * 3 + c] + (values[j * 3 + c] - values[i * 3 + c]) * (f - i);
      return (v - min[c]) / ((max[c] - min[c]) || 1);
    };
    const data = new Uint8Array(OUT * OUT * OUT * 4);
    for (let b = 0; b < OUT; b++) for (let g = 0; g < OUT; g++) for (let r = 0; r < OUT; r++) {
      const d = (g * OUT * OUT + b * OUT + r) * 4;
      data[d] = Math.round(Math.min(1, Math.max(0, curve(0, r / (OUT - 1)))) * 255);
      data[d + 1] = Math.round(Math.min(1, Math.max(0, curve(1, g / (OUT - 1)))) * 255);
      data[d + 2] = Math.round(Math.min(1, Math.max(0, curve(2, b / (OUT - 1)))) * 255);
      data[d + 3] = 255;
    }
    return { size: OUT, data, from1d: true };
  }
  if (!(size >= 2 && size <= 129)) throw new Error('Not a 3D .cube LUT (no LUT_3D_SIZE).');
  if (values.length < size * size * size * 3) throw new Error('The LUT file is incomplete.');
  // .cube order: red changes fastest, then green, then blue.
  const data = new Uint8Array(size * size * size * 4);
  for (let b = 0; b < size; b++) {
    for (let g = 0; g < size; g++) {
      for (let r = 0; r < size; r++) {
        const s = ((b * size + g) * size + r) * 3;
        const d = (g * size * size + b * size + r) * 4; // row g, column b * size + r
        for (let c = 0; c < 3; c++) {
          const v = (values[s + c] - min[c]) / ((max[c] - min[c]) || 1);
          data[d + c] = Math.round(Math.min(1, Math.max(0, v)) * 255);
        }
        data[d + 3] = 255;
      }
    }
  }
  return { size, data };
}
