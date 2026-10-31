// Scopes: histogram, waveform, RGB parade and vectorscope computed from the current preview
// frame. The frame is sampled from the player's <video> element, so the scopes show the
// SOURCE frame (before filters/grading are applied by the GPU pass) — the panel labels this.
// Sampling runs on a small 96x54 copy at ~4 fps while the panel is open.
import React, { useEffect, useRef, useState } from 'react';

const MODES = [
  { id: 'hist', name: 'Histogram' },
  { id: 'wave', name: 'Waveform' },
  { id: 'parade', name: 'Parade' },
  { id: 'vector', name: 'Vectorscope' },
];
const SW = 96; const SH = 54;

function drawScope(ctx, W, H, mode, data) {
  ctx.fillStyle = '#0c0c14'; ctx.fillRect(0, 0, W, H);
  if (!data) {
    ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.font = '11px system-ui';
    ctx.fillText('Play or seek the preview — scopes read its current frame.', 10, H / 2);
    return;
  }
  const px = data.data; const n = SW * SH;
  if (mode === 'hist') {
    const bins = [new Float32Array(256), new Float32Array(256), new Float32Array(256)];
    for (let i = 0; i < n; i++) { bins[0][px[i * 4]]++; bins[1][px[i * 4 + 1]]++; bins[2][px[i * 4 + 2]]++; }
    let max = 1; for (const b of bins) for (let i = 0; i < 256; i++) max = Math.max(max, b[i]);
    const cols = ['rgba(255,80,80,0.75)', 'rgba(80,255,120,0.75)', 'rgba(90,140,255,0.75)'];
    ctx.globalCompositeOperation = 'lighter';
    bins.forEach((b, c) => {
      ctx.fillStyle = cols[c];
      for (let i = 0; i < 256; i++) {
        const h = (b[i] / max) * (H - 8);
        ctx.fillRect((i / 256) * W, H - h, Math.max(1, W / 256), h);
      }
    });
    ctx.globalCompositeOperation = 'source-over';
  } else if (mode === 'wave' || mode === 'parade') {
    ctx.fillStyle = 'rgba(130,92,251,0.5)';
    for (let x = 0; x < SW; x++) {
      for (let y = 0; y < SH; y++) {
        const i = (y * SW + x) * 4;
        if (mode === 'wave') {
          const l = (0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]) / 255;
          ctx.fillRect((x / SW) * W, H - l * H, Math.max(1, W / SW), 1.5);
        } else {
          const third = W / 3;
          const cols = ['rgba(255,80,80,0.6)', 'rgba(80,255,120,0.6)', 'rgba(90,140,255,0.6)'];
          for (let c = 0; c < 3; c++) {
            const v = px[i + c] / 255;
            ctx.fillStyle = cols[c];
            ctx.fillRect(c * third + (x / SW) * third, H - v * H, Math.max(1, third / SW), 1.5);
          }
        }
      }
    }
  } else if (mode === 'vector') {
    const cx = W / 2; const cy = H / 2; const R = Math.min(W, H) / 2 - 4;
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, R * 0.5, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = 'rgba(130,92,251,0.55)';
    for (let i = 0; i < n; i += 2) {
      const r = px[i * 4] / 255; const g = px[i * 4 + 1] / 255; const b = px[i * 4 + 2] / 255;
      const u = -0.14713 * r - 0.28886 * g + 0.436 * b;
      const v = 0.615 * r - 0.51499 * g - 0.10001 * b;
      const x = cx + (u / 0.62) * R; const y = cy - (v / 0.62) * R;
      ctx.fillRect(x, y, 1.6, 1.6);
    }
  }
}

export default function Scopes() {
  const canvasRef = useRef(null);
  const scratchRef = useRef(null);
  const [mode, setMode] = useState('hist');
  const modeRef = useRef(mode);
  modeRef.current = mode;

  useEffect(() => {
    if (!scratchRef.current) {
      const c = document.createElement('canvas');
      c.width = SW; c.height = SH;
      scratchRef.current = c;
    }
    const tick = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      const video = document.querySelector('.stage video');
      let data = null;
      if (video && video.readyState >= 2 && video.videoWidth > 0) {
        try {
          const sctx = scratchRef.current.getContext('2d', { willReadFrequently: true });
          sctx.drawImage(video, 0, 0, SW, SH);
          data = sctx.getImageData(0, 0, SW, SH);
        } catch { data = null; } // frame not readable yet
      }
      drawScope(ctx, canvas.width, canvas.height, modeRef.current, data);
    };
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, []);

  useEffect(() => { /* redraw immediately on mode switch; the interval also picks it up */
    const canvas = canvasRef.current;
    if (canvas) drawScope(canvas.getContext('2d'), canvas.width, canvas.height, mode, null);
  }, [mode]);

  return (
    <div className="scopes">
      <div className="seg-tabs small" role="group" aria-label="Scope type">
        {MODES.map((m) => (
          <button key={m.id} className={mode === m.id ? 'on' : ''} aria-pressed={mode === m.id} onClick={() => setMode(m.id)}>{m.name}</button>
        ))}
      </div>
      <canvas ref={canvasRef} width={264} height={110} className="scopes-canvas" aria-label={`${MODES.find((m) => m.id === mode).name} of the current preview frame`} />
      <p className="hint">Scopes read the preview's source frame, before filters and grading are applied.</p>
    </div>
  );
}
