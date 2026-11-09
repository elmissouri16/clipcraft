// A test component, not a built-in graphic: arbitrary names and typed settings must become
// working inspector controls without adding any shape knowledge to the editor.
export const inputs = {
  rate: { type: 'number', default: 1, min: .25, max: 4, step: .25, unit: 'turns/s', label: 'Orbit rate', group: 'Motion', description: 'Changes the rotation rate, not the clip length.' },
  direction: { type: 'choice', default: 1, options: [{ value: 1, label: 'Clockwise' }, { value: -1, label: 'Counterclockwise' }], group: 'Motion' },
  center: { type: 'point', default: { x: .5, y: .5 }, group: 'Appearance' },
  accent: { type: 'color', default: '#ff3b30', group: 'Appearance' },
  showTrack: { type: 'boolean', default: true, group: 'Appearance' },
  note: { type: 'text', default: 'Working', group: 'Appearance' },
  geometry: { type: 'json', default: { radius: 60 }, group: 'Advanced' },
};
export default function render({ time, width, height, inputs, kit }) {
  const cx = inputs.center.x * width, cy = inputs.center.y * height, r = inputs.geometry.radius;
  const a = time * inputs.rate * inputs.direction * Math.PI * 2;
  return kit.svg`<svg viewBox="0 0 ${width} ${height}">
    ${inputs.showTrack ? kit.svg`<circle cx="${cx}" cy="${cy}" r="${r}" stroke="#ffffff" stroke-opacity="0.25" fill="none" stroke-width="4"/>` : ''}
    <circle cx="${cx + r * Math.cos(a)}" cy="${cy + r * Math.sin(a)}" r="14" fill="${inputs.accent}"/>
    <text x="${cx}" y="${cy + r + 45}" text-anchor="middle" font-family="sans-serif" font-size="32" fill="#ffffff">${inputs.note}</text>
  </svg>`;
}
