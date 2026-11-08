// Native-style sliders fill the track left of the knob. CSS cannot read a range
// input's value, so this keeps a --range-pct custom property in step with every
// <input type="range">: on user input, on programmatic value changes (React sets
// the value property), and when min/max change or new sliders appear.
const pct = el => {
  const min = Number(el.min || 0), max = Number(el.max || 100), v = Number(el.value);
  return max > min && Number.isFinite(v) ? Math.min(100, Math.max(0, ((v - min) / (max - min)) * 100)) : 0;
};
export const syncRange = el => { if (el?.type === 'range') el.style.setProperty('--range-pct', `${pct(el).toFixed(2)}%`); };

export function installRangeFill(doc = document) {
  const proto = doc.defaultView.HTMLInputElement.prototype, desc = Object.getOwnPropertyDescriptor(proto, 'value');
  if (desc?.set && !proto.__rangeFill) {
    Object.defineProperty(proto, 'value', { ...desc, set(v) { desc.set.call(this, v); if (this.type === 'range') syncRange(this); } });
    proto.__rangeFill = true;
  }
  doc.addEventListener('input', e => syncRange(e.target), true);
  const scan = root => root.querySelectorAll?.('input[type="range"]').forEach(syncRange);
  new doc.defaultView.MutationObserver(records => {
    for (const r of records) {
      if (r.type === 'attributes') syncRange(r.target);
      else for (const node of r.addedNodes) { if (node.nodeType === 1) { syncRange(node); scan(node); } }
    }
  }).observe(doc.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['min', 'max', 'value'] });
  scan(doc);
}
