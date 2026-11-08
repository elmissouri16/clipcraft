// Camera bubble: live camera, round or square, dragged anywhere, resized with − / +. The camera picture is drawn
// into a canvas clipped to the shape (mirrored like a selfie view, cropped to fill like the recorded clip's mask).
const canvas = document.getElementById('c');
const ctx = canvas.getContext('2d');
const video = document.getElementById('v');
const msg = document.getElementById('msg');
let stream = null;
let shapeNow = 'circle';
let style = { stroke: 0, strokeColor: '#ffffff', glow: 0, glowColor: '#825cfb' };
let room = 0; // transparent margin of the window around the shape (CSS pixels), for the glow

async function open(deviceId) {
  if (stream) stream.getTracks().forEach((t) => t.stop());
  stream = null;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { deviceId: deviceId ? { exact: deviceId } : undefined, width: 1280, height: 720 }, audio: false });
    video.srcObject = stream;
    msg.hidden = true;
  } catch (e) {
    msg.textContent = 'Camera unavailable. Close other apps that use it.';
    msg.hidden = false;
  }
}

// The shape in the box (x, y, w, h).
function outline(x, y, w, h) {
  ctx.beginPath();
  if (shapeNow === 'circle') ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
  else ctx.roundRect(x, y, w, h, Math.min(w, h) * 0.14);
}

function draw() {
  const dpr = window.devicePixelRatio || 1;
  const w = Math.round(canvas.clientWidth * dpr);
  const h = Math.round(canvas.clientHeight * dpr);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  ctx.clearRect(0, 0, w, h);
  // The shape's box inside the transparent room.
  const r = room * dpr;
  const x = r;
  const y = r;
  const sw = w - 2 * r;
  const sh = h - 2 * r;
  const k = sw / (220 * dpr); // sizes are for a 720p video, where the bubble is about 220 px
  // Glow outside the shape, as in the video: the shape lit in the glow color with a soft shadow; the camera
  // picture covers its inside.
  if (style.glow > 0) {
    ctx.save();
    ctx.shadowColor = style.glowColor;
    ctx.shadowBlur = Math.min(r * 0.9, style.glow * k * 2 * dpr);
    ctx.fillStyle = style.glowColor;
    for (let i = 0; i < 3; i++) {
      outline(x, y, sw, sh);
      ctx.fill();
    }
    ctx.restore();
  }
  ctx.save();
  outline(x, y, sw, sh);
  ctx.clip();
  ctx.fillStyle = '#111';
  ctx.fillRect(x, y, sw, sh);
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (vw && vh) {
    // Cover: the largest centered square of the picture, mirrored.
    const s = Math.min(vw, vh);
    ctx.translate(x + sw, y);
    ctx.scale(-1, 1);
    ctx.drawImage(video, (vw - s) / 2, (vh - s) / 2, s, s, 0, 0, sw, sh);
  }
  ctx.restore();
  outline(x, y, sw, sh);
  if (style.stroke > 0) {
    ctx.lineWidth = style.stroke * k * dpr;
    ctx.strokeStyle = style.strokeColor;
  } else {
    // Thin edge so the shape reads on any background.
    ctx.lineWidth = 1.5 * dpr;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
  }
  ctx.stroke();
  requestAnimationFrame(draw);
}
requestAnimationFrame(draw);

function shape(s) {
  shapeNow = s === 'square' ? 'square' : 'circle';
  document.getElementById('circle').classList.toggle('on', shapeNow === 'circle');
  document.getElementById('square').classList.toggle('on', shapeNow === 'square');
}

window.cambubble.onConfig((c) => {
  shape(c.shape);
  style = { stroke: c.stroke || 0, strokeColor: c.strokeColor || '#ffffff', glow: c.glow || 0, glowColor: c.glowColor || '#825cfb' };
  room = c.room || 0;
  document.documentElement.style.setProperty('--room', `${room}px`);
  if (c.deviceId !== undefined && c.deviceId !== open.last) {
    open.last = c.deviceId;
    open(c.deviceId);
  }
});
document.getElementById('circle').addEventListener('click', () => window.cambubble.set({ shape: 'circle' }));
document.getElementById('square').addEventListener('click', () => window.cambubble.set({ shape: 'square' }));
document.getElementById('smaller').addEventListener('click', () => window.cambubble.set({ grow: -1 }));
document.getElementById('bigger').addEventListener('click', () => window.cambubble.set({ grow: 1 }));
