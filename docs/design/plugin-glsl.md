# Authored GLSL effects and transitions

Creative and Node-extension packages may declare GLSL ES 3 fragment functions in
`contributes.effects` and `contributes.transitions`. Use `fragment` instead of
`expression`; the two fields are mutually exclusive. The public SDK types and
package validator accept both forms. Shader source participates in the immutable
package fingerprint. Saved projects contain the exact dependency identity and
parameter values, not shader source.

```json
{
  "id": "color-circuit",
  "name": "Color circuit",
  "fragment": "vec4 effect(vec2 uv) { vec4 c = ccSample(uv); return vec4(mix(c.rgb, c.gbr, {{amount}}), c.a); }",
  "parameters": [{"id":"amount","name":"Amount","min":0,"max":1,"step":0.01,"default":0.5}]
}
```

Effects define `vec4 effect(vec2 uv)`. Transitions define
`vec4 transition(vec2 uv, float progress)`. Helper functions are allowed. The
host supplies `#version 300 es`, precision, texture uniforms and `main`; do not
include another version directive. Source is bounded to 65,536 characters, and
uses the existing maximum of eight bounded numeric parameters. `{{parameter-id}}`
references become uniforms, never injected numeric source text. Unknown
parameters, invalid limits and malformed declarations reject before rendering.
Actual GLSL syntax and device support are checked by the GPU compiler.

Coordinates and colors:

- `uv` uses top-left coordinates in `[0,1]`, at pixel centers.
- `ccSample(uv)` / `ccSampleA(uv)` read the input; `ccSampleB(uv)` reads the
  transition's incoming picture. Sampling clamps to the texture edge.
- Samples and returned RGBA use `[0,1]`, including authored alpha. This differs
  from the older expression language's `[0,255]` channels.
- `W` and `H` are the current raster size. `T` is local effect time in seconds;
  `P` is transition progress. The transition function also receives progress.
- The host mixes effect strength and rectangle/ellipse/feather/invert regions
  with the unchanged input, including alpha. Zero strength preserves the input.
- Transition endpoints are the exact outgoing/incoming RGBA pictures, even if
  an authored transition would otherwise tint or offset its endpoints.

The player, effect previews, transition previews, frame inspection and native
video export use the same GPU source and parameter layout. Shader effects do not
use the color-only LUT approximation. Mixed expression/shader stacks preserve
texture orientation. Parameter, region and strength edits reuse the compiled
program; source changes compile a distinct program. Existing bounded program
caches and context cleanup apply.

## SDK discovery and validation

```ts
const effect = (await context.rendering.list({pluginId: context.extension.id, preferred: true})).items.find(
  item => item.pluginId === context.extension.id && item.program === 'glsl' && item.preferred,
);
if (!effect) throw new Error('Shader is unavailable');
await context.rendering.validate({id: effect.id, params: {amount: .7}});
await context.editor.tools.run({name: 'add_effect', args: {
  effect_id: effect.id, start_sec: 0, duration_sec: 2,
}});
```

`rendering.list({cursor?,limit?,kind?,pluginId?,preferred?})` returns
`{items,total,next}` with typed effect/transition identities, parameters, program
kind and preferred/retained status; it omits source. Pages default to 32 records,
permit at most 128, and stop at 256 KiB of metadata. Follow `next` for more.
Catalog changes can invalidate an old cursor; request a fresh first page. `rendering.validate` resolves
fresh installed bytes and bounds in the host, then compiles on the actual editor
GPU. It works on Home as well as in a project. A compile failure rejects with the
GPU diagnostic and does not stop the extension. SDK structural checks alone do
not establish that a particular GPU can compile a shader.

Editor tools discover and accept installed effects/transitions. Their edits
still use ordinary dependency pinning and Undo. Native parameter controls and
existing clip/effect-slot APIs work with authored GLSL. Missing or disabled
required dependencies block export; explicit instance bypass remains available.
A compile failure is visible in the player and refuses export, rather than
reporting a successful render of an unchanged picture.

The original [SDK workbench example](../../examples/extensions/sdk-workbench)
contains Color circuit and Wave reveal, plus an SDK command that discovers,
validates and adds its shader.

## Verification

Authoritative receipts are recorded under `extensionGlsl` in
[the validation ledger](plugin-validation.json). The real Electron workflow
checks GPU results against a numeric reference, uniforms/program reuse, alpha,
region masks, mixed stacks and transition endpoints. It also exercises SDK
insertion, actual player pixels, native Save/reopen and effect/transition exports,
compile-failure reporting and hidden frame composition. Platform execution is
local macOS; other GPUs and installed platform runs remain separate.

The local native workflow passed 32 checks. Two focused regression
selections passed 15 suites in total; SDK verification passed all 9
suites with no source changes. Renderer build, structure and localization checks
passed. The first GPU run exposed transparent transition endpoints being forced
opaque; that defect is fixed and its failed receipt remains in the ledger.
