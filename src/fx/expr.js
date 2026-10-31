// A small expression language (a subset of FFmpeg's) in which the animated effects and transitions are written.
// gl.js compiles it to WebGL shaders (preview and export); compile() below gives a JavaScript version used as a
// CPU reference in tests.
//
// Supported: numbers, + - * / ^, unary minus, parentheses, ';' sequences, variables (X Y W H T P PI E), and the
// functions in FUNCS. Macros for our effects:
//   S(x, y)        sample the current channel of the source frame (geq: r/g/b(x,y), clamped)
//   L(x, y)        luminance of the source frame at x, y
//   A(x, y) B(x,y) sample the current channel of the outgoing / incoming clip (xfade: a0..a2 / b0..b2)
//   C(r, g, b)     pick the value for the current channel (lets an expression tint in a color)
//   PR(x, y) PG(x, y) PB(x, y)  red, green, blue of the source frame at x, y (whatever the current channel)
//   hash(n)        deterministic pseudo random in [0,1) from a number
//   fract(v)       v - floor(v)
//   smooth(a,b,v)  smoothstep

const FUNCS = {
  sin: 1, cos: 1, tan: 1, abs: 1, floor: 1, ceil: 1, round: 1, trunc: 1, sqrt: 1, exp: 1, log: 1, atan: 1, not: 1,
  min: 2, max: 2, mod: 2, hypot: 2, atan2: 2, lt: 2, lte: 2, gt: 2, gte: 2, eq: 2, pow: 2, st: 2, ld: 1,
  if: 3, ifnot: 3, clip: 3, between: 3,
  S: 2, L: 2, A: 2, B: 2, C: 3, hash: 1, fract: 1, smooth: 3, PR: 2, PG: 2, PB: 2,
};
const VARS = ['X', 'Y', 'W', 'H', 'T', 'P', 'PI', 'E'];

function tokenize(src) {
  const out = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    const num = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(src.slice(i));
    if (num) { out.push({ t: 'num', v: Number(num[0]) }); i += num[0].length; continue; }
    const id = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i));
    if (id) { out.push({ t: 'id', v: id[0] }); i += id[0].length; continue; }
    if ('+-*/^(),;'.includes(c)) { out.push({ t: c }); i++; continue; }
    throw new Error(`Unexpected "${c}" in expression`);
  }
  return out;
}

export function parse(src) {
  const tk = tokenize(src);
  let p = 0;
  const peek = () => tk[p] && tk[p].t;
  const take = (t) => {
    if (peek() !== t) throw new Error(`Expected "${t}" in expression`);
    return tk[p++];
  };
  const seq = () => {
    let n = add();
    while (peek() === ';') { p++; n = { k: 'seq', a: n, b: add() }; }
    return n;
  };
  const add = () => {
    let n = mul();
    while (peek() === '+' || peek() === '-') { const op = tk[p++].t; n = { k: 'bin', op, a: n, b: mul() }; }
    return n;
  };
  const mul = () => {
    let n = unary();
    while (peek() === '*' || peek() === '/') { const op = tk[p++].t; n = { k: 'bin', op, a: n, b: unary() }; }
    return n;
  };
  const unary = () => {
    if (peek() === '-') { p++; return { k: 'neg', a: unary() }; }
    if (peek() === '+') { p++; return unary(); }
    return power();
  };
  const power = () => {
    const base = atom();
    if (peek() === '^') { p++; return { k: 'bin', op: '^', a: base, b: unary() }; }
    return base;
  };
  const atom = () => {
    const tok = tk[p];
    if (!tok) throw new Error('Unexpected end of expression');
    if (tok.t === 'num') { p++; return { k: 'num', v: tok.v }; }
    if (tok.t === '(') { p++; const n = seq(); take(')'); return n; }
    if (tok.t === 'id') {
      p++;
      if (peek() === '(') {
        if (!(tok.v in FUNCS)) throw new Error(`Unknown function ${tok.v}`);
        p++;
        const args = [];
        if (peek() !== ')') {
          args.push(seq());
          while (peek() === ',') { p++; args.push(seq()); }
        }
        take(')');
        if (args.length !== FUNCS[tok.v]) throw new Error(`${tok.v} takes ${FUNCS[tok.v]} arguments`);
        return { k: 'call', f: tok.v, args };
      }
      if (!VARS.includes(tok.v)) throw new Error(`Unknown variable ${tok.v}`);
      return { k: 'var', v: tok.v };
    }
    throw new Error(`Unexpected "${tok.t}" in expression`);
  };
  const ast = seq();
  if (p !== tk.length) throw new Error('Unexpected text after the expression');
  return ast;
}

// ---- Compiling to JavaScript closures (no eval, so it works under the app's Content Security Policy).
// Returns fn(env) where env = { X, Y, W, H, T, P, ch, S, L, A, B, reg }.
const F = {
  hash: (v) => { const s = Math.sin(v * 12.9898 + 4.1414) * 43758.5453; return s - Math.floor(s); },
  fract: (v) => v - Math.floor(v),
  smooth: (a, b, v) => { const t = Math.min(Math.max((v - a) / (b - a), 0), 1); return t * t * (3 - 2 * t); },
};
const MATH1 = { sin: Math.sin, cos: Math.cos, tan: Math.tan, abs: Math.abs, floor: Math.floor, ceil: Math.ceil, round: Math.round,
  trunc: Math.trunc, sqrt: Math.sqrt, exp: Math.exp, log: Math.log, atan: Math.atan, hash: F.hash, fract: F.fract };
const MATH2 = { min: Math.min, max: Math.max, mod: (a, b) => a % b, hypot: Math.hypot, atan2: Math.atan2, pow: Math.pow,
  lt: (a, b) => (a < b ? 1 : 0), lte: (a, b) => (a <= b ? 1 : 0), gt: (a, b) => (a > b ? 1 : 0), gte: (a, b) => (a >= b ? 1 : 0),
  eq: (a, b) => (a === b ? 1 : 0) };

export function compile(ast) {
  const go = (n) => {
    switch (n.k) {
      case 'num': { const v = n.v; return () => v; }
      case 'var': {
        if (n.v === 'PI') return () => Math.PI;
        if (n.v === 'E') return () => Math.E;
        const k = n.v;
        return (e) => e[k];
      }
      case 'neg': { const a = go(n.a); return (e) => -a(e); }
      case 'seq': { const a = go(n.a); const b = go(n.b); return (e) => (a(e), b(e)); }
      case 'bin': {
        const a = go(n.a);
        const b = go(n.b);
        switch (n.op) {
          case '+': return (e) => a(e) + b(e);
          case '-': return (e) => a(e) - b(e);
          case '*': return (e) => a(e) * b(e);
          case '/': return (e) => a(e) / b(e);
          default: return (e) => Math.pow(a(e), b(e));
        }
      }
      case 'call': {
        const a = n.args.map(go);
        const [a0, a1, a2] = a;
        switch (n.f) {
          case 'if': return (e) => (a0(e) !== 0 ? a1(e) : a2(e));
          case 'ifnot': return (e) => (a0(e) === 0 ? a1(e) : a2(e));
          case 'not': return (e) => (a0(e) === 0 ? 1 : 0);
          case 'between': return (e) => { const v = a0(e); return v >= a1(e) && v <= a2(e) ? 1 : 0; };
          case 'clip': return (e) => Math.min(Math.max(a0(e), a1(e)), a2(e));
          case 'st': { const i = n.args[0].v; return (e) => (e.reg[i] = a1(e)); }
          case 'ld': { const i = n.args[0].v; return (e) => e.reg[i] || 0; }
          case 'smooth': return (e) => F.smooth(a0(e), a1(e), a2(e));
          case 'S': return (e) => e.S(a0(e), a1(e));
          case 'L': return (e) => e.L(a0(e), a1(e));
          case 'A': return (e) => e.A(a0(e), a1(e));
          case 'B': return (e) => e.B(a0(e), a1(e));
          case 'C': return (e) => (e.ch === 0 ? a0(e) : e.ch === 1 ? a1(e) : a2(e));
          case 'PR': return (e) => e.px(a0(e), a1(e))[0];
          case 'PG': return (e) => e.px(a0(e), a1(e))[1];
          case 'PB': return (e) => e.px(a0(e), a1(e))[2];
          default:
            if (MATH1[n.f]) { const f = MATH1[n.f]; return (e) => f(a0(e)); }
            if (MATH2[n.f]) { const f = MATH2[n.f]; return (e) => f(a0(e), a1(e)); }
            throw new Error(`Unknown function ${n.f}`);
        }
      }
      default: throw new Error('bad node');
    }
  };
  return go(ast);
}
