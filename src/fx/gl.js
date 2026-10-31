// GPU renderer for the animated effects and transitions. The expressions of catalog.js are compiled to GLSL
// fragment shaders; the preview draws with them in real time and the export sends every frame through the same
// shaders (src/fxExport.js), so both show the same picture.
import { parse } from './expr.js';

// ---- Expression -> GLSL (one expression per colour channel; ch 0 = red, 1 = green, 2 = blue).
function toGlsl(ast, mode, ch) {
  const f = (v) => {
    const s = String(v);
    return /[.e]/.test(s) ? s : `${s}.0`;
  };
  const go = (n) => {
    switch (n.k) {
      case 'num': return `(${f(n.v)})`;
      case 'var': return { X: 'X', Y: 'Y', W: 'W', H: 'H', T: 'T', P: 'P', PI: '3.14159265358979', E: '2.71828182845905' }[n.v];
      case 'neg': return `(-${go(n.a)})`;
      case 'seq': return `(${go(n.a)},${go(n.b)})`;
      case 'bin': return n.op === '^' ? `fpow(${go(n.a)},${go(n.b)})` : `(${go(n.a)}${n.op}${go(n.b)})`;
      case 'call': {
        const a = n.args.map(go);
        switch (n.f) {
          case 'if': return `((${a[0]})!=0.0?(${a[1]}):(${a[2]}))`;
          case 'ifnot': return `((${a[0]})==0.0?(${a[1]}):(${a[2]}))`;
          case 'lt': return `float((${a[0]})<(${a[1]}))`;
          case 'lte': return `float((${a[0]})<=(${a[1]}))`;
          case 'gt': return `float((${a[0]})>(${a[1]}))`;
          case 'gte': return `float((${a[0]})>=(${a[1]}))`;
          case 'eq': return `float((${a[0]})==(${a[1]}))`;
          case 'not': return `float((${a[0]})==0.0)`;
          case 'between': return `float((${a[0]})>=(${a[1]})&&(${a[0]})<=(${a[2]}))`;
          case 'clip': return `clamp(${a[0]},${a[1]},${a[2]})`;
          case 'mod': return `fmodf(${a[0]},${a[1]})`;
          case 'hypot': return `length(vec2(${a[0]},${a[1]}))`;
          case 'atan2': return `atan(${a[0]},${a[1]})`;
          case 'round': return `floor((${a[0]})+0.5)`;
          case 'trunc': return `ftrunc(${a[0]})`;
          case 'log': return `log(${a[0]})`;
          case 'pow': return `fpow(${a[0]},${a[1]})`;
          case 'st': return `(r${n.args[0].v} = (${a[1]}))`;
          case 'ld': return `r${n.args[0].v}`;
          case 'hash': return `hash1(${a[0]})`;
          case 'fract': return `fract(${a[0]})`;
          case 'smooth': return `smooth3(${a[0]},${a[1]},${a[2]})`;
          case 'S': return `smp(uA,${a[0]},${a[1]})[${ch}]`;
          case 'L': return `dot(smp(uA,${a[0]},${a[1]}).rgb,vec3(0.299,0.587,0.114))`;
          case 'A': if (mode !== 'transition') throw new Error('A() is for transitions'); return `smp(uA,${a[0]},${a[1]})[${ch}]`;
          case 'B': if (mode !== 'transition') throw new Error('B() is for transitions'); return `smp(uB,${a[0]},${a[1]})[${ch}]`;
          case 'C': return `(${a[ch]})`;
          case 'PR': return `smp(uA,${a[0]},${a[1]}).r`;
          case 'PG': return `smp(uA,${a[0]},${a[1]}).g`;
          case 'PB': return `smp(uA,${a[0]},${a[1]}).b`;
          default: return `${n.f}(${a.join(',')})`;
        }
      }
      default: throw new Error('bad node');
    }
  };
  return go(ast);
}

export function shaderSource(src, mode) {
  const ast = parse(src);
  const regs = Array.from({ length: 10 }, (_, i) => `float r${i} = 0.0;`).join(' ');
  const chan = (c) => `{ ${regs} o[${c}] = ${toGlsl(ast, mode, c)}; }`;
  return `#version 300 es
precision highp float;
precision highp sampler2D;
uniform sampler2D uA;
uniform sampler2D uB;
uniform float W;
uniform float H;
uniform float T;
uniform float P;
out vec4 outColor;
float X;
float Y;
// Pixels are 0..255 like the CPU version; textures are sampled at pixel centres (nearest).
vec4 smp(sampler2D s, float x, float y) {
  return texture(s, (vec2(clamp(floor(x), 0.0, W - 1.0), clamp(floor(y), 0.0, H - 1.0)) + 0.5) / vec2(W, H)) * 255.0;
}
float ftrunc(float v) { return v < 0.0 ? ceil(v) : floor(v); }
float fmodf(float a, float b) { return a - b * ftrunc(a / b); }
float fpow(float a, float b) { return pow(abs(a), b) * (a < 0.0 && mod(b, 2.0) == 1.0 ? -1.0 : 1.0); }
float hash1(float v) { return fract(sin(v * 12.9898 + 4.1414) * 43758.5453); }
float smooth3(float a, float b, float v) { float t = clamp((v - a) / (b - a), 0.0, 1.0); return t * t * (3.0 - 2.0 * t); }
void main() {
  X = floor(gl_FragCoord.x);
  Y = H - 1.0 - floor(gl_FragCoord.y);
  vec3 o;
  ${chan(0)}
  ${chan(1)}
  ${chan(2)}
  outColor = vec4(clamp(o / 255.0, 0.0, 1.0), ${mode === 'effect' ? 'smp(uA, X, Y).a / 255.0' : '1.0'});
}`;
}

// A 3D LUT pass: the LUT is a 2D texture of N slices (blue) of N x N (red across, green down); the color is
// looked up with linear filtering inside a slice and mixed between the two nearest slices. K: intensity 0..1.
const LUT_FRAG = `#version 300 es
precision highp float;
uniform sampler2D uA;
uniform sampler2D uL;
uniform float W;
uniform float H;
uniform float N;
uniform float K;
out vec4 outColor;
void main() {
  vec2 px = vec2(floor(gl_FragCoord.x), H - 1.0 - floor(gl_FragCoord.y));
  vec4 src = texture(uA, (px + 0.5) / vec2(W, H));
  vec3 c = clamp(src.rgb, 0.0, 1.0);
  float b = c.b * (N - 1.0);
  float b0 = floor(b);
  float b1 = min(b0 + 1.0, N - 1.0);
  float f = b - b0;
  float x = c.r * (N - 1.0) + 0.5;
  float y = (c.g * (N - 1.0) + 0.5) / N;
  vec3 l0 = texture(uL, vec2((b0 * N + x) / (N * N), y)).rgb;
  vec3 l1 = texture(uL, vec2((b1 * N + x) / (N * N), y)).rgb;
  outColor = vec4(mix(c, mix(l0, l1, f), K), src.a);
}`;

const VERT = `#version 300 es
in vec2 p;
void main() { gl_Position = vec4(p, 0.0, 1.0); }`;

// One WebGL2 context renders everything; the result is read back or drawn from `canvas`.
export class FxGL {
  constructor() {
    this.canvas = document.createElement('canvas');
    const gl = this.canvas.getContext('webgl2', { premultipliedAlpha: false, preserveDrawingBuffer: true, antialias: false });
    if (!gl) throw new Error('WebGL 2 is not available, so animated effects cannot be drawn.');
    this.gl = gl;
    // The graphics driver can drop the context (GPU reset): start a new one at the next draw.
    this.canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      if (shared === this) shared = null;
    });
    this.programs = new Map();
    this.tex = [gl.createTexture(), gl.createTexture()];
    for (const t of this.tex) {
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }
    // Effects chain through two framebuffer textures.
    this.fbTex = [gl.createTexture(), gl.createTexture()];
    this.fb = [gl.createFramebuffer(), gl.createFramebuffer()];
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  }

  program(src, mode) {
    const key = `${mode}|${src}`;
    let p = this.programs.get(key);
    if (p) return p;
    const { gl } = this;
    const sh = (type, code) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, code);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`Effect shader: ${gl.getShaderInfoLog(s)}`);
      return s;
    };
    p = gl.createProgram();
    gl.attachShader(p, sh(gl.VERTEX_SHADER, VERT));
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, shaderSource(src, mode)));
    gl.bindAttribLocation(p, 0, 'p');
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`Effect shader: ${gl.getProgramInfoLog(p)}`);
    this.programs.set(key, p);
    return p;
  }

  // source: an image, video, canvas, ImageBitmap, or { data: Uint8Array RGBA top-down, width, height }.
  upload(unit, source, w, h) {
    const { gl } = this;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, this.tex[unit]);
    if (source.data) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, source.data);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
  }

  size(w, h) {
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.gl.viewport(0, 0, w, h);
  }

  // The LUT program and the LUT's texture (made once per LUT).
  lutProgram() {
    if (this.lutProg) return this.lutProg;
    const { gl } = this;
    const sh = (type, code) => {
      const x = gl.createShader(type);
      gl.shaderSource(x, code);
      gl.compileShader(x);
      if (!gl.getShaderParameter(x, gl.COMPILE_STATUS)) throw new Error(`LUT shader: ${gl.getShaderInfoLog(x)}`);
      return x;
    };
    const p = gl.createProgram();
    gl.attachShader(p, sh(gl.VERTEX_SHADER, VERT));
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, LUT_FRAG));
    gl.bindAttribLocation(p, 0, 'p');
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`LUT shader: ${gl.getProgramInfoLog(p)}`);
    this.lutProg = p;
    return p;
  }

  lutTexture(lut) {
    this.lutTex = this.lutTex || new WeakMap();
    let t = this.lutTex.get(lut);
    if (t) return t;
    const { gl } = this;
    t = gl.createTexture();
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, lut.size * lut.size, lut.size, 0, gl.RGBA, gl.UNSIGNED_BYTE, lut.data);
    this.lutTex.set(lut, t);
    return t;
  }

  draw(prog, w, h, uniforms, target = null) {
    const { gl } = this;
    gl.bindFramebuffer(gl.FRAMEBUFFER, target);
    gl.useProgram(prog);
    gl.uniform1i(gl.getUniformLocation(prog, 'uA'), 0);
    gl.uniform1i(gl.getUniformLocation(prog, 'uB'), 1);
    gl.uniform1f(gl.getUniformLocation(prog, 'W'), w);
    gl.uniform1f(gl.getUniformLocation(prog, 'H'), h);
    gl.uniform1f(gl.getUniformLocation(prog, 'T'), uniforms.T || 0);
    gl.uniform1f(gl.getUniformLocation(prog, 'P'), uniforms.P || 0);
    if (uniforms.lut) {
      gl.activeTexture(gl.TEXTURE3);
      gl.bindTexture(gl.TEXTURE_2D, this.lutTexture(uniforms.lut));
      gl.uniform1i(gl.getUniformLocation(prog, 'uL'), 3);
      gl.uniform1f(gl.getUniformLocation(prog, 'N'), uniforms.lut.size);
      gl.uniform1f(gl.getUniformLocation(prog, 'K'), uniforms.K ?? 1);
    }
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  // Runs effect passes [{ expr, T }] one after another on `source` (w x h); the result is in this.canvas.
  effects(source, w, h, passes) {
    const exprs = passes.map((p) => p.expr);
    const { gl } = this;
    this.size(w, h);
    this.upload(0, source, w, h);
    exprs.forEach((src, i) => {
      const last = i === exprs.length - 1;
      let target = null;
      if (!last) {
        // Render into a texture, then use it as the input of the next effect.
        const k = i % 2;
        gl.activeTexture(gl.TEXTURE2);
        gl.bindTexture(gl.TEXTURE_2D, this.fbTex[k]);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.fb[k]);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.fbTex[k], 0);
        target = this.fb[k];
      }
      // A pass is an expression, or { lut, K } for a 3D LUT.
      if (passes[i].lut) this.draw(this.lutProgram(), w, h, { lut: passes[i].lut, K: passes[i].K }, target);
      else this.draw(this.program(src, 'effect'), w, h, { T: passes[i].T }, target);
      if (!last) {
        // The framebuffer is upside down compared with uploads, so copy it back through a canvas-free path:
        // read it and upload as the next source (cheap at preview sizes; the export works at full size anyway).
        const px = new Uint8Array(w * h * 4);
        gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
        this.upload(0, { data: flipRows(px, w, h) }, w, h);
      }
    });
    return this.canvas;
  }

  transition(a, b, w, h, P, src) {
    this.size(w, h);
    this.upload(0, a, w, h);
    this.upload(1, b, w, h);
    this.draw(this.program(src, 'transition'), w, h, { P });
    return this.canvas;
  }

  // The last result as RGBA, top row first.
  read(w, h) {
    const px = new Uint8Array(w * h * 4);
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);
    this.gl.readPixels(0, 0, w, h, this.gl.RGBA, this.gl.UNSIGNED_BYTE, px);
    return flipRows(px, w, h);
  }
}

function flipRows(px, w, h) {
  const out = new Uint8Array(px.length);
  const row = w * 4;
  for (let y = 0; y < h; y++) out.set(px.subarray((h - 1 - y) * row, (h - y) * row), y * row);
  return out;
}

let shared = null;
export function fxGL() {
  if (!shared) shared = new FxGL();
  return shared;
}
