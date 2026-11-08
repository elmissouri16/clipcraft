import React from 'react';
import { Check, ClipboardList, PencilLine } from 'lucide-react';
import { activityTime } from '../toolActivity.js';

const PLATFORM = { tiktok: 'TikTok', reels: 'Reels', shorts: 'Shorts', youtube: 'YouTube', podcast: 'Podcast clip', tutorial: 'Tutorial', vlog: 'Vlog', ad: 'Ad', other: '' };
const text = value => typeof value === 'string' ? value : '';
const items = value => Array.isArray(value) ? value.filter(v => typeof v === 'string' && v) : [];

function Section({ label, list }) {
  const values = items(list);
  if (!values.length) return null;
  return <div className="plan-section"><span className="plan-label">{label}</span><ul>{values.map((v, i) => <li key={i} dir="auto">{v}</li>)}</ul></div>;
}

// The plan CraftAI proposes before a substantial edit. Approve sends the
// approval as a normal chat message; Change puts a prompt in the composer.
export default function EditPlanCard({ plan, actionable, onApprove, onChange }) {
  if (!plan || typeof plan !== 'object') return null;
  const story = Array.isArray(plan.story) ? plan.story.filter(s => s && text(s.note)) : [];
  const meta = [PLATFORM[plan.platform] || '', Number.isFinite(plan.target_duration_sec) ? `${Math.round(plan.target_duration_sec)} s target` : ''].filter(Boolean);
  return <section className="edit-plan" aria-label="Proposed edit plan">
    <header><ClipboardList size={14} aria-hidden="true" /><b>Edit plan</b>{meta.length > 0 && <span>{meta.join(' · ')}</span>}</header>
    {text(plan.goal) && <p className="plan-goal" dir="auto">{plan.goal}</p>}
    {text(plan.hook) && <div className="plan-section"><span className="plan-label">Hook</span><p dir="auto">{plan.hook}</p></div>}
    {story.length > 0 && <div className="plan-section"><span className="plan-label">Story</span>
      <ol className="plan-story">{story.map((s, i) => <li key={i}>
        {Number.isFinite(s.start_sec) && <time>{activityTime(s.start_sec)}{Number.isFinite(s.end_sec) ? `–${activityTime(s.end_sec)}` : ''}</time>}
        <span dir="auto">{s.note}</span>
      </li>)}</ol>
    </div>}
    <Section label="Cuts" list={plan.cuts} />
    <Section label="Visuals" list={plan.visuals} />
    <Section label="Audio" list={plan.audio} />
    {text(plan.captions) && <div className="plan-section"><span className="plan-label">Captions</span><p dir="auto">{plan.captions}</p></div>}
    <Section label="Questions" list={plan.questions} />
    {actionable && <div className="plan-actions">
      <button type="button" className="btn btn-sm btn-primary" onClick={onApprove}><Check size={13} /> Approve plan</button>
      <button type="button" className="btn btn-sm" onClick={onChange}><PencilLine size={13} /> Change…</button>
    </div>}
  </section>;
}
