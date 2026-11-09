// What CraftAI reads before writing a motion graphic (graphics_guide): how a component works, the
// toolkit, design rules, and three reference components (a data chart, a call-to-action button and
// a lower third). The references are examples to learn from and adapt, not a template catalogue:
// the agent writes whatever graphic the video needs. Rendered by electron/graphics/runtime.js.

export const GRAPHICS_TOOLKIT = `A graphic is a JavaScript module, rendered frame by frame in a sandbox (no network, no files, no DOM):

  export const inputs = { title: { type: 'text', default: 'Revenue' } };   // editable fields with defaults
  export default function render({ frame, frames, fps, time, width, height, inputs, kit }) {
    return kit.svg\`<svg viewBox="0 0 \${width} \${height}">…</svg>\`;   // SVG markup for this frame
  }

- render must be pure: same frame + inputs -> same picture. No timers, fetch, Date or randomness (use kit.random(seed)).
- The canvas is the whole video frame (width x height); everything outside your shapes stays transparent, so the video shows through.
- Write markup with kit.svg\`…\`: numbers are rounded, text is escaped, nested kit.svg pieces and arrays are kept. Never build markup by string concatenation of user text.
- Fonts: pass families to add_graphic fonts (e.g. ["Montserrat 800", "Inter"]) and use font-family="Montserrat" font-weight="800". Without fonts, use sans-serif/serif. No external images; draw icons as <path>.
- Identical markup on consecutive frames costs nothing: let things settle and hold.
- Expose useful settings in export const inputs so the user can adjust the result in the Graphic inspector without another agent request. Read graphics_guide topic inputs for the field contract. Wire every setting into render; do not hard-code adjustable appearance or animation values. This applies to any graphic, not a list of supported shapes.

kit:
- progress(frame, start, length, easing) -> 0..1. easing: linear, in, out, inout, back (overshoot), spring.
- spring({ frame, fps, delay, from, to, stiffness=120, damping=14 }) -> physical motion (lower damping bounces).
- interpolate(x, [in...], [out...], { easing, clamp }) -> mapped value.
- stagger(index, step, start) -> start frame of item index.
- format(value, '$#.#M' | '#,###' | '#%') and countUp(value, p, pattern) for counting numbers.
- drawOn(p) -> attributes that draw a stroke on: <path d="…" fill="none" stroke="…" \${kit.drawOn(p)}/>.
- gradient(id, ['#a', '#b'], { angle, radial }), shadow(id, { dx, dy, blur, color, opacity }), glow(id, { blur, color, opacity }) -> put in <defs>, use fill="url(#id)" / filter="url(#id)".
- smoothPath([[x, y], ...]) -> smooth line "d" (line charts, routes); arc(cx, cy, r, a0, a1, inner) -> pie/ring segment "d" (degrees, 0 = top).
- textWidth(text, { family, size, weight }), fitText(text, maxWidth, { family, weight, max, min }) -> size, wrapText(text, maxWidth, font) -> lines.
- safeArea(width, height) -> { x, y, width, height } where content stays visible (vertical video keeps clear of the bottom buttons).
- mix('#hex', '#hex', t) -> blended colour. raw(markup) -> trusted markup as is.`;

export const GRAPHICS_INPUTS = `Every component declares its own editable settings in export const inputs. The editor creates controls from that schema; there is no shape-specific tool or preset requirement.

Field contract (all fields need default):
- text: string, color: SVG colour string, boolean: on/off, series: array of data rows, json: arbitrary JSON.
- number: numeric default; optional min, max, step, unit. Finite min and max produce a slider plus exact number entry; control: 'number' keeps just number entry. Use positive min where zero would be invalid; integer step for counts.
- choice: options as strings/numbers/booleans, or [{ value: 'forward', label: 'Forward' }, ...]. Values retain their declared type.
- point: default { x: 0.5, y: 0.5 }, X/Y fields; defaults to normalized 0..1 bounds with step .01. Multiply x by width and y by height when drawing. Override min/max/step for other coordinate systems.
- Any field: label, description, group (section heading). Choose concise names and explain units/meaning.

For example, speed: { type: 'number', default: 1, min: 0.1, max: 4, step: 0.1, unit: '×', label: 'Motion speed', group: 'Animation', description: 'Changes the motion rate without changing clip duration.' }.

Expose the settings a video editor would reasonably adjust for THIS graphic: motion rate/direction, reveal/exit timing, repeat behaviour, colours, dimensions/stroke, positions/anchors, text or data, where applicable. Choose what matters; do not add meaningless knobs or fake controls. The list is guidance, not required field names or special cases.
- Separate internal motion speed from overlay duration. Use time * inputs.speed for continuous motion (e.g. angle = time * inputs.speed * 360 for turns per second), and seconds * fps for reveal times. Clip duration is already an editor control.
- Read the supplied inputs in render, including booleans and choices; every exposed field must change the intended result. Preserve existing input names and user values when revising code unless asked to remove them.
- Keep positions relative to width/height so graphics survive canvas changes. Declare separate anchors when parts need independent positioning.
- The user's valid field edits preview live, with a full-quality render prepared automatically after adjusting, without a model call. Verify the controls by rendering at a changed value, not only at defaults. Existing graphics need a component revision to expose values previously hard-coded in their source.`;

export const GRAPHICS_DESIGN = `Design so it reads on a phone:
- Length: one graphic makes one point in 4-12 s. A viewer reads 5-8 items, not 50: show the top 5-10 (or the user's chosen few) unless asked for everything; for many items use a short race or quick pages (3-4 s each), never long static pages.
- Size: titles 70-120 px, labels 40-56 px, values 44-64 px on 1080 px wide video; nothing under 32 px. Bars at least 40 px thick. Fill 70-90 % of the safe area; no small table in a corner.
- Keep it alive: after the build, something keeps moving (the leader highlights, a slow push, a counter, the next item); a still picture for more than 2-3 s feels frozen. add_graphic reports design_warnings: fix them.
- Comparison: one scale for the whole graphic (never rescale between pages), bars from zero, sorted.
- Contrast: light text on dark plates or with a shadow; one accent colour, the rest neutral.
- Timing: build in 0.4-0.8 s, stagger items by 3-6 frames, hold long enough to read (about 0.3 s per word), exit in 0.2-0.4 s or let the clip end.
- Motion: ease everything (spring/out); nothing linear except slow drifts; one focal point at a time.
- Layout inside kit.safeArea; keep away from captions (lower part on vertical video).
- Data: start bars/lines from zero, label values, round sensibly (1.2M not 1,234,567), sort when comparing.
- Sync: start a reveal on the spoken word (transcript times), not on a round number.`;

const CHART = `export const inputs = {
  title: { type: 'text', default: 'Most populous US states' },
  data: { type: 'series', default: [{ label: 'California', value: 39.0 }, { label: 'Texas', value: 30.5 }, { label: 'Florida', value: 22.6 }, { label: 'New York', value: 19.6 }] },
  unit: { type: 'text', default: '#.#M' },
  accent: { type: 'color', default: '#f2b84b' },
};
// Horizontal bars that grow one after another, values counting up with them; the leader keeps a
// soft pulse afterwards so the picture never freezes.
export default function render({ frame, fps, width, height, inputs, kit }) {
  const area = kit.safeArea(width, height), rows = inputs.data, max = Math.max(...rows.map((r) => r.value));
  // Each row: the label above a full-width bar, so bars stay long on vertical video too. Rows are
  // sized to the frame and the block is centred in the safe area.
  const rowH = Math.min(width * 0.22, (area.height - 260) / rows.length), block = 200 + rows.length * rowH;
  const head = area.y + Math.max(0, (area.height - block) / 2), top = head + 200;
  const label = Math.round(rowH * 0.24), value = Math.round(rowH * 0.27), barH = rowH * 0.36;
  const barMax = area.width - kit.textWidth(kit.format(max, inputs.unit), { family: 'Montserrat', weight: 800, size: value }) - 30;
  const titleIn = kit.progress(frame, 0, 18, 'out');
  const bars = rows.map((r, i) => {
    const grow = kit.spring({ frame, fps, delay: kit.stagger(i, 5, 12), damping: 16 });
    const y = top + i * rowH, barY = y + label * 1.25, w = Math.max(0, barMax * (r.value / max) * grow);
    return kit.svg\`<g opacity="\${kit.clamp01(grow * 3)}">
      <text x="\${area.x}" y="\${y + label}" font-family="Montserrat" font-weight="700" font-size="\${label}" fill="#ffffff" fill-opacity="0.9">\${r.label}</text>
      <rect x="\${area.x}" y="\${barY}" width="\${w}" height="\${barH}" rx="\${barH * 0.3}" fill="url(#bar)" filter="url(#soft)"/>
      \${i === 0 ? kit.svg\`<rect x="\${area.x}" y="\${barY}" width="\${w}" height="\${barH}" rx="\${barH * 0.3}" fill="#ffffff" opacity="\${0.12 + 0.12 * Math.sin(frame / fps * Math.PI) * kit.progress(frame, 40, 15)}"/>\` : ''}
      <text x="\${area.x + w + 18}" y="\${barY + barH / 2 + value * 0.36}" font-family="Montserrat" font-weight="800" font-size="\${value}" fill="#ffffff">\${kit.countUp(r.value, grow, inputs.unit)}</text></g>\`;
  });
  return kit.svg\`<svg viewBox="0 0 \${width} \${height}">
    <defs>\${kit.gradient('bar', [kit.mix(inputs.accent, '#ffffff', 0.25), inputs.accent], { angle: 90 })}\${kit.shadow('soft', { dy: 6, blur: 14, opacity: 0.4 })}</defs>
    <text x="\${area.x}" y="\${head + 100 + 30 * (1 - titleIn)}" opacity="\${titleIn}" font-family="Montserrat" font-weight="900" font-size="\${kit.fitText(inputs.title, area.width, { family: 'Montserrat', weight: 900, max: Math.round(width * 0.085) })}" fill="#ffffff">\${inputs.title}</text>
    \${bars}
  </svg>\`;
}`;

const BUTTON = `export const inputs = {
  label: { type: 'text', default: 'SUBSCRIBE' },
  color: { type: 'color', default: '#e53935' },
  pressAt: { type: 'number', default: 1.2 },   // seconds: when the button is pressed
};
// A call-to-action button: pops in, gets pressed (squash + ripple), turns to a done state.
export default function render({ frame, fps, width, height, inputs, kit }) {
  const pop = kit.spring({ frame, fps, delay: 4, stiffness: 180, damping: 12 });
  const press = Math.round(inputs.pressAt * fps), pressed = frame >= press;
  const squash = 1 - 0.08 * kit.interpolate(frame, [press - 3, press, press + 5], [0, 1, 0], { easing: 'out' });
  const ripple = kit.progress(frame, press, 14, 'out');
  const font = { family: 'Montserrat', weight: 900 }, size = 54, label = pressed ? 'SUBSCRIBED' : inputs.label;
  const w = kit.textWidth(label, { ...font, size }) + 150, h = 120, cx = width / 2, cy = height * 0.62;
  const fill = pressed ? '#3a3a3a' : inputs.color;
  return kit.svg\`<svg viewBox="0 0 \${width} \${height}">
    <defs>\${kit.shadow('lift', { dy: 12, blur: 24, opacity: 0.45 })}</defs>
    <g transform="translate(\${cx} \${cy}) scale(\${pop * squash})">
      \${frame >= press ? kit.svg\`<rect x="\${-w / 2 - 40 * ripple}" y="\${-h / 2 - 40 * ripple}" width="\${w + 80 * ripple}" height="\${h + 80 * ripple}" rx="\${h / 2 + 40 * ripple}" fill="none" stroke="#ffffff" stroke-width="6" opacity="\${1 - ripple}"/>\` : ''}
      <rect x="\${-w / 2}" y="\${-h / 2}" width="\${w}" height="\${h}" rx="\${h / 2}" fill="\${fill}" filter="url(#lift)"/>
      <path d="M\${-w / 2 + 46},-18 l0,36 l30,-18 z" fill="#ffffff"/>
      <text x="\${22}" y="\${size * 0.36}" text-anchor="middle" font-family="Montserrat" font-weight="900" font-size="\${size}" fill="#ffffff" letter-spacing="2">\${label}</text>
    </g>
  </svg>\`;
}`;

const LOWER_THIRD = `export const inputs = {
  name: { type: 'text', default: 'Dr. Amina Haddad' },
  role: { type: 'text', default: 'Historian, University of Rabat' },
  accent: { type: 'color', default: '#4fc3f7' },
};
// A lower third: an accent bar draws in, the plate wipes open, name and role rise in, then it drifts
// slowly so it does not freeze.
export default function render({ frame, fps, width, height, inputs, kit }) {
  const area = kit.safeArea(width, height), y = area.y + area.height - 230;
  const x = area.x + 10 * kit.progress(frame, 20, 6 * fps, 'linear');   // slow drift while it holds
  const bar = kit.progress(frame, 0, 12, 'out'), plate = kit.progress(frame, 6, 16, 'out');
  const nameIn = kit.progress(frame, 12, 14, 'out'), roleIn = kit.progress(frame, 17, 14, 'out');
  const nameSize = kit.fitText(inputs.name, area.width * 0.8, { family: 'Montserrat', weight: 800, max: 64 });
  const w = Math.max(kit.textWidth(inputs.name, { family: 'Montserrat', weight: 800, size: nameSize }), kit.textWidth(inputs.role, { family: 'Montserrat', weight: 500, size: 36 })) + 80;
  return kit.svg\`<svg viewBox="0 0 \${width} \${height}">
    <defs><clipPath id="wipe"><rect x="\${x}" y="\${y}" width="\${(w + 20) * plate}" height="170"/></clipPath></defs>
    <rect x="\${x}" y="\${y + 170 * (1 - bar)}" width="12" height="\${170 * bar}" fill="\${inputs.accent}"/>
    <g clip-path="url(#wipe)">
      <rect x="\${x + 12}" y="\${y}" width="\${w}" height="170" fill="#0b0f19" fill-opacity="0.82"/>
      <text x="\${x + 44}" y="\${y + 80 + 20 * (1 - nameIn)}" opacity="\${nameIn}" font-family="Montserrat" font-weight="800" font-size="\${nameSize}" fill="#ffffff">\${inputs.name}</text>
      <text x="\${x + 44}" y="\${y + 132 + 20 * (1 - roleIn)}" opacity="\${roleIn}" font-family="Montserrat" font-weight="500" font-size="36" fill="\${inputs.accent}">\${inputs.role}</text>
    </g>
  </svg>\`;
}`;

export const GRAPHICS_EXAMPLES = { chart: CHART, button: BUTTON, lower_third: LOWER_THIRD };
export const GRAPHICS_TOPICS = ['toolkit', 'inputs', 'design', ...Object.keys(GRAPHICS_EXAMPLES)];

export function graphicsGuide(topic = 'toolkit') {
  if (topic === 'toolkit') return { topic, text: GRAPHICS_TOOLKIT, examples: Object.keys(GRAPHICS_EXAMPLES), next: 'Read inputs, design, and one example close to what you need; then write your own component with useful editable settings and call add_graphic.' };
  if (topic === 'design') return { topic, text: GRAPHICS_DESIGN };
  if (topic === 'inputs') return { topic, text: GRAPHICS_INPUTS };
  if (GRAPHICS_EXAMPLES[topic]) return { topic, fonts: ['Montserrat 500', 'Montserrat 700', 'Montserrat 800', 'Montserrat 900'], code: GRAPHICS_EXAMPLES[topic],
    note: 'A reference to learn from. Adapt it freely or write something new; pass the fonts it uses to add_graphic.' };
  return { error: `topic must be one of: ${GRAPHICS_TOPICS.join(', ')}.` };
}
