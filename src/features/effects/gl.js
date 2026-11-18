// GPU renderer for the animated effects and transitions. The expressions of catalog.js are compiled to GLSL
// fragment shaders; the preview draws with them in real time and the export sends every frame through the same
// shaders (src/features/export/fxExport.js), so both show the same picture.
import { parse } from './expr.js';
import { t } from '../../i18n/index.js';

// ---- Expression -> GLSL (one expression per colour channel; ch 0 = red, 1 = green, 2 = blue).
function toGlsl(ast, mode, ch) {
  const f = (v) => {
    const s = String(v);
    return /[.e]/.test(s) ? s : `${s}.0`;
  };
  const go = (n) => {
    switch (n.k) {
      case 'num': return `(${f(n.v)})`;
      case 'param': return `uParams[${Math.floor(n.index / 4)}][${n.index % 4}]`;
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
  return sourceOf(parse(src), mode);
}

// Numbers that change during a slider/region gesture are uniforms. Register
// indices stay literal: st/ld select GLSL variables rather than numeric inputs.
export function shaderTemplate(src, mode) {
  const values = [];
  const visit = (node, literal = false) => {
    if (node.k === 'num') return literal ? node : { k: 'param', index: values.push(node.v) - 1 };
    if (node.k === 'call') return { ...node, args: node.args.map((arg, i) => visit(arg, i === 0 && ['st', 'ld'].includes(node.f))) };
    return { ...node, ...(node.a ? { a: visit(node.a) } : {}), ...(node.b ? { b: visit(node.b) } : {}) };
  };
  const ast = visit(parse(src)), params = new Float32Array(Math.ceil(values.length / 4) * 4);
  params.set(values);
  return { key: `${mode}|${JSON.stringify(ast)}`, ast, params, mode };
}

function sourceOf(ast, mode, parameterVectors = 0) {
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
uniform bool uFlipY;
${parameterVectors ? `uniform vec4 uParams[${parameterVectors}];` : ''}
out vec4 outColor;
float X;
float Y;
// Pixels are 0..255 like the CPU version; textures are sampled at pixel centres (nearest).
vec4 smp(sampler2D s, float x, float y) {
  vec2 px = vec2(clamp(floor(x), 0.0, W - 1.0), clamp(floor(y), 0.0, H - 1.0));
  if (uFlipY) px.y = H - 1.0 - px.y;
  return texture(s, (px + 0.5) / vec2(W, H)) * 255.0;
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
uniform bool uFlipY;
out vec4 outColor;
void main() {
  vec2 px = vec2(floor(gl_FragCoord.x), H - 1.0 - floor(gl_FragCoord.y));
  if (uFlipY) px.y = H - 1.0 - px.y;
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

// Preview keying stays on the GPU, including painted
// keep-maps. The integer chroma calculation mirrors applyChromaKey's reference.
const KEY_FRAG = `#version 300 es
precision highp float;
uniform sampler2D uA;
uniform sampler2D uCustom;
uniform float W;
uniform float H;
uniform vec4 uCrop;
uniform bool uKeyOn;
uniform bool uCustomOn;
uniform bool uFlipY;
uniform vec3 uKeyColor;
uniform vec3 uKeyParams;
out vec4 outColor;
vec2 chroma(vec3 c) {
  return floor((vec2(dot(c, vec3(-38.,-74.,112.)), dot(c, vec3(112.,-94.,-18.))) + 128.) / 256.) + 128.;
}
void main() {
  vec2 uv = uCrop.xy + vec2(gl_FragCoord.x/W, 1.-gl_FragCoord.y/H)*uCrop.zw;
  vec4 source = texture(uA, uFlipY ? vec2(uv.x, 1.-uv.y) : uv);
  vec3 rgb = floor(source.rgb*255.+.5);
  float alpha = floor(source.a*255.+.5);
  if (uKeyOn) {
    vec2 delta = chroma(rgb)-chroma(uKeyColor);
    float difference = length(delta)/sqrt(255.*255.*2.);
    float keep = uKeyParams.y > .0001 ? clamp((difference-uKeyParams.x)/uKeyParams.y,0.,1.) : float(difference>uKeyParams.x);
    alpha = floor(keep*alpha+.5);
    if (uKeyParams.z > 0. && keep > 0.) {
      int dominant = uKeyColor.g >= uKeyColor.r && uKeyColor.g >= uKeyColor.b ? 1 : (uKeyColor.b >= uKeyColor.r ? 2 : 0);
      float others = (rgb[0]+rgb[1]+rgb[2]-rgb[dominant])*.5;
      rgb[dominant] = floor(rgb[dominant]-uKeyParams.z*max(0.,rgb[dominant]-others)+.5);
    }
  }
  if (uCustomOn) alpha = floor(alpha*texture(uCustom,uv).r+.5);
  outColor = vec4(rgb,alpha)/255.;
}`;

// One WebGL2 context renders everything; the result is read back or drawn from `canvas`.
export class FxGL {
  constructor() {
    this.canvas = document.createElement('canvas');
    const gl = this.canvas.getContext('webgl2', { premultipliedAlpha: false, preserveDrawingBuffer: true, antialias: false });
    if (!gl) throw new Error('WebGL 2 is not available, so animated effects cannot be drawn.');
    this.gl = gl;
    // The graphics driver can drop the context (GPU reset): start a new one at the next draw. A lost context
    // draws and reads nothing, so work still holding this one (an export's effects pass) fails at its next
    // read-back instead of writing stale frames (assertLive).
    this.lost = false;
    this.canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.lost = true;
      if (shared === this) shared = null;
    });
    this.programs = new Map();
    this.templates = new Map();
    this.uniforms = new WeakMap();
    this.maxParameterVectors = gl.getParameter(gl.MAX_FRAGMENT_UNIFORM_VECTORS) - 24;
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
    this.targetSize = '';
    const buf = this.buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  }

  prepared(src, mode) {
    const expressionKey = `${mode}|${src}`;
    let template = this.templates.get(expressionKey);
    if (!template) {
      template = shaderTemplate(src, mode);
      this.templates.set(expressionKey, template);
      if (this.templates.size > 256) this.templates.delete(this.templates.keys().next().value);
    }
    const parameterized = template.params.length / 4 <= this.maxParameterVectors;
    const key = parameterized ? template.key : expressionKey;
    let p = this.programs.get(key);
    if (p) {
      this.programs.delete(key);this.programs.set(key, p);
      return { program: p, params: parameterized ? template.params : null };
    }
    const { gl } = this;
    const shaders = [];
    const sh = (type, code) => {
      const s = gl.createShader(type);
      shaders.push(s);
      gl.shaderSource(s, code);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`Effect shader: ${gl.getShaderInfoLog(s)}`);
      return s;
    };
    p = gl.createProgram();
    try {
      gl.attachShader(p, sh(gl.VERTEX_SHADER, VERT));
      gl.attachShader(p, sh(gl.FRAGMENT_SHADER, parameterized ? sourceOf(template.ast, mode, template.params.length / 4) : shaderSource(src, mode)));
      gl.bindAttribLocation(p, 0, 'p');
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`Effect shader: ${gl.getProgramInfoLog(p)}`);
    } catch (error) { gl.deleteProgram(p);throw error; }
    finally { shaders.forEach(shader => gl.deleteShader(shader)); }
    this.programs.set(key, p);
    // Room for both library panels (~110 effects, ~100 transitions) plus the timeline's.
    if (this.programs.size > 256) {
      const oldest = this.programs.keys().next().value;
      gl.deleteProgram(this.programs.get(oldest));this.programs.delete(oldest);
    }
    return { program: p, params: parameterized ? template.params : null };
  }

  program(src, mode) { return this.prepared(src, mode).program; }

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
    const shaders = [];
    const sh = (type, code) => {
      const x = gl.createShader(type);
      shaders.push(x);
      gl.shaderSource(x, code);
      gl.compileShader(x);
      if (!gl.getShaderParameter(x, gl.COMPILE_STATUS)) throw new Error(`LUT shader: ${gl.getShaderInfoLog(x)}`);
      return x;
    };
    const p = gl.createProgram();
    try {
      gl.attachShader(p, sh(gl.VERTEX_SHADER, VERT));
      gl.attachShader(p, sh(gl.FRAGMENT_SHADER, LUT_FRAG));
      gl.bindAttribLocation(p, 0, 'p');
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`LUT shader: ${gl.getProgramInfoLog(p)}`);
    } catch (error) { gl.deleteProgram(p);throw error; }
    finally { shaders.forEach(shader => gl.deleteShader(shader)); }
    this.lutProg = p;
    return p;
  }

  keyProgram() {
    if (this.keyProg) return this.keyProg;
    const { gl } = this, shaders = [];
    const p = gl.createProgram();
    try {
      for (const [type, source] of [[gl.VERTEX_SHADER, VERT], [gl.FRAGMENT_SHADER, KEY_FRAG]]) {
        const shader = gl.createShader(type);shaders.push(shader);gl.shaderSource(shader, source);gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(`Key shader: ${gl.getShaderInfoLog(shader)}`);
        gl.attachShader(p, shader);
      }
      gl.bindAttribLocation(p, 0, 'p');gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`Key shader: ${gl.getProgramInfoLog(p)}`);
    } catch (error) { gl.deleteProgram(p);throw error; }
    finally { shaders.forEach(shader => gl.deleteShader(shader)); }
    this.keyProg = p;return p;
  }

  keyTexture(unit, source) {
    const { gl } = this;
    this.keyTex ||= new Map();
    this.keySource ||= new Map();
    let texture = this.keyTex.get(unit);
    if (!texture) { texture = gl.createTexture();this.keyTex.set(unit, texture); }
    gl.activeTexture(gl.TEXTURE0 + unit);gl.bindTexture(gl.TEXTURE_2D, texture);
    // A painted mask arrives as a canvas that is replaced, never redrawn, when the strokes change
    // (customMaskCanvas): the same canvas again is the same pixels, already on the GPU.
    if (!source.data && this.keySource.get(unit) === source) return;
    this.keySource.set(unit, source.data ? null : source);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (source.data) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, source.width, source.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, source.data);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
  }

  lutTexture(lut) {
    this.lutTex = this.lutTex || new Map();
    let t = this.lutTex.get(lut);
    if (t) { this.lutTex.delete(lut);this.lutTex.set(lut, t);return t; }
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
    if (this.lutTex.size > 16) {
      const oldest = this.lutTex.keys().next().value;
      gl.deleteTexture(this.lutTex.get(oldest));this.lutTex.delete(oldest);
    }
    return t;
  }

  dispose() {
    const { gl } = this;
    this.programs.forEach(program => gl.deleteProgram(program));
    if (this.lutProg) gl.deleteProgram(this.lutProg);
    if (this.keyProg) gl.deleteProgram(this.keyProg);
    this.keyTex?.forEach(texture => gl.deleteTexture(texture));
    this.lutTex?.forEach(texture => gl.deleteTexture(texture));
    [...this.tex, ...this.fbTex].forEach(texture => gl.deleteTexture(texture));
    this.fb.forEach(framebuffer => gl.deleteFramebuffer(framebuffer));
    gl.deleteBuffer(this.buffer);
    this.pbos?.forEach(pbo => pbo && gl.deleteBuffer(pbo.buffer));this.pbos = null;
    if (this.flipFb) gl.deleteFramebuffer(this.flipFb);
    if (this.flipRb) gl.deleteRenderbuffer(this.flipRb);
    this.flipFb = this.flipRb = null;this.flipSize = '';
    this.programs.clear();this.templates.clear();this.lutTex?.clear();
    this.lutProg = null;
    this.keyProg = null;this.keyTex?.clear();
    this.readback = null;
    if (shared === this) shared = null;
  }

  draw(prog, w, h, uniforms, target = null) {
    const { gl } = this;
    gl.bindFramebuffer(gl.FRAMEBUFFER, target);
    gl.useProgram(prog);
    let locations = this.uniforms.get(prog);
    if (!locations) {
      locations = Object.fromEntries(['uA','uB','W','H','T','P','uFlipY','uParams[0]','uL','N','K','uCrop','uKeyOn','uKeyColor','uKeyParams','uCustom','uCustomOn'].map(name => [name, gl.getUniformLocation(prog, name)]));
      this.uniforms.set(prog, locations);
    }
    gl.uniform1i(locations.uA, 0);
    gl.uniform1i(locations.uB, 1);
    gl.uniform1f(locations.W, w);
    gl.uniform1f(locations.H, h);
    gl.uniform1f(locations.T, uniforms.T || 0);
    gl.uniform1f(locations.P, uniforms.P || 0);
    gl.uniform1i(locations.uFlipY, uniforms.flipY ? 1 : 0);
    if (uniforms.params?.length) gl.uniform4fv(locations['uParams[0]'], uniforms.params);
    if (uniforms.key) {
      const key = uniforms.key;
      gl.uniform4fv(locations.uCrop, key.crop || [0, 0, 1, 1]);
      gl.uniform1i(locations.uKeyOn, key.on ? 1 : 0);
      gl.uniform3fv(locations.uKeyColor, key.color || [0, 255, 0]);
      gl.uniform3fv(locations.uKeyParams, key.params || [0, 0, 0]);
      // Bind the source texture when no painted mask is present so the sampler stays valid.
      gl.uniform1i(locations.uCustom, key.custom ? 5 : 0);
      gl.uniform1i(locations.uCustomOn, key.custom ? 1 : 0);
      if (key.custom) this.keyTexture(5, key.custom);
    }
    if (uniforms.lut) {
      gl.activeTexture(gl.TEXTURE3);
      gl.bindTexture(gl.TEXTURE_2D, this.lutTexture(uniforms.lut));
      gl.uniform1i(locations.uL, 3);
      gl.uniform1f(locations.N, uniforms.lut.size);
      gl.uniform1f(locations.K, uniforms.K ?? 1);
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
    const sampling = passes[0]?.key ? gl.LINEAR : gl.NEAREST;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, sampling);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, sampling);
    let texture = this.tex[0], flipY = false;
    if (passes.length > 1 && this.targetSize !== `${w}:${h}`) {
      this.fbTex.forEach((tex, i) => {
        gl.activeTexture(gl.TEXTURE2);
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.fb[i]);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      });
      this.targetSize = `${w}:${h}`;
    }
    exprs.forEach((src, i) => {
      const last = i === exprs.length - 1;
      let target = null;
      if (!last) {
        // Render into a texture, then use it as the input of the next effect.
        const k = i % 2;
        target = this.fb[k];
      }
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      const sampling = passes[i].key ? gl.LINEAR : gl.NEAREST;
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, sampling);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, sampling);
      // A pass is an expression, or { lut, K } for a 3D LUT.
      if (passes[i].key) this.draw(this.keyProgram(), w, h, { key: passes[i].key, flipY }, target);
      else if (passes[i].lut) this.draw(this.lutProgram(), w, h, { lut: passes[i].lut, K: passes[i].K, flipY }, target);
      else {
        const shader = this.prepared(src, 'effect');
        this.draw(shader.program, w, h, { T: passes[i].T, flipY, params: shader.params }, target);
      }
      if (!last) {
        texture = this.fbTex[i % 2];
        flipY = true;
      }
    });
    return this.canvas;
  }

  transition(a, b, w, h, P, src) {
    this.size(w, h);
    this.upload(0, a, w, h);
    this.upload(1, b, w, h);
    // Reveal/slide formulas can leave a border at exactly 0/1. A junction
    // must start/end on the unmodified input.
    const shader = this.prepared(P === 0 ? 'A(X,Y)' : P === 1 ? 'B(X,Y)' : src, 'transition');
    this.draw(shader.program, w, h, { P, params: shader.params });
    return this.canvas;
  }

  // Starts copying the last result (top row first) into a pixel buffer without waiting for
  // the GPU; finish(handle, output) collects it later. The export draws the next frame in the
  // meantime: a synchronous readPixels stalled every exported frame for ~13 ms.
  readAsync(w, h) {
    this.assertLive();
    const { gl } = this, size = w * h * 4;
    if (!this.flipTarget(w, h)) return { bytes: this.read(w, h) };
    this.pbos ||= [];this.pboAt = ((this.pboAt ?? -1) + 1) % 3;
    let pbo = this.pbos[this.pboAt];
    if (!pbo || pbo.size !== size) {
      if (pbo) gl.deleteBuffer(pbo.buffer);
      pbo = this.pbos[this.pboAt] = { buffer: gl.createBuffer(), size };
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo.buffer);gl.bufferData(gl.PIXEL_PACK_BUFFER, size, gl.STREAM_READ);
    }
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.flipFb);
    gl.blitFramebuffer(0, 0, w, h, 0, h, w, 0, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.flipFb);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo.buffer);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, 0);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);gl.flush();
    return { pbo, sync, size };
  }

  async finish(handle, output) {
    if (handle.bytes) return handle.bytes;
    this.assertLive();
    const { gl } = this, out = output?.length === handle.size ? output : new Uint8Array(handle.size);
    // A fence only updates between tasks: yield until the copy is done (normally at once).
    for (let i = 0; i < 2000 && gl.clientWaitSync(handle.sync, 0, 0) === gl.TIMEOUT_EXPIRED; i++) await yieldTask();
    this.assertLive();
    gl.deleteSync(handle.sync);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, handle.pbo.buffer);
    gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, out);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    this.assertLive();
    return out;
  }

  // Throws once the context is lost: its pictures are no longer the frames that were drawn.
  assertLive() {
    if (this.lost || this.gl.isContextLost?.()) throw new Error(t('export.gpu_context_lost'));
  }

  // The mirrored-blit target of read/readAsync, or false when the driver cannot make one.
  flipTarget(w, h) {
    const { gl } = this;
    if (this.flipSize === `${w}:${h}`) return true;
    if (this.flipSize === 'none') return false;
    this.flipFb ||= gl.createFramebuffer();this.flipRb ||= gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, this.flipRb);gl.renderbufferStorage(gl.RENDERBUFFER, gl.RGBA8, w, h);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.flipFb);gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, this.flipRb);
    const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.flipSize = ok ? `${w}:${h}` : 'none';
    return ok;
  }

  // The last result as RGBA, top row first. The GPU turns the picture upside down while
  // copying it (a mirrored blit), so the rows come back in order without an 8 MB CPU flip
  // per exported frame; without a blit target the rows are flipped here.
  read(w, h, output) {
    this.assertLive();
    const { gl } = this, size = w * h * 4;
    const out = output?.length === size ? output : new Uint8Array(size);
    try {
      if (!this.flipTarget(w, h)) throw new Error('no blit target');
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.flipFb);
      gl.blitFramebuffer(0, 0, w, h, 0, h, w, 0, gl.COLOR_BUFFER_BIT, gl.NEAREST);
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.flipFb);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, out);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return out;
    } catch {
      const px = this.readback?.length === size ? this.readback : (this.readback = new Uint8Array(size));
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
      return flipRows(px, w, h, out);
    }
  }
}

// One task turn without timer clamping (a fence's status changes only between tasks).
const yieldTask = () => new Promise((resolve) => { const ch = new MessageChannel(); ch.port1.onmessage = () => { ch.port1.close(); resolve(); }; ch.port2.postMessage(0); });

function flipRows(px, w, h, out = new Uint8Array(px.length)) {
  const row = w * 4;
  for (let y = 0; y < h; y++) out.set(px.subarray((h - 1 - y) * row, (h - y) * row), y * row);
  return out;
}

let shared = null;
export function fxGL() {
  if (!shared) shared = new FxGL();
  return shared;
}
